import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  message
} from 'antd';
import {
  CameraOutlined,
  CheckCircleFilled,
  CheckCircleOutlined,
  CloudSyncOutlined,
  FullscreenExitOutlined,
  FullscreenOutlined,
  LinkOutlined,
  PauseCircleOutlined,
  PictureOutlined,
  PlayCircleOutlined,
  QrcodeOutlined,
  ReloadOutlined,
  RollbackOutlined,
  SearchOutlined,
  SyncOutlined,
  UndoOutlined,
  VideoCameraOutlined
} from '@ant-design/icons';
import Hls from 'hls.js';
import dayjs from 'dayjs';
import {
  API_BASE,
  cancelPacking,
  captureRtspSnapshot,
  completeDirectPacking,
  completePacking,
  getCameras,
  getOrder,
  getOrders,
  mapReturnOrder,
  passAllItems,
  pausePacking,
  processReturnERP,
  resolveSku,
  resumePacking,
  scanProduct,
  startPacking,
  uploadSnapshot
} from '../services/api';
import {
  acquireUserMediaStream,
  enumerateVideoDevices,
  findSavedVideoDevice,
  loadCameraConfig
} from '../services/camera-config';

function getBestMime() {
  if (window.MediaRecorder?.isTypeSupported?.('video/mp4;codecs=avc1')) return 'video/mp4;codecs=avc1';
  if (window.MediaRecorder?.isTypeSupported?.('video/mp4;codecs=h264')) return 'video/mp4;codecs=h264';
  if (window.MediaRecorder?.isTypeSupported?.('video/mp4')) return 'video/mp4';
  if (window.MediaRecorder?.isTypeSupported?.('video/webm;codecs=h264')) return 'video/webm;codecs=h264';
  if (window.MediaRecorder?.isTypeSupported?.('video/webm;codecs=vp8')) return 'video/webm;codecs=vp8';
  if (window.MediaRecorder?.isTypeSupported?.('video/webm;codecs=vp9')) return 'video/webm;codecs=vp9';
  return 'video/webm';
}

