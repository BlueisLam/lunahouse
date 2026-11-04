'use strict';
const { sb, must } = require('./_lib/db');
const { json, wrap, HttpError } = require('./_lib/util');
const T = require('./_lib/tenant');

// Chỉ trả các cột công khai. Không có id, không có nội dung nội bộ.
const COLS = 'slug,title,level,job_type,salary_text,location,summary,lang,responsibilities,requirements,benefits,must_have_tech,nice_to_have_tech,domains,min_years,created_at';

exports.handler = wrap(async (event) => {
  if (event.httpMethod !== 'GET') throw new HttpError(405, 'Method not allowed');
  const qs = event.queryStringParameters || {};
  const slug = qs.slug;
  const q = sb().from('lh_jobs').select(COLS + ',recruiter_id').eq('status', 'open');

  if (slug) {
    const job = must(await q.eq('slug', String(slug).slice(0, 80)).maybeSingle(), 'job');
    const rec = job && await T.byId(job.recruiter_id);
    if (!job || !rec || rec.status !== 'active') throw new HttpError(404, 'Vị trí này không còn nhận hồ sơ.');
    delete job.recruiter_id;
    return json(200, { job, profile: T.publicProfile(rec) }, { 'cache-control': 'public, max-age=60' });
  }
  // Trang của một recruiter: /api/jobs?handle=abc (không có handle = trang chủ của tài khoản chủ)
  const rec = await T.publicByHandle(qs.handle ? String(qs.handle).slice(0, 40) : '');
  if (!rec) throw new HttpError(404, 'Không tìm thấy trang này.');
  const jobs = must(await q.eq('recruiter_id', rec.id).order('created_at', { ascending: false }), 'jobs');
  return json(200, { jobs: (jobs || []).map(({ recruiter_id, ...j }) => j), profile: T.publicProfile(rec) }, { 'cache-control': 'public, max-age=60' });
});
