import express from 'express';
import multer from 'multer';
import XLSX from 'xlsx';
import { getPool, sql } from '../db/pool.js';
import { getOrderByCode, upsertOrder, mapReturnTracking } from '../services/order.service.js';
import { ensureSapoSchema, syncPendingSapoOrders } from '../services/sapo.service.js';
import { getErpOrderInfo } from '../services/erp.service.js';
import { ensurePackingDualCameraSchema } from './packing.js';

const router = express.Router();
const upload = multer({ dest: './storage/temp' });

router.get('/', async (req,res,next)=>{
  try{
    await ensureSapoSchema();
    await ensurePackingDualCameraSchema();
    const pool = await getPool();
    const q = `%${req.query.q || ''}%`;
    const rs = await pool.request().input('q', sql.NVarChar, q).query(`
      SELECT TOP 200 o.*, COUNT(i.OrderItemId) ItemCount, SUM(i.QtyExpected) TotalQty
      FROM Orders o LEFT JOIN OrderItems i ON o.OrderId=i.OrderId
      WHERE o.OrderCode LIKE @q 
         OR ISNULL(o.CustomerName,'') LIKE @q 
         OR ISNULL(o.TrackingNumbers,'') LIKE @q 
         OR ISNULL(o.ReturnTrackingNumber,'') LIKE @q
         OR CONVERT(NVARCHAR(30),o.Id_Sapo) LIKE @q
         OR ISNULL(o.ErpOrderNo,'') LIKE @q
         OR ISNULL(o.ErpOid,'') LIKE @q
      GROUP BY o.OrderId,o.OrderCode,o.Id_Sapo,o.TrackingNumbers,o.ReturnTrackingNumber,o.SapoSyncedAt,o.SapoSyncError,o.CustomerName,o.Phone,o.Address,o.Channel,o.Status,o.Note,o.CreatedAt,o.UpdatedAt,o.LoaiDonHang,o.ErpOid,o.ErpOrderNo,o.ErpProcessedAt,o.ErpProcessResult
      ORDER BY o.CreatedAt DESC`);
    res.json(rs.recordset);
  }catch(e){next(e)}
});

router.post('/:code/map-return', async (req,res,next)=>{
  try{
    await ensurePackingDualCameraSchema();
    const { returnTrackingNumber, returnReason } = req.body;
    if(!returnTrackingNumber) return res.status(400).json({ message:'Chưa có mã vận đơn hàng hoàn' });
    const order = await mapReturnTracking(req.params.code, returnTrackingNumber, returnReason);
    res.json({ ok:true, message:`Đã map mã vận đơn hoàn ${returnTrackingNumber} với đơn hàng ${order.OrderCode}`, order });
  }catch(e){next(e)}
});

router.post('/sync-sapo', async (req,res,next)=>{
  try{
    const { date }=req.body || {};
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return res.status(400).json({message:'Vui lòng chọn ngày đồng bộ'});
    res.json(await syncPendingSapoOrders(date));
  }catch(e){next(e)}
});

// Phân giải Barcode -> SKU qua API Novelty_GetSKU của Nhà Bè ERP
router.get('/resolve-sku/:barcode', async (req,res,next)=>{
  try{
    const barcode = String(req.params.barcode || '').trim();
    if(!barcode) return res.json({ ok: false, barcode, sku: '' });
    const erpBaseUrl = process.env.ERP_API_BASE_URL || 'http://api.nhabe.com.vn:3011';
    const response = await fetch(`${erpBaseUrl}/api/Novelty/Novelty_GetSKU/${encodeURIComponent(barcode)}`, {
      signal: AbortSignal.timeout(5000)
    });
    if(!response.ok){
      return res.json({ ok: false, barcode, sku: barcode, status: response.status });
    }
    const txt = await response.text();
    let sku = '';
    try { sku = JSON.parse(txt); } catch { sku = txt.replace(/^"|"$/g, '').trim(); }
    sku = String(sku || '').trim();
    res.json({ ok: Boolean(sku), barcode, sku: sku || barcode });
  }catch(e){
    console.warn('[Novelty_GetSKU warning]', e.message);
    res.json({ ok: false, barcode: req.params.barcode, sku: req.params.barcode, error: e.message });
  }
});