function formatVideoTimestamp(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function drawCover(ctx, video, x, y, w, h) {
  const vw = video.videoWidth || w, vh = video.videoHeight || h;
  const scale = Math.max(w / vw, h / vh);
  const sw = w / scale, sh = h / scale;
  const sx = (vw - sw) / 2, sy = (vh - sh) / 2;
  ctx.drawImage(video, sx, sy, sw, sh, x, y, w, h);
}

export default function ReturnPackingPage({ user, cameraConfig }) {
  // Input scanning barcode hoàn
  const [returnTrackingInput, setReturnTrackingInput] = useState('');
  const [currentReturnTracking, setCurrentReturnTracking] = useState('');
  const [returnReason, setReturnReason] = useState('');

  // Đơn hàng & Modal map đơn
  const [order, setOrder] = useState(null);
  const [mapModalOpen, setMapModalOpen] = useState(false);
  const [searchOrderQuery, setSearchOrderQuery] = useState('');
  const [searchOrderResults, setSearchOrderResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedOrderToMap, setSelectedOrderToMap] = useState(null);
  const [mappingLoading, setMappingLoading] = useState(false);

  // Barcode sản phẩm trong gói hoàn
  const [productBarcode, setProductBarcode] = useState('');
  const [productScanning, setProductScanning] = useState(false);

  // Camera states
  const [cams, setCams] = useState([]);
  const [cameraId, setCameraId] = useState();
  const [cameraId2, setCameraId2] = useState();
  const [directDevices, setDirectDevices] = useState([]);
  const [directDeviceId, setDirectDeviceId] = useState('');
  const [directDeviceId2, setDirectDeviceId2] = useState('');

  // Recording session states
  const [session, setSession] = useState(null);
  const [busy, setBusy] = useState(false);
  const [directState, setDirectState] = useState('idle');
  const [liveUrl, setLiveUrl] = useState('');
  const [paused, setPaused] = useState(false);
  const [snapshots, setSnapshots] = useState([]);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // ERP processing states
  const [erpProcessing, setErpProcessing] = useState(false);
  const [erpModalOpen, setErpModalOpen] = useState(false);
  const [erpResult, setErpResult] = useState(null);
  const [customOid, setCustomOid] = useState('');
  const [customOrderNo, setCustomOrderNo] = useState('');
  const [customLoaiDonHang, setCustomLoaiDonHang] = useState('SALE_ORDER');

  // Refs
  const scanInputRef = useRef(null);
  const videoRef = useRef(null);
  const videoRef2 = useRef(null);
  const liveVideoRef = useRef(null);
  const directPreviewRef = useRef(null);
  const rtspPreviewRef = useRef(null);
  const composedCanvasRef = useRef(null);
  const animationRef = useRef(0);
  const hlsRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const mediaStreamRef2 = useRef(null);
  const recorderRef = useRef(null);
  const recorderRef2 = useRef(null);
  const chunksRef = useRef([]);
  const chunksRef2 = useRef([]);
  const pendingDirectUploadRef = useRef(null);
  const startedAtRef = useRef(0);
  const operationRef = useRef('idle');

  // Load cameras
  useEffect(() => {
    getCameras().then(setCams).catch(e => message.error(e.response?.data?.message || 'Không tải được danh sách camera'));
  }, []);

  useEffect(() => {
    if (!cams.length) return;
    const saved = cameraConfig || loadCameraConfig();
    const configured = cams.find(cam => cam.CameraId === Number(saved?.cameraId))
      || cams.find(cam => saved?.cameraCode && cam.CameraCode === saved.cameraCode);
    const main = configured || cams[0];
    setCameraId(main?.CameraId);
    if (configured) {
      const second = cams.find(cam => cam.CameraId === Number(saved?.cameraId2))
        || cams.find(cam => saved?.cameraCode2 && cam.CameraCode === saved.cameraCode2);
      setCameraId2(second?.CameraId);
      setDirectDeviceId(saved?.directDeviceId || '');
      setDirectDeviceId2(saved?.directDeviceId2 || '');
    }
  }, [cams, cameraConfig]);

  useEffect(() => () => { cleanupDirect(); cleanupHls(); }, []);

  // Fullscreen listeners
  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement || document.webkitFullscreenElement));
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);

  // HLS live stream listener
  useEffect(() => {
    cleanupHls();
    if (!liveUrl || !liveVideoRef.current) return;
    const fullUrl = `${API_BASE}${liveUrl}`;
    const video = liveVideoRef.current;
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = fullUrl;
      video.play().catch(() => { });
      return;
    }
    if (Hls.isSupported()) {
      const hls = new Hls({ liveSyncDurationCount: 3, maxLiveSyncPlaybackRate: 1.5 });
      hls.loadSource(fullUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => { }));
      hlsRef.current = hls;
    }
  }, [liveUrl]);

  const selectedCam = cams.find(c => c.CameraId === cameraId);
  const connectionType = String(selectedCam?.ConnectionType || 'RTSP').toUpperCase();
  const rtspCameras = cams.filter(c => String(c.ConnectionType || 'RTSP').toUpperCase() === 'RTSP');

  useEffect(() => {
    const cam = cams.find(c => c.CameraId === cameraId);
    if (String(cam?.ConnectionType || '').toUpperCase() === 'DIRECT') setTimeout(() => refreshDirectDevices(false), 80);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraId, cams.length]);

  async function refreshDirectDevices(showMessage = true) {
    try {
      const videos = await enumerateVideoDevices({ requestPermission: true });
      setDirectDevices(videos);
      const saved = cameraConfig || loadCameraConfig();
      const savedMain = findSavedVideoDevice(videos, {
        deviceId: saved?.directDeviceId,
        label: saved?.directDeviceLabel,
        groupId: saved?.directGroupId
      });
      const savedSecond = findSavedVideoDevice(videos, {
        deviceId: saved?.directDeviceId2,
        label: saved?.directDeviceLabel2,
        groupId: saved?.directGroupId2
      });
      const currentMain = videos.find(device => device.deviceId === directDeviceId);
      const currentSecond = videos.find(device => device.deviceId === directDeviceId2);
      setDirectDeviceId(savedMain?.deviceId || currentMain?.deviceId || (!saved ? videos[0]?.deviceId : ''));
      setDirectDeviceId2(savedSecond?.deviceId || currentSecond?.deviceId || (!saved ? videos.find(device => device.deviceId !== videos[0]?.deviceId)?.deviceId : ''));
      if (showMessage) message.success(`Đã tìm thấy ${videos.length} nguồn camera trực tiếp`);
    } catch (e) {
      if (showMessage) message.error(e.message || 'Không thể truy cập danh sách camera. Hãy kiểm tra quyền camera/HTTPS.');
    }
  }

  async function resolveCameraSelection() {
    const saved = cameraConfig || loadCameraConfig();
    if (!saved?.cameraId && !saved?.cameraCode) {
      throw new Error('Chưa lưu cấu hình camera. Hãy mở tab Cấu hình camera và chọn Camera 1, Camera 2.');
    }
    const availableCams = cams.length ? cams : await getCameras();
    if (!cams.length) setCams(availableCams);
    const main = availableCams.find(cam => cam.CameraId === Number(saved.cameraId))
      || availableCams.find(cam => saved.cameraCode && cam.CameraCode === saved.cameraCode);
    if (!main) throw new Error('Camera 1 đã lưu không còn tồn tại. Hãy lưu lại cấu hình camera.');
    const mode = String(main.ConnectionType || 'RTSP').toUpperCase();
    setCameraId(main.CameraId);
    if (mode === 'RTSP') {
      const second = availableCams.find(cam => cam.CameraId === Number(saved.cameraId2))
        || availableCams.find(cam => saved.cameraCode2 && cam.CameraCode === saved.cameraCode2);
      if (!second || String(second.ConnectionType || 'RTSP').toUpperCase() !== 'RTSP') {
        throw new Error('Camera 2 RTSP đã lưu không còn hợp lệ. Hãy lưu lại cấu hình camera.');
      }
      if (second.CameraId === main.CameraId) throw new Error('Camera 1 và Camera 2 phải khác nhau.');
      setCameraId2(second.CameraId);
      return { mode, cameraId: main.CameraId, cameraId2: second.CameraId };
    }
    const devices = await enumerateVideoDevices({ requestPermission: true });
    setDirectDevices(devices);
    const first = findSavedVideoDevice(devices, {
      deviceId: saved.directDeviceId,
      label: saved.directDeviceLabel,
      groupId: saved.directGroupId
    });
    const second = findSavedVideoDevice(devices, {
      deviceId: saved.directDeviceId2,
      label: saved.directDeviceLabel2,
      groupId: saved.directGroupId2
    });
    if (!first) throw new Error('Không tìm thấy Webcam 1 đã lưu. Hãy kết nối camera và lưu lại cấu hình.');
    if (!second) throw new Error('Không tìm thấy Webcam 2 đã lưu. Hãy kết nối camera và lưu lại cấu hình.');
    if (first.deviceId === second.deviceId) throw new Error('Webcam 1 và Webcam 2 phải khác nhau.');
    setCameraId2(undefined);
    setDirectDeviceId(first.deviceId);
    setDirectDeviceId2(second.deviceId);
    return { mode, cameraId: main.CameraId, cameraId2: null, directDeviceId: first.deviceId, directDeviceId2: second.deviceId };
  }

  function waitForCameraPreview() {
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  function cleanupDirect() {
    try { recorderRef.current && recorderRef.current.state !== 'inactive' && recorderRef.current.stop(); } catch { }
    try { recorderRef2.current && recorderRef2.current.state !== 'inactive' && recorderRef2.current.stop(); } catch { }
    try { recorderRef.current?.stream?.getTracks?.().forEach(t => t.stop()); } catch { }
    try { recorderRef2.current?.stream?.getTracks?.().forEach(t => t.stop()); } catch { }
    try { cancelAnimationFrame(animationRef.current); } catch { }
    try { mediaStreamRef.current?.getTracks?.().forEach(t => t.stop()); } catch { }
    try { mediaStreamRef2.current?.getTracks?.().forEach(t => t.stop()); } catch { }
    try { if (videoRef.current) { videoRef.current.pause(); videoRef.current.srcObject = null; videoRef.current.removeAttribute('src'); videoRef.current.load(); } } catch { }
    try { if (videoRef2.current) { videoRef2.current.pause(); videoRef2.current.srcObject = null; videoRef2.current.removeAttribute('src'); videoRef2.current.load(); } } catch { }
    mediaStreamRef.current = null; recorderRef.current = null; chunksRef.current = [];
    mediaStreamRef2.current = null; recorderRef2.current = null; chunksRef2.current = []; animationRef.current = 0;
  }

  function cleanupHls() {
    try { hlsRef.current?.destroy(); } catch { }
    hlsRef.current = null;
    if (liveVideoRef.current) {
      try { liveVideoRef.current.pause(); liveVideoRef.current.removeAttribute('src'); liveVideoRef.current.load(); } catch { }
    }
  }

  // Quét mã vận đơn hàng hoàn
  async function handleScanReturnTracking() {
    const barcode = String(returnTrackingInput || '').trim();
    if (!barcode) return message.warning('Vui lòng quét hoặc nhập mã vận đơn hàng hoàn');
    if (session) return message.warning('Đang có một phiên quay clip chưa hoàn tất');

    setBusy(true);
    setCurrentReturnTracking(barcode);
    try {
      const existingOrder = await getOrder(barcode);
      if (existingOrder) {
        setOrder(existingOrder);
        message.success(`Đã tìm thấy đơn hàng ${existingOrder.OrderCode} tương ứng`);
      } else {
        setOrder(null);
        setSearchOrderQuery('');
        setSearchOrderResults([]);
        setMapModalOpen(true);
        message.info(`Mã vận đơn hoàn ${barcode} chưa được map. Vui lòng chọn đơn hàng gốc.`);
      }
    } catch {
      setOrder(null);
      setSearchOrderQuery('');
      setSearchOrderResults([]);
      setMapModalOpen(true);
      message.info(`Mã vận đơn hoàn ${barcode} chưa được map. Vui lòng chọn đơn hàng gốc.`);
    } finally {
      setBusy(false);
    }
  }

  // Tìm kiếm đơn hàng gốc để map
  async function handleSearchOrders() {
    const q = String(searchOrderQuery || '').trim();
    if (!q) return message.warning('Vui lòng nhập từ khóa tìm kiếm (mã đơn, ID Sapo, SĐT, tên khách, mã vận đơn gốc)');
    setSearchLoading(true);
    try {
      const results = await getOrders(q);
      setSearchOrderResults(results || []);
      if (!results?.length) message.info('Không tìm thấy đơn hàng nào phù hợp');
    } catch (e) {
      message.error(e.response?.data?.message || 'Lỗi khi tìm kiếm đơn hàng');
    } finally {
      setSearchLoading(false);
    }
  }

  // Xác nhận map đơn hàng với mã vận đơn hoàn
  async function confirmMapOrder(selectedOrder) {
    if (!currentReturnTracking) return message.error('Thiếu mã vận đơn hoàn để map');
    setMappingLoading(true);
    try {
      const res = await mapReturnOrder(selectedOrder.OrderCode, currentReturnTracking, returnReason);
      setOrder(res.order);
      setMapModalOpen(false);
      setSelectedOrderToMap(null);
      message.success(`Đã map thành công mã vận đơn hoàn ${currentReturnTracking} với đơn hàng ${res.order.OrderCode}`);
    } catch (e) {
      message.error(e.response?.data?.message || 'Không thể map đơn hàng');
    } finally {
      setMappingLoading(false);
    }
  }

  // Quay Direct bằng Canvas ghép PIP
  async function startDirectBrowserRecording({ mainDeviceId = directDeviceId, pipDeviceId = directDeviceId2 } = {}) {
    const videoConstraint = mainDeviceId
      ? { deviceId: { exact: mainDeviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
      : { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } };
    const stream = await acquireUserMediaStream({
      video: videoConstraint,
      audio: false
    });
    mediaStreamRef.current = stream;
    if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => { }); }
    if (pipDeviceId && pipDeviceId !== mainDeviceId) {
      const stream2 = await acquireUserMediaStream({
        video: {
          deviceId: { exact: pipDeviceId },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          aspectRatio: { ideal: 16 / 9 },
          frameRate: { ideal: 30 }
        },
        audio: false
      });
      mediaStreamRef2.current = stream2;
      if (videoRef2.current) { videoRef2.current.srcObject = stream2; await videoRef2.current.play().catch(() => { }); }
    }
    chunksRef.current = [];
    chunksRef2.current = [];
    pendingDirectUploadRef.current = null;
    const mimeType = getBestMime();
    const outputStream = startComposedCanvasStream();
    const recorder = new MediaRecorder(outputStream, { mimeType, videoBitsPerSecond: mediaStreamRef2.current ? 2_800_000 : 2_000_000 });
    recorder.ondataavailable = e => { if (e.data?.size) chunksRef.current.push(e.data); };
    recorder.onerror = e => console.error('[Hàng hoàn][Camera chính] Lỗi MediaRecorder', e.error || e);
    const recorder2 = mediaStreamRef2.current
      ? new MediaRecorder(mediaStreamRef2.current, { mimeType, videoBitsPerSecond: 3_500_000 })
      : null;
    if (recorder2) {
      recorder2.ondataavailable = e => { if (e.data?.size) chunksRef2.current.push(e.data); };
      recorder2.onerror = e => console.error('[Hàng hoàn][Camera 2] Lỗi MediaRecorder', e.error || e);
      console.info('[Hàng hoàn][Camera 2] Bắt đầu lưu video gốc (đã tối ưu bitrate)', mediaStreamRef2.current.getVideoTracks?.()[0]?.getSettings?.());
    }
    recorderRef.current = recorder;
    recorderRef2.current = recorder2;
    try {
      recorder.start(1000);
      recorder2?.start(1000);
    } catch (e) {
      cleanupDirect();
      throw e;
    }
    startedAtRef.current = Date.now();
    setDirectState('recording');
  }

  function startComposedCanvasStream() {
    const mainVideo = videoRef.current;
    const pipVideo = videoRef2.current;
    const canvas = composedCanvasRef.current || document.createElement('canvas');
    composedCanvasRef.current = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    
    // Giới hạn FPS ở mức 25 FPS để tiết kiệm CPU tối đa
    const fpsInterval = 1000 / 25;
    let lastDrawTime = 0;

    const draw = (now) => {
      animationRef.current = requestAnimationFrame(draw);
      if (now - lastDrawTime < fpsInterval) return;
      lastDrawTime = now - ((now - lastDrawTime) % fpsInterval);

      // Giới hạn kích thước canvas tối đa 1280x720 để nhẹ CPU
      const rawW = mainVideo?.videoWidth || 1280;
      const rawH = mainVideo?.videoHeight || 720;
      const maxW = 1280;
      const scaleDown = rawW > maxW ? maxW / rawW : 1;
      const w = Math.round((rawW * scaleDown) / 2) * 2;
      const h = Math.round((rawH * scaleDown) / 2) * 2;

      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'medium';
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
      if (mainVideo?.videoWidth) drawCover(ctx, mainVideo, 0, 0, w, h);
      if (pipVideo?.videoWidth) {
        const pipW = Math.round(w * 0.36);
        const pipH = Math.round(pipW * 9 / 16);
        const margin = Math.round(w * 0.02);

        // Viền đen nhẹ (bỏ shadowBlur để không ngốn CPU)
        ctx.fillStyle = '#000000';
        ctx.fillRect(w - pipW - margin - 3, margin - 3, pipW + 6, pipH + 6);

        drawCover(ctx, pipVideo, w - pipW - margin, margin, pipW, pipH);
        ctx.strokeStyle = '#fa8c16';
        ctx.lineWidth = Math.max(2, Math.round(w / 640));
        ctx.strokeRect(w - pipW - margin, margin, pipW, pipH);
      }
      const timeText = formatVideoTimestamp();
      const badgeText = `HÀNG HOÀN • ${currentReturnTracking || order?.OrderCode || ''} • ${timeText}`;
      const fontSize = Math.max(18, Math.round(w / 50));
      ctx.font = `700 ${fontSize}px Arial`;
      const metrics = ctx.measureText(badgeText);
      const tx = 20, ty = 24 + fontSize;
      ctx.fillStyle = 'rgba(212, 56, 13, 0.85)';
      ctx.fillRect(tx - 10, ty - fontSize - 8, metrics.width + 20, fontSize + 16);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(badgeText, tx, ty);
    };
    animationRef.current = requestAnimationFrame(draw);
    return canvas.captureStream(25);
  }

  // Bắt đầu quay clip kiểm tra hàng hoàn
  async function startReturnRecording() {
    if (!order) return message.warning('Chưa có thông tin đơn hàng để quay');
    if (!currentReturnTracking) return message.warning('Chưa có mã vận đơn hàng hoàn');
    if (operationRef.current !== 'idle') return message.warning('Hệ thống đang xử lý phiên quay');

    operationRef.current = 'starting';
    setBusy(true);
    let createdSession = null;
    try {
      const selection = await resolveCameraSelection();
      const mode = selection.mode;
      if (mode === 'DIRECT') {
        setDirectState('starting');
        await waitForCameraPreview();
      }

      const d = await startPacking({
        orderCode: order.OrderCode,
        cameraId: selection.cameraId,
        cameraId2: mode === 'RTSP' ? selection.cameraId2 : null,
        operatorName: user.fullName,
        sessionType: 'RETURN',
        returnTrackingNumber: currentReturnTracking,
        returnReason
      });

      createdSession = d;
      setSession(d);
      setSnapshots([]);
      setPaused(false);

      if (String(d.connectionType || mode).toUpperCase() === 'DIRECT') {
        await waitForCameraPreview();
        await startDirectBrowserRecording({ mainDeviceId: selection.directDeviceId, pipDeviceId: selection.directDeviceId2 });
      } else {
        setLiveUrl(d.liveUrl || '');
      }

      operationRef.current = 'recording';
      message.success(`Bắt đầu quay clip kiểm hàng hoàn: ${order.OrderCode}`);
    } catch (e) {
      operationRef.current = 'idle';
      cleanupDirect(); cleanupHls();
      setLiveUrl(''); setSession(null); setDirectState('idle');
      if (createdSession?.sessionId) {
        try { await cancelPacking(createdSession.sessionId); } catch { }
      }
      message.error(e.response?.data?.message || e.message || 'Không thể bắt đầu quay clip hàng hoàn');
    } finally {
      setBusy(false);
    }
  }

  async function stopDirectAndUpload() {
    let pending = pendingDirectUploadRef.current;
    if (!pending) {
      const recorder = recorderRef.current;
      if (!recorder) throw new Error('Chưa có MediaRecorder');
      const recorder2 = recorderRef2.current;
      const stopToBlob = (target, chunks) => new Promise((resolve, reject) => {
        if (!target) return resolve(null);
        const buildBlob = () => resolve(new Blob(chunks, { type: target.mimeType || 'video/webm' }));
        if (target.state === 'inactive') return buildBlob();
        target.addEventListener('stop', buildBlob, { once: true });
        target.addEventListener('error', e => reject(e.error || new Error('Không thể hoàn tất file video')), { once: true });
        target.stop();
      });
      let blob, camera2Blob;
      try {
        [blob, camera2Blob] = await Promise.all([
          stopToBlob(recorder, chunksRef.current),
          stopToBlob(recorder2, chunksRef2.current)
        ]);
      } catch (e) {
        cleanupDirect();
        throw e;
      }
      cleanupDirect();
      if (!blob?.size) throw new Error('Video ghép không có dữ liệu');
      const duration = Math.round((Date.now() - startedAtRef.current) / 1000);
      pending = { sessionId: session.sessionId, blob, camera2Blob, duration };
      pendingDirectUploadRef.current = pending;
    }
    setDirectState('uploading');
    const result = await completeDirectPacking(session.sessionId, pending.blob, pending.duration, pending.camera2Blob);
    pendingDirectUploadRef.current = null;
    return result;
  }

  // Hoàn tất clip kiểm hàng hoàn
  async function completeReturnRecording() {
    if (!session) return;
    operationRef.current = 'completing';
    setBusy(true);
    try {
      const mode = String(session.connectionType || connectionType).toUpperCase();
      let res;
      if (mode === 'DIRECT') res = await stopDirectAndUpload();
      else res = await completePacking(session.sessionId);
      message.success('Đã hoàn tất và lưu video kiểm hàng hoàn!');
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        try { await exit?.call(document); } catch { }
      }
      cleanupDirect();
      cleanupHls();
      setLiveUrl('');
      setSession(prev => ({ ...(prev || {}), completed: res }));
      setSnapshots([]);
      setPaused(false);
      setDirectState('idle');
      pendingDirectUploadRef.current = null;
      operationRef.current = 'idle';
      if (order?.OrderCode) {
        getOrder(order.OrderCode).then(fresh => fresh && setOrder(fresh)).catch(() => {});
      }
      setTimeout(() => scanInputRef.current?.focus(), 80);
    } catch (e) {
      operationRef.current = 'recording';
      message.error(e.response?.data?.message || e.message);
    } finally {
      setBusy(false);
    }
  }

  // Mở modal xác nhận ERP & đồng bộ thông tin mới nhất từ backend/ERP
  async function openErpModal() {
    if (!order?.OrderCode) return;
    try {
      const fresh = await getOrder(order.OrderCode);
      if (fresh) {
        setOrder(fresh);
        setCustomOid(fresh.ErpOid ? String(fresh.ErpOid) : (fresh.Id_Sapo ? String(fresh.Id_Sapo) : ''));
        setCustomOrderNo(fresh.ErpOrderNo ? String(fresh.ErpOrderNo) : String(fresh.OrderCode));
        setCustomLoaiDonHang(fresh.LoaiDonHang ? String(fresh.LoaiDonHang) : 'SALE_ORDER');
      }
    } catch {
      setCustomOid(order.ErpOid ? String(order.ErpOid) : (order.Id_Sapo ? String(order.Id_Sapo) : ''));
      setCustomOrderNo(order.ErpOrderNo ? String(order.ErpOrderNo) : String(order.OrderCode));
      setCustomLoaiDonHang(order.LoaiDonHang ? String(order.LoaiDonHang) : 'SALE_ORDER');
    }
    setErpModalOpen(true);
  }

  // Thực hiện gọi API xử lý luồng ERP
  async function handleExecuteERP() {
    if (!order?.OrderCode) return;
    setErpProcessing(true);
    try {
      const checkedItems = (order.items || []).filter(it => Number(it.QtyPacked || 0) > 0);
      let listPO = checkedItems.map(it => `${it.Barcode || it.SKU}:${Number(it.QtyPacked)}`).join(',');
      if (!listPO) {
        // Fallback: nếu chưa quét kiểm từng cái thì dùng số lượng kỳ vọng của đơn
        listPO = (order.items || []).map(it => `${it.Barcode || it.SKU}:${Number(it.QtyExpected || 1)}`).join(',');
      }
      const res = await processReturnERP(order.OrderCode, {
        oid: customOid || order.ErpOid || order.Id_Sapo,
        orderNo: customOrderNo || order.ErpOrderNo || order.OrderCode,
        listPO,
        loaiDonHang: customLoaiDonHang || order.LoaiDonHang || 'SALE_ORDER'
      });
      setErpResult(res);
      setErpModalOpen(false);
      message.success(res.message || 'Xử lý luồng ERP thành công!');
      getOrder(order.OrderCode).then(fresh => fresh && setOrder(fresh)).catch(() => {});
    } catch (e) {
      const errMsg = e.response?.data?.message || e.message;
      setErpResult({ ok: false, message: errMsg, params: e.response?.data?.params });
      message.error(errMsg);
    } finally {
      setErpProcessing(false);
    }
  }

  // Tạm dừng / Quay tiếp
  async function togglePause() {
    if (!session) return;
    try {
      if (!paused) {
        if (recorderRef.current?.state === 'recording') recorderRef.current.pause();
        if (recorderRef2.current?.state === 'recording') recorderRef2.current.pause();
        await pausePacking(session.sessionId);
        setPaused(true);
        message.info('Đã tạm dừng quay');
      } else {
        if (recorderRef.current?.state === 'paused') recorderRef.current.resume();
        if (recorderRef2.current?.state === 'paused') recorderRef2.current.resume();
        await resumePacking(session.sessionId);
        setPaused(false);
        message.success('Đã tiếp tục quay');
      }
    } catch (e) {
      message.error(e.response?.data?.message || e.message);
    }
  }

  // Chụp hình snapshot
  function captureDirectFrame() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) throw new Error('Chưa có hình camera để chụp');
    const canvas = document.createElement('canvas');
    const maxW = 1920;
    const scale = Math.min(1, maxW / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d').drawImage(video, 0, 0, video.videoWidth, video.videoHeight, 0, 0, canvas.width, canvas.height);
    return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  }

  async function snapshot() {
    if (!session) return message.warning('Chưa bắt đầu phiên quay');
    try {
      const mode = String(session.connectionType || connectionType).toUpperCase();
      let r;
      if (mode === 'DIRECT') {
        const blob = await captureDirectFrame();
        r = await uploadSnapshot(session.sessionId, blob);
      } else {
        r = await captureRtspSnapshot(session.sessionId);
      }
      setSnapshots(prev => [...prev, r]);
      message.success('Đã chụp ảnh bằng chứng kiện hàng hoàn');
    } catch (e) {
      message.error(e.response?.data?.message || e.message);
    }
  }

  // Quét barcode kiểm sản phẩm (tự động phân giải barcode sang SKU đúng qua API ERP)
  async function scanItem() {
    if (!order) return message.warning('Chưa có đơn hàng');
    const bc = productBarcode.trim();
    if (!bc) return message.warning('Chưa nhập barcode sản phẩm');

    setProductScanning(true);
    try {
      // 1. Gọi API Novelty_GetSKU để lấy SKU đúng từ barcode
      let targetSku = bc;
      try {
        const resolved = await resolveSku(bc);
        if (resolved?.ok && resolved.sku) {
          targetSku = resolved.sku;
          setProductBarcode(targetSku); // Cập nhật lại text trên ô input để nhân viên thấy đúng SKU thực tế
        }
      } catch (err) {
        console.warn('Lỗi phân giải SKU từ barcode:', err);
      }

      // 2. Gọi scanProduct với SKU đúng vừa lấy được
      const r = await scanProduct(order.OrderCode, targetSku);
      setOrder(r.order);
      setProductBarcode('');
      message.success(r.message || `Đã kiểm tra sản phẩm (${targetSku})`);
    } catch (e) {
      message.error(e.response?.data?.message || `Barcode / SKU "${bc}" không thuộc đơn hàng`);
    } finally {
      setProductScanning(false);
    }
  }

  async function passAll() {
    if (!order) return message.warning('Chưa có đơn hàng');
    const r = await passAllItems(order.OrderCode);
    setOrder(r.order);
    message.success('Đã xác nhận đủ tất cả sản phẩm của đơn');
  }

  async function togglePreviewFullscreen(targetRef) {
    try {
      const activeElement = document.fullscreenElement || document.webkitFullscreenElement;
      if (activeElement) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        await exit?.call(document);
        return;
      }
      const target = targetRef.current;
      const request = target?.requestFullscreen || target?.webkitRequestFullscreen;
      await request?.call(target);
    } catch (e) {
      message.error(e.message || 'Không thể bật toàn màn hình');
    }
  }

  function resetNewInspection() {
    cleanupDirect();
    cleanupHls();
    setOrder(null);
    setCurrentReturnTracking('');
    setReturnTrackingInput('');
    setReturnReason('');
    setProductBarcode('');
    setSession(null);
    setLiveUrl('');
    setSnapshots([]);
    setPaused(false);
    setDirectState('idle');
    setErpProcessing(false);
    setErpResult(null);
    setErpModalOpen(false);
    operationRef.current = 'idle';
    setTimeout(() => scanInputRef.current?.focus(), 80);
  }

  return (
    <div className="returnPackingLayout">
      {/* CỘT TRÁI: Scanner + Thông tin Đơn hàng & Sản phẩm */}
      <div className="returnPackingCol leftCol">
        {/* 1. Thẻ quét mã vận đơn hoàn */}
        <Card className="hero3d returnHero">
          <div className="orb returnOrb" />
          <div className="heroBrand">
            <img src="/nbc-logo.png" alt="NBC" />
            <span style={{ color: '#ff7a45', fontWeight: 800 }}>HÀNG HOÀN TRẢ SÀN TMĐT</span>
          </div>
          <h1>Kiểm tra & Quay Clip Đơn Hàng Hoàn</h1>
          <p>
            Quét barcode đơn vận hàng hoàn → Map chọn đơn hàng gốc đã gửi → Quay video unboxing mở hộp kiểm tra.
            <br />
            Nhân viên thực hiện: <b>{user.fullName}</b>
          </p>

          <Space.Compact className="scanInput" style={{ marginTop: 16 }}>
            <Input
              ref={scanInputRef}
              autoFocus
              disabled={busy || Boolean(session)}
              value={returnTrackingInput}
              onChange={e => setReturnTrackingInput(e.target.value)}
              onPressEnter={handleScanReturnTracking}
              placeholder="Quét hoặc nhập mã vận đơn hàng hoàn (SPX, J&T, NinjaVan...)"
              prefix={<QrcodeOutlined style={{ color: '#fa8c16', fontSize: 18 }} />}
              size="large"
            />
            <Button
              type="primary"
              size="large"
              style={{ backgroundColor: '#fa8c16', borderColor: '#fa8c16', fontWeight: 700 }}
              loading={busy}
              disabled={Boolean(session)}
              onClick={handleScanReturnTracking}
              icon={<SearchOutlined />}
            >
              Quét & Tìm đơn
            </Button>
          </Space.Compact>
        </Card>

        {/* 2. Thẻ thông tin đơn hàng & Vận đơn hoàn */}
        {order ? (
          <Card
            className="glass returnOrderInfoCard"
            title={
              <Space wrap align="center">
                <QrcodeOutlined style={{ color: '#fa8c16' }} />
                <span>Đơn hàng: <b>{order.OrderCode}</b></span>
                {order.Id_Sapo && (
                  <Tag color="geekblue" style={{ fontWeight: 600 }}>
                    ID Sapo: <b>{order.Id_Sapo}</b>
                  </Tag>
                )}
                <Tag color="cyan">{order.Channel || 'TMĐT'}</Tag>
                <Tag color={order.Status === 'RETURN_CHECKED' ? 'green' : 'orange'}>{order.Status}</Tag>
              </Space>
            }
            extra={
              !session && (
                <Space wrap>
                  <Button
                    size="small"
                    icon={<UndoOutlined />}
                    onClick={() => {
                      setSearchOrderQuery('');
                      setSearchOrderResults([]);
                      setMapModalOpen(true);
                    }}
                  >
                    Đổi đơn khác
                  </Button>
                  <Button size="small" danger onClick={resetNewInspection}>
                    Xóa làm lại
                  </Button>
                </Space>
              )
            }
          >
            {/* Banner Vận đơn hoàn nổi bật bên trong thẻ */}
            <div className="returnTrackingBanner">
              <Space wrap align="center">
                <Tag color="volcano" className="bigReturnTag">
                  <RollbackOutlined /> VẬN ĐƠN HOÀN: <b>{currentReturnTracking || order.ReturnTrackingNumber}</b>
                </Tag>
                {order.TrackingNumbers && (
                  <span className="origTrackingText">
                    Vận đơn gốc: <b>{order.TrackingNumbers}</b>
                  </span>
                )}
              </Space>
            </div>

            <Row gutter={[16, 12]} style={{ marginTop: 14 }}>
              <Col xs={12} sm={8}>
                <Statistic title="Khách hàng" value={order.CustomerName || '-'} />
              </Col>
              <Col xs={12} sm={8}>
                <Statistic title="Số điện thoại" value={order.Phone || '-'} />
              </Col>
              <Col xs={12} sm={8}>
                <Statistic
                  title="ID Sapo"
                  value={order.Id_Sapo || '-'}
                  styles={{ content: { color: order.Id_Sapo ? '#74f7ff' : '#8fa6b8', fontWeight: 600, fontFamily: 'monospace' } }}
                />
              </Col>
              <Col xs={12} sm={8}>
                <Statistic title="Ngày tạo đơn" value={order.CreatedAt ? dayjs(order.CreatedAt).format('DD/MM/YYYY HH:mm') : '-'} />
              </Col>
              <Col xs={12} sm={8}>
                <Statistic title="Kênh bán" value={order.Channel || 'TMĐT'} />
              </Col>
              <Col xs={12} sm={8}>
                <Statistic title="Số dòng sản phẩm" value={`${order.items?.length || 0} sản phẩm`} />
              </Col>
            </Row>

            {order.Address && (
              <div className="returnAddressText">
                <b>Địa chỉ nhận gốc:</b> {order.Address}
              </div>
            )}
          </Card>
        ) : (
          <Card className="glass returnEmptyCard">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <span style={{ color: '#9bc3d6', fontSize: 14 }}>
                  Quét mã barcode vận đơn hoàn trả ở trên để nạp thông tin đơn hàng và đối soát unboxing.
                </span>
              }
            />
          </Card>
        )}

        {/* 3. Thẻ kiểm tra sản phẩm trong gói hoàn */}
        {order && (
          <Card
            className="glass returnProductCard"
            title="Kiểm tra tình trạng sản phẩm hoàn về"
            extra={
              <Tag color={order.items?.every(x => Number(x.QtyPacked || 0) >= Number(x.QtyExpected || 0)) ? 'green' : 'orange'}>
                {order.items?.every(x => Number(x.QtyPacked || 0) >= Number(x.QtyExpected || 0)) ? 'ĐỦ HÀNG / PASS' : 'ĐANG ĐỐI SOÁT'}
              </Tag>
            }
          >
            <Space.Compact className="scanInput productScanInput" style={{ marginBottom: 12, width: '100%' }}>
              <Input
                value={productBarcode}
                onChange={e => setProductBarcode(e.target.value)}
                onPressEnter={scanItem}
                disabled={productScanning}
                placeholder={productScanning ? "Đang tra cứu SKU..." : "Quét Barcode / SKU sản phẩm lấy ra từ hộp hoàn"}
                prefix={<QrcodeOutlined style={{ color: '#fa8c16' }} />}
                className="returnProductInput"
              />
              <Button
                type="primary"
                onClick={scanItem}
                loading={productScanning}
                icon={<CheckCircleOutlined />}
                style={{ backgroundColor: '#fa8c16', borderColor: '#fa8c16' }}
              >
                Cộng SL
              </Button>
              <Button onClick={passAll} icon={<CheckCircleOutlined />}>
                Đủ hàng
              </Button>
            </Space.Compact>

            <Table
              size="small"
              pagination={false}
              rowKey="OrderItemId"
              dataSource={order.items || []}
              scroll={{ x: 600 }}
              columns={[
                { title: 'Barcode / SKU', render: (_, r) => <span className="mono">{r.Barcode || r.SKU}</span> },
                { title: 'Sản phẩm', dataIndex: 'ProductName' },
                { title: 'SL gửi', dataIndex: 'QtyExpected', align: 'center', width: 80 },
                {
                  title: 'SL kiểm',
                  align: 'center',
                  width: 90,
                  render: (_, r) => <b>{Number(r.QtyPacked || 0)} / {Number(r.QtyExpected || 0)}</b>
                },
                {
                  title: 'Trạng thái',
                  align: 'center',
                  width: 100,
                  render: (_, r) => (
                    <Tag color={Number(r.QtyPacked || 0) >= Number(r.QtyExpected || 0) ? 'green' : 'orange'}>
                      {Number(r.QtyPacked || 0) >= Number(r.QtyExpected || 0) ? 'PASS' : 'CHƯA ĐỦ'}
                    </Tag>
                  )
                }
              ]}
            />
          </Card>
        )}
      </div>

      {/* CỘT PHẢI: Camera quay clip mở hộp unboxing + Điều khiển */}
      <div className="returnPackingCol rightCol">
        <Card
          className="glass returnCameraCard"
          title={
            <Space>
              <CameraOutlined style={{ color: '#fa8c16' }} />
              <span>Camera quay clip kiểm tra mở hộp</span>
            </Space>
          }
          extra={<Tag color={connectionType === 'DIRECT' ? 'purple' : 'cyan'}>{connectionType}</Tag>}
        >
          <div className="dualCameraChooser" style={{ marginBottom: 12 }}>
            <div>
              <label>Camera 1 - toàn cảnh bàn</label>
              <Select
                value={cameraId}
                onChange={value => { setCameraId(value); if (value === cameraId2) setCameraId2(undefined); }}
                style={{ width: '100%' }}
                options={cams.map(c => ({ value: c.CameraId, label: `${c.CameraName} - ${c.CameraCode} [${c.ConnectionType || 'RTSP'}]` }))}
              />
            </div>
            <div>
              <label>Camera 2 - góc gần / PIP cận cảnh</label>
              <Select
                allowClear
                disabled={connectionType !== 'RTSP'}
                value={connectionType === 'RTSP' ? cameraId2 : undefined}
                onChange={setCameraId2}
                placeholder={connectionType === 'RTSP' ? 'Chọn camera góc gần' : 'Chọn trong webcam'}
                style={{ width: '100%' }}
                options={rtspCameras.filter(c => c.CameraId !== cameraId).map(c => ({ value: c.CameraId, label: `${c.CameraName} - ${c.CameraCode}` }))}
              />
            </div>
          </div>

          {connectionType === 'DIRECT' ? (
            <>
              <div className="deviceChooser dualDirectDeviceChooser">
                <div>
                  <label>Webcam 1 - toàn cảnh</label>
                  <Select
                    value={directDeviceId || undefined}
                    onChange={value => { setDirectDeviceId(value); if (value === directDeviceId2) setDirectDeviceId2(''); }}
                    placeholder="Chọn camera toàn cảnh"
                    style={{ width: '100%' }}
                    options={directDevices.map((d, i) => ({ value: d.deviceId, label: d.label || `Camera ${i + 1}` }))}
                  />
                </div>
                <div>
                  <label>Webcam 2 - góc gần / PIP</label>
                  <Select
                    allowClear
                    value={directDeviceId2 || undefined}
                    onChange={value => setDirectDeviceId2(value || '')}
                    placeholder="Chọn camera góc gần"
                    style={{ width: '100%' }}
                    options={directDevices.filter(d => d.deviceId !== directDeviceId).map((d, i) => ({ value: d.deviceId, label: d.label || `Camera phụ ${i + 1}` }))}
                  />
                </div>
                <Button onClick={() => refreshDirectDevices(true)}>Quét lại camera</Button>
              </div>

              <div className="directPreview" ref={directPreviewRef}>
                <video ref={videoRef} autoPlay playsInline muted />
                {directDeviceId2 && directState !== 'idle' && (
                  <video className="pipPreviewVideo" ref={videoRef2} autoPlay playsInline muted />
                )}
                <Button
                  className="previewFullscreenButton"
                  shape="circle"
                  type="primary"
                  aria-label={isFullscreen ? 'Thoát toàn màn hình' : 'Xem toàn màn hình'}
                  title={isFullscreen ? 'Thoát toàn màn hình' : 'Xem toàn màn hình'}
                  icon={isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
                  onClick={() => togglePreviewFullscreen(directPreviewRef)}
                />
                {directState === 'idle' && <span>Preview sẽ hiện khi bấm bắt đầu quay clip</span>}
              </div>
            </>
          ) : (
            <div className="rtspLivePreview" ref={rtspPreviewRef}>
              {liveUrl ? (
                <video ref={liveVideoRef} autoPlay playsInline muted controls />
              ) : (
                <div className="cameraPreview">
                  <VideoCameraOutlined />
                  <span>Preview RTSP sẽ hiện khi bắt đầu quay. URL: <b>{selectedCam?.RtspUrl ? 'Đã khai báo' : 'Chưa khai báo'}</b></span>
                </div>
              )}
              <Button
                className="previewFullscreenButton"
                shape="circle"
                type="primary"
                aria-label={isFullscreen ? 'Thoát toàn màn hình' : 'Xem toàn màn hình'}
                title={isFullscreen ? 'Thoát toàn màn hình' : 'Xem toàn màn hình'}
                icon={isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
                onClick={() => togglePreviewFullscreen(rtspPreviewRef)}
              />
            </div>
          )}

          {/* Nút bắt đầu quay */}
          {!session && order && (
            <Button
              block
              size="large"
              type="primary"
              className="returnStartRecordBtn"
              loading={busy}
              onClick={startReturnRecording}
              icon={<VideoCameraOutlined />}
            >
              Bắt đầu quay clip kiểm tra hàng hoàn
            </Button>
          )}

          {/* Nút điều khiển khi đang quay */}
          {session && !session.completed && (
            <div className="recordActions" style={{ marginTop: 14 }}>
              <Button
                size="large"
                disabled={directState === 'uploading'}
                onClick={togglePause}
                icon={paused ? <PlayCircleOutlined /> : <PauseCircleOutlined />}
              >
                {paused ? 'Quay tiếp' : 'Tạm dừng'}
              </Button>
              <Button
                size="large"
                disabled={directState === 'uploading'}
                onClick={snapshot}
                icon={<PictureOutlined />}
                style={{ borderColor: '#fa8c16', color: '#fa8c16', fontWeight: 600 }}
              >
                Chụp hình bằng chứng
              </Button>
              <Button
                size="large"
                danger
                loading={busy}
                onClick={completeReturnRecording}
                icon={<CheckCircleOutlined />}
              >
                {connectionType === 'DIRECT'
                  ? (directState === 'uploading' ? 'Đang tải lên video...' : 'Hoàn tất & upload clip')
                  : 'Hoàn tất & lưu clip'}
              </Button>
            </div>
          )}

          {/* Dải ảnh snapshot đã chụp */}
          {snapshots.length > 0 && (
            <div className="snapshotStrip" style={{ marginTop: 12 }}>
              {snapshots.slice(-5).map((x, i) => (
                <img key={i} src={`${API_BASE}${x.imageUrl}`} alt="snapshot" />
              ))}
              <span>{snapshots.length} ảnh bằng chứng đã chụp</span>
            </div>
          )}

          {/* Video đã lưu & Xử lý luồng ERP */}
          {session?.completed && (
            <div style={{
              marginTop: 16,
              padding: '18px 20px',
              background: 'linear-gradient(145deg, rgba(4, 25, 45, 0.95), rgba(6, 18, 32, 0.98))',
              border: '1px solid rgba(19, 166, 95, 0.45)',
              borderRadius: 16,
              boxShadow: '0 12px 36px rgba(0,0,0,0.5), 0 0 24px rgba(19, 166, 95, 0.15)',
              color: '#eaffff'
            }}>
              {/* Tiêu đề trạng thái hoàn tất */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <div style={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  background: 'rgba(82, 196, 26, 0.15)',
                  border: '1px solid rgba(82, 196, 26, 0.5)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}>
                  <CheckCircleFilled style={{ color: '#52c41a', fontSize: 24 }} />
                </div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#ffffff', letterSpacing: '0.02em' }}>
                    Đã hoàn tất và lưu clip kiểm tra hàng hoàn!
                  </div>
                  <div style={{ fontSize: 12, color: '#90b4ce', marginTop: 2 }}>
                    Đơn hàng: <b style={{ color: '#00e5ff' }}>{order?.OrderCode}</b> • Vận đơn hoàn: <b style={{ color: '#fa8c16' }}>{currentReturnTracking || order?.ReturnTrackingNumber || '-'}</b>
                  </div>
                </div>
              </div>

              {/* Danh sách link video đã quay */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {session.completed.videoUrl && (
                  <a
                    href={`${API_BASE}${session.completed.videoUrl}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 14px',
                      background: 'rgba(0, 229, 255, 0.08)',
                      border: '1px solid rgba(0, 229, 255, 0.28)',
                      borderRadius: 10,
                      color: '#e6fffb',
                      textDecoration: 'none',
                      transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(0, 229, 255, 0.16)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(0, 229, 255, 0.08)'}
                  >
                    <Space>
                      <PlayCircleOutlined style={{ color: '#00e5ff', fontSize: 18 }} />
                      <span style={{ fontSize: 13, fontWeight: 600 }}>
                        Mở video ghép đã lưu: <span style={{ color: '#85f7ff' }}>{session.completed.fileName}</span>
                      </span>
                    </Space>
                    <Tag color="cyan" style={{ margin: 0, fontWeight: 600 }}>Xem clip</Tag>
                  </a>
                )}

                {session.completed.video2Url && (
                  <a
                    href={`${API_BASE}${session.completed.video2Url}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 14px',
                      background: 'rgba(124, 77, 255, 0.08)',
                      border: '1px solid rgba(124, 77, 255, 0.28)',
                      borderRadius: 10,
                      color: '#f9f0ff',
                      textDecoration: 'none',
                      transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(124, 77, 255, 0.16)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(124, 77, 255, 0.08)'}
                  >
                    <Space>
                      <VideoCameraOutlined style={{ color: '#b37feb', fontSize: 18 }} />
                      <span style={{ fontSize: 13, fontWeight: 600 }}>
                        Mở Camera 2 chất lượng gốc: <span style={{ color: '#d3adf7' }}>{session.completed.fileName2}</span>
                      </span>
                    </Space>
                    <Tag color="purple" style={{ margin: 0, fontWeight: 600 }}>Camera 2 gốc</Tag>
                  </a>
                )}
              </div>

              {/* Khối Xử lý luồng ERP */}
              <div style={{
                padding: '14px 16px',
                background: 'linear-gradient(135deg, rgba(0, 103, 177, 0.25), rgba(4, 38, 70, 0.35))',
                border: '1px solid rgba(0, 209, 255, 0.35)',
                borderRadius: 12,
                marginBottom: 16
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                  <Space align="center" size={12}>
                    <div style={{
                      width: 36,
                      height: 36,
                      borderRadius: 8,
                      background: 'rgba(0, 229, 255, 0.15)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      <CloudSyncOutlined style={{ fontSize: 20, color: '#00e5ff' }} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 800, color: '#ffffff', fontSize: 14 }}>
                        Xử lý luồng ERP (Hủy đơn hàng hoàn)
                      </div>
                      <div style={{ fontSize: 12, color: '#8ecae6', marginTop: 2 }}>
                        API ERP: <span style={{ color: '#74f7ff', fontFamily: 'monospace' }}>SAPO_HuyDonHang_HangHoan</span>
                      </div>
                    </div>
                  </Space>

                  <Button
                    type="primary"
                    size="large"
                    icon={<CloudSyncOutlined />}
                    loading={erpProcessing}
                    style={{
                      background: erpResult?.ok
                        ? 'linear-gradient(135deg, #389e0d, #52c41a)'
                        : 'linear-gradient(135deg, #0077b6, #00b4d8)',
                      borderColor: erpResult?.ok ? '#52c41a' : '#00b4d8',
                      fontWeight: 700,
                      height: 42,
                      padding: '0 20px',
                      borderRadius: 10,
                      boxShadow: '0 4px 14px rgba(0, 180, 216, 0.3)'
                    }}
                    onClick={openErpModal}
                  >
                    {erpResult?.ok ? 'Đã gửi ERP (Bấm để gửi lại)' : 'Xử lý luồng ERP'}
                  </Button>
                </div>

                {/* Kết quả ERP nếu có */}
                {erpResult && (
                  <div style={{
                    marginTop: 12,
                    padding: '10px 14px',
                    borderRadius: 8,
                    background: erpResult.ok ? 'rgba(82, 196, 26, 0.12)' : 'rgba(255, 77, 79, 0.12)',
                    border: erpResult.ok ? '1px solid rgba(82, 196, 26, 0.4)' : '1px solid rgba(255, 77, 79, 0.4)'
                  }}>
                    <div style={{
                      fontWeight: 700,
                      color: erpResult.ok ? '#52c41a' : '#ff4d4f',
                      fontSize: 13,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6
                    }}>
                      {erpResult.ok ? <CheckCircleFilled /> : '⚠️'}
                      <span>{erpResult.ok ? 'Xử lý luồng ERP thành công!' : 'Lỗi phản hồi từ ERP:'}</span>
                    </div>
                    <div style={{ fontSize: 13, color: '#ffffff', marginTop: 4, fontWeight: 500 }}>
                      {erpResult.message}
                    </div>
                    {erpResult.params && (
                      <div style={{ fontSize: 11, color: '#90b4ce', marginTop: 6, opacity: 0.9 }}>
                        <span>OID: <b style={{ color: '#fa8c16' }}>{erpResult.params.OID}</b></span> | <span>OrderNo: <b style={{ color: '#00e5ff' }}>{erpResult.params.OrderNo}</b></span> | <span>Loại: <b style={{ color: '#52c41a' }}>{erpResult.params.LoaiDonHang}</b></span>
                        <div style={{ wordBreak: 'break-all', marginTop: 2 }}>ListPO: <code style={{ color: '#a0d911' }}>{erpResult.params.ListPO}</code></div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Nút tiếp tục đơn khác */}
              <Button
                type="primary"
                size="large"
                block
                onClick={resetNewInspection}
                icon={<RollbackOutlined />}
                style={{
                  background: 'linear-gradient(135deg, #13a65f, #0d7a44)',
                  borderColor: '#13a65f',
                  fontWeight: 700,
                  height: 44,
                  borderRadius: 10,
                  fontSize: 15,
                  boxShadow: '0 4px 16px rgba(19, 166, 95, 0.35)'
                }}
              >
                Tiếp tục kiểm đơn hàng hoàn khác
              </Button>
            </div>
          )}
        </Card>
      </div>

      {/* Modal tìm kiếm & map đơn hàng trước khi hoàn */}
      <Modal
        open={mapModalOpen}
        onCancel={() => setMapModalOpen(false)}
        footer={null}
        width={920}
        title={
          <Space>
            <LinkOutlined style={{ color: '#fa8c16' }} />
            <span>Liên kết đơn vận hoàn: <b>{currentReturnTracking}</b> với Đơn hàng gốc</span>
          </Space>
        }
      >
        <p style={{ color: '#aaa', marginBottom: 12 }}>
          Tìm kiếm đơn hàng đã gửi trước đây theo <b>Mã đơn hàng, ID Sapo, Mã vận đơn gốc lúc xuất đi, Số điện thoại hoặc Tên khách hàng</b> để map:
        </p>

        <Space.Compact style={{ width: '100%', marginBottom: 16 }}>
          <Input
            value={searchOrderQuery}
            onChange={e => setSearchOrderQuery(e.target.value)}
            onPressEnter={handleSearchOrders}
            placeholder="Nhập mã đơn, ID Sapo, mã vận đơn gốc, SĐT khách..."
            prefix={<SearchOutlined />}
            autoFocus
          />
          <Button type="primary" loading={searchLoading} onClick={handleSearchOrders}>
            Tìm đơn hàng
          </Button>
        </Space.Compact>

        <Table
          rowKey="OrderId"
          dataSource={searchOrderResults}
          loading={searchLoading}
          pagination={{ pageSize: 5 }}
          scroll={{ x: 880 }}
          locale={{ emptyText: <Empty description="Nhập từ khóa và bấm Tìm đơn hàng" /> }}
          columns={[
            { title: 'Mã đơn', dataIndex: 'OrderCode' },
            {
              title: 'ID Sapo',
              dataIndex: 'Id_Sapo',
              render: v => v ? <span className="mono boldText" style={{ color: '#74f7ff' }}>{v}</span> : '-'
            },
            { title: 'Vận đơn gốc', dataIndex: 'TrackingNumbers', render: v => v || '-' },
            { title: 'Khách hàng', dataIndex: 'CustomerName' },
            { title: 'SĐT', dataIndex: 'Phone' },
            { title: 'Kênh bán', dataIndex: 'Channel' },
            { title: 'Ngày tạo', dataIndex: 'CreatedAt', render: v => v ? dayjs(v).format('DD/MM/YYYY') : '-' },
            { title: 'Trạng thái', dataIndex: 'Status', render: v => <Tag>{v}</Tag> },
            {
              title: 'Thao tác',
              fixed: 'right',
              width: 140,
              render: (_, r) => (
                <Button
                  type="primary"
                  size="small"
                  style={{ backgroundColor: '#fa8c16', borderColor: '#fa8c16', fontWeight: 600 }}
                  loading={mappingLoading && selectedOrderToMap?.OrderId === r.OrderId}
                  onClick={() => {
                    setSelectedOrderToMap(r);
                    confirmMapOrder(r);
                  }}
                >
                  Map đơn này
                </Button>
              )
            }
          ]}
        />
      </Modal>

      {/* Modal Xác nhận xử lý luồng ERP */}
      <Modal
        open={erpModalOpen}
        onCancel={() => !erpProcessing && setErpModalOpen(false)}
        width={680}
        title={
          <Space>
            <CloudSyncOutlined style={{ color: '#13c2c2', fontSize: 20 }} />
            <span>Xác nhận thông tin gửi API ERP - Hàng Hoàn</span>
          </Space>
        }
        footer={[
          <Button key="cancel" disabled={erpProcessing} onClick={() => setErpModalOpen(false)}>
            Đóng
          </Button>,
          <Button
            key="submit"
            type="primary"
            style={{ backgroundColor: '#13c2c2', borderColor: '#13c2c2' }}
            loading={erpProcessing}
            icon={<CloudSyncOutlined />}
            onClick={handleExecuteERP}
          >
            Xác nhận gọi ERP
          </Button>
        ]}
      >
        <div style={{ padding: '8px 0' }}>
          <p style={{ color: '#ccc', marginBottom: 16 }}>
            Hệ thống sẽ gọi API nội bộ Nhà Bè ERP để hủy đơn hàng hoàn Sapo với các tham số sau:
          </p>

          <div style={{ background: 'rgba(0,0,0,0.3)', padding: 14, borderRadius: 8, border: '1px solid #303030' }}>
            <Row gutter={[12, 12]}>
              <Col span={12}>
                <div style={{ fontSize: 12, color: '#888' }}>Mã đơn hàng ERP (OrderNo):</div>
                <Input
                  style={{ width: '100%', marginTop: 4, fontWeight: 700, color: '#13c2c2' }}
                  value={customOrderNo}
                  onChange={e => setCustomOrderNo(e.target.value)}
                  placeholder="Ví dụ: NOV/11/26-1H9/DDH/024"
                />
                <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>Mã sàn / Đơn gốc: {order?.OrderCode || '-'}</div>
              </Col>
              <Col span={12}>
                <div style={{ fontSize: 12, color: '#888' }}>ID ERP (OID):</div>
                <Input
                  style={{ width: '100%', marginTop: 4, fontWeight: 700, color: '#fa8c16' }}
                  value={customOid}
                  onChange={e => setCustomOid(e.target.value)}
                  placeholder="Ví dụ: 1220655"
                />
                <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>ID Sapo: {order?.Id_Sapo || '-'}</div>
              </Col>
              <Col span={12}>
                <div style={{ fontSize: 12, color: '#888' }}>Loại đơn hàng (LoaiDonHang):</div>
                <Input
                  style={{ width: '100%', marginTop: 4 }}
                  value={customLoaiDonHang}
                  onChange={e => setCustomLoaiDonHang(e.target.value)}
                  placeholder="SALE_ORDER hoặc SALE_BILL_SELL"
                />
              </Col>
              <Col span={12}>
                <div style={{ fontSize: 12, color: '#888' }}>Mã vận đơn hoàn:</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginTop: 8 }}>{currentReturnTracking || order?.ReturnTrackingNumber || '-'}</div>
              </Col>
              <Col span={24}>
                <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>
                  Danh sách sản phẩm kiểm nhận (ListPO = [Barcode:SL]):
                </div>
                <div style={{
                  padding: '8px 10px',
                  background: 'rgba(255,255,255,0.05)',
                  borderRadius: 6,
                  fontFamily: 'monospace',
                  fontSize: 13,
                  color: '#a0d911',
                  wordBreak: 'break-all'
                }}>
                  {(() => {
                    const checkedItems = (order?.items || []).filter(x => Number(x.QtyPacked || 0) > 0);
                    return checkedItems.length > 0
                      ? checkedItems.map(x => `${x.Barcode || x.SKU}:${Number(x.QtyPacked)}`).join(',')
                      : (order?.items || []).map(x => `${x.Barcode || x.SKU}:${Number(x.QtyExpected || 1)}`).join(',') || '(Không có sản phẩm)';
                  })()}
                </div>
                {!(order?.items || []).some(x => Number(x.QtyPacked || 0) > 0) && (
                  <div style={{ fontSize: 12, color: '#faad14', marginTop: 4 }}>
                    ⚠️ Chưa có sản phẩm nào được quét kiểm chi tiết (QtyPacked = 0). Hệ thống sẽ dùng số lượng kỳ vọng của đơn (QtyExpected).
                  </div>
                )}
              </Col>
            </Row>
          </div>

          <div style={{ marginTop: 12, fontSize: 12, color: '#888' }}>
            🔗 <i>Endpoint: http://api.nhabe.com.vn:3011/api/Novelty/SAPO_HuyDonHang_HangHoan</i>
          </div>
        </div>
      </Modal>
    </div>
  );
}
