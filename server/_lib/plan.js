'use strict';
/**
 * Gói Free / Pro cho recruiter. Pro = còn hạn (plan_until > bây giờ), admin tổng luôn là Pro.
 * Chỉnh giá và hạn mức ở đây. Thu tiền thủ công: admin bấm "Nâng Pro" trong tab Recruiter.
 */
const { sb } = require('./db');
const { HttpError } = require('./util');

const LIMITS = { jobs: 3, candidates: 100, ai_month: 30 };
const PRICE = { month: 99000, month_list: 199000, lifetime: 999000, lifetime_list: 1995000 }; // đ
const LIFETIME_UNTIL = '2099-12-31T00:00:00.000Z'; // gói vĩnh viễn = hạn Pro đặt tới năm 2099
const isLifetime = (rec) => !!rec && !!rec.plan_until && new Date(rec.plan_until).getUTCFullYear() >= 2099;
const TRIAL_DAYS = 30;

/**
 * Công tắc tính phí (admin bật/tắt ở tab Recruiter). TẮT (mặc định) = mọi người dùng đủ tính năng, không giới hạn, không thấy giá.
 * Lưu ở bảng lh_settings (key 'billing'); chưa có bảng hoặc lỗi đọc thì coi như TẮT. Nhớ trong bộ nhớ vài giây.
 */
const BILLING_TTL = 15e3;
const billing = { on: false, at: 0 };
async function load(force) {
  if (!force && Date.now() - billing.at < BILLING_TTL) return billing.on;
  try {
    const r = await sb().from('lh_settings').select('value').eq('key', 'billing').maybeSingle();
    billing.on = !r.error && !!(r.data && r.data.value && r.data.value.on === true);
  } catch (e) { billing.on = false; }
  billing.at = Date.now();
  return billing.on;
}
async function setBilling(on) {
  const db = sb(), value = { on: !!on };
  const cur = await db.from('lh_settings').select('key').eq('key', 'billing').maybeSingle();
  if (cur.error) throw new HttpError(500, 'Chưa có bảng lh_settings. Hãy chạy file SQL mới trong Supabase rồi thử lại.');
  const w = cur.data ? await db.from('lh_settings').update({ value }).eq('key', 'billing') : await db.from('lh_settings').insert({ key: 'billing', value });
  if (w.error) throw new HttpError(500, 'Không lưu được cài đặt: ' + w.error.message);
  billing.on = !!on; billing.at = Date.now();
  return billing.on;
}
const billingOn = () => billing.on;

const isPro = (rec) => !!rec && (!billing.on || rec.role === 'admin' || (!!rec.plan_until && new Date(rec.plan_until).getTime() > Date.now()));
const monthKey = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 7);
const aiUsed = (rec) => (rec.ai_month === monthKey() ? Number(rec.ai_count) || 0 : 0);

const upgrade = (msg) => new HttpError(403, msg + ' Nâng cấp Pro trong mục Cài đặt để dùng không giới hạn.', { upgrade: true });
const needPro = (rec, what) => { if (!isPro(rec)) throw upgrade(`${what} chỉ có ở gói Pro.`); };

async function countOf(table, rid, extra) {
  let q = sb().from(table).select('id', { count: 'exact', head: true }).eq('recruiter_id', rid);
  if (extra) q = extra(q);
  return (await q).count || 0;
}

/** Gói Free: tối đa 3 job đang mở. Gọi trước khi mở thêm một job. */
async function checkOpenJob(rec, rid) {
  if (isPro(rec)) return;
  if ((await countOf('lh_jobs', rid, q => q.eq('status', 'open'))) >= LIMITS.jobs) throw upgrade(`Gói Free chỉ mở tối đa ${LIMITS.jobs} job cùng lúc.`);
}
/** Gói Free: tối đa 100 ứng viên. */
async function candidateRoom(rec, rid) {
  if (isPro(rec)) return true;
  return (await countOf('lh_candidates', rid)) < LIMITS.candidates;
}
async function checkCandidates(rec, rid) {
  if (!(await candidateRoom(rec, rid))) throw upgrade(`Gói Free lưu tối đa ${LIMITS.candidates} ứng viên.`);
}
/** Gói Free: 30 lượt AI đọc CV mỗi tháng (giờ Việt Nam). Gọi mỗi lần thực sự chạy AI. */
async function useAi(rec) {
  const key = monthKey(), used = aiUsed(rec);
  if (!isPro(rec) && used >= LIMITS.ai_month) throw upgrade(`Bạn đã dùng hết ${LIMITS.ai_month} lượt AI đọc CV của tháng này.`);
  await sb().from('lh_recruiters').update({ ai_month: key, ai_count: used + 1 }).eq('id', rec.id);
  rec.ai_month = key; rec.ai_count = used + 1;
}

/** Số liệu hiển thị ở Cài đặt. */
async function summary(rec, rid) {
  const pro = isPro(rec);
  return {
    billing: billing.on, pro, lifetime: isLifetime(rec), role_admin: rec.role === 'admin', plan_until: rec.plan_until || null, limits: LIMITS, price: PRICE,
    payment_info: process.env.PAYMENT_INFO || '',
    // Thông tin nhận tiền để dựng mã VietQR: PAY_BANK (mã ngân hàng, vd VCB), PAY_ACCOUNT, PAY_NAME
    pay: process.env.PAY_BANK && process.env.PAY_ACCOUNT ? { bank: process.env.PAY_BANK, account: process.env.PAY_ACCOUNT, name: process.env.PAY_NAME || '' } : null,
    usage: { jobs: await countOf('lh_jobs', rid, q => q.eq('status', 'open')), candidates: await countOf('lh_candidates', rid), ai: aiUsed(rec) },
  };
}

module.exports = { LIFETIME_UNTIL, isLifetime, load, setBilling, billingOn, LIMITS, PRICE, TRIAL_DAYS, isPro, needPro, upgrade, checkOpenJob, candidateRoom, checkCandidates, useAi, summary, monthKey };
