'use strict';
const crypto = require('crypto');
const { HttpError } = require('./util');

const DAYS = 7;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 24) throw new HttpError(500, 'Chưa cấu hình SESSION_SECRET (tối thiểu 24 ký tự).');
  return s;
}
const hmac = (data) => crypto.createHmac('sha256', secret()).update(data).digest('base64url');

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return body + '.' + hmac(body);
}

function verify(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const [body, mac] = token.split('.');
  const expect = hmac(body);
  const a = Buffer.from(mac || ''), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return p && p.exp > Date.now() ? p : null;
  } catch { return null; }
}

function getCookie(event, name) {
  const raw = (event.headers && (event.headers.cookie || event.headers.Cookie)) || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}

/** Gọi đầu mỗi request admin. Cookie hợp lệ + header x-lh (chặn CSRF cơ bản). */
function requireAdmin(event) {
  if (!verify(getCookie(event, 'lh_admin'))) throw new HttpError(401, 'Chưa đăng nhập.');
  if ((event.headers || {})['x-lh'] !== '1') throw new HttpError(403, 'Yêu cầu không hợp lệ.');
}

function sessionCookie(event, token, maxAgeSec) {
  const host = (event.headers && event.headers.host) || '';
  const local = /^(localhost|127\.0\.0\.1)/.test(host);
  return `lh_admin=${token}; HttpOnly; ${local ? '' : 'Secure; '}SameSite=Strict; Path=/; Max-Age=${maxAgeSec}`;
}

function newSession() { return sign({ exp: Date.now() + DAYS * 86400e3 }); }

/** So sánh mật khẩu theo thời gian không đổi (băm trước để hai chuỗi cùng độ dài). */
function checkPassword(input) {
  const real = process.env.ADMIN_PASSWORD;
  if (!real) throw new HttpError(500, 'Chưa cấu hình ADMIN_PASSWORD.');
  const h = s => crypto.createHash('sha256').update(String(s)).digest();
  return crypto.timingSafeEqual(h(input), h(real));
}

/** Khoá để function nền chỉ nhận lệnh từ chính site (không ai gọi trực tiếp được). */
function internalSecret() { return hmac('internal'); }

module.exports = { requireAdmin, sessionCookie, newSession, checkPassword, internalSecret, verify, sign, getCookie, DAYS };
