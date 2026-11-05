'use strict';
/**
 * Gói Free / Pro cho recruiter. Pro = còn hạn (plan_until > bây giờ), admin tổng luôn là Pro.
 * Chỉnh giá và hạn mức ở đây. Thu tiền thủ công: admin bấm "Nâng Pro" trong tab Recruiter.
 */
const { sb } = require('./db');
const { HttpError } = require('./util');

const LIMITS = { jobs: 3, candidates: 100, ai_month: 30 };
const PRICE = { month: 99000, month_list: 199000, year: 990000 }; // đ
const TRIAL_DAYS = 30;

const isPro = (rec) => !!rec && (rec.role === 'admin' || (!!rec.plan_until && new Date(rec.plan_until).getTime() > Date.now()));
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
    pro, role_admin: rec.role === 'admin', plan_until: rec.plan_until || null, limits: LIMITS, price: PRICE,
    payment_info: process.env.PAYMENT_INFO || '',
    usage: { jobs: await countOf('lh_jobs', rid, q => q.eq('status', 'open')), candidates: await countOf('lh_candidates', rid), ai: aiUsed(rec) },
  };
}

module.exports = { LIMITS, PRICE, TRIAL_DAYS, isPro, needPro, upgrade, checkOpenJob, candidateRoom, checkCandidates, useAi, summary, monthKey };
