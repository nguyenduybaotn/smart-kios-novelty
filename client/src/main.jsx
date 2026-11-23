import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Alert, Button, Card, Col, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Table, Tabs, Tag, Upload, message, Statistic, Image } from 'antd';
import { CameraOutlined, CheckCircleOutlined, CloudUploadOutlined, DeleteOutlined, DownloadOutlined, EyeOutlined, FullscreenExitOutlined, FullscreenOutlined, LoginOutlined, LogoutOutlined, PlusOutlined, QrcodeOutlined, ReloadOutlined, RollbackOutlined, SearchOutlined, UserOutlined, VideoCameraOutlined, PauseCircleOutlined, PlayCircleOutlined, PictureOutlined } from '@ant-design/icons';
import Hls from 'hls.js';
import dayjs from 'dayjs';
import { API_BASE, addCamera, addUser, cancelPacking, completeDirectPacking, completePacking, deleteCamera, getCameras, getOrder, getOrders, getSessions, getUsers, importOrders, login, saveOrder, startPacking, scanProduct, passAllItems, pausePacking, resumePacking, uploadSnapshot, captureRtspSnapshot, getSnapshots, syncSapoOrders } from './services/api';
import CameraConfigPage from './pages/CameraConfigPage';
import ReturnPackingPage from './pages/ReturnPackingPage';
import SessionsPage from './pages/SessionsPage';
import { acquireUserMediaStream, enumerateVideoDevices, findSavedVideoDevice, loadCameraConfig } from './services/camera-config';
import './styles/app.css';

const formatDateTime = value => value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-';
const firstTrackingNumber = row => String(row?.ReturnTrackingNumber || row?.OrderReturnTrackingNumber || row?.TrackingNumbers || row?.OrderCode || row?.SessionId || 'video')
  .split(',').map(value => value.trim()).find(Boolean) || 'video';
const videoDownloadUrl = (row, fileName, source = 'main') => {
  const returnTracking = row?.ReturnTrackingNumber || row?.OrderReturnTrackingNumber;
  const returnParam = returnTracking ? `&returnTrackingNumber=${encodeURIComponent(returnTracking)}` : '';
  return `${API_BASE}/videos/download/${encodeURIComponent(fileName)}?trackingNumber=${encodeURIComponent(firstTrackingNumber(row))}&source=${source}${returnParam}`;
};

function LoginPage({ onLogin }) {
  const [loading, setLoading] = useState(false);
  async function submit(v) {
    setLoading(true);
    try {
      const r = await login(v);
      localStorage.setItem('vk_token', r.token);
      localStorage.setItem('vk_user', JSON.stringify(r.user));
      onLogin(r.user);
      message.success(`Xin chào ${r.user.fullName}`);
    } catch (e) { message.error(e.response?.data?.message || 'Đăng nhập thất bại'); }
    finally { setLoading(false) }
  }
  return <main className="loginWrap"><Card className="glass loginCard"><div className="brandLogin"><img src="/nbc-logo.png" alt="NBC" /><div className="loginLogo">VISION AI KIOSK</div></div><p>Đăng nhập để ghi nhận nhân viên đóng hàng và quản lý video.</p><Form layout="vertical" onFinish={submit} initialValues={{ username: 'admin', password: '123456' }}><Form.Item name="username" label="Tài khoản" rules={[{ required: true }]}><Input prefix={<UserOutlined />} /></Form.Item><Form.Item name="password" label="Mật khẩu" rules={[{ required: true }]}><Input.Password /></Form.Item><Button block size="large" type="primary" htmlType="submit" loading={loading} icon={<LoginOutlined />}>Đăng nhập</Button></Form><div className="hint">Demo: admin / 123456 hoặc packer01 / 123456</div></Card></main>;
}

function OrderCard({ order }) {
  if (!order) return <Card className="glass empty">Quét mã vận đơn hoặc nhập mã đơn hàng để bắt đầu.</Card>;
  const total = order.items?.reduce((s, x) => s + (Number(x.QtyExpected) * Number(x.UnitPrice || 0)), 0) || 0;
  return (
    <Card
      className="glass"
      title={<><QrcodeOutlined /> Đơn hàng {order.OrderCode}</>}
      extra={
        <Space>
          {order.Id_Sapo && <Tag color="geekblue" style={{ fontWeight: 600 }}>ID Sapo: {order.Id_Sapo}</Tag>}
          <Tag color="cyan">{order.Status}</Tag>
        </Space>
      }
    >
      <Row gutter={[12, 12]}>
        <Col span={8}><Statistic title="Khách hàng" value={order.CustomerName || '-'} /></Col>
        <Col span={8}><Statistic title="SĐT" value={order.Phone || '-'} /></Col>
        <Col span={8}>
          <Statistic
            title="ID Sapo"
            value={order.Id_Sapo || '-'}
            styles={{ content: { color: order.Id_Sapo ? '#74f7ff' : '#8fa6b8', fontWeight: 600, fontFamily: 'monospace' } }}
          />
        </Col>
      </Row>
      <Table
        size="small"
        pagination={false}
        rowKey="OrderItemId"
        dataSource={order.items || []}
        columns={[
          { title: 'SKU', dataIndex: 'SKU' },
          { title: 'Sản phẩm', dataIndex: 'ProductName' },
          { title: 'SL', dataIndex: 'QtyExpected', align: 'center' },
          { title: 'Đơn giá', dataIndex: 'UnitPrice', render: v => Number(v || 0).toLocaleString('vi-VN') }
        ]}
      />
      <div className="total">Tổng tạm tính: {total.toLocaleString('vi-VN')} đ</div>
    </Card>
  );
}

