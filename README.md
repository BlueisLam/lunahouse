# Luna — web tuyển dụng cá nhân (lunahouse.click)

Trang công khai: xem JD, nộp CV, tra cứu tiến độ bằng mã `LH-XXXXXX`.
Trang admin (`/admin/`): kho CV (AI đọc CV), job, pipeline, matching 2 tầng, nhật ký.
Stack: **Cloudflare Pages** (static + Pages Functions) · Supabase (Postgres + Storage riêng tư) · Telegram · Resend · Groq (AI).

## Cài đặt (khoảng 30 phút)

1. **Supabase**: tạo project (hoặc dùng project LunaTicket, bảng đều có tiền tố `lh_`). SQL Editor → chạy `supabase/schema.sql`. Lấy `Project URL` và `service_role key` (Settings → API).
2. **Cloudflare Pages**: Workers & Pages → Create → Pages → Connect to Git → chọn repo này.
   - Framework preset: None · Build command: `npm install --omit=dev` (bắt buộc, để cài thư viện cho Functions) · Build output directory: `public`
3. **Biến môi trường** (Settings → Variables and Secrets, nên đặt loại *Secret*), xem `.env.example`:
   - `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
   - `ADMIN_PASSWORD` (≥ 16 ký tự), `SESSION_SECRET` (`openssl rand -hex 32`)
   - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
   - `RESEND_API_KEY`, `MAIL_FROM`, `ADMIN_NOTIFY_EMAIL`, `MAIL_REPLY_TO`
   - AI có dự phòng: `GEMINI_API_KEY` (+ `GEMINI_MODEL`, tuỳ chọn; mặc định tự thử `gemini-3.8-flash` rồi `gemini-flash-latest`, model nào Google khai tử thì tự bỏ qua) và/hoặc `GROQ_API_KEY`. Thứ tự thử đặt bằng `AI_PROVIDERS` (mặc định `gemini,groq`): nhà nào hết hạn mức hoặc lỗi thì tự chuyển sang nhà kế tiếp. Chỉ có một key thì chỉ dùng nhà đó.
   - `GROQ_API_KEY`, `GROQ_MODEL` (ví dụ `openai/gpt-oss-120b`; tên model Groq đổi thường xuyên, nếu báo lỗi model thì xem danh sách mới ở console.groq.com/docs/models)
   - Tuỳ chọn: `GROQ_MODEL_FAST`, `GROQ_VISION_MODEL` (đọc CV dạng ảnh)
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

## Môi trường dev (thử trước, rồi mới lên production)
- Nhánh `main` = **production** (lunahouse.click). Nhánh `dev` = **dev**: Cloudflare tự build và cho một link riêng `dev.<tên-project>.pages.dev` (có dải cam "DEV" ở đầu trang).
- Quy trình: sửa code ở nhánh `dev` → thử trên link dev → khi ổn mới merge `dev` vào `main` (production tự deploy).
- **Mặc định dev dùng chung database và bucket với production** (cùng dữ liệu thật, không cần cài gì thêm). Trong Cloudflare Pages → Settings → Variables and Secrets → mục **Preview**, nhập các biến giống hệt Production, và thêm `ENV_LABEL=DEV` để thông báo Telegram/email có tiền tố `[DEV]`.
  - Lưu ý: nộp hồ sơ thử trên dev là ghi vào dữ liệu thật, nên dùng tên/email thử rồi xoá trong admin sau khi test.
  - Khi tính năng mới cần bảng/cột mới, chạy SQL thêm vào Supabase **trước** khi thử trên dev (chỉ thêm, không sửa/xoá cột cũ nên production không bị ảnh hưởng).
- Muốn dev tách hẳn dữ liệu (tuỳ chọn): đặt `TABLE_PREFIX=lhdev_` và `BUCKET_NAME=lhdev-cv` ở mục Preview, rồi chạy `supabase/schema.dev.sql` (sinh bằng `npm run schema:dev`) trong SQL Editor.
- Thông báo Telegram và email từ dev có tiền tố `[DEV]` khi đặt `ENV_LABEL`.

## Cách hoạt động (khác biệt so với server thường)
- Gói free của Cloudflare giới hạn **10ms CPU mỗi request**, nên CV được upload dạng multipart (không mã hoá base64 trong function).
- Groq chỉ nhận chữ. **Trình duyệt admin tự bóc chữ từ PDF** (thư viện pdf.js nằm trong `public/assets/vendor/`) rồi gửi lên cho AI. DOCX được bóc chữ ở server. CV dạng ảnh hoặc PDF scan chỉ đọc được khi có `GEMINI_API_KEY` (Gemini đọc được ảnh) hoặc bạn đặt `GROQ_VISION_MODEL`; nếu không, hồ sơ báo "Đọc CV lỗi" và bạn nhập tay thông tin.
- CV mới nộp có trạng thái `pending`. **AI chỉ đọc CV khi bạn mở trang admin (cần mở bằng trình duyệt, vì bước bóc chữ PDF chạy ở đó)** (trang tự gọi lần lượt từng hồ sơ). Telegram/email báo hồ sơ mới vẫn gửi ngay, dùng thông tin ứng viên nhập.
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

## Hỏi đáp dưới job

Ứng viên đặt câu hỏi ở cuối trang mỗi job (tên + email + nội dung). Mỗi câu hỏi tạo một hội thoại **riêng tư**:

- Bạn nhận thông báo Telegram, trả lời trong admin → tab **Hỏi đáp**. Ứng viên nhận email kèm link riêng `/q?t=…` để xem và nhắn tiếp.
- Hội thoại chỉ hiện công khai dưới job khi bạn bấm **Đăng công khai** (hoặc tick "Đăng công khai cùng lúc" khi trả lời). Người xem chỉ thấy tên gọi, không thấy email.
- Chống spam: ô ẩn (honeypot), tối đa 6 tin/giờ/IP, tối đa 60 tin/hội thoại.

**Bật tính năng:** chạy một lần file `supabase/migrations/2026-11-hoi-dap.sql` trong Supabase → SQL Editor. File chỉ thêm 2 bảng mới (`lh_threads`, `lh_messages`), không đụng dữ liệu cũ. Chưa chạy thì tab Hỏi đáp báo lỗi, các phần khác vẫn hoạt động.

## SEO
- Trang chủ: canonical, Open Graph, Twitter card, JSON-LD (WebSite + Organization); ảnh chia sẻ `public/assets/og.png`.
- `/jobs/<slug>`: `functions/jobs/[slug].js` nhét title, mô tả, canonical, Open Graph và JSON-LD JobPosting vào HTML (logic ở `server/job-page.js`). Job không tồn tại hoặc đã đóng thì noindex. Lỗi thì trả trang gốc.
- `/sitemap.xml` (động, chỉ job đang mở) và `robots.txt` chặn `/admin`, `/api`, `/q`, `/track`, `/apply`.
- Bản xem thử `*.pages.dev` luôn `noindex`; canonical luôn trỏ về `https://lunahouse.click` (đổi bằng biến `SEO_ORIGIN` nếu cần).

