import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import dotenv from 'dotenv';
dotenv.config();

const activeLive = new Map();
const storageDir = process.env.STORAGE_DIR || './storage';
const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';

function ensureDir(p){ fs.mkdirSync(p, { recursive: true }); }
function safeName(s){ return String(s || '').replace(/[^a-zA-Z0-9._-]/g, '_'); }
export function getLiveRoot(){ const dir = path.resolve(path.join(storageDir, 'live')); ensureDir(dir); return dir; }
export function getLiveDir(sessionId){ const dir = path.join(getLiveRoot(), safeName(sessionId)); ensureDir(dir); return dir; }

export function startHlsPreview({ sessionId, rtspUrl }){
  if(activeLive.has(sessionId)) return activeLive.get(sessionId);
  const liveDir = getLiveDir(sessionId);
  const playlist = path.join(liveDir, 'index.m3u8');
  const maxW = Number(process.env.LIVE_MAX_WIDTH || 960);
  const fps = Number(process.env.LIVE_FPS || 12);
  const args = [
    '-rtsp_transport', 'tcp',
    '-i', rtspUrl,
    '-an',
    '-vf', `fps=${fps},scale='min(${maxW},iw)':-2`,
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-g', String(fps * 2),
    '-sc_threshold', '0',
    '-f', 'hls',
    '-hls_time', process.env.LIVE_HLS_TIME || '1',
    '-hls_list_size', process.env.LIVE_HLS_LIST_SIZE || '6',
    '-hls_flags', 'delete_segments+append_list+omit_endlist',
    '-hls_segment_filename', path.join(liveDir, 'seg_%05d.ts'),
    '-y', playlist
  ];
  const proc = spawn(ffmpegPath, args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let lastError = '';
  proc.stderr.on('data', d => { lastError = d.toString().slice(-2000); });
  const info = { proc, liveDir, playlist, liveUrl: `/live/${safeName(sessionId)}/index.m3u8`, startedAt: Date.now(), get lastError(){ return lastError; } };
  activeLive.set(sessionId, info);
  proc.on('exit', () => activeLive.delete(sessionId));
  return info;
}

export async function stopHlsPreview(sessionId, { cleanup = false } = {}){
  const live = activeLive.get(sessionId);
  if(!live){ return { stopped:false, reason:'Live process not found' }; }
  return new Promise(resolve => {
    const timeout = setTimeout(()=>{ try{ live.proc.kill('SIGKILL'); }catch{} finish(); }, 5000);
    function finish(){
      clearTimeout(timeout);
      if(cleanup){ try{ fs.rmSync(live.liveDir, { recursive:true, force:true }); }catch{} }
      resolve({ stopped:true, liveUrl: live.liveUrl, duration: Math.round((Date.now()-live.startedAt)/1000) });
    }
    live.proc.once('exit', finish);
    try{ live.proc.stdin.write('q'); live.proc.stdin.end(); }catch{ try{ live.proc.kill('SIGTERM'); }catch{} }
  });
}

export function listActiveLive(){ return Array.from(activeLive.entries()).map(([sessionId, v]) => ({ sessionId, liveUrl:v.liveUrl, startedAt:v.startedAt })); }
