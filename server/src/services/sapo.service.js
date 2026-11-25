import { getPool, sql } from '../db/pool.js';
import { getSapoOrderIdsByDate } from './erp.service.js';

const asJson = value => value == null ? null : JSON.stringify(value);
const asText = (value, max=1000) => value == null ? null : String(value).slice(0,max);
const asDate = value => { const d=value ? new Date(value) : null; return d && !Number.isNaN(d.valueOf()) ? d : null; };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let lastSapoRequestAt = 0;

function sapoRequestIntervalMs(){
  const configuredInterval=Number(process.env.SAPO_REQUEST_INTERVAL_MS || 0);
  if(configuredInterval>0) return configuredInterval;
  const rps=Number(process.env.SAPO_REQUESTS_PER_SECOND || 2);
  return Math.max(1, Math.ceil(1000 / Math.max(0.1, rps)));
}

async function waitSapoRateLimit(){
  const interval=sapoRequestIntervalMs();
  const elapsed=Date.now()-lastSapoRequestAt;
  if(lastSapoRequestAt && elapsed<interval) await sleep(interval-elapsed);
  lastSapoRequestAt=Date.now();
}

function config(){
  const baseUrl=(process.env.SAPO_BASE_URL || '').replace(/\/$/,'');
  const key=process.env.SAPO_API_KEY || '', secret=process.env.SAPO_API_SECRET || '';
  if(!baseUrl || !key || !secret) throw new Error('Thiếu cấu hình SAPO_BASE_URL, SAPO_API_KEY hoặc SAPO_API_SECRET');
  return { baseUrl, auth:`Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}` };
}

function getTrackingNumbers(order){
  const result=[];
  for(const f of order.fulfillments || []){
    result.push(f.tracking_number,...(f.tracking_numbers || []));
    result.push(f.tracking_info?.tracking_number,...(f.tracking_info?.tracking_numbers || []));
  }
  return [...new Set(result.filter(Boolean).map(String))];
}

function getSapoOrderCode(order,idSapo){
  return asText(order?.name || order?.order_number || order?.number || idSapo,120);
}

function sapoSyncLog(level, payload){
  const prefix='[SAPO SYNC]';
  const text=`${prefix} ${payload.date || ''} Id_Sapo=${payload.idSapo || '-'} OrderCode=${payload.orderCode || '-'} ${payload.message || ''}`.trim();
  if(level==='error') console.error(text);
  else if(level==='warn') console.warn(text);
  else console.log(text);
}

async function markSapoSyncError({idSapo,current,order,errorMessage}){
  const pool=await getPool();
  const orderCode=order ? getSapoOrderCode(order,idSapo) : (current?.OrderCode || String(idSapo));
  const ship=order?.shipping_address || {};
  const customer=asText(ship.name || [order?.customer?.first_name,order?.customer?.last_name].filter(Boolean).join(' '),255);
  const address=asText([ship.address1,ship.address2,ship.ward,ship.district,ship.province,ship.country].filter(Boolean).join(', '),500);
  const request=pool.request()
    .input('id',sql.BigInt,String(idSapo))
    .input('code',sql.NVarChar,orderCode)
    .input('customer',sql.NVarChar,customer)
    .input('phone',sql.NVarChar,asText(order?.phone || ship.phone,80))
    .input('address',sql.NVarChar,address)
    .input('channel',sql.NVarChar,asText(order?.source_name || order?.source,100))
    .input('status',sql.NVarChar,asText(order?.status || current?.Status || 'SAPO_SYNC_ERROR',50))
    .input('note',sql.NVarChar,asText(order?.note,1000))
    .input('error',sql.NVarChar,asText(errorMessage,2000));
  const rs=await request.query(`
    INSERT INTO Orders(Id_Sapo,OrderCode,CustomerName,Phone,Address,Channel,Status,Note,TrackingNumbers,SapoSyncError,UpdatedAt)
    VALUES(@id,@code,@customer,@phone,@address,@channel,@status,@note,'',@error,CURRENT_TIMESTAMP)
    ON CONFLICT(Id_Sapo) DO UPDATE SET
      OrderCode=COALESCE(EXCLUDED.OrderCode,Orders.OrderCode),
      CustomerName=COALESCE(EXCLUDED.CustomerName,Orders.CustomerName),
      Phone=COALESCE(EXCLUDED.Phone,Orders.Phone),
      Address=COALESCE(EXCLUDED.Address,Orders.Address),
      Channel=COALESCE(EXCLUDED.Channel,Orders.Channel),
      Status=COALESCE(EXCLUDED.Status,Orders.Status),
      Note=COALESCE(EXCLUDED.Note,Orders.Note),
      TrackingNumbers='',
      SapoSyncedAt=NULL,
      SapoSyncError=EXCLUDED.SapoSyncError,
      UpdatedAt=CURRENT_TIMESTAMP
    RETURNING OrderId;`);
  return {orderId:rs.recordset?.[0]?.OrderId, idSapo:String(idSapo), orderCode, error:errorMessage};
}

