'use strict';
const assert = require('assert');
const H = require('./harness');
const U = require('../server/_lib/util');
const M = require('../server/_lib/match');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const ip = (n) => ({ 'cf-connecting-ip': '10.0.0.' + n });

let cookie = '', jobId = '', jobSlug = '', appCode = '', appId = '', candId = '';
const admin = async (action, data = {}) => {
  const r = await H.invoke(H.F('admin-api'), { body: { action, ...data }, headers: { cookie, 'x-lh': '1' } });
  if (r.status !== 200) throw new Error(`${action} → ${r.status} ${JSON.stringify(r.json)}`);
  return r.json;
};
const applyBody = (o = {}) => ({
  job_slug: jobSlug, full_name: 'Nguyễn Văn An', email: 'An.Nguyen@Example.com', phone_number: '0912 345 678', address: 'Hà Nội',
  expected_salary: '40 triệu', notice_period: '1 tháng', cover_note: 'Mình quan tâm vị trí này', consent: true,
  cv: { name: 'CV An.pdf', data: H.fakePdf() }, ...o,
});

// ---------- thuần logic ----------
test('normCode chấp nhận nhiều cách gõ', () => {
  assert.strictEqual(U.normCode('lh-7k3q9x'), 'LH-7K3Q9X');
  assert.strictEqual(U.normCode(' LH 7K3Q9X '), 'LH-7K3Q9X');
  assert.strictEqual(U.normCode('7k3q9x'), 'LH-7K3Q9X');
  assert.strictEqual(U.normCode('abc'), '');
  assert.strictEqual(U.normCode(''), '');
  assert.match(U.genCode(), /^LH-[A-HJ-NP-Z2-9]{6}$/);
});
test('phoneNorm khớp 0912… với +84 912…', () => {
  assert.strictEqual(U.phoneNorm('0912 345 678'), U.phoneNorm('+84 912 345 678'));
});
test('sniffFile nhận đúng định dạng, từ chối file lạ', () => {
  assert.strictEqual(U.sniffFile(Buffer.from('%PDF-1.7 xxxxx')), 'pdf');
  assert.strictEqual(U.sniffFile(Buffer.from([0x50, 0x4b, 3, 4, 0, 0, 0, 0])), 'docx');
  assert.strictEqual(U.sniffFile(Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04')), null);
  assert.strictEqual(U.sniffFile(Buffer.from('<html>hello</html>')), null);
});
test('techMatch: tương đương khớp, nhầm lẫn thì không', () => {
  const y = (a, b) => assert.ok(M.techMatch(a, b), `${a} ~ ${b}`);
  const n = (a, b) => assert.ok(!M.techMatch(a, b), `${a} !~ ${b}`);
  y('Node.js', 'NodeJS'); y('React.js', 'React'); y('Postgres', 'PostgreSQL'); y('Spring', 'Spring Boot'); y('k8s', 'Kubernetes'); y('ReactJS', 'react');
  n('Java', 'JavaScript'); n('C', 'C#'); n('Go', 'MongoDB'); n('Java', 'Kotlin'); n('SQL', 'NoSQL');
});
test('stage1 lọc theo năm, tech bắt buộc, trạng thái tìm việc', () => {
  const job = { must_have_tech: ['Java', 'Spring Boot'], nice_to_have_tech: ['Kafka'], domains: ['Banking'], min_years: 4 };
  const c = (id, yrs, techs, extra = {}) => ({ id, full_name: id, total_years_experience: yrs, technologies: techs, project_domains: [], is_open_to_work: true, ...extra });
  const out = M.stage1(job, [
    c('good', 6, ['Java', 'Spring Boot', 'Kafka'], { project_domains: ['Banking'] }),
    c('junior', 2, ['Java', 'Spring Boot']),
    c('wrongstack', 8, ['PHP', 'Laravel']),
    c('js', 7, ['JavaScript', 'React']),
    c('partial', 5, ['Java']),
    c('closed', 9, ['Java', 'Spring Boot'], { is_open_to_work: false }),
  ]);
  assert.deepStrictEqual(out.map(x => x.c.id), ['good', 'partial']);
  assert.strictEqual(out[0].overlap.length, 2);
  assert.ok(out[0].domainHit);
});

// ---------- admin ----------
test('đăng nhập: sai mật khẩu 401, đúng thì có cookie HttpOnly', async () => {
  const bad = await H.invoke(H.F('admin-login'), { body: { password: 'sai' } });
  assert.strictEqual(bad.status, 401);
  assert.ok(H.calls.some(c => /telegram/.test(c.url) && /sai mật khẩu/.test(c.body.text)), 'báo Telegram khi sai mật khẩu');
  const ok = await H.invoke(H.F('admin-login'), { body: { password: process.env.ADMIN_PASSWORD } });
  assert.strictEqual(ok.status, 200);
  const sc = ok.headers['set-cookie'];
  assert.match(sc, /lh_admin=/); assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Strict/);
  cookie = sc.split(';')[0];
});
test('admin-api: không cookie → 401; thiếu x-lh → 403; cookie giả → 401', async () => {
  const r1 = await H.invoke(H.F('admin-api'), { body: { action: 'bootstrap' } });
  assert.strictEqual(r1.status, 401);
  const r2 = await H.invoke(H.F('admin-api'), { body: { action: 'bootstrap' }, headers: { cookie } });
  assert.strictEqual(r2.status, 403);
  const r3 = await H.invoke(H.F('admin-api'), { body: { action: 'bootstrap' }, headers: { cookie: 'lh_admin=abc.def', 'x-lh': '1' } });
  assert.strictEqual(r3.status, 401);
  const tampered = cookie.replace(/.$/, c => (c === 'A' ? 'B' : 'A'));
  const r4 = await H.invoke(H.F('admin-api'), { body: { action: 'bootstrap' }, headers: { cookie: tampered, 'x-lh': '1' } });
  assert.strictEqual(r4.status, 401);
});
test('jobs: tạo job, chỉ job "open" hiện công khai và không lộ id', async () => {
  const draft = (await admin('jobs.save', { title: 'Bản nháp QA', status: 'draft', must_have_tech: 'Playwright' })).job;
  assert.strictEqual(draft.slug, 'ban-nhap-qa');
  const j = (await admin('jobs.save', {
    title: 'Senior Java Developer', level: 'Senior', salary_text: '45–70 triệu', location: 'Hồ Chí Minh', status: 'open', min_years: 5,
    must_have_tech: 'Java; Spring Boot', nice_to_have_tech: 'Kafka', domains: 'Banking',
    requirements: '5+ năm Java\nSpring Boot', responsibilities: 'Thiết kế API',
  })).job;
  jobId = j.id; jobSlug = j.slug;
  assert.strictEqual(jobSlug, 'senior-java-developer');
  const list = await H.invoke(H.F('jobs-public'), { method: 'GET' });
  assert.strictEqual(list.json.jobs.length, 1);
  assert.strictEqual(list.json.jobs[0].title, 'Senior Java Developer');
  assert.strictEqual(list.json.jobs[0].location, 'Hồ Chí Minh', 'địa điểm hiển thị công khai');
  assert.ok(!('id' in list.json.jobs[0]) && !('status' in list.json.jobs[0]));
  const one = await H.invoke(H.F('jobs-public'), { method: 'GET', query: { slug: jobSlug } });
  assert.strictEqual(one.json.job.title, 'Senior Java Developer');
  const hidden = await H.invoke(H.F('jobs-public'), { method: 'GET', query: { slug: 'ban-nhap-qa' } });
  assert.strictEqual(hidden.status, 404);
});
test('jobs.fromText: AI điền form từ JD dán vào', async () => {
  const r = await admin('jobs.fromText', { text: 'Tuyển Senior Java Developer, 5 năm kinh nghiệm, Spring Boot, Kafka, ngân hàng. Lương 45-70 triệu.' });
  assert.strictEqual(r.job.title, 'Senior Java Developer');
  assert.deepStrictEqual(r.job.must_have_tech, ['Java', 'Spring Boot']);
  assert.strictEqual(r.job.min_years, 5);
  assert.strictEqual(r.job.location, 'Hồ Chí Minh', 'AI lấy địa điểm từ JD');
});

// ---------- nộp hồ sơ ----------
test('apply: kiểm tra đầu vào', async () => {
  const bad = async (o, re) => { const r = await H.invoke(H.F('apply'), { body: applyBody(o), headers: ip(1) }); assert.strictEqual(r.status, 400, JSON.stringify(r.json)); assert.match(r.json.error, re); };
  await bad({ consent: false }, /đồng ý/);
  await bad({ email: 'khong-phai-email' }, /Email/);
  await bad({ phone_number: '123' }, /điện thoại/);
  await bad({ full_name: 'A' }, /họ tên/);
  await bad({ cv: undefined }, /CV/);
  await bad({ cv: { name: 'virus.pdf', data: Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00').toString('base64') } }, /PDF, DOCX/);
  await bad({ cv: { name: 'cv.docx', data: H.fakePdf() } }, /Đuôi file/);
  const big = await H.invoke(H.F('apply'), { body: applyBody({ cv: { name: 'big.pdf', data: Buffer.concat([Buffer.from('%PDF-1.4'), Buffer.alloc(4.2 * 1024 * 1024)]).toString('base64') } }), headers: ip(1) });
  assert.strictEqual(big.status, 413);
  const nojob = await H.invoke(H.F('apply'), { body: applyBody({ job_slug: 'khong-ton-tai' }), headers: ip(1) });
  assert.strictEqual(nojob.status, 404);
  assert.strictEqual(H.fake.t.lh_candidates.length, 0, 'không lưu gì khi đầu vào sai');
});
test('apply: honeypot không lưu gì', async () => {
  const r = await H.invoke(H.F('apply'), { body: applyBody({ website: 'http://spam' }), headers: ip(2) });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(H.fake.t.lh_candidates.length, 0);
});
test('apply: thành công → lưu, CV vào storage, Telegram + 2 email, AI đọc CV', async () => {
  H.calls.length = 0;
  const r = await H.invoke(H.F('apply'), { body: applyBody(), headers: ip(3) });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.match(r.json.code, /^LH-[A-Z0-9]{6}$/);
  appCode = r.json.code;
  candId = H.fake.t.lh_candidates[0].id; appId = H.fake.t.lh_applications[0].id;
  assert.strictEqual(H.fake.t.lh_candidates[0].parse_status, 'pending', 'CV chờ admin cho AI đọc');
  await require('../server/_lib/parse').parseCandidate(candId, { text: H.CV_TEXT });
  const cand = H.fake.t.lh_candidates[0];
  assert.strictEqual(cand.full_name, 'Nguyễn Văn An', 'tên ứng viên nhập không bị AI ghi đè');
  assert.strictEqual(cand.email_norm, 'an.nguyen@example.com');
  assert.strictEqual(cand.phone_number, '0912 345 678');
  assert.strictEqual(cand.expected_salary, '40 triệu');
  assert.strictEqual(cand.parse_status, 'done');
  assert.ok(cand.technologies.includes('Spring Boot'), 'kỹ năng lấy từ AI');
  assert.strictEqual(cand.total_years_experience, 6);
  assert.strictEqual(cand.address, 'Hà Nội', 'địa chỉ ứng viên nhập được giữ');
  assert.strictEqual(H.fake.files.size, 1);
  const tg = H.calls.filter(c => /telegram/.test(c.url));
  assert.strictEqual(tg.length, 1);
  assert.match(tg[0].body.text, /Nguyễn Văn An/); assert.match(tg[0].body.text, /Senior Java Developer/); assert.match(tg[0].body.text, new RegExp(appCode));
  const mails = H.calls.filter(c => /resend/.test(c.url));
  assert.strictEqual(mails.length, 2);
  assert.ok(mails.some(m => m.body.to[0] === 'admin@example.com'));
  const toCand = mails.find(m => m.body.to[0] === 'An.Nguyen@Example.com'.toLowerCase());
  assert.ok(toCand, 'email xác nhận tới ứng viên'); assert.ok(toCand.body.html.includes(appCode));
});
test('apply: HTML trong tên/lời nhắn bị escape trong Telegram và email', async () => {
  H.calls.length = 0;
  await H.invoke(H.F('apply'), { body: applyBody({ full_name: '<b>Hack</b> & Co', email: 'x@example.com', phone_number: '0987654321', cover_note: '<script>alert(1)</script>' }), headers: ip(4) });
  const tg = H.calls.find(c => /telegram/.test(c.url)).body.text;
  assert.ok(!tg.includes('<script>') && !/<b>Hack/.test(tg), tg);
  const mail = H.calls.filter(c => /resend/.test(c.url)).map(c => c.body.html).join('');
  assert.ok(!mail.includes('<script>') && !mail.includes('<b>Hack</b>'));
  // dọn ứng viên thử này
  const c = H.fake.t.lh_candidates.find(x => x.email === 'x@example.com');
  await admin('candidates.delete', { id: c.id });
});
test('apply: nộp lại cùng job → không tạo trùng, gửi lại mã', async () => {
  H.calls.length = 0;
  const before = H.fake.t.lh_applications.length;
  const r = await H.invoke(H.F('apply'), { body: applyBody({ email: 'an.nguyen@example.com', phone_number: '+84 912 345 678' }), headers: ip(5) });
  assert.strictEqual(r.status, 200); assert.ok(r.json.duplicate); assert.ok(!r.json.code, 'không lộ mã cho người chưa xác thực');
  assert.strictEqual(H.fake.t.lh_applications.length, before);
  assert.ok(H.calls.some(c => /resend/.test(c.url) && c.body.to[0] === 'an.nguyen@example.com'));
});
test('apply: cùng người nộp sang kho tài năng → dùng lại hồ sơ cũ', async () => {
  const r = await H.invoke(H.F('apply'), { body: applyBody({ job_slug: null }), headers: ip(6) });
  assert.strictEqual(r.status, 200); assert.ok(r.json.code);
  assert.strictEqual(H.fake.t.lh_candidates.length, 1, 'không tạo ứng viên mới');
  assert.strictEqual(H.fake.t.lh_applications.filter(a => a.candidate_id === candId).length, 2);
});
test('apply: giới hạn 5 lần/giờ/IP', async () => {
  let last;
  for (let i = 0; i < 6; i++) {
    last = await H.invoke(H.F('apply'), { body: applyBody({ job_slug: null, full_name: 'Bot ' + i, email: `bot${i}@example.com`, phone_number: '09111110' + (10 + i) }), headers: ip(99) });
  }
  assert.strictEqual(last.status, 429);
  for (const c of H.fake.t.lh_candidates.filter(c => /^bot\d@/.test(c.email))) await admin('candidates.delete', { id: c.id });
});

// ---------- tra cứu ----------
test('track: sai mã / sai liên hệ → 404 cùng một thông báo', async () => {
  const a = await H.invoke(H.F('track'), { body: { code: 'LH-ZZZZZZ', contact: 'an.nguyen@example.com' } });
  const b = await H.invoke(H.F('track'), { body: { code: appCode, contact: 'nguoi.khac@example.com' } });
  const c = await H.invoke(H.F('track'), { body: { code: appCode, contact: '0999999999' } });
  const d = await H.invoke(H.F('track'), { body: { code: appCode, contact: '' } });
  for (const r of [a, b, c, d]) assert.strictEqual(r.status, 404);
  assert.strictEqual(a.json.error, b.json.error);
});
test('track: đúng mã + email (khác hoa thường) hoặc sđt (+84) đều xem được', async () => {
  const r1 = await H.invoke(H.F('track'), { body: { code: appCode.toLowerCase(), contact: ' AN.NGUYEN@example.com ' } });
  assert.strictEqual(r1.status, 200);
  assert.strictEqual(r1.json.status, 'new'); assert.strictEqual(r1.json.status_label, 'Đã nhận hồ sơ');
  assert.strictEqual(r1.json.job_title, 'Senior Java Developer');
  assert.strictEqual(r1.json.timeline.length, 1);
  const r2 = await H.invoke(H.F('track'), { body: { code: appCode, contact: '+84912345678' } });
  assert.strictEqual(r2.status, 200);
  assert.ok(!JSON.stringify(r2.json).includes('internal'), 'không lộ ghi chú nội bộ');
});
test('admin đổi trạng thái → log, email ứng viên (khi tick), track thấy tiến độ + ghi chú công khai', async () => {
  H.calls.length = 0;
  const r = await admin('apps.update', { id: appId, status: 'interview1', public_note: 'Lịch phỏng vấn: 14h thứ Năm.', internal_note: 'Ứng viên đòi lương cao', notify: true });
  assert.ok(r.emailed);
  assert.ok(H.calls.some(c => /resend/.test(c.url) && c.body.to[0] === 'an.nguyen@example.com' && /Vòng phỏng vấn 1/.test(c.body.subject)));
  const t = await H.invoke(H.F('track'), { body: { code: appCode, contact: 'an.nguyen@example.com' } });
  assert.strictEqual(t.json.status, 'interview1'); assert.strictEqual(t.json.public_note, 'Lịch phỏng vấn: 14h thứ Năm.');
  assert.deepStrictEqual(t.json.timeline.map(x => x.status), ['new', 'interview1']);
  assert.ok(!JSON.stringify(t.json).includes('đòi lương'), 'ghi chú nội bộ không lộ');
  const bad = await H.invoke(H.F('admin-api'), { body: { action: 'apps.update', id: appId, status: 'hacked' }, headers: { cookie, 'x-lh': '1' } });
  assert.strictEqual(bad.status, 400);
});
test('track: ứng viên rút hồ sơ; hồ sơ đã kết thúc không rút lại được', async () => {
  const code = H.fake.t.lh_applications.find(a => a.id !== appId).code;
  H.calls.length = 0;
  const w = await H.invoke(H.F('track'), { body: { code, contact: 'an.nguyen@example.com', action: 'withdraw' } });
  assert.strictEqual(w.status, 200); assert.strictEqual(w.json.status, 'withdrawn'); assert.ok(w.json.terminal);
  assert.ok(H.calls.some(c => /telegram/.test(c.url) && /rút hồ sơ/.test(c.body.text)));
  const again = await H.invoke(H.F('track'), { body: { code, contact: 'an.nguyen@example.com', action: 'withdraw' } });
  assert.strictEqual(again.status, 400);
});

// ---------- kho CV + matching ----------
test('kho CV: admin tải CV → AI đọc → phát hiện trùng → gộp', async () => {
  H.state.cv = { ...H.DEFAULT_CV, full_name: 'Nguyen Van An', email: 'an.nguyen@example.com', phone_number: '0912345678', technologies: ['Java', 'Docker', 'Redis'], positions: ['Tech Lead'] };
  const up = await admin('candidates.upload', { name: 'CV_An_moi.pdf', data: H.fakePdf('v2') });
  assert.strictEqual(H.fake.t.lh_candidates.find(c => c.id === up.id).parse_status, 'pending');
  H.calls.length = 0;
  assert.strictEqual((await admin('candidates.parse', { id: up.id, text: H.CV_TEXT })).status, 'done');
  const aiCall = H.calls.find(c => /groq/.test(c.url));
  assert.strictEqual(aiCall.headers.authorization, 'Bearer gsk_fake');
  assert.strictEqual(typeof aiCall.body.messages[0].content, 'string', 'chỉ gửi chữ, không gửi file');
  assert.match(aiCall.body.messages[0].content, /Spring Boot/);
  const stub = H.fake.t.lh_candidates.find(c => c.id === up.id);
  assert.strictEqual(stub.parse_status, 'done'); assert.strictEqual(stub.full_name, 'Nguyen Van An', 'tên giả "(đang phân tích)" được thay');
  assert.strictEqual(stub.dup_of, candId, 'đánh dấu trùng với hồ sơ An cũ');
  const g = await admin('candidates.merge', { from: stub.id, to: candId });
  assert.ok(g.ok);
  const merged = H.fake.t.lh_candidates.find(c => c.id === candId);
  assert.ok(merged.technologies.includes('Redis') && merged.technologies.includes('Spring Boot'), 'gộp kỹ năng hai bên');
  assert.ok(merged.positions.includes('Tech Lead') && merged.positions.includes('Backend Developer'));
  assert.ok(!H.fake.t.lh_candidates.some(c => c.id === stub.id));
  H.state.cv = null;
});
test('kho CV: AI lỗi → parse_status failed, có thể đọc lại', async () => {
  H.state.failParse = true;
  const up = await admin('candidates.upload', { name: 'hong.pdf', data: H.fakePdf('x') });
  const pr = await admin('candidates.parse', { id: up.id, text: H.CV_TEXT });
  let c = H.fake.t.lh_candidates.find(x => x.id === up.id);
  assert.strictEqual(pr.ok, false);
  assert.strictEqual(c.parse_status, 'failed'); assert.ok(c.parse_error);
  H.state.failParse = false;
  H.state.cv = { ...H.DEFAULT_CV, full_name: 'Trần Thị Bích', email: 'bich@example.com', phone_number: '0933444555', technologies: ['Java', 'Spring Boot'], total_years_experience: 3 };
  await admin('candidates.reparse', { id: up.id });
  assert.strictEqual(H.fake.t.lh_candidates.find(x => x.id === up.id).parse_status, 'pending');
  await admin('candidates.parse', { id: up.id, text: H.CV_TEXT });
  c = H.fake.t.lh_candidates.find(x => x.id === up.id);
  assert.strictEqual(c.parse_status, 'done'); assert.strictEqual(c.full_name, 'Trần Thị Bích');
  H.state.cv = null;
});
test('matching: tầng 1 lọc, tầng 2 chấm điểm, thêm vào pipeline không tạo trùng', async () => {
  await admin('candidates.save', { full_name: 'Lê Văn Cường', email: 'cuong@example.com', phone_number: '0977000111', total_years_experience: 7, technologies: 'Java, Spring Boot, Kafka', project_domains: 'Banking', positions: 'Backend Developer' });
  await admin('candidates.save', { full_name: 'Phạm PHP', email: 'php@example.com', phone_number: '0977000222', total_years_experience: 9, technologies: 'PHP, Laravel' });
  const s1 = await admin('match.stage1', { job_id: jobId });
  const names = s1.pool.map(p => p.name);
  assert.ok(names.includes('Lê Văn Cường') && names.includes('Nguyễn Văn An'));
  assert.ok(!names.includes('Phạm PHP'), 'sai stack bị loại ở tầng 1');
  assert.strictEqual(s1.pool[0].name, 'Lê Văn Cường', 'đủ tech + domain + nice-to-have xếp đầu');
  assert.ok(s1.pool.find(p => p.name === 'Nguyễn Văn An').has_app);
  const ids = s1.pool.map(p => p.id);
  const sc = await admin('match.score', { job_id: jobId, ids });
  assert.strictEqual(sc.results.length, ids.length);
  assert.ok(sc.results.every(r => r.score >= 0 && r.score <= 100 && r.strengths));
  const cuong = s1.pool[0].id;
  const a1 = await admin('apps.create', { job_id: jobId, candidate_id: cuong, match_score: 88, match_reason: 'Mạnh Java' });
  assert.ok(a1.created); assert.strictEqual(a1.application.status, 'new');
  const a2 = await admin('apps.create', { job_id: jobId, candidate_id: cuong });
  assert.ok(!a2.created, 'không tạo trùng');
  const list = await admin('apps.list');
  assert.ok(list.applications.some(a => a.candidate_name === 'Lê Văn Cường' && a.job_title === 'Senior Java Developer'));
});
test('jobs.delete: chặn xoá job đã có application', async () => {
  const r = await H.invoke(H.F('admin-api'), { body: { action: 'jobs.delete', id: jobId }, headers: { cookie, 'x-lh': '1' } });
  assert.strictEqual(r.status, 400); assert.match(r.json.error, /Đã đóng/);
});
test('candidates.get trả link CV tạm + danh sách application', async () => {
  const r = await admin('candidates.get', { id: candId });
  assert.match(r.cv_url, /^https:\/\/fake\.supabase\.co\/sign\//);
  assert.ok(r.applications.length >= 2);
  assert.ok(r.applications.some(a => a.job_title === 'Kho tài năng'));
});
test('parse: PDF mà không có chữ → báo lỗi rõ; ảnh cần GROQ_VISION_MODEL', async () => {
  const up = await admin('candidates.upload', { name: 'scan.pdf', data: H.fakePdf('scan') });
  const r = await admin('candidates.parse', { id: up.id });
  assert.strictEqual(r.ok, false); assert.match(r.error, /Chưa lấy được chữ/);
  const img = 'data:image/jpeg;base64,/9j/4AAQ';
  const r2 = await admin('candidates.parse', { id: up.id, images: [img] });
  assert.strictEqual(r2.ok, false); assert.match(r2.error, /GROQ_VISION_MODEL/);
  process.env.GROQ_VISION_MODEL = 'vision-model-x'; H.calls.length = 0;
  const r3 = await admin('candidates.parse', { id: up.id, images: [img] });
  delete process.env.GROQ_VISION_MODEL;
  assert.strictEqual(r3.ok, true);
  const call = H.calls.find(c => /groq/.test(c.url));
  assert.strictEqual(call.body.model, 'vision-model-x'); assert.strictEqual(call.body.messages[0].content[1].type, 'image_url');
});
test('track: bị từ chối → hiện bước dừng; feedback chỉ có khi recruiter nhập', async () => {
  const ap = await H.invoke(H.F('apply'), { body: applyBody({ full_name: 'Phạm Feedback', email: 'fb@example.com', phone_number: '0966111222' }), headers: ip(30) });
  assert.strictEqual(ap.status, 200, JSON.stringify(ap.json));
  const row = H.fake.t.lh_applications.find(a => a.code === ap.json.code);
  const trk = async () => (await H.invoke(H.F('track'), { body: { code: ap.json.code, contact: 'fb@example.com' } })).json;
  await admin('apps.update', { id: row.id, status: 'screening' });
  await admin('apps.update', { id: row.id, status: 'interview1' });
  await admin('apps.update', { id: row.id, status: 'rejected', internal_note: 'Yếu system design' });
  let t = await trk();
  assert.strictEqual(t.status, 'rejected'); assert.strictEqual(t.failed_after, 'Vòng phỏng vấn 1');
  assert.strictEqual(t.public_note, '', 'không có feedback thì không hiện gì');
  assert.ok(!JSON.stringify(t).includes('system design'), 'ghi chú nội bộ không lộ');
  await admin('apps.update', { id: row.id, public_note: 'Mình đánh giá cao phần backend của bạn, cần luyện thêm system design.' });
  t = await trk();
  assert.match(t.public_note, /system design/);
});
test('sniff: PDF có byte rác phía trước vẫn nhận; file lạ vẫn bị từ chối', async () => {
  const U = require('../server/_lib/util');
  assert.strictEqual(U.sniffFile(Buffer.concat([Buffer.from('\r\n\xef\xbb\xbf  '), Buffer.from('%PDF-1.7\n...')])), 'pdf');
  assert.strictEqual(U.sniffFile(Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00')), null);
  assert.strictEqual(U.sniffFile(Buffer.from('<html>%PDF- not at start</html>'.padStart(2000, ' '))), null, 'quá 1024 byte thì không tính');
});
test('upload multipart (như trình duyệt gửi): apply + admin', async () => {
  const mk = (extra) => { const f = new FormData(); Object.entries(extra).forEach(([k, v]) => f.append(k, v)); return f; };
  const blob = new Blob([Buffer.from(H.fakePdf('mp'), 'base64')], { type: 'application/pdf' });
  const fa = mk({ full_name: 'Multi Part', email: 'multi@example.com', phone_number: '0911000999', consent: 'true', job_slug: '' });
  fa.append('cv', blob, 'CV multi.pdf');
  const r = await H.invoke(H.F('apply'), { form: fa, headers: ip(9) });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json)); assert.match(r.json.code, /^LH-/);
  const noConsent = mk({ full_name: 'No Consent', email: 'nc@example.com', phone_number: '0911000888' }); noConsent.append('cv', blob, 'a.pdf');
  assert.strictEqual((await H.invoke(H.F('apply'), { form: noConsent, headers: ip(9) })).status, 400);
  const fu = mk({ action: 'candidates.upload' }); fu.append('file', blob, 'CV admin.pdf');
  const u = await H.invoke(H.F('admin-api'), { form: fu, headers: { cookie, 'x-lh': '1' } });
  assert.strictEqual(u.status, 200, JSON.stringify(u.json)); assert.ok(u.json.id);
});
test('admin API từ chối khi chưa đăng nhập (multipart cũng vậy)', async () => {
  const f = new FormData(); f.append('action', 'candidates.upload'); f.append('file', new Blob(['%PDF-1.4 x']), 'a.pdf');
  assert.strictEqual((await H.invoke(H.F('admin-api'), { form: f })).status, 401);
});

(async () => {
  let pass = 0, fail = 0;
  for (const t of tests) {
    try { await t.fn(); pass++; console.log('  ✓', t.name); }
    catch (e) { fail++; console.log('  ✗', t.name, '\n     ', (e && e.stack || e).toString().split('\n').slice(0, 4).join('\n      ')); }
  }
  console.log(`\n${pass}/${pass + fail} test đạt`);
  process.exit(fail ? 1 : 0);
})();
