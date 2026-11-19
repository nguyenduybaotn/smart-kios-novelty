import pg from 'pg';

const pool = new pg.Pool({
  host: process.env.PG_HOST || 'localhost',
  port: Number(process.env.PG_PORT || 5432),
  database: process.env.PG_DATABASE || 'VisionAIKiosk',
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'postgres'
});

async function main() {
  const seqs = [
    { table: 'Users', col: 'UserId' },
    { table: 'Cameras', col: 'CameraId' },
    { table: 'Orders', col: 'OrderId' },
    { table: 'OrderItems', col: 'OrderItemId' },
    { table: 'PackingSnapshots', col: 'SnapshotId' },
    { table: 'SapoAddresses', col: 'SapoAddressId' },
    { table: 'SapoRelatedRecords', col: 'SapoRelatedRecordId' }
  ];

  for (const s of seqs) {
    try {
      const q = `SELECT setval(pg_get_serial_sequence('"${s.table}"', '${s.col}'), COALESCE((SELECT MAX("${s.col}") FROM "${s.table}"), 1));`;
      const res = await pool.query(q);
      console.log(`✅ Sequence ${s.table}.${s.col} -> ${res.rows[0].setval}`);
    } catch (e) {
      console.error(`❌ Error ${s.table}.${s.col}:`, e.message);
    }
  }
  await pool.end();
}

main().catch(console.error);