function getBestMime() {
  if (window.MediaRecorder?.isTypeSupported?.('video/mp4;codecs=avc1')) return 'video/mp4;codecs=avc1';
  if (window.MediaRecorder?.isTypeSupported?.('video/mp4;codecs=h264')) return 'video/mp4;codecs=h264';
  if (window.MediaRecorder?.isTypeSupported?.('video/mp4')) return 'video/mp4';
  if (window.MediaRecorder?.isTypeSupported?.('video/webm;codecs=h264')) return 'video/webm;codecs=h264';
  if (window.MediaRecorder?.isTypeSupported?.('video/webm;codecs=vp8')) return 'video/webm;codecs=vp8';
  if (window.MediaRecorder?.isTypeSupported?.('video/webm;codecs=vp9')) return 'video/webm;codecs=vp9';
  return 'video/webm';
}

function PackingPage({ user, cameraConfig }) {
  const [code, setCode] = useState('');
  const [order, setOrder] = useState(null);
  const [cams, setCams] = useState([]);
  const [cameraId, setCameraId] = useState();
  const [cameraId2, setCameraId2] = useState();
  const [directDevices, setDirectDevices] = useState([]);
  const [directDeviceId, setDirectDeviceId] = useState('');
  const [directDeviceId2, setDirectDeviceId2] = useState('');
  const [session, setSession] = useState(null);
  const [busy, setBusy] = useState(false);
  const [directState, setDirectState] = useState('idle');
  const [liveUrl, setLiveUrl] = useState('');
  const [productBarcode, setProductBarcode] = useState('');
  const [paused, setPaused] = useState(false);
  const [snapshots, setSnapshots] = useState([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const orderScanInputRef = useRef(null);
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

  useEffect(() => { getCameras().then(setCams).catch(e => message.error(e.response?.data?.message || 'Không tải được danh sách camera')); }, []);
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
  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement || document.webkitFullscreenElement));
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);
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

  async function load(c = code) {
    const lookup = String(c || '').trim();
    if (!lookup) return message.warning('Chưa nhập mã vận đơn');
    if (operationRef.current !== 'idle' || session) return message.warning('Đang quay hoặc xử lý một đơn hàng khác');
    operationRef.current = 'lookup';
    setBusy(true);
    setCode('');
    let loadedOrder = null;
    try {
      cleanupDirect(); cleanupHls();
      setOrder(null); setSession(null); setDirectState('idle'); setLiveUrl(''); setSnapshots([]); setPaused(false);
      loadedOrder = await getOrder(lookup);
      setOrder(loadedOrder);
      const selection = await resolveCameraSelection();
      operationRef.current = 'starting';
      await startForOrder(loadedOrder, selection);
      operationRef.current = 'recording';
      message.success(`Đã quét mã ${lookup} và tự động bắt đầu quay`);
    } catch (e) {
      operationRef.current = 'idle';
      console.error(`[Tự động quay][${lookup}]`, e);
      const reason = e.response?.data?.message || e.message || 'Không tìm thấy đơn hàng';
      message.error(loadedOrder ? `Đã tải đơn nhưng không thể bắt đầu quay: ${reason}` : reason);
      setTimeout(() => orderScanInputRef.current?.focus(), 80);
    } finally { setBusy(false); }
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
    recorder.onerror = e => console.error('[Camera chính] Lỗi MediaRecorder', e.error || e);
    const recorder2 = mediaStreamRef2.current
      ? new MediaRecorder(mediaStreamRef2.current, { mimeType, videoBitsPerSecond: 3_500_000 })
      : null;
    if (recorder2) {
      recorder2.ondataavailable = e => { if (e.data?.size) chunksRef2.current.push(e.data); };
      recorder2.onerror = e => console.error('[Camera 2] Lỗi MediaRecorder chất lượng gốc', e.error || e);
      console.info('[Camera 2] Bắt đầu lưu video gốc (đã tối ưu bitrate)', mediaStreamRef2.current.getVideoTracks?.()[0]?.getSettings?.());
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
        // Camera 2 PIP tỷ lệ 16:9
        const pipW = Math.round(w * 0.36);
        const pipH = Math.round(pipW * 9 / 16);
        const margin = Math.round(w * 0.02);
        
        // Vẽ viền đen nhẹ (bỏ shadowBlur để không ngốn CPU)
        ctx.fillStyle = '#000000';
        ctx.fillRect(w - pipW - margin - 3, margin - 3, pipW + 6, pipH + 6);
        
        drawCover(ctx, pipVideo, w - pipW - margin, margin, pipW, pipH);
        ctx.strokeStyle = 'rgba(255,255,255,.92)';
        ctx.lineWidth = Math.max(2, Math.round(w / 640));
        ctx.strokeRect(w - pipW - margin, margin, pipW, pipH);
      }
      const text = formatVideoTimestamp();
      const fontSize = Math.max(20, Math.round(w / 48));
      ctx.font = `700 ${fontSize}px Arial`;
      const metrics = ctx.measureText(text);
      const tx = 20, ty = 24 + fontSize;
      ctx.fillStyle = 'rgba(0,0,0,.65)';
      ctx.fillRect(tx - 10, ty - fontSize - 8, metrics.width + 20, fontSize + 16);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(text, tx, ty);
    };
    animationRef.current = requestAnimationFrame(draw);
    return canvas.captureStream(25);
  }

  async function startForOrder(targetOrder, selection) {
    let createdSession = null;
    const mode = selection.mode;
    if (mode === 'DIRECT') {
      setDirectState('starting');
      await waitForCameraPreview();
    }
    try {
      const d = await startPacking({
        orderCode: targetOrder.OrderCode,
        cameraId: selection.cameraId,
        cameraId2: mode === 'RTSP' ? selection.cameraId2 : null,
        operatorName: user.fullName
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
      return d;
    } catch (e) {
      cleanupDirect(); cleanupHls();
      setLiveUrl(''); setSession(null); setDirectState('idle');
      if (createdSession?.sessionId) {
        try { await cancelPacking(createdSession.sessionId); }
        catch (cancelError) { console.error(`[Hủy phiên ${createdSession.sessionId}]`, cancelError); }
      }
      throw e;
    }
  }

  async function start() {
    if (!order) return message.warning('Chưa có đơn hàng');
    if (operationRef.current !== 'idle') return message.warning('Hệ thống đang xử lý phiên quay');
    operationRef.current = 'starting';
    setBusy(true);
    try {
      const selection = await resolveCameraSelection();
      await startForOrder(order, selection);
      operationRef.current = 'recording';
      message.success(`Đang quay ${selection.mode === 'DIRECT' ? 'bằng camera trực tiếp' : 'RTSP'} - NV: ${user.fullName}`);
    } catch (e) {
      operationRef.current = 'idle';
      console.error(`[Bắt đầu quay][${order.OrderCode}]`, e);
      message.error(e.response?.data?.message || e.message);
    } finally { setBusy(false) }
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
      if (recorder2 && !camera2Blob?.size) throw new Error('Video gốc Camera 2 không có dữ liệu');
      const duration = Math.round((Date.now() - startedAtRef.current) / 1000);
      pending = { sessionId: session.sessionId, blob, camera2Blob, duration };
      pendingDirectUploadRef.current = pending;
    }
    if (pending.sessionId !== session.sessionId) throw new Error('File video chờ tải lên không thuộc phiên hiện tại');
    setDirectState('uploading');
    const result = await completeDirectPacking(session.sessionId, pending.blob, pending.duration, pending.camera2Blob);
    pendingDirectUploadRef.current = null;
    return result;
  }

  async function done() {
    if (!session) return;
    operationRef.current = 'completing';
    setBusy(true);
    try {
      const mode = String(session.connectionType || connectionType).toUpperCase();
      if (mode === 'DIRECT') await stopDirectAndUpload();
      else await completePacking(session.sessionId);
      message.success('Đã hoàn tất và lưu video');
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        try { await exit?.call(document); } catch { }
      }
      cleanupDirect();
      cleanupHls();
      setLiveUrl('');
      setSession(null);
      setOrder(null);
      setCode('');
      setProductBarcode('');
      setSnapshots([]);
      setPaused(false);
      setDirectState('idle');
      pendingDirectUploadRef.current = null;
      operationRef.current = 'idle';
      setTimeout(() => orderScanInputRef.current?.focus(), 80);
    } catch (e) { operationRef.current = 'recording'; message.error(e.response?.data?.message || e.message); }
    finally { setBusy(false) }
  }

  async function togglePreviewFullscreen(targetRef) {
    try {
      const activeElement = document.fullscreenElement || document.webkitFullscreenElement;
      if (activeElement) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (!exit) throw new Error('Trình duyệt không hỗ trợ thoát toàn màn hình');
        await exit.call(document);
        return;
      }
      const target = targetRef.current;
      const request = target?.requestFullscreen || target?.webkitRequestFullscreen;
      if (!target || !request) throw new Error('Trình duyệt không hỗ trợ toàn màn hình');
      await request.call(target);
    } catch (e) { message.error(e.message || 'Không thể bật toàn màn hình'); }
  }



  async function scanItem() {
    if (!order) return message.warning('Chưa có đơn hàng');
    const bc = productBarcode.trim();
    if (!bc) return message.warning('Chưa nhập barcode sản phẩm');
    try {
      const r = await scanProduct(order.OrderCode, bc);
      setOrder(r.order);
      setProductBarcode('');
      message.success(r.message || 'Đã cộng số lượng kiểm');
    } catch (e) {
      message.error(e.response?.data?.message || 'Barcode không thuộc đơn hàng');
    }
  }

  async function passAll() {
    if (!order) return message.warning('Chưa có đơn hàng');
    const r = await passAllItems(order.OrderCode);
    setOrder(r.order);
    message.success('Đã set tất cả dòng sản phẩm đủ hàng / PASS');
  }

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
        message.success('Đã quay tiếp');
      }
    } catch (e) { message.error(e.response?.data?.message || e.message); }
  }

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
      message.success('Đã chụp và nén hình ảnh');
    } catch (e) { message.error(e.response?.data?.message || e.message); }
  }

  return <div className="pageGrid packingPage">
    <Card className="hero3d"><div className="orb" /><div className="heroBrand"><img src="/nbc-logo.png" alt="NBC" /><span>NHABE CORPORATION</span></div><h1>Vision AI Kiosk POS</h1><p>Quét mã vận đơn → tự động dùng Camera 1 và Camera 2 đã lưu → quay video đóng gói. Nhân viên: <b>{user.fullName}</b></p><Space.Compact className="scanInput"><Input ref={orderScanInputRef} autoFocus disabled={busy || Boolean(session)} value={code} onChange={e => setCode(e.target.value)} onPressEnter={() => load()} placeholder="Quét/nhập mã vận đơn" /><Button type="primary" loading={busy} disabled={Boolean(session)} onClick={() => load()}>Truy xuất & quay</Button></Space.Compact></Card>
    <OrderCard order={order} />
    {order && <Card className="glass" title="Kiểm hàng theo barcode sản phẩm" extra={<Tag color={order.items?.every(x => Number(x.QtyPacked || 0) >= Number(x.QtyExpected || 0)) ? 'green' : 'orange'}>{order.items?.every(x => Number(x.QtyPacked || 0) >= Number(x.QtyExpected || 0)) ? 'PASS' : 'ĐANG KIỂM'}</Tag>}>
      <Space.Compact className="scanInput productScanInput">
        <Input value={productBarcode} onChange={e => setProductBarcode(e.target.value)} onPressEnter={scanItem} placeholder="Quét barcode sản phẩm / SKU trong đơn" autoFocus />
        <Button type="primary" onClick={scanItem} icon={<QrcodeOutlined />}>Cộng SL</Button>
        <Button onClick={passAll} icon={<CheckCircleOutlined />}>Đủ hàng</Button>
      </Space.Compact>
      <Table size="small" pagination={false} rowKey="OrderItemId" dataSource={order.items || []} scroll={{ x: 760 }} columns={[
        { title: 'Barcode/SKU', render: (_, r) => <span className="mono">{r.Barcode || r.SKU}</span> },
        { title: 'Sản phẩm', dataIndex: 'ProductName' },
        { title: 'Đã kiểm', align: 'center', render: (_, r) => <b>{Number(r.QtyPacked || 0)} / {Number(r.QtyExpected || 0)}</b> },
        { title: 'Trạng thái', dataIndex: 'Status', render: (v, r) => <Tag color={Number(r.QtyPacked || 0) >= Number(r.QtyExpected || 0) ? 'green' : 'orange'}>{Number(r.QtyPacked || 0) >= Number(r.QtyExpected || 0) ? 'PASS' : 'CHƯA ĐỦ'}</Tag> }
      ]} />
    </Card>}
    <Card className="glass" title={<><CameraOutlined /> Camera đóng gói</>} extra={<Tag color={connectionType === 'DIRECT' ? 'purple' : 'cyan'}>{connectionType}</Tag>}>
      {!cameraConfig && <Alert className="modeAlert" type="warning" showIcon title="Chưa lưu cấu hình Camera 1 và Camera 2" description="Mở tab Cấu hình camera, chọn đủ hai camera và bấm Lưu cấu hình trước khi quét mã vận đơn." />}
      <div className="dualCameraChooser">
        <div>
          <label>Camera 1 - toàn cảnh</label>
          <Select value={cameraId} onChange={value => { setCameraId(value); if (value === cameraId2) setCameraId2(undefined); }} style={{ width: '100%' }} options={cams.map(c => ({ value: c.CameraId, label: `${c.CameraName} - ${c.CameraCode} [${c.ConnectionType || 'RTSP'}]` }))} />
        </div>
        <div>
          <label>Camera 2 - góc gần / PIP ngang</label>
          <Select
            allowClear
            disabled={connectionType !== 'RTSP'}
            value={connectionType === 'RTSP' ? cameraId2 : undefined}
            onChange={setCameraId2}
            placeholder={connectionType === 'RTSP' ? 'Chọn camera góc gần' : 'Chọn trong danh sách webcam bên dưới'}
            style={{ width: '100%' }}
            options={rtspCameras.filter(c => c.CameraId !== cameraId).map(c => ({ value: c.CameraId, label: `${c.CameraName} - ${c.CameraCode}` }))}
          />
        </div>
      </div>
      {connectionType === 'DIRECT' ? <>
        <Alert className="modeAlert" type="info" showIcon title="Camera trực tiếp / USB camera" description="Hệ thống tự dùng hai webcam đã lưu khi quét mã vận đơn. Muốn đổi camera mặc định, hãy mở tab Cấu hình camera." />
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
          {directDeviceId2 && directState !== 'idle' && <video className="pipPreviewVideo" ref={videoRef2} autoPlay playsInline muted />}
          <Button className="previewFullscreenButton" shape="circle" type="primary" aria-label={isFullscreen ? 'Thoát toàn màn hình' : 'Xem toàn màn hình'} title={isFullscreen ? 'Thoát toàn màn hình' : 'Xem toàn màn hình'} icon={isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />} onClick={() => togglePreviewFullscreen(directPreviewRef)} />
          {directState === 'idle' && <span>Preview sẽ hiện khi bắt đầu quay</span>}
        </div>
      </> : <>
        <Alert className="modeAlert" type="info" showIcon title="Live preview RTSP qua HLS Gateway" description="Sau khi quét mã vận đơn, server tự bắt đầu quay và mở luồng xem trực tiếp quá trình đóng gói trên web." />
        <div className="rtspLivePreview" ref={rtspPreviewRef}>
          {liveUrl ? <video ref={liveVideoRef} autoPlay playsInline muted controls /> : <div className="cameraPreview"><VideoCameraOutlined /><span>Preview RTSP sẽ hiện khi bắt đầu quay. URL: <b>{selectedCam?.RtspUrl ? 'Đã khai báo' : 'Chưa khai báo'}</b></span></div>}
          <Button className="previewFullscreenButton" shape="circle" type="primary" aria-label={isFullscreen ? 'Thoát toàn màn hình' : 'Xem toàn màn hình'} title={isFullscreen ? 'Thoát toàn màn hình' : 'Xem toàn màn hình'} icon={isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />} onClick={() => togglePreviewFullscreen(rtspPreviewRef)} />
        </div>
      </>}
      {!session && order && <Button block size="large" type="primary" loading={busy} onClick={start} icon={<VideoCameraOutlined />}>Thử bắt đầu quay lại</Button>}
      {session && !session.completed && <div className="recordActions">
        <Button size="large" disabled={directState === 'uploading'} onClick={togglePause} icon={paused ? <PlayCircleOutlined /> : <PauseCircleOutlined />}>{paused ? 'Quay tiếp' : 'Tạm dừng'}</Button>
        <Button size="large" disabled={directState === 'uploading'} onClick={snapshot} icon={<PictureOutlined />}>Chụp hình</Button>
        <Button size="large" danger loading={busy} onClick={done} icon={<CheckCircleOutlined />}>{connectionType === 'DIRECT' ? (directState === 'uploading' ? 'Thử upload lại' : 'Hoàn tất & upload video') : 'Hoàn tất & lưu video'}</Button>
      </div>}
      {snapshots.length > 0 && <div className="snapshotStrip">{snapshots.slice(-5).map((x, i) => <img key={i} src={`${API_BASE}${x.imageUrl}`} alt="snapshot" />)}<span>{snapshots.length} ảnh đã chụp</span></div>}
      {session?.completed && <>
        <a className="videoLink" href={`${API_BASE}${session.completed.videoUrl}`} target="_blank" rel="noreferrer">Mở video ghép đã lưu: {session.completed.fileName}</a>
        {session.completed.video2Url && <a className="videoLink" href={`${API_BASE}${session.completed.video2Url}`} target="_blank" rel="noreferrer">Mở Camera 2 chất lượng gốc: {session.completed.fileName2}</a>}
      </>}
    </Card>
  </div>;
}

