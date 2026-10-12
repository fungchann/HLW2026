# Bảo mật & chống gian lận

Nguyên tắc: **mọi thứ chạy trong trình duyệt đều có thể bị đọc và sửa**. Vì vậy điểm số, lượt chơi và quyền nhận coupon được quyết định ở máy chủ; trình duyệt chỉ gửi *thao tác* của người chơi. "Mã hoá" code phía trình duyệt không chống được gian lận — bảo vệ thật nằm ở máy chủ.

## Các kiểu gian lận và cách chặn

| Kiểu gian lận | Cách hệ thống chặn |
| --- | --- |
| Sửa điểm trên trình duyệt (DevTools, sửa request) | Máy chủ **bỏ qua điểm do trình duyệt gửi**. Mỗi lượt có `seed` ngẫu nhiên + snapshot cấu hình lưu ở máy chủ; trình duyệt chỉ gửi log `[thời điểm, ô]`. Máy chủ dùng chính bộ máy game (`shared/engine.js`) tái hiện toàn bộ ván chơi và tự tính điểm, combo, bom. |
| Gửi log "hoàn hảo" tính sẵn | Đồng hồ game không được chạy nhanh hơn đồng hồ thật của máy chủ (lệch > 1,5 giây ⇒ lượt **không hợp lệ**, 0 điểm, không coupon). Muốn đạt 700 điểm vẫn phải "chơi" đủ thời gian thực. Thao tác sai thứ tự, ô không tồn tại, thao tác "ở tương lai", > 30 lần đập/giây ⇒ không hợp lệ. |
| Làm chậm game (speed hack) | Trình duyệt đồng bộ ~3 giây/lần; máy chủ so tốc độ đồng hồ game với thời gian thật ở các đoạn đang chơi. Chậm bất thường ⇒ gắn cờ "Đồng hồ chậm bất thường". |
| Bot / auto-click | Gắn cờ khi phản xạ trung vị quá nhanh, tốc độ đập vượt ngưỡng, độ chính xác bất thường, thiếu dữ liệu đồng bộ. Admin xem chi tiết từng lượt, thu hồi coupon, khoá người chơi. Tuỳ chọn **giữ coupon chờ duyệt** khi lượt bị nghi ngờ. |
| Sửa số lượt chơi | Lượt lưu & tính ở máy chủ (hồi theo thời gian máy chủ). Hết lượt ⇒ API từ chối (HTTP 429). Mỗi người chỉ có 1 lượt đang chạy. |
| Tự gọi API để sinh coupon | Không có API "cấp coupon theo yêu cầu". Coupon chỉ được tạo *bên trong* bước kết thúc lượt, sau khi máy chủ tính điểm. API "Nhận coupon" chỉ hiện mã của coupon đã cấp cho đúng chủ sở hữu. |
| Nhận cùng một coupon nhiều lần | Ràng buộc `UNIQUE(session_id)`: 1 lượt tối đa 1 coupon; gọi lại "kết thúc"/"nhận coupon" trả về đúng mã cũ. Mặc định mỗi lượt đạt mốc là nhận voucher (không giới hạn số lượt); có thể đặt giới hạn N voucher / mốc / tài khoản và hạn mức tổng theo mốc trong Cấu hình. |
| Giả mạo người chơi khác | Danh tính đến từ token Portal ký HS256 bằng secret chỉ Portal & máy chủ game biết; kiểm tra chữ ký, thuật toán (chặn `alg: none`), hạn, `jti` dùng 1 lần. Sau đó dùng token phiên ngẫu nhiên 256-bit (lưu dạng băm SHA-256 trong DB). Mọi API kiểm tra lượt/coupon có thuộc đúng người chơi. |
| Dò/đoán mã coupon | Mã sinh bằng CSPRNG (8 ký tự / 32 ký hiệu ≈ 1,1×10¹²). Mã lưu **mã hoá AES-256-GCM**, tra cứu bằng HMAC — lộ file DB cũng không đọc được mã. |
| Chơi ngoài thời gian chương trình | Máy chủ chặn theo thời gian chiến dịch. Khi bật "chế độ test", lượt ngoài thời gian được gắn cờ test, tách khỏi thống kê chính. |

