'use strict';
/** GET /api/cv?id=<candidate_id>: admin tải file CV (trình duyệt cần để bóc chữ từ PDF). Chuyển tiếp luồng từ Supabase, không đọc vào bộ nhớ. */
const { sb, must, BUCKET } = require('./_lib/db');
const T = require('./_lib/tenant');
const SEC = { 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' };
const err = (status, msg) => new Response(JSON.stringify({ error: msg }), { status, headers: { 'content-type': 'application/json', ...SEC } });

async function defaultFetch(db, path) {
  const s = await db.storage.from(BUCKET).createSignedUrl(path, 120);
  const url = s && s.data && (s.data.signedUrl || s.data.signedURL);
  if (!url) throw new Error('Không tạo được link CV.');
  return fetch(url);
}

async function stream(request, fetchFile = defaultFetch) {
  const headers = {};
  request.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  let rec;
  try { rec = await T.requireUser({ headers }); } catch (e) { return err(e.status || 401, e.message); }
  const id = new URL(request.url).searchParams.get('id') || '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return err(400, 'Thiếu id.');
  try {
    const db = sb();
    const c = must(await db.from('lh_candidates').select('id,cv_path,recruiter_id').eq('id', id).maybeSingle(), 'cand');
    if (c && c.recruiter_id !== rec.id && rec.role !== 'admin') return err(404, 'Hồ sơ chưa có file CV.');
    if (!c || !c.cv_path) return err(404, 'Hồ sơ chưa có file CV.');
    const r = await fetchFile(db, c.cv_path);
    if (!r.ok) return err(502, 'Không tải được file CV.');
    return new Response(r.body, { status: 200, headers: { 'content-type': 'application/octet-stream', ...SEC } });
  } catch (e) { console.error('[cv]', e.message); return err(500, 'Có lỗi hệ thống.'); }
}

module.exports = { stream };