function OrdersAdmin() {
  const [rows, setRows] = useState([]), [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [detailOpen, setDetailOpen] = useState(false), [detail, setDetail] = useState(null), [detailLoading, setDetailLoading] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false), [syncDate, setSyncDate] = useState(() => new Date().toLocaleDateString('en-CA'));
  const [form] = Form.useForm(), [syncing, setSyncing] = useState(false);
  const refresh = () => getOrders(q).then(setRows);
  useEffect(() => { const t = setTimeout(() => refresh(), 250); return () => clearTimeout(t); }, [q]);
  async function submit(v) { await saveOrder({ ...v, items: [{ sku: v.sku, barcode: v.barcode, productName: v.productName, qtyExpected: v.qtyExpected, unitPrice: v.unitPrice }] }); message.success('Đã lưu đơn hàng'); setOpen(false); refresh(); }
  async function syncSapo() {
    if (!syncDate) return message.warning('Vui lòng chọn ngày đồng bộ');
    setSyncing(true);
    try {
      const r = await syncSapoOrders(syncDate);
      message.success(`Ngày ${syncDate}: tạo mới ${r.created ?? r.success ?? 0}, cập nhật ${r.updated ?? 0}${r.failed ? `, ${r.failed} lỗi` : ''}`);
      setSyncOpen(false);
      refresh();
    } catch (e) { message.error(e.response?.data?.message || 'Đồng bộ Sapo thất bại'); }
    finally { setSyncing(false); }
  }
  async function viewDetail(row) {
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const data = await getOrder(row.OrderCode);
      setDetail(data);
    } catch (e) {
      message.error('Không tải được chi tiết đơn hàng');
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }
  const detailTotal = detail?.items?.reduce((s, x) => s + Number(x.QtyExpected || 0) * Number(x.UnitPrice || 0), 0) || 0;
  return <Card className="glass ordersPage" title="Khai báo đơn hàng" extra={<Space wrap><Button icon={<CloudUploadOutlined />} loading={syncing} onClick={() => setSyncOpen(true)}>Đồng bộ Sapo</Button><Button icon={<ReloadOutlined />} onClick={refresh}>Làm mới</Button><Button icon={<PlusOutlined />} onClick={() => setOpen(true)}>Nhập tay</Button></Space>}>
    <Space style={{ marginBottom: 12, flexWrap: 'wrap' }}>
      <Upload beforeUpload={async f => { const r = await importOrders(f); message.success(`Import ${r.imported} đơn hàng`); refresh(); return false; }} showUploadList={false}><Button icon={<CloudUploadOutlined />}>Import Excel</Button></Upload>
    </Space>
    <Input allowClear prefix={<SearchOutlined />} className="searchBox" value={q} onChange={e => setQ(e.target.value)} placeholder="Tìm mã đơn, ID Sapo, khách hàng, mã vận đơn..." />
    <Table className="neonTable" rowKey="OrderId" dataSource={rows} scroll={{ x: 980 }} columns={[
      { title: 'Mã đơn', dataIndex: 'OrderCode', fixed: 'left' },
      { title: 'ID Sapo', dataIndex: 'Id_Sapo' },
      { title: 'Mã vận đơn', dataIndex: 'TrackingNumbers' },
      { title: 'Ngày tạo', dataIndex: 'CreatedAt', render: formatDateTime },
      { title: 'Khách hàng', dataIndex: 'CustomerName' },
      { title: 'SĐT', dataIndex: 'Phone' },
      { title: 'Kênh', dataIndex: 'Channel' },
      { title: 'Trạng thái', dataIndex: 'Status', render: v => <Tag>{v}</Tag> },
      { title: 'SL dòng', dataIndex: 'ItemCount' },
      { title: 'Tổng SL', dataIndex: 'TotalQty' },
      { title: 'Chi tiết', fixed: 'right', width: 120, render: (_, r) => <Button className="viewOrderBtn" size="small" icon={<EyeOutlined />} onClick={() => viewDetail(r)}>Xem</Button> }
    ]} />
    <Modal open={syncOpen} onCancel={() => !syncing && setSyncOpen(false)} onOk={syncSapo} okText="Bắt đầu đồng bộ" cancelText="Hủy" confirmLoading={syncing} title="Đồng bộ đơn hàng Sapo theo ngày">
      <Form layout="vertical">
        <Form.Item label="Ngày cần đồng bộ" required>
          <DatePicker
            value={syncDate ? dayjs(syncDate) : null}
            onChange={value => setSyncDate(value ? value.format('YYYY-MM-DD') : '')}
            format="DD/MM/YYYY"
            placeholder="Chọn ngày đồng bộ"
            allowClear={false}
            inputReadOnly
            style={{ width: '100%' }}
          />
        </Form.Item>
      </Form>
      <Alert type="info" showIcon title="Hệ thống gọi SAPO_GetDanhSachDonHang_TheoNgay tại N-ERP, lấy Id_Sapo rồi tải chi tiết từ API Sapo." />
    </Modal>
    <Modal open={detailOpen} onCancel={() => setDetailOpen(false)} footer={<Button onClick={() => setDetailOpen(false)}>Đóng</Button>} width={860} title={detail ? `Chi tiết đơn hàng ${detail.OrderCode}` : 'Chi tiết đơn hàng'}>
      {detail && <div className="orderDetailBox">
        <Row gutter={[12, 12]}>
          <Col xs={24} md={12}><Card size="small"><b>Khách hàng:</b> {detail.CustomerName || '-'}</Card></Col>
          <Col xs={24} md={12}><Card size="small"><b>Số điện thoại:</b> {detail.Phone || '-'}</Card></Col>
          <Col xs={24} md={12}><Card size="small"><b>Kênh bán:</b> {detail.Channel || '-'}</Card></Col>
          <Col xs={24} md={12}><Card size="small"><b>Trạng thái:</b> <Tag>{detail.Status}</Tag></Card></Col>
          <Col span={24}><Card size="small"><b>Địa chỉ:</b> {detail.Address || '-'}</Card></Col>
        </Row>
        <Table
          className="detailItemsTable"
          loading={detailLoading}
          rowKey="OrderItemId"
          dataSource={detail.items || []}
          pagination={false}
          scroll={{ x: 720 }}
          columns={[
            { title: 'SKU', dataIndex: 'SKU' },
            { title: 'Barcode', dataIndex: 'Barcode' },
            { title: 'Tên sản phẩm', dataIndex: 'ProductName' },
            { title: 'SL đặt', dataIndex: 'QtyExpected', align: 'center' },
            { title: 'SL đã đóng', dataIndex: 'QtyPacked', align: 'center' },
            { title: 'Đơn giá', dataIndex: 'UnitPrice', align: 'right', render: v => Number(v || 0).toLocaleString('vi-VN') },
            { title: 'Thành tiền', align: 'right', render: (_, r) => (Number(r.QtyExpected || 0) * Number(r.UnitPrice || 0)).toLocaleString('vi-VN') },
            { title: 'Trạng thái', dataIndex: 'Status', render: v => <Tag color={v === 'PACKED' ? 'green' : 'orange'}>{v || 'PENDING'}</Tag> }
          ]}
        />
        <div className="total detailTotal">Tổng giá trị đơn hàng: {detailTotal.toLocaleString('vi-VN')} đ</div>
      </div>}
    </Modal>
    <Modal open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} title="Nhập nhanh đơn hàng"><Form form={form} layout="vertical" onFinish={submit}><Row gutter={8}><Col span={12}><Form.Item name="orderCode" label="Mã đơn" rules={[{ required: true }]}><Input /></Form.Item></Col><Col span={12}><Form.Item name="idSapo" label="ID Sapo"><Input inputMode="numeric" /></Form.Item></Col></Row><Row gutter={8}><Col span={12}><Form.Item name="customerName" label="Khách hàng"><Input /></Form.Item></Col><Col span={12}><Form.Item name="phone" label="Số điện thoại"><Input /></Form.Item></Col></Row><Form.Item name="channel" label="Kênh bán"><Input /></Form.Item><Row gutter={8}><Col span={8}><Form.Item name="sku" label="SKU" rules={[{ required: true }]}><Input /></Form.Item></Col><Col span={8}><Form.Item name="barcode" label="Barcode"><Input /></Form.Item></Col><Col span={8}><Form.Item name="productName" label="Tên SP"><Input /></Form.Item></Col></Row><Row gutter={8}><Col span={12}><Form.Item name="qtyExpected" label="Số lượng" initialValue={1}><InputNumber min={1} style={{ width: '100%' }} /></Form.Item></Col><Col span={12}><Form.Item name="unitPrice" label="Đơn giá" initialValue={0}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col></Row></Form></Modal>
  </Card>;
}

