'use strict';
const { sb, must } = require('./_lib/db');
const U = require('./_lib/util');
const { BY_KEY, FLOW, TERMINAL } = require('./_lib/status');
const N = require('./_lib/notify');
const T = require('./_lib/tenant');

const NOT_FOUND = 'Không tìm thấy hồ sơ khớp với mã và thông tin liên hệ này. Bạn kiểm tra lại mã trong email xác nhận nhé.';

/** Ứng viên chứng minh là chủ hồ sơ bằng email hoặc số điện thoại đã nộp. */
function contactMatches(cand, contact) {
  const c = U.clean(contact, 120).toLowerCase();
  if (!c) return false;
  if (c.includes('@')) return !!cand.email_norm && cand.email_norm === c;
  const p = U.phoneNorm(c);
  return p.length === 9 && cand.phone_norm === p;
}

exports.handler = U.wrap(async (event) => {
  if (event.httpMethod !== 'POST') throw new U.HttpError(405, 'Method not allowed');
  const b = U.parseBody(event, 10_000);
  const code = U.normCode(b.code);
  const db = sb();

  const app = code ? must(await db.from('lh_applications').select('*').eq('code', code).maybeSingle(), 'app') : null;
  const cand = app ? must(await db.from('lh_candidates').select('id,full_name,email,email_norm,phone_number,phone_norm').eq('id', app.candidate_id).maybeSingle(), 'cand') : null;

  if (!app || !cand || !contactMatches(cand, b.contact)) {
    await U.sleep(600); // làm chậm dò mã
    throw new U.HttpError(404, NOT_FOUND);
  }

  const rec = await T.byId(app.recruiter_id);
  const job = app.job_id ? must(await db.from('lh_jobs').select('title,slug').eq('id', app.job_id).maybeSingle(), 'job') : null;

  // Ứng viên chủ động rút hồ sơ
  if (b.action === 'withdraw') {
    if (TERMINAL.includes(app.status)) throw new U.HttpError(400, 'Hồ sơ này đã kết thúc, không thể rút thêm.');
    const prev = app.status;
    must(await db.from('lh_applications').update({ status: 'withdrawn' }).eq('id', app.id), 'withdraw');
    must(await db.from('lh_activities').insert({ application_id: app.id, type: 'status', note: 'Ứng viên rút hồ sơ', meta: { from: prev, to: 'withdrawn' }, recruiter_id: app.recruiter_id }), 'act');
    await N.settle([N.telegram(`↩️ <b>${U.esc(cand.full_name)}</b> vừa rút hồ sơ <b>${U.esc(job ? job.title : 'Kho tài năng')}</b> (${U.esc(app.code)})`, T.notifyTarget(rec).chat)]);
    app.status = 'withdrawn';
  }

  const acts = must(await db.from('lh_activities').select('type,meta,created_at').eq('application_id', app.id).eq('type', 'status').order('created_at', { ascending: true }), 'acts');
  const timeline = (acts || []).map(a => ({ status: a.meta && a.meta.to, label: (BY_KEY[a.meta && a.meta.to] || {}).pub || '', at: a.created_at })).filter(t => t.status);

  // Hồ sơ dừng ở đâu: bước gần nhất trong quy trình trước khi bị từ chối
  let failed_after = '';
  if (app.status === 'rejected') {
    const seen = timeline.filter(t => FLOW.includes(t.status));
    failed_after = seen.length ? seen[seen.length - 1].label : '';
  }

  const st = BY_KEY[app.status] || BY_KEY.new;
  // Hồ sơ trong Kho tài năng (không gắn job) không đi qua các bước tuyển dụng.
  const pool = !app.job_id && app.status === 'new';
  return U.json(200, {
    code: app.code,
    profile: rec ? T.publicProfile(rec) : null,
    candidate_name: cand.full_name,
    job_title: job ? job.title : null,
    applied_at: app.created_at,
    updated_at: app.updated_at,
    status: app.status,
    status_label: pool ? 'Đã lưu vào kho tài năng' : st.pub,
    hint: pool ? 'Mình đã lưu hồ sơ của bạn. Khi có vị trí phù hợp, mình sẽ liên hệ trực tiếp. Bạn không cần chờ phản hồi cho một vị trí cụ thể.' : st.hint,
    pool,
    public_note: app.public_note || '',
    failed_after,
    terminal: TERMINAL.includes(app.status),
    flow: FLOW.map(k => ({ key: k, label: BY_KEY[k].pub })),
    timeline: pool ? [] : timeline,
  });
});
