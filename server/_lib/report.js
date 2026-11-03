'use strict';
/**
 * Báo cáo tuyển dụng theo ngày / tháng / quý / năm (giờ Việt Nam, UTC+7).
 * Hàm thuần, không đụng DB: nhận danh sách application + hoạt động đổi trạng thái rồi gom theo kỳ.
 *  - received  = số hồ sơ nộp vào một job cụ thể trong kỳ
 *  - pool      = số người nộp vào Kho tài năng (không gắn job), tính riêng, KHÔNG nằm trong phễu
 *  - các mốc còn lại = số lần hồ sơ CHUYỂN VÀO trạng thái đó trong kỳ (lấy từ nhật ký hoạt động)
 */
const OFFSET_MS = 7 * 3600e3;
const GROUPS = ['day', 'month', 'quarter', 'year'];
const METRICS = ['received', 'pool', 'screening', 'submitted', 'interview', 'offer', 'hired', 'rejected', 'withdrawn'];
const STATUS_TO_METRIC = { screening: 'screening', submitted: 'submitted', interview1: 'interview', interview2: 'interview', offer: 'offer', hired: 'hired', rejected: 'rejected', withdrawn: 'withdrawn' };

const pad = n => String(n).padStart(2, '0');
const localDate = iso => new Date(new Date(iso).getTime() + OFFSET_MS); // đọc bằng getUTC*
const ymd = d => d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(Date.parse(s));

function keyOf(group, d) {
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
  if (group === 'year') return String(y);
  if (group === 'quarter') return y + '-Q' + (Math.floor((m - 1) / 3) + 1);
  if (group === 'month') return y + '-' + pad(m);
  return ymd(d);
}
function labelOf(group, key) {
  if (group === 'day') { const [y, m, d] = key.split('-'); return d + '/' + m + '/' + y; }
  if (group === 'month') { const [y, m] = key.split('-'); return 'Tháng ' + Number(m) + '/' + y; }
  if (group === 'quarter') { const [y, q] = key.split('-'); return 'Quý ' + q.slice(1) + '/' + y; }
  return 'Năm ' + key;
}
/** Danh sách kỳ liên tiếp từ from đến to (kể cả kỳ không có số liệu). */
function bucketKeys(group, from, to) {
  const keys = [], a = new Date(from + 'T00:00:00Z'), b = new Date(to + 'T00:00:00Z');
  let cur = new Date(a);
  for (let i = 0; i < 4000 && cur <= b; i++) {
    const k = keyOf(group, cur);
    if (keys[keys.length - 1] !== k) keys.push(k);
    if (group === 'day') cur = new Date(cur.getTime() + 86400e3);
    else if (group === 'month') cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
    else if (group === 'quarter') cur = new Date(Date.UTC(cur.getUTCFullYear(), (Math.floor(cur.getUTCMonth() / 3) + 1) * 3, 1));
    else cur = new Date(Date.UTC(cur.getUTCFullYear() + 1, 0, 1));
  }
  return keys;
}
/** Mốc UTC (ISO) của đầu ngày from và đầu ngày sau to, theo giờ VN. */
function bounds(from, to) {
  const start = new Date(new Date(from + 'T00:00:00Z').getTime() - OFFSET_MS);
  const end = new Date(new Date(to + 'T00:00:00Z').getTime() + 86400e3 - OFFSET_MS);
  return { startISO: start.toISOString(), endISO: end.toISOString() };
}
const zero = () => Object.fromEntries(METRICS.map(m => [m, 0]));
const inRange = (iso, b) => iso >= b.startISO && iso < b.endISO;

function buildReport({ apps, acts, jobs, from, to, group }) {
  if (!GROUPS.includes(group)) group = 'month';
  const b = bounds(from, to);
  const rows = Object.fromEntries(bucketKeys(group, from, to).map(k => [k, { key: k, label: labelOf(group, k), ...zero() }]));
  const totals = zero();
  const byJob = {};
  const appById = Object.fromEntries(apps.map(a => [a.id, a]));
  const jobRow = id => (byJob[id || ''] = byJob[id || ''] || { job_id: id || null, title: (jobs && jobs[id]) || '(job đã xoá)', ...zero() });
  const bump = (iso, metric, jobId) => {
    const k = keyOf(group, localDate(iso));
    if (rows[k]) rows[k][metric]++;
    totals[metric]++;
    if (jobId) jobRow(jobId)[metric]++;           // hồ sơ kho không vào bảng theo job
  };

  for (const a of apps) if (a.created_at && inRange(a.created_at, b)) bump(a.created_at, a.job_id ? 'received' : 'pool', a.job_id);
  let hireDays = 0, hireN = 0;
  for (const x of acts) {
    if (x.type !== 'status' || !x.meta || !x.created_at || !inRange(x.created_at, b)) continue;
    const metric = STATUS_TO_METRIC[x.meta.to];
    if (!metric || x.meta.from === x.meta.to) continue;
    const a = appById[x.application_id]; if (!a || !a.job_id) continue;   // hồ sơ kho không đi qua phễu
    bump(x.created_at, metric, a.job_id);
    if (metric === 'hired' && a.created_at) { hireDays += Math.max(0, (new Date(x.created_at) - new Date(a.created_at)) / 86400e3); hireN++; }
  }
  const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);
  return {
    group, from, to,
    rows: Object.values(rows),
    totals,
    rates: { interview: pct(totals.interview, totals.received), offer: pct(totals.offer, totals.interview), hired: pct(totals.hired, totals.received) },
    avg_days_to_hire: hireN ? Math.round((hireDays / hireN) * 10) / 10 : null,
    by_job: Object.values(byJob).sort((x, y) => y.received - x.received || y.hired - x.hired),
  };
}

module.exports = { buildReport, bounds, bucketKeys, keyOf, labelOf, isDay, ymd, GROUPS, METRICS };
