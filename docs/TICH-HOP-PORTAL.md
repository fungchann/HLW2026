# Tích hợp với Portal iNET & hệ thống billing

## Tổng quan luồng

```
Khách hàng ──đăng nhập──▶ Portal iNET (backend)
                            │ 1. ký token JWT {sub: mã KH, exp: +10 phút, jti}
                            ▼
                 <iframe src="https://halloween.inet.vn/#token=JWT">
                            │ 2. game gửi token lên máy chủ game
                            ▼
                 Máy chủ game: kiểm tra chữ ký + hạn + jti
                            │ 3. cấp token phiên chơi (12 giờ) — chỉ nằm trong tab
                            ▼
                 Mọi lượt chơi / điểm / coupon / click ghi vào DB máy chủ game
                            ▼
                 Trang Admin (/admin) đọc trực tiếp DB đó → số liệu realtime
```

**Trang quản trị có xem được thống kê khi game nằm trong Portal không? — Có.** Iframe chỉ là "khung hiển thị"; mọi dữ liệu đi từ trình duyệt của khách thẳng về máy chủ game. Portal không cần lưu gì thêm, chỉ cần cho biết *ai đang chơi* thông qua token ký số.

## 1. Portal ký token đăng nhập

- Thuật toán: **JWT HS256**, khoá bí mật `PORTAL_JWT_SECRET` (≥ 32 ký tự, dùng chung giữa Portal backend và máy chủ game, **không bao giờ** đưa xuống trình duyệt).
- Payload:

| Trường | Bắt buộc | Ý nghĩa |
| --- | --- | --- |
| `sub` | Có | Mã khách hàng (chuỗi 1–64 ký tự `A-Z a-z 0-9 _ . : @ -`). **Không** dùng email/tên — chỉ cần mã định danh. |
| `exp` | Có | Thời điểm hết hạn (unix giây). Khuyến nghị `iat + 600`. |
| `iat` | Nên có | Thời điểm ký. `exp - iat` không vượt quá `PORTAL_TOKEN_MAX_TTL`. |
| `jti` | Nên có | Chuỗi ngẫu nhiên. Có `jti` thì mỗi token chỉ dùng được **1 lần** (chống dùng lại link). |
| `aud` | Tuỳ chọn | Bắt buộc nếu cấu hình `PORTAL_JWT_AUDIENCE`. |

### PHP (không cần thư viện)

```php
function hlw_token(string $customerId, string $secret): string {
    $b64 = fn($s) => rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
    $now = time();
    $header  = $b64(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
    $payload = $b64(json_encode([
        'sub' => $customerId, 'iat' => $now, 'exp' => $now + 600,
        'jti' => bin2hex(random_bytes(12)),
    ]));
    $sig = $b64(hash_hmac('sha256', "$header.$payload", $secret, true));
    return "$header.$payload.$sig";
}

$src = 'https://halloween.inet.vn/#token=' . hlw_token((string)$customer->id, getenv('HLW_PORTAL_JWT_SECRET'));
```

### Node.js

```js
const crypto = require('crypto');
function hlwToken(customerId, secret) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const h = b64({ alg: 'HS256', typ: 'JWT' });
  const p = b64({ sub: String(customerId), iat: now, exp: now + 600, jti: crypto.randomBytes(12).toString('base64url') });
  const s = crypto.createHmac('sha256', secret).update(h + '.' + p).digest('base64url');
  return `${h}.${p}.${s}`;
}
// hoặc dùng thư viện jsonwebtoken:
// jwt.sign({ sub: String(id), jti }, secret, { algorithm: 'HS256', expiresIn: 600 })
```

### C# / .NET

```csharp
static string B64(byte[] b) => Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_');

static string HlwToken(string customerId, string secret) {
    var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
    var header  = B64(Encoding.UTF8.GetBytes("{\"alg\":\"HS256\",\"typ\":\"JWT\"}"));
    var payload = B64(JsonSerializer.SerializeToUtf8Bytes(new { sub = customerId, iat = now, exp = now + 600, jti = Guid.NewGuid().ToString("N") }));
    using var h = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
    return header + "." + payload + "." + B64(h.ComputeHash(Encoding.UTF8.GetBytes(header + "." + payload)));
}
```

Thử ở máy local: `npm run portal-token -- KH123456` in ra token và link mở game.

## 2. Nhúng iframe

```html
<iframe src="https://halloween.inet.vn/#token=JWT_VUA_KY"
        allow="clipboard-write; autoplay; fullscreen"
        style="width:100%;height:100vh;min-height:600px;border:0"
        title="Halloween iNET 2026"></iframe>
```

