import fs from 'fs';
import path from 'path';
import sql from 'mssql';
import dotenv from 'dotenv';
dotenv.config();

const sqlConfig = {
  server: process.env.SQL_SERVER || '192.168.23.221',
  port: Number(process.env.SQL_PORT || 1433),
  database: process.env.SQL_DATABASE || 'VisionAIKiosk',
  user: process.env.SQL_USER || 'sa',
  password: process.env.SQL_PASSWORD || '12345678x@X',
  options: {
    encrypt: false,
    trustServerCertificate: true
  },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }
};

const TABLES = [
  'Users',
  'Cameras',
  'Products',
  'Orders',
  'OrderItems',
  'PackingSessions',
  'PackingSnapshots',
  'SapoOrderPayloads',
  'SapoCustomers',
  'SapoAddresses',
  'SapoLineItems',
  'SapoFulfillments',
  'SapoRefunds',
  'SapoRelatedRecords'
];

function escapeSql(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  if (typeof val === 'number') return String(val);
  if (val instanceof Date) return `'${val.toISOString()}'`;
  return `'${String(val).replace(/'/g, "''")}'`;
}

async function main() {
  console.log('--- ĐANG TẠO BẢN BACKUP SQL CHUẨN POSTGRESQL ---');
  const outFile = path.resolve('../VisionAIKiosk_backup.sql');
  const stream = fs.createWriteStream(outFile, { encoding: 'utf8' });

  stream.write(`-- =========================================================\n`);
  stream.write(`-- VISION AI KIOSK POS - DATABASE BACKUP (POSTGRESQL)\n`);
  stream.write(`-- Tạo tự động lúc: ${new Date().toLocaleString('vi-VN')}\n`);
  stream.write(`-- =========================================================\n\n`);

  stream.write(`-- 1. TẠO CẤU TRÚC BẢNG VÀ RÀNG BUỘC\n`);
  stream.write(`CREATE TABLE IF NOT EXISTS "Users" (
    "UserId" SERIAL PRIMARY KEY,
    "Username" VARCHAR(80) NOT NULL UNIQUE,
    "PasswordHash" VARCHAR(255) NOT NULL,
    "FullName" VARCHAR(120) NOT NULL,
    "Role" VARCHAR(40) NOT NULL DEFAULT 'PACKER',
    "Phone" VARCHAR(40),
    "IsActive" BOOLEAN NOT NULL DEFAULT TRUE,
    "LastLoginAt" TIMESTAMP,
    "CreatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);\n\n`);

  stream.write(`CREATE TABLE IF NOT EXISTS "Cameras" (
    "CameraId" SERIAL PRIMARY KEY,
    "CameraCode" VARCHAR(50) NOT NULL UNIQUE,
    "CameraName" VARCHAR(120) NOT NULL,
    "ConnectionType" VARCHAR(20) NOT NULL DEFAULT 'RTSP',
    "RtspUrl" VARCHAR(500),
    "DeviceHint" VARCHAR(255),
    "IsDefault" BOOLEAN NOT NULL DEFAULT FALSE,
    "IsActive" BOOLEAN NOT NULL DEFAULT TRUE,
    "CreatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);\n\n`);

  stream.write(`CREATE TABLE IF NOT EXISTS "Products" (
    "ProductId" SERIAL PRIMARY KEY,
    "SKU" VARCHAR(80) NOT NULL UNIQUE,
    "Barcode" VARCHAR(120),
    "ProductName" VARCHAR(255) NOT NULL,
    "Category" VARCHAR(120),
    "Price" NUMERIC(18,2) NOT NULL DEFAULT 0,
    "ImageUrl" VARCHAR(500),
    "IsActive" BOOLEAN NOT NULL DEFAULT TRUE,
    "CreatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);\n\n`);

  stream.write(`CREATE TABLE IF NOT EXISTS "Orders" (
    "OrderId" SERIAL PRIMARY KEY,
    "OrderCode" VARCHAR(100) NOT NULL UNIQUE,
    "Id_Sapo" BIGINT UNIQUE,
    "TrackingNumbers" VARCHAR(2000),
    "ReturnTrackingNumber" VARCHAR(255),
    "SapoSyncedAt" TIMESTAMP,
    "SapoSyncError" VARCHAR(2000),
    "CustomerName" VARCHAR(255),
    "Phone" VARCHAR(50),
    "Address" VARCHAR(500),
    "Channel" VARCHAR(50),
    "Status" VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    "Note" VARCHAR(1000),
    "LoaiDonHang" VARCHAR(100),
    "ErpOid" VARCHAR(50),
    "ErpOrderNo" VARCHAR(120),
    "ErpProcessedAt" TIMESTAMP,
    "ErpProcessResult" VARCHAR(2000),
    "CreatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "UpdatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);\n\n`);

  stream.write(`CREATE TABLE IF NOT EXISTS "OrderItems" (
    "OrderItemId" SERIAL PRIMARY KEY,
    "OrderId" INTEGER NOT NULL REFERENCES "Orders"("OrderId") ON DELETE CASCADE,
    "SKU" VARCHAR(80) NOT NULL,
    "Barcode" VARCHAR(120),
    "ProductName" VARCHAR(255) NOT NULL,
    "QtyExpected" INTEGER NOT NULL DEFAULT 1,
    "QtyPacked" INTEGER NOT NULL DEFAULT 0,
    "UnitPrice" NUMERIC(18,2) NOT NULL DEFAULT 0,
    "Status" VARCHAR(40) NOT NULL DEFAULT 'PENDING',
    "CreatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);\n\n`);

  stream.write(`CREATE TABLE IF NOT EXISTS "PackingSessions" (
    "SessionId" UUID PRIMARY KEY,
    "OrderId" INTEGER NOT NULL REFERENCES "Orders"("OrderId"),
    "CameraId" INTEGER REFERENCES "Cameras"("CameraId"),
    "CameraId2" INTEGER REFERENCES "Cameras"("CameraId"),
    "OperatorUserId" INTEGER REFERENCES "Users"("UserId"),
    "OrderCode" VARCHAR(100) NOT NULL,
    "Status" VARCHAR(40) NOT NULL DEFAULT 'RECORDING',
    "VideoPath" VARCHAR(1000),
    "VideoFileName" VARCHAR(255),
    "VideoSizeBytes" BIGINT,
    "VideoPath2" VARCHAR(1000),
    "VideoFileName2" VARCHAR(255),
    "VideoSizeBytes2" BIGINT,
    "CompositeMode" VARCHAR(40),
    "DurationSeconds" INTEGER DEFAULT 0,
    "StartedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "CompletedAt" TIMESTAMP,
    "QrPayload" VARCHAR(500),
    "Note" VARCHAR(1000),
    "OperatorName" VARCHAR(120),
    "OperatorUsername" VARCHAR(80),
    "CustomerName" VARCHAR(255),
    "CustomerPhone" VARCHAR(50),
    "SessionType" VARCHAR(30) NOT NULL DEFAULT 'PACKING',
    "ReturnTrackingNumber" VARCHAR(255),
    "ReturnReason" VARCHAR(500)
);\n\n`);

  stream.write(`CREATE TABLE IF NOT EXISTS "PackingSnapshots" (
    "SnapshotId" SERIAL PRIMARY KEY,
    "SessionId" UUID NOT NULL REFERENCES "PackingSessions"("SessionId") ON DELETE CASCADE,
    "OrderId" INTEGER NOT NULL,
    "OrderCode" VARCHAR(100),
    "FileName" VARCHAR(255) NOT NULL,
    "FilePath" VARCHAR(1000) NOT NULL,
    "FileSizeBytes" BIGINT,
    "CapturedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "CapturedByUserId" INTEGER REFERENCES "Users"("UserId"),
    "CapturedByName" VARCHAR(120),
    "Note" VARCHAR(500)
);\n\n`);

  stream.write(`CREATE TABLE IF NOT EXISTS "SapoOrderPayloads" (
    "OrderId" INTEGER PRIMARY KEY REFERENCES "Orders"("OrderId") ON DELETE CASCADE,
    "Id_Sapo" BIGINT NOT NULL,
    "FinancialStatus" VARCHAR(80),
    "FulfillmentStatus" VARCHAR(80),
    "Currency" VARCHAR(20),
    "TotalPrice" NUMERIC(18,2),
    "TotalDiscounts" NUMERIC(18,2),
    "ProcessedOn" TIMESTAMP,
    "ModifiedOn" TIMESTAMP,
    "RawJson" TEXT NOT NULL,
    "SyncedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);\n\n`);

  stream.write(`CREATE TABLE IF NOT EXISTS "SapoCustomers" (
    "OrderId" INTEGER PRIMARY KEY REFERENCES "Orders"("OrderId") ON DELETE CASCADE,
    "Id_Sapo" BIGINT,
    "Email" VARCHAR(255),
    "Phone" VARCHAR(80),
    "FirstName" VARCHAR(255),
    "LastName" VARCHAR(255),
    "RawJson" TEXT NOT NULL
);\n\n`);

  stream.write(`CREATE TABLE IF NOT EXISTS "SapoAddresses" (
    "SapoAddressId" BIGINT PRIMARY KEY,
    "OrderId" INTEGER NOT NULL REFERENCES "Orders"("OrderId") ON DELETE CASCADE,
    "AddressType" VARCHAR(40),
    "Address1" VARCHAR(500),
    "Address2" VARCHAR(500),
    "Ward" VARCHAR(255),
    "District" VARCHAR(255),
    "Province" VARCHAR(255),
    "Country" VARCHAR(255),
    "Phone" VARCHAR(80),
    "RawJson" TEXT NOT NULL
);\n\n`);

  stream.write(`CREATE TABLE IF NOT EXISTS "SapoLineItems" (
    "SapoLineItemId" BIGINT PRIMARY KEY,
    "OrderId" INTEGER NOT NULL REFERENCES "Orders"("OrderId") ON DELETE CASCADE,
    "ProductId" BIGINT,
    "VariantId" BIGINT,
    "SKU" VARCHAR(255),
    "Barcode" VARCHAR(255),
    "Name" VARCHAR(500),
    "Quantity" INTEGER,
    "Price" NUMERIC(18,2),
    "RawJson" TEXT NOT NULL
);\n\n`);

  stream.write(`CREATE TABLE IF NOT EXISTS "SapoFulfillments" (
    "SapoFulfillmentId" BIGINT PRIMARY KEY,
    "OrderId" INTEGER NOT NULL REFERENCES "Orders"("OrderId") ON DELETE CASCADE,
    "Status" VARCHAR(80),
    "TrackingCompany" VARCHAR(255),
    "TrackingNumbers" VARCHAR(2000),
    "RawJson" TEXT NOT NULL
);\n\n`);

  stream.write(`CREATE TABLE IF NOT EXISTS "SapoRefunds" (
    "SapoRefundId" BIGINT PRIMARY KEY,
    "OrderId" INTEGER NOT NULL REFERENCES "Orders"("OrderId") ON DELETE CASCADE,
    "Note" VARCHAR(1000),
    "TotalRefunded" NUMERIC(18,2),
    "RawJson" TEXT NOT NULL
);\n\n`);

  stream.write(`CREATE TABLE IF NOT EXISTS "SapoRelatedRecords" (
    "SapoRelatedRecordId" BIGINT PRIMARY KEY,
    "OrderId" INTEGER NOT NULL REFERENCES "Orders"("OrderId") ON DELETE CASCADE,
    "RelationName" VARCHAR(120) NOT NULL,
    "ParentSapoId" BIGINT,
    "SourceSapoId" BIGINT,
    "ItemIndex" INTEGER NOT NULL,
    "RawJson" TEXT NOT NULL
);\n\n`);

  console.log('✅ Đã ghi cấu trúc bảng DDL.');

  // Đọc dữ liệu từ SQL Server
  const pool = await sql.connect(sqlConfig);
  console.log('✅ Đã kết nối SQL Server.');

  for (const table of TABLES) {
    console.log(`Đang xuất dữ liệu bảng "${table}"...`);
    const rs = await pool.request().query(`SELECT * FROM ${table}`);
    const rows = rs.recordset;
    if (rows.length === 0) {
      console.log(`  - 0 dòng.`);
      continue;
    }

    const cols = Object.keys(rows[0]);
    const colList = cols.map(c => `"${c}"`).join(', ');

    stream.write(`-- Dữ liệu bảng "${table}" (${rows.length} dòng)\n`);
    const chunkSize = 200;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const valuesStr = chunk.map(r => {
        return '(' + cols.map(c => escapeSql(r[c])).join(', ') + ')';
      }).join(',\n');

      stream.write(`INSERT INTO "${table}" (${colList}) VALUES\n${valuesStr}\nON CONFLICT DO NOTHING;\n\n`);
    }
    console.log(`  - Hoàn tất ${rows.length} dòng.`);
  }

  // Đồng bộ sequence
  stream.write(`-- 3. ĐỒNG BỘ AUTO INCREMENT SEQUENCE\n`);
  const seqs = [
    { table: 'Users', col: 'UserId' },
    { table: 'Cameras', col: 'CameraId' },
    { table: 'Orders', col: 'OrderId' },
    { table: 'OrderItems', col: 'OrderItemId' },
    { table: 'PackingSnapshots', col: 'SnapshotId' }
  ];
  for (const s of seqs) {
    stream.write(`SELECT setval(pg_get_serial_sequence('"${s.table}"', '${s.col}'), COALESCE((SELECT MAX("${s.col}") FROM "${s.table}"), 1));\n`);
  }

  await pool.close();
  stream.end();
  console.log(`\n🎉 ĐÃ XUẤT THÀNH CÔNG FILE BACKUP: ${outFile}`);
}

main().catch(console.error);