router.get('/:code', async (req,res,next)=>{
  try{
    let data = await getOrderByCode(req.params.code);
    if(!data) return res.status(404).json({message:'Order not found'});

    // Tự động bổ sung thông tin ErpOid, ErpOrderNo, LoaiDonHang nếu đơn chưa có
    if(!data.ErpOid || !data.ErpOrderNo || !data.LoaiDonHang){
      try {
        const erpInfo = await getErpOrderInfo({ orderCode: data.OrderCode, idSapo: data.Id_Sapo });
        if(erpInfo){
          const pool = await getPool();
          await pool.request()
            .input('OrderId', sql.Int, data.OrderId)
            .input('ErpOid', sql.NVarChar, String(erpInfo.OID))
            .input('ErpOrderNo', sql.NVarChar, String(erpInfo.OrderNo))
            .input('LoaiDonHang', sql.NVarChar, String(erpInfo.LoaiDonHang))
            .query('UPDATE Orders SET ErpOid=@ErpOid, ErpOrderNo=@ErpOrderNo, LoaiDonHang=@LoaiDonHang, UpdatedAt=SYSUTCDATETIME() WHERE OrderId=@OrderId');
          data = await getOrderByCode(req.params.code);
        }
      } catch(lookupErr){
        console.warn('[Auto-enrich ERP lookup error]', lookupErr.message);
      }
    }

    res.json(data);
  }catch(e){next(e)}
});

router.post('/', async (req,res,next)=>{
  try{ res.json(await upsertOrder(req.body)); }catch(e){next(e)}
});

router.post('/:code/scan-product', async (req,res,next)=>{
  try{
    let { barcode } = req.body;
    const code = req.params.code;
    if(!barcode) return res.status(400).json({message:'Chưa có barcode sản phẩm'});
    barcode = String(barcode).trim();
    const pool = await getPool();
    const order = await getOrderByCode(code);
    if(!order) return res.status(404).json({message:'Order not found'});
    
    // 1. Tìm trực tiếp theo Barcode hoặc SKU trong order.items
    let found = order.items.find(x => 
      String(x.SKU||'').toLowerCase()===barcode.toLowerCase() || 
      String(x.Barcode||'').toLowerCase()===barcode.toLowerCase()
    );

    // 2. Nếu chưa tìm thấy, gọi API Novelty_GetSKU để phân giải barcode -> SKU thực tế
    if(!found){
      try {
        const erpBaseUrl = process.env.ERP_API_BASE_URL || 'http://api.nhabe.com.vn:3011';
        const resSku = await fetch(`${erpBaseUrl}/api/Novelty/Novelty_GetSKU/${encodeURIComponent(barcode)}`, {
          signal: AbortSignal.timeout(5000)
        });
        if(resSku.ok){
          const txt = await resSku.text();
          let resolvedSku = '';
          try { resolvedSku = JSON.parse(txt); } catch { resolvedSku = txt.replace(/^"|"$/g, '').trim(); }
          resolvedSku = String(resolvedSku || '').trim();
          if(resolvedSku){
            found = order.items.find(x => 
              String(x.SKU||'').toLowerCase()===resolvedSku.toLowerCase() || 
              String(x.Barcode||'').toLowerCase()===resolvedSku.toLowerCase()
            );
          }
        }
      } catch(fetchErr){
        console.warn('[Novelty_GetSKU scan fallback warning]', fetchErr.message);
      }
    }

    if(!found){
      return res.status(400).json({ ok:false, message:`Barcode / SKU "${barcode}" không thuộc đơn hàng ${code}`, order });
    }
    if(Number(found.QtyPacked||0) >= Number(found.QtyExpected||0)){
      return res.json({ ok:true, alreadyFull:true, message:`Sản phẩm ${found.SKU} đã đủ số lượng`, item:found, order });
    }
    await pool.request()
      .input('OrderItemId', sql.Int, found.OrderItemId)
      .query(`UPDATE OrderItems SET QtyPacked=QtyPacked+1, Status=CASE WHEN QtyPacked+1>=QtyExpected THEN 'PACKED' ELSE 'CHECKING' END WHERE OrderItemId=@OrderItemId`);
    const updated = await getOrderByCode(code);
    const allPass = updated.items.every(x=>Number(x.QtyPacked||0) >= Number(x.QtyExpected||0));
    if(allPass) await pool.request().input('OrderId', sql.Int, updated.OrderId).query("UPDATE Orders SET Status='CHECKED_PASS', UpdatedAt=SYSUTCDATETIME() WHERE OrderId=@OrderId");
    res.json({ ok:true, message:`Đã quét đúng ${found.SKU}`, item:found, order: await getOrderByCode(code) });
  }catch(e){next(e)}
});

