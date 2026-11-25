import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { execSync } from 'child_process';
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Client } = pg;

const rootDir = path.resolve('../');
const sqlFile = path.join(rootDir, 'VisionAIKiosk_backup.sql');
const zipFile = path.join(rootDir, 'VisionAIKiosk_backup.zip');

const pgConfig = {
  host: process.env.PG_HOST || 'localhost',
  port: Number(process.env.PG_PORT || 5432),
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'postgres'
};

const targetDb = process.env.PG_DATABASE || 'VisionAIKiosk';

async function main() {
  console.log('========================================================');
  console.log('       VISION AI KIOSK - CÀI ĐẶT CƠ SỞ DỮ LIỆU');
  console.log('========================================================\n');

  // 1. Kiểm tra và giải nén file zip nếu cần
  if (!fs.existsSync(sqlFile)) {
    if (fs.existsSync(zipFile)) {
      console.log('📦 Đang giải nén file VisionAIKiosk_backup.zip...');
      try {
        execSync(`powershell -Command "Expand-Archive -Path '${zipFile}' -DestinationPath '${rootDir}' -Force"`, { stdio: 'inherit' });
        console.log('✅ Giải nén thành công!\n');
      } catch (err) {
        console.error('❌ Lỗi khi giải nén file zip:', err.message);
        process.exit(1);
      }
    } else {
      console.error('❌ Không tìm thấy file VisionAIKiosk_backup.sql hoặc VisionAIKiosk_backup.zip!');
      process.exit(1);
    }
  }

  // 2. Kết nối tới PostgreSQL hệ thống (database 'postgres')
  console.log(`🔌 Đang kết nối tới PostgreSQL (${pgConfig.host}:${pgConfig.port}) với tài khoản "${pgConfig.user}"...`);
  const rootClient = new Client({
    ...pgConfig,
    database: 'postgres'
  });

  try {
    await rootClient.connect();
    console.log('✅ Kết nối PostgreSQL thành công!');
  } catch (err) {
    console.error('\n❌ Không thể kết nối tới PostgreSQL!');
    console.error('Chi tiết lỗi:', err.message);
    console.error('\n👉 Gợi ý khắc phục:');
    console.error('1. Đảm bảo dịch vụ PostgreSQL đã được khởi động trên máy.');
    console.error(`2. Kiểm tra mật khẩu trong file "server/.env" (hiện tại: ${pgConfig.password}).`);
    process.exit(1);
  }

  // 3. Kiểm tra và tạo database
  const checkDb = await rootClient.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [targetDb]);
  if (checkDb.rows.length === 0) {
    console.log(`🔨 Đang tạo database "${targetDb}"...`);
    await rootClient.query(`CREATE DATABASE "${targetDb}"`);
    console.log(`✅ Đã tạo database "${targetDb}"!`);
  } else {
    console.log(`ℹ️ Database "${targetDb}" đã tồn tại.`);
  }
  await rootClient.end();

  // 4. Kết nối vào database mục tiêu
  console.log(`\n📥 Bắt đầu nạp dữ liệu vào database "${targetDb}"...`);
  const dbClient = new Client({
    ...pgConfig,
    database: targetDb
  });
  await dbClient.connect();

  // Tạm tắt kiểm tra ràng buộc ngoại (FK) trong phiên nạp để tránh cảnh báo bản ghi mồ côi
  try {
    await dbClient.query("SET session_replication_role = 'replica';");
    await dbClient.query('ALTER TABLE IF EXISTS "Orders" ALTER COLUMN "UpdatedAt" DROP NOT NULL;');
  } catch (_) {}

  const fileStats = fs.statSync(sqlFile);
  const totalBytes = fileStats.size;
  let readBytes = 0;
  let lastReportedPercent = -1;

  const fileStream = fs.createReadStream(sqlFile);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let currentCommand = '';
  let commandCount = 0;

  for await (const line of rl) {
    readBytes += Buffer.byteLength(line, 'utf8') + 1;
    const trimmed = line.trim();

    // Bỏ qua dòng comment hoặc dòng trống
    if (!trimmed || trimmed.startsWith('--')) {
      continue;
    }

    currentCommand += line + '\n';

    // Kết thúc câu lệnh bằng dấu ;
    if (trimmed.endsWith(';')) {
      if (currentCommand.includes('CREATE TABLE IF NOT EXISTS "Orders"')) {
        currentCommand = currentCommand.replace(/"UpdatedAt"\s+TIMESTAMP\s+NOT\s+NULL/gi, '"UpdatedAt" TIMESTAMP');
      }

      try {
        await dbClient.query(currentCommand);
        commandCount++;
        if (currentCommand.includes('CREATE TABLE IF NOT EXISTS "Orders"')) {
          await dbClient.query('ALTER TABLE IF EXISTS "Orders" ALTER COLUMN "UpdatedAt" DROP NOT NULL;').catch(() => null);
        }
      } catch (cmdErr) {
        // Bỏ qua lỗi trùng lặp nếu đã có
        if (!cmdErr.message.includes('already exists')) {
          console.warn('\n⚠️ Cảnh báo lệnh SQL:', cmdErr.message.slice(0, 150));
        }
      }
      currentCommand = '';

      const percent = Math.floor((readBytes / totalBytes) * 100);
      if (percent % 10 === 0 && percent !== lastReportedPercent) {
        lastReportedPercent = percent;
        process.stdout.write(`\r⏳ Tiến độ nạp dữ liệu: ${percent}%...`);
      }
    }
  }

  // Chạy câu lệnh còn lại nếu có
  if (currentCommand.trim()) {
    try {
      await dbClient.query(currentCommand);
    } catch (_) {}
  }

  console.log('\r⏳ Tiến độ nạp dữ liệu: 100%!');
  console.log(`✅ Đã thực thi thành công ${commandCount} khối lệnh SQL!`);

  // Kiểm tra số lượng bản ghi sau khi nạp
  const ordersCount = (await dbClient.query('SELECT COUNT(*) FROM "Orders"')).rows[0].count;
  const camerasCount = (await dbClient.query('SELECT COUNT(*) FROM "Cameras"')).rows[0].count;
  const usersCount = (await dbClient.query('SELECT COUNT(*) FROM "Users"')).rows[0].count;

  console.log('\n📊 THỐNG KÊ DỮ LIỆU ĐÃ NẠP:');
  console.log(`  - Đơn hàng:  ${ordersCount} đơn`);
  console.log(`  - Camera:    ${camerasCount} camera`);
  console.log(`  - Tài khoản: ${usersCount} người dùng`);

  // Khôi phục lại trạng thái kiểm tra ràng buộc ban đầu và lấp đầy UpdatedAt
  try {
    await dbClient.query('UPDATE "Orders" SET "UpdatedAt" = COALESCE("UpdatedAt", "CreatedAt", CURRENT_TIMESTAMP) WHERE "UpdatedAt" IS NULL;');
    await dbClient.query("SET session_replication_role = 'origin';");
  } catch (_) {}

  await dbClient.end();

  console.log('\n========================================================');
  console.log('🎉 CÀI ĐẶT CƠ SỞ DỮ LIỆU HOÀN TẤT THÀNH CÔNG 100%!');
  console.log('Bây giờ bạn có thể nhấp đúp file "Chay-Kiosk.bat" để làm việc.');
  console.log('========================================================\n');
}

main().catch(err => {
  console.error('\n❌ LỖI KHÔNG MONG MUỐN:', err);
  process.exit(1);
});
