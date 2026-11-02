'use strict';
const { sb, must, BUCKET } = require('./_lib/db');
const U = require('./_lib/util');
const { requireAdmin } = require('./_lib/auth');
const { STAGES, isStatus, TERMINAL } = require('./_lib/status');
const { stage1 } = require('./_lib/match');
const { parseCandidate } = require('./_lib/parse');
const AI = require('./_lib/ai');
const N = require('./_lib/notify');

const MAX_CV_BYTES = 4 * 1024 * 1024;
const LIST_COLS = 'id,full_name,address,phone_number,email,positions,total_years_experience,technologies,project_domains,headline,is_open_to_work,parse_status,dup_of,source,expected_salary,english_level,job_type_preference,cv_filename,cv_upload_date,created_at';
const JOB_STATUS = ['draft', 'open', 'paused', 'closed'];
const JOB_TYPES = ['Full-time', 'Part-time', 'Freelance', 'Contract', 'Internship'];
const SCORE_BATCH_MAX = 6;

// ---------- helpers ----------
function cleanRoles(v) {
  const out = {};
  const put = (k, n) => { const x = parseFloat(n); if (k && !isNaN(x)) out[U.clean(k, 40).toLowerCase().replace(/\s+/g, '_')] = x; };
  if (v && typeof v === 'object' && !Array.isArray(v)) Object.entries(v).forEach(([k, n]) => put(k, n));
  else String(v || '').split(/[;,\n]/).forEach(p => { const [k, n] = p.split(':'); put((k || '').trim(), n); });
  return out;
}

function candPatch(b) {
  const o = {};
  const S = (k, max) => { if (b[k] !== undefined) o[k] = U.clean(b[k], max); };
  S('full_name', 120); S('date_of_birth', 12); S('address', 80); S('phone_number', 30); S('email', 120);
  S('english_level', 60); S('job_type_preference', 30); S('expected_salary', 80); S('notice_period', 80);
  S('headline', 200); S('links', 300);
  if (b.notes !== undefined) o.notes = U.clean(b.notes, 3000);
  if (b.gender !== undefined) o.gender = b.gender === 'Female' ? 'Female' : 'Male';
  ['positions', 'project_domains', 'technologies'].forEach(k => { if (b[k] !== undefined) o[k] = U.toArr(b[k]); });
  if (b.total_years_experience !== undefined) {
    const n = parseFloat(b.total_years_experience);
    o.total_years_experience = isNaN(n) ? 0 : Math.max(0, Math.min(60, n));
  }
  if (b.years_experience_by_role !== undefined) o.years_experience_by_role = cleanRoles(b.years_experience_by_role);
  if (b.is_open_to_work !== undefined) o.is_open_to_work = !!b.is_open_to_work;
  return o;
}

function jobPatch(b) {
  const o = {};
  const S = (k, max) => { if (b[k] !== undefined) o[k] = U.clean(b[k], max); };
  S('title', 120); S('level', 30); S('salary_text', 80); S('location', 120); S('summary', 600);
  if (b.lang !== undefined) o.lang = b.lang === 'en' ? 'en' : 'vi';
  if (b.job_type !== undefined) o.job_type = JOB_TYPES.includes(b.job_type) ? b.job_type : 'Full-time';
  ['responsibilities', 'requirements', 'benefits'].forEach(k => { if (b[k] !== undefined) o[k] = String(b[k]).replace(/\r/g, '').slice(0, 6000).trim(); });
  ['must_have_tech', 'nice_to_have_tech', 'domains'].forEach(k => { if (b[k] !== undefined) o[k] = U.toArr(b[k]); });
  if (b.min_years !== undefined) { const n = parseFloat(b.min_years); o.min_years = isNaN(n) ? 0 : Math.max(0, Math.min(40, n)); }
  if (b.status !== undefined) o.status = JOB_STATUS.includes(b.status) ? b.status : 'draft';
  return o;
}

