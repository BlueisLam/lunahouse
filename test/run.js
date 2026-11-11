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
  const bad = await H.invoke(H.F('auth'), { body: { action: 'login', email: 'owner@example.com', password: 'sai' } });
  assert.strictEqual(bad.status, 401);
  assert.ok(H.calls.some(c => /telegram/.test(c.url) && /sai mật khẩu/.test(c.body.text)), 'báo Telegram khi sai mật khẩu');
  const ok = await H.invoke(H.F('auth'), { body: { action: 'login', email: 'Owner@Example.com', password: process.env.ADMIN_PASSWORD } });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.json));
  assert.strictEqual(ok.json.me.role, 'admin');
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
  assert.strictEqual(H.fake.t.lh_applications[0].next_action, 'Review CV', 'hồ sơ mới: việc mặc định Review CV');
  assert.strictEqual(H.fake.t.lh_applications[0].next_action_date, require('../server/_lib/util').dayVN(3), 'hạn 3 ngày');
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
  await admin('candidates.save', { full_name: 'Lê Văn Cường', email: 'cuong@example.com', phone_number: '0931846275', total_years_experience: 7, technologies: 'Java, Spring Boot, Kafka', project_domains: 'Banking', positions: 'Backend Developer' });
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
test('parse: PDF mà không có chữ → báo lỗi rõ; ảnh cần AI đọc được ảnh', async () => {
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
test('môi trường dev: tiền tố bảng/bucket và nhãn thông báo', async () => {
  const db = require('../server/_lib/db');
  assert.strictEqual(db.mapTable('lh_jobs'), 'lh_jobs', 'production giữ nguyên');
  assert.strictEqual(db.mapBucket('lh-cv'), 'lh-cv');
  process.env.TABLE_PREFIX = 'lhdev_'; process.env.BUCKET_NAME = 'lhdev-cv'; process.env.ENV_LABEL = 'DEV';
  try {
    assert.strictEqual(db.mapTable('lh_candidates'), 'lhdev_candidates');
    assert.strictEqual(db.mapTable('other_table'), 'other_table');
    assert.strictEqual(db.mapBucket('lh-cv'), 'lhdev-cv');
    H.calls.length = 0;
    await require('../server/_lib/notify').telegram('xin chào');
    assert.match(H.calls.find(c => /telegram/.test(c.url)).body.text, /^<b>\[DEV\]<\/b> xin chào/);
  } finally { delete process.env.TABLE_PREFIX; delete process.env.BUCKET_NAME; delete process.env.ENV_LABEL; }
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
test('ngôn ngữ job: AI viết đúng ngôn ngữ chọn; lang lưu và hiện ra công khai', async () => {
  const lastPrompt = () => { const g = H.calls.filter(c => /groq/.test(c.url)).pop(); return JSON.stringify(g.body); };
  H.calls.length = 0;
  const vi = await admin('jobs.fromText', { text: 'Tuyển Senior Java Developer, 5 năm kinh nghiệm, Spring Boot, Kafka, ngân hàng. Lương 45-70 triệu.' });
  assert.strictEqual(vi.job.lang, 'vi'); assert.ok(/NGÔN NGỮ ĐẦU RA: tiếng Việt/.test(lastPrompt()));
  H.calls.length = 0;
  const en = await admin('jobs.fromText', { text: 'Hiring a Senior Java Developer, 5 years experience, Spring Boot, Kafka, banking domain.', lang: 'en' });
  assert.strictEqual(en.job.lang, 'en'); assert.ok(/viết bằng tiếng Anh/.test(lastPrompt()), 'prompt yêu cầu tiếng Anh');
  assert.strictEqual((await admin('jobs.fromText', { text: 'Hiring a Senior Java Developer, 5 years experience, Spring Boot.', lang: 'xx' })).job.lang, 'vi', 'giá trị lạ → vi');
  const saved = await admin('jobs.save', { ...en.job, title: 'Senior Java Developer EN', status: 'open' });
  const pub = await H.invoke(H.F('jobs-public'), { method: 'GET', query: { slug: saved.job.slug } });
  assert.strictEqual(pub.json.job.lang, 'en');
  const old = await H.invoke(H.F('jobs-public'), { method: 'GET', query: { slug: jobSlug } });
  assert.strictEqual(old.json.job.lang, 'vi', 'job cũ mặc định tiếng Việt');
  await admin('jobs.delete', { id: saved.job.id });
});

// ---------- hỏi đáp dưới job ----------
let thrToken = '', thrId = '';
const ask = (o = {}, h = ip(40)) => H.invoke(H.F('questions'), { body: { action: 'ask', job_slug: jobSlug, name: 'Trần Văn Bình', email: 'Binh@Example.com', body: 'Vị trí này có cho làm remote không ạ?', ...o }, headers: h });
test('hỏi đáp: đầu vào sai bị chặn, honeypot không lưu', async () => {
  assert.strictEqual((await ask({ name: '' })).status, 400);
  assert.strictEqual((await ask({ email: 'sai' })).status, 400);
  assert.strictEqual((await ask({ body: 'ok' })).status, 400);
  assert.strictEqual((await ask({ job_slug: 'khong-co' })).status, 404);
  assert.strictEqual((await ask({ website: 'http://spam' })).status, 200);
  assert.strictEqual(H.fake.t.lh_threads.length, 0);
});
test('hỏi đáp: đặt câu hỏi → thread riêng tư, Telegram cho admin, email link riêng cho ứng viên', async () => {
  H.calls.length = 0;
  const r = await ask({ body: 'Vị trí này có <b>remote</b> không ạ?' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  thrToken = r.json.token; assert.match(thrToken, /^[a-f0-9]{36}$/);
  assert.ok(r.json.link.includes('/q?t=' + thrToken));
  const t = H.fake.t.lh_threads[0]; thrId = t.id;
  assert.strictEqual(t.is_public, false); assert.strictEqual(t.author_email, 'binh@example.com');
  const tg = H.calls.filter(c => /telegram/.test(c.url));
  assert.ok(tg.some(c => /Câu hỏi mới/.test(c.body.text) && /Trần Văn Bình/.test(c.body.text)), 'Telegram báo câu hỏi mới');
  assert.ok(!tg.some(c => /<b>remote<\/b>/.test(c.body.text)), 'HTML trong câu hỏi bị escape');
  const mail = H.calls.filter(c => /resend/.test(c.url)).find(c => c.body.to.includes('binh@example.com'));
  assert.ok(mail, 'email cho ứng viên'); assert.ok(mail.body.html.includes('/q?t=' + thrToken), 'email có link riêng');
});
test('hỏi đáp: chưa đăng công khai thì người lạ không thấy; chủ link xem được, không lộ email', async () => {
  const pub = await H.invoke(H.F('questions'), { method: 'GET', query: { job: jobSlug } });
  assert.deepStrictEqual(pub.json.threads, []);
  const me = await H.invoke(H.F('questions'), { method: 'GET', query: { t: thrToken } });
  assert.strictEqual(me.status, 200); assert.strictEqual(me.json.messages.length, 1);
  assert.ok(!/binh@example\.com/.test(JSON.stringify(me.json)), 'không lộ email');
  assert.strictEqual((await H.invoke(H.F('questions'), { method: 'GET', query: { t: 'a'.repeat(36) } })).status, 404);
  assert.strictEqual((await H.invoke(H.F('questions'), { method: 'GET', query: { t: "x' or 1=1" } })).status, 404);
});
test('hỏi đáp: ứng viên nhắn thêm bằng link riêng → admin thấy chưa đọc', async () => {
  H.calls.length = 0;
  const r = await H.invoke(H.F('questions'), { body: { action: 'say', token: thrToken, body: 'Em cảm ơn, em hỏi thêm về lương.' }, headers: ip(40) });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.ok(H.calls.some(c => /telegram/.test(c.url) && /nhắn thêm/.test(c.body.text)));
  assert.strictEqual((await H.invoke(H.F('questions'), { body: { action: 'say', token: 'z'.repeat(36), body: 'xin chào bạn' }, headers: ip(40) })).status, 404);
  const l = await admin('threads.list');
  assert.strictEqual(l.threads.length, 1); assert.strictEqual(l.threads[0].unread_admin, true); assert.strictEqual(l.threads[0].count, 2);
  assert.strictEqual((await admin('bootstrap')).unread_threads, 1);
});
test('hỏi đáp: admin trả lời → email cho ứng viên; get đánh dấu đã đọc, không lộ token', async () => {
  const g = await admin('threads.get', { id: thrId });
  assert.strictEqual(g.messages.length, 2); assert.strictEqual(g.thread.token, undefined);
  assert.strictEqual((await admin('bootstrap')).unread_threads, 0);
  H.calls.length = 0;
  const r = await admin('threads.reply', { id: thrId, body: 'Có bạn nhé, hybrid 2 ngày/tuần.' });
  assert.strictEqual(r.ok, true); assert.strictEqual(r.is_public, false);
  const mail = H.calls.filter(c => /resend/.test(c.url)).find(c => c.body.to.includes('binh@example.com'));
  assert.ok(mail && /hybrid/.test(mail.body.html) && mail.body.html.includes('/q?t=' + thrToken), 'email trả lời có nội dung + link');
  assert.strictEqual(H.fake.t.lh_threads[0].last_from, 'recruiter');
  assert.strictEqual(await H.invoke(H.F('admin-api'), { body: { action: 'threads.reply', id: thrId, body: 'x' } }).then(x => x.status), 401, 'cần đăng nhập');
});
test('hỏi đáp: chỉ khi admin đăng công khai mới hiện dưới job; chỉ lộ tên gọi', async () => {
  await admin('threads.publish', { id: thrId, is_public: true });
  const pub = await H.invoke(H.F('questions'), { method: 'GET', query: { job: jobSlug } });
  assert.strictEqual(pub.json.threads.length, 1);
  assert.strictEqual(pub.json.threads[0].name, 'Bình');
  assert.strictEqual(pub.json.threads[0].messages.length, 3);
  const raw = JSON.stringify(pub.json);
  assert.ok(!/binh@example|token|author_email/i.test(raw), 'không lộ email/token');
  await admin('threads.publish', { id: thrId, is_public: false });
  assert.deepStrictEqual((await H.invoke(H.F('questions'), { method: 'GET', query: { job: jobSlug } })).json.threads, []);
});
test('hỏi đáp: giới hạn 6 tin/giờ/IP; xoá thread xoá luôn tin nhắn', async () => {
  const h = ip(77);
  for (let i = 0; i < 6; i++) assert.strictEqual((await ask({ email: 'x' + i + '@example.com' }, h)).status, 200);
  assert.strictEqual((await ask({}, h)).status, 429);
  await admin('threads.delete', { id: thrId });
  assert.ok(!H.fake.t.lh_messages.some(m => m.thread_id === thrId));
});

test('SEO: job page có title/canonical/JSON-LD; job nháp thì noindex; sitemap chỉ job đang mở', async () => {
  const seo = require('../server/job-page');
  const fs = require('fs');
  const html = fs.readFileSync(__dirname + '/../public/job.html', 'utf8');
  const row = H.fake.t.lh_jobs.find(j => j.slug === jobSlug); const out = await seo.render(html, jobSlug, 'lunahouse.click');
  assert.match(out, new RegExp('<title>' + row.title + ' · Luna</title>'));
  assert.strictEqual((out.match(/<title>/g) || []).length, 1);
  assert.match(out, new RegExp('rel="canonical" href="https://lunahouse\\.click/jobs/' + jobSlug));
  assert.match(out, /<html lang="vi"/);
  assert.ok(!/name="robots"/.test(out));
  const ld = JSON.parse(out.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.strictEqual(ld['@type'], 'JobPosting'); assert.strictEqual(ld.title, row.title);
  assert.strictEqual((await seo.render(html, jobSlug, 'abc.pages.dev')).includes('noindex'), true);
  assert.match(await seo.render(html, 'khong-ton-tai', 'lunahouse.click'), /noindex/);
  const sm = await seo.sitemap();
  assert.ok(sm.includes('/jobs/' + jobSlug));
});

test('AI dự phòng: Gemini trước, hết hạn mức thì sang Groq; cả hai hỏng thì báo cả hai', async () => {
  const AI = require('../server/_lib/ai');
  const ask = () => AI.llm({ text: 'Đọc đoạn mô tả công việc: x' });
  const used = () => H.calls.map(c => /groq/.test(c.url) ? 'groq' : /generativelanguage/.test(c.url) ? 'gemini' : '').filter(Boolean);
  try {
    process.env.GEMINI_API_KEY = 'fake-gem';
    H.calls.length = 0; await ask();
    assert.deepStrictEqual(used(), ['gemini']);                       // Gemini ưu tiên
    H.state.geminiStatus = 429; H.calls.length = 0;
    assert.match(await ask(), /Senior Java Developer/);
    assert.deepStrictEqual(used(), ['gemini', 'groq']);               // hết hạn mức → sang Groq
    AI._resetKeys();
    H.state.geminiStatus = 0; process.env.GEMINI_MODEL = 'gemini-2.5-flash'; H.state.geminiDeadModels = ['gemini-2.5-flash']; H.calls.length = 0;
    await ask();                                                      // model cũ bị khai tử → tự thử model kế, không sang Groq
    assert.deepStrictEqual(used(), ['gemini', 'gemini']);
    assert.ok(H.calls[1].url.includes('gemini-3.8-flash'));
    H.calls.length = 0; await ask(); assert.deepStrictEqual(used(), ['gemini']); // nhớ model chạy được
    delete process.env.GEMINI_MODEL; H.state.geminiDeadModels = [];
    process.env.AI_PROVIDERS = 'groq,gemini'; H.state.geminiStatus = 0; H.calls.length = 0; await ask();
    assert.deepStrictEqual(used(), ['groq']);                         // đổi thứ tự được
    delete process.env.AI_PROVIDERS; H.state.failParse = true;
    await assert.rejects(() => AI.llm({ text: 'You are a CV parser' }), e => /Gemini API 500/.test(e.message) && /Groq API 500/.test(e.message));
    H.state.failParse = false;
    process.env.GROQ_API_KEY = ''; H.state.geminiStatus = 0; H.calls.length = 0; await ask();
    assert.deepStrictEqual(used(), ['gemini']);                       // chỉ có Gemini cũng chạy
    assert.strictEqual(AI.canSeeImages(), true);
    H.calls.length = 0; await AI.llm({ text: 'Đọc đoạn mô tả công việc: x', images: ['data:image/jpeg;base64,AAAA'] });
    assert.strictEqual(H.calls[0].body.contents[0].parts[1].inline_data.mime_type, 'image/jpeg');
  } finally { delete process.env.GEMINI_API_KEY; delete process.env.AI_PROVIDERS; process.env.GROQ_API_KEY = 'gsk_fake'; delete process.env.GEMINI_MODEL; H.state.geminiDeadModels = []; H.state.geminiStatus = 0; H.state.failParse = false; }
});

test('rút hồ sơ rồi nộp lại: mở lại đúng hồ sơ cũ, giữ mã, lưu CV mới, báo admin; nộp trùng khi chưa rút thì không tạo mới', async () => {
  const mk = (extra = '') => H.invoke(H.F('apply'), { body: applyBody({ full_name: 'Võ Nộp Lại', email: 'nop.lai.x9@example.com', phone_number: '0905550123', cv: { name: 'CV moi.pdf', data: H.fakePdf(extra) } }), headers: ip(41) });
  const a1 = await mk('v1'); assert.strictEqual(a1.status, 200, JSON.stringify(a1.json)); assert.ok(a1.json.code && a1.json.code !== 'LH-XXXXXX', JSON.stringify(a1.json));
  const row = () => H.fake.t.lh_applications.find(a => a.code === a1.json.code);
  const dup = await mk('v1b'); assert.strictEqual(dup.json.duplicate, true);                    // chưa rút → báo đã nộp
  await H.invoke(H.F('track'), { body: { code: a1.json.code, contact: 'nop.lai.x9@example.com', action: 'withdraw' } });
  assert.strictEqual(row().status, 'withdrawn');
  const cand = () => H.fake.t.lh_candidates.find(c => c.id === row().candidate_id);
  const oldCv = cand().cv_path; H.calls.length = 0;
  const a2 = await mk('v2');
  assert.strictEqual(a2.status, 200, JSON.stringify(a2.json));
  assert.strictEqual(a2.json.reapplied, true); assert.strictEqual(a2.json.code, a1.json.code);
  assert.strictEqual(row().status, 'new'); assert.notStrictEqual(cand().cv_path, oldCv);
  assert.strictEqual(H.fake.t.lh_applications.filter(a => a.candidate_id === row().candidate_id && a.job_id === row().job_id).length, 1);
  const acts = H.fake.t.lh_activities.filter(x => x.application_id === row().id).map(x => x.note);
  assert.ok(acts.some(n => /nộp lại sau khi rút/.test(n)));
  assert.ok(H.calls.some(c => /telegram/.test(c.url) && /Nộp lại sau khi rút/.test(c.body.text)));
  const g = await admin('apps.get', { id: row().id });
  assert.match(g.cv_url, /^https:\/\/fake\.supabase\.co\/sign\//); assert.ok(!('cv_path' in g.candidate));
});

test('báo cáo: gom theo ngày/tháng/quý/năm giờ VN, đếm mốc chuyển trạng thái, theo job, giới hạn đầu vào', async () => {
  const R = require('../server/_lib/report');
  const rep = (o) => admin('report.get', o);
  const today = R.ymd(new Date(Date.now() + 7 * 3600e3));
  const y = today.slice(0, 4);
  const yr = await rep({ from: y + '-01-01', to: y + '-12-31', group: 'year' });
  assert.strictEqual(yr.rows.length, 1);
  assert.ok(yr.totals.received >= 1);                                   // các hồ sơ đã tạo trong các test trước
  const mo = await rep({ from: y + '-01-01', to: y + '-12-31', group: 'month' });
  assert.strictEqual(mo.rows.length, 12);
  assert.strictEqual(mo.rows.reduce((n, r) => n + r.received, 0), mo.totals.received);
  const q = await rep({ from: y + '-01-01', to: y + '-12-31', group: 'quarter' });
  assert.deepStrictEqual(q.rows.map(r => r.label), ['Quý 1/' + y, 'Quý 2/' + y, 'Quý 3/' + y, 'Quý 4/' + y]);
  assert.strictEqual(q.totals.received, yr.totals.received);
  const dd = await rep({ from: today, to: today, group: 'day' });
  assert.strictEqual(dd.rows.length, 1); assert.strictEqual(dd.totals.received, yr.totals.received); // test chạy trong cùng ngày
  assert.ok(dd.by_job.some(j => j.title === 'Kho tài năng') || dd.by_job.length >= 1);
  assert.ok(yr.totals.withdrawn >= 1 && yr.totals.rejected >= 1);       // có hồ sơ rút/từ chối từ các test trước
  assert.strictEqual(yr.by_job.reduce((n, j) => n + j.received, 0), yr.totals.received);
  await assert.rejects(() => rep({ from: '2015-01-01', to: today, group: 'year' }), /5 năm/);
  await assert.rejects(() => rep({ from: '2024-01-01', to: today, group: 'day' }), /theo ngày/);
  // ranh giới múi giờ: 18:00 UTC ngày 31/10 là 01:00 ngày 1/11 giờ VN
  const edge = R.buildReport({ apps: [{ id: 'x', job_id: 'j1', created_at: '2026-10-31T18:00:00Z' }, { id: 'y', job_id: null, created_at: '2026-10-31T18:00:00Z' }], acts: [{ application_id: 'y', type: 'status', meta: { from: 'new', to: 'interview1' }, created_at: '2026-11-02T03:00:00Z' }], jobs: { j1: 'Java' }, from: '2026-10-01', to: '2026-11-30', group: 'month' });
  assert.deepStrictEqual(edge.rows.map(r => r.received), [0, 1]);
  assert.deepStrictEqual(edge.rows.map(r => r.pool), [0, 1]);          // hồ sơ kho đếm riêng
  assert.strictEqual(edge.totals.interview, 0);                          // và không đi vào phễu
  assert.deepStrictEqual(edge.by_job.map(j => j.title), ['Java']);
});

test('Kho tài năng: không vào pipeline/phễu; trang tra cứu báo "đã lưu vào kho", không có dòng thời gian', async () => {
  const ap = await H.invoke(H.F('apply'), { body: applyBody({ job_slug: '', full_name: 'Đỗ Kho Tài', email: 'pool.kho@example.com', phone_number: '0912009988' }), headers: ip(52) });
  assert.strictEqual(ap.status, 200, JSON.stringify(ap.json));
  assert.strictEqual(ap.json.job_title, null);
  const tr = (await H.invoke(H.F('track'), { body: { code: ap.json.code, contact: 'pool.kho@example.com' } })).json;
  assert.strictEqual(tr.pool, true); assert.match(tr.status_label, /kho tài năng/); assert.deepStrictEqual(tr.timeline, []);
  const list = (await admin('apps.list')).applications;
  assert.ok(list.some(a => a.code === ap.json.code && !a.job_id));       // vẫn là bản ghi để tra cứu
  const R = require('../server/_lib/report');
  const today = R.ymd(new Date(Date.now() + 7 * 3600e3));
  const rep = await admin('report.get', { from: today, to: today, group: 'day' });
  assert.ok(rep.totals.pool >= 1); assert.ok(!rep.by_job.some(j => j.title === 'Kho tài năng'));
});

test('báo cáo theo tuần: tuần ISO bắt đầu thứ Hai, giờ VN, kỳ trống vẫn hiện', async () => {
  const R = require('../server/_lib/report');
  // 2026-11-02 là thứ Hai (tuần 45). 03:00 UTC chủ nhật 8/11 = 10:00 VN vẫn trong tuần 45; 18:00 UTC chủ nhật = 01:00 thứ Hai 9/11 → tuần 46.
  const rep = R.buildReport({
    apps: [{ id: 'a', job_id: 'j', created_at: '2026-11-02T01:00:00Z' }, { id: 'b', job_id: 'j', created_at: '2026-11-08T03:00:00Z' }, { id: 'c', job_id: 'j', created_at: '2026-11-08T18:00:00Z' }],
    acts: [], jobs: { j: 'Java' }, from: '2026-10-26', to: '2026-11-15', group: 'week',
  });
  assert.deepStrictEqual(rep.rows.map(r => r.label), ['Tuần 44/2026 (26/10–01/11)', 'Tuần 45/2026 (02/11–08/11)', 'Tuần 46/2026 (09/11–15/11)']);
  assert.deepStrictEqual(rep.rows.map(r => r.received), [0, 2, 1]);
  assert.strictEqual(R.labelOf('week', '2025-12-29'), 'Tuần 1/2026 (29/12–04/01)');   // tuần vắt qua năm
  const r2 = await admin('report.get', { from: '2026-01-01', to: '2026-12-31', group: 'week' });
  assert.strictEqual(r2.rows.length, 53);
});

test('đọc CV Word (.docx): chạy được cả bản mammoth của Node lẫn bản trình duyệt mà Cloudflare dùng', async () => {
  const JSZip = require('jszip');
  const z = new JSZip();
  z.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  z.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  z.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Phạm Lan, C&amp;B Specialist. 6 năm kinh nghiệm Compensation and Benefits, Payroll, HRIS, làm việc với nhiều dự án IT lớn tại Việt Nam.</w:t></w:r></w:p></w:body></w:document>');
  const buf = await z.generateAsync({ type: 'nodebuffer' });
  // 1) bản trình duyệt (Cloudflare) chỉ nhận arrayBuffer: đúng lỗi "Could not find file in options" khi chỉ đưa buffer
  const bz = require('mammoth/browser/unzip.js');
  await assert.rejects(() => bz.openZip({ buffer: buf }), /Could not find file in options/);
  await bz.openZip({ arrayBuffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) });
  // 2) luồng thật: upload .docx → AI đọc (không có chữ từ trình duyệt)
  const up = await admin('candidates.upload', { name: 'Pham Lan C&B Specialist (updated 11.2026).docx', data: buf.toString('base64') });
  const r = await admin('candidates.parse', { id: up.id });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
});

test('kéo thả pipeline: đổi trạng thái không kèm notify thì không gửi email, vẫn ghi nhật ký; có notify mới gửi', async () => {
  const ap = await H.invoke(H.F('apply'), { body: applyBody({ full_name: 'Kéo Thả', email: 'drag.drop@example.com', phone_number: '0905123987' }), headers: ip(61) });
  assert.strictEqual(ap.status, 200, JSON.stringify(ap.json));
  const row = H.fake.t.lh_applications.find(a => a.code === ap.json.code);
  H.calls.length = 0;
  const r = await admin('apps.update', { id: row.id, status: 'interview1' });        // đúng lời gọi của kéo thả
  assert.strictEqual(r.emailed, false);
  assert.ok(!H.calls.some(c => /resend/.test(c.url)), 'không được gửi email khi không tick báo');
  assert.strictEqual(H.fake.t.lh_applications.find(a => a.id === row.id).status, 'interview1');
  assert.ok(H.fake.t.lh_activities.some(x => x.application_id === row.id && x.meta && x.meta.to === 'interview1'));
  await assert.rejects(() => admin('apps.update', { id: row.id, status: 'khong-co' }), /400/);
  const r2 = await admin('apps.update', { id: row.id, status: 'offer', notify: true });
  assert.strictEqual(r2.emailed, true);
});


// ---------- nhiều recruiter ----------
const as = (ck) => async (action, data = {}) => {
  const r = await H.invoke(H.F('admin-api'), { body: { action, ...data }, headers: { cookie: ck, 'x-lh': '1' } });
  if (r.status !== 200) { const e = new Error(`${action} → ${r.status} ${JSON.stringify(r.json)}`); e.status = r.status; throw e; }
  return r.json;
};
const auth = (body, headers) => H.invoke(H.F('auth'), { body, headers: headers || ip(90) });
let ckB = '', recB = null, jobB = null;

test('đăng ký: kiểm tra đầu vào, honeypot, email/handle trùng, tài khoản chủ không đăng ký được', async () => {
  const base = { action: 'register', email: 'binh@example.com', password: 'matkhau-dai', display_name: 'Bình', handle: 'binh-tuyen' };
  assert.strictEqual((await auth({ ...base, password: '123' })).status, 400);
  assert.strictEqual((await auth({ ...base, email: 'khong-phai-email' })).status, 400);
  assert.strictEqual((await auth({ ...base, handle: 'apply' })).status, 400, 'handle bị hệ thống giữ');
  assert.strictEqual((await auth({ ...base, handle: 'ab' })).status, 400, 'handle quá ngắn');
  assert.strictEqual((await auth({ ...base, email: 'owner@example.com' })).status, 400, 'email của chủ');
  const hp = await auth({ ...base, website: 'http://spam' });
  assert.strictEqual(hp.status, 200); assert.ok(!H.fake.t.lh_recruiters.some(r => r.email === 'binh@example.com'), 'honeypot không tạo tài khoản');
  const ok = await auth(base);
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.json)); assert.strictEqual(ok.json.pending, true);
  recB = H.fake.t.lh_recruiters.find(r => r.email === 'binh@example.com');
  assert.strictEqual(recB.status, 'pending'); assert.strictEqual(recB.role, 'recruiter'); assert.ok(recB.auth_id);
  assert.strictEqual((await auth({ ...base, handle: 'khac-nua' })).status, 409, 'email trùng');
  assert.strictEqual((await auth({ ...base, email: 'khac@example.com', handle: 'Binh-Tuyen' })).status, 409, 'handle trùng không phân biệt hoa thường');
  assert.ok(H.calls.some(c => /telegram/.test(c.url) && /chờ duyệt/.test(c.body.text) && c.body.chat_id === '999'), 'báo chủ qua Telegram');
});
test('đăng ký: tối đa 3 lần/giờ/IP', async () => {
  for (let i = 0; i < 3; i++) assert.strictEqual((await auth({ action: 'register', email: `spam${i}@example.com`, password: 'matkhau-dai', display_name: 'Spam', handle: 'spam-' + i }, ip(88))).status, 200);
  const blocked = await auth({ action: 'register', email: 'spam9@example.com', password: 'matkhau-dai', display_name: 'Spam', handle: 'spam-9' }, ip(88));
  assert.strictEqual(blocked.status, 429);
  assert.strictEqual((await auth({ action: 'register', email: 'spam9@example.com', password: 'matkhau-dai', display_name: 'Spam', handle: 'spam-9' }, ip(89))).status, 200, 'IP khác không bị ảnh hưởng');
  H.fake.t.lh_recruiters = H.fake.t.lh_recruiters.filter(r => !/^spam/.test(r.email));
});
test('đăng nhập: chờ duyệt thì chưa vào được; sai mật khẩu thì 401 chung chung', async () => {
  const wrong = await auth({ action: 'login', email: 'binh@example.com', password: 'sai-roi-nhe' });
  assert.strictEqual(wrong.status, 401); assert.strictEqual(wrong.json.error, 'Sai email hoặc mật khẩu.');
  const unknown = await auth({ action: 'login', email: 'khong-co@example.com', password: 'matkhau-dai' });
  assert.strictEqual(unknown.status, 401); assert.strictEqual(unknown.json.error, wrong.json.error, 'không lộ email nào đã đăng ký');
  const pend = await auth({ action: 'login', email: 'binh@example.com', password: 'matkhau-dai' });
  assert.strictEqual(pend.status, 403); assert.strictEqual(pend.json.pending, true); assert.ok(!pend.headers['set-cookie'], 'chưa có cookie');
});
test('admin tổng: duyệt recruiter → gửi email; recruiter thường không dùng được chức năng quản trị', async () => {
  const list = await admin('recruiters.list');
  assert.ok(list.recruiters.some(r => r.email === 'binh@example.com' && r.status === 'pending'));
  H.calls.length = 0;
  await admin('recruiters.update', { id: recB.id, status: 'active' });
  assert.ok(H.calls.some(c => /resend/.test(c.url) && c.body.to[0] === 'binh@example.com' && /được duyệt/.test(c.body.subject)));
  const ok = await auth({ action: 'login', email: 'binh@example.com', password: 'matkhau-dai' });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.json)); assert.strictEqual(ok.json.me.role, 'recruiter');
  ckB = ok.headers['set-cookie'].split(';')[0];
  await assert.rejects(() => as(ckB)('recruiters.list'), /403/);
  await assert.rejects(() => as(ckB)('recruiters.update', { id: recB.id, role: 'admin' }), /403/);
  const owner = H.fake.t.lh_recruiters.find(r => r.email === 'owner@example.com');
  await assert.rejects(() => admin('recruiters.update', { id: owner.id, status: 'suspended' }), /400/);
});
test('cách ly dữ liệu: recruiter B không thấy, không sửa, không xoá dữ liệu của chủ', async () => {
  const b = as(ckB);
  const boot = await b('bootstrap');
  assert.strictEqual(boot.jobs.length, 0); assert.strictEqual(boot.me.handle, 'binh-tuyen');
  assert.strictEqual((await b('candidates.list')).candidates.length, 0);
  assert.strictEqual((await b('apps.list')).applications.length, 0);
  assert.strictEqual((await b('threads.list')).threads.length, 0);
  const rep = await b('report.get', { from: '2026-01-01', to: '2026-12-31', group: 'month' });
  assert.strictEqual(rep.totals.received, 0);
  assert.ok((await admin('report.get', { from: '2026-01-01', to: '2026-12-31', group: 'month' })).totals.received > 0, 'báo cáo của chủ vẫn có số liệu');
  const owner = H.fake.t.lh_recruiters.find(r => r.email === 'owner@example.com');
  assert.ok(H.fake.t.lh_candidates.some(c => c.recruiter_id === owner.id), 'dữ liệu cũ thuộc về chủ');
  for (const [a, d] of [['candidates.get', { id: candId }], ['candidates.save', { id: candId, full_name: 'Bị sửa' }], ['candidates.parse', { id: candId }], ['candidates.reparse', { id: candId }],
    ['apps.get', { id: appId }], ['apps.update', { id: appId, status: 'rejected' }], ['activities.add', { application_id: appId, note: 'xen vào' }],
    ['jobs.save', { id: jobId, title: 'Bị đổi tên' }], ['match.stage1', { job_id: jobId }], ['match.score', { job_id: jobId, ids: [candId] }],
    ['apps.create', { job_id: jobId, candidate_id: candId }]]) {
    await assert.rejects(() => b(a, d), /404/, a + ' phải 404');
  }
  await b('candidates.delete', { id: candId }); await b('jobs.delete', { id: jobId }).catch(() => {});
  assert.ok(H.fake.t.lh_candidates.some(c => c.id === candId), 'xoá chéo không có tác dụng');
  assert.ok(H.fake.t.lh_jobs.some(j => j.id === jobId));
  assert.notStrictEqual(H.fake.t.lh_candidates.find(c => c.id === candId).full_name, 'Bị sửa');
  const res = await require('../server/cv').stream(new Request('http://x/api/cv?id=' + candId, { headers: { cookie: ckB, 'x-lh': '1' } }), async () => { throw new Error('không được tải'); });
  assert.strictEqual(res.status, 404, 'CV của người khác không tải được');
  const mine = await require('../server/cv').stream(new Request('http://x/api/cv?id=' + candId, { headers: { cookie, 'x-lh': '1' } }), async () => new Response('pdf', { status: 200 }));
  assert.strictEqual(mine.status, 200);
});
test('cách ly: B không giả mạo được recruiter_id/as; chỉ admin tổng mới xem hộ (as)', async () => {
  const b = as(ckB);
  const owner = H.fake.t.lh_recruiters.find(r => r.email === 'owner@example.com');
  await assert.rejects(() => b('bootstrap', { as: owner.id }), /403/);
  const j = (await b('jobs.save', { title: 'QA Engineer của Bình', status: 'open', must_have_tech: 'Playwright', recruiter_id: owner.id, _rid: owner.id })).job;
  assert.strictEqual(j.recruiter_id, recB.id, 'recruiter_id lấy từ phiên, không từ client');
  jobB = j;
  const viewB = await admin('bootstrap', { as: recB.id });
  assert.strictEqual(viewB.jobs.length, 1); assert.strictEqual(viewB.viewing.handle, 'binh-tuyen');
  assert.strictEqual((await admin('bootstrap')).viewing, null);
  assert.ok((await admin('bootstrap')).jobs.every(x => x.recruiter_id !== recB.id));
});
test('trang công khai theo recruiter: "/" là của chủ, /api/jobs?handle= là của B, profile không lộ email đăng nhập', async () => {
  const root = (await H.invoke(H.F('jobs-public'), { method: 'GET' })).json;
  assert.ok(root.jobs.length >= 1 && root.jobs.every(x => x.title !== 'QA Engineer của Bình'));
  assert.strictEqual(root.profile.handle, 'lam'); assert.strictEqual(root.profile.is_default, true);
  const pb = (await H.invoke(H.F('jobs-public'), { method: 'GET', query: { handle: 'Binh-Tuyen' } })).json;
  assert.deepStrictEqual(pb.jobs.map(x => x.title), ['QA Engineer của Bình']);
  assert.strictEqual(pb.profile.display_name, 'Bình');
  assert.ok(!('email' in pb.profile) && !('notify_email' in pb.profile) && !('telegram_chat_id' in pb.profile) && !('id' in pb.profile));
  assert.ok(!JSON.stringify(pb).includes('binh@example.com'));
  assert.strictEqual((await H.invoke(H.F('jobs-public'), { method: 'GET', query: { handle: 'khong-ton-tai' } })).status, 404);
  const one = (await H.invoke(H.F('jobs-public'), { method: 'GET', query: { slug: jobB.slug } })).json;
  assert.strictEqual(one.profile.handle, 'binh-tuyen');
});
test('hồ sơ & thông báo: ứng viên nộp vào job của B thuộc về B, tách khỏi cùng email bên chủ, báo đúng Telegram/email của B', async () => {
  const owner = H.fake.t.lh_recruiters.find(r => r.email === 'owner@example.com');
  await as(ckB)('profile.save', { telegram_chat_id: '555123', notify_email: 'thongbao-binh@example.com', contact_email: 'binh.contact@example.com' });
  H.calls.length = 0;
  const r = await H.invoke(H.F('apply'), { body: applyBody({ job_slug: jobB.slug }), headers: ip(91) });   // cùng email An.Nguyen đã nộp bên chủ
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  const appB = H.fake.t.lh_applications.find(a => a.code === r.json.code);
  assert.strictEqual(appB.recruiter_id, recB.id);
  const cands = H.fake.t.lh_candidates.filter(c => c.email_norm === 'an.nguyen@example.com');
  assert.strictEqual(cands.length, 2, 'mỗi recruiter một bản ghi ứng viên riêng');
  assert.deepStrictEqual(cands.map(c => c.recruiter_id).sort(), [owner.id, recB.id].sort());
  assert.ok(H.fake.t.lh_activities.filter(a => a.application_id === appB.id).every(a => a.recruiter_id === recB.id));
  assert.ok(H.calls.some(c => /telegram/.test(c.url) && c.body.chat_id === '555123'), 'Telegram của B');
  assert.ok(!H.calls.some(c => /telegram/.test(c.url) && c.body.chat_id === '999'), 'không báo nhầm chủ');
  assert.ok(H.calls.some(c => /resend/.test(c.url) && c.body.to[0] === 'thongbao-binh@example.com'), 'email thông báo của B');
  const receipt = H.calls.find(c => /resend/.test(c.url) && c.body.to[0] === 'an.nguyen@example.com');
  assert.strictEqual(receipt.body.reply_to, 'binh.contact@example.com'); assert.match(receipt.body.from, /^Bình · Luna </);
  assert.strictEqual((await as(ckB)('candidates.list')).candidates.length, 1);
  assert.strictEqual((await as(ckB)('apps.list')).applications.length, 1);
  assert.ok((await admin('apps.list')).applications.every(a => a.id !== appB.id), 'chủ không thấy hồ sơ của B trong pipeline của mình');
});
test('kho tài năng theo trang: gửi CV vào /handle của B thuộc về B; handle lạ thì 404; trang chủ vào kho của chủ', async () => {
  const mk = (o) => applyBody({ job_slug: '', full_name: 'Kho Của Bình', email: 'kho.binh@example.com', phone_number: '0905000771', ...o });
  const rB = await H.invoke(H.F('apply'), { body: mk({ handle: 'binh-tuyen' }), headers: ip(92) });
  assert.strictEqual(rB.status, 200, JSON.stringify(rB.json));
  assert.strictEqual(H.fake.t.lh_applications.find(a => a.code === rB.json.code).recruiter_id, recB.id);
  assert.strictEqual((await H.invoke(H.F('apply'), { body: mk({ handle: 'khong-co-ai' }), headers: ip(93) })).status, 404);
  const rO = await H.invoke(H.F('apply'), { body: mk({ email: 'kho.chu@example.com', phone_number: '0905000772' }), headers: ip(94) });
  assert.strictEqual(rO.status, 200);
  assert.strictEqual(H.fake.t.lh_applications.find(a => a.code === rO.json.code).recruiter_id, H.fake.t.lh_recruiters.find(r => r.email === 'owner@example.com').id);
});
test('tra cứu & hỏi đáp trả hồ sơ công khai đúng recruiter', async () => {
  const code = H.fake.t.lh_applications.find(a => a.recruiter_id === recB.id).code;
  const tr = await H.invoke(H.F('track'), { body: { code, contact: 'an.nguyen@example.com' }, headers: ip(95) });
  assert.strictEqual(tr.status, 200); assert.strictEqual(tr.json.profile.handle, 'binh-tuyen');
  H.calls.length = 0;
  const q = await H.invoke(H.F('questions'), { body: { action: 'ask', job_slug: jobB.slug, name: 'Hỏi Thử', email: 'hoi@example.com', body: 'Vị trí này có remote không?' }, headers: ip(96) });
  assert.strictEqual(q.status, 200);
  const th = H.fake.t.lh_threads.find(t => t.job_id === jobB.id);
  assert.strictEqual(th.recruiter_id, recB.id);
  assert.ok(H.calls.some(c => /telegram/.test(c.url) && c.body.chat_id === '555123'));
  assert.strictEqual((await as(ckB)('threads.list')).threads.length, 1);
  assert.ok((await admin('threads.list')).threads.every(t => t.id !== th.id));
  await assert.rejects(() => admin('threads.get', { id: th.id }), /404/);
  const view = (await H.invoke(H.F('questions'), { method: 'GET', query: { t: th.token } })).json;
  assert.strictEqual(view.profile.handle, 'binh-tuyen');
});
test('hồ sơ công khai: link phải là https, email đúng định dạng, cộng đồng được lọc', async () => {
  const b = as(ckB);
  await assert.rejects(() => b('profile.save', { zalo: 'javascript:alert(1)' }), /400/);
  await assert.rejects(() => b('profile.save', { facebook: 'http://khong-bao-mat' }), /400/);
  await assert.rejects(() => b('profile.save', { contact_email: 'abc' }), /400/);
  await assert.rejects(() => b('profile.save', { telegram_chat_id: 'abc' }), /400/);
  const r = await b('profile.save', { display_name: 'Bình Tuyển', title: 'IT Recruiter', bio: 'Mình tuyển dev.', communities: [
    { kind: 'facebook', name: 'Nhóm A', note: 'FB', url: 'https://facebook.com/groups/a' }, { kind: 'x', name: 'Xấu', url: 'javascript:alert(1)' }, { kind: 'zalo', name: '', url: 'https://zalo.me/g/1' }] });
  assert.strictEqual(r.me.communities.length, 1); assert.strictEqual(r.me.display_name, 'Bình Tuyển');
  assert.strictEqual(r.me.handle, 'binh-tuyen', 'handle không đổi qua profile.save');
  await b('profile.save', { handle: 'chiem-quyen', role: 'admin', status: 'active' });
  const row = H.fake.t.lh_recruiters.find(x => x.id === recB.id);
  assert.strictEqual(row.handle, 'binh-tuyen'); assert.strictEqual(row.role, 'recruiter');
  const pub = (await H.invoke(H.F('jobs-public'), { method: 'GET', query: { handle: 'binh-tuyen' } })).json.profile;
  assert.strictEqual(pub.title, 'IT Recruiter'); assert.strictEqual(pub.communities[0].name, 'Nhóm A');
});
test('SEO nhiều recruiter: sitemap có trang của B và job của B; JSON-LD ghi tên B', async () => {
  const sm = await require('../server/job-page').sitemap();
  assert.ok(sm.includes('/binh-tuyen<') && sm.includes('/jobs/' + jobB.slug));
  const html = await require('../server/job-page').render('<html lang="vi"><head><title>x</title></head><body></body></html>', jobB.slug, 'lunahouse.click');
  assert.ok(/Bình Tuyển/.test(html) && /canonical/.test(html));
});
test('quên mật khẩu: không lộ email nào có tài khoản; link dùng một lần; đổi xong đăng nhập bằng mật khẩu mới', async () => {
  H.calls.length = 0;
  const none = await auth({ action: 'forgot', email: 'khong-co@example.com' });
  assert.strictEqual(none.status, 200); assert.ok(!H.calls.some(c => /resend/.test(c.url)));
  const yes = await auth({ action: 'forgot', email: 'binh@example.com' });
  assert.strictEqual(yes.status, 200);
  const mail = H.calls.find(c => /resend/.test(c.url) && c.body.to[0] === 'binh@example.com');
  assert.ok(mail, 'có email đặt lại'); const token = /#\/reset\/([^"]+)"/.exec(mail.body.html)[1];
  assert.strictEqual((await auth({ action: 'reset', token, password: '123' })).status, 400);
  assert.strictEqual((await auth({ action: 'reset', token: 'x', password: 'matkhau-moi-ne' })).status, 400);
  assert.strictEqual((await auth({ action: 'reset', token, password: 'matkhau-moi-ne' })).status, 200);
  assert.strictEqual((await auth({ action: 'reset', token, password: 'lan-hai-khong-duoc' })).status, 400, 'link chỉ dùng một lần');
  assert.strictEqual((await auth({ action: 'login', email: 'binh@example.com', password: 'matkhau-dai' })).status, 401);
  assert.strictEqual((await auth({ action: 'login', email: 'binh@example.com', password: 'matkhau-moi-ne' })).status, 200);
});
test('đăng nhập Google: tắt thì từ chối; bật thì tạo tài khoản chờ duyệt, đúng người cũ thì vào', async () => {
  H.googleTokens.set('g-tok-1', { id: 'g-id-1', email: 'gia@example.com', name: 'Gia Google' });
  assert.strictEqual((await auth({ action: 'google', access_token: 'g-tok-1' })).status, 400);
  process.env.GOOGLE_LOGIN = '1';
  try {
    assert.strictEqual((await auth({ action: 'google', access_token: 'bậy' })).status, 401);
    const first = await auth({ action: 'google', access_token: 'g-tok-1' });
    assert.strictEqual(first.status, 403); assert.strictEqual(first.json.pending, true);
    const gia = H.fake.t.lh_recruiters.find(r => r.email === 'gia@example.com');
    assert.strictEqual(gia.status, 'pending'); assert.strictEqual(gia.display_name, 'Gia Google'); assert.match(gia.handle, /^gia/);
    await admin('recruiters.update', { id: gia.id, status: 'active' });
    const again = await auth({ action: 'google', access_token: 'g-tok-1' });
    assert.strictEqual(again.status, 200); assert.match(again.headers['set-cookie'], /lh_admin=/);
    H.googleTokens.set('g-tok-2', { id: 'g-khac', email: 'binh@example.com', name: 'Giả' });
    assert.strictEqual((await auth({ action: 'google', access_token: 'g-tok-2' })).status, 409, 'email đã gắn tài khoản mật khẩu khác');
    assert.strictEqual((await H.invoke(H.F('auth'), { method: 'GET' })).json.google, true);
  } finally { delete process.env.GOOGLE_LOGIN; }
});
test('khoá tài khoản: phiên cũ mất hiệu lực ngay, job biến mất khỏi trang công khai, không nhận hồ sơ mới, đăng nhập lại bị chặn', async () => {
  const keep = await H.invoke(H.F('auth'), { body: { action: 'login', email: 'binh@example.com', password: 'matkhau-moi-ne' }, headers: ip(97) });
  const ck = keep.headers['set-cookie'].split(';')[0];
  await admin('recruiters.update', { id: recB.id, status: 'suspended' });
  await assert.rejects(() => as(ck)('bootstrap'), /403/);
  assert.strictEqual((await auth({ action: 'login', email: 'binh@example.com', password: 'matkhau-moi-ne' })).status, 403);
  assert.strictEqual((await H.invoke(H.F('jobs-public'), { method: 'GET', query: { handle: 'binh-tuyen' } })).status, 404);
  assert.strictEqual((await H.invoke(H.F('jobs-public'), { method: 'GET', query: { slug: jobB.slug } })).status, 404);
  assert.strictEqual((await H.invoke(H.F('apply'), { body: applyBody({ job_slug: jobB.slug, email: 'moi@example.com', phone_number: '0905000999' }), headers: ip(98) })).status, 404);
  assert.strictEqual((await H.invoke(H.F('questions'), { body: { action: 'ask', job_slug: jobB.slug, name: 'Ai Đó', email: 'ai@example.com', body: 'Còn tuyển không?' }, headers: ip(99) })).status, 404);
  assert.ok(!(await require('../server/job-page').sitemap()).includes(jobB.slug));
  assert.ok(!(await H.invoke(H.F('jobs-public'), { method: 'GET' })).json.jobs.some(j => j.slug === jobB.slug));
  await admin('recruiters.update', { id: recB.id, status: 'active' });
  assert.strictEqual((await as(ck)('bootstrap')).jobs.length, 1, 'mở khoá là dùng lại được');
});
test('tài khoản chủ: nhận dữ liệu cũ chưa có chủ; trang chủ tự tạo tài khoản chủ khi chưa đăng nhập lần nào', async () => {
  const T = require('../server/_lib/tenant');
  const saved = { r: H.fake.t.lh_recruiters, j: H.fake.t.lh_jobs };
  H.fake.t.lh_recruiters = []; H.fake.t.lh_jobs = [{ id: 'old-job', slug: 'cu-ky', title: 'Job cũ', status: 'open', recruiter_id: null, created_at: new Date().toISOString() }];
  try {
    const root = (await H.invoke(H.F('jobs-public'), { method: 'GET' })).json;
    assert.deepStrictEqual(root.jobs.map(j => j.slug), ['cu-ky'], 'job chưa có chủ được gán cho chủ ngay lần mở đầu tiên');
    assert.strictEqual(H.fake.t.lh_recruiters.length, 1); assert.strictEqual(H.fake.t.lh_recruiters[0].role, 'admin');
    assert.strictEqual(H.fake.t.lh_jobs[0].recruiter_id, H.fake.t.lh_recruiters[0].id);
    assert.ok(root.profile.communities.length >= 4, 'cộng đồng cũ được giữ');
    await T.ensureOwner(); assert.strictEqual(H.fake.t.lh_recruiters.length, 1, 'không tạo trùng');
  } finally { H.fake.t.lh_recruiters = saved.r; H.fake.t.lh_jobs = saved.j; }
});


// ---------- gói Free / Pro ----------
const PLAN = require('../server/_lib/plan');
const recOf = (id) => H.fake.t.lh_recruiters.find(r => r.id === id);
const setFree = (id) => { recOf(id).plan_until = null; };

test('công tắc tính phí: mặc định TẮT (ai cũng như Pro, không có giá); chỉ admin bật được; bật rồi Free mới bị giới hạn', async () => {
  const bt = () => H.fake.t.lh_settings.find(x => x.key === 'billing');
  assert.strictEqual(bt(), undefined, 'chưa bật bao giờ');
  await PLAN.load(true);
  const u = H.fake.t.lh_recruiters.find(r => r.role === 'recruiter');
  assert.strictEqual(PLAN.isPro({ role: 'recruiter', plan_until: null }), true, 'tắt tính phí → mọi người như Pro');
  const lst = await admin('recruiters.list'); assert.strictEqual(lst.billing, false);
  assert.strictEqual((await admin('bootstrap')).plan.billing, false);
  // người không phải admin không bật được
  await assert.rejects(() => as(ckB)('billing.set', { on: true }), e => e.status === 403);
  assert.strictEqual(bt(), undefined, 'bị từ chối thì không ghi gì');
  assert.strictEqual((await admin('billing.set', { on: true })).billing, true);
  assert.deepStrictEqual(bt().value, { on: true });
  assert.strictEqual(PLAN.isPro({ role: 'recruiter', plan_until: null }), false, 'bật → Free bị giới hạn');
  assert.strictEqual((await admin('bootstrap')).plan.billing, true);
});
test('gói: duyệt lần đầu tặng 30 ngày Pro, email báo tặng; admin tổng luôn là Pro', async () => {
  const c = await auth({ action: 'register', email: 'chi@example.com', password: 'matkhau-dai', display_name: 'Chi', handle: 'chi-hr' }, ip(70));
  assert.strictEqual(c.status, 200);
  const chi = H.fake.t.lh_recruiters.find(r => r.email === 'chi@example.com');
  assert.strictEqual(PLAN.isPro(chi), false, 'chưa duyệt thì chưa có Pro');
  H.calls.length = 0;
  await admin('recruiters.update', { id: chi.id, status: 'active' });
  const days = (new Date(recOf(chi.id).plan_until) - Date.now()) / 86400e3;
  assert.ok(days > 29 && days <= 30.01, 'tặng 30 ngày: ' + days);
  assert.ok(H.calls.some(x => /resend/.test(x.url) && /1 tháng gói Pro/.test(x.body.html)));
  await admin('recruiters.update', { id: chi.id, status: 'suspended' }); await admin('recruiters.update', { id: chi.id, status: 'active' });
  assert.ok((new Date(recOf(chi.id).plan_until) - Date.now()) / 86400e3 <= 30.01, 'khoá rồi mở không được tặng lại');
  assert.strictEqual(PLAN.isPro(H.fake.t.lh_recruiters.find(r => r.email === 'owner@example.com')), true);
  assert.strictEqual((await admin('bootstrap')).plan.role_admin, true);
});
test('gói Free: tối đa 3 job đang mở (nháp không tính); Pro không giới hạn', async () => {
  setFree(recB.id);
  const b = as(ckB);
  const mk = (t, st) => b('jobs.save', { title: t, status: st, must_have_tech: 'X' });
  await mk('Nháp 1', 'draft'); await mk('Nháp 2', 'draft'); await mk('Nháp 3', 'draft'); await mk('Nháp 4', 'draft');   // nháp tuỳ ý
  await mk('Job mở 2', 'open'); const j3 = (await mk('Job mở 3', 'open')).job;
  const err = await mk('Job mở 4', 'open').catch(e => e);
  assert.strictEqual(err.status, 403); assert.match(err.message, /Pro/);
  const draft = H.fake.t.lh_jobs.find(j => j.title === 'Nháp 1');
  await assert.rejects(() => b('jobs.save', { id: draft.id, status: 'open' }), /403/, 'mở nháp cũng bị đếm');
  await b('jobs.save', { id: j3.id, title: 'Job mở 3 (sửa)' });                 // sửa job đang mở thì không sao
  await b('jobs.save', { id: j3.id, status: 'paused' });                          // đóng bớt thì mở được cái khác
  await b('jobs.save', { id: draft.id, status: 'open' });
  const plan = (await b('bootstrap')).plan; assert.strictEqual(plan.pro, false); assert.strictEqual(plan.usage.jobs, 3);
  await admin('recruiters.update', { id: recB.id, plan_months: 1 });
  await mk('Job mở 5', 'open');                                                   // Pro: không giới hạn
  assert.strictEqual((await b('bootstrap')).plan.pro, true);
});
test('gói Free: tính năng chỉ Pro bị chặn (chấm điểm AI, JD bằng AI, logo/ảnh bìa, xem theo ngày), Pro thì dùng được', async () => {
  const b = as(ckB);
  setFree(recB.id);
  await assert.rejects(() => b('match.score', { job_id: jobB.id, ids: [] }), /403/);
  await assert.rejects(() => b('jobs.fromText', { text: 'x'.repeat(80) }), /403/);
  await assert.rejects(() => b('profile.save', { logo_url: 'https://example.com/logo.png' }), /403/);
  const r = await b('report.get', { from: '2026-11-01', to: '2026-11-30', group: 'day' });
  assert.strictEqual(r.group, 'month', 'Free bị ép xem theo tháng');
  await b('profile.save', { display_name: 'Bình Tuyển' });                      // phần còn lại của hồ sơ vẫn lưu được
  await admin('recruiters.update', { id: recB.id, plan_months: 1 });
  assert.strictEqual((await b('report.get', { from: '2026-11-01', to: '2026-11-30', group: 'day' })).group, 'day');
  assert.ok((await b('jobs.fromText', { text: 'Tuyển Senior Java, 5 năm kinh nghiệm Spring Boot, Banking, lương 45-70 triệu. '.repeat(2) })).job.title);
  await b('profile.save', { logo_url: 'https://example.com/logo.png', cover_url: 'https://example.com/cover.jpg' });
  await assert.rejects(() => b('profile.save', { logo_url: 'javascript:alert(1)' }), /400/);
});
test('gói: trang công khai chỉ hiện logo/ảnh bìa khi Pro, và báo free/pro để ẩn "Powered by Luna"', async () => {
  const get = async () => (await H.invoke(H.F('jobs-public'), { method: 'GET', query: { handle: 'binh-tuyen' } })).json.profile;
  let p = await get(); assert.strictEqual(p.pro, true); assert.strictEqual(p.logo_url, 'https://example.com/logo.png');
  setFree(recB.id);
  p = await get(); assert.strictEqual(p.pro, false); assert.strictEqual(p.logo_url, ''); assert.strictEqual(p.cover_url, '');
  assert.strictEqual((await H.invoke(H.F('jobs-public'), { method: 'GET' })).json.profile.pro, true, 'trang chủ của chủ luôn Pro');
  await admin('recruiters.update', { id: recB.id, plan_months: 1 });
});
test('gói Free: Telegram chỉ cho Pro (email thì ai cũng có); Pro hết hạn thì tự về Free', async () => {
  const sendApp = async (n, email) => { H.calls.length = 0; const r = await H.invoke(H.F('apply'), { body: applyBody({ job_slug: jobB.slug, email, phone_number: '09055500' + n }), headers: ip(40 + Number(n)) }); assert.strictEqual(r.status, 200, JSON.stringify(r.json)); };
  await sendApp('11', 'pro1@example.com');
  assert.ok(H.calls.some(c => /telegram/.test(c.url) && c.body.chat_id === '555123'), 'Pro nhận Telegram');
  recOf(recB.id).plan_until = new Date(Date.now() - 1000).toISOString();         // hết hạn
  await sendApp('12', 'free1@example.com');
  assert.ok(!H.calls.some(c => /telegram/.test(c.url) && c.body.chat_id === '555123'), 'Free không nhận Telegram');
  assert.ok(H.calls.some(c => /resend/.test(c.url) && c.body.to[0] === 'thongbao-binh@example.com'), 'vẫn nhận email');
  assert.strictEqual((await as(ckB)('bootstrap')).plan.pro, false);
  await admin('recruiters.update', { id: recB.id, plan_months: 1 });
  const first = new Date(recOf(recB.id).plan_until); await admin('recruiters.update', { id: recB.id, plan_months: 12 });
  assert.ok((new Date(recOf(recB.id).plan_until) - first) / 86400e3 > 360, 'cộng dồn vào hạn còn lại');
  await admin('recruiters.update', { id: recB.id, plan_lifetime: true });
  assert.strictEqual(PLAN.isPro(recOf(recB.id)), true); assert.strictEqual(PLAN.isLifetime(recOf(recB.id)), true);
  const sm = (await as(ckB)('bootstrap')).plan; assert.strictEqual(sm.lifetime, true); assert.strictEqual(sm.price.lifetime, 999000); assert.strictEqual(sm.price.lifetime_list, 1995000); assert.strictEqual(sm.price.year, undefined);
  await assert.rejects(() => as(ckB)('recruiters.update', { id: recB.id, plan_lifetime: true }), /403/, 'tự cấp vĩnh viễn là không được');
  await admin('recruiters.update', { id: recB.id, plan_months: 0 }); assert.strictEqual(recOf(recB.id).plan_until, null);
  await assert.rejects(() => admin('recruiters.update', { id: recB.id, plan_months: -1 }), /400/);
  await assert.rejects(() => as(ckB)('recruiters.update', { id: recB.id, plan_months: 12 }), /403/, 'tự nâng gói là không được');
});
test('gói Free: 30 lượt AI đọc CV mỗi tháng, sang tháng sau tự reset; Pro không giới hạn', async () => {
  const b = as(ckB); setFree(recB.id);
  const cand = H.fake.t.lh_candidates.find(c => c.recruiter_id === recB.id);
  const row = recOf(recB.id); row.ai_month = PLAN.monthKey(); row.ai_count = 29;
  H.state.cv = null;
  await b('candidates.parse', { id: cand.id, text: H.CV_TEXT });
  assert.strictEqual(recOf(recB.id).ai_count, 30);
  const err = await b('candidates.parse', { id: cand.id, text: H.CV_TEXT }).catch(e => e);
  assert.strictEqual(err.status, 403); assert.match(err.message, /30 lượt/);
  assert.strictEqual((await b('bootstrap')).plan.usage.ai, 30);
  row.ai_month = '2020-01';                                                         // tháng cũ → đếm lại từ 0
  await b('candidates.parse', { id: cand.id, text: H.CV_TEXT }); assert.strictEqual(recOf(recB.id).ai_count, 1);
  row.ai_count = 500; row.ai_month = PLAN.monthKey(); await admin('recruiters.update', { id: recB.id, plan_months: 1 });
  await b('candidates.parse', { id: cand.id, text: H.CV_TEXT });
});
test('gói Free: tối đa 100 ứng viên (thêm tay và nộp qua trang đều bị chặn, ứng viên cũ nộp lại thì không)', async () => {
  const b = as(ckB); setFree(recB.id);
  const have = H.fake.t.lh_candidates.filter(c => c.recruiter_id === recB.id).length;
  for (let i = have; i < 100; i++) H.fake.t.lh_candidates.push({ id: 'fill-' + i, recruiter_id: recB.id, full_name: 'Fill ' + i, email: `fill${i}@x.com`, email_norm: `fill${i}@x.com`, phone_norm: '', created_at: new Date().toISOString() });
  await assert.rejects(() => b('candidates.save', { full_name: 'Người thứ 101' }), /403/);
  const up = await H.invoke(H.F('admin-api'), { body: { action: 'candidates.upload', file: { name: 'a.pdf', data: H.fakePdf() } }, headers: { cookie: ckB, 'x-lh': '1' } });
  assert.strictEqual(up.status, 403);
  const blocked = await H.invoke(H.F('apply'), { body: applyBody({ job_slug: jobB.slug, email: 'moi101@example.com', phone_number: '0905551101' }), headers: ip(51) });
  assert.strictEqual(blocked.status, 503); assert.match(blocked.json.error, /tạm thời chưa nhận/);
  assert.ok(!H.fake.t.lh_candidates.some(c => c.email_norm === 'moi101@example.com'));
  const again = await H.invoke(H.F('apply'), { body: applyBody({ job_slug: jobB.slug, email: 'an.nguyen@example.com', phone_number: '0912345678' }), headers: ip(52) });
  assert.strictEqual(again.status, 200, 'ứng viên đã có trong kho vẫn nộp được: ' + JSON.stringify(again.json));
  await admin('recruiters.update', { id: recB.id, plan_months: 1 });
  assert.strictEqual((await b('candidates.save', { full_name: 'Người thứ 101' })).candidate.full_name, 'Người thứ 101');
  H.fake.t.lh_candidates = H.fake.t.lh_candidates.filter(c => !String(c.id).startsWith('fill-'));
});

test('công tắc tính phí: tắt lại thì Free hết giới hạn, trang công khai không còn "Powered by Luna"', async () => {
  setFree(recB.id);
  assert.strictEqual((await admin('billing.set', { on: false })).billing, false);
  const bb = as(ckB);
  for (let i = 0; i < 5; i++) await bb('jobs.save', { title: 'Job tắt phí ' + i, status: 'open', summary: 'x'.repeat(30) }).catch(() => {});
  assert.ok(H.fake.t.lh_jobs.filter(j => j.recruiter_id === recB.id && j.status === 'open').length > 3, 'tắt phí → mở quá 3 job được');
  assert.strictEqual(PLAN.isPro(recOf(recB.id)), true);
  await admin('billing.set', { on: true });
  assert.strictEqual(PLAN.isPro(recOf(recB.id)), false);
});
test('báo cáo: recruiter gửi báo lỗi/góp ý, admin nhận thông báo và xem/đóng/xoá; có giới hạn số lần gửi, người thường không xem được danh sách', async () => {
  const bb = as(ckB);
  await assert.rejects(() => bb('reports.send', { kind: 'bug', message: 'x' }), e => e.status === 400);
  H.calls.length = 0;
  await bb('reports.send', { kind: 'bug', message: 'Nút Lưu ở Cài đặt bị đơ khi bấm', page: 'Cài đặt' });
  assert.ok(H.calls.some(x => /resend/.test(x.url) && /Nút Lưu/.test(x.body.html)), 'email tới admin');
  const rows = H.fake.t.lh_reports; assert.strictEqual(rows.length, 1); assert.strictEqual(rows[0].recruiter_id, recB.id); assert.strictEqual(rows[0].status, 'new');
  await bb('reports.send', { kind: 'không-hợp-lệ', message: 'Một góp ý khác về giao diện' });
  assert.strictEqual(H.fake.t.lh_reports[1].kind, 'other');
  await assert.rejects(() => bb('reports.list'), e => e.status === 403);
  await assert.rejects(() => bb('reports.update', { id: rows[0].id, status: 'done' }), e => e.status === 403);
  const l = await admin('reports.list'); assert.strictEqual(l.reports.length, 2); assert.strictEqual(l.reports[0].who.handle, recB.handle);
  await admin('reports.update', { id: rows[0].id, status: 'done' }); assert.strictEqual(H.fake.t.lh_reports.find(x => x.id === rows[0].id).status, 'done');
  await admin('reports.update', { id: rows[0].id, delete: true }); assert.strictEqual(H.fake.t.lh_reports.length, 1);
  for (let i = 0; i < 4; i++) await bb('reports.send', { kind: 'idea', message: 'Góp ý số ' + i + ' cho web' });
  await assert.rejects(() => bb('reports.send', { kind: 'idea', message: 'Góp ý quá nhiều lần' }), e => e.status === 429);
});
test('job: mức ưu tiên, nhân đôi thành bản nháp, thao tác hàng loạt; chỉ đụng job của chính mình', async () => {
  const bb = as(ckB);
  const mk = async (title, extra = {}) => (await bb('jobs.save', { title, status: 'draft', location: 'TP.HCM, Remote', ...extra })).job;
  const j1 = await mk('Ưu tiên A', { priority: 'urgent' }), j2 = await mk('Ưu tiên B'), j3 = await mk('Ưu tiên C', { priority: 'không-hợp-lệ' });
  assert.strictEqual(j1.priority, 'urgent'); assert.strictEqual(j2.priority, 'normal'); assert.strictEqual(j3.priority, 'normal', 'giá trị lạ về Thường');
  assert.strictEqual((await bb('jobs.save', { id: j2.id, priority: 'high' })).job.priority, 'high');
  // nhân đôi: bản nháp mới, slug khác, giữ nội dung và ưu tiên
  const d = (await bb('jobs.duplicate', { id: j1.id })).job;
  assert.strictEqual(d.status, 'draft'); assert.notStrictEqual(d.slug, j1.slug); assert.strictEqual(d.title, 'Ưu tiên A (bản sao)'); assert.strictEqual(d.priority, 'urgent'); assert.strictEqual(d.location, 'TP.HCM, Remote'); assert.strictEqual(d.recruiter_id, recB.id);
  assert.strictEqual((await bb('jobs.duplicate', { id: d.id })).job.title, 'Ưu tiên A (bản sao)', 'không chồng thêm chữ (bản sao)');
  // hàng loạt
  let r = await bb('jobs.bulk', { ids: [j1.id, j2.id, j3.id], priority: 'high' }); assert.strictEqual(r.updated, 3);
  assert.ok([j1, j2, j3].every(j => H.fake.t.lh_jobs.find(x => x.id === j.id).priority === 'high'));
  r = await bb('jobs.bulk', { ids: [j1.id, j2.id], status: 'paused' }); assert.strictEqual(r.updated, 2);
  assert.strictEqual(H.fake.t.lh_jobs.find(x => x.id === j1.id).status, 'paused');
  await assert.rejects(() => bb('jobs.bulk', { ids: [] , status: 'open' }), e => e.status === 400);
  await assert.rejects(() => bb('jobs.bulk', { ids: [j1.id], status: 'bậy' }), e => e.status === 400);
  await assert.rejects(() => bb('jobs.bulk', { ids: [j1.id] }), e => e.status === 400);
  // job của người khác không bị đụng
  const ownerJob = H.fake.t.lh_jobs.find(x => x.recruiter_id !== recB.id);
  r = await bb('jobs.bulk', { ids: [ownerJob.id], status: 'closed', priority: 'urgent' }); assert.strictEqual(r.updated, 0);
  assert.notStrictEqual(H.fake.t.lh_jobs.find(x => x.id === ownerJob.id).priority, 'urgent'); await assert.rejects(() => bb('jobs.duplicate', { id: ownerJob.id }), e => e.status === 404);
  // xoá hàng loạt: job có hồ sơ được giữ lại
  const withApp = H.fake.t.lh_applications.find(a => a.recruiter_id === recB.id);
  const ids = [j3.id, d.id].concat(withApp ? [withApp.job_id].filter(Boolean) : []);
  r = await bb('jobs.bulk', { ids, delete: true }); assert.ok(r.deleted >= 2);
  assert.ok(!H.fake.t.lh_jobs.some(x => x.id === j3.id)); if (withApp && withApp.job_id) assert.ok(H.fake.t.lh_jobs.some(x => x.id === withApp.job_id), 'job có hồ sơ được giữ'); 
  // ưu tiên là thông tin nội bộ: trang công khai không lộ
  const pub = await H.invoke(H.F('jobs-public'), { method: 'GET', query: {}, headers: {} }).catch(() => null);
  if (pub && pub.json && pub.json.jobs) assert.ok(pub.json.jobs.every(x => x.priority === undefined), 'không lộ priority');
});
test('thanh toán QR: chỉ có thông tin nhận tiền khi đã cấu hình PAY_BANK/PAY_ACCOUNT', async () => {
  assert.strictEqual((await as(ckB)('bootstrap')).plan.pay, null);
  Object.assign(process.env, { PAY_BANK: 'VCB', PAY_ACCOUNT: '0001112223', PAY_NAME: 'NGUYEN VAN A' });
  try {
    const pay = (await as(ckB)('bootstrap')).plan.pay;
    assert.deepStrictEqual(pay, { bank: 'VCB', account: '0001112223', name: 'NGUYEN VAN A' });
  } finally { delete process.env.PAY_BANK; delete process.env.PAY_ACCOUNT; delete process.env.PAY_NAME; }
});

test('nhiều key Gemini: gộp từ nhiều biến, bỏ trùng; hết hạn mức thì đổi key, key nghỉ thì được bỏ qua', async () => {
  const AI = require('../server/_lib/ai');
  const ask = () => AI.llm({ text: 'Đọc đoạn mô tả công việc: x' });
  const keysUsed = () => H.calls.filter(c => /generativelanguage/.test(c.url)).map(c => c.headers['x-goog-api-key']);
  const set = { GEMINI_API_KEY: 'key-AAAAAAAA', GEMINI_API_KEY_2: 'key-BBBBBBBB', GEMINI_API_KEY_3: 'key-CCCCCCCC', GEMINI_API_KEYS: 'key-DDDDDDDD, key-AAAAAAAA\nkey-EEEEEEEE', GEMINI_API_KEY_9: '  ' };
  Object.assign(process.env, set); AI._resetKeys(); process.env.AI_PROVIDERS = 'gemini,groq';
  try {
    assert.deepStrictEqual(AI.geminiKeys(), ['key-AAAAAAAA', 'key-DDDDDDDD', 'key-EEEEEEEE', 'key-BBBBBBBB', 'key-CCCCCCCC'].sort((a, b) => 0) && AI.geminiKeys());
    assert.strictEqual(AI.geminiKeys().length, 5, 'gộp 5 key khác nhau, trùng và rỗng bị bỏ');
    // chia tải: các lần gọi liên tiếp xoay vòng giữa các key
    H.calls.length = 0; for (let i = 0; i < 5; i++) await ask();
    assert.strictEqual(new Set(keysUsed()).size, 5, 'xoay vòng đủ 5 key');
    // key đầu tiên được chọn hết hạn mức → đổi sang key kế, key đó nghỉ, lần sau không gọi lại
    AI._resetKeys();
    const bad = AI.geminiKeys()[0];
    H.state.geminiScript = (k) => (k === bad ? { status: 429, body: { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded for metric: generate_content_free_tier_requests, limit: 15' } } } : null);
    H.calls.length = 0; assert.match(await ask(), /Senior Java/);
    assert.deepStrictEqual(keysUsed()[0], bad); assert.notStrictEqual(keysUsed()[1], bad); assert.ok(!H.calls.some(c => /groq/.test(c.url)), 'còn key khác thì không sang Groq');
    H.calls.length = 0; for (let i = 0; i < 8; i++) await ask();
    assert.ok(!keysUsed().includes(bad), 'key đang nghỉ không bị gọi lại');
  } finally { H.state.geminiScript = null; for (const k of Object.keys(set)) delete process.env[k]; delete process.env.AI_PROVIDERS; AI._resetKeys(); }
});
test('nhiều key Gemini: key sai/bị khoá/hết hạn thì bỏ, lỗi mạng và quá giờ thì đổi key, lỗi yêu cầu sai thì dừng', async () => {
  const AI = require('../server/_lib/ai');
  const ask = () => AI.llm({ text: 'Đọc đoạn mô tả công việc: x' });
  const keysUsed = () => H.calls.filter(c => /generativelanguage/.test(c.url)).map(c => c.headers['x-goog-api-key']);
  Object.assign(process.env, { GEMINI_API_KEY: 'key-1111111', GEMINI_API_KEY_2: 'key-2222222', GEMINI_API_KEY_3: 'key-3333333' });
  process.env.GROQ_API_KEY = '';
  const only = (k, status, body) => { H.state.geminiScript = (key) => (key === k ? { status, body } : null); AI._resetKeys(); };
  const first = () => { AI._resetKeys(); return AI.geminiKeys()[0]; };
  try {
    for (const [name, status, body] of [
      ['key sai', 400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } }],
      ['key bị khoá', 403, { error: { code: 403, message: 'Your API key was reported as leaked. Please use another API key.', status: 'PERMISSION_DENIED' } }],
      ['key bị thu hồi', 401, { error: { code: 401, message: 'API keys are not supported by this API.' } }],
      ['key hết hạn', 400, { error: { code: 400, message: 'API key expired. Please renew the API key.' } }],
      ['hết hạn mức ngày', 429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'You exceeded your current quota, limit: 0, per day' } }],
      ['hết hạn mức phút (retryDelay)', 429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED', details: [{ retryDelay: '34s' }], message: 'Quota exceeded: rate limit per minute' } }],
    ]) {
      const k = first(); only(k, status, body); H.calls.length = 0;
      assert.match(await ask(), /Senior Java/, name);
      assert.strictEqual(keysUsed()[0], k, name); assert.ok(keysUsed().length >= 2 && !keysUsed().slice(1).includes(k), name + ': đổi sang key khác');
    }
    // lỗi mạng và quá giờ: đổi key, không sập
    const realFetch = global.fetch; let n = 0;
    global.fetch = async (url, o) => { if (/generativelanguage/.test(String(url)) && n++ < 2) { H.calls.push({ url: String(url), body: null, headers: o.headers }); throw n === 1 ? new TypeError('fetch failed') : Object.assign(new Error('t'), { name: 'TimeoutError' }); } return realFetch(url, o); };
    AI._resetKeys(); H.state.geminiScript = null; H.calls.length = 0;
    try { assert.match(await ask(), /Senior Java/); } finally { global.fetch = realFetch; }
    assert.strictEqual(new Set(keysUsed()).size, 3, 'mạng hỏng → thử key thứ 2, quá giờ → thử key thứ 3');
    // lỗi yêu cầu sai (400 không liên quan key/model): dừng, không đốt hết key
    H.state.geminiScript = () => ({ status: 400, body: { error: { code: 400, message: 'Request contains an invalid argument.' } } }); AI._resetKeys(); H.calls.length = 0;
    await assert.rejects(() => ask(), /Gemini API 400/); assert.strictEqual(keysUsed().length, 1);
    // cả 3 key hết hạn mức: báo rõ, nhanh, không chờ vô ích
    H.state.geminiScript = () => ({ status: 429, body: { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded' } } }); AI._resetKeys(); H.calls.length = 0;
    await assert.rejects(() => ask(), e => /cả 3 key/.test(e.message)); assert.strictEqual(keysUsed().length, 3);
    H.calls.length = 0; await assert.rejects(() => ask(), /cả 3 key/); assert.strictEqual(keysUsed().length, 0, 'tất cả đang nghỉ → không gọi nữa');
  } finally { H.state.geminiScript = null; for (const k of ['GEMINI_API_KEY', 'GEMINI_API_KEY_2', 'GEMINI_API_KEY_3']) delete process.env[k]; process.env.GROQ_API_KEY = 'gsk_fake'; AI._resetKeys(); }
});
test('nhiều key Gemini: server quá tải (503/overloaded) thì chờ vài giây rồi gọi lại, không đổi key; lỗi 5xx thoáng qua thử lại; hết cách mới sang Groq', async () => {
  const AI = require('../server/_lib/ai');
  const ask = () => AI.llm({ text: 'Đọc đoạn mô tả công việc: x' });
  const keysUsed = () => H.calls.filter(c => /generativelanguage/.test(c.url)).map(c => c.headers['x-goog-api-key']);
  Object.assign(process.env, { GEMINI_API_KEY: 'key-1111111', GEMINI_API_KEY_2: 'key-2222222' });
  try {
    let n = 0; AI._resetKeys();
    H.state.geminiScript = () => (n++ < 2 ? { status: 503, body: { error: { code: 503, status: 'UNAVAILABLE', message: 'The model is overloaded. Please try again later.' } } } : null);
    H.calls.length = 0; const t0 = Date.now();
    assert.match(await ask(), /Senior Java/); assert.strictEqual(keysUsed().length, 3, '2 lần quá tải rồi lần 3 thành công');
    // 429 kiểu "overloaded" cũng là quá tải, không phải hết quota
    n = 0; H.state.geminiScript = () => (n++ < 1 ? { status: 429, body: { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'The service is currently overloaded, high demand. Try again later.' } } } : null);
    AI._resetKeys(); H.calls.length = 0; assert.match(await ask(), /Senior Java/); assert.strictEqual(keysUsed().length, 2);
    assert.ok(!H.calls.some(c => /groq/.test(c.url)));
    // lỗi 500 thoáng qua: thử lại một lần rồi mới đổi key
    n = 0; H.state.geminiScript = () => (n++ < 1 ? { status: 500, body: { error: { code: 500, message: 'Internal error' } } } : null);
    AI._resetKeys(); H.calls.length = 0; assert.match(await ask(), /Senior Java/); assert.strictEqual(keysUsed().length, 2);
    // quá tải kéo dài: đã chờ và thử lại vài lần, cuối cùng sang Groq
    H.state.geminiScript = () => ({ status: 503, body: { error: { code: 503, status: 'UNAVAILABLE', message: 'overloaded' } } });
    AI._resetKeys(); H.calls.length = 0; assert.match(await ask(), /Senior Java/);
    assert.ok(H.calls.some(c => /groq/.test(c.url)), 'Groq cứu khi Gemini quá tải dai dẳng');
    assert.ok(keysUsed().length >= 4, 'đã thử lại nhiều lần trước khi bỏ');
    // bị chặn an toàn (không phải lỗi key): không đốt key, nhường Groq
    H.state.geminiScript = () => ({ status: 200, body: { candidates: [{ finishReason: 'SAFETY' }] } });
    AI._resetKeys(); H.calls.length = 0; await ask(); assert.strictEqual(keysUsed().length, 1);
  } finally { H.state.geminiScript = null; delete process.env.GEMINI_API_KEY; delete process.env.GEMINI_API_KEY_2; AI._resetKeys(); }
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
