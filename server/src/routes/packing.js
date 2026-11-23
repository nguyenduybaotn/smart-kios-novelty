import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { getPool, sql } from '../db/pool.js';
import { getOrderByCode } from '../services/order.service.js';
import { startRecording, startCompositeRecording, stopRecording, listActiveRecordings, getVideoDir, buildVideoName, getVideoDurationInSeconds } from '../services/video.service.js';
import { startHlsPreview, stopHlsPreview, listActiveLive } from '../services/live.service.js';
const router = express.Router();
const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const storageDir = process.env.STORAGE_DIR || './storage';
const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
function safeName(s){ return String(s || '').replace(/[^a-zA-Z0-9._-]/g, '_'); }
function redactRtspCredentials(s){ return String(s || '').replace(/(rtsp:\/\/)[^@\s]+@/gi,'$1***@'); }
function getSnapshotDir(){ const dir=path.resolve(path.join(storageDir,'snapshots')); fs.mkdirSync(dir,{recursive:true}); return dir; }
function getDirectUploadDir(){ const dir=path.resolve(path.join(storageDir,'uploads')); fs.mkdirSync(dir,{recursive:true}); return dir; }
function buildSnapshotName(orderCode, sessionId){ return `${safeName(orderCode)}_${sessionId}_${Date.now()}.jpg`; }
function saveImageBuffer(buf, fileName){ const outPath=path.join(getSnapshotDir(), fileName); fs.writeFileSync(outPath, buf); const stat=fs.statSync(outPath); return { outPath, size: stat.size||0 }; }
function captureRtspToJpeg(rtspUrl, outPath){ return new Promise((resolve,reject)=>{ const args=['-rtsp_transport','tcp','-i',rtspUrl,'-frames:v','1','-vf',`scale='min(1280,iw)':-2`,'-q:v','4','-y',outPath]; const proc=spawn(ffmpegPath,args,{stdio:['ignore','ignore','pipe']}); let err=''; proc.stderr.on('data',d=>err+=d.toString().slice(-1500)); proc.on('exit',code=>code===0?resolve():reject(new Error(err||'FFmpeg snapshot failed'))); }); }

const directVideoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req,_file,cb)=>cb(null,getDirectUploadDir()),
    filename: (req,file,cb)=>{
      const ext=file.mimetype?.includes('webm') ? 'webm' : 'mp4';
      cb(null,`.upload_${safeName(req.params.sessionId)}_${safeName(file.fieldname)}_${uuidv4()}.${ext}`);
    }
  }),
  limits: { fileSize: 8 * 1024 * 1024 * 1024, files:2 }
});

function cleanupDirectUploads(req){
  for(const files of Object.values(req.files || {})){
    for(const file of files || []){
      try{ if(file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path); }catch{}
    }
  }
}

function moveDirectUpload(sourcePath,targetPath){
  const videoRoot=path.resolve(getVideoDir());
  const resolvedTarget=path.resolve(targetPath);
  if(path.dirname(resolvedTarget)!==videoRoot) throw new Error('Đường dẫn lưu video không hợp lệ');
  if(fs.existsSync(resolvedTarget)) fs.unlinkSync(resolvedTarget);
  fs.renameSync(sourcePath,resolvedTarget);
}

function removeCancelledVideo(filePath, sessionId){
  if(!filePath) return false;
  const videoRoot=path.resolve(getVideoDir());
  const resolvedTarget=path.resolve(filePath);
  if(path.dirname(resolvedTarget)!==videoRoot){
    console.warn(`[PACKING][${sessionId}] Bỏ qua xóa file ngoài thư mục video: ${resolvedTarget}`);
    return false;
  }
  if(!fs.existsSync(resolvedTarget)) return false;
  fs.unlinkSync(resolvedTarget);
  return true;
}

