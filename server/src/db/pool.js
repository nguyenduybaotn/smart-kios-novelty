import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;

// PostgreSQL connection config
const pgConfig = {
  host: process.env.PG_HOST || 'localhost',
  port: Number(process.env.PG_PORT || 5432),
  database: process.env.PG_DATABASE || 'VisionAIKiosk',
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'postgres',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
};

let pgPool = null;

export function getRawPgPool() {
  if (!pgPool) {
    pgPool = new Pool(pgConfig);
    pgPool.on('error', (err) => {
      console.error('[PostgreSQL Pool Error]', err.message);
    });
  }
  return pgPool;
}

// 14 bảng trong hệ thống
const TABLE_NAMES = [
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

// 104 cột chuẩn trong hệ thống
const COLUMN_NAMES = [
  "Address","Address1","Address2","AddressType","Barcode","CameraCode","CameraId","CameraId2","CameraName",
  "CapturedAt","CapturedByName","CapturedByUserId","Category","Channel","CompletedAt","CompositeMode",
  "ConnectionType","Country","CreatedAt","Currency","CustomerName","CustomerPhone","DeviceHint","District",
  "DurationSeconds","Email","ErpOid","ErpOrderNo","ErpProcessResult","ErpProcessedAt","FileName","FilePath",
  "FileSizeBytes","FinancialStatus","FirstName","FulfillmentStatus","FullName","Id_Sapo","ImageUrl","IsActive",
  "IsDefault","ItemIndex","LastLoginAt","LastName","LoaiDonHang","ModifiedOn","Name","Note","OperatorName",
  "OperatorUserId","OperatorUsername","OrderCode","OrderId","OrderItemId","ParentSapoId","PasswordHash",
  "Phone","Price","ProcessedOn","ProductId","ProductName","Province","QrPayload","QtyExpected","QtyPacked",
  "Quantity","RawJson","RelationName","ReturnReason","ReturnTrackingNumber","Role","RtspUrl","SKU",
  "SapoAddressId","SapoFulfillmentId","SapoLineItemId","SapoRefundId","SapoRelatedRecordId","SapoSyncError",
  "SapoSyncedAt","SessionId","SessionType","SnapshotId","SourceSapoId","StartedAt","Status","SyncedAt",
  "TotalDiscounts","TotalPrice","TotalRefunded","TrackingCompany","TrackingNumbers","UnitPrice","UpdatedAt",
  "UserId","Username","VariantId","VideoFileName","VideoFileName2","VideoPath","VideoPath2","VideoSizeBytes","VideoSizeBytes2","Ward"
];

const ALL_IDENTIFIERS = [...new Set([...TABLE_NAMES, ...COLUMN_NAMES])].sort((a,b)=>b.length - a.length);

// Regex tìm các identifier chưa được quote, không đứng sau @ và không phải chuỗi literal '...'
const IDENTIFIER_REGEX = new RegExp(`(?<!["'a-zA-Z0-9_@])(${ALL_IDENTIFIERS.join('|')})(?!["'a-zA-Z0-9_])`, 'g');

/**
 * Chuyển đổi cú pháp T-SQL sang PostgreSQL
 */
export function translateSql(sqlText, inputs = {}) {
  let text = String(sqlText || '');

  // 1. Loại bỏ tiền tố schema dbo.
  text = text.replace(/\bdbo\.([A-Za-z0-9_]+)/g, '"$1"');

  // 2. Xử lý parameters @name -> $1, $2, ... trước tiên
  const paramKeys = Object.keys(inputs);
  const values = [];

  if (paramKeys.length > 0) {
    const foundParams = [];
    const paramRegex = /@([A-Za-z0-9_]+)/g;
    let match;
    while ((match = paramRegex.exec(text)) !== null) {
      const pName = match[1];
      if (!foundParams.includes(pName)) {
        foundParams.push(pName);
      }
    }

    foundParams.forEach((pName, index) => {
      const paramPlaceholder = `$${index + 1}`;
      const replaceRegex = new RegExp(`@${pName}\\b`, 'g');
      text = text.replace(replaceRegex, paramPlaceholder);
      values.push(inputs[pName] !== undefined ? inputs[pName] : null);
    });
  }

  // 3. Chuẩn hóa hàm thời gian & null
  text = text.replace(/\bSYSUTCDATETIME\(\)/gi, 'CURRENT_TIMESTAMP');
  text = text.replace(/\bGETUTCDATE\(\)/gi, 'CURRENT_TIMESTAMP');
  text = text.replace(/\bGETDATE\(\)/gi, 'CURRENT_TIMESTAMP');
  text = text.replace(/\bISNULL\s*\(/gi, 'COALESCE(');

  // Chuẩn hóa so sánh boolean (IsActive=1 -> "IsActive" = true)
  text = text.replace(/\b(IsActive|IsDefault)\s*=\s*1\b/gi, '"$1" = true');
  text = text.replace(/\b(IsActive|IsDefault)\s*=\s*0\b/gi, '"$1" = false');

  // 4. Chuẩn hóa OUTPUT inserted
  text = text.replace(/\bOUTPUT\s+inserted\.\*/gi, 'RETURNING *');
  text = text.replace(/\bOUTPUT\s+inserted\.([A-Za-z0-9_]+)/gi, 'RETURNING "$1"');

  // 5. Chuẩn hóa SELECT TOP n
  const topMatch = text.match(/^\s*SELECT\s+TOP\s+(\d+)\s+/i);
  let limitValue = null;
  if (topMatch) {
    limitValue = topMatch[1];
    text = text.replace(/^\s*SELECT\s+TOP\s+\d+\s+/i, 'SELECT ');
  }

  // 6. Tự động quote các tên bảng và cột đã biết (nếu chưa quote)
  text = text.replace(IDENTIFIER_REGEX, '"$1"');

  if (limitValue !== null && !/\bLIMIT\s+\d+/i.test(text)) {
    text = `${text} LIMIT ${limitValue}`;
  }

  return { queryText: text, values };
}

// Lớp giả lập Request tương thích mssql
class PgRequest {
  constructor(clientOrPool) {
    if (clientOrPool instanceof PgTransaction) {
      this.clientOrPool = clientOrPool.client;
    } else if (clientOrPool?.rawPool) {
      this.clientOrPool = clientOrPool.rawPool;
    } else {
      this.clientOrPool = clientOrPool;
    }
    this.inputs = {};
  }

  input(name, typeOrValue, value) {
    const val = value !== undefined ? value : typeOrValue;
    this.inputs[name] = val;
    return this;
  }

  async query(sqlText) {
    const { queryText, values } = translateSql(sqlText, this.inputs);
    const result = await this.clientOrPool.query(queryText, values);
    const rows = result.rows || [];
    return {
      recordset: rows,
      recordsets: [rows],
      rowsAffected: [result.rowCount || 0],
      rowCount: result.rowCount || 0
    };
  }

  async batch(sqlText) {
    const result = await this.clientOrPool.query(sqlText);
    const rows = result.rows || [];
    return {
      recordset: rows,
      recordsets: [rows],
      rowsAffected: [result.rowCount || 0]
    };
  }
}

// Lớp Transaction giả lập tương thích mssql
class PgTransaction {
  constructor(poolWrapper) {
    this.poolWrapper = poolWrapper;
    this.client = null;
  }

  async begin() {
    this.client = await this.poolWrapper.rawPool.connect();
    await this.client.query('BEGIN');
  }

  request() {
    if (!this.client) throw new Error('Transaction chưa được bắt đầu (hãy gọi await tx.begin())');
    return new PgRequest(this.client);
  }

  async commit() {
    if (!this.client) return;
    try {
      await this.client.query('COMMIT');
    } finally {
      this.client.release();
      this.client = null;
    }
  }

  async rollback() {
    if (!this.client) return;
    try {
      await this.client.query('ROLLBACK');
    } catch (_) {
    } finally {
      this.client.release();
      this.client = null;
    }
  }
}

// Wrapper pool tương thích giao diện cũ
class PgPoolWrapper {
  constructor(pool) {
    this.rawPool = pool;
    this.connected = true;
  }

  request() {
    return new PgRequest(this.rawPool);
  }

  transaction() {
    return new PgTransaction(this);
  }

  async query(text, params) {
    return this.rawPool.query(text, params);
  }
}

let poolWrapperInstance = null;

export async function getPool() {
  if (!poolWrapperInstance) {
    const p = getRawPgPool();
    poolWrapperInstance = new PgPoolWrapper(p);
  }
  return poolWrapperInstance;
}

// Type shims tương thích với cú pháp import { sql } từ 'mssql'
export const sql = {
  NVarChar: 'VARCHAR',
  VarChar: 'VARCHAR',
  Text: 'TEXT',
  Int: 'INTEGER',
  BigInt: 'BIGINT',
  Bit: 'BOOLEAN',
  Decimal: () => 'NUMERIC',
  DateTime2: 'TIMESTAMP',
  UniqueIdentifier: 'UUID',
  MAX: 'MAX',
  Request: PgRequest,
  Transaction: PgTransaction
};

export default { getPool, sql, getRawPgPool };