export async function fetchSapoOrder(idSapo){
  const {baseUrl,auth}=config();
  const response=await fetch(`${baseUrl}/admin/orders/${encodeURIComponent(String(idSapo))}.json`,{
    headers:{Authorization:auth,Accept:'application/json'}, signal:AbortSignal.timeout(30000)
  });
  if(!response.ok){
    const error=new Error(`Sapo API ${response.status}: ${await response.text()}`);
    error.status=response.status;
    error.retryAfter=response.headers.get('retry-after');
    throw error;
  }
  const body=await response.json();
  if(!body?.order) throw new Error('Sapo API không trả về order');
  return body.order;
}

async function fetchSapoOrderWithRateLimit(idSapo,{date,maxRetries=3}={}){
  let attempt=0;
  while(true){
    attempt+=1;
    await waitSapoRateLimit();
    try{
      return await fetchSapoOrder(idSapo);
    }catch(error){
      if(error.status!==429 || attempt>maxRetries) throw error;
      const retryAfterMs=Number(error.retryAfter || 0)>0 ? Number(error.retryAfter)*1000 : sapoRequestIntervalMs()*2;
      sapoSyncLog('warn',{date,idSapo,message:`Sapo giới hạn request HTTP 429, chờ ${retryAfterMs}ms rồi thử lại lần ${attempt}/${maxRetries}`});
      await sleep(retryAfterMs);
    }
  }
}

export async function ensureSapoSchema(){
  const pool=await getPool();
  await pool.request().batch(`
    ALTER TABLE "Orders" ADD COLUMN IF NOT EXISTS "Id_Sapo" BIGINT;
    ALTER TABLE "Orders" ADD COLUMN IF NOT EXISTS "TrackingNumbers" VARCHAR(2000);
    ALTER TABLE "Orders" ADD COLUMN IF NOT EXISTS "SapoSyncedAt" TIMESTAMP;
    ALTER TABLE "Orders" ADD COLUMN IF NOT EXISTS "SapoSyncError" VARCHAR(2000);
    ALTER TABLE "Orders" ADD COLUMN IF NOT EXISTS "ErpOid" VARCHAR(50);
    ALTER TABLE "Orders" ADD COLUMN IF NOT EXISTS "ErpOrderNo" VARCHAR(120);
    ALTER TABLE "Orders" ADD COLUMN IF NOT EXISTS "LoaiDonHang" VARCHAR(100);
    ALTER TABLE "Orders" ADD COLUMN IF NOT EXISTS "ErpProcessedAt" TIMESTAMP;
    ALTER TABLE "Orders" ADD COLUMN IF NOT EXISTS "ErpProcessResult" VARCHAR(2000);
    CREATE UNIQUE INDEX IF NOT EXISTS ux_orders_id_sapo ON "Orders"("Id_Sapo") WHERE "Id_Sapo" IS NOT NULL;

    CREATE SEQUENCE IF NOT EXISTS "SapoAddresses_SapoAddressId_seq";
    ALTER TABLE "SapoAddresses" ALTER COLUMN "SapoAddressId" SET DEFAULT nextval('"SapoAddresses_SapoAddressId_seq"');

    CREATE SEQUENCE IF NOT EXISTS "SapoRelatedRecords_SapoRelatedRecordId_seq";
    ALTER TABLE "SapoRelatedRecords" ALTER COLUMN "SapoRelatedRecordId" SET DEFAULT nextval('"SapoRelatedRecords_SapoRelatedRecordId_seq"');
  `);

  try {
    await pool.request().batch(`
      SELECT setval('"SapoAddresses_SapoAddressId_seq"', GREATEST(COALESCE((SELECT MAX("SapoAddressId") FROM "SapoAddresses"), 0) + 1, nextval('"SapoAddresses_SapoAddressId_seq"')), false);
      SELECT setval('"SapoRelatedRecords_SapoRelatedRecordId_seq"', GREATEST(COALESCE((SELECT MAX("SapoRelatedRecordId") FROM "SapoRelatedRecords"), 0) + 1, nextval('"SapoRelatedRecords_SapoRelatedRecordId_seq"')), false);
    `);
  } catch (_) {}
}

