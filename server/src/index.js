import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import orders from './routes/orders.js';
import cameras from './routes/cameras.js';
import packing from './routes/packing.js';
import auth from './routes/auth.js';
import { requireAuth } from './middleware.auth.js';

dotenv.config();
const app = express();
const port = Number(process.env.PORT || 8095);
const storageDir = process.env.STORAGE_DIR || './storage';

function safeWindowsDownloadBase(value){
  let name = String(value || '')
    .split(',')[0]
    .trim()
    .normalize('NFC')
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  if(!name) name = 'video';
  if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `_${name}`;
  return name.slice(0, 180) || 'video';
}

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*', credentials: true }));
app.use(express.json({ limit: '20mb' }));
app.use(morgan('dev'));
app.get('/videos/download/:fileName', (req,res,next)=>{
  try{
    const fileName = String(req.params.fileName || '');
    if(!fileName || fileName==='.' || fileName==='..' || fileName.includes('/') || fileName.includes('\\') || path.basename(fileName)!==fileName){
      return res.status(400).json({ message:'Tên file video không hợp lệ' });
    }

    const videoRoot = path.resolve(path.join(storageDir, 'videos'));
    const candidatePath = path.resolve(path.join(videoRoot, fileName));
    const candidateRelative = path.relative(videoRoot, candidatePath);
    if(!candidateRelative || candidateRelative.startsWith('..') || path.isAbsolute(candidateRelative)){
      return res.status(400).json({ message:'Đường dẫn video không hợp lệ' });
    }
    if(!fs.existsSync(candidatePath) || !fs.statSync(candidatePath).isFile()){
      return res.status(404).json({ message:'Không tìm thấy video' });
    }

    const realRoot = fs.realpathSync(videoRoot);
    const realFile = fs.realpathSync(candidatePath);
    const realRelative = path.relative(realRoot, realFile);
    if(!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative)){
      return res.status(400).json({ message:'Đường dẫn video không hợp lệ' });
    }

    const trackingNumber = req.query.returnTrackingNumber ?? req.query.returnTracking ?? req.query.trackingNumber ?? req.query.tracking ?? req.query.tracking_numbers;
    const baseName = safeWindowsDownloadBase(trackingNumber);
    const source = String(req.query.source || '').toLowerCase();
    const camera2 = source==='camera2' || ['1','true','yes'].includes(String(req.query.camera2 || '').toLowerCase());
    const extension = path.extname(fileName).toLowerCase() || '.mp4';
    const downloadName = `${baseName}${camera2 ? '_camera2' : ''}${extension}`;

    res.setHeader('Cache-Control', 'private, no-store');
    res.download(realFile, downloadName, err=>{
      if(!err) return;
      if(res.headersSent) res.destroy(err);
      else next(err);
    });
  }catch(err){ next(err); }
});
app.use('/videos', express.static(path.resolve(path.join(storageDir, 'videos'))));
app.use('/snapshots', express.static(path.resolve(path.join(storageDir, 'snapshots'))));
app.use('/live', express.static(path.resolve(path.join(storageDir, 'live')), {
  setHeaders: (res, filePath) => {
    if(filePath.endsWith('.m3u8')) res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    if(filePath.endsWith('.ts')) res.setHeader('Content-Type', 'video/MP2T');
    res.setHeader('Cache-Control', 'no-store');
  }
}));
app.use('/api/health', (_,res)=>res.json({ ok:true, app:'Vision AI Kiosk POS', time:new Date().toISOString() }));
app.use('/api/auth', auth);
app.use('/api/orders', requireAuth, orders);
app.use('/api/cameras', requireAuth, cameras);
app.use('/api/packing', requireAuth, packing);

// Phục vụ giao diện người dùng Production đã đóng gói từ client/dist
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDistCandidates = [
  path.resolve(__dirname, '../../client/dist'),
  path.resolve('../client/dist'),
  path.resolve('./client/dist')
];
const clientDist = clientDistCandidates.find(d => fs.existsSync(d) && fs.existsSync(path.join(d, 'index.html')));

if (clientDist) {
  console.log(`[Static] Phục vụ giao diện Kiosk từ: ${clientDist}`);
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (
      req.path.startsWith('/api') ||
      req.path.startsWith('/assets') ||
      req.path.startsWith('/videos') ||
      req.path.startsWith('/snapshots') ||
      req.path.startsWith('/live')
    ) {
      return next();
    }
    res.sendFile(path.join(clientDist, 'index.html'));
  });
} else {
  console.warn('[Static] Cảnh báo: Không tìm thấy thư mục client/dist đã build');
}

app.use((err,req,res,next)=>{ console.error(err); res.status(500).json({ message: err.message || 'Server error' }); });
app.listen(port, ()=>console.log(`Vision AI Kiosk server: http://localhost:${port}`));