router.post('/:code/pass-all', async (req,res,next)=>{
  try{
    const code = req.params.code;
    const pool = await getPool();
    const order = await getOrderByCode(code);
    if(!order) return res.status(404).json({message:'Order not found'});
    await pool.request().input('OrderId', sql.Int, order.OrderId).query("UPDATE OrderItems SET QtyPacked=QtyExpected, Status='PACKED' WHERE OrderId=@OrderId");
    await pool.request().input('OrderId', sql.Int, order.OrderId).query("UPDATE Orders SET Status='CHECKED_PASS', UpdatedAt=SYSUTCDATETIME() WHERE OrderId=@OrderId");
    res.json({ ok:true, message:'Đã set đủ hàng toàn bộ đơn', order: await getOrderByCode(code) });
  }catch(e){next(e)}
});


router.post('/import-excel', upload.single('file'), async (req,res,next)=>{
  try{
    const wb = XLSX.readFile(req.file.path);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    const grouped = new Map();
    for(const r of rows){
      const orderCode = String(r.OrderCode || r.MaDonHang || r['Mã đơn hàng'] || '').trim();
      if(!orderCode) continue;
      if(!grouped.has(orderCode)) grouped.set(orderCode, { orderCode, customerName: r.CustomerName || r.KhachHang || r['Khách hàng'] || '', phone: r.Phone || r.SDT || '', address: r.Address || r['Địa chỉ'] || '', channel: r.Channel || r.Kenh || '', items: [] });
      grouped.get(orderCode).items.push({ sku: r.SKU || r.MaSP || r['Mã SP'] || '', productName: r.ProductName || r.TenSP || r['Tên SP'] || '', barcode: r.Barcode || r.BarCode || r['Mã vạch'] || r['Barcode'] || r.SKU || '', qtyExpected: Number(r.Qty || r.SoLuong || r['Số lượng'] || 1), unitPrice: Number(r.Price || r.DonGia || r['Đơn giá'] || 0) });
    }
    const out=[];
    for(const o of grouped.values()) out.push(await upsertOrder(o));
    res.json({ imported: out.length, orders: out });
  }catch(e){next(e)}
});

