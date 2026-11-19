import fs from 'fs';
import path from 'path';
import { spawn, execFileSync } from 'child_process';
import dotenv from 'dotenv';
dotenv.config();

const active = new Map();
const storageDir = process.env.STORAGE_DIR || './storage';
const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobePath = process.env.FFPROBE_PATH || 'ffprobe';

function ensureDir(p){ fs.mkdirSync(p, { recursive: true }); }
function safeName(s){ return String(s || '').replace(/[^a-zA-Z0-9._-]/g, '_'); }
function escapeFilterPath(s){ return String(s || '').replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'"); }

export function getVideoDir(){
  const dir = path.resolve(path.join(storageDir, 'videos'));
  ensureDir(dir);
  return dir;
}

export function buildVideoName(orderCode, sessionId, ext='mp4'){
  return `${safeName(orderCode)}_${sessionId}.${ext.replace('.', '')}`;
}

export function getVideoDurationInSeconds(filePath){
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    // 1. Thử đọc format=duration (nhanh và chuẩn nhất với mp4, mkv)
    const out = execFileSync(ffprobePath, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath
    ], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    let dur = parseFloat(String(out).trim());
    if (Number.isFinite(dur) && dur > 0) return Math.round(dur);

    // 2. Với file webm ghi từ MediaRecorder trên trình duyệt không có header duration, đọc packet cuối
    const pktOut = execFileSync(ffprobePath, [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'packet=pts_time',
      '-read_intervals', '99999%+#1',
      '-of', 'csv=p=0',
      filePath
    ], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    dur = parseFloat(String(pktOut).replace(/[^0-9.]/g, ''));
    if (Number.isFinite(dur) && dur > 0) return Math.round(dur);
  } catch (e) {
    // ffprobe lỗi hoặc file chưa hoàn tất
  }
  return null;
}

function timestampFilter(){
  const fontSize = Number(process.env.VIDEO_TIMESTAMP_FONT_SIZE || 24);
  const defaultFont = fs.existsSync('C:/Windows/Fonts/arial.ttf') ? 'C:/Windows/Fonts/arial.ttf' : '';
  const fontFile = process.env.VIDEO_TIMESTAMP_FONT_FILE || defaultFont;
  const fontOption = fontFile ? `fontfile='${escapeFilterPath(fontFile)}':` : '';
  return `drawtext=${fontOption}fontcolor=white:fontsize=${fontSize}:box=1:boxcolor=black@0.55:boxborderw=8:x=20:y=20:text='%{localtime\\:%Y-%m-%d %H\\\\\\:%M\\\\\\:%S}'`;
}

function startFfmpegRecording({ key, args, outPath, fileName, extraOutputs=[] }){
  const proc = spawn(ffmpegPath, args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let stderr = '';
  const rec = {
    proc,
    outPath,
    fileName,
    extraOutputs,
    startedAt:Date.now(),
    exited:false,
    exitCode:null,
    exitSignal:null,
    spawnError:null,
    get stderr(){ return stderr; }
  };
  proc.stderr.on('data', d => { stderr = (stderr + d.toString()).slice(-4000); });
  proc.on('error', e=>{
    rec.spawnError=e;
    rec.exited=true;
    stderr=(stderr+`\n${e.message}`).slice(-4000);
    console.error(`[FFmpeg] Không thể khởi động phiên ${key}:`,e.message);
  });
  proc.on('exit', (code,signal)=>{
    rec.exited=true;
    rec.exitCode=code;
    rec.exitSignal=signal;
  });
  active.set(key, rec);
  return { outPath, fileName, extraOutputs };
}

export function startRecording({ sessionId, orderCode, rtspUrl, role='' }){
  const key = role ? `${sessionId}:${role}` : sessionId;
  const fileName = buildVideoName(`${orderCode}${role ? `_${role}` : ''}`, sessionId, 'mp4');
  const outPath = path.resolve(path.join(getVideoDir(), fileName));
  const crf = process.env.VIDEO_CRF || '23';
  const preset = process.env.VIDEO_PRESET || 'veryfast';
  const maxW = Number(process.env.VIDEO_MAX_WIDTH || 1280);
  const args = [
    '-rtsp_transport', 'tcp',
    '-i', rtspUrl,
    '-vf', `scale='min(${maxW},iw)':-2,${timestampFilter()}`,
    '-c:v', 'libx264',
    '-preset', preset,
    '-crf', crf,
    '-movflags', '+faststart',
    '-an',
    '-y', outPath
  ];
  return startFfmpegRecording({ key, args, outPath, fileName });
}

export function startCompositeRecording({ sessionId, orderCode, mainRtspUrl, pipRtspUrl }){
  const fileName = buildVideoName(orderCode, sessionId, 'mp4');
  const outPath = path.resolve(path.join(getVideoDir(), fileName));
  const fileName2 = buildVideoName(`${orderCode}_camera2_original`, sessionId, 'mkv');
  const outPath2 = path.resolve(path.join(getVideoDir(), fileName2));
  const crf = process.env.VIDEO_CRF || '23';
  const preset = process.env.VIDEO_PRESET || 'veryfast';
  const maxW = Number(process.env.VIDEO_MAX_WIDTH || 1280);
  const configuredPipW = Number(process.env.VIDEO_PIP_WIDTH || 480);
  const pipW = Math.max(2, Math.floor((Number.isFinite(configuredPipW) ? configuredPipW : 480) / 2) * 2);
  const pipH = Math.round((pipW * 9 / 16) / 2) * 2;
  const margin = Number(process.env.VIDEO_PIP_MARGIN || 24);
  const filter = `[0:v]scale='min(${maxW},iw)':-2:flags=lanczos,${timestampFilter()}[main];[1:v]scale=${pipW}:${pipH}:force_original_aspect_ratio=increase:flags=lanczos,crop=${pipW}:${pipH}:(iw-ow)/2:(ih-oh)/2,setsar=1[pip];[main][pip]overlay=main_w-overlay_w-${margin}:${margin}:format=auto[v]`;
  const args = [
    '-y',
    '-rtsp_transport', 'tcp',
    '-i', mainRtspUrl,
    '-rtsp_transport', 'tcp',
    '-i', pipRtspUrl,
    '-filter_complex', filter,
    '-map', '[v]',
    '-c:v', 'libx264',
    '-preset', preset,
    '-crf', crf,
    '-movflags', '+faststart',
    '-an',
    outPath,
    '-map', '1:v:0',
    '-c:v', 'copy',
    '-an',
    '-avoid_negative_ts', 'make_zero',
    outPath2
  ];
  const extraOutputs = [{ role:'camera2', outPath:outPath2, fileName:fileName2 }];
  const started = startFfmpegRecording({ key: sessionId, args, outPath, fileName, extraOutputs });
  return { ...started, outPath2, fileName2 };
}

export async function stopRecording(sessionId){
  const rec = active.get(sessionId);
  if(!rec){ return { stopped: false, reason: 'Recording process not found' }; }
  return new Promise(resolve => {
    let finished=false;
    const timeout = setTimeout(() => {
      try { rec.proc.kill('SIGKILL'); } catch {}
      finish();
    }, 8000);
    function finish(){
      if(finished) return;
      finished=true;
      clearTimeout(timeout);
      active.delete(sessionId);
      const exists = fs.existsSync(rec.outPath);
      const stat = exists ? fs.statSync(rec.outPath) : null;
      const extraOutputs = (rec.extraOutputs || []).map(output=>{
        const outputExists = fs.existsSync(output.outPath);
        const outputStat = outputExists ? fs.statSync(output.outPath) : null;
        return { ...output, size:outputStat?.size || 0 };
      });
      const probedDuration = getVideoDurationInSeconds(rec.outPath);
      const duration = probedDuration != null ? probedDuration : Math.round((Date.now()-rec.startedAt)/1000);
      resolve({
        stopped: !rec.spawnError,
        outPath: rec.outPath,
        fileName: rec.fileName,
        size: stat?.size || 0,
        duration,
        exitCode:rec.exitCode,
        exitSignal:rec.exitSignal,
        error:rec.spawnError?.message || null,
        stderr:rec.stderr || '',
        extraOutputs,
        camera2: extraOutputs.find(x=>x.role==='camera2') || null
      });
    }
    if(rec.exited) return finish();
    rec.proc.once('exit', finish);
    rec.proc.once('error', finish);
    try { rec.proc.stdin.write('q'); rec.proc.stdin.end(); } catch { try { rec.proc.kill('SIGTERM'); } catch {} }
  });
}

export function listActiveRecordings(){ return Array.from(active.entries()).filter(([,rec])=>!rec.exited).map(([key])=>key); }
