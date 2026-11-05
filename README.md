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
   - `ADMIN_EMAIL` (email tài khoản chủ), `ADMIN_PASSWORD` (≥ 16 ký tự, mật khẩu của tài khoản chủ), `SESSION_SECRET` (`openssl rand -hex 32`)
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

## Nhiều recruiter (đăng ký, đăng nhập, trang riêng)
Ai cũng tự đăng ký tại `/admin/` → "Tạo tài khoản recruiter". Tài khoản mới ở trạng thái **chờ duyệt**, admin tổng (tài khoản chủ) duyệt trong tab **Recruiter**.

- **Dữ liệu tách riêng**: job, ứng viên, pipeline, báo cáo, hỏi đáp, CV đều gắn `recruiter_id`. Mỗi API admin chỉ đọc/ghi dòng của chính người đang đăng nhập; dòng của người khác trả 404. `recruiter_id` luôn lấy từ phiên đăng nhập, không bao giờ lấy từ dữ liệu client gửi.
- **Trang riêng**: `lunahouse.click/<handle>`. Trang chủ `/` là trang của tài khoản chủ. Handle 3–30 ký tự `a-z0-9-`, có danh sách tên bị giữ (apply, track, admin, api...). Tên, chức danh, giới thiệu, liên hệ, cộng đồng sửa ở **Cài đặt** (không còn nằm trong `config.js`).
- **Tài khoản chủ**: đăng nhập bằng `ADMIN_EMAIL` + `ADMIN_PASSWORD` như cũ. Lần đầu mở trang chủ hoặc đăng nhập sau khi deploy, hệ thống tự tạo tài khoản chủ và **gán toàn bộ dữ liệu cũ** (chưa có chủ) cho tài khoản này. Handle mặc định `lam` (đổi bằng biến `ADMIN_HANDLE` trước lần chạy đầu).
- **Admin tổng**: duyệt / khoá / mở khoá, cấp quyền admin, và **Xem dữ liệu** của từng recruiter (thanh vàng báo đang xem hộ). Khoá tài khoản là phiên cũ mất hiệu lực ngay, job biến khỏi trang công khai và sitemap, ứng viên không nộp thêm được.
- **Đăng nhập**: email + mật khẩu do Supabase Auth lưu (đã băm), quên mật khẩu gửi link qua Resend. Đăng ký giới hạn 3 lần/giờ/IP, có ô bẫy bot.
- **Thông báo theo người**: hồ sơ mới, câu hỏi gửi về email (và Telegram nếu điền chat id) của đúng recruiter. Email gửi ứng viên mang tên recruiter và trả lời về email liên hệ của họ.
- **Đăng nhập Google (tuỳ chọn)**: bật Google provider trong Supabase (Authentication → Providers), thêm `https://lunahouse.click/admin/` vào Redirect URLs, rồi đặt `GOOGLE_LOGIN=1` ở Cloudflare. Chưa đặt thì nút Google không hiện.

### Nâng cấp từ bản một recruiter
1. **Backup** Supabase (Database → Backups, hoặc xuất CSV từng bảng).
2. Chạy `supabase/migrations/2026-11-nhieu-recruiter.sql` trong SQL Editor (môi trường dev: thay `lh_` bằng `lhdev_`). Chỉ thêm bảng/cột.
3. Cloudflare: đặt `ADMIN_EMAIL` (và kiểm tra `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `RESEND_API_KEY`), Retry deployment.
4. Mở trang chủ một lần hoặc đăng nhập bằng `ADMIN_EMAIL` + `ADMIN_PASSWORD` để dữ liệu cũ được gán cho tài khoản chủ.

## Gói Free / Pro
Chỉnh giá và hạn mức trong `server/_lib/plan.js`. Thu tiền thủ công: recruiter chuyển khoản, admin bấm **+1 tháng / +1 năm Pro** trong tab Recruiter (cộng dồn vào hạn còn lại, **Về Free** để thu hồi). Thông tin chuyển khoản hiển thị ở Cài đặt, đặt bằng biến `PAYMENT_INFO` ở Cloudflare (xuống dòng được).

| | Free | Pro (99.000đ/tháng, giá gốc 199.000đ; 990.000đ/năm) |
|---|---|---|
| Job đang mở / ứng viên | 3 / 100 | không giới hạn |
| AI đọc CV | 30 lượt/tháng | không giới hạn |
| Chấm điểm AI hàng loạt, viết JD bằng AI | không | có |
| Báo cáo | chỉ theo tháng, không CSV | ngày/tuần/quý/năm + CSV |
| Thông báo | email | email + Telegram |
| Trang riêng | chân trang "Powered by Luna" | bỏ chân trang, logo + ảnh bìa (link https) |

Người mới được **tặng 30 ngày Pro** ngay lần đầu admin duyệt. Admin tổng luôn dùng đủ tính năng. Hết hạn thì tự về Free, không mất dữ liệu (chỉ không thêm được khi vượt hạn mức). Khi kho đã đủ 100 ứng viên, ứng viên mới nộp qua trang sẽ thấy thông báo "tạm thời chưa nhận thêm hồ sơ"; ứng viên đã có trong kho vẫn nộp lại được.

Nâng cấp từ bản trước: chạy thêm `supabase/migrations/2026-11-goi-pro.sql` (dev: thay `lh_` bằng `lhdev_`).