export async function ensurePackingDualCameraSchema(){
  const pool=await getPool();
  await pool.request().batch(`
    ALTER TABLE "PackingSessions" ADD COLUMN IF NOT EXISTS "CameraId2" INTEGER;
    ALTER TABLE "PackingSessions" ADD COLUMN IF NOT EXISTS "VideoPath2" VARCHAR(1000);
    ALTER TABLE "PackingSessions" ADD COLUMN IF NOT EXISTS "VideoFileName2" VARCHAR(255);
    ALTER TABLE "PackingSessions" ADD COLUMN IF NOT EXISTS "VideoSizeBytes2" BIGINT;
    ALTER TABLE "PackingSessions" ADD COLUMN IF NOT EXISTS "CompositeMode" VARCHAR(40);
    ALTER TABLE "PackingSessions" ADD COLUMN IF NOT EXISTS "SessionType" VARCHAR(30) NOT NULL DEFAULT 'PACKING';
    ALTER TABLE "PackingSessions" ADD COLUMN IF NOT EXISTS "ReturnTrackingNumber" VARCHAR(255);
    ALTER TABLE "PackingSessions" ADD COLUMN IF NOT EXISTS "ReturnReason" VARCHAR(500);
    ALTER TABLE "Orders" ADD COLUMN IF NOT EXISTS "ReturnTrackingNumber" VARCHAR(255);
  `);
}

router.get('/sessions', async (req,res,next)=>{ 
  try{ 
    await ensurePackingDualCameraSchema();
    const pool=await getPool(); 
    const q = `%${req.query.q || ''}%`;
    const rs=await pool.request().input('q',sql.NVarChar,q).query(`
      SELECT ps.*, 
        (SELECT x.FileName FROM PackingSnapshots x WHERE x.SessionId=ps.SessionId ORDER BY x.CapturedAt ASC LIMIT 1) AS FirstSnapshotFileName,
        o.CustomerName AS OrderCustomerName, o.Phone AS OrderCustomerPhone, o.Channel, o.TrackingNumbers, o.ReturnTrackingNumber AS OrderReturnTrackingNumber, 
        c.CameraName, c.ConnectionType, c2.CameraName AS CameraName2, c2.ConnectionType AS ConnectionType2
      FROM PackingSessions ps
      LEFT JOIN Orders o ON ps.OrderId=o.OrderId
      LEFT JOIN Cameras c ON ps.CameraId=c.CameraId
      LEFT JOIN Cameras c2 ON ps.CameraId2=c2.CameraId
      WHERE ps.OrderCode LIKE @q
         OR COALESCE(ps.CustomerName, o.CustomerName) LIKE @q
         OR COALESCE(ps.CustomerPhone, o.Phone) LIKE @q
         OR COALESCE(o.TrackingNumbers,'') LIKE @q
         OR COALESCE(ps.ReturnTrackingNumber,'') LIKE @q
         OR COALESCE(o.ReturnTrackingNumber,'') LIKE @q
         OR COALESCE(ps.SessionType,'') LIKE @q
         OR COALESCE(ps.OperatorName,'') LIKE @q
         OR COALESCE(ps.OperatorUsername,'') LIKE @q
         OR COALESCE(c.CameraName,'') LIKE @q
         OR COALESCE(c2.CameraName,'') LIKE @q
         OR COALESCE(c.ConnectionType,'') LIKE @q
      ORDER BY COALESCE(ps.CompletedAt, ps.StartedAt) DESC, ps.StartedAt DESC
      LIMIT 300`); 
    const rows = rs.recordset;
    for (const r of rows) {
      if ((r.DurationSeconds == null || r.DurationSeconds === 0) && r.VideoFileName) {
        const vPath = r.VideoPath && fs.existsSync(r.VideoPath) ? r.VideoPath : path.join(getVideoDir(), r.VideoFileName);
        const dur = getVideoDurationInSeconds(vPath);
        if (dur != null && dur > 0) {
          r.DurationSeconds = dur;
          pool.request()
            .input('SessionId', sql.UniqueIdentifier, r.SessionId)
            .input('DurationSeconds', sql.Int, dur)
            .query('UPDATE PackingSessions SET DurationSeconds=@DurationSeconds WHERE SessionId=@SessionId')
            .catch(() => null);
        }
      }
    }
    res.json(rows);
  }catch(e){next(e)} 
});
router.get('/active', (req,res)=>res.json({ active: listActiveRecordings(), live: listActiveLive() }));

