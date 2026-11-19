export const CAMERA_CONFIG_KEY='vk_camera_config_v1';

function toId(value){
  const id=Number(value);
  return Number.isInteger(id) && id>0 ? id : null;
}

export function loadCameraConfig(){
  try{
    const value=JSON.parse(localStorage.getItem(CAMERA_CONFIG_KEY) || 'null');
    if(!value || typeof value!=='object') return null;
    return {
      version:1,
      cameraId:toId(value.cameraId),
      cameraCode:String(value.cameraCode || ''),
      cameraId2:toId(value.cameraId2),
      cameraCode2:String(value.cameraCode2 || ''),
      directDeviceId:String(value.directDeviceId || ''),
      directDeviceLabel:String(value.directDeviceLabel || ''),
      directGroupId:String(value.directGroupId || ''),
      directDeviceId2:String(value.directDeviceId2 || ''),
      directDeviceLabel2:String(value.directDeviceLabel2 || ''),
      directGroupId2:String(value.directGroupId2 || '')
    };
  }catch{
    return null;
  }
}

export function saveCameraConfig(value){
  const normalized={
    version:1,
    cameraId:toId(value?.cameraId),
    cameraCode:String(value?.cameraCode || ''),
    cameraId2:toId(value?.cameraId2),
    cameraCode2:String(value?.cameraCode2 || ''),
    directDeviceId:String(value?.directDeviceId || ''),
    directDeviceLabel:String(value?.directDeviceLabel || ''),
    directGroupId:String(value?.directGroupId || ''),
    directDeviceId2:String(value?.directDeviceId2 || ''),
    directDeviceLabel2:String(value?.directDeviceLabel2 || ''),
    directGroupId2:String(value?.directGroupId2 || '')
  };
  localStorage.setItem(CAMERA_CONFIG_KEY,JSON.stringify(normalized));
  return normalized;
}

export async function enumerateVideoDevices({ requestPermission=true }={}){
  if(!navigator.mediaDevices?.enumerateDevices) throw new Error('Trình duyệt không hỗ trợ danh sách camera');
  let devices=await navigator.mediaDevices.enumerateDevices();
  let videos=devices.filter(device=>device.kind==='videoinput');
  if(requestPermission && (videos.length===0 || videos.some(device=>!device.label))){
    let permissionStream;
    try{
      permissionStream=await navigator.mediaDevices.getUserMedia({video:true,audio:false});
    }catch(error){
      if(error?.name==='NotAllowedError' || error?.name==='SecurityError'){
        throw new Error('Quyền sử dụng camera chưa được cấp cho trình duyệt');
      }
      if(error?.name==='NotFoundError') throw new Error('Không tìm thấy camera trên thiết bị');
      throw error;
    }finally{
      permissionStream?.getTracks().forEach(track=>track.stop());
    }
    devices=await navigator.mediaDevices.enumerateDevices();
    videos=devices.filter(device=>device.kind==='videoinput');
  }
  return videos;
}

export function findSavedVideoDevice(devices,{ deviceId='', label='', groupId='' }={}){
  const list=Array.isArray(devices) ? devices : [];
  const savedDeviceId=String(deviceId || '');
  const savedLabel=String(label || '').trim().toLowerCase();
  const savedGroupId=String(groupId || '');
  return list.find(device=>savedDeviceId && device.deviceId===savedDeviceId)
    || list.find(device=>savedGroupId && savedLabel && device.groupId===savedGroupId && String(device.label || '').trim().toLowerCase()===savedLabel)
    || list.find(device=>savedGroupId && device.groupId===savedGroupId)
    || list.find(device=>savedLabel && String(device.label || '').trim().toLowerCase()===savedLabel)
    || null;
}

export function videoDevicePreference(device,prefix=''){
  return {
    [`directDeviceId${prefix}`]:device?.deviceId || '',
    [`directDeviceLabel${prefix}`]:device?.label || '',
    [`directGroupId${prefix}`]:device?.groupId || ''
  };
}
