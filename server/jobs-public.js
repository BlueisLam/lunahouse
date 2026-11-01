'use strict';
const { sb, must } = require('./_lib/db');
const { json, wrap, HttpError } = require('./_lib/util');

// Chỉ trả các cột công khai. Không có id, không có nội dung nội bộ.
const COLS = 'slug,title,level,job_type,salary_text,location,summary,responsibilities,requirements,benefits,must_have_tech,nice_to_have_tech,domains,min_years,created_at';

exports.handler = wrap(async (event) => {
  if (event.httpMethod !== 'GET') throw new HttpError(405, 'Method not allowed');
  const slug = event.queryStringParameters && event.queryStringParameters.slug;
  const q = sb().from('lh_jobs').select(COLS).eq('status', 'open');

  if (slug) {
    const job = must(await q.eq('slug', String(slug).slice(0, 80)).maybeSingle(), 'job');
    if (!job) throw new HttpError(404, 'Vị trí này không còn nhận hồ sơ.');
    return json(200, { job }, { 'cache-control': 'public, max-age=60' });
  }
  const jobs = must(await q.order('created_at', { ascending: false }), 'jobs');
  return json(200, { jobs: jobs || [] }, { 'cache-control': 'public, max-age=60' });
});
