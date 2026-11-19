import sql from 'mssql';

let erpPool;

function required(name, fallback=''){
  const value=process.env[name] || fallback;
  if(!value) throw new Error(`Thiếu cấu hình ${name} trong server/.env`);
  return value;
}

function safeSqlName(value, label){
  if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error(`${label} không hợp lệ`);
  return value;
}

async function getErpPool(){
  if(erpPool?.connected) return erpPool;
  erpPool=new sql.ConnectionPool({
    server:required('ERP_SQL_SERVER'),
    port:Number(process.env.ERP_SQL_PORT || 1433),
    database:required('ERP_SQL_DATABASE'),
    user:required('ERP_SQL_USER'),
    password:required('ERP_SQL_PASSWORD'),
    options:{
      encrypt:String(process.env.ERP_SQL_ENCRYPT || 'false').toLowerCase()==='true',
      trustServerCertificate:String(process.env.ERP_SQL_TRUST_CERT || 'true').toLowerCase()==='true'
    },
    connectionTimeout:Number(process.env.ERP_SQL_CONNECTION_TIMEOUT || 15000),
    requestTimeout:Number(process.env.ERP_SQL_REQUEST_TIMEOUT || 60000),
    pool:{max:3,min:0,idleTimeoutMillis:30000}
  });
  erpPool.on('error',()=>{ erpPool=undefined; });
  try{ await erpPool.connect(); return erpPool; }
  catch(error){ erpPool=undefined; throw new Error(`Không kết nối được database ERP: ${error.message}`); }
}

export async function getSapoOrderIdsByDate(syncDate){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(syncDate || '')) throw new Error('Ngày đồng bộ phải có định dạng YYYY-MM-DD');
  const procedure=safeSqlName(process.env.ERP_SAPO_SYNC_PROCEDURE || 'SAPO_GetDanhSachDonHang_TheoNgay','Tên procedure');
  const parameter=safeSqlName(process.env.ERP_SAPO_SYNC_DATE_PARAM || 'Ngay','Tên tham số ngày');
  const pool=await getErpPool();
  // Stored procedure SAPO_GetDanhSachDonHang_TheoNgay declares @Date as datetime,
  // but it returns the expected business date only when the value is passed as
  // the original YYYY-MM-DD string. Binding a JS Date shifts/normalizes the
  // value through the driver and can return orders from the wrong day.
  const result=await pool.request().input(parameter,sql.NVarChar(10),syncDate).execute(procedure);
  const rows=result.recordset || [];
  // Build map: Id_Sapo -> { erpOid, erpOrderNo, loaiDonHang, remarks, idSapo }
  const erpMap={};
  const ids=[];
  for(const row of rows){
    const idSapoKey=Object.keys(row).find(k=>['id_sapo','idsapo'].includes(k.toLowerCase()));
    const oidKey=Object.keys(row).find(k=>k.toLowerCase()==='oid');
    const orderNoKey=Object.keys(row).find(k=>['orderno','order_no','ordercode','madonhang'].includes(k.toLowerCase()));
    const loaiKey=Object.keys(row).find(k=>['loaidonhang','loaidon'].includes(k.toLowerCase()));
    const remarksKey=Object.keys(row).find(k=>['remarks','ghichu'].includes(k.toLowerCase()));

    const idSapo=idSapoKey && row[idSapoKey] != null ? String(row[idSapoKey]).trim() : null;
    const erpOid=oidKey && row[oidKey] != null ? String(row[oidKey]).trim() : null;
    const erpOrderNo=orderNoKey && row[orderNoKey] != null ? String(row[orderNoKey]).trim() : null;
    const loai=loaiKey && row[loaiKey] != null ? String(row[loaiKey]).trim() : 'SALE_ORDER';
    const remarks=remarksKey && row[remarksKey] != null ? String(row[remarksKey]).trim() : null;

    if(idSapo){
      ids.push(idSapo);
      erpMap[idSapo]={ erpOid, erpOrderNo, loaiDonHang: loai, remarks, idSapo };
    }
  }
  return { rows, ids:[...new Set(ids)], erpMap, loaiMap: Object.fromEntries(Object.entries(erpMap).map(([k,v])=>[k,v.loaiDonHang])) };
}

// Tra cứu trực tiếp thông tin OID, OrderNo, LoaiDonHang từ database ERP theo mã đơn hoặc Id Sapo
export async function getErpOrderInfo({ orderCode, idSapo } = {}){
  try {
    const pool = await getErpPool();
    const req = pool.request();
    if(idSapo) req.input('id', sql.BigInt, String(idSapo));
    if(orderCode) req.input('code', sql.NVarChar, String(orderCode).trim());

    const rs = await req.query(`
      SELECT TOP 1 OID, OrderNo, Remarks, Id_Sapo, 'SALE_ORDER' as LoaiDonHang
      FROM SALE_ORDER
      WHERE (${idSapo ? 'Id_Sapo = @id' : '1=0'}) OR (${orderCode ? 'Remarks = @code' : '1=0'})
      UNION ALL
      SELECT TOP 1 BillSellID as OID, BillSellNo as OrderNo, Customer as Remarks, IdSapo as Id_Sapo, 'SALE_BILL_SELL' as LoaiDonHang
      FROM SALE_BILL_SELL
      WHERE (${idSapo ? 'IdSapo = @id' : '1=0'}) OR (${orderCode ? 'Customer = @code' : '1=0'})
    `);
    const row = rs.recordset?.[0];
    if(!row) return null;
    return {
      OID: String(row.OID),
      OrderNo: String(row.OrderNo),
      Remarks: row.Remarks ? String(row.Remarks) : null,
      Id_Sapo: row.Id_Sapo ? String(row.Id_Sapo) : null,
      LoaiDonHang: row.LoaiDonHang ? String(row.LoaiDonHang) : 'SALE_ORDER'
    };
  } catch(e) {
    console.error('[ERP Lookup Error]', e.message);
    return null;
  }
}
