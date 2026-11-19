import dotenv from 'dotenv';
dotenv.config();
import pg from 'pg';
import { getPool as getMssqlPool } from '../db/pool.js';

const pgPool = new pg.Pool({
  host: process.env.PG_HOST || 'localhost',
  port: Number(process.env.PG_PORT || 5432),
  database: process.env.PG_DATABASE || 'VisionAIKiosk',
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'postgres'
});

async function run() {
  console.log('--- BẮT ĐẦU CHUYỂN ĐỔI DỮ LIỆU TỪ SQL SERVER SANG POSTGRESQL ---');
  const mssqlPool = await getMssqlPool();
  console.log('✅ Đã kết nối SQL Server (192.168.23.221)');

  await pgPool.query('SELECT 1');
  console.log('✅ Đã kết nối PostgreSQL (localhost:5432)');

  // 1. Tạo Schema PostgreSQL
  console.log('\n[1/4] Tạo cấu trúc bảng trên PostgreSQL...');
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS "Users" (
      "UserId" SERIAL PRIMARY KEY,
      "Username" VARCHAR(80) NOT NULL UNIQUE,
      "PasswordHash" VARCHAR(255) NOT NULL,
      "FullName" VARCHAR(255) NOT NULL,
      "Role" VARCHAR(50) NOT NULL DEFAULT 'PACKER',
      "Phone" VARCHAR(80) NULL,
      "IsActive" BOOLEAN NOT NULL DEFAULT TRUE,
      "LastLoginAt" TIMESTAMPTZ NULL,
      "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS "Cameras" (
      "CameraId" SERIAL PRIMARY KEY,
      "CameraCode" VARCHAR(80) NOT NULL UNIQUE,
      "CameraName" VARCHAR(255) NOT NULL,
      "ConnectionType" VARCHAR(30) NOT NULL DEFAULT 'RTSP',
      "RtspUrl" TEXT NULL,
      "DeviceHint" VARCHAR(255) NULL,
      "IsDefault" BOOLEAN NOT NULL DEFAULT FALSE,
      "IsActive" BOOLEAN NOT NULL DEFAULT TRUE,
      "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS "Products" (
      "ProductId" SERIAL PRIMARY KEY,
      "SKU" VARCHAR(80) NOT NULL UNIQUE,
      "Barcode" VARCHAR(120) NULL,
      "ProductName" VARCHAR(255) NOT NULL,
      "Category" VARCHAR(120) NULL,
      "Price" NUMERIC(18,2) NOT NULL DEFAULT 0,
      "ImageUrl" VARCHAR(500) NULL,
      "IsActive" BOOLEAN NOT NULL DEFAULT TRUE,
      "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS "Orders" (
      "OrderId" SERIAL PRIMARY KEY,
      "OrderCode" VARCHAR(120) NOT NULL UNIQUE,
      "Id_Sapo" BIGINT NULL,
      "TrackingNumbers" TEXT NULL,
      "ReturnTrackingNumber" VARCHAR(255) NULL,
      "SapoSyncedAt" TIMESTAMPTZ NULL,
      "SapoSyncError" TEXT NULL,
      "CustomerName" VARCHAR(255) NULL,
      "Phone" VARCHAR(80) NULL,
      "Address" VARCHAR(500) NULL,
      "Channel" VARCHAR(100) NULL,
      "Status" VARCHAR(50) NOT NULL DEFAULT 'NEW',
      "Note" TEXT NULL,
      "LoaiDonHang" VARCHAR(100) NULL,
      "ErpOid" VARCHAR(50) NULL,
      "ErpOrderNo" VARCHAR(120) NULL,
      "ErpProcessedAt" TIMESTAMPTZ NULL,
      "ErpProcessResult" TEXT NULL,
      "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "UpdatedAt" TIMESTAMPTZ NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "ux_orders_id_sapo" ON "Orders"("Id_Sapo") WHERE "Id_Sapo" IS NOT NULL;

    CREATE TABLE IF NOT EXISTS "OrderItems" (
      "OrderItemId" SERIAL PRIMARY KEY,
      "OrderId" INT NOT NULL REFERENCES "Orders"("OrderId") ON DELETE CASCADE,
      "SKU" VARCHAR(80) NOT NULL,
      "Barcode" VARCHAR(120) NULL,
      "ProductName" VARCHAR(255) NOT NULL,
      "QtyExpected" INT NOT NULL DEFAULT 1,
      "QtyPacked" INT NOT NULL DEFAULT 0,
      "UnitPrice" NUMERIC(18,2) NOT NULL DEFAULT 0,
      "Status" VARCHAR(50) NOT NULL DEFAULT 'PENDING'
    );

    CREATE TABLE IF NOT EXISTS "PackingSessions" (
      "SessionId" UUID NOT NULL PRIMARY KEY,
      "OrderId" INT NOT NULL REFERENCES "Orders"("OrderId"),
      "CameraId" INT NULL REFERENCES "Cameras"("CameraId"),
      "CameraId2" INT NULL REFERENCES "Cameras"("CameraId"),
      "OperatorUserId" INT NULL REFERENCES "Users"("UserId"),
      "OrderCode" VARCHAR(120) NOT NULL,
      "StartedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "CompletedAt" TIMESTAMPTZ NULL,
      "Status" VARCHAR(50) NOT NULL DEFAULT 'RECORDING',
      "VideoPath" TEXT NULL,
      "VideoFileName" VARCHAR(255) NULL,
      "VideoPath2" TEXT NULL,
      "VideoFileName2" VARCHAR(255) NULL,
      "VideoSizeBytes" BIGINT NULL,
      "VideoSizeBytes2" BIGINT NULL,
      "CompositeMode" VARCHAR(40) NULL,
      "SessionType" VARCHAR(30) NOT NULL DEFAULT 'PACKING',
      "ReturnTrackingNumber" VARCHAR(255) NULL,
      "ReturnReason" VARCHAR(500) NULL,
      "DurationSeconds" INT NULL,
      "QrPayload" VARCHAR(500) NULL,
      "OperatorName" VARCHAR(255) NULL,
      "OperatorUsername" VARCHAR(80) NULL,
      "CustomerName" VARCHAR(255) NULL,
      "CustomerPhone" VARCHAR(80) NULL,
      "Note" TEXT NULL
    );

    DROP TABLE IF EXISTS "PackingSnapshots";
    CREATE TABLE "PackingSnapshots" (
      "SnapshotId" SERIAL PRIMARY KEY,
      "SessionId" UUID NOT NULL REFERENCES "PackingSessions"("SessionId") ON DELETE CASCADE,
      "OrderId" INT NOT NULL REFERENCES "Orders"("OrderId"),
      "OrderCode" VARCHAR(120) NOT NULL,
      "FileName" VARCHAR(255) NOT NULL,
      "FilePath" TEXT NOT NULL,
      "FileSizeBytes" BIGINT NULL,
      "CapturedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "CapturedByUserId" INT NULL REFERENCES "Users"("UserId"),
      "CapturedByName" VARCHAR(255) NULL,
      "Note" TEXT NULL
    );

    -- Các bảng phụ Sapo
    CREATE TABLE IF NOT EXISTS "SapoOrderPayloads" (
      "OrderId" INT PRIMARY KEY REFERENCES "Orders"("OrderId") ON DELETE CASCADE,
      "Id_Sapo" BIGINT NOT NULL,
      "FinancialStatus" VARCHAR(80),
      "FulfillmentStatus" VARCHAR(80),
      "Currency" VARCHAR(20),
      "TotalPrice" NUMERIC(18,2),
      "TotalDiscounts" NUMERIC(18,2),
      "ProcessedOn" TIMESTAMPTZ,
      "ModifiedOn" TIMESTAMPTZ,
      "RawJson" TEXT NOT NULL,
      "SyncedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS "SapoCustomers" (
      "OrderId" INT PRIMARY KEY REFERENCES "Orders"("OrderId") ON DELETE CASCADE,
      "Id_Sapo" BIGINT NULL,
      "Email" VARCHAR(255),
      "Phone" VARCHAR(80),
      "FirstName" VARCHAR(255),
      "LastName" VARCHAR(255),
      "RawJson" TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS "SapoAddresses" (
      "SapoAddressId" BIGSERIAL PRIMARY KEY,
      "OrderId" INT NOT NULL REFERENCES "Orders"("OrderId") ON DELETE CASCADE,
      "AddressType" VARCHAR(40),
      "Address1" VARCHAR(500),
      "Address2" VARCHAR(500),
      "Ward" VARCHAR(255),
      "District" VARCHAR(255),
      "Province" VARCHAR(255),
      "Country" VARCHAR(255),
      "Phone" VARCHAR(80),
      "RawJson" TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS "SapoLineItems" (
      "SapoLineItemId" BIGINT PRIMARY KEY,
      "OrderId" INT NOT NULL REFERENCES "Orders"("OrderId") ON DELETE CASCADE,
      "ProductId" BIGINT,
      "VariantId" BIGINT,
      "SKU" VARCHAR(255),
      "Barcode" VARCHAR(255),
      "Name" VARCHAR(500),
      "Quantity" INT,
      "Price" NUMERIC(18,2),
      "RawJson" TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS "SapoFulfillments" (
      "SapoFulfillmentId" BIGINT PRIMARY KEY,
      "OrderId" INT NOT NULL REFERENCES "Orders"("OrderId") ON DELETE CASCADE,
      "Status" VARCHAR(80),
      "TrackingCompany" VARCHAR(255),
      "TrackingNumbers" TEXT,
      "RawJson" TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS "SapoRefunds" (
      "SapoRefundId" BIGINT PRIMARY KEY,
      "OrderId" INT NOT NULL REFERENCES "Orders"("OrderId") ON DELETE CASCADE,
      "Note" TEXT,
      "TotalRefunded" NUMERIC(18,2),
      "RawJson" TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS "SapoRelatedRecords" (
      "SapoRelatedRecordId" BIGSERIAL PRIMARY KEY,
      "OrderId" INT NOT NULL REFERENCES "Orders"("OrderId") ON DELETE CASCADE,
      "RelationName" VARCHAR(120) NOT NULL,
      "ParentSapoId" BIGINT NULL,
      "SourceSapoId" BIGINT NULL,
      "ItemIndex" INT NOT NULL,
      "RawJson" TEXT NOT NULL
    );
  `);
  console.log('✅ Đã tạo xong schema trên PostgreSQL!');

  // Helper migrate bảng
  async function migrateTable(tableName, idCol = null) {
    process.stdout.write(`Đang chuyển bảng "${tableName}"... `);
    let rows = [];
    try {
      const rs = await mssqlPool.request().query(`SELECT * FROM dbo.[${tableName}]`);
      rows = rs.recordset || [];
    } catch (e) {
      console.log(`(Bảng không tồn tại trên SQL Server, bỏ qua)`);
      return;
    }

    if (rows.length === 0) {
      console.log(`(0 dòng)`);
      return;
    }

    // Xóa dữ liệu cũ trên Postgres trước khi nạp để tránh trùng lặp
    await pgPool.query(`TRUNCATE TABLE "${tableName}" CASCADE`);

    const cols = Object.keys(rows[0]);
    const colNames = cols.map(c => `"${c}"`).join(', ');

    let inserted = 0;
    // Insert theo lô 100 dòng
    const batchSize = 100;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      for (const row of batch) {
        const placeholders = cols.map((_, idx) => `$${idx + 1}`).join(', ');
        const values = cols.map(c => {
          let val = row[c];
          if (val === undefined) return null;
          if (val instanceof Date) {
            return Number.isNaN(val.getTime()) ? null : val.toISOString();
          }
          // Chuyển UUID hoặc Buffer về chuỗi
          if (val && typeof val === 'object') {
            if (Buffer.isBuffer(val)) return val;
            return val.toString();
          }
          return val;
        });
        await pgPool.query(`INSERT INTO "${tableName}" (${colNames}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`, values);
        inserted++;
      }
    }

    // Reset sequence nếu có
    if (idCol) {
      await pgPool.query(`
        SELECT setval(
          pg_get_serial_sequence('"${tableName}"', '${idCol}'),
          COALESCE((SELECT MAX("${idCol}") FROM "${tableName}"), 1),
          true
        )
      `).catch(() => {});
    }

    console.log(`✅ Thành công (${inserted}/${rows.length} dòng)`);
  }

  // 2. Chuyển đổi dữ liệu theo thứ tự quan hệ khóa ngoại
  console.log('\n[2/4] Chuyển đổi dữ liệu từ SQL Server sang PostgreSQL...');
  await migrateTable('Users', 'UserId');
  await migrateTable('Cameras', 'CameraId');
  await migrateTable('Products', 'ProductId');
  await migrateTable('Orders', 'OrderId');
  await migrateTable('OrderItems', 'OrderItemId');
  await migrateTable('PackingSessions', null); // UUID PK
  await migrateTable('PackingSnapshots', 'SnapshotId');
  await migrateTable('SapoOrderPayloads', null);
  await migrateTable('SapoCustomers', null);
  await migrateTable('SapoAddresses', 'SapoAddressId');
  await migrateTable('SapoLineItems', null);
  await migrateTable('SapoFulfillments', null);
  await migrateTable('SapoRefunds', null);
  await migrateTable('SapoRelatedRecords', 'SapoRelatedRecordId');

  console.log('\n[3/4] Kiểm tra số lượng dữ liệu sau khi chuyển đổi:');
  const checkTables = ['Users', 'Cameras', 'Products', 'Orders', 'OrderItems', 'PackingSessions', 'PackingSnapshots'];
  for (const t of checkTables) {
    const res = await pgPool.query(`SELECT count(*) as count FROM "${t}"`);
    console.log(`  - Bảng "${t}": ${res.rows[0].count} dòng`);
  }

  console.log('\n--- HOÀN TẤT CHUYỂN ĐỔI DỮ LIỆU THÀNH CÔNG ---');
  process.exit(0);
}

run().catch(e => {
  console.error('\n❌ LỖI TRONG QUÁ TRÌNH CHUYỂN ĐỔI:', e);
  process.exit(1);
});