async function addRelated(tx,orderId,name,records,parentId=null){
  for(let i=0;i<(records || []).length;i++){
    const x=records[i];
    await new sql.Request(tx).input('oid',sql.Int,orderId).input('name',sql.NVarChar,name)
      .input('parent',sql.BigInt,parentId == null ? null : String(parentId)).input('source',sql.BigInt,x?.id == null ? null : String(x.id))
      .input('idx',sql.Int,i).input('raw',sql.NVarChar(sql.MAX),asJson(x) || '{}')
      .query('INSERT INTO SapoRelatedRecords(OrderId,RelationName,ParentSapoId,SourceSapoId,ItemIndex,RawJson) VALUES(@oid,@name,@parent,@source,@idx,@raw)');
  }
}

export async function saveSapoOrder(order, { erpOid, erpOrderNo, loaiDonHang }={}){
  await ensureSapoSchema(); const pool=await getPool(); const tx=new sql.Transaction(pool); await tx.begin();
  try{
    const id=String(order.id), tracks=getTrackingNumbers(order), ship=order.shipping_address || {};
    const code=asText(order.name || order.order_number || order.number || id,120);
    const customer=asText(ship.name || [order.customer?.first_name,order.customer?.last_name].filter(Boolean).join(' '),255);
    const address=asText([ship.address1,ship.address2,ship.ward,ship.district,ship.province,ship.country].filter(Boolean).join(', '),500);
    const loai=loaiDonHang != null ? asText(loaiDonHang,100) : null;
    const erpOidVal=erpOid != null ? asText(erpOid,50) : null;
    const erpOrderNoVal=erpOrderNo != null ? asText(erpOrderNo,120) : null;
    const merged=await new sql.Request(tx).input('id',sql.BigInt,id).input('code',sql.NVarChar,code).input('customer',sql.NVarChar,customer)
      .input('phone',sql.NVarChar,asText(order.phone || ship.phone,80)).input('address',sql.NVarChar,address)
      .input('channel',sql.NVarChar,asText(order.source_name || order.source,100)).input('status',sql.NVarChar,asText(order.status || 'NEW',50))
      .input('note',sql.NVarChar,asText(order.note,1000)).input('tracks',sql.NVarChar,asText(tracks.join(','),2000))
      .input('loai',sql.NVarChar,loai).input('erpOid',sql.NVarChar,erpOidVal).input('erpOrderNo',sql.NVarChar,erpOrderNoVal).query(`
        INSERT INTO Orders(Id_Sapo,OrderCode,CustomerName,Phone,Address,Channel,Status,Note,TrackingNumbers,SapoSyncedAt,LoaiDonHang,ErpOid,ErpOrderNo,UpdatedAt)
        VALUES(@id,@code,@customer,@phone,@address,@channel,@status,@note,@tracks,CURRENT_TIMESTAMP,@loai,@erpOid,@erpOrderNo,CURRENT_TIMESTAMP)
        ON CONFLICT(Id_Sapo) DO UPDATE SET
          OrderCode=EXCLUDED.OrderCode,
          CustomerName=EXCLUDED.CustomerName,
          Phone=EXCLUDED.Phone,
          Address=EXCLUDED.Address,
          Channel=EXCLUDED.Channel,
          Status=EXCLUDED.Status,
          Note=EXCLUDED.Note,
          TrackingNumbers=EXCLUDED.TrackingNumbers,
          SapoSyncedAt=CURRENT_TIMESTAMP,
          SapoSyncError=NULL,
          UpdatedAt=CURRENT_TIMESTAMP,
          LoaiDonHang=COALESCE(EXCLUDED.LoaiDonHang,Orders.LoaiDonHang),
          ErpOid=COALESCE(EXCLUDED.ErpOid,Orders.ErpOid),
          ErpOrderNo=COALESCE(EXCLUDED.ErpOrderNo,Orders.ErpOrderNo)
        RETURNING OrderId;`);
    const orderId=merged.recordset[0].OrderId;
    for(const table of ['SapoRelatedRecords','SapoRefunds','SapoFulfillments','SapoLineItems','SapoAddresses','SapoCustomers','SapoOrderPayloads','OrderItems']) await new sql.Request(tx).input('id',sql.Int,orderId).query(`DELETE FROM ${table} WHERE OrderId=@id`);

    await new sql.Request(tx).input('oid',sql.Int,orderId).input('id',sql.BigInt,id).input('fin',sql.NVarChar,asText(order.financial_status,80)).input('ful',sql.NVarChar,asText(order.fulfillment_status,80)).input('cur',sql.NVarChar,asText(order.currency,20)).input('price',sql.Decimal(18,2),Number(order.total_price || 0)).input('discount',sql.Decimal(18,2),Number(order.total_discounts || 0)).input('processed',sql.DateTime2,asDate(order.processed_on)).input('modified',sql.DateTime2,asDate(order.modified_on)).input('raw',sql.NVarChar(sql.MAX),asJson(order)).query('INSERT INTO SapoOrderPayloads(OrderId,Id_Sapo,FinancialStatus,FulfillmentStatus,Currency,TotalPrice,TotalDiscounts,ProcessedOn,ModifiedOn,RawJson) VALUES(@oid,@id,@fin,@ful,@cur,@price,@discount,@processed,@modified,@raw)');
    if(order.customer) await new sql.Request(tx).input('oid',sql.Int,orderId).input('id',sql.BigInt,order.customer.id == null ? null : String(order.customer.id)).input('email',sql.NVarChar,asText(order.customer.email,255)).input('phone',sql.NVarChar,asText(order.customer.phone,80)).input('first',sql.NVarChar,asText(order.customer.first_name,255)).input('last',sql.NVarChar,asText(order.customer.last_name,255)).input('raw',sql.NVarChar(sql.MAX),asJson(order.customer)).query('INSERT INTO SapoCustomers(OrderId,Id_Sapo,Email,Phone,FirstName,LastName,RawJson) VALUES(@oid,@id,@email,@phone,@first,@last,@raw)');
    for(const [type,a] of [['shipping',order.shipping_address],['billing',order.billing_address]]) if(a) await new sql.Request(tx).input('oid',sql.Int,orderId).input('type',sql.NVarChar,type).input('a1',sql.NVarChar,asText(a.address1,500)).input('a2',sql.NVarChar,asText(a.address2,500)).input('ward',sql.NVarChar,asText(a.ward,255)).input('district',sql.NVarChar,asText(a.district,255)).input('province',sql.NVarChar,asText(a.province,255)).input('country',sql.NVarChar,asText(a.country || a.country_name,255)).input('phone',sql.NVarChar,asText(a.phone,80)).input('raw',sql.NVarChar(sql.MAX),asJson(a)).query('INSERT INTO SapoAddresses(OrderId,AddressType,Address1,Address2,Ward,District,Province,Country,Phone,RawJson) VALUES(@oid,@type,@a1,@a2,@ward,@district,@province,@country,@phone,@raw)');
    for(const item of order.line_items || []){
      await new sql.Request(tx).input('id',sql.BigInt,String(item.id)).input('oid',sql.Int,orderId).input('product',sql.BigInt,item.product_id == null ? null : String(item.product_id)).input('variant',sql.BigInt,item.variant_id == null ? null : String(item.variant_id)).input('sku',sql.NVarChar,asText(item.sku,255)).input('barcode',sql.NVarChar,asText(item.barcode,255)).input('name',sql.NVarChar,asText(item.name || item.title,500)).input('qty',sql.Int,Number(item.quantity || 0)).input('price',sql.Decimal(18,2),Number(item.price || 0)).input('raw',sql.NVarChar(sql.MAX),asJson(item)).query('INSERT INTO SapoLineItems(SapoLineItemId,OrderId,ProductId,VariantId,SKU,Barcode,Name,Quantity,Price,RawJson) VALUES(@id,@oid,@product,@variant,@sku,@barcode,@name,@qty,@price,@raw)');
      await new sql.Request(tx).input('oid',sql.Int,orderId).input('sku',sql.NVarChar,asText(item.sku || `SAPO-${item.id}`,80)).input('barcode',sql.NVarChar,asText(item.barcode || item.sku,120)).input('name',sql.NVarChar,asText(item.name || item.title || `Sapo item ${item.id}`,255)).input('qty',sql.Int,Number(item.quantity || 1)).input('price',sql.Decimal(18,2),Number(item.price || 0)).query('INSERT INTO OrderItems(OrderId,SKU,Barcode,ProductName,QtyExpected,UnitPrice) VALUES(@oid,@sku,@barcode,@name,@qty,@price)');
    }
    for(const f of order.fulfillments || []){ const nums=getTrackingNumbers({fulfillments:[f]}); await new sql.Request(tx).input('id',sql.BigInt,String(f.id)).input('oid',sql.Int,orderId).input('status',sql.NVarChar,asText(f.status,80)).input('company',sql.NVarChar,asText(f.tracking_company || f.tracking_info?.tracking_company,255)).input('tracks',sql.NVarChar,asText(nums.join(','),2000)).input('raw',sql.NVarChar(sql.MAX),asJson(f)).query('INSERT INTO SapoFulfillments(SapoFulfillmentId,OrderId,Status,TrackingCompany,TrackingNumbers,RawJson) VALUES(@id,@oid,@status,@company,@tracks,@raw)'); await addRelated(tx,orderId,'fulfillments.line_items',f.line_items,f.id); await addRelated(tx,orderId,'fulfillments.tracking_numbers',nums.map(value=>({value})),f.id); }
    for(const r of order.refunds || []){ await new sql.Request(tx).input('id',sql.BigInt,String(r.id)).input('oid',sql.Int,orderId).input('note',sql.NVarChar,asText(r.note,1000)).input('total',sql.Decimal(18,2),Number(r.total_refunded || 0)).input('raw',sql.NVarChar(sql.MAX),asJson(r)).query('INSERT INTO SapoRefunds(SapoRefundId,OrderId,Note,TotalRefunded,RawJson) VALUES(@id,@oid,@note,@total,@raw)'); await addRelated(tx,orderId,'refunds.refund_line_items',r.refund_line_items,r.id); await addRelated(tx,orderId,'refunds.transactions',r.transactions,r.id); await addRelated(tx,orderId,'refunds.order_adjustments',r.order_adjustments,r.id); }
    for(const name of ['shipping_lines','note_attributes','discount_codes','discount_applications','combination_lines','payment_gateway_names','tax_lines','current_tax_lines','invoices']) await addRelated(tx,orderId,name,order[name]);
    await tx.commit(); return {orderId,idSapo:id,orderCode:code,trackingNumbers:tracks};
  }catch(error){ await tx.rollback(); throw error; }
}