async function allCandidates(cols) {
  const db = sb(), out = [];
  for (let page = 0; page < 8; page++) {
    const rows = must(await db.from('lh_candidates').select(cols || LIST_COLS).order('created_at', { ascending: false }).range(page * 1000, page * 1000 + 999), 'candidates');
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

async function logActivity(application_id, type, note, meta) {
  must(await sb().from('lh_activities').insert({ application_id, type, note: note || '', meta: meta || {} }), 'activity');
}

async function createApp({ job_id, candidate_id, match_score, match_reason }) {
  const db = sb();
  const dupQ = db.from('lh_applications').select('id').eq('candidate_id', candidate_id).eq('job_id', job_id);
  if (must(await dupQ.limit(1), 'dup')[0]) return null;
  let app = null;
  for (let i = 0; i < 6 && !app; i++) {
    const r = await db.from('lh_applications').insert({
      code: U.genCode(), job_id, candidate_id, status: 'new',
      match_score: match_score == null ? null : Math.round(match_score), match_reason: U.clean(match_reason, 400),
      next_action: 'Gọi điện xác nhận nhu cầu',
    }).select().single();
    if (!r.error) app = r.data;
    else if (!(r.error.code === '23505' && /code/.test((r.error.message || '') + (r.error.details || '')))) must(r, 'insert app');
  }
  if (!app) throw new Error('Không tạo được mã hồ sơ.');
  await logActivity(app.id, 'status', 'Thêm vào pipeline từ matching', { from: '', to: 'new' });
  return app;
}

// ---------- actions ----------
const A = {};

A.bootstrap = async () => {
  const jobs = must(await sb().from('lh_jobs').select('*').order('created_at', { ascending: false }), 'jobs');
  let unread = 0;
  try {
    const r = await sb().from('lh_threads').select('id', { count: 'exact', head: true }).eq('unread_admin', true);
    unread = r.error ? 0 : (r.count || 0);
  } catch (e) { unread = 0; }
  return { jobs, stages: STAGES, terminal: TERMINAL, unread_threads: unread };
};

A['candidates.list'] = async () => ({ candidates: await allCandidates() });

A['candidates.get'] = async (b) => {
  const db = sb();
  const cand = must(await db.from('lh_candidates').select('*').eq('id', b.id).maybeSingle(), 'cand');
  if (!cand) throw new U.HttpError(404, 'Không tìm thấy hồ sơ.');
  const apps = must(await db.from('lh_applications').select('*').eq('candidate_id', cand.id).order('created_at', { ascending: false }), 'apps');
  const jobIds = [...new Set(apps.map(a => a.job_id).filter(Boolean))];
  const jobs = jobIds.length ? must(await db.from('lh_jobs').select('id,title').in('id', jobIds), 'jobs') : [];
  const title = Object.fromEntries(jobs.map(j => [j.id, j.title]));
  let cv_url = '';
  if (cand.cv_path) {
    const s = await db.storage.from(BUCKET).createSignedUrl(cand.cv_path, 3600);
    cv_url = (s.data && s.data.signedUrl) || '';
  }
  return { candidate: cand, cv_url, applications: apps.map(a => ({ ...a, job_title: a.job_id ? (title[a.job_id] || '') : 'Kho tài năng' })) };
};

A['candidates.save'] = async (b) => {
  const patch = candPatch(b);
  if (!b.id) {
    if (!patch.full_name) throw new U.HttpError(400, 'Cần có họ tên.');
    return { candidate: must(await sb().from('lh_candidates').insert({ ...patch, source: 'admin' }).select().single(), 'insert') };
  }
  return { candidate: must(await sb().from('lh_candidates').update(patch).eq('id', b.id).select().single(), 'update') };
};

A['candidates.delete'] = async (b) => {
  const db = sb();
  const cand = must(await db.from('lh_candidates').select('id,cv_path').eq('id', b.id).maybeSingle(), 'cand');
  if (!cand) return { ok: true };
  if (cand.cv_path) await db.storage.from(BUCKET).remove([cand.cv_path]);
  must(await db.from('lh_candidates').delete().eq('id', b.id), 'delete');
  return { ok: true };
};

A['candidates.upload'] = async (b) => {
  const buffer = b.file && b.file.buffer;
  if (!buffer || !buffer.length) throw new U.HttpError(400, 'File rỗng.');
  if (buffer.length > MAX_CV_BYTES) throw new U.HttpError(413, 'File lớn hơn 4MB.');
  const kind = U.sniffFile(buffer);
  if (!kind) throw new U.HttpError(400, 'Chỉ nhận PDF, DOCX, JPG, PNG.');
  const name = U.clean(b.file.name, 120) || 'cv.' + kind;
  const db = sb();
  const cand = must(await db.from('lh_candidates').insert({ full_name: '(đang phân tích) ' + name, source: 'admin', parse_status: 'pending' }).select().single(), 'stub');
  const path = `${cand.id}/${Date.now()}-${U.slugify(name.replace(/\.[^.]+$/, ''))}.${kind}`;
  const up = await db.storage.from(BUCKET).upload(path, buffer, { contentType: U.MIME[kind], upsert: false });
  if (up.error) { await db.from('lh_candidates').delete().eq('id', cand.id); throw new Error('upload: ' + up.error.message); }
  must(await db.from('lh_candidates').update({ cv_path: path, cv_filename: name }).eq('id', cand.id), 'path');
  return { id: cand.id };
};

A['candidates.reparse'] = async (b) => {
  const c = must(await sb().from('lh_candidates').select('id,cv_path').eq('id', b.id).maybeSingle(), 'cand');
  if (!c || !c.cv_path) throw new U.HttpError(400, 'Hồ sơ này chưa có file CV để đọc.');
  must(await sb().from('lh_candidates').update({ parse_status: 'pending', parse_error: '' }).eq('id', b.id), 'pending');
  return { ok: true };
};

/** Đọc CV bằng AI cho một hồ sơ (admin gọi lần lượt từng hồ sơ đang chờ). */
A['candidates.parse'] = async (b) => {
  if (!b.id) throw new U.HttpError(400, 'Thiếu id.');
  return await parseCandidate(b.id, { text: U.clean(b.text, 40000), images: b.images });
};

A['candidates.merge'] = async (b) => {
  const db = sb();
  if (!b.from || !b.to || b.from === b.to) throw new U.HttpError(400, 'Cần chọn hai hồ sơ khác nhau.');
  const from = must(await db.from('lh_candidates').select('*').eq('id', b.from).maybeSingle(), 'from');
  const to = must(await db.from('lh_candidates').select('*').eq('id', b.to).maybeSingle(), 'to');
  if (!from || !to) throw new U.HttpError(404, 'Không tìm thấy hồ sơ.');

  const union = (x, y) => U.toArr([...(x || []), ...(y || [])]);
  const fill = k => (to[k] ? to[k] : from[k] || '');
  const patch = {
    positions: union(to.positions, from.positions), technologies: union(to.technologies, from.technologies),
    project_domains: union(to.project_domains, from.project_domains),
    years_experience_by_role: { ...(from.years_experience_by_role || {}), ...(to.years_experience_by_role || {}) },
    total_years_experience: Math.max(Number(to.total_years_experience) || 0, Number(from.total_years_experience) || 0),
    notes: [to.notes, from.notes].filter(Boolean).join('\n---\n').slice(0, 3000),
    dup_of: null,
  };
  ['date_of_birth', 'address', 'phone_number', 'email', 'english_level', 'job_type_preference', 'expected_salary', 'notice_period', 'headline', 'links', 'cv_text'].forEach(k => { patch[k] = fill(k); });
  if (!to.cv_path && from.cv_path) { patch.cv_path = from.cv_path; patch.cv_filename = from.cv_filename; }

  const toApps = must(await db.from('lh_applications').select('id,job_id').eq('candidate_id', to.id), 'to apps');
  const have = new Set(toApps.map(a => a.job_id).filter(Boolean));
  const fromApps = must(await db.from('lh_applications').select('id,job_id').eq('candidate_id', from.id), 'from apps');
  for (const a of fromApps) {
    if (a.job_id && have.has(a.job_id)) must(await db.from('lh_applications').delete().eq('id', a.id), 'drop dup app');
    else must(await db.from('lh_applications').update({ candidate_id: to.id }).eq('id', a.id), 'move app');
  }
  must(await db.from('lh_candidates').update(patch).eq('id', to.id), 'merge');
  if (from.cv_path && from.cv_path !== (patch.cv_path || to.cv_path)) await db.storage.from(BUCKET).remove([from.cv_path]);
  must(await db.from('lh_candidates').delete().eq('id', from.id), 'delete from');
  return { ok: true, id: to.id };
};

A['jobs.save'] = async (b) => {
  const db = sb();
  const patch = jobPatch(b);
  if (!b.id) {
    if (!patch.title) throw new U.HttpError(400, 'Cần có tên vị trí.');
    let slug = U.slugify(patch.title);
    for (let i = 0; i < 5; i++) {
      const hit = must(await db.from('lh_jobs').select('id').eq('slug', slug).limit(1), 'slug')[0];
      if (!hit) break;
      slug = U.slugify(patch.title).slice(0, 52) + '-' + U.genCode().slice(3, 7).toLowerCase();
    }
    return { job: must(await db.from('lh_jobs').insert({ ...patch, slug }).select().single(), 'insert job') };
  }
  return { job: must(await db.from('lh_jobs').update(patch).eq('id', b.id).select().single(), 'update job') };
};

A['jobs.delete'] = async (b) => {
  const db = sb();
  const n = await db.from('lh_applications').select('id', { count: 'exact', head: true }).eq('job_id', b.id);
  if ((n.count || 0) > 0) throw new U.HttpError(400, `Job này đã có ${n.count} application. Hãy chuyển sang "Đã đóng" thay vì xoá.`);
  must(await db.from('lh_jobs').delete().eq('id', b.id), 'delete job');
  return { ok: true };
};

A['jobs.fromText'] = async (b) => {
  const text = U.clean(b.text, 12000);
  if (text.length < 40) throw new U.HttpError(400, 'Dán nội dung JD dài hơn một chút nhé.');
  const lang = b.lang === 'en' ? 'en' : 'vi';
  const raw = await AI.jdFromText(text, lang);
  const p = jobPatch({ ...raw, lang, status: 'draft' });
  return { job: p };
};

A['apps.list'] = async () => {
  const db = sb();
  const apps = must(await db.from('lh_applications').select('id,code,job_id,candidate_id,status,match_score,next_action,next_action_date,updated_at,created_at').order('updated_at', { ascending: false }).range(0, 999), 'apps');
  const cands = {}, titles = {};
  const cids = [...new Set(apps.map(a => a.candidate_id))];
  for (let i = 0; i < cids.length; i += 200) {
    must(await db.from('lh_candidates').select('id,full_name,phone_number,email').in('id', cids.slice(i, i + 200)), 'cands').forEach(c => { cands[c.id] = c; });
  }
  const jids = [...new Set(apps.map(a => a.job_id).filter(Boolean))];
  if (jids.length) must(await db.from('lh_jobs').select('id,title').in('id', jids), 'jobs').forEach(j => { titles[j.id] = j.title; });
  return {
    applications: apps.map(a => ({
      ...a, job_title: a.job_id ? (titles[a.job_id] || '') : 'Kho tài năng',
      candidate_name: (cands[a.candidate_id] || {}).full_name || '', phone: (cands[a.candidate_id] || {}).phone_number || '',
      email: (cands[a.candidate_id] || {}).email || '',
    })),
  };
};

A['apps.get'] = async (b) => {
  const db = sb();
  const app = must(await db.from('lh_applications').select('*').eq('id', b.id).maybeSingle(), 'app');
  if (!app) throw new U.HttpError(404, 'Không tìm thấy application.');
  const acts = must(await db.from('lh_activities').select('*').eq('application_id', app.id).order('created_at', { ascending: false }), 'acts');
  const cand = must(await db.from('lh_candidates').select('id,full_name,phone_number,email,technologies,total_years_experience,headline,cv_path,cv_filename').eq('id', app.candidate_id).maybeSingle(), 'cand');
  const job = app.job_id ? must(await db.from('lh_jobs').select('id,title,slug').eq('id', app.job_id).maybeSingle(), 'job') : null;
  let cv_url = '';
  if (cand && cand.cv_path) { const s = await db.storage.from(BUCKET).createSignedUrl(cand.cv_path, 3600); cv_url = (s.data && s.data.signedUrl) || ''; }
  if (cand) { delete cand.cv_path; }
  return { application: app, activities: acts, candidate: cand, job, cv_url };
};

A['apps.create'] = async (b) => {
  if (!b.job_id || !b.candidate_id) throw new U.HttpError(400, 'Thiếu job hoặc ứng viên.');
  const app = await createApp(b);
  return { created: !!app, application: app };
};

A['apps.update'] = async (b) => {
  const db = sb();
  const cur = must(await db.from('lh_applications').select('*').eq('id', b.id).maybeSingle(), 'app');
  if (!cur) throw new U.HttpError(404, 'Không tìm thấy application.');
  const patch = {};
  if (b.public_note !== undefined) patch.public_note = U.clean(b.public_note, 1000);
  if (b.internal_note !== undefined) patch.internal_note = U.clean(b.internal_note, 3000);
  if (b.next_action !== undefined) patch.next_action = U.clean(b.next_action, 120);
  if (b.next_action_date !== undefined) patch.next_action_date = /^\d{4}-\d{2}-\d{2}$/.test(b.next_action_date) ? b.next_action_date : null;
  let changed = false;
  if (b.status !== undefined && b.status !== cur.status) {
    if (!isStatus(b.status)) throw new U.HttpError(400, 'Trạng thái không hợp lệ.');
    patch.status = b.status; changed = true;
  }
  const app = Object.keys(patch).length ? must(await db.from('lh_applications').update(patch).eq('id', cur.id).select().single(), 'update') : cur;
  if (changed) await logActivity(cur.id, 'status', '', { from: cur.status, to: b.status });

  let emailed = false;
  if (b.notify && (changed || patch.public_note !== undefined)) {
    const cand = must(await db.from('lh_candidates').select('id,full_name,email').eq('id', cur.candidate_id).maybeSingle(), 'cand');
    const job = cur.job_id ? must(await db.from('lh_jobs').select('title').eq('id', cur.job_id).maybeSingle(), 'job') : null;
    if (cand && cand.email) {
      const r = await N.settle([N.emailStatus({ app, cand, job })]);
      emailed = r[0].status === 'fulfilled' && !(r[0].value && r[0].value.skipped);
      if (emailed) await logActivity(cur.id, 'system', 'Đã gửi email cập nhật cho ứng viên', {});
    }
  }
  return { application: app, emailed };
};

A['activities.add'] = async (b) => {
  const note = U.clean(b.note, 1000);
  if (!note) throw new U.HttpError(400, 'Ghi chú đang trống.');
  await logActivity(b.application_id, 'note', note, {});
  return { ok: true };
};

A['match.stage1'] = async (b) => {
  const db = sb();
  const job = must(await db.from('lh_jobs').select('*').eq('id', b.job_id).maybeSingle(), 'job');
  if (!job) throw new U.HttpError(404, 'Không tìm thấy job.');
  const cands = await allCandidates();
  const pool = stage1(job, cands);
  const existing = must(await db.from('lh_applications').select('candidate_id').eq('job_id', job.id), 'existing');
  const has = new Set(existing.map(a => a.candidate_id));
  return {
    total: cands.length, passed: pool.length,
    pool: pool.slice(0, 30).map(p => ({
      id: p.c.id, name: p.c.full_name, years: p.c.total_years_experience, positions: p.c.positions, headline: p.c.headline,
      pre: p.pre, overlap: p.overlap, niceHit: p.niceHit, domainHit: p.domainHit, has_app: has.has(p.c.id),
    })),
  };
};

A['match.score'] = async (b) => {
  const db = sb();
  const ids = (Array.isArray(b.ids) ? b.ids : []).slice(0, SCORE_BATCH_MAX);
  if (!ids.length) return { results: [] };
  const job = must(await db.from('lh_jobs').select('*').eq('id', b.job_id).maybeSingle(), 'job');
  if (!job) throw new U.HttpError(404, 'Không tìm thấy job.');
  const cands = must(await db.from('lh_candidates').select('*').in('id', ids), 'cands');
  return { results: await AI.scoreBatch(job, cands) };
};


// ---------- hỏi đáp dưới job ----------
const THREAD_MSG_MAX = 1500;

A['threads.list'] = async () => {
  const db = sb();
  const threads = must(await db.from('lh_threads').select('id,job_id,author_name,author_email,is_public,unread_admin,last_from,created_at,updated_at').order('updated_at', { ascending: false }).limit(150), 'threads');
  if (!threads.length) return { threads: [] };
  const jobs = must(await db.from('lh_jobs').select('id,title,slug'), 'jobs');
  const jmap = {}; jobs.forEach(j => { jmap[j.id] = j; });
  const msgs = must(await db.from('lh_messages').select('thread_id,sender,body,created_at').in('thread_id', threads.map(t => t.id)).order('created_at', { ascending: false }).limit(1000), 'messages');
  const last = {}, cnt = {};
  msgs.forEach(m => { cnt[m.thread_id] = (cnt[m.thread_id] || 0) + 1; if (!last[m.thread_id]) last[m.thread_id] = m; });
  return {
    threads: threads.map(t => ({ ...t, job_title: (jmap[t.job_id] || {}).title || '(job đã xoá)', last_body: last[t.id] ? last[t.id].body.slice(0, 160) : '', count: cnt[t.id] || 0 })),
  };
};

A['threads.get'] = async (b) => {
  const db = sb();
  const t = must(await db.from('lh_threads').select('*').eq('id', b.id).maybeSingle(), 'thread');
  if (!t) throw new U.HttpError(404, 'Không tìm thấy hội thoại.');
  const job = must(await db.from('lh_jobs').select('id,title,slug').eq('id', t.job_id).maybeSingle(), 'job');
  const messages = must(await db.from('lh_messages').select('id,sender,body,created_at').eq('thread_id', t.id).order('created_at', { ascending: true }), 'messages');
  if (t.unread_admin) { must(await db.from('lh_threads').update({ unread_admin: false }).eq('id', t.id), 'read'); t.unread_admin = false; }
  const { token, ...safe } = t;
  return { thread: { ...safe, job_title: job ? job.title : '(job đã xoá)', job_slug: job ? job.slug : '' }, messages };
};

A['threads.reply'] = async (b) => {
  const db = sb();
  const t = must(await db.from('lh_threads').select('*').eq('id', b.id).maybeSingle(), 'thread');
  if (!t) throw new U.HttpError(404, 'Không tìm thấy hội thoại.');
  const body = U.clean(b.body, THREAD_MSG_MAX).replace(/\r/g, '');
  if (body.length < 2) throw new U.HttpError(400, 'Bạn chưa nhập nội dung trả lời.');
  must(await db.from('lh_messages').insert({ thread_id: t.id, sender: 'recruiter', body }), 'reply');
  const patch = { unread_admin: false, last_from: 'recruiter' };
  if (b.publish === true) patch.is_public = true;
  must(await db.from('lh_threads').update(patch).eq('id', t.id), 'thread update');
  const job = must(await db.from('lh_jobs').select('title').eq('id', t.job_id).maybeSingle(), 'job');
  await N.settle([N.emailThreadReply({ thread: t, job, body, base: b._base })]);
  return { ok: true, is_public: b.publish === true ? true : t.is_public };
};

A['threads.publish'] = async (b) => {
  const db = sb();
  must(await db.from('lh_threads').update({ is_public: !!b.is_public }).eq('id', b.id), 'publish');
  return { ok: true, is_public: !!b.is_public };
};

A['threads.delete'] = async (b) => {
  must(await sb().from('lh_threads').delete().eq('id', b.id), 'delete thread');
  return { ok: true };
};

// ---------- handler ----------
exports.handler = U.wrap(async (event) => {
  if (event.httpMethod !== 'POST') throw new U.HttpError(405, 'Method not allowed');
  requireAdmin(event);
  const b = await U.readInput(event, { fileField: 'file', maxChars: 6_500_000 });
  b._base = N.baseUrl(event);
  const fn = Object.prototype.hasOwnProperty.call(A, b.action) ? A[b.action] : null;
  if (!fn) throw new U.HttpError(400, 'Hành động không hợp lệ.');
  return U.json(200, await fn(b));
});
exports._actions = A; // cho test
