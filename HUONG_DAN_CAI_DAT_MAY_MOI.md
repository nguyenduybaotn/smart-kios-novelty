# HƯỚNG DẪN CÀI ĐẶT VÀ CHẠY SMART KIOSK NOVELTY TRÊN MÁY MỚI

Tài liệu này hướng dẫn chi tiết cách đem thư mục dự án **SmartVideo1** sang bất kỳ máy tính Windows nào khác (ví dụ: máy đóng gói Core i5, RAM 8GB) để chạy trơn tru, ổn định chỉ với vài bước đơn giản.

---

## 1. Yêu cầu phần mềm trên máy mới
Trước khi chạy, hãy cài đặt 2 phần mềm miễn phí sau trên máy mới:
1. **Node.js (Bản LTS)**: Tải và cài đặt từ [https://nodejs.org/](https://nodejs.org/) (chọn bản LTS, bấm Next tới khi xong).
2. **PostgreSQL cho Windows**: Tải từ [https://www.postgresql.org/download/windows/](https://www.postgresql.org/download/windows/) (chọn bản 14, 15, 16 hoặc 17).
   - Trong lúc cài đặt, đặt mật khẩu là `postgres` (hoặc mật khẩu tuỳ ý bạn chọn, cổng mặc định `5432`).
3. **FFmpeg** (nếu máy có dùng Camera IP qua RTSP):
   - Tải file `ffmpeg.exe` đặt vào `server/` hoặc thêm vào biến môi trường PATH của Windows. Với Camera USB cắm trực tiếp thì không cần.

---

## 2. Các bước cài đặt (Chỉ cần làm 1 lần duy nhất)

### Bước 1: Sao chép thư mục dự án sang máy mới
- Copy toàn bộ thư mục `SmartVideo1` sang ổ đĩa của máy mới (ví dụ `D:\SmartVideo1` hoặc `C:\SmartVideo1`).

### Bước 2: Nạp dữ liệu vào PostgreSQL
- Nhấp đúp chuột vào file: **`Cai-Dat-Database.bat`**
- Nhập mật khẩu postgres bạn vừa đặt ở trên (mặc định là `postgres`), script sẽ tự động tạo database `VisionAIKiosk` và nạp toàn bộ hơn **6,000 đơn hàng cũ, camera, tài khoản người dùng** từ file `VisionAIKiosk_backup.sql`.

### Bước 3: Cấu hình file `server/.env` (nếu cần)
- Mở file `server/.env`, kiểm tra:
  ```env
  PG_HOST=localhost
  PG_PORT=5432
  PG_DATABASE=VisionAIKiosk
  PG_USER=postgres
  PG_PASSWORD=postgres
  ```
  *(Nếu đặt mật khẩu postgres khác thì đổi `PG_PASSWORD` tương ứng)*.

---

## 3. Khởi động và sử dụng hàng ngày (1-Click)

Mỗi ngày khi bật máy để đóng gói:
- Chỉ cần **nhấp đúp chuột vào file `Chay-Kiosk.bat`** (hoặc tạo Shortcut ra ngoài Desktop).
- Hệ thống sẽ:
  1. Tự động bật máy chủ Kiosk nền tại cổng `8095`.
  2. Tự động mở Google Chrome (hoặc Edge) toàn màn hình vào thẳng hệ thống: [http://localhost:8095](http://localhost:8095).
  3. Đăng nhập với tài khoản:
     - **Tài khoản**: `admin`
     - **Mật khẩu**: `123456`

---

## 4. Các điểm tối ưu đặc biệt cho máy yếu (Core i5, RAM 8GB, HDD)
- Giao diện người dùng đã được đóng gói tĩnh (`client/dist`) và chạy chung trên cổng `8095` với Server -> Tiết kiệm 1.5GB RAM so với chạy bản dev.
- Chuẩn nén video đã được ép dùng **H.264 phần cứng (Intel QuickSync)** -> CPU không bị chạm 100%.
- Bitrate video đã được giảm xuống mức an toàn (tổng ghi < 0.7 MB/s) -> Ổ cứng HDD không bị nghẽn đĩa 100%.
- Bỏ hiệu ứng đổ bóng `shadowBlur` và khóa 25 FPS -> Vẽ mượt mà, không giật lag.