- Token đặt sau dấu `#`: không bị gửi trong request, không lọt vào log máy chủ/Referer. Game đọc xong sẽ tự xoá khỏi thanh địa chỉ.
- `allow="clipboard-write"` để nút "chạm để sao chép mã coupon" hoạt động trong iframe (đã có phương án dự phòng nếu thiếu).
- Nếu Portal đặt `sandbox`, cần tối thiểu: `allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox` (nút "Đăng ký ngay" mở tab mới).
- Game tự co giãn theo kích thước iframe; trên điện thoại nên cho iframe chiếm toàn bộ chiều cao màn hình.
- Phía game phải khai báo `PORTAL_ORIGINS=https://portal.inet.vn` — chỉ các trang này mới nhúng được game (chống clickjacking).

### Phương án không đưa token lên URL (postMessage)

Game gửi `{type:'hlw:ready'}` cho trang cha khi tải xong. Portal trả token:

```js
const GAME = 'https://halloween.inet.vn';
window.addEventListener('message', (e) => {
  if (e.origin === GAME && e.data && e.data.type === 'hlw:ready') {
    document.getElementById('hlw').contentWindow.postMessage({ type: 'hlw:token', token: TOKEN_TU_BACKEND }, GAME);
  }
});
```

Game chỉ nhận token từ các origin trong `PORTAL_ORIGINS`.

## 3. Nguồn mã coupon

Chọn trong Admin > Cấu hình > Coupon:

| Nguồn | Khi nào dùng | Ghi chú |
| --- | --- | --- |
| **Mã giả lập** (`mock`) | Chạy thử | Mã dạng `HLWEM-7KQ9X2PM`, **không** dùng được thật |
| **Kho mã nhập sẵn** (`pool`) | Billing tạo trước một loạt mã cho từng mốc | Admin > Coupon > "Nhập mã vào kho". Hệ thống cấp lần lượt, cảnh báo realtime khi kho cạn |
| **API billing** (`http`) | Billing có API sinh mã theo khách hàng | Cấu hình `COUPON_API_URL`, `COUPON_API_KEY` trong `.env` |

### Hợp đồng API khi dùng nguồn `http`

Máy chủ game gọi `POST COUPON_API_URL`:

```
Authorization: Bearer <COUPON_API_KEY>
X-HLW-Timestamp: <unix giây>
X-HLW-Signature: sha256=<HMAC_SHA256(COUPON_API_KEY, timestamp + "." + body)>
Content-Type: application/json

{ "requestId": "hlw2026-123", "customerId": "KH123456", "tier": "hosting",
  "product": "Hosting", "discountPercent": 40, "prefix": "HLWHO",
  "expiresAt": "2026-10-31T16:59:59.000Z", "campaign": "Halloween iNET 2026" }
```

Billing trả `200 {"code": "MA-COUPON"}`. `requestId` là khoá chống trùng: gọi lại cùng `requestId` phải trả về **cùng một mã**. Nếu API lỗi/quá thời gian, coupon ở trạng thái "Đang tạo mã" và được thử lại khi người chơi bấm "Nhận coupon" hoặc khi Admin bấm "Tạo lại mã".

## 4. Báo coupon đã sử dụng (conversion)

Để thống kê chuyển đổi (khách đã dùng voucher mua dịch vụ), billing gọi:

```
POST https://halloween.inet.vn/api/integration/coupon-redeemed
Content-Type: application/json
X-HLW-Timestamp: <unix giây, lệch tối đa 5 phút>
X-HLW-Signature: sha256=<HMAC_SHA256(INTEGRATION_SECRET, timestamp + "." + rawBody)>

{ "code": "HLWHO-7KQ9X2PM", "orderId": "DH123456", "redeemedAt": "2026-10-30T10:00:00+07:00" }
```

- Trả `200 {"ok":true}`; gọi lại nhiều lần an toàn (`alreadyRedeemed: true`).
- Kiểm tra mã trước khi áp dụng: `POST /api/integration/coupon-check` với `{ "code": "...", "customerId": "KH123456" }` → `{ valid, status, ownerMatch, discountPercent, product, expiresAt }`. Mã chơi thử (`test`) luôn `valid: false`.
- Chưa tích hợp được? Admin > Coupon > "Nhập mã đã dùng" (dán danh sách mã từ báo cáo billing).

Ví dụ ký webhook bằng PHP:

```php
$body = json_encode(['code' => $code, 'orderId' => $orderId]);
$ts   = (string)time();
$sig  = hash_hmac('sha256', $ts . '.' . $body, getenv('HLW_INTEGRATION_SECRET'));
// gửi $body nguyên văn kèm header X-HLW-Timestamp: $ts và X-HLW-Signature: sha256=$sig
```

## 5. Link "Đăng ký ngay"

Mỗi mốc voucher có URL trang đăng ký dịch vụ riêng (Admin > Cấu hình > Mốc điểm & voucher). Hệ thống tự thêm `utm_source=inet_portal&utm_medium=minigame&utm_campaign=halloween2026&utm_content=<mốc>` (tắt được) và có thể gắn sẵn mã vào URL (ví dụ `?coupon=MÃ`) nếu trang giỏ hàng hỗ trợ. **Hãy thay các URL mẫu `https://inet.vn/...` bằng link thật trước khi chạy.**
