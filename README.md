# Halloween iNET 2026 — "Đập Bí Ngô" săn voucher

Minigame Halloween (lấy cảm hứng từ trò Đập chuột) nhúng vào Portal iNET, kèm trang quản trị theo dõi chiến dịch realtime.

- **Game**: `/` — 9 ô (3×3), bí ngô và vật phẩm Halloween trồi lên/lặn xuống, combo, bom, độ khó tăng dần, lượt chơi hồi theo thời gian, voucher theo mốc 200 / 450 / 700 điểm.
- **Admin**: `/hlw-admin-quantri128/` (đổi được bằng biến `ADMIN_PATH`) — thống kê realtime, quản lý người chơi / lượt chơi / coupon, cấu hình game không cần sửa code, mô phỏng độ khó, nhật ký thao tác, phân quyền.
- **Chống gian lận**: máy chủ tự tính lại điểm từ log thao tác (không tin điểm do trình duyệt gửi), lượt chơi và coupon chỉ được cấp ở máy chủ; phát hiện auto click / tăng tốc / sửa dữ liệu thì dừng lượt ngay, huỷ kết quả, báo cho người chơi và tự khoá tài khoản sau 3 lần. Mã coupon trong trang quản trị luôn được che, chỉ Quản lý bấm "Hiện" mới xem được (có ghi nhật ký).

Không phụ thuộc thư viện ngoài: chỉ cần **Node.js ≥ 22.13** (khuyến nghị Node 24 LTS). Cơ sở dữ liệu SQLite tích hợp sẵn trong Node.

## Chạy thử nhanh (máy local)

```bash
npm start
```

- Mở game: http://localhost:8080 (mặc định vào là chơi: mỗi trình duyệt là 1 người chơi; khi Portal gửi token thì dùng tài khoản Portal).
- Mở admin: http://localhost:8080/hlw-admin-quantri128/ → tài khoản `admin`, mật khẩu tạm nằm trong `data/INITIAL_ADMIN_PASSWORD.txt` (bắt buộc đổi ở lần đăng nhập đầu, sau đó xoá file này).
- Muốn xem dashboard có số liệu: `npm run seed-demo` (tạo 300 người chơi giả, gắn cờ test, xoá được bằng 1 nút trong Admin).
- Thử luồng đăng nhập giống Portal: `npm run portal-token -- KH123456` rồi mở link được in ra.
- Chạy bộ kiểm thử tự động (31 bài: chấm điểm phía server, gian lận, coupon, phân quyền...): `npm test`.

## Cấu trúc

```
server/            Máy chủ Node (không framework)
  index.js         Định tuyến, file tĩnh, API cho game, job định kỳ
  game.js          Vòng đời lượt chơi: start / sync / finish, tái hiện ván chơi, phân tích gian lận
  coupons.js       Cấp coupon (mock | kho mã | API billing), mã hoá mã, đánh dấu đã dùng
  players.js       Đăng nhập bằng token Portal, token phiên chơi, lượt chơi hồi theo thời gian
  admin.js         API quản trị: đăng nhập, phân quyền, CSRF, thống kê, cấu hình, xuất CSV, sao lưu
  stats.js         Truy vấn thống kê (giờ Việt Nam)
  settings.js      Cấu hình mặc định, kiểm tra hợp lệ, lịch sử phiên bản
  security.js      JWT, scrypt, AES-256-GCM, HMAC, rate limit
shared/engine.js   Bộ máy game TẤT ĐỊNH dùng chung cho trình duyệt và máy chủ
public/            Giao diện người chơi (index.html, css, js) + assets thiết kế
public/admin/      Trang quản trị (SPA thuần + biểu đồ SVG tự viết)
scripts/           selftest, seed-demo, portal-token, create-admin
docs/              Tài liệu tích hợp, bảo mật, vận hành
data/              SQLite + secret dev (tự tạo, không commit)
```

## Thay hình ảnh & âm thanh

Đặt file vào `public/assets/img` và `public/assets/audio`, khai báo đường dẫn trong `public/assets/assets.json`. Ô nào để trống sẽ dùng hình vẽ/âm thanh mặc định. Danh sách đầy đủ và kích thước khuyến nghị: [public/assets/README.md](public/assets/README.md).

## Tài liệu

| Tài liệu | Nội dung |
| --- | --- |
| [docs/TICH-HOP-PORTAL.md](docs/TICH-HOP-PORTAL.md) | Portal ký token, nhúng iframe, code mẫu PHP/Node/C#, webhook billing |
| [docs/BAO-MAT.md](docs/BAO-MAT.md) | Thiết kế chống gian lận & bảo mật, rủi ro còn lại |
| [docs/VAN-HANH.md](docs/VAN-HANH.md) | Triển khai lên VPS (nginx, HTTPS, PM2/systemd), sao lưu, checklist trước khi chạy |

## Lệnh hữu ích

| Lệnh | Tác dụng |
| --- | --- |
| `npm start` | Chạy máy chủ |
| `npm run dev` | Chạy và tự khởi động lại khi sửa code |
| `npm test` | Bộ kiểm thử end-to-end (DB tạm, không ảnh hưởng dữ liệu thật) |
| `npm run seed-demo -- 500` | Tạo dữ liệu demo (cờ test) để xem dashboard |
| `npm run portal-token -- <mã KH>` | Sinh token giống Portal để thử đăng nhập |
| `npm run create-admin -- <user> [viewer\|manager\|superadmin]` | Tạo / cấp lại mật khẩu quản trị |
