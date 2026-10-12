# Hình ảnh & âm thanh thiết kế riêng

1. Đặt file vào `public/assets/img/` (ảnh) hoặc `public/assets/audio/` (âm thanh).
2. Mở `public/assets/assets.json`, điền đường dẫn, ví dụ `"home": "/assets/img/bg-home.webp"`.
3. Tải lại trang game. Ô nào để trống sẽ dùng hình vẽ / âm thanh mặc định.

> Trình duyệt lưu đệm ảnh 1 ngày. Khi thay ảnh cùng tên, nên đổi tên file (vd `bg-home-v2.webp`) để người chơi thấy ngay.

## Ảnh

| Khoá trong assets.json | Mô tả | Kích thước gợi ý |
| --- | --- | --- |
| `logo` | Chữ tiêu đề game (thay chữ "ĐẬP BÍ NGÔ") | PNG/WebP nền trong, ~1000×400 |
| `background.home` / `background.homeMobile` | Nền màn hình chính (máy tính / điện thoại) | 1920×1080 / 1080×1920, WebP/JPG ≤ 400 KB |
| `background.game` / `background.gameMobile` | Nền màn chơi (nên tối, ít chi tiết ở giữa để nổi bàn chơi) | như trên |
| `mascot.idle` `happy` `scared` `sad` | Mascot NÉT: bình thường / vui (nhận quà) / hoảng (game over) / buồn (chưa đạt) | PNG/WebP nền trong, ~600×640 |

### Vật phẩm (PNG/WebP nền trong, vuông, ~400×400)

Vật phẩm được vẽ với **chân đặt sát cạnh dưới** của ảnh (phần dưới sẽ bị miệng hố che). Mỗi trạng thái là 1 ảnh riêng:

| Khoá | Trạng thái cần vẽ |
| --- | --- |
| `items.pumpkin` | `idle` (bình thường), `ko` (mắt chữ X, lè lưỡi) |
| `items.pumpkinCloth` | `idle` (đội nón vải), `hit1` (nón đã rớt, mắt lệch), `ko`, `hat` (riêng chiếc nón, dùng cho hiệu ứng nón bay) |
| `items.pumpkinIron` | `idle` (đội nón sắt), `hit1` (nón móp, mắt lệch), `hit2` (nón rớt, mắt xoắn choáng), `ko`, `hat` (chiếc nón móp bay ra) |
| `items.ghost` `virus` `potion` `candy` | `idle`, `ko` |
| `items.bomb` | `idle` (bom phải rất dễ nhận ra: đen, ngòi cháy, mặt dữ) |

## Âm thanh (MP3/OGG, ngắn, ≤ 100 KB mỗi hiệu ứng)

| Khoá | Khi nào phát |
| --- | --- |
| `bgmHome` / `bgmGame` | Nhạc nền màn hình chính / màn chơi (lặp lại, nên ≤ 1 MB) |
| `click` | Bấm nút |
| `hit` / `kill` / `miss` | Đập trúng chưa hạ / hạ gục / đập trượt |
| `bomb` / `warn` | Trúng bom / cảnh báo còn 1 mạng |
| `count` / `go` | Đếm ngược 3-2-1 / "ĐẬP!" |
| `level` / `tier` / `combo` | Lên level / mở khoá mốc voucher / combo x5, x10... |
| `gameover` / `win` / `reveal` | Game over / nhận voucher / hiện mã coupon |