// Xử lý luồng ERP: hủy đơn hàng hoàn trên Sapo qua API nội bộ
router.post('/:code/erp-process-return', async (req,res,next)=>{
  try{
    await ensureSapoSchema();
    const pool = await getPool();
    const code = req.params.code;

    // Lấy thông tin đơn hàng
    let order = await getOrderByCode(code);
    if(!order) return res.status(404).json({ message: `Không tìm thấy đơn hàng: ${code}` });

    // Tự động tìm kiếm OID, OrderNo, LoaiDonHang trên ERP nếu đơn chưa có
    if(!order.ErpOid || !order.ErpOrderNo || !order.LoaiDonHang){
      try {
        const erpInfo = await getErpOrderInfo({ orderCode: order.OrderCode, idSapo: order.Id_Sapo });
        if(erpInfo){
          await pool.request()
            .input('OrderId', sql.Int, order.OrderId)
            .input('ErpOid', sql.NVarChar, String(erpInfo.OID))
            .input('ErpOrderNo', sql.NVarChar, String(erpInfo.OrderNo))
            .input('LoaiDonHang', sql.NVarChar, String(erpInfo.LoaiDonHang))
            .query('UPDATE Orders SET ErpOid=@ErpOid, ErpOrderNo=@ErpOrderNo, LoaiDonHang=@LoaiDonHang, UpdatedAt=SYSUTCDATETIME() WHERE OrderId=@OrderId');
          order = await getOrderByCode(code);
        }
      } catch(lookupErr){
        console.warn('[Auto-enrich ERP lookup error]', lookupErr.message);
      }
    }

    const oid = req.body?.oid || order.ErpOid;
    if(!oid) return res.status(400).json({ message: 'Không tìm thấy OID trên ERP của đơn hàng này. Vui lòng kiểm tra lại đơn trên hệ thống ERP.' });
    
    const orderNo = req.body?.orderNo || order.ErpOrderNo;
    if(!orderNo) return res.status(400).json({ message: 'Không tìm thấy OrderNo trên ERP của đơn hàng này.' });

    const loaiDonHang = req.body?.loaiDonHang || order.LoaiDonHang || 'SALE_ORDER';

    // Build ListPO: "Barcode:QtyPacked,..." từ các sản phẩm đã kiểm (QtyPacked > 0)
    let listPO = req.body?.listPO;
    if(!listPO){
      const checkedItems = (order.items || []).filter(it => Number(it.QtyPacked || 0) > 0);
      if(checkedItems.length === 0){
        listPO = (order.items || []).map(it => `${it.Barcode || it.SKU}:${Number(it.QtyExpected || 1)}`).join(',');
      } else {
        listPO = checkedItems.map(it => `${it.Barcode || it.SKU}:${Number(it.QtyPacked)}`).join(',');
      }
    }

    // Build URL gọi API ERP
    const erpBaseUrl = process.env.ERP_API_BASE_URL || 'http://api.nhabe.com.vn:3011';
    const params = new URLSearchParams({
      OID: String(oid),
      OrderNo: String(orderNo),
      ListPO: listPO,
      LoaiDonHang: String(loaiDonHang)
    });
    const erpUrl = `${erpBaseUrl}/api/Novelty/SAPO_HuyDonHang_HangHoan?${params.toString()}`;

    console.log(`[ERP] Gọi API hủy đơn hoàn (POST): ${erpUrl}`);

    // Gọi API ERP với POST method
    let erpResult = null;
    let erpError = null;
    try{
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      const erpResponse = await fetch(erpUrl, { method: 'POST', signal: controller.signal });
      clearTimeout(timeout);
      const text = await erpResponse.text();
      try {
        erpResult = JSON.parse(text);
      } catch {
        erpResult = { message: text, status: erpResponse.status };
      }
      if(!erpResponse.ok){
        erpError = `HTTP ${erpResponse.status}: ${text}`;
      }
    } catch(fetchErr){
      erpError = fetchErr.name === 'AbortError' ? 'Timeout khi gọi API ERP (30s)' : `Lỗi kết nối ERP: ${fetchErr.message}`;
    }

    // Lưu kết quả vào DB
    const resultText = erpError || (typeof erpResult === 'object' && erpResult?.message ? erpResult.message : JSON.stringify(erpResult));
    await pool.request()
      .input('OrderId', sql.Int, order.OrderId)
      .input('ErpProcessResult', sql.NVarChar(2000), String(resultText).slice(0, 2000))
      .input('ErpProcessedAt', sql.DateTime2, new Date())
      .query('UPDATE Orders SET ErpProcessedAt=@ErpProcessedAt, ErpProcessResult=@ErpProcessResult, UpdatedAt=SYSUTCDATETIME() WHERE OrderId=@OrderId');

    if(erpError){
      console.error(`[ERP] Lỗi: ${erpError}`);
      return res.status(502).json({ ok: false, message: erpError, params: { OID: oid, OrderNo: orderNo, ListPO: listPO, LoaiDonHang: loaiDonHang } });
    }

    console.log(`[ERP] Thành công: ${resultText}`);
    res.json({
      ok: true,
      message: typeof erpResult === 'object' && erpResult?.message ? erpResult.message : resultText,
      result: erpResult,
      params: { OID: oid, OrderNo: orderNo, ListPO: listPO, LoaiDonHang: loaiDonHang }
    });
  }catch(e){ next(e) }
});

export default router;
