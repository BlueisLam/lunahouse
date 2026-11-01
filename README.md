# Lunahouse — web tuyển dụng cá nhân

Trang công khai: xem JD, nộp CV, tra cứu tiến độ bằng mã `LH-XXXXXX`.
Trang admin (`/admin/`): kho CV (AI đọc CV), job, pipeline, matching 2 tầng, nhật ký.
Stack: **Cloudflare Pages** (static + Pages Functions) · Supabase (Postgres + Storage riêng tư) · Telegram · Resend · Claude API.

## Cài đặt (khoảng 30 phút)

1. **Supabase**: tạo project (hoặc dùng project LunaTicket, bảng đều có tiền tố `lh_`). SQL Editor → chạy `supabase/schema.sql`. Lấy `Project URL` và `service_role key` (Settings → API).
2. **Cloudflare Pages**: Workers & Pages → Create → Pages → Connect to Git → chọn repo này.
   - Framework preset: None · Build command: để trống · Build output directory: `public`
3. **Biến môi trường** (Settings → Variables and Secrets, nên đặt loại *Secret*), xem `.env.example`:
   - `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
   - `ADMIN_PASSWORD` (≥ 16 ký tự), `SESSION_SECRET` (`openssl rand -hex 32`)
   - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
   - `RESEND_API_KEY`, `MAIL_FROM`, `ADMIN_NOTIFY_EMAIL`, `MAIL_REPLY_TO`
   - `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `ANTHROPIC_MODEL_FAST`
   - `SITE_URL=https://lunahouse.click`
   - Compatibility flags đã khai trong `wrangler.toml` (`nodejs_compat`). Nếu dashboard không nhận, vào Settings → Functions → Compatibility flags thêm `nodejs_compat`.
4. **Tên miền**: Pages project → Custom domains → Set up `lunahouse.click`. Nếu domain đã nằm ở Cloudflare thì tự cấu hình; nếu mua ở nơi khác, đổi nameserver sang Cloudflare theo hướng dẫn. HTTPS tự cấp.
5. **Resend**: Add domain `lunahouse.click`, thêm bản ghi SPF/DKIM vào DNS, đặt `MAIL_FROM=Lunahouse <hello@lunahouse.click>`.
6. **Thông tin liên hệ công khai**: sửa `public/assets/config.js` (email, Zalo, Telegram). Mặc định để trống.
7. Deploy xong, vào `/admin/`, đăng nhập, tạo job đầu tiên (có nút "dán JD → AI điền").

## Chạy thử trên máy
```
npm install
npm test          # 27 test
npm run mock      # http://localhost:8888, DB giả có dữ liệu mẫu, admin: correct horse battery staple
cp .dev.vars.example .dev.vars && npm run dev   # chạy bằng workerd thật, nối Supabase thật
```

## Cách hoạt động (khác biệt so với server thường)
- Gói free của Cloudflare giới hạn **10ms CPU mỗi request**, nên: CV được upload dạng multipart (không mã hoá base64 trong function) và AI đọc CV bằng link tạm của Supabase (Claude tự tải file).
- CV mới nộp có trạng thái `pending`. **AI chỉ đọc CV khi bạn mở trang admin** (trang tự gọi lần lượt từng hồ sơ). Telegram/email báo hồ sơ mới vẫn gửi ngay, dùng thông tin ứng viên nhập.
- File DOCX phải bóc chữ trong function (nặng CPU hơn). Nếu thấy "Đọc CV lỗi" với DOCX, bấm "Đọc lại" hoặc dùng PDF. Gói Workers Paid ($5/tháng) không còn lo giới hạn này.
- Gói free: 100.000 lượt gọi function mỗi ngày, trang tĩnh không giới hạn.

## Bảo mật
- RLS bật, không có policy: chỉ functions (service_role) truy cập dữ liệu. Bucket `lh-cv` riêng tư, admin xem CV qua link 1 giờ.
- Admin: cookie ký HMAC (HttpOnly, SameSite=Strict, 7 ngày) + header `x-lh`; sai mật khẩu báo Telegram.
- Nộp CV: kiểm tra loại file bằng magic bytes, tối đa 4MB, honeypot, 5 hồ sơ/IP/giờ.
- Tra cứu: cần mã + email hoặc 9 số cuối điện thoại; ghi chú nội bộ không bao giờ lộ ra ngoài.
- CSP nghiêm (`script-src 'self'`) khai trong `public/_headers`.

## Cấu trúc
- `public/` trang tĩnh + `_headers` + `_redirects`
- `functions/api/` điểm vào Pages Functions (mỏng, gọi sang `server/`)
- `server/` logic xử lý (apply, track, admin, AI, thông báo), trạng thái hồ sơ ở `server/_lib/status.js`
- `supabase/schema.sql`, `test/`