function CameraAdmin() {
  const [rows, setRows] = useState([]);
  const [form] = Form.useForm();
  const [deletingId, setDeletingId] = useState(null);
  const type = Form.useWatch('connectionType', form) || 'RTSP';
  const refresh = () => getCameras().then(setRows);
  useEffect(() => { refresh(); }, []);

  const handleDelete = async (id, name) => {
    try {
      setDeletingId(id);
      await deleteCamera(id);
      message.success(`Đã xóa camera "${name}"`);
      refresh();
    } catch (err) {
      message.error(err.response?.data?.message || 'Không thể xóa camera');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Card className="glass cameraPage" title="Khai báo camera">
      <Form
        form={form}
        layout="vertical"
        initialValues={{ connectionType: 'RTSP' }}
        onFinish={async v => {
          await addCamera(v);
          form.resetFields();
          form.setFieldValue('connectionType', 'RTSP');
          refresh();
          message.success('Đã thêm camera');
        }}
      >
        <Row gutter={8}>
          <Col xs={24} md={5}>
            <Form.Item name="cameraCode" label="Mã camera" rules={[{ required: true, message: 'Vui lòng nhập mã camera' }]}>
              <Input placeholder="VD: camera03" />
            </Form.Item>
          </Col>
          <Col xs={24} md={6}>
            <Form.Item name="cameraName" label="Tên camera" rules={[{ required: true, message: 'Vui lòng nhập tên camera' }]}>
              <Input placeholder="VD: Bàn đóng gói 01" />
            </Form.Item>
          </Col>
          <Col xs={24} md={5}>
            <Form.Item name="connectionType" label="Cách kết nối" rules={[{ required: true }]}>
              <Select
                options={[
                  { value: 'RTSP', label: 'RTSP/IP Camera' },
                  { value: 'DIRECT', label: 'Camera trực tiếp / USB' }
                ]}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            {type === 'RTSP' ? (
              <Form.Item name="rtspUrl" label="RTSP URL" rules={[{ required: type === 'RTSP', message: 'Vui lòng nhập RTSP URL' }]}>
                <Input.Password placeholder="rtsp://user:pass@ip:554/stream1" />
              </Form.Item>
            ) : (
              <Form.Item name="deviceHint" label="Ghi chú thiết bị">
                <Input placeholder="Webcam laptop / camera sau tablet / USB camera gắn ngoài" />
              </Form.Item>
            )}
          </Col>
        </Row>
        <Button htmlType="submit" type="primary" icon={<PlusOutlined />}>
          Lưu camera
        </Button>
      </Form>
      <div style={{ marginTop: 20 }}>
        <Table
          rowKey="CameraId"
          dataSource={rows}
          scroll={{ x: 960 }}
          columns={[
            { title: 'Mã', dataIndex: 'CameraCode', width: 140 },
            { title: 'Tên', dataIndex: 'CameraName', width: 180 },
            {
              title: 'Loại',
              dataIndex: 'ConnectionType',
              width: 120,
              render: v => <Tag color={v === 'DIRECT' ? 'purple' : 'cyan'}>{v || 'RTSP'}</Tag>
            },
            {
              title: 'RTSP / Ghi chú',
              render: (_, r) => (
                <span className="mono">
                  {r.ConnectionType === 'DIRECT' ? (r.DeviceHint || 'Browser camera') : (r.RtspUrl || '-')}
                </span>
              )
            },
            {
              title: 'Thao tác',
              width: 110,
              align: 'center',
              render: (_, r) => (
                <Popconfirm
                  title="Xác nhận xóa camera"
                  description={`Bạn có chắc muốn xóa camera "${r.CameraName || r.CameraCode}" không?`}
                  okText="Xóa"
                  cancelText="Hủy"
                  okButtonProps={{ danger: true, loading: deletingId === r.CameraId }}
                  onConfirm={() => handleDelete(r.CameraId, r.CameraName || r.CameraCode)}
                >
                  <Button danger size="small" icon={<DeleteOutlined />}>
                    Xóa
                  </Button>
                </Popconfirm>
              )
            }
          ]}
        />
      </div>
    </Card>
  );
}

function UsersAdmin() {
  const [rows, setRows] = useState([]), [open, setOpen] = useState(false);
  const [form] = Form.useForm(); const refresh = () => getUsers().then(setRows); useEffect(() => { refresh(); }, []);
  return <Card className="glass usersPage" title="Quản lý tài khoản" extra={<Button icon={<PlusOutlined />} onClick={() => setOpen(true)}>Thêm tài khoản</Button>}><Table rowKey="UserId" dataSource={rows} columns={[{ title: 'Tài khoản', dataIndex: 'Username' }, { title: 'Họ tên', dataIndex: 'FullName' }, { title: 'Quyền', dataIndex: 'Role' }, { title: 'SĐT', dataIndex: 'Phone' }, { title: 'Trạng thái', dataIndex: 'IsActive', render: v => <Tag color={v ? 'green' : 'red'}>{v ? 'Active' : 'Lock'}</Tag> }, { title: 'Đăng nhập cuối', dataIndex: 'LastLoginAt', render: formatDateTime }]} /><Modal open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} title="Thêm tài khoản"><Form form={form} layout="vertical" onFinish={async v => { await addUser(v); message.success('Đã thêm tài khoản'); setOpen(false); form.resetFields(); refresh(); }}><Form.Item name="username" label="Tài khoản" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="password" label="Mật khẩu" rules={[{ required: true }]}><Input.Password /></Form.Item><Form.Item name="fullName" label="Họ tên nhân viên" rules={[{ required: true }]}><Input /></Form.Item><Row gutter={8}><Col span={12}><Form.Item name="role" label="Quyền" initialValue="PACKER"><Select options={[{ value: 'ADMIN', label: 'ADMIN' }, { value: 'PACKER', label: 'PACKER' }]} /></Form.Item></Col><Col span={12}><Form.Item name="phone" label="SĐT"><Input /></Form.Item></Col></Row></Form></Modal></Card>;
}

