import { getPool, sql } from '../db/pool.js';

export async function getOrderByCode(code){
  const pool = await getPool();
  const trimmed = String(code || '').trim();
  const orderRs = await pool.request().input('code', sql.NVarChar, trimmed).query(`
    SELECT TOP 1 * FROM Orders
    WHERE OrderCode=@code 
       OR ReturnTrackingNumber=@code
       OR CONVERT(NVARCHAR(30), Id_Sapo)=@code
       OR EXISTS(
         SELECT 1 FROM STRING_SPLIT(ISNULL(TrackingNumbers,''), ',') WHERE LTRIM(RTRIM(value))=@code
       )
       OR EXISTS(
         SELECT 1 FROM STRING_SPLIT(ISNULL(ReturnTrackingNumber,''), ',') WHERE LTRIM(RTRIM(value))=@code
       )
    ORDER BY CASE WHEN OrderCode=@code THEN 0 WHEN ReturnTrackingNumber=@code THEN 1 ELSE 2 END`);
  const order = orderRs.recordset[0];
  if(!order) return null;
  const items = await pool.request().input('id', sql.Int, order.OrderId).query('SELECT * FROM OrderItems WHERE OrderId=@id ORDER BY OrderItemId');
  return { ...order, items: items.recordset };
}

export async function mapReturnTracking(orderCode, returnTrackingNumber, returnReason = null){
  const pool = await getPool();
  const code = String(orderCode || '').trim();
  const returnCode = String(returnTrackingNumber || '').trim();
  if(!code) throw new Error('Chưa có mã đơn hàng');
  if(!returnCode) throw new Error('Chưa có mã vận đơn hàng hoàn');
  
  await pool.request()
    .input('OrderCode', sql.NVarChar, code)
    .input('ReturnTrackingNumber', sql.NVarChar, returnCode)
    .query(`
      UPDATE Orders 
      SET ReturnTrackingNumber = @ReturnTrackingNumber,
          Status = CASE WHEN Status IN ('NEW','PACKING','PACKED','CHECKED_PASS') THEN 'RETURN_WAITING' ELSE Status END,
          UpdatedAt = SYSUTCDATETIME()
      WHERE OrderCode = @OrderCode OR CONVERT(NVARCHAR(50), OrderId) = @OrderCode
    `);
  return await getOrderByCode(code);
}

export async function upsertOrder(payload){
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try{
    const req = new sql.Request(tx);
    req.input('OrderCode', sql.NVarChar, payload.orderCode);
    req.input('CustomerName', sql.NVarChar, payload.customerName || null);
    req.input('Phone', sql.NVarChar, payload.phone || null);
    req.input('Address', sql.NVarChar, payload.address || null);
    req.input('Channel', sql.NVarChar, payload.channel || null);
    req.input('Id_Sapo', sql.BigInt, payload.idSapo ? String(payload.idSapo) : null);
    const rs = await req.query(`
      MERGE Orders AS t USING (SELECT @OrderCode OrderCode) s ON t.OrderCode=s.OrderCode
      WHEN MATCHED THEN UPDATE SET CustomerName=@CustomerName, Phone=@Phone, Address=@Address, Channel=@Channel, Id_Sapo=@Id_Sapo, SapoSyncedAt=CASE WHEN ISNULL(Id_Sapo,0)<>ISNULL(@Id_Sapo,0) THEN NULL ELSE SapoSyncedAt END, UpdatedAt=SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT(OrderCode, CustomerName, Phone, Address, Channel, Id_Sapo) VALUES(@OrderCode,@CustomerName,@Phone,@Address,@Channel,@Id_Sapo)
      OUTPUT inserted.OrderId;`);
    const orderId = rs.recordset[0].OrderId;
    await new sql.Request(tx).input('OrderId', sql.Int, orderId).query('DELETE FROM OrderItems WHERE OrderId=@OrderId');
    for(const it of payload.items || []){
      await new sql.Request(tx)
        .input('OrderId', sql.Int, orderId)
        .input('SKU', sql.NVarChar, it.sku || '')
        .input('ProductName', sql.NVarChar, it.productName || it.sku || '')
        .input('Barcode', sql.NVarChar, it.barcode || it.Barcode || it.sku || '')
        .input('QtyExpected', sql.Int, Number(it.qtyExpected || it.qty || 1))
        .input('UnitPrice', sql.Decimal(18,2), Number(it.unitPrice || 0))
        .query('INSERT INTO OrderItems(OrderId, SKU, Barcode, ProductName, QtyExpected, UnitPrice) VALUES(@OrderId,@SKU,@Barcode,@ProductName,@QtyExpected,@UnitPrice)');
    }
    await tx.commit();
    return await getOrderByCode(payload.orderCode);
  }catch(e){ await tx.rollback(); throw e; }
}
