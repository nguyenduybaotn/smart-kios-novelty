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
    MERGE Orders t USING(SELECT @id Id_Sapo)s ON t.Id_Sapo=s.Id_Sapo
    WHEN MATCHED THEN UPDATE SET
      OrderCode=COALESCE(@code,t.OrderCode),
      CustomerName=COALESCE(@customer,t.CustomerName),
      Phone=COALESCE(@phone,t.Phone),
      Address=COALESCE(@address,t.Address),
      Channel=COALESCE(@channel,t.Channel),
      Status=COALESCE(@status,t.Status),
      Note=COALESCE(@note,t.Note),
      TrackingNumbers='',
      SapoSyncedAt=NULL,
      SapoSyncError=@error,
      UpdatedAt=SYSUTCDATETIME()
    WHEN NOT MATCHED THEN INSERT(Id_Sapo,OrderCode,CustomerName,Phone,Address,Channel,Status,Note,TrackingNumbers,SapoSyncError)
      VALUES(@id,@code,@customer,@phone,@address,@channel,@status,@note,'',@error)
    OUTPUT inserted.OrderId;`);
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
    IF COL_LENGTH('dbo.Orders','Id_Sapo') IS NULL ALTER TABLE dbo.Orders ADD Id_Sapo BIGINT NULL;
    IF COL_LENGTH('dbo.Orders','TrackingNumbers') IS NULL ALTER TABLE dbo.Orders ADD TrackingNumbers NVARCHAR(2000) NULL;
    IF COL_LENGTH('dbo.Orders','SapoSyncedAt') IS NULL ALTER TABLE dbo.Orders ADD SapoSyncedAt DATETIME2 NULL;
    IF COL_LENGTH('dbo.Orders','SapoSyncError') IS NULL ALTER TABLE dbo.Orders ADD SapoSyncError NVARCHAR(2000) NULL;
    IF COL_LENGTH('dbo.Orders','ErpOid') IS NULL ALTER TABLE dbo.Orders ADD ErpOid NVARCHAR(50) NULL;
    IF COL_LENGTH('dbo.Orders','ErpOrderNo') IS NULL ALTER TABLE dbo.Orders ADD ErpOrderNo NVARCHAR(120) NULL;
    IF COL_LENGTH('dbo.Orders','LoaiDonHang') IS NOT NULL
      ALTER TABLE dbo.Orders ALTER COLUMN LoaiDonHang NVARCHAR(100) NULL;
    ELSE
      ALTER TABLE dbo.Orders ADD LoaiDonHang NVARCHAR(100) NULL;
    IF COL_LENGTH('dbo.Orders','ErpProcessedAt') IS NULL ALTER TABLE dbo.Orders ADD ErpProcessedAt DATETIME2 NULL;
    IF COL_LENGTH('dbo.Orders','ErpProcessResult') IS NULL ALTER TABLE dbo.Orders ADD ErpProcessResult NVARCHAR(2000) NULL;
  `);
  await pool.request().batch(`
    IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE name='UX_Orders_Id_Sapo' AND object_id=OBJECT_ID('dbo.Orders')) CREATE UNIQUE INDEX UX_Orders_Id_Sapo ON dbo.Orders(Id_Sapo) WHERE Id_Sapo IS NOT NULL;

    IF OBJECT_ID('dbo.SapoOrderPayloads','U') IS NULL CREATE TABLE dbo.SapoOrderPayloads(
      OrderId INT PRIMARY KEY REFERENCES dbo.Orders(OrderId) ON DELETE CASCADE, Id_Sapo BIGINT NOT NULL,
      FinancialStatus NVARCHAR(80), FulfillmentStatus NVARCHAR(80), Currency NVARCHAR(20),
      TotalPrice DECIMAL(18,2), TotalDiscounts DECIMAL(18,2), ProcessedOn DATETIME2, ModifiedOn DATETIME2,
      RawJson NVARCHAR(MAX) NOT NULL, SyncedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME());
    IF OBJECT_ID('dbo.SapoCustomers','U') IS NULL CREATE TABLE dbo.SapoCustomers(
      OrderId INT PRIMARY KEY REFERENCES dbo.Orders(OrderId) ON DELETE CASCADE, Id_Sapo BIGINT NULL,
      Email NVARCHAR(255),Phone NVARCHAR(80),FirstName NVARCHAR(255),LastName NVARCHAR(255),RawJson NVARCHAR(MAX) NOT NULL);
    IF OBJECT_ID('dbo.SapoAddresses','U') IS NULL CREATE TABLE dbo.SapoAddresses(
      SapoAddressId BIGINT IDENTITY PRIMARY KEY,OrderId INT NOT NULL REFERENCES dbo.Orders(OrderId) ON DELETE CASCADE,
      AddressType NVARCHAR(40),Address1 NVARCHAR(500),Address2 NVARCHAR(500),Ward NVARCHAR(255),District NVARCHAR(255),Province NVARCHAR(255),Country NVARCHAR(255),Phone NVARCHAR(80),RawJson NVARCHAR(MAX) NOT NULL);
    IF OBJECT_ID('dbo.SapoLineItems','U') IS NULL CREATE TABLE dbo.SapoLineItems(
      SapoLineItemId BIGINT PRIMARY KEY,OrderId INT NOT NULL REFERENCES dbo.Orders(OrderId) ON DELETE CASCADE,
      ProductId BIGINT,VariantId BIGINT,SKU NVARCHAR(255),Barcode NVARCHAR(255),Name NVARCHAR(500),Quantity INT,Price DECIMAL(18,2),RawJson NVARCHAR(MAX) NOT NULL);
    IF OBJECT_ID('dbo.SapoFulfillments','U') IS NULL CREATE TABLE dbo.SapoFulfillments(
      SapoFulfillmentId BIGINT PRIMARY KEY,OrderId INT NOT NULL REFERENCES dbo.Orders(OrderId) ON DELETE CASCADE,
      Status NVARCHAR(80),TrackingCompany NVARCHAR(255),TrackingNumbers NVARCHAR(2000),RawJson NVARCHAR(MAX) NOT NULL);
    IF OBJECT_ID('dbo.SapoRefunds','U') IS NULL CREATE TABLE dbo.SapoRefunds(
      SapoRefundId BIGINT PRIMARY KEY,OrderId INT NOT NULL REFERENCES dbo.Orders(OrderId) ON DELETE CASCADE,
      Note NVARCHAR(1000),TotalRefunded DECIMAL(18,2),RawJson NVARCHAR(MAX) NOT NULL);
    IF OBJECT_ID('dbo.SapoRelatedRecords','U') IS NULL CREATE TABLE dbo.SapoRelatedRecords(
      SapoRelatedRecordId BIGINT IDENTITY PRIMARY KEY,OrderId INT NOT NULL REFERENCES dbo.Orders(OrderId) ON DELETE CASCADE,
      RelationName NVARCHAR(120) NOT NULL,ParentSapoId BIGINT NULL,SourceSapoId BIGINT NULL,ItemIndex INT NOT NULL,RawJson NVARCHAR(MAX) NOT NULL);
  `);
}

