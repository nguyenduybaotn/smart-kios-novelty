import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Select, Space, Tag, message } from 'antd';
import { ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import { getCameras } from '../services/api';
import {
  enumerateVideoDevices,
  findSavedVideoDevice,
  saveCameraConfig,
  videoDevicePreference
} from '../services/camera-config';
import '../styles/camera-config.css';

function findSavedCamera(cameras, cameraId, cameraCode) {
  const id = Number(cameraId);
  const code = String(cameraCode || '').trim().toLowerCase();
  return cameras.find(camera => Number(camera.CameraId) === id)
    || cameras.find(camera => code && String(camera.CameraCode || '').trim().toLowerCase() === code)
    || null;
}

export default function CameraConfigPage({ value, onSave }) {
  const [cameras, setCameras] = useState([]);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState(() => value || {});

  useEffect(() => { setDraft(value || {}); }, [value]);

  useEffect(() => {
    let active = true;
    getCameras().then(rows => {
      if (!active) return;
      setCameras(rows);
      setDraft(current => {
        const main = findSavedCamera(rows, current.cameraId, current.cameraCode)
          || rows.find(camera => Boolean(camera.IsDefault))
          || rows[0]
          || null;
        const mode = String(main?.ConnectionType || '').toUpperCase();
        const second = mode === 'RTSP'
          ? findSavedCamera(rows, current.cameraId2, current.cameraCode2)
          : null;
        const validSecond = second
          && Number(second.CameraId) !== Number(main?.CameraId)
          && String(second.ConnectionType || 'RTSP').toUpperCase() === 'RTSP';
        return {
          ...current,
          cameraId: main?.CameraId || null,
          cameraCode: main?.CameraCode || '',
          cameraId2: validSecond ? second.CameraId : null,
          cameraCode2: validSecond ? (second.CameraCode || '') : ''
        };
      });
    }).catch(error => {
      if (active) message.error(error.response?.data?.message || 'Không tải được danh sách camera');
    });
    return () => { active = false; };
    // Chỉ khởi tạo một lần; thay đổi từ App được đồng bộ bởi effect phía trên.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshDevices(showMessage = true) {
    setLoading(true);
    try {
      const rows = await enumerateVideoDevices({ requestPermission: true });
      setDevices(rows);
      setDraft(current => {
        const main = findSavedVideoDevice(rows, {
          deviceId: current.directDeviceId,
          label: current.directDeviceLabel,
          groupId: current.directGroupId
        });
        const second = findSavedVideoDevice(
          rows.filter(device => device.deviceId !== main?.deviceId),
          {
            deviceId: current.directDeviceId2,
            label: current.directDeviceLabel2,
            groupId: current.directGroupId2
          }
        );
        return {
          ...current,
          ...videoDevicePreference(main),
          ...videoDevicePreference(second, '2')
        };
      });
      if (showMessage) message.success(`Đã tìm thấy ${rows.length} camera trên thiết bị`);
    } catch (error) {
      console.warn('[Cấu hình camera] Không thể liệt kê webcam:', error);
      if (showMessage) message.error(error.message || 'Không truy cập được camera');
    } finally {
      setLoading(false);
    }
  }

  const mainCamera = useMemo(
    () => cameras.find(camera => Number(camera.CameraId) === Number(draft.cameraId)),
    [cameras, draft.cameraId]
  );
  const mode = String(mainCamera?.ConnectionType || '').toUpperCase();
  const rtspCameras = cameras.filter(camera => (
    String(camera.ConnectionType || 'RTSP').toUpperCase() === 'RTSP'
    && Number(camera.CameraId) !== Number(draft.cameraId)
  ));

  useEffect(() => {
    if (mode === 'DIRECT') refreshDevices(false);
    // Chỉ quét webcam khi Camera 1 dùng kết nối trực tiếp.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  function selectMainCamera(cameraId) {
    const camera = cameras.find(item => Number(item.CameraId) === Number(cameraId));
    setDraft(current => ({
      ...current,
      cameraId: camera?.CameraId || null,
      cameraCode: camera?.CameraCode || '',
      cameraId2: null,
      cameraCode2: ''
    }));
  }

  function selectDevice(field, deviceId) {
    const device = devices.find(item => item.deviceId === deviceId);
    const suffix = field === 'directDeviceId2' ? '2' : '';
    setDraft(current => ({ ...current, ...videoDevicePreference(device, suffix) }));
  }

  function save() {
    if (!mainCamera) return message.error('Vui lòng chọn Camera 1');
    let next = {
      ...draft,
      cameraId: mainCamera.CameraId,
      cameraCode: mainCamera.CameraCode || ''
    };

    if (mode === 'DIRECT') {
      const first = devices.find(device => device.deviceId === draft.directDeviceId);
      const second = devices.find(device => device.deviceId === draft.directDeviceId2);
      if (!first || !second) return message.error('Vui lòng chọn đủ Webcam 1 và Webcam 2');
      if (first.deviceId === second.deviceId) return message.error('Webcam 1 và Webcam 2 phải khác nhau');
      next = {
        ...next,
        cameraId2: null,
        cameraCode2: '',
        ...videoDevicePreference(first),
        ...videoDevicePreference(second, '2')
      };
    } else {
      if (!mainCamera.RtspUrl) return message.error('Camera 1 chưa có RTSP URL');
      const second = cameras.find(camera => Number(camera.CameraId) === Number(draft.cameraId2));
      if (!second) return message.error('Vui lòng chọn Camera 2 RTSP');
      if (Number(second.CameraId) === Number(mainCamera.CameraId)) return message.error('Camera 1 và Camera 2 phải khác nhau');
      if (String(second.ConnectionType || 'RTSP').toUpperCase() !== 'RTSP') return message.error('Camera 2 phải là camera RTSP');
      if (!second.RtspUrl) return message.error('Camera 2 chưa có RTSP URL');
      next = {
        ...next,
        cameraId2: second.CameraId,
        cameraCode2: second.CameraCode || '',
        directDeviceId: '',
        directDeviceLabel: '',
        directGroupId: '',
        directDeviceId2: '',
        directDeviceLabel2: '',
        directGroupId2: ''
      };
    }

    try {
      const saved = saveCameraConfig(next);
      setDraft(saved);
      onSave?.(saved);
      message.success('Đã lưu cấu hình Camera 1 và Camera 2');
    } catch (error) {
      console.error('[Cấu hình camera] Không thể lưu cấu hình:', error);
      message.error('Không thể lưu cấu hình camera trên trình duyệt này');
    }
  }

  return <Card className="glass cameraConfigPage" title="Cấu hình camera quay đóng gói" extra={<Tag color={mode==='DIRECT'?'purple':'cyan'}>{mode || 'CHƯA CHỌN'}</Tag>}>
    <Alert type="info" showIcon title="Cấu hình được lưu trên máy kiosk này" description="Lần mở tiếp theo hệ thống tự chọn lại đúng Camera 1 và Camera 2. Camera USB cần dùng cùng trình duyệt và cùng địa chỉ truy cập."/>
    <div className="cameraConfigGrid">
      <div className="cameraConfigSlot">
        <h3>Camera 1 — toàn cảnh</h3>
        <label>Hồ sơ camera</label>
        <Select value={draft.cameraId || undefined} onChange={selectMainCamera} placeholder="Chọn Camera 1" options={cameras.map(camera=>({value:camera.CameraId,label:`${camera.CameraName} - ${camera.CameraCode} [${camera.ConnectionType || 'RTSP'}]`}))}/>
        {mode==='DIRECT' && <><label>Thiết bị Webcam 1</label><Select value={draft.directDeviceId || undefined} onChange={value=>selectDevice('directDeviceId',value)} placeholder="Chọn webcam toàn cảnh" options={devices.filter(device=>device.deviceId!==draft.directDeviceId2).map((device,index)=>({value:device.deviceId,label:device.label || `Camera ${index+1}`}))}/></>}
        {mode==='RTSP' && <div className="cameraConfigHint">{mainCamera?.RtspUrl ? 'RTSP URL đã khai báo' : 'Camera chưa có RTSP URL'}</div>}
      </div>
      <div className="cameraConfigSlot">
        <h3>Camera 2 — góc gần</h3>
        {mode==='DIRECT' ? <><label>Thiết bị Webcam 2</label><Select value={draft.directDeviceId2 || undefined} onChange={value=>selectDevice('directDeviceId2',value)} placeholder="Chọn webcam góc gần" options={devices.filter(device=>device.deviceId!==draft.directDeviceId).map((device,index)=>({value:device.deviceId,label:device.label || `Camera ${index+1}`}))}/></> : <><label>Camera RTSP 2</label><Select value={draft.cameraId2 || undefined} onChange={cameraId2=>setDraft(current=>({...current,cameraId2}))} placeholder="Chọn camera góc gần" options={rtspCameras.map(camera=>({value:camera.CameraId,label:`${camera.CameraName} - ${camera.CameraCode}`}))}/></>}
      </div>
    </div>
    <Space wrap>
      <Button type="primary" size="large" icon={<SaveOutlined/>} onClick={save}>Lưu cấu hình</Button>
      {mode==='DIRECT' && <Button size="large" icon={<ReloadOutlined/>} loading={loading} onClick={()=>refreshDevices(true)}>Quét lại webcam</Button>}
    </Space>
  </Card>;
}