router.post('/start', async (req,res,next)=>{
  try{
    await ensurePackingDualCameraSchema();
    const { orderCode, cameraId, cameraId2, operatorName, sessionType = 'PACKING', returnTrackingNumber = null, returnReason = null } = req.body;
    const loginUser = req.user || {};
    const order = await getOrderByCode(orderCode);
    if(!order) return res.status(404).json({ message:'Không tìm thấy đơn hàng' });
    const pool=await getPool();
    let cam;
    let cam2;
    const hasCameraId = cameraId !== undefined && cameraId !== null && cameraId !== '';
    const hasCameraId2 = cameraId2 !== undefined && cameraId2 !== null && cameraId2 !== '';
    if(hasCameraId){
      const parsedCameraId=Number(cameraId);
      if(!Number.isInteger(parsedCameraId) || parsedCameraId<=0) return res.status(400).json({ message:'Camera 1 không hợp lệ' });
      const rs=await pool.request().input('id',sql.Int,parsedCameraId).query('SELECT * FROM Cameras WHERE CameraId=@id AND IsActive=1');
      cam=rs.recordset[0];
      if(!cam) return res.status(400).json({ message:`Camera 1 (ID ${parsedCameraId}) không tồn tại hoặc đã ngưng hoạt động` });
    }
    if(hasCameraId2){
      const parsedCameraId2=Number(cameraId2);
      if(!Number.isInteger(parsedCameraId2) || parsedCameraId2<=0) return res.status(400).json({ message:'Camera 2 không hợp lệ' });
      const rs=await pool.request().input('id',sql.Int,parsedCameraId2).query('SELECT * FROM Cameras WHERE CameraId=@id AND IsActive=1');
      cam2=rs.recordset[0];
      if(!cam2) return res.status(400).json({ message:`Camera 2 (ID ${parsedCameraId2}) không tồn tại hoặc đã ngưng hoạt động` });
    }
    if(!hasCameraId){ const rs=await pool.request().query('SELECT TOP 1 * FROM Cameras WHERE IsActive=1 ORDER BY IsDefault DESC, CameraId'); cam=rs.recordset[0]; }
    if(!cam) return res.status(400).json({ message:'Chưa khai báo camera' });
    if(cam2 && cam2.CameraId===cam.CameraId) return res.status(400).json({ message:'Camera 2 phải khác Camera chính' });
    const connectionType = String(cam.ConnectionType || 'RTSP').toUpperCase();
    const sessionId=uuidv4();
    let videoPath = null;
    let videoFileName = null;
    let videoPath2 = null;
    let videoFileName2 = null;
    let liveUrl = null;
    let compositeMode = null;
    let status = connectionType === 'DIRECT' ? 'RECORDING_DIRECT' : 'RECORDING';
    const normalizedSessionType = String(sessionType || 'PACKING').toUpperCase();
    const cleanReturnTracking = String(returnTrackingNumber || '').trim() || null;
    const cleanReturnReason = String(returnReason || '').trim() || null;
    if(connectionType === 'RTSP'){
      if(!cam.RtspUrl) return res.status(400).json({ message:'Camera RTSP chưa có RtspUrl' });
      const cam2Type=String(cam2?.ConnectionType || '').toUpperCase();
      if(cam2 && cam2Type!=='RTSP') return res.status(400).json({ message:'Camera phụ cho ghép server phải là RTSP. Với USB/DIRECT, hãy chọn camera phụ trực tiếp trên trình duyệt.' });
      if(cam2 && !cam2.RtspUrl) return res.status(400).json({ message:'Camera phụ RTSP chưa có RtspUrl' });
      const rec = cam2?.RtspUrl
        ? startCompositeRecording({ sessionId, orderCode, mainRtspUrl: cam.RtspUrl, pipRtspUrl: cam2.RtspUrl })
        : startRecording({ sessionId, orderCode, rtspUrl: cam.RtspUrl });
      const live = startHlsPreview({ sessionId, rtspUrl: cam.RtspUrl });
      videoPath = rec.outPath;
      videoFileName = rec.fileName;
      videoPath2 = rec.outPath2 || null;
      videoFileName2 = rec.fileName2 || null;
      compositeMode = cam2?.RtspUrl ? 'RTSP_PIP_ORIGINAL' : null;
      liveUrl = live.liveUrl;
    }
    await pool.request()
      .input('SessionId',sql.UniqueIdentifier,sessionId)
      .input('OrderId',sql.Int,order.OrderId)
      .input('CameraId',sql.Int,cam.CameraId)
      .input('CameraId2',sql.Int,cam2?.CameraId||null)
      .input('OrderCode',sql.NVarChar,orderCode)
      .input('Status',sql.NVarChar,status)
      .input('VideoPath',sql.NVarChar,videoPath)
      .input('VideoFileName',sql.NVarChar,videoFileName)
      .input('VideoPath2',sql.NVarChar,videoPath2)
      .input('VideoFileName2',sql.NVarChar,videoFileName2)
      .input('CompositeMode',sql.NVarChar,compositeMode)
      .input('QrPayload',sql.NVarChar,cleanReturnTracking || orderCode)
      .input('OperatorName',sql.NVarChar,operatorName||loginUser.fullName||null)
      .input('OperatorUsername',sql.NVarChar,loginUser.username||null)
      .input('OperatorUserId',sql.Int,loginUser.userId||null)
      .input('CustomerName',sql.NVarChar,order.CustomerName||null)
      .input('CustomerPhone',sql.NVarChar,order.Phone||null)
      .input('SessionType',sql.NVarChar,normalizedSessionType)
      .input('ReturnTrackingNumber',sql.NVarChar,cleanReturnTracking)
      .input('ReturnReason',sql.NVarChar,cleanReturnReason)
      .query(`INSERT INTO PackingSessions(SessionId,OrderId,CameraId,CameraId2,OperatorUserId,OrderCode,Status,VideoPath,VideoFileName,VideoPath2,VideoFileName2,CompositeMode,QrPayload,OperatorName,OperatorUsername,CustomerName,CustomerPhone,SessionType,ReturnTrackingNumber,ReturnReason)
              VALUES(@SessionId,@OrderId,@CameraId,@CameraId2,@OperatorUserId,@OrderCode,@Status,@VideoPath,@VideoFileName,@VideoPath2,@VideoFileName2,@CompositeMode,@QrPayload,@OperatorName,@OperatorUsername,@CustomerName,@CustomerPhone,@SessionType,@ReturnTrackingNumber,@ReturnReason)`);

    if(normalizedSessionType === 'RETURN'){
      await pool.request()
        .input('id', sql.Int, order.OrderId)
        .input('ReturnTrackingNumber', sql.NVarChar, cleanReturnTracking)
        .query("UPDATE Orders SET Status='RETURN_INSPECTING', ReturnTrackingNumber=COALESCE(@ReturnTrackingNumber, ReturnTrackingNumber), UpdatedAt=SYSUTCDATETIME() WHERE OrderId=@id");
    } else {
      await pool.request().input('id',sql.Int,order.OrderId).query("UPDATE Orders SET Status='PACKING', UpdatedAt=SYSUTCDATETIME() WHERE OrderId=@id");
    }
    res.json({ sessionId, order, camera: cam, camera2: cam2||null, videoFileName, videoFileName2, connectionType, liveUrl, sessionType: normalizedSessionType, returnTrackingNumber: cleanReturnTracking });
  }catch(e){next(e)}
});


