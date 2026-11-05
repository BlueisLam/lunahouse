'use strict';
/**
 * Đăng ký / đăng nhập cho recruiter.
 *  - Ai cũng đăng ký được, nhưng tài khoản mới ở trạng thái "chờ duyệt" cho tới khi admin tổng bấm duyệt.
 *  - Email + mật khẩu: Supabase Auth giữ mật khẩu (đã băm). Tài khoản chủ (ADMIN_EMAIL) vẫn dùng ADMIN_PASSWORD.
 *  - Đăng nhập Google: bật bằng GOOGLE_LOGIN=1 sau khi cấu hình provider Google trong Supabase.
 */
const U = require('./_lib/util');
const A = require('./_lib/auth');
const T = require('./_lib/tenant');
const G = require('./_lib/gotrue');
const N = require('./_lib/notify');
const { sb, must } = require('./_lib/db');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_REG_PER_IP_HOUR = 3;
const BAD = 'Sai email hoặc mật khẩu.';

const checkPw = pw => {
  if (typeof pw !== 'string' || pw.length < 8) throw new U.HttpError(400, 'Mật khẩu cần ít nhất 8 ký tự.');
  if (pw.length > 72) throw new U.HttpError(400, 'Mật khẩu tối đa 72 ký tự.');
};

function pendingOrBlocked(rec) {
  if (rec.status === 'suspended') throw new U.HttpError(403, 'Tài khoản đã bị khoá. Liên hệ quản trị viên nếu cần hỗ trợ.');
  if (rec.status !== 'active') throw new U.HttpError(403, 'Tài khoản của bạn đang chờ được duyệt. Mình sẽ gửi email ngay khi được duyệt.', { pending: true });
}

async function finishLogin(event, rec) {
  pendingOrBlocked(rec);
  await sb().from('lh_recruiters').update({ last_login_at: new Date().toISOString() }).eq('id', rec.id);
  return U.json(200, { ok: true, me: T.selfView(rec) }, T.startSession(event, rec));
}

async function freeHandle(want) {
  let h = T.cleanHandle(want);
  if (h.length < 3) h = 'recruiter-' + Math.random().toString(36).slice(2, 6);
  for (let i = 0; i < 8; i++) {
    if (!T.RESERVED.has(h) && !(await T.byHandle(h))) return h;
    h = (T.cleanHandle(want).slice(0, 24) || 'recruiter') + '-' + Math.random().toString(36).slice(2, 5);
  }
  throw new U.HttpError(409, 'Không tìm được đường dẫn trống, bạn chọn tên khác nhé.');
}

async function register(event, b) {
  if (b.website) return U.json(200, { ok: true, pending: true }); // honeypot
  const email = U.clean(b.email, 120).toLowerCase(), name = U.clean(b.display_name, 60);
  if (!EMAIL_RE.test(email)) throw new U.HttpError(400, 'Email chưa đúng định dạng.');
  checkPw(b.password);
  if (name.length < 2) throw new U.HttpError(400, 'Bạn nhập giúp mình tên hiển thị nhé.');
  const handle = T.cleanHandle(b.handle || name);
  T.checkHandle(handle);
  if (email === T.ownerEmail()) throw new U.HttpError(400, 'Email này không dùng để đăng ký.');
  const db = sb();
  const ipHash = U.sha256((process.env.SESSION_SECRET || '') + U.clientIp(event));
  const recent = await db.from('lh_recruiters').select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).gte('created_at', new Date(Date.now() - 3600e3).toISOString());
  if ((recent.count || 0) >= MAX_REG_PER_IP_HOUR) throw new U.HttpError(429, 'Bạn đăng ký hơi nhiều trong thời gian ngắn. Thử lại sau một giờ nhé.');
  if (await T.byEmail(email)) throw new U.HttpError(409, 'Email này đã được đăng ký. Hãy đăng nhập hoặc dùng "Quên mật khẩu".');
  if (await T.byHandle(handle)) throw new U.HttpError(409, 'Đường dẫn này đã có người dùng, bạn chọn tên khác nhé.');

  const auth_id = await G.createUser(email, b.password);
  const r = await db.from('lh_recruiters').insert({ auth_id, email, handle, display_name: name, status: 'pending', role: 'recruiter', ip_hash: ipHash }).select().single();
  if (r.error) {
    if (r.error.code === '23505') throw new U.HttpError(409, 'Email hoặc đường dẫn đã có người dùng, bạn thử lại với thông tin khác nhé.');
    must(r, 'register');
  }
  await N.settle([N.notifyNewRecruiter(r.data, N.baseUrl(event))]);
  return U.json(200, { ok: true, pending: true });
}

