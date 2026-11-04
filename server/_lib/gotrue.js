'use strict';
/**
 * Gọi Supabase Auth (GoTrue) bằng REST. Mật khẩu do Supabase băm và lưu, app không bao giờ thấy lại.
 * Dùng service key nên chỉ chạy ở server.
 */
const { HttpError } = require('./util');

function conf() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/$/, ''), key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new HttpError(500, 'Chưa cấu hình SUPABASE_URL / SUPABASE_SERVICE_KEY.');
  return { url, key };
}

async function call(method, path, body, bearer) {
  const { url, key } = conf();
  let r;
  try {
    r = await fetch(url + '/auth/v1' + path, {
      method, headers: { 'content-type': 'application/json', apikey: key, authorization: 'Bearer ' + (bearer || key) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(8000),
    });
  } catch (e) { throw new HttpError(502, 'Không kết nối được dịch vụ đăng nhập. Thử lại sau ít phút.'); }
  let j = {}; try { j = await r.json(); } catch {}
  return { status: r.status, ok: r.ok, j };
}

const code = r => String((r.j && (r.j.error_code || r.j.code || r.j.msg || r.j.error_description || r.j.message)) || '');

/** Tạo người dùng (đã xác nhận email, vì tài khoản còn phải chờ admin duyệt). Trả về user id. */
async function createUser(email, password) {
  const r = await call('POST', '/admin/users', { email, password, email_confirm: true });
  if (r.ok && r.j && r.j.id) return r.j.id;
  if (/exists|registered/i.test(code(r)) || r.status === 422) throw new HttpError(409, 'Email này đã được đăng ký. Hãy đăng nhập hoặc dùng "Quên mật khẩu".');
  if (/weak|password/i.test(code(r))) throw new HttpError(400, 'Mật khẩu chưa đủ mạnh. Dùng ít nhất 8 ký tự.');
  throw new HttpError(502, 'Không tạo được tài khoản lúc này. Thử lại sau.');
}

/** Kiểm tra email + mật khẩu. Trả về user id, hoặc null nếu sai. */
async function signIn(email, password) {
  const r = await call('POST', '/token?grant_type=password', { email, password });
  if (r.ok && r.j && r.j.user) return r.j.user.id;
  if (r.status >= 500) throw new HttpError(502, 'Dịch vụ đăng nhập đang bận. Thử lại sau ít phút.');
  return null;
}

/** Từ access token (đăng nhập Google) lấy ra người dùng. */
async function userFromToken(token) {
  const r = await call('GET', '/user', null, token);
  return r.ok && r.j && r.j.id ? { id: r.j.id, email: String(r.j.email || '').toLowerCase(), name: (r.j.user_metadata && (r.j.user_metadata.full_name || r.j.user_metadata.name)) || '' } : null;
}

/** Quên mật khẩu: sinh mã khôi phục (hashed_token) để ta tự gửi email qua Resend. */
async function recoveryToken(email) {
  const r = await call('POST', '/admin/generate_link', { type: 'recovery', email });
  return r.ok && r.j && r.j.hashed_token ? r.j.hashed_token : null;
}

/** Đổi mật khẩu bằng mã khôi phục. */
async function resetPassword(tokenHash, password) {
  const v = await call('POST', '/verify', { type: 'recovery', token_hash: tokenHash });
  if (!v.ok || !v.j || !v.j.access_token) throw new HttpError(400, 'Link đặt lại mật khẩu đã hết hạn hoặc đã dùng. Hãy yêu cầu link mới.');
  const u = await call('PUT', '/user', { password }, v.j.access_token);
  if (!u.ok) throw new HttpError(400, /weak|password/i.test(code(u)) ? 'Mật khẩu mới chưa đủ mạnh.' : 'Không đổi được mật khẩu, thử lại sau.');
  return true;
}

module.exports = { createUser, signIn, userFromToken, recoveryToken, resetPassword };