export async function syncPendingSapoOrders(syncDate){
  await ensureSapoSchema();
  const pool=await getPool();
  const erp=await getSapoOrderIdsByDate(syncDate);
  const results=[];
  sapoSyncLog('info',{date:syncDate,message:`Bắt đầu đồng bộ ${erp.ids.length} đơn Sapo từ ${erp.rows.length} dòng ERP, giới hạn ${sapoRequestIntervalMs()}ms/request (~${(1000/sapoRequestIntervalMs()).toFixed(2)} request/giây)`});
  for(const idSapo of erp.ids){
    const current=(await pool.request().input('id',sql.BigInt,idSapo).query('SELECT OrderId,OrderCode,SapoSyncedAt,Status FROM Orders WHERE Id_Sapo=@id')).recordset[0];
    let sapoOrder=null;
    try{
      sapoOrder=await fetchSapoOrderWithRateLimit(idSapo,{date:syncDate});
      const tracks=getTrackingNumbers(sapoOrder);
      if(tracks.length===0) throw new Error('Chưa có mã vận đơn');
      // Lấy OID, OrderNo & LoaiDonHang từ ERP rows map
      const erpInfo=erp.erpMap?.[idSapo] || {};
      const loaiDonHang=erpInfo.loaiDonHang ?? erp.loaiMap?.[idSapo] ?? 'SALE_ORDER';
      const erpOrderNo=erpInfo.erpOrderNo || erpInfo.orderNo || null;
      const erpOid=erpInfo.erpOid || erpInfo.oid || null;
      const saved=await saveSapoOrder(sapoOrder, { erpOid, erpOrderNo, loaiDonHang });
      sapoSyncLog('info',{date:syncDate,idSapo,orderCode:saved.orderCode,message:`OK ${current?.OrderId?'cập nhật':'tạo mới'} - tracking=${saved.trackingNumbers.join(',')}${loaiDonHang?` loai=${loaiDonHang}`:''}${erpOid?` erpOid=${erpOid}`:''}${erpOrderNo?` erpOrderNo=${erpOrderNo}`:''}`});
      results.push({ok:true,action:current?.OrderId?'updated':'created',previouslySynced:!!current?.SapoSyncedAt,...saved});
    }
    catch(error){
      const errorMessage=error.message || 'Không rõ lỗi đồng bộ Sapo';
      const marked=await markSapoSyncError({idSapo,current,order:sapoOrder,errorMessage}).catch(markError=>{
        sapoSyncLog('error',{date:syncDate,idSapo,orderCode:getSapoOrderCode(sapoOrder,idSapo),message:`Lỗi phụ khi ghi SapoSyncError: ${markError.message}`});
        return {idSapo:String(idSapo),orderCode:getSapoOrderCode(sapoOrder,idSapo),error:errorMessage};
      });
      sapoSyncLog('error',{date:syncDate,idSapo,orderCode:marked.orderCode,message:`LỖI: ${errorMessage}`});
      results.push({ok:false,idSapo:String(idSapo),orderId:marked.orderId,orderCode:marked.orderCode,error:errorMessage});
    }
  }
  const summary={
    date:syncDate, sourceRows:erp.rows.length, total:erp.ids.length,
    success:results.filter(x=>x.ok).length,
    created:results.filter(x=>x.action==='created').length,
    updated:results.filter(x=>x.action==='updated').length,
    skipped:0,
    failed:results.filter(x=>!x.ok).length, results
  };
  sapoSyncLog(summary.failed?'warn':'info',{date:syncDate,message:`Hoàn tất: success=${summary.success}, failed=${summary.failed}, created=${summary.created}, updated=${summary.updated}`});
  return summary;
}
