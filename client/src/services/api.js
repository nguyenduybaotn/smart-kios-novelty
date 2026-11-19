import axios from 'axios';
function getApiBase() {
  const envBase = (import.meta.env.VITE_API_BASE || '').trim();
  if (typeof window !== 'undefined' && window.location?.hostname) {
    const host = window.location.hostname;
    if (host && host !== '0.0.0.0') {
      return `http://${host}:8095`;
    }
  }
  return envBase || 'http://localhost:8095';
}
export const API_BASE = getApiBase().replace(/\/+$/, '');
export const api = axios.create({ baseURL: `${API_BASE}/api` });
api.interceptors.request.use(cfg=>{ const token=localStorage.getItem('vk_token'); if(token) cfg.headers.Authorization=`Bearer ${token}`; return cfg; });
api.interceptors.response.use(r=>r, err=>{ if(err.response?.status===401){ localStorage.removeItem('vk_token'); localStorage.removeItem('vk_user'); } return Promise.reject(err); });
export async function login(data){ return (await api.post('/auth/login', data)).data; }
export async function getUsers(){ return (await api.get('/auth/users')).data; }
export async function addUser(data){ return (await api.post('/auth/users', data)).data; }
export async function getOrders(q=''){ return (await api.get('/orders',{params:{q}})).data; }
export async function getOrder(code){ return (await api.get(`/orders/${encodeURIComponent(code)}`)).data; }
export async function mapReturnOrder(orderCode, returnTrackingNumber, returnReason = ''){ return (await api.post(`/orders/${encodeURIComponent(orderCode)}/map-return`, { returnTrackingNumber, returnReason })).data; }
export async function saveOrder(data){ return (await api.post('/orders', data)).data; }
export async function importOrders(file){ const fd=new FormData(); fd.append('file', file); return (await api.post('/orders/import-excel', fd)).data; }
export async function syncSapoOrders(date){ return (await api.post('/orders/sync-sapo',{date})).data; }
export async function getCameras(){ return (await api.get('/cameras')).data; }
export async function addCamera(data){ return (await api.post('/cameras', data)).data; }
export async function deleteCamera(id){ return (await api.delete(`/cameras/${id}`)).data; }
export async function startPacking(data){ return (await api.post('/packing/start', data)).data; }
export async function cancelPacking(sessionId, reason=''){ return (await api.post(`/packing/cancel/${sessionId}`, { reason })).data; }
export async function completePacking(sessionId){ return (await api.post(`/packing/complete/${sessionId}`)).data; }
export async function completeDirectPacking(sessionId, blob, durationSeconds=0, camera2Blob=null){
  const fd = new FormData();
  fd.append('video', blob, blob.type?.includes('webm') ? 'direct-camera.webm' : 'direct-camera.mp4');
  if(camera2Blob){
    fd.append('video2', camera2Blob, camera2Blob.type?.includes('webm') ? 'direct-camera-2-original.webm' : 'direct-camera-2-original.mp4');
  }
  fd.append('durationSeconds', String(durationSeconds || 0));
  return (await api.post(`/packing/complete-direct/${sessionId}`, fd)).data;
}
export async function getSessions(q=''){ return (await api.get('/packing/sessions',{params:{q}})).data; }

export async function scanProduct(orderCode, barcode){ return (await api.post(`/orders/${encodeURIComponent(orderCode)}/scan-product`, { barcode })).data; }
export async function resolveSku(barcode){ return (await api.get(`/orders/resolve-sku/${encodeURIComponent(barcode)}`)).data; }
export async function passAllItems(orderCode){ return (await api.post(`/orders/${encodeURIComponent(orderCode)}/pass-all`)).data; }
export async function pausePacking(sessionId){ return (await api.post(`/packing/pause/${sessionId}`)).data; }
export async function resumePacking(sessionId){ return (await api.post(`/packing/resume/${sessionId}`)).data; }
export async function uploadSnapshot(sessionId, blob){ const fd=new FormData(); fd.append('image', blob, 'snapshot.jpg'); return (await api.post(`/packing/snapshot/${sessionId}`, fd)).data; }
export async function captureRtspSnapshot(sessionId){ return (await api.post(`/packing/snapshot/${sessionId}`)).data; }
export async function getSnapshots(sessionId){ return (await api.get(`/packing/snapshots/${sessionId}`)).data; }
export async function processReturnERP(orderCode, data = {}){ return (await api.post(`/orders/${encodeURIComponent(orderCode)}/erp-process-return`, data)).data; }