router.post('/pause/:sessionId', async (req,res,next)=>{
  try{
    const pool=await getPool();
    await pool.request().input('SessionId',sql.UniqueIdentifier,req.params.sessionId).query("UPDATE PackingSessions SET Status='PAUSED' WHERE SessionId=@SessionId AND Status IN ('RECORDING','RECORDING_DIRECT')");
    res.json({ ok:true, paused:true, message:'Đã tạm dừng phiên đóng gói. Camera trực tiếp sẽ pause MediaRecorder trên trình duyệt.' });
  }catch(e){next(e)}
});

router.post('/resume/:sessionId', async (req,res,next)=>{
  try{
    const pool=await getPool();
    await pool.request().input('SessionId',sql.UniqueIdentifier,req.params.sessionId).query("UPDATE PackingSessions SET Status=CASE WHEN Status='PAUSED' THEN 'RECORDING' ELSE Status END WHERE SessionId=@SessionId");
    res.json({ ok:true, resumed:true, message:'Đã quay tiếp phiên đóng gói.' });
  }catch(e){next(e)}
});

router.post('/cancel/:sessionId', async (req,res,next)=>{
  try{
    await ensurePackingDualCameraSchema();
    const sessionId=req.params.sessionId;
    const pool=await getPool();
    const rs=await pool.request()
      .input('SessionId',sql.UniqueIdentifier,sessionId)
      .query('SELECT * FROM PackingSessions WHERE SessionId=@SessionId');
    const s=rs.recordset[0];
    if(!s) return res.status(404).json({ message:'Không tìm thấy phiên đóng gói' });
    if(s.Status==='COMPLETED') return res.status(409).json({ message:'Phiên đã hoàn tất nên không thể hủy' });

    const reason=String(req.body?.reason || 'Client không thể bắt đầu quay camera').trim().slice(0,900);
    const [recordingResult, liveResult]=await Promise.all([
      stopRecording(sessionId).catch(error=>({ stopped:false, error:error.message })),
      stopHlsPreview(sessionId,{ cleanup:true }).catch(error=>({ stopped:false, error:error.message }))
    ]);

    const removedFiles=[];
    for(const filePath of [s.VideoPath,s.VideoPath2]){
      try{
        if(removeCancelledVideo(filePath,sessionId)) removedFiles.push(path.basename(filePath));
      }catch(error){
        console.error(`[PACKING][${sessionId}] Không thể xóa video của phiên đã hủy:`,error.message);
      }
    }

    const cancelNote=`Hủy phiên: ${reason}`;
    const transaction=pool.transaction();
    await transaction.begin();
    try{
      await transaction.request()
        .input('SessionId',sql.UniqueIdentifier,sessionId)
        .input('Note',sql.NVarChar(1000),cancelNote)
        .query(`UPDATE PackingSessions
                SET Status='FAILED', CompletedAt=COALESCE(CompletedAt,CURRENT_TIMESTAMP),
                    VideoPath=NULL, VideoFileName=NULL, VideoPath2=NULL, VideoFileName2=NULL,
                    VideoSizeBytes=NULL, VideoSizeBytes2=NULL, CompositeMode=NULL, Note=@Note
                WHERE SessionId=@SessionId AND Status<>'COMPLETED'`);
      await transaction.request()
        .input('OrderId',sql.Int,s.OrderId)
        .input('SessionId',sql.UniqueIdentifier,sessionId)
        .query(`UPDATE Orders
                SET Status='PENDING', UpdatedAt=CURRENT_TIMESTAMP
                WHERE OrderId=@OrderId AND Status='PACKING'
                  AND NOT EXISTS (
                    SELECT 1 FROM PackingSessions activeSession
                    WHERE activeSession.OrderId=Orders.OrderId
                      AND activeSession.SessionId<>@SessionId
                      AND activeSession.Status IN ('RECORDING','RECORDING_DIRECT','PAUSED')
                  )`);
      await transaction.commit();
    }catch(error){
      await transaction.rollback().catch(()=>null);
      throw error;
    }

    console.warn(`[PACKING][${sessionId}] Đã hủy phiên: ${reason}`,{
      recordingStopped:recordingResult.stopped,
      liveStopped:liveResult.stopped,
      removedFiles
    });
    res.json({ cancelled:true, sessionId, status:'FAILED', recordingStopped:!!recordingResult.stopped, liveStopped:!!liveResult.stopped, removedFiles });
  }catch(e){next(e)}
});