## Bảo vệ trang quản trị & API

- Đăng nhập bằng mật khẩu băm **scrypt**; bắt buộc đổi mật khẩu lần đầu; mật khẩu ≥ 10 ký tự, có chữ hoa/thường/số.
- Sai 5 lần ⇒ khoá tài khoản 15 phút; giới hạn 10 lần thử / 15 phút / IP; thời gian phản hồi như nhau dù tài khoản có tồn tại hay không.
- Cookie phiên `HttpOnly; SameSite=Strict; Secure` (khi HTTPS), hết hạn 12 giờ; **CSRF token** bắt buộc cho mọi thao tác ghi; kiểm tra `Origin` khi khai báo `PUBLIC_URL`.
- **Phân quyền**: *Chỉ xem* (xem số liệu, mã coupon bị che) · *Quản lý* (sửa cấu hình, xử lý coupon/người chơi, xuất CSV, chơi thử) · *Quản trị cao nhất* (tài khoản quản trị, xoá dữ liệu, sao lưu).
- Tuỳ chọn giới hạn IP truy cập Admin (`ADMIN_IP_ALLOWLIST`). **Nhật ký thao tác** ghi mọi đăng nhập, thay đổi cấu hình (kèm giá trị cũ → mới), xử lý coupon/người chơi, xuất dữ liệu.
- Webhook billing ký **HMAC-SHA256** kèm timestamp (lệch tối đa 5 phút).
- Không secret/API key nào xuống trình duyệt: `APP_SECRET`, `PORTAL_JWT_SECRET`, `INTEGRATION_SECRET`, `COUPON_API_KEY` chỉ nằm trong `.env` của máy chủ.

## Bảo vệ chung

- Header bảo mật: CSP chặt (`script-src 'self'`, chỉ cho phép font Google), `frame-ancestors` chỉ Portal được nhúng game, Admin không cho nhúng (`X-Frame-Options: DENY`), `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS khi chạy HTTPS.
- Truy vấn SQL tham số hoá; chặn path traversal khi phục vụ file tĩnh; giới hạn kích thước request; rate limit theo IP & theo người chơi; dữ liệu hiển thị được escape (chống XSS); xuất CSV chống "formula injection".
- Không lưu tên/email: chỉ lưu mã khách hàng do Portal cung cấp, IP và loại thiết bị (phục vụ chống gian lận & thống kê).

## Rủi ro còn lại (nói thẳng)

1. **Bot chơi theo thời gian thực** được viết riêng cho game (đọc màn hình hoặc chạy lại engine với seed) vẫn có thể đạt điểm cao — đây là giới hạn của mọi game chạy trên trình duyệt. Hệ thống làm việc này khó và chậm (phải chơi đủ thời gian thật), gắn cờ hành vi bất thường, và có thể giới hạn phần thưởng (số voucher / mốc / tài khoản, hạn mức tổng) trong Cấu hình. Hãy theo dõi mục "Lượt nghi gian lận" và bật "giữ coupon chờ duyệt" nếu thấy dấu hiệu.
2. **Nhiều tài khoản Portal** của cùng một người sẽ được tính là nhiều người chơi. Nếu cần, Portal có thể chỉ cấp token cho tài khoản đã xác minh / có dịch vụ.
3. **Chỉ chạy 1 tiến trình máy chủ** (SQLite + bộ nhớ đệm lượt chơi). Với quy mô vài chục nghìn người chơi trong 6 ngày là đủ; muốn chạy nhiều máy chủ song song cần chuyển sang MySQL/Redis.
4. Mã coupon "giả lập" (mock) không có giá trị thật — phải chuyển sang "kho mã" hoặc "API billing" trước khi chạy chính thức.
