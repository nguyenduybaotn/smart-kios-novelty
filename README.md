# Vision AI Kiosk POS + Packing Verify v5

Web app React + NodeJS + SQL Server cho mô hình POS nhận diện/đóng gói bằng camera.

## Tính năng chính

- Đăng nhập / đăng xuất bằng tài khoản nhân viên.
- Quản lý tài khoản: admin, nhân viên đóng hàng.
- Khai báo đơn hàng bằng nhập tay, import Excel hoặc API.
- Quét QR/mã vạch đơn hàng để truy xuất thông tin đóng gói.
- Khai báo camera theo 2 chế độ:
  - `RTSP`: IP Camera/NVR/Camera công nghiệp.
  - `DIRECT`: camera trực tiếp trên điện thoại, tablet, laptop qua trình duyệt.
- Quay video đóng gói theo mã đơn hàng.
- Lưu video theo QR/mã đơn hàng.
- Nén video RTSP bằng FFmpeg H.264, CRF/preset cấu hình được.
- Lịch sử video đóng gói có thông tin khách hàng, số điện thoại, nhân viên đóng hàng, tài khoản, camera, loại kết nối.
- Tìm kiếm nhanh lịch sử video theo keyword.
- Giao diện 3D neon theo tone NBC/Nhabe Corporation, có nhúng logo, responsive ưu tiên tablet/mobile.
- Camera trực tiếp cho phép chọn nhiều nguồn camera/webcam/USB camera trên desktop.

## Mới trong v5 - NBC theme + chọn nhiều nguồn camera trực tiếp

### Camera trực tiếp / USB

Khi chọn camera `DIRECT`, trình duyệt dùng `enumerateDevices()` để liệt kê nhiều nguồn camera: webcam laptop, camera USB gắn ngoài, camera trước/sau tablet/điện thoại. User chọn đúng nguồn camera trước khi bấm bắt đầu quay. Sau đó web dùng `getUserMedia` + `MediaRecorder` để xem preview trực tiếp và ghi video.

### Camera RTSP

Khi chọn camera `RTSP`, server chạy 2 tiến trình FFmpeg:

1. Tiến trình ghi file MP4 nén H.264 để lưu bằng chứng đóng gói.
2. Tiến trình HLS Gateway để phát live preview lên web.

Luồng live được xuất tại:

```txt
/live/{sessionId}/index.m3u8
```

Client React dùng `hls.js` để xem live preview trên Chrome/Edge/Android. Safari/iOS có thể phát HLS native.

> Lưu ý: RTSP không phát trực tiếp được trong thẻ video HTML5. Vì vậy cần gateway HLS hoặc WebRTC. Bản v4 dùng HLS vì dễ triển khai với FFmpeg, phù hợp mạng LAN nhà máy.

## Cấu trúc

```txt
vision-ai-kiosk-pos/
  client/                 React + Vite + Ant Design + hls.js
  server/                 NodeJS + Express + SQL Server + FFmpeg
    src/services/video.service.js   Ghi video RTSP MP4
    src/services/live.service.js    RTSP -> HLS live preview
    storage/videos/       Video đã lưu
    storage/live/         Segment HLS live tạm thời
```

## Chạy SQL

Chạy file:

```txt
server/src/db/schema.sql
```

Tài khoản demo:

```txt
admin / 123456
packer01 / 123456
```

## Chạy server

```bash
cd server
copy .env.example .env
npm install
npm run dev
```

Cần cài FFmpeg và đảm bảo chạy được lệnh:

```bash
ffmpeg -version
```

Cấu hình `.env` quan trọng:

```env
PORT=8095
CLIENT_ORIGIN=http://localhost:5173
STORAGE_DIR=./storage
FFMPEG_PATH=ffmpeg
VIDEO_CRF=23
VIDEO_PRESET=veryfast
VIDEO_MAX_WIDTH=1280
LIVE_MAX_WIDTH=960
LIVE_FPS=12
LIVE_HLS_TIME=1
LIVE_HLS_LIST_SIZE=6
```

## Chạy client

```bash
cd client
npm install
npm run dev
```