## Báo cáo (admin → Báo cáo)
- Xem theo ngày / tuần (ISO, bắt đầu thứ Hai) / tháng / quý / năm, giờ Việt Nam. Preset: hôm nay, tuần này, 7 ngày, 30 ngày, tháng này, quý này, năm nay, tuỳ chọn. Tải CSV.
- "Hồ sơ nhận" = số application tạo trong kỳ. Các mốc (screening, gửi khách, phỏng vấn, offer, nhận việc, từ chối, rút) = số lần hồ sơ chuyển vào trạng thái đó trong kỳ, lấy từ nhật ký `lh_activities`. Có bảng theo job, tỉ lệ chuyển đổi và số ngày trung bình từ lúc nộp đến nhận việc.
- Logic thuần ở `server/_lib/report.js` (có test), action `report.get` trong `server/admin-api.js`.

## Kéo thả pipeline
- Kéo thẻ ứng viên sang cột khác để đổi trạng thái (chuột/máy tính). Kéo thả KHÔNG gửi email; muốn báo ứng viên thì mở thẻ, tick "Báo cho ứng viên qua email khi lưu".

## Kho tài năng không vào pipeline
- Người nộp CV mà không chọn job vẫn có hồ sơ + mã tra cứu (để xem trạng thái, rút hồ sơ), nhưng hồ sơ đó KHÔNG hiện trong Pipeline, không tính vào "Application đang chạy" và không nằm trong phễu báo cáo (đếm riêng ở cột "Vào kho").
- Admin thấy họ ở Ứng viên và ở Tổng quan → "Mới vào kho tài năng" (14 ngày). Khi có job mới: Matching → thêm vào pipeline (tạo hồ sơ cho job đó).
- Trang tra cứu của họ hiện "Đã lưu vào kho tài năng", không có dòng thời gian các bước.
