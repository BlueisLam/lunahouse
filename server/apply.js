'use strict';
const { sb, must, BUCKET } = require('./_lib/db');
const U = require('./_lib/util');
const N = require('./_lib/notify');

const MAX_CV_BYTES = 4 * 1024 * 1024;     // 4MB
const MAX_PER_IP_HOUR = 5;
const EXT = { pdf: ['pdf'], docx: ['docx'], png: ['png'], jpg: ['jpg', 'jpeg'] };

function validate(b) {
  const f = {
    full_name: U.clean(b.full_name, 100),
    email: U.clean(b.email, 120).toLowerCase(),
    phone_number: U.clean(b.phone_number, 30),
    address: U.clean(b.address, 60),
    expected_salary: U.clean(b.expected_salary, 60),
    notice_period: U.clean(b.notice_period, 60),
    links: U.clean(b.links, 300),
    cover_note: U.clean(b.cover_note, 1200),
  };
  if (f.full_name.length < 2) throw new U.HttpError(400, 'Bạn nhập giúp mình họ tên nhé.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email)) throw new U.HttpError(400, 'Email chưa đúng định dạng.');
  const d = U.digits(f.phone_number);
  if (d.length < 9 || d.length > 13) throw new U.HttpError(400, 'Số điện thoại chưa đúng (9–13 chữ số).');
  if (b.consent !== true) throw new U.HttpError(400, 'Bạn cần đồng ý cho mình lưu hồ sơ để tiếp tục.');
  return f;
}

function readCv(b) {
  const cv = b.cv;
  if (!cv || !cv.buffer) throw new U.HttpError(400, 'Bạn chưa đính kèm CV.');
  const buffer = cv.buffer;
  if (!buffer.length) throw new U.HttpError(400, 'File CV bị rỗng, bạn chọn lại giúp mình nhé.');
  if (buffer.length > MAX_CV_BYTES) throw new U.HttpError(413, 'CV lớn hơn 4MB. Bạn nén file hoặc xuất lại PDF nhẹ hơn nhé.');
  const kind = U.sniffFile(buffer);
  if (!kind) throw new U.HttpError(400, 'Mình chỉ nhận CV dạng PDF, DOCX, JPG hoặc PNG.');
  const name = U.clean(cv.name, 120) || 'cv.' + kind;
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (!EXT[kind].includes(ext)) throw new U.HttpError(400, 'Đuôi file không khớp với nội dung file. Bạn xuất lại CV rồi thử nhé.');
  return { buffer, kind, name };
}

exports.handler = U.wrap(async (event) => {
  if (event.httpMethod !== 'POST') throw new U.HttpError(405, 'Method not allowed');
  const body = await U.readInput(event, { fileField: 'cv', maxChars: 7_000_000 });

  // Honeypot: bot điền ô ẩn → giả vờ thành công, không lưu gì.
  if (body.website) return U.json(200, { ok: true, code: 'LH-XXXXXX' });

  const f = validate(body);
  const cv = readCv(body);
  const db = sb();
  const ipHash = U.sha256((process.env.SESSION_SECRET || '') + U.clientIp(event));

  // Giới hạn tần suất theo IP
  const since = new Date(Date.now() - 3600e3).toISOString();
  const recent = await db.from('lh_applications').select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).gte('created_at', since);
  if ((recent.count || 0) >= MAX_PER_IP_HOUR) throw new U.HttpError(429, 'Bạn gửi hơi nhiều trong thời gian ngắn. Thử lại sau một giờ nhé.');

  // Job (nếu chọn)
  let job = null;
  if (body.job_slug) {
    job = must(await db.from('lh_jobs').select('id,title,slug,status').eq('slug', U.clean(body.job_slug, 80)).maybeSingle(), 'job');
    if (!job || job.status !== 'open') throw new U.HttpError(404, 'Vị trí này không còn nhận hồ sơ.');
  }

  // Tìm ứng viên đã có theo email hoặc 9 số cuối điện thoại
  const emailNorm = f.email, phoneNorm = U.phoneNorm(f.phone_number);
  let cand = must(await db.from('lh_candidates').select('*').eq('email_norm', emailNorm).limit(1), 'find by email')[0];
  if (!cand && phoneNorm.length === 9) cand = must(await db.from('lh_candidates').select('*').eq('phone_norm', phoneNorm).limit(1), 'find by phone')[0];

  // Đã nộp đúng job này rồi → gửi lại mã qua email, không tạo trùng
  if (cand) {
    let dupQ = db.from('lh_applications').select('*').eq('candidate_id', cand.id);
    dupQ = job ? dupQ.eq('job_id', job.id) : dupQ.is('job_id', null);
    const dup = must(await dupQ.limit(1), 'dup app')[0];
    if (dup) {
      await N.settle([N.emailReceipt({ app: dup, cand, job }), N.notifyNewApplication({ app: dup, cand, job, duplicate: true })]);
      return U.json(200, { ok: true, duplicate: true, message: 'Bạn đã nộp vị trí này rồi. Mình vừa gửi lại mã hồ sơ vào email của bạn.' });
    }
  }

  // Tạo / cập nhật ứng viên
  const contact = {
    full_name: f.full_name, email: f.email, phone_number: f.phone_number,
    address: f.address || (cand && cand.address) || '',
    expected_salary: f.expected_salary || (cand && cand.expected_salary) || '',
    notice_period: f.notice_period || (cand && cand.notice_period) || '',
    links: f.links || (cand && cand.links) || '',
    is_open_to_work: true,
  };
  if (cand) {
    cand = must(await db.from('lh_candidates').update(contact).eq('id', cand.id).select().single(), 'update candidate');
  } else {
    cand = must(await db.from('lh_candidates').insert({ ...contact, source: 'apply' }).select().single(), 'insert candidate');
  }

  // Lưu CV vào bucket private
  const safe = U.slugify(cv.name.replace(/\.[^.]+$/, '')) + '.' + cv.kind;
  const path = `${cand.id}/${Date.now()}-${safe}`;
  const up = await db.storage.from(BUCKET).upload(path, cv.buffer, { contentType: U.MIME[cv.kind], upsert: false });
  if (up.error) throw new Error('upload: ' + up.error.message);
  must(await db.from('lh_candidates').update({
    cv_path: path, cv_filename: cv.name, cv_upload_date: new Date().toISOString(), parse_status: 'pending', parse_error: '',
  }).eq('id', cand.id), 'save cv path');

  // Tạo application với mã tra cứu (thử lại nếu trùng mã)
  let app = null;
  for (let i = 0; i < 6 && !app; i++) {
    const r = await db.from('lh_applications').insert({
      code: U.genCode(), job_id: job ? job.id : null, candidate_id: cand.id, status: 'new',
      cover_note: f.cover_note, ip_hash: ipHash,
    }).select().single();
    if (!r.error) app = r.data;
    else if (!(r.error.code === '23505' && /code/.test((r.error.message || '') + (r.error.details || '')))) must(r, 'insert application');
  }
  if (!app) throw new Error('Không tạo được mã hồ sơ.');
  must(await db.from('lh_activities').insert({ application_id: app.id, type: 'status', note: 'Ứng viên nộp hồ sơ', meta: { from: '', to: 'new' } }), 'activity');

  // Thông báo. CV được AI đọc sau, khi admin mở trang (parse_status = pending).
  await N.settle([
    N.notifyNewApplication({ app, cand, job }),
    N.emailReceipt({ app, cand, job }),
  ]);

  return U.json(200, { ok: true, code: app.code, job_title: job ? job.title : null, email: cand.email });
});