async function login(event, b) {
  const email = U.clean(b.email, 120).toLowerCase(), pw = typeof b.password === 'string' ? b.password : '';
  const fail = async (owner) => {
    await U.sleep(900);
    if (owner) await N.settle([N.telegram(`⚠️ Đăng nhập tài khoản chủ sai mật khẩu (IP ${U.esc(U.clientIp(event))})`)]);
    throw new U.HttpError(401, BAD);
  };
  if (!EMAIL_RE.test(email) || !pw) return fail(false);

  if (email === T.ownerEmail()) {
    if (!A.checkPassword(pw)) return fail(true);
    const owner = await T.ensureOwner();
    await T.claimLegacy(owner.id); // dữ liệu tạo bởi bản cũ trong lúc chạy song song (chưa có chủ) về tay chủ
    return finishLogin(event, owner);
  }
  const rec = await T.byEmail(email);
  if (!rec || !rec.auth_id) return fail(false);
  const uid = await G.signIn(email, pw);
  if (!uid || uid !== rec.auth_id) return fail(false);
  return finishLogin(event, rec);
}

async function google(event, b) {
  if (process.env.GOOGLE_LOGIN !== '1') throw new U.HttpError(400, 'Đăng nhập Google chưa được bật.');
  const u = await G.userFromToken(String(b.access_token || ''));
  if (!u || !EMAIL_RE.test(u.email)) throw new U.HttpError(401, 'Không xác nhận được tài khoản Google.');
  if (u.email === T.ownerEmail()) return finishLogin(event, await T.ensureOwner());
  let rec = await T.byEmail(u.email);
  if (rec) {
    if (rec.auth_id && rec.auth_id !== u.id) throw new U.HttpError(409, 'Email này đã đăng ký bằng mật khẩu. Hãy đăng nhập bằng email và mật khẩu.');
    if (!rec.auth_id) rec = must(await sb().from('lh_recruiters').update({ auth_id: u.id }).eq('id', rec.id).select().single(), 'link');
    return finishLogin(event, rec);
  }
  const name = U.clean(u.name, 60) || u.email.split('@')[0];
  const handle = await freeHandle(u.email.split('@')[0]);
  rec = must(await sb().from('lh_recruiters').insert({ auth_id: u.id, email: u.email, handle, display_name: name, status: 'pending', role: 'recruiter' }).select().single(), 'google register');
  await N.settle([N.notifyNewRecruiter(rec, N.baseUrl(event))]);
  return pendingOrBlocked(rec);
}

async function forgot(event, b) {
  const email = U.clean(b.email, 120).toLowerCase();
  const rec = EMAIL_RE.test(email) && email !== T.ownerEmail() ? await T.byEmail(email) : null;
  if (rec && rec.auth_id) {
    const token = await G.recoveryToken(email);
    if (token) await N.settle([N.emailPasswordReset(rec, `${N.baseUrl(event)}/admin/#/reset/${encodeURIComponent(token)}`)]);
  }
  await U.sleep(300);
  return U.json(200, { ok: true }); // luôn trả như nhau, không lộ email nào đã đăng ký
}

async function reset(b) {
  checkPw(b.password);
  const token = String(b.token || '');
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(token)) throw new U.HttpError(400, 'Link đặt lại mật khẩu không hợp lệ.');
  await G.resetPassword(token, b.password);
  return U.json(200, { ok: true });
}

exports.handler = U.wrap(async (event) => {
  if (event.httpMethod === 'GET') {
    return U.json(200, { google: process.env.GOOGLE_LOGIN === '1', supabase_url: process.env.GOOGLE_LOGIN === '1' ? process.env.SUPABASE_URL : '' }, { 'cache-control': 'public, max-age=300' });
  }
  if (event.httpMethod !== 'POST') throw new U.HttpError(405, 'Method not allowed');
  const b = U.parseBody(event, 4000);
  switch (b.action) {
    case 'register': return register(event, b);
    case 'login': return login(event, b);
    case 'google': return google(event, b);
    case 'forgot': return forgot(event, b);
    case 'reset': return reset(b);
    case 'logout': return U.json(200, { ok: true }, T.endSession(event));
    default: throw new U.HttpError(400, 'Hành động không hợp lệ.');
  }
});