router.post('/snapshot/:sessionId', imageUpload.single('image'), async (req,res,next)=>{
  try{
    const sessionId=req.params.sessionId;
    const pool=await getPool();
    const rs=await pool.request().input('SessionId',sql.UniqueIdentifier,sessionId).query(`SELECT ps.*, c.RtspUrl, c.ConnectionType FROM PackingSessions ps LEFT JOIN Cameras c ON ps.CameraId=c.CameraId WHERE ps.SessionId=@SessionId`);
    const s=rs.recordset[0]; if(!s) return res.status(404).json({message:'Session not found'});
    const fileName=buildSnapshotName(s.OrderCode, sessionId);
    let outPath, size;
    if(req.file){
      const saved=saveImageBuffer(req.file.buffer, fileName); outPath=saved.outPath; size=saved.size;
    }else{
      outPath=path.join(getSnapshotDir(), fileName);
      if(!s.RtspUrl) return res.status(400).json({message:'Không có RTSP URL để chụp hình. Với camera trực tiếp, client cần gửi file ảnh.'});
      await captureRtspToJpeg(s.RtspUrl, outPath);
      size=fs.statSync(outPath).size || 0;
    }
    await pool.request()
      .input('SessionId',sql.UniqueIdentifier,sessionId)
      .input('OrderId',sql.Int,s.OrderId)
      .input('OrderCode',sql.NVarChar,s.OrderCode)
      .input('FileName',sql.NVarChar,fileName)
      .input('FilePath',sql.NVarChar,outPath)
      .input('FileSizeBytes',sql.BigInt,size)
      .input('CapturedByUserId',sql.Int,req.user?.userId||null)
      .input('CapturedByName',sql.NVarChar,req.user?.fullName||null)
      .query(`INSERT INTO PackingSnapshots(SessionId,OrderId,OrderCode,FileName,FilePath,FileSizeBytes,CapturedByUserId,CapturedByName) VALUES(@SessionId,@OrderId,@OrderCode,@FileName,@FilePath,@FileSizeBytes,@CapturedByUserId,@CapturedByName)`);
    res.json({ ok:true, fileName, imageUrl:`/snapshots/${fileName}`, size });
  }catch(e){next(e)}
});

