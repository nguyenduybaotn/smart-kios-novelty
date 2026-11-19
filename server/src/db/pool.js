import sql from 'mssql';
import dotenv from 'dotenv';
dotenv.config();

const config = {
  server: process.env.SQL_SERVER || 'localhost',
  port: Number(process.env.SQL_PORT || 1433),
  database: process.env.SQL_DATABASE || 'VisionAIKiosk',
  user: process.env.SQL_USER || 'sa',
  password: process.env.SQL_PASSWORD || '',
  options: {
    encrypt: String(process.env.SQL_ENCRYPT).toLowerCase() === 'true',
    trustServerCertificate: String(process.env.SQL_TRUST_CERT || 'true').toLowerCase() === 'true'
  },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }
};

let pool;
export async function getPool(){
  if(pool?.connected) return pool;
  pool = await sql.connect(config);
  return pool;
}
export { sql };