Mở:

```txt
http://localhost:5173
```

## Gợi ý triển khai thực tế

- Với tablet/điện thoại dùng camera trực tiếp: nên chạy HTTPS để trình duyệt cho phép camera.
- Với RTSP camera: server phải nằm cùng LAN hoặc có quyền truy cập RTSP URL.
- Nếu camera RTSP không cho phép nhiều kết nối đồng thời, nên chuyển sang kiến trúc WebRTC/HLS dùng một FFmpeg input và tee output nâng cao.
- Nếu cần độ trễ thấp hơn HLS, có thể nâng cấp thêm WebRTC Gateway như MediaMTX, Janus hoặc go2rtc.

## V7 - Kiểm barcode sản phẩm, pause/resume, chụp hình đóng gói

Bản V7 bổ sung:

- Tại màn hình đóng gói có ô quét barcode/SKU sản phẩm trong đơn hàng.
- Khi quét đúng sản phẩm trong đơn, hệ thống tự cộng `QtyPacked`.
- Khi đủ số lượng, dòng sản phẩm tự chuyển `PASS`.
- Nút **Đủ hàng** để set tất cả dòng sản phẩm của đơn thành đã kiểm đủ/PASS.
- Nút **Tạm dừng / Quay tiếp** trong lúc quay video. Với camera trực tiếp/USB, trình duyệt pause/resume `MediaRecorder`.
- Nút **Chụp hình** trong lúc quay:
  - Camera trực tiếp/USB: chụp từ khung hình live preview trên trình duyệt, nén JPEG quality 0.82.
  - RTSP: server dùng FFmpeg chụp snapshot JPEG từ RTSP, scale tối đa 1280px để tiết kiệm dung lượng.
- Bổ sung bảng `PackingSnapshots` để lưu hình chụp theo phiên đóng gói / đơn hàng.
- Trang lịch sử video có:
  - Avatar hình đầu tiên đã chụp.
  - Nút **Xem hình** để mở gallery/slideshow các hình đã chụp của phiên đóng gói.

Lưu ý cập nhật SQL: chạy lại file `server/src/db/schema.sql` hoặc bổ sung thủ công các cột/bảng mới nếu đang dùng database cũ:

- `Products.Barcode`
- `OrderItems.Barcode`
- `PackingSnapshots`

Barcode demo:

```text
893000000001 -> SKU-AO-001
893000000002 -> SKU-QUAN-002
893000000003 -> SKU-NON-003
```

## v9 - Quét QR mã đơn bằng camera đóng gói trước khi quay

Bản này bổ sung luồng mới tại màn hình Đóng gói:

1. Chọn camera đóng gói trong bảng Camera.
2. Bấm **Mở khung quét QR đơn hàng** hoặc **Quét bằng camera đóng gói**.
3. Đưa QR Code/mã đơn vào đúng khung ROI màu xanh.
4. Hệ thống tự đọc mã, truy xuất đơn hàng và hiển thị thông tin sản phẩm.
5. Sau khi kiểm đúng đơn, bấm **Bắt đầu quay đóng gói**.

Ghi chú:
- Với camera `DIRECT` / USB / webcam / camera tablet, việc quét QR chạy trực tiếp trên trình duyệt bằng `html5-qrcode`.
- Trình duyệt mobile/tablet cần chạy qua HTTPS hoặc localhost để được cấp quyền camera.
- Với RTSP, bản này vẫn cho xem live preview qua HLS. Nếu muốn quét QR trực tiếp từ luồng RTSP không cần browser camera, có thể mở rộng thêm server-side QR gateway bằng OpenCV/ZXing ở server.

## v10 - Chọn nguồn camera khi quét QR đơn hàng

Ở màn hình đóng gói, chức năng **Quét bằng camera đóng gói** đã có thêm combobox chọn nguồn camera trực tiếp/USB giống phần quay video.