async function addRelated(tx,orderId,name,records,parentId=null){
  for(let i=0;i<(records || []).length;i++){
    const x=records[i];
    await new sql.Request(tx).input('oid',sql.Int,orderId).input('name',sql.NVarChar,name)
      .input('parent',sql.BigInt,parentId == null ? null : String(parentId)).input('source',sql.BigInt,x?.id == null ? null : String(x.id))
      .input('idx',sql.Int,i).input('raw',sql.NVarChar(sql.MAX),asJson(x) || '{}')
      .query('INSERT SapoRelatedRecords(OrderId,RelationName,ParentSapoId,SourceSapoId,ItemIndex,RawJson) VALUES(@oid,@name,@parent,@source,@idx,@raw)');
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
        MERGE Orders t USING(SELECT @id Id_Sapo)s ON t.Id_Sapo=s.Id_Sapo
        WHEN MATCHED THEN UPDATE SET
          OrderCode=@code,CustomerName=@customer,Phone=@phone,Address=@address,Channel=@channel,
          Status=@status,Note=@note,TrackingNumbers=@tracks,SapoSyncedAt=SYSUTCDATETIME(),SapoSyncError=NULL,
          UpdatedAt=SYSUTCDATETIME(),LoaiDonHang=COALESCE(@loai,t.LoaiDonHang),
          ErpOid=COALESCE(@erpOid,t.ErpOid),ErpOrderNo=COALESCE(@erpOrderNo,t.ErpOrderNo)
        WHEN NOT MATCHED THEN INSERT(Id_Sapo,OrderCode,CustomerName,Phone,Address,Channel,Status,Note,TrackingNumbers,SapoSyncedAt,LoaiDonHang,ErpOid,ErpOrderNo)
          VALUES(@id,@code,@customer,@phone,@address,@channel,@status,@note,@tracks,SYSUTCDATETIME(),@loai,@erpOid,@erpOrderNo)
        OUTPUT inserted.OrderId;`);
    const orderId=merged.recordset[0].OrderId;
    for(const table of ['SapoRelatedRecords','SapoRefunds','SapoFulfillments','SapoLineItems','SapoAddresses','SapoCustomers','SapoOrderPayloads','OrderItems']) await new sql.Request(tx).input('id',sql.Int,orderId).query(`DELETE ${table} WHERE OrderId=@id`);

    await new sql.Request(tx).input('oid',sql.Int,orderId).input('id',sql.BigInt,id).input('fin',sql.NVarChar,asText(order.financial_status,80)).input('ful',sql.NVarChar,asText(order.fulfillment_status,80)).input('cur',sql.NVarChar,asText(order.currency,20)).input('price',sql.Decimal(18,2),Number(order.total_price || 0)).input('discount',sql.Decimal(18,2),Number(order.total_discounts || 0)).input('processed',sql.DateTime2,asDate(order.processed_on)).input('modified',sql.DateTime2,asDate(order.modified_on)).input('raw',sql.NVarChar(sql.MAX),asJson(order)).query('INSERT SapoOrderPayloads(OrderId,Id_Sapo,FinancialStatus,FulfillmentStatus,Currency,TotalPrice,TotalDiscounts,ProcessedOn,ModifiedOn,RawJson) VALUES(@oid,@id,@fin,@ful,@cur,@price,@discount,@processed,@modified,@raw)');
    if(order.customer) await new sql.Request(tx).input('oid',sql.Int,orderId).input('id',sql.BigInt,order.customer.id == null ? null : String(order.customer.id)).input('email',sql.NVarChar,asText(order.customer.email,255)).input('phone',sql.NVarChar,asText(order.customer.phone,80)).input('first',sql.NVarChar,asText(order.customer.first_name,255)).input('last',sql.NVarChar,asText(order.customer.last_name,255)).input('raw',sql.NVarChar(sql.MAX),asJson(order.customer)).query('INSERT SapoCustomers(OrderId,Id_Sapo,Email,Phone,FirstName,LastName,RawJson) VALUES(@oid,@id,@email,@phone,@first,@last,@raw)');
    for(const [type,a] of [['shipping',order.shipping_address],['billing',order.billing_address]]) if(a) await new sql.Request(tx).input('oid',sql.Int,orderId).input('type',sql.NVarChar,type).input('a1',sql.NVarChar,asText(a.address1,500)).input('a2',sql.NVarChar,asText(a.address2,500)).input('ward',sql.NVarChar,asText(a.ward,255)).input('district',sql.NVarChar,asText(a.district,255)).input('province',sql.NVarChar,asText(a.province,255)).input('country',sql.NVarChar,asText(a.country || a.country_name,255)).input('phone',sql.NVarChar,asText(a.phone,80)).input('raw',sql.NVarChar(sql.MAX),asJson(a)).query('INSERT SapoAddresses(OrderId,AddressType,Address1,Address2,Ward,District,Province,Country,Phone,RawJson) VALUES(@oid,@type,@a1,@a2,@ward,@district,@province,@country,@phone,@raw)');
    for(const item of order.line_items || []){
      await new sql.Request(tx).input('id',sql.BigInt,String(item.id)).input('oid',sql.Int,orderId).input('product',sql.BigInt,item.product_id == null ? null : String(item.product_id)).input('variant',sql.BigInt,item.variant_id == null ? null : String(item.variant_id)).input('sku',sql.NVarChar,asText(item.sku,255)).input('barcode',sql.NVarChar,asText(item.barcode,255)).input('name',sql.NVarChar,asText(item.name || item.title,500)).input('qty',sql.Int,Number(item.quantity || 0)).input('price',sql.Decimal(18,2),Number(item.price || 0)).input('raw',sql.NVarChar(sql.MAX),asJson(item)).query('INSERT SapoLineItems(SapoLineItemId,OrderId,ProductId,VariantId,SKU,Barcode,Name,Quantity,Price,RawJson) VALUES(@id,@oid,@product,@variant,@sku,@barcode,@name,@qty,@price,@raw)');
      await new sql.Request(tx).input('oid',sql.Int,orderId).input('sku',sql.NVarChar,asText(item.sku || `SAPO-${item.id}`,80)).input('barcode',sql.NVarChar,asText(item.barcode || item.sku,120)).input('name',sql.NVarChar,asText(item.name || item.title || `Sapo item ${item.id}`,255)).input('qty',sql.Int,Number(item.quantity || 1)).input('price',sql.Decimal(18,2),Number(item.price || 0)).query('INSERT OrderItems(OrderId,SKU,Barcode,ProductName,QtyExpected,UnitPrice) VALUES(@oid,@sku,@barcode,@name,@qty,@price)');
    }
    for(const f of order.fulfillments || []){ const nums=getTrackingNumbers({fulfillments:[f]}); await new sql.Request(tx).input('id',sql.BigInt,String(f.id)).input('oid',sql.Int,orderId).input('status',sql.NVarChar,asText(f.status,80)).input('company',sql.NVarChar,asText(f.tracking_company || f.tracking_info?.tracking_company,255)).input('tracks',sql.NVarChar,asText(nums.join(','),2000)).input('raw',sql.NVarChar(sql.MAX),asJson(f)).query('INSERT SapoFulfillments(SapoFulfillmentId,OrderId,Status,TrackingCompany,TrackingNumbers,RawJson) VALUES(@id,@oid,@status,@company,@tracks,@raw)'); await addRelated(tx,orderId,'fulfillments.line_items',f.line_items,f.id); await addRelated(tx,orderId,'fulfillments.tracking_numbers',nums.map(value=>({value})),f.id); }
    for(const r of order.refunds || []){ await new sql.Request(tx).input('id',sql.BigInt,String(r.id)).input('oid',sql.Int,orderId).input('note',sql.NVarChar,asText(r.note,1000)).input('total',sql.Decimal(18,2),Number(r.total_refunded || 0)).input('raw',sql.NVarChar(sql.MAX),asJson(r)).query('INSERT SapoRefunds(SapoRefundId,OrderId,Note,TotalRefunded,RawJson) VALUES(@id,@oid,@note,@total,@raw)'); await addRelated(tx,orderId,'refunds.refund_line_items',r.refund_line_items,r.id); await addRelated(tx,orderId,'refunds.transactions',r.transactions,r.id); await addRelated(tx,orderId,'refunds.order_adjustments',r.order_adjustments,r.id); }
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
