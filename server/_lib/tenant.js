'use strict';
/**
 * Nhiều recruiter dùng chung một site: mỗi người một tài khoản, dữ liệu tách theo recruiter_id.
 * File này giữ: phiên đăng nhập, tìm recruiter hiện tại, tài khoản chủ, hồ sơ công khai, đích nhận thông báo.
 */
const { sb, must } = require('./db');
const A = require('./auth');
const { HttpError, clean } = require('./util');
const OWNER = require('./owner-defaults');
const PLAN = require('./plan');

const COOKIE_DAYS = A.DAYS;
const TABLES = ['lh_jobs', 'lh_candidates', 'lh_applications', 'lh_activities', 'lh_threads'];
const RESERVED = new Set(['apply', 'track', 'q', 'admin', 'jobs', 'api', 'assets', 'privacy', 'login', 'register', 'reset', 'sitemap', 'robots', 'about', 'help',
  'terms', 'static', 'www', 'app', 'luna', 'lunahouse', 'support', 'null', 'undefined', 'index', 'favicon', 'og', 'health', 'status', 'account', 'settings',
  'dashboard', 'me', 'u', 'r', 'new', 'job', 'cv', 'auth', 'public', 'home', 'contact', 'blog']);

const ownerEmail = () => String(process.env.ADMIN_EMAIL || process.env.ADMIN_NOTIFY_EMAIL || '').trim().toLowerCase();
const ownerHandle = () => cleanHandle(process.env.ADMIN_HANDLE || 'lam') || 'lam';