function App() {
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem('vk_user') || 'null'));
  const [cameraConfig, setCameraConfig] = useState(() => loadCameraConfig());
  if (!user) return <LoginPage onLogin={setUser} />;
  function logout() { localStorage.removeItem('vk_token'); localStorage.removeItem('vk_user'); setUser(null); }
  return <main><div className="topbar"><div className="topBrand"><img src="/nbc-logo.png" alt="NBC" /><b>VISION AI KIOSK</b></div><span>POS • Packing Verify • RTSP/Direct/USB Camera Recorder</span><Space><Tag color="cyan">{user.fullName}</Tag><Button size="small" icon={<LogoutOutlined />} onClick={logout}>Đăng xuất</Button></Space></div><Tabs defaultActiveKey="pack" items={[{ key: 'pack', label: 'Đóng gói', children: <PackingPage user={user} cameraConfig={cameraConfig} /> }, { key: 'return', label: <span><RollbackOutlined style={{ color: '#fa8c16' }} /> Hàng hoàn</span>, children: <ReturnPackingPage user={user} cameraConfig={cameraConfig} /> }, { key: 'orders', label: 'Đơn hàng', children: <OrdersAdmin /> }, { key: 'camera-config', label: 'Cấu hình camera', children: <CameraConfigPage value={cameraConfig} onSave={setCameraConfig} /> }, { key: 'cams', label: 'Khai báo camera', children: <CameraAdmin /> }, { key: 'videos', label: 'Video', children: <SessionsPage /> }, { key: 'users', label: 'Tài khoản', children: <UsersAdmin /> }]} /></main>;
}

createRoot(document.getElementById('root')).render(<App />);


