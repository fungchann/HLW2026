# Triển khai & vận hành

## 1. Yêu cầu

- 1 Cloud VPS Linux (2 vCPU / 2 GB RAM là dư cho vài chục nghìn người chơi), tên miền riêng (vd `halloween.inet.vn`) trỏ về VPS.
- Node.js **24 LTS** (tối thiểu 22.13). Không cần cài thư viện npm, không cần MySQL.

## 2. Cài đặt

```bash
# trên VPS
git clone <repo> /opt/hlw2026 && cd /opt/hlw2026     # hoặc copy thư mục dự án (trừ data/)
cp .env.example .env
node -e "for (const k of ['APP_SECRET','PORTAL_JWT_SECRET','INTEGRATION_SECRET']) console.log(k + '=' + require('crypto').randomBytes(32).toString('base64url'))"
# dán 3 dòng trên vào .env, điền PUBLIC_URL, PORTAL_ORIGINS, ALLOW_DEMO_LOGIN=false ...
npm test          # chạy bộ kiểm thử (dùng DB tạm)
npm start         # lần đầu sẽ tạo tài khoản admin, mật khẩu tạm ở data/INITIAL_ADMIN_PASSWORD.txt
```

Gửi `PORTAL_JWT_SECRET` cho đội Portal và `INTEGRATION_SECRET` cho đội billing qua kênh an toàn.

### Chạy nền bằng systemd

```ini
# /etc/systemd/system/hlw2026.service
[Unit]
Description=Halloween iNET 2026
After=network.target

[Service]
WorkingDirectory=/opt/hlw2026
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning server/index.js
Restart=always
User=hlw
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

`systemctl enable --now hlw2026` (hoặc dùng PM2: `pm2 start server/index.js --name hlw2026 --node-args="--disable-warning=ExperimentalWarning"`). **Chỉ chạy 1 tiến trình** (không dùng cluster mode).

### nginx + HTTPS

```nginx
server {
  listen 443 ssl http2;
  server_name halloween.inet.vn;
  ssl_certificate     /etc/letsencrypt/live/halloween.inet.vn/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/halloween.inet.vn/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
  }
  # Luồng realtime của Admin (Server-Sent Events): tắt buffering
  location /api/admin/stream {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_read_timeout 1h;
  }
}
server { listen 80; server_name halloween.inet.vn; return 301 https://$host$request_uri; }
```

Đặt `TRUST_PROXY=true` trong `.env` khi chạy sau nginx/Cloudflare. Nếu dùng Cloudflare, cũng tắt buffering cho `/api/admin/stream` (hoặc Admin sẽ tự kết nối lại sau mỗi lần ngắt).

## 3. Sao lưu

- Admin > Tài khoản & dữ liệu > **Tải bản sao lưu** (bản chụp nhất quán của SQLite).
- Hoặc cron trên VPS: `sqlite3 data/hlw2026.db ".backup 'backup/hlw-$(date +%F-%H).db'"` mỗi giờ trong thời gian chạy chương trình.
- Giữ nguyên `APP_SECRET`/`COUPON_ENC_KEY`: đổi khoá sẽ không giải mã được mã coupon đã lưu.

## 4. Checklist trước khi mở chương trình (26/10/2026)

**Cấu hình (Admin > Cấu hình game)**
- [ ] Thời gian bắt đầu/kết thúc, hạn coupon đúng giờ Việt Nam.
- [ ] URL đăng ký của từng mốc là link thật (đang để mẫu `https://inet.vn/...`).
- [ ] Nguồn mã coupon = **Kho mã** (đã nhập đủ mã mỗi mốc) hoặc **API billing** (đã thử tạo mã thật). Không để "Mã giả lập".
- [ ] Hạn mức phát hành từng mốc (nếu có ngân sách giới hạn).
- [ ] Đã chạy "Mô phỏng độ khó" và cho 10–20 người thật chơi thử; tỷ lệ đạt 200/450/700 phù hợp mục tiêu.
- [ ] **Tắt chế độ test.**

**Máy chủ (.env)**
- [ ] `NODE_ENV=production`, `ALLOW_DEMO_LOGIN=false`, 3 secret ngẫu nhiên ≥ 32 ký tự, `PORTAL_ORIGINS` đúng domain Portal, `PUBLIC_URL`, `TRUST_PROXY=true`, HTTPS hoạt động.
- [ ] Banner cảnh báo màu vàng trên đầu trang Admin đã biến mất.

**Dữ liệu & tài khoản**
- [ ] Admin > Tài khoản & dữ liệu > **Xoá dữ liệu test** (xoá lượt chơi thử, dữ liệu demo).
- [ ] Mỗi người vận hành 1 tài khoản riêng, đúng vai trò; xoá file `data/INITIAL_ADMIN_PASSWORD.txt`.
- [ ] Đã tải 1 bản sao lưu trước giờ mở.

**Tích hợp**
- [ ] Portal sinh token đúng (thử bằng tài khoản thật trên môi trường staging của Portal).
- [ ] Nhúng iframe có `allow="clipboard-write"`; thử trên Chrome, Safari iOS, Cốc Cốc, trình duyệt trong Zalo/Facebook.
- [ ] Webhook "coupon đã dùng" từ billing (hoặc quy trình nhập tay hằng ngày).

## 5. Những điểm nên test kỹ

1. **Độ khó thực tế**: người thật thường kém mô hình giả lập ở giai đoạn nhanh — xem phân bố điểm, tỷ lệ chết vì bom, thời lượng TB trên Dashboard sau buổi test nội bộ rồi chỉnh.
2. **Điện thoại yếu / mạng chập chờn**: chơi trên máy Android tầm thấp, 4G yếu; tắt mạng giữa ván rồi bật lại (game tự gửi lại dữ liệu); tải lại trang giữa ván (có "Chơi tiếp lượt dang dở").
3. **Chuyển tab / khoá màn hình / cuộn Portal khiến game khuất** → game phải tự tạm dừng.
4. **Luồng coupon**: đạt mốc → Nhận coupon → copy → Đăng ký ngay (đúng link + UTM) → Coupon của tôi → mã áp dụng được trên giỏ hàng thật.
5. **Chiến thuật dừng ở mốc**: dừng ở 200–449 nhận Email, lần sau dừng ở 450–699 nhận Cloud, đạt ≥ 700 nhận Hosting; đạt lại mốc đã có ⇒ thông báo "đã sở hữu".
6. **Hết lượt & hồi lượt** sau 10 phút; đồng hồ đếm ngược đúng.
7. **Trường hợp biên thời gian**: trước 00:00 26/10 và sau 23:59 31/10 (khi đã tắt chế độ test).
8. **Admin**: tài khoản "Chỉ xem" không sửa được cấu hình và chỉ thấy mã đã che; xuất CSV mở bằng Excel không lỗi font.
9. **Tải**: dùng công cụ như k6 giả lập vài trăm người chơi đồng thời (mỗi người ~1 request/3 giây khi đang chơi).