function cleanHandle(h) {
  return String(h || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
}
function checkHandle(h) {
  if (!/^[a-z0-9][a-z0-9-]{2,29}$/.test(h)) throw new HttpError(400, 'Đường dẫn phải dài 3–30 ký tự, chỉ gồm chữ thường, số và dấu gạch ngang.');
  if (RESERVED.has(h)) throw new HttpError(400, 'Đường dẫn này được hệ thống giữ, bạn chọn tên khác nhé.');
}

const PUBLIC_COLS = 'handle,display_name,title,bio,contact_email,zalo,facebook,linkedin,telegram,communities';
const publicProfile = (r) => r && ({
  handle: r.handle, is_default: !!r.email_norm && r.email_norm === ownerEmail(), display_name: r.display_name, title: r.title, bio: r.bio, contact_email: r.contact_email,
  zalo: r.zalo, facebook: r.facebook, linkedin: r.linkedin, telegram: r.telegram, communities: Array.isArray(r.communities) ? r.communities : [],
  pro: PLAN.isPro(r), logo_url: PLAN.isPro(r) ? r.logo_url || '' : '', cover_url: PLAN.isPro(r) ? r.cover_url || '' : '',
});

async function byId(id) { await PLAN.load(); return id ? must(await sb().from('lh_recruiters').select('*').eq('id', id).maybeSingle(), 'recruiter') : null; }
async function byEmail(email) { await PLAN.load(); return must(await sb().from('lh_recruiters').select('*').eq('email_norm', String(email).trim().toLowerCase()).maybeSingle(), 'recruiter'); }
async function byHandle(handle) { await PLAN.load(); return must(await sb().from('lh_recruiters').select('*').eq('handle', String(handle || '').toLowerCase()).maybeSingle(), 'recruiter'); }

/** Gán dữ liệu cũ (chưa có chủ) cho recruiter này. */
async function claimLegacy(id) {
  const db = sb();
  for (const t of TABLES) must(await db.from(t).update({ recruiter_id: id }).is('recruiter_id', null), 'claim ' + t);
}

/** Tài khoản chủ (admin). Chưa có thì tạo từ ADMIN_EMAIL và nhận toàn bộ dữ liệu cũ. */
async function ensureOwner() {
  const email = ownerEmail();
  if (!email) throw new HttpError(500, 'Chưa cấu hình ADMIN_EMAIL (email của tài khoản chủ).');
  let rec = await byEmail(email);
  if (rec) return rec;
  const db = sb();
  let handle = ownerHandle();
  if (await byHandle(handle)) handle = handle + '-' + Math.random().toString(36).slice(2, 5);
  const ins = await db.from('lh_recruiters').insert({ email, handle, role: 'admin', status: 'active', ...OWNER }).select().single();
  if (ins.error) { rec = await byEmail(email); if (rec) return rec; must(ins, 'owner'); }
  rec = ins.data;
  await claimLegacy(rec.id);
  return rec;
}

/** Người nhận trang chủ "/" (không có handle). */
async function defaultRecruiter() {
  const rec = await ensureOwner();
  return rec.status === 'active' ? rec : null;
}

/** Recruiter công khai theo handle (chỉ tài khoản đã được duyệt). */
async function publicByHandle(handle) {
  if (!handle) return defaultRecruiter();
  const rec = await byHandle(cleanHandle(handle));
  return rec && rec.status === 'active' ? rec : null;
}

// ---------- phiên ----------
function startSession(event, rec) {
  const token = A.sign({ rid: rec.id, exp: Date.now() + COOKIE_DAYS * 86400e3 });
  return { 'set-cookie': A.sessionCookie(event, token, COOKIE_DAYS * 86400) };
}
const endSession = (event) => ({ 'set-cookie': A.sessionCookie(event, '', 0) });

/** Recruiter đang đăng nhập (bắt buộc đã được duyệt). Cookie + header x-lh chống CSRF. */
async function requireUser(event) {
  const p = A.verify(A.getCookie(event, 'lh_admin'));
  if (!p || !p.rid) throw new HttpError(401, 'Chưa đăng nhập.');
  if ((event.headers || {})['x-lh'] !== '1') throw new HttpError(403, 'Yêu cầu không hợp lệ.');
  const rec = await byId(p.rid);
  if (!rec) throw new HttpError(401, 'Chưa đăng nhập.');
  if (rec.status === 'suspended') throw new HttpError(403, 'Tài khoản đã bị khoá. Liên hệ quản trị viên nếu cần hỗ trợ.');
  if (rec.status !== 'active') throw new HttpError(403, 'Tài khoản đang chờ được duyệt.');
  return rec;
}

/** Admin tổng có thể xem dữ liệu của recruiter khác (b.as). Trả về id chủ dữ liệu. */
async function dataOwner(rec, as) {
  if (!as || as === rec.id) return rec.id;
  if (rec.role !== 'admin') throw new HttpError(403, 'Bạn không có quyền xem dữ liệu của người khác.');
  const t = await byId(as);
  if (!t) throw new HttpError(404, 'Không tìm thấy recruiter.');
  return t.id;
}

/** Hồ sơ riêng tư gửi về cho chính chủ. */
const selfView = (r) => ({
  id: r.id, email: r.email, role: r.role, status: r.status, handle: r.handle, display_name: r.display_name, title: r.title, bio: r.bio,
  contact_email: r.contact_email, zalo: r.zalo, facebook: r.facebook, linkedin: r.linkedin, telegram: r.telegram,
  communities: Array.isArray(r.communities) ? r.communities : [], telegram_chat_id: r.telegram_chat_id, notify_email: r.notify_email,
  logo_url: r.logo_url || '', cover_url: r.cover_url || '', pro: PLAN.isPro(r), plan_until: r.plan_until || null,
});

/** Đích nhận thông báo và địa chỉ trả lời của một recruiter (rec có thể null với dữ liệu cũ). */
function notifyTarget(rec) {
  const owner = !rec || (rec.email_norm || String(rec.email || '').toLowerCase()) === ownerEmail();
  return {
    // Telegram là quyền lợi gói Pro (tài khoản chủ luôn có)
    chat: (rec && rec.telegram_chat_id && PLAN.isPro(rec) ? rec.telegram_chat_id : '') || (owner ? process.env.TELEGRAM_CHAT_ID : '') || '',
    to: (rec && rec.notify_email) || (owner && process.env.ADMIN_NOTIFY_EMAIL) || (rec && rec.email) || '',
    replyTo: (rec && (rec.contact_email || rec.email)) || process.env.MAIL_REPLY_TO || '',
    name: (rec && rec.display_name) || '',
    handle: rec ? rec.handle : '',
  };
}

const PROFILE_TEXT = { logo_url: 300, cover_url: 300, display_name: 60, title: 80, bio: 400, contact_email: 120, zalo: 200, facebook: 200, linkedin: 200, telegram: 200, notify_email: 120 };
const isUrl = v => /^https:\/\/[^\s"'<>]+$/.test(v);

/** Làm sạch dữ liệu hồ sơ công khai (link phải là https để không chèn được javascript:). */
function profilePatch(b) {
  const o = {};
  for (const [k, max] of Object.entries(PROFILE_TEXT)) if (b[k] !== undefined) o[k] = clean(b[k], max);
  for (const k of ['zalo', 'facebook', 'linkedin', 'telegram', 'logo_url', 'cover_url']) if (o[k] && !isUrl(o[k])) throw new HttpError(400, `Link ${k} phải bắt đầu bằng https://`);
  for (const k of ['contact_email', 'notify_email']) if (o[k] && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(o[k])) throw new HttpError(400, 'Email chưa đúng định dạng.');
  if (b.telegram_chat_id !== undefined) {
    const v = clean(b.telegram_chat_id, 30);
    if (v && !/^-?\d{5,20}$/.test(v)) throw new HttpError(400, 'Telegram chat id chỉ gồm chữ số (có thể có dấu - ở đầu).');
    o.telegram_chat_id = v;
  }
  if (b.communities !== undefined) {
    const list = Array.isArray(b.communities) ? b.communities : [];
    o.communities = list.slice(0, 12).map(c => ({
      kind: ['linkedin', 'facebook', 'zalo'].includes(c && c.kind) ? c.kind : 'facebook',
      name: clean(c && c.name, 80), note: clean(c && c.note, 60), url: clean(c && c.url, 300),
    })).filter(c => c.name && isUrl(c.url));
  }
  return o;
}

module.exports = {
  RESERVED, ownerEmail, cleanHandle, checkHandle, PUBLIC_COLS, publicProfile, byId, byEmail, byHandle, ensureOwner, defaultRecruiter, publicByHandle,
  startSession, endSession, requireUser, dataOwner, selfView, notifyTarget, profilePatch, claimLegacy,
};