- Laptop có nhiều webcam/USB camera sẽ liệt kê trong danh sách.
- Có nút **Quét lại camera** để cấp quyền và tải lại danh sách thiết bị.
- Camera được chọn dùng chung cho bước quét QR mã đơn và bước quay video đóng gói.
- Trên Chrome mobile/tablet cần chạy HTTPS hoặc localhost để trình duyệt cho phép truy cập camera.

## Đồng bộ đơn hàng Sapo

Cấu hình thông tin API trong `server/.env` theo `server/.env.example`:

```env
SAPO_BASE_URL=https://your-store.mysapo.net
SAPO_API_KEY=your-api-key
SAPO_API_SECRET=your-api-secret
```

Nhập `ID Sapo` cho đơn hàng, sau đó bấm **Đồng bộ Sapo** tại trang Đơn hàng. Hệ thống chỉ duyệt các đơn có `Id_Sapo` và chưa có `SapoSyncedAt`, gọi `/admin/orders/{Id_Sapo}.json`, lưu dữ liệu chuẩn hóa cùng JSON gốc, rồi cập nhật mã vận đơn từ `tracking_numbers`. Màn hình đóng gói có thể quét mã vận đơn để tìm đơn.

Luồng đồng bộ theo ngày đọc danh sách `Id_Sapo` từ database ERP qua procedure `SAPO_GetDanhSachDonHang_TheoNgay`. Cấu hình kết nối bằng các biến `ERP_SQL_*`; procedure hiện dùng tham số `@Date` kiểu `datetime`, cấu hình qua `ERP_SAPO_SYNC_DATE_PARAM=Date`.

## v11 - Chức năng "Hàng hoàn" (Kiểm tra & quay clip đơn hàng hoàn trả)

Bản v11 bổ sung quy trình xử lý chuyên biệt cho đơn hàng hoàn trả từ các sàn TMĐT (Shopee, TikTok, Lazada, v.v.):

1. **Tab "Hàng hoàn" mới:**
   - Nhân viên quét hoặc nhập barcode mã vận đơn hàng hoàn (Return Tracking Number).
   - Hệ thống tự động tra cứu xem mã vận đơn hoàn này đã được map với đơn hàng nào trong hệ thống hay chưa.
2. **Map chọn với đơn hàng trước khi hoàn:**
   - Nếu mã vận đơn hoàn là mã mới chưa map: hệ thống mở modal tìm kiếm đơn hàng. Nhân viên tìm kiếm theo Mã đơn hàng, Mã vận đơn gốc lúc gửi đi, Số điện thoại hoặc Tên khách hàng.
   - Nhân viên bấm **"Map đơn này"**: hệ thống lưu liên kết giữa mã vận đơn hoàn và đơn hàng gốc vào cơ sở dữ liệu (`Orders.ReturnTrackingNumber`).
3. **Quay clip kiểm tra & mở hộp (Unboxing Verification):**
   - Hiển thị danh sách sản phẩm gốc để nhân viên mở gói hàng ra đối soát.
   - Hỗ trợ quét barcode/SKU từng sản phẩm lấy ra từ hộp để đếm số lượng kiểm nhận và đối chiếu với số lượng đã gửi đi.
   - Ghi hình bằng Camera 1 + Camera 2 (Webcam ghép Canvas PIP hoặc Camera IP RTSP), tự động vẽ watermark "HÀNG HOÀN • [Mã vận đơn hoàn] • [Ngày giờ]".
   - Hỗ trợ **Chụp hình bằng chứng** (Snapshot) để ghi nhận tem nhãn, bao bì rách vỡ hoặc tình trạng sản phẩm bị hư hỏng.
   - Nút **Tạm dừng / Quay tiếp** và **Hoàn tất & Lưu video**.
4. **Quản lý & Tải video:**
   - Phiên ghi hình được đánh dấu `SessionType = 'RETURN'`, lưu `ReturnTrackingNumber`.
   - Trạng thái đơn chuyển sang `RETURN_CHECKED`.
   - Trang **Lịch sử Video** hiển thị Tag `HÀNG HOÀN`, cột `Vận đơn hoàn`, cho phép tìm kiếm và tải video với tên file tải về chứa mã vận đơn hoàn để thuận tiện gửi khiếu nại sàn.
