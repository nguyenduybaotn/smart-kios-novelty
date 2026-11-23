import { getPool, sql } from '../db/pool.js';

export async function getOrderByCode(code){
  const pool = await getPool();
  const trimmed = String(code || '').trim();
  const orderRs = await pool.request().input('code', sql.NVarChar, trimmed).query(`
    SELECT * FROM Orders
    WHERE OrderCode=@code 
       OR ReturnTrackingNumber=@code
       OR CAST(Id_Sapo AS VARCHAR)=@code
       OR EXISTS(
         SELECT 1 FROM unnest(string_to_array(COALESCE(TrackingNumbers,''), ',')) s(val) WHERE TRIM(val)=@code
       )
       OR EXISTS(
         SELECT 1 FROM unnest(string_to_array(COALESCE(ReturnTrackingNumber,''), ',')) s(val) WHERE TRIM(val)=@code
       )
    ORDER BY CASE WHEN OrderCode=@code THEN 0 WHEN ReturnTrackingNumber=@code THEN 1 ELSE 2 END
    LIMIT 1`);
  const order = orderRs.recordset[0];
  if(!order) return null;

  let items = (await pool.request().input('id', sql.Int, order.OrderId).query('SELECT * FROM OrderItems WHERE OrderId=@id ORDER BY OrderItemId')).recordset || [];

  // Tự động phục hồi 1: Nếu OrderItems rỗng, lấy từ SapoLineItems đã lưu
  if(items.length === 0){
    const sapoItems = (await pool.request().input('id', sql.Int, order.OrderId).query('SELECT * FROM SapoLineItems WHERE OrderId=@id ORDER BY SapoLineItemId')).recordset || [];
    if(sapoItems.length > 0){
      for(const it of sapoItems){
        await pool.request()
          .input('oid', sql.Int, order.OrderId)
          .input('sku', sql.NVarChar, it.SKU || `SAPO-${it.SapoLineItemId}`)
          .input('barcode', sql.NVarChar, it.Barcode || it.SKU || '')
          .input('name', sql.NVarChar, it.Name || it.SKU || '')
          .input('qty', sql.Int, Number(it.Quantity || 1))
          .input('price', sql.Decimal(18,2), Number(it.Price || 0))
          .query('INSERT INTO OrderItems(OrderId, SKU, Barcode, ProductName, QtyExpected, UnitPrice) VALUES(@oid, @sku, @barcode, @name, @qty, @price)');
      }
      items = (await pool.request().input('id', sql.Int, order.OrderId).query('SELECT * FROM OrderItems WHERE OrderId=@id ORDER BY OrderItemId')).recordset || [];
    }
  }

  // Tự động phục hồi 2: Nếu vẫn rỗng và đơn có Id_Sapo, tự động gọi API Sapo để kéo sản phẩm về
  if(items.length === 0 && order.Id_Sapo){
    try {
      const { fetchSapoOrder, saveSapoOrder } = await import('./sapo.service.js');
      const sapoOrder = await fetchSapoOrder(order.Id_Sapo);
      if(sapoOrder && sapoOrder.line_items?.length > 0){
        await saveSapoOrder(sapoOrder);
        items = (await pool.request().input('id', sql.Int, order.OrderId).query('SELECT * FROM OrderItems WHERE OrderId=@id ORDER BY OrderItemId')).recordset || [];
      }
    } catch(fetchErr){
      console.warn(`[Auto-fetch Sapo items for ${order.OrderCode} warning]:`, fetchErr.message);
    }
  }

  return { ...order, items };
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
          UpdatedAt = CURRENT_TIMESTAMP
      WHERE OrderCode = @OrderCode OR CAST(OrderId AS VARCHAR) = @OrderCode
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
      INSERT INTO Orders(OrderCode, CustomerName, Phone, Address, Channel, Id_Sapo, UpdatedAt)
      VALUES(@OrderCode, @CustomerName, @Phone, @Address, @Channel, @Id_Sapo, CURRENT_TIMESTAMP)
      ON CONFLICT(OrderCode) DO UPDATE SET
        CustomerName=EXCLUDED.CustomerName,
        Phone=EXCLUDED.Phone,
        Address=EXCLUDED.Address,
        Channel=EXCLUDED.Channel,
        Id_Sapo=EXCLUDED.Id_Sapo,
        SapoSyncedAt=CASE WHEN COALESCE(Orders.Id_Sapo,0)<>COALESCE(EXCLUDED.Id_Sapo,0) THEN NULL ELSE Orders.SapoSyncedAt END,
        UpdatedAt=CURRENT_TIMESTAMP
      RETURNING OrderId;`);
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