router.get('/snapshots/:sessionId', async (req,res,next)=>{
  try{
    const pool=await getPool();
    const rs=await pool.request().input('SessionId',sql.UniqueIdentifier,req.params.sessionId).query('SELECT * FROM PackingSnapshots WHERE SessionId=@SessionId ORDER BY CapturedAt ASC');
    res.json(rs.recordset.map(x=>({...x, imageUrl:`/snapshots/${x.FileName}`})));
  }catch(e){next(e)}
});

router.post('/complete/:sessionId', async (req,res,next)=>{
  try{
    await ensurePackingDualCameraSchema();
    const sessionId=req.params.sessionId;
    const pool=await getPool();
    const rs=await pool.request().input('SessionId',sql.UniqueIdentifier,sessionId).query('SELECT * FROM PackingSessions WHERE SessionId=@SessionId');
    const s=rs.recordset[0]; if(!s) return res.status(404).json({message:'Session not found'});
    const info=await stopRecording(sessionId);
    const mainSize=info.size || (s.VideoPath && fs.existsSync(s.VideoPath) ? fs.statSync(s.VideoPath).size : 0);
    const camera2Size=info.camera2?.size || (s.VideoPath2 && fs.existsSync(s.VideoPath2) ? fs.statSync(s.VideoPath2).size : 0);
    await stopHlsPreview(sessionId, { cleanup:false }).catch(()=>null);
    if(!info.stopped || !mainSize || (s.VideoFileName2 && !camera2Size)){
      console.error(`[PACKING][${sessionId}] FFmpeg không tạo đủ video`,{ reason:info.reason||info.error||'empty output', mainSize, camera2Size, stderr:redactRtspCredentials(info.stderr) });
      await pool.request().input('SessionId',sql.UniqueIdentifier,sessionId).query("UPDATE PackingSessions SET Status='FAILED', CompletedAt=SYSUTCDATETIME() WHERE SessionId=@SessionId");
      return res.status(500).json({ message:s.VideoFileName2 && !camera2Size?'Không lưu được video gốc Camera 2':'Không lưu được video đóng gói' });
    }
    const videoFilePath = s.VideoPath && fs.existsSync(s.VideoPath) ? s.VideoPath : path.join(getVideoDir(), s.VideoFileName);
    const videoDuration = getVideoDurationInSeconds(videoFilePath) ?? info.duration ?? 0;
    await pool.request().input('SessionId',sql.UniqueIdentifier,sessionId).input('VideoSizeBytes',sql.BigInt,mainSize).input('VideoSizeBytes2',sql.BigInt,camera2Size||null).input('DurationSeconds',sql.Int,videoDuration).query("UPDATE PackingSessions SET Status='COMPLETED', CompletedAt=SYSUTCDATETIME(), VideoSizeBytes=@VideoSizeBytes, VideoSizeBytes2=@VideoSizeBytes2, DurationSeconds=@DurationSeconds WHERE SessionId=@SessionId");
    const nextOrderStatus = String(s.SessionType || '').toUpperCase() === 'RETURN' ? 'RETURN_CHECKED' : 'PACKED';
    await pool.request().input('OrderId',sql.Int,s.OrderId).input('Status',sql.NVarChar,nextOrderStatus).query("UPDATE Orders SET Status=@Status, UpdatedAt=SYSUTCDATETIME() WHERE OrderId=@OrderId");
    res.json({ completed:true, ...info, duration:videoDuration, fileName2:s.VideoFileName2||null, videoUrl:`/videos/${s.VideoFileName}`, video2Url:s.VideoFileName2?`/videos/${s.VideoFileName2}`:null });
  }catch(e){next(e)}
});

