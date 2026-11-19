import express from 'express';
import { getPool, sql } from '../db/pool.js';
const router = express.Router();

router.get('/', async (req,res,next)=>{
  try{
    const pool=await getPool();
    const rs=await pool.request().query(`
      SELECT * FROM Cameras
      WHERE IsActive=1
      ORDER BY IsDefault DESC, CameraName`);
    res.json(rs.recordset);
  }catch(e){next(e)}
});

router.post('/', async (req,res,next)=>{
  try{
    const pool=await getPool();
    const b=req.body;
    const connectionType = String(b.connectionType || 'RTSP').toUpperCase();
    if(!['RTSP','DIRECT'].includes(connectionType)) return res.status(400).json({message:'ConnectionType chỉ hỗ trợ RTSP hoặc DIRECT'});
    if(connectionType === 'RTSP' && !b.rtspUrl) return res.status(400).json({message:'Camera RTSP cần nhập RTSP URL'});
    const rs=await pool.request()
      .input('CameraCode',sql.NVarChar,b.cameraCode)
      .input('CameraName',sql.NVarChar,b.cameraName)
      .input('ConnectionType',sql.NVarChar,connectionType)
      .input('RtspUrl',sql.NVarChar,b.rtspUrl || null)
      .input('DeviceHint',sql.NVarChar,b.deviceHint || null)
      .input('IsDefault',sql.Bit,!!b.isDefault)
      .query(`INSERT INTO Cameras(CameraCode,CameraName,ConnectionType,RtspUrl,DeviceHint,IsDefault)
              VALUES(@CameraCode,@CameraName,@ConnectionType,@RtspUrl,@DeviceHint,@IsDefault)
              RETURNING *`);
    res.json(rs.recordset[0]);
  }catch(e){next(e)}
});
router.delete('/:id', async (req,res,next)=>{
  try{
    const pool=await getPool();
    const id=parseInt(req.params.id, 10);
    if(!id) return res.status(400).json({message:'CameraId không hợp lệ'});

    const checkCam = await pool.request()
      .input('id', sql.Int, id)
      .query('SELECT CameraId, CameraCode, CameraName FROM Cameras WHERE CameraId=@id');
    if(!checkCam.recordset.length){
      return res.status(404).json({message:'Không tìm thấy camera cần xóa'});
    }

    const refCheck = await pool.request()
      .input('id', sql.Int, id)
      .query('SELECT COUNT(*) as count FROM PackingSessions WHERE CameraId=@id OR CameraId2=@id');

    if(refCheck.recordset[0].count > 0){
      await pool.request()
        .input('id', sql.Int, id)
        .query("UPDATE Cameras SET IsActive=false, CameraCode=CONCAT(CameraCode, '_del_', CameraId) WHERE CameraId=@id");
    } else {
      await pool.request()
        .input('id', sql.Int, id)
        .query('DELETE FROM Cameras WHERE CameraId=@id');
    }
    res.json({success:true, message:'Đã xóa camera thành công'});
  }catch(e){next(e)}
});

export default router;