router.post('/complete-direct/:sessionId', directVideoUpload.fields([{name:'video',maxCount:1},{name:'video2',maxCount:1}]), async (req,res,next)=>{
  try{
    await ensurePackingDualCameraSchema();
    const sessionId=req.params.sessionId;
    const mainFile=req.files?.video?.[0];
    const camera2File=req.files?.video2?.[0] || null;
    if(!mainFile){ cleanupDirectUploads(req); return res.status(400).json({message:'Chưa nhận được file video từ trình duyệt'}); }
    const pool=await getPool();
    const rs=await pool.request().input('SessionId',sql.UniqueIdentifier,sessionId).query('SELECT * FROM PackingSessions WHERE SessionId=@SessionId');
    const s=rs.recordset[0]; if(!s){ cleanupDirectUploads(req); return res.status(404).json({message:'Session not found'}); }
    const ext = mainFile.mimetype?.includes('webm') ? 'webm' : 'mp4';
    const fileName = buildVideoName(s.OrderCode, sessionId, ext);
    const outPath = path.join(getVideoDir(), fileName);
    moveDirectUpload(mainFile.path,outPath);
    const stat = fs.statSync(outPath);
    let fileName2=null, outPath2=null, stat2=null;
    if(camera2File){
      const ext2=camera2File.mimetype?.includes('webm') ? 'webm' : 'mp4';
      fileName2=buildVideoName(`${s.OrderCode}_camera2_original`,sessionId,ext2);
      outPath2=path.join(getVideoDir(),fileName2);
      moveDirectUpload(camera2File.path,outPath2);
      stat2=fs.statSync(outPath2);
    }
    const probedDuration = getVideoDurationInSeconds(outPath);
    const duration = probedDuration != null ? probedDuration : Math.round(Number(req.body.durationSeconds || 0));
    await pool.request()
      .input('SessionId',sql.UniqueIdentifier,sessionId)
      .input('VideoPath',sql.NVarChar,outPath)
      .input('VideoFileName',sql.NVarChar,fileName)
      .input('VideoPath2',sql.NVarChar,outPath2)
      .input('VideoFileName2',sql.NVarChar,fileName2)
      .input('VideoSizeBytes',sql.BigInt,stat.size||0)
      .input('VideoSizeBytes2',sql.BigInt,stat2?.size||null)
      .input('CompositeMode',sql.NVarChar,fileName2?'DIRECT_PIP_ORIGINAL':null)
      .input('DurationSeconds',sql.Int,duration)
      .query("UPDATE PackingSessions SET Status='COMPLETED', CompletedAt=SYSUTCDATETIME(), VideoPath=@VideoPath, VideoFileName=@VideoFileName, VideoPath2=@VideoPath2, VideoFileName2=@VideoFileName2, VideoSizeBytes=@VideoSizeBytes, VideoSizeBytes2=@VideoSizeBytes2, CompositeMode=@CompositeMode, DurationSeconds=@DurationSeconds WHERE SessionId=@SessionId");
    const nextOrderStatus = String(s.SessionType || '').toUpperCase() === 'RETURN' ? 'RETURN_CHECKED' : 'PACKED';
    await pool.request().input('OrderId',sql.Int,s.OrderId).input('Status',sql.NVarChar,nextOrderStatus).query("UPDATE Orders SET Status=@Status, UpdatedAt=SYSUTCDATETIME() WHERE OrderId=@OrderId");
    res.json({ completed:true, stopped:true, outPath, fileName, outPath2, fileName2, size:stat.size||0, size2:stat2?.size||0, duration, videoUrl:`/videos/${fileName}`, video2Url:fileName2?`/videos/${fileName2}`:null });
  }catch(e){ cleanupDirectUploads(req); next(e) }
});

export default router;
