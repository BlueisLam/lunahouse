'use strict';
const { sb, must, BUCKET } = require('./_lib/db');
const U = require('./_lib/util');
const T = require('./_lib/tenant');
const PLAN = require('./_lib/plan');
const { STAGES, isStatus, TERMINAL } = require('./_lib/status');
const { stage1 } = require('./_lib/match');
const { parseCandidate } = require('./_lib/parse');
const AI = require('./_lib/ai');
const N = require('./_lib/notify');

const MAX_CV_BYTES = 4 * 1024 * 1024;
const LIST_COLS = 'id,full_name,address,phone_number,email,positions,total_years_experience,technologies,project_domains,headline,is_open_to_work,parse_status,dup_of,source,expected_salary,english_level,job_type_preference,cv_filename,cv_upload_date,created_at';
const JOB_STATUS = ['draft', 'open', 'paused', 'closed'];
const JOB_PRIORITY = ['normal', 'high', 'urgent'];
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

const LEVELS = ['Intern', 'Junior', 'Mid', 'Senior', 'Lead'];
/** Một job có thể nhiều cấp độ: lưu dạng "Junior, Mid" theo thứ tự chuẩn. */
function normLevels(v) {
  const arr = Array.isArray(v) ? v : String(v || '').split(/[,;/|]/);
  const set = new Set(arr.map(x => String(x).trim().toLowerCase()));
  return LEVELS.filter(l => set.has(l.toLowerCase())).join(', ');
}

function jobPatch(b) {
  const o = {};
  const S = (k, max) => { if (b[k] !== undefined) o[k] = U.clean(b[k], max); };
  S('title', 120);
  if (b.level !== undefined) o.level = normLevels(b.level); S('salary_text', 80); S('location', 120); S('summary', 600);
  if (b.lang !== undefined) o.lang = b.lang === 'en' ? 'en' : 'vi';
  if (b.job_type !== undefined) o.job_type = JOB_TYPES.includes(b.job_type) ? b.job_type : 'Full-time';
  ['responsibilities', 'requirements', 'benefits'].forEach(k => { if (b[k] !== undefined) o[k] = String(b[k]).replace(/\r/g, '').slice(0, 6000).trim(); });
  ['must_have_tech', 'nice_to_have_tech', 'domains'].forEach(k => { if (b[k] !== undefined) o[k] = U.toArr(b[k]); });
  if (b.min_years !== undefined) { const n = parseFloat(b.min_years); o.min_years = isNaN(n) ? 0 : Math.max(0, Math.min(40, n)); }
  if (b.status !== undefined) o.status = JOB_STATUS.includes(b.status) ? b.status : 'draft';
  if (b.priority !== undefined) o.priority = JOB_PRIORITY.includes(b.priority) ? b.priority : 'normal';
  return o;
}

/** Lấy đúng một dòng của recruiter này; của người khác thì coi như không tồn tại. */
async function own(table, id, rid, cols) {
  const r = id ? must(await sb().from(table).select(cols || '*').eq('id', id).eq('recruiter_id', rid).maybeSingle(), table) : null;
  if (!r) throw new U.HttpError(404, 'Không tìm thấy dữ liệu này.');
  return r;
}
const needAdmin = b => { if (b._rec.role !== 'admin') throw new U.HttpError(403, 'Chỉ quản trị viên mới dùng được chức năng này.'); };

async function allCandidates(cols, rid) {
  const db = sb(), out = [];
  for (let page = 0; page < 8; page++) {
    const rows = must(await db.from('lh_candidates').select(cols || LIST_COLS).eq('recruiter_id', rid).order('created_at', { ascending: false }).range(page * 1000, page * 1000 + 999), 'candidates');
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

async function logActivity(application_id, type, note, meta, rid) {
  must(await sb().from('lh_activities').insert({ application_id, type, note: note || '', meta: meta || {}, recruiter_id: rid }), 'activity');
}

async function createApp({ job_id, candidate_id, match_score, match_reason, rid }) {
  const db = sb();
  const dupQ = db.from('lh_applications').select('id').eq('candidate_id', candidate_id).eq('job_id', job_id);
  if (must(await dupQ.limit(1), 'dup')[0]) return null;
  let app = null;
  for (let i = 0; i < 6 && !app; i++) {
    const r = await db.from('lh_applications').insert({
      code: U.genCode(), job_id, candidate_id, status: 'new', recruiter_id: rid,
      match_score: match_score == null ? null : Math.round(match_score), match_reason: U.clean(match_reason, 400),
      next_action: 'Gọi điện xác nhận nhu cầu', next_action_date: U.dayVN(1),
    }).select().single();
    if (!r.error) app = r.data;
    else if (!(r.error.code === '23505' && /code/.test((r.error.message || '') + (r.error.details || '')))) must(r, 'insert app');
  }
  if (!app) throw new Error('Không tạo được mã hồ sơ.');
  await logActivity(app.id, 'status', 'Thêm vào pipeline từ matching', { from: '', to: 'new' }, rid);
  return app;
}

// ---------- actions ----------
const A = {};

A.bootstrap = async (b) => {
  const jobs = must(await sb().from('lh_jobs').select('*').eq('recruiter_id', b._rid).order('created_at', { ascending: false }), 'jobs');
  let unread = 0;
  try {
    const r = await sb().from('lh_threads').select('id', { count: 'exact', head: true }).eq('unread_admin', true).eq('recruiter_id', b._rid);
    unread = r.error ? 0 : (r.count || 0);
  } catch (e) { unread = 0; }
  const viewing = b._rid === b._rec.id ? null : await T.byId(b._rid);
  return {
    jobs, stages: STAGES, terminal: TERMINAL, unread_threads: unread, me: T.selfView(b._rec), plan: await PLAN.summary(b._rec, b._rec.id),
    viewing: viewing ? { id: viewing.id, display_name: viewing.display_name, email: viewing.email, handle: viewing.handle } : null,
  };
};

A['candidates.list'] = async (b) => ({ candidates: await allCandidates(null, b._rid) });

A['candidates.get'] = async (b) => {
  const db = sb();
  const cand = await own('lh_candidates', b.id, b._rid);
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
    await PLAN.checkCandidates(b._rec, b._rid);
    return { candidate: must(await sb().from('lh_candidates').insert({ ...patch, source: 'admin', recruiter_id: b._rid }).select().single(), 'insert') };
  }
  await own('lh_candidates', b.id, b._rid, 'id');
  return { candidate: must(await sb().from('lh_candidates').update(patch).eq('id', b.id).eq('recruiter_id', b._rid).select().single(), 'update') };
};

A['candidates.delete'] = async (b) => {
  const db = sb();
  const cand = must(await db.from('lh_candidates').select('id,cv_path').eq('id', b.id).eq('recruiter_id', b._rid).maybeSingle(), 'cand');
  if (!cand) return { ok: true };
  if (cand.cv_path) await db.storage.from(BUCKET).remove([cand.cv_path]);
  must(await db.from('lh_candidates').delete().eq('id', b.id), 'delete');
  return { ok: true };
};

A['candidates.upload'] = async (b) => {
  const buffer = b.file && b.file.buffer;
  if (!buffer || !buffer.length) throw new U.HttpError(400, 'File rỗng.');
  await PLAN.checkCandidates(b._rec, b._rid);
  if (buffer.length > MAX_CV_BYTES) throw new U.HttpError(413, 'File lớn hơn 4MB.');
  const kind = U.sniffFile(buffer);
  if (!kind) throw new U.HttpError(400, 'Chỉ nhận PDF, DOCX, JPG, PNG.');
  const name = U.clean(b.file.name, 120) || 'cv.' + kind;
  const db = sb();
  const cand = must(await db.from('lh_candidates').insert({ full_name: '(đang phân tích) ' + name, source: 'admin', parse_status: 'pending', recruiter_id: b._rid }).select().single(), 'stub');
  const path = `${cand.id}/${Date.now()}-${U.slugify(name.replace(/\.[^.]+$/, ''))}.${kind}`;
  const up = await db.storage.from(BUCKET).upload(path, buffer, { contentType: U.MIME[kind], upsert: false });
  if (up.error) { await db.from('lh_candidates').delete().eq('id', cand.id); throw new Error('upload: ' + up.error.message); }
  must(await db.from('lh_candidates').update({ cv_path: path, cv_filename: name }).eq('id', cand.id), 'path');
  return { id: cand.id };
};

A['candidates.reparse'] = async (b) => {
  const c = await own('lh_candidates', b.id, b._rid, 'id,cv_path');
  if (!c.cv_path) throw new U.HttpError(400, 'Hồ sơ này chưa có file CV để đọc.');
  must(await sb().from('lh_candidates').update({ parse_status: 'pending', parse_error: '' }).eq('id', b.id), 'pending');
  return { ok: true };
};

/** Đọc CV bằng AI cho một hồ sơ (admin gọi lần lượt từng hồ sơ đang chờ). */
A['candidates.parse'] = async (b) => {
  if (!b.id) throw new U.HttpError(400, 'Thiếu id.');
  await own('lh_candidates', b.id, b._rid, 'id');
  await PLAN.useAi(b._rec);
  return await parseCandidate(b.id, { text: U.clean(b.text, 40000), images: b.images });
};

A['candidates.merge'] = async (b) => {
  const db = sb();
  if (!b.from || !b.to || b.from === b.to) throw new U.HttpError(400, 'Cần chọn hai hồ sơ khác nhau.');
  const from = await own('lh_candidates', b.from, b._rid);
  const to = await own('lh_candidates', b.to, b._rid);

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

/** Slug duy nhất toàn site cho job mới. */
async function uniqueSlug(db, title) {
  let slug = U.slugify(title);
  for (let i = 0; i < 5; i++) {
    const hit = must(await db.from('lh_jobs').select('id').eq('slug', slug).limit(1), 'slug')[0];
    if (!hit) break;
    slug = U.slugify(title).slice(0, 52) + '-' + U.genCode().slice(3, 7).toLowerCase();
  }
  return slug;
}
const missingPriority = (r) => r && r.error && /priority/i.test(r.error.message || '');

A['jobs.save'] = async (b) => {
  const db = sb();
  const patch = jobPatch(b);
  if (!b.id) {
    if (!patch.title) throw new U.HttpError(400, 'Cần có tên vị trí.');
    if (patch.status === 'open') await PLAN.checkOpenJob(b._rec, b._rid);
    const slug = await uniqueSlug(db, patch.title);
    let r = await db.from('lh_jobs').insert({ ...patch, slug, recruiter_id: b._rid }).select().single();
    if (missingPriority(r)) { delete patch.priority; r = await db.from('lh_jobs').insert({ ...patch, slug, recruiter_id: b._rid }).select().single(); } // chưa chạy SQL ưu tiên
    return { job: must(r, 'insert job') };
  }
  const curJob = await own('lh_jobs', b.id, b._rid, 'id,status');
  if (patch.status === 'open' && curJob.status !== 'open') await PLAN.checkOpenJob(b._rec, b._rid);
  let r = await db.from('lh_jobs').update(patch).eq('id', b.id).eq('recruiter_id', b._rid).select().single();
  if (missingPriority(r)) { delete patch.priority; r = await db.from('lh_jobs').update(patch).eq('id', b.id).eq('recruiter_id', b._rid).select().single(); }
  return { job: must(r, 'update job') };
};

/** Nhân đôi một job thành bản nháp mới (cùng nội dung, slug mới). */
A['jobs.duplicate'] = async (b) => {
  const db = sb();
  const src = await own('lh_jobs', b.id, b._rid, '*');
  const title = (String(src.title).replace(/\s*\(bản sao\)$/i, '') + ' (bản sao)').slice(0, 120);
  const copy = { title, level: src.level, job_type: src.job_type, salary_text: src.salary_text, location: src.location, lang: src.lang, summary: src.summary,
    responsibilities: src.responsibilities, requirements: src.requirements, benefits: src.benefits, must_have_tech: src.must_have_tech, nice_to_have_tech: src.nice_to_have_tech,
    domains: src.domains, min_years: src.min_years, status: 'draft', priority: src.priority || 'normal' };
  const slug = await uniqueSlug(db, title);
  let r = await db.from('lh_jobs').insert({ ...copy, slug, recruiter_id: b._rid }).select().single();
  if (missingPriority(r)) { delete copy.priority; r = await db.from('lh_jobs').insert({ ...copy, slug, recruiter_id: b._rid }).select().single(); }
  return { job: must(r, 'duplicate job') };
};

/** Thao tác hàng loạt: đổi trạng thái, đổi mức ưu tiên hoặc xoá nhiều job một lúc. Job của người khác bị bỏ qua. */
A['jobs.bulk'] = async (b) => {
  const db = sb();
  const ids = [...new Set(Array.isArray(b.ids) ? b.ids.map(String) : [])].slice(0, 100);
  if (!ids.length) throw new U.HttpError(400, 'Chưa chọn job nào.');
  const wantStatus = b.status !== undefined, wantPrio = b.priority !== undefined, wantDel = b.delete === true;
  if (!wantStatus && !wantPrio && !wantDel) throw new U.HttpError(400, 'Chưa chọn thao tác.');
  if (wantStatus && !JOB_STATUS.includes(b.status)) throw new U.HttpError(400, 'Trạng thái không hợp lệ.');
  if (wantPrio && !JOB_PRIORITY.includes(b.priority)) throw new U.HttpError(400, 'Mức ưu tiên không hợp lệ.');
  const rows = must(await db.from('lh_jobs').select('id,status,title').in('id', ids).eq('recruiter_id', b._rid), 'jobs');
  const res = { updated: 0, skipped: [], deleted: 0 };
  if (wantDel) {
    for (const j of rows) {
      const n = await db.from('lh_applications').select('id', { count: 'exact', head: true }).eq('job_id', j.id);
      if ((n.count || 0) > 0) { res.skipped.push({ id: j.id, title: j.title, why: 'đã có hồ sơ' }); continue; }
      must(await db.from('lh_jobs').delete().eq('id', j.id).eq('recruiter_id', b._rid), 'delete job'); res.deleted++;
    }
    return res;
  }
  for (const j of rows) {
    const patch = {};
    if (wantStatus && j.status !== b.status) {
      if (b.status === 'open') { try { await PLAN.checkOpenJob(b._rec, b._rid); } catch (e) { res.skipped.push({ id: j.id, title: j.title, why: 'vượt giới hạn gói Free' }); continue; } }
      patch.status = b.status;
    }
    if (wantPrio) patch.priority = b.priority;
    if (!Object.keys(patch).length) continue;
    const r = await db.from('lh_jobs').update(patch).eq('id', j.id).eq('recruiter_id', b._rid);
    if (missingPriority(r)) throw new U.HttpError(500, 'Chưa có cột ưu tiên. Hãy chạy file SQL 2026-11-job-uu-tien.sql trong Supabase rồi thử lại.');
    must(r, 'bulk job'); res.updated++;
  }
  return res;
};

A['jobs.delete'] = async (b) => {
  const db = sb();
  await own('lh_jobs', b.id, b._rid, 'id');
  const n = await db.from('lh_applications').select('id', { count: 'exact', head: true }).eq('job_id', b.id);
  if ((n.count || 0) > 0) throw new U.HttpError(400, `Job này đã có ${n.count} application. Hãy chuyển sang "Đã đóng" thay vì xoá.`);
  must(await db.from('lh_jobs').delete().eq('id', b.id).eq('recruiter_id', b._rid), 'delete job');
  return { ok: true };
};

A['jobs.fromText'] = async (b) => {
  PLAN.needPro(b._rec, 'Viết JD bằng AI');
  const text = U.clean(b.text, 12000);
  if (text.length < 40) throw new U.HttpError(400, 'Dán nội dung JD dài hơn một chút nhé.');
  const lang = b.lang === 'en' ? 'en' : 'vi';
  const raw = await AI.jdFromText(text, lang);
  const p = jobPatch({ ...raw, lang, status: 'draft' });
  return { job: p };
};

A['apps.list'] = async (b) => {
  const db = sb();
  const apps = must(await db.from('lh_applications').select('id,code,job_id,candidate_id,status,match_score,next_action,next_action_date,updated_at,created_at').eq('recruiter_id', b._rid).order('updated_at', { ascending: false }).range(0, 999), 'apps');
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

A['report.get'] = async (b) => {
  const R = require('./_lib/report');
  const today = R.ymd(new Date(Date.now() + 7 * 3600e3));
  let from = R.isDay(b.from) ? b.from : today.slice(0, 4) + '-01-01', to = R.isDay(b.to) ? b.to : today;
  if (from > to) [from, to] = [to, from];
  if ((Date.parse(to) - Date.parse(from)) / 86400e3 > 366 * 5) throw new U.HttpError(400, 'Khoảng thời gian tối đa 5 năm.');
  const group = PLAN.isPro(b._rec) && R.GROUPS.includes(b.group) ? b.group : 'month'; // gói Free chỉ xem theo tháng
  if (group === 'day' && (Date.parse(to) - Date.parse(from)) / 86400e3 > 400) throw new U.HttpError(400, 'Xem theo ngày tối đa khoảng 13 tháng. Chọn xem theo tháng hoặc quý.');
  const db = sb();
  const all = async (mk) => { const out = []; for (let p = 0; p < 30; p++) { const r = must(await mk().range(p * 1000, p * 1000 + 999), 'report'); out.push(...r); if (r.length < 1000) break; } return out; };
  const { startISO, endISO } = R.bounds(from, to);
  // Hồ sơ tạo trong kỳ + hồ sơ có đổi trạng thái trong kỳ (có thể tạo từ trước kỳ).
  const acts = await all(() => db.from('lh_activities').select('application_id,type,meta,created_at').eq('type', 'status').eq('recruiter_id', b._rid).gte('created_at', startISO).lte('created_at', endISO).order('created_at', { ascending: true }));
  const created = await all(() => db.from('lh_applications').select('id,job_id,created_at,status').eq('recruiter_id', b._rid).gte('created_at', startISO).lte('created_at', endISO).order('created_at', { ascending: true }));
  const have = new Set(created.map(a => a.id));
  const need = [...new Set(acts.map(x => x.application_id))].filter(id => !have.has(id));
  const older = [];
  for (let i = 0; i < need.length; i += 150) older.push(...must(await db.from('lh_applications').select('id,job_id,created_at,status').eq('recruiter_id', b._rid).in('id', need.slice(i, i + 150)), 'report apps'));
  const jobs = Object.fromEntries(must(await db.from('lh_jobs').select('id,title').eq('recruiter_id', b._rid), 'jobs').map(j => [j.id, j.title]));
  return R.buildReport({ apps: created.concat(older), acts, jobs, from, to, group });
};

A['apps.get'] = async (b) => {
  const db = sb();
  const app = await own('lh_applications', b.id, b._rid);
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
  await own('lh_jobs', b.job_id, b._rid, 'id'); await own('lh_candidates', b.candidate_id, b._rid, 'id');
  const app = await createApp({ ...b, rid: b._rid });
  return { created: !!app, application: app };
};

A['apps.update'] = async (b) => {
  const db = sb();
  const cur = await own('lh_applications', b.id, b._rid);
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
  if (changed) await logActivity(cur.id, 'status', '', { from: cur.status, to: b.status }, b._rid);

  let emailed = false;
  if (b.notify && (changed || patch.public_note !== undefined)) {
    const cand = must(await db.from('lh_candidates').select('id,full_name,email').eq('id', cur.candidate_id).maybeSingle(), 'cand');
    const job = cur.job_id ? must(await db.from('lh_jobs').select('title').eq('id', cur.job_id).maybeSingle(), 'job') : null;
    if (cand && cand.email) {
      const r = await N.settle([N.emailStatus({ app, cand, job, rec: await T.byId(b._rid) })]);
      emailed = r[0].status === 'fulfilled' && !(r[0].value && r[0].value.skipped);
      if (emailed) await logActivity(cur.id, 'system', 'Đã gửi email cập nhật cho ứng viên', {}, b._rid);
    }
  }
  return { application: app, emailed };
};

A['activities.add'] = async (b) => {
  const note = U.clean(b.note, 1000);
  if (!note) throw new U.HttpError(400, 'Ghi chú đang trống.');
  await own('lh_applications', b.application_id, b._rid, 'id');
  await logActivity(b.application_id, 'note', note, {}, b._rid);
  return { ok: true };
};

A['match.stage1'] = async (b) => {
  const db = sb();
  const job = await own('lh_jobs', b.job_id, b._rid);
  const cands = await allCandidates(null, b._rid);
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
  PLAN.needPro(b._rec, 'Chấm điểm AI hàng loạt');
  const ids = (Array.isArray(b.ids) ? b.ids : []).slice(0, SCORE_BATCH_MAX);
  if (!ids.length) return { results: [] };
  const job = await own('lh_jobs', b.job_id, b._rid);
  const cands = must(await db.from('lh_candidates').select('*').eq('recruiter_id', b._rid).in('id', ids), 'cands');
  return { results: await AI.scoreBatch(job, cands) };
};


// ---------- hỏi đáp dưới job ----------
const THREAD_MSG_MAX = 1500;

A['threads.list'] = async (b) => {
  const db = sb();
  const threads = must(await db.from('lh_threads').select('id,job_id,author_name,author_email,is_public,unread_admin,last_from,created_at,updated_at').eq('recruiter_id', b._rid).order('updated_at', { ascending: false }).limit(150), 'threads');
  if (!threads.length) return { threads: [] };
  const jobs = must(await db.from('lh_jobs').select('id,title,slug').eq('recruiter_id', b._rid), 'jobs');
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
  const t = await own('lh_threads', b.id, b._rid);
  const job = must(await db.from('lh_jobs').select('id,title,slug').eq('id', t.job_id).maybeSingle(), 'job');
  const messages = must(await db.from('lh_messages').select('id,sender,body,created_at').eq('thread_id', t.id).order('created_at', { ascending: true }), 'messages');
  if (t.unread_admin) { must(await db.from('lh_threads').update({ unread_admin: false }).eq('id', t.id), 'read'); t.unread_admin = false; }
  const { token, ...safe } = t;
  return { thread: { ...safe, job_title: job ? job.title : '(job đã xoá)', job_slug: job ? job.slug : '' }, messages };
};

A['threads.reply'] = async (b) => {
  const db = sb();
  const t = await own('lh_threads', b.id, b._rid);
  const body = U.clean(b.body, THREAD_MSG_MAX).replace(/\r/g, '');
  if (body.length < 2) throw new U.HttpError(400, 'Bạn chưa nhập nội dung trả lời.');
  must(await db.from('lh_messages').insert({ thread_id: t.id, sender: 'recruiter', body }), 'reply');
  const patch = { unread_admin: false, last_from: 'recruiter' };
  if (b.publish === true) patch.is_public = true;
  must(await db.from('lh_threads').update(patch).eq('id', t.id), 'thread update');
  const job = must(await db.from('lh_jobs').select('title').eq('id', t.job_id).maybeSingle(), 'job');
  await N.settle([N.emailThreadReply({ thread: t, job, body, base: b._base, rec: await T.byId(b._rid) })]);
  return { ok: true, is_public: b.publish === true ? true : t.is_public };
};

A['threads.publish'] = async (b) => {
  const db = sb();
  must(await db.from('lh_threads').update({ is_public: !!b.is_public }).eq('id', b.id).eq('recruiter_id', b._rid), 'publish');
  return { ok: true, is_public: !!b.is_public };
};

A['threads.delete'] = async (b) => {
  must(await sb().from('lh_threads').delete().eq('id', b.id).eq('recruiter_id', b._rid), 'delete thread');
  return { ok: true };
};

// ---------- tài khoản & quản trị ----------
A['profile.save'] = async (b) => {
  const rec = b._rec; // chỉ sửa hồ sơ của chính mình
  const patch = T.profilePatch(b);
  if ((patch.logo_url || patch.cover_url) && !PLAN.isPro(rec)) throw PLAN.upgrade('Logo và ảnh bìa trang riêng chỉ có ở gói Pro.');
  const row = Object.keys(patch).length ? must(await sb().from('lh_recruiters').update(patch).eq('id', rec.id).select().single(), 'profile') : rec;
  return { me: T.selfView(row) };
};

const REPORT_KINDS = ['bug', 'idea', 'abuse', 'other'];
/** Recruiter gửi báo lỗi / góp ý cho admin. Lưu vào lh_reports (nếu chưa có bảng vẫn báo được qua email/Telegram). */
A['reports.send'] = async (b) => {
  const message = String(b.message || '').trim().slice(0, 2000);
  if (message.length < 5) throw new U.HttpError(400, 'Bạn mô tả thêm một chút nhé (ít nhất 5 ký tự).');
  const kind = REPORT_KINDS.includes(b.kind) ? b.kind : 'other';
  const page = String(b.page || '').slice(0, 60);
  const db = sb();
  const since = new Date(Date.now() - 3600e3).toISOString();
  const recent = await db.from('lh_reports').select('id', { count: 'exact', head: true }).eq('recruiter_id', b._rec.id).gte('created_at', since);
  if (!recent.error && (recent.count || 0) >= 5) throw new U.HttpError(429, 'Bạn gửi hơi nhiều trong một giờ, thử lại sau nhé.');
  const ins = await db.from('lh_reports').insert({ recruiter_id: b._rec.id, kind, message, page }).select().single();
  const rep = ins.error ? { kind, message, page } : ins.data;
  await N.notifyReport(b._rec, rep, b._base);
  return { ok: true };
};
A['reports.list'] = async (b) => {
  needAdmin(b);
  const db = sb();
  const r = await db.from('lh_reports').select('*').order('created_at', { ascending: false }).limit(200);
  if (r.error) return { reports: [], missing: true };
  const ids = [...new Set(r.data.map(x => x.recruiter_id))];
  const recs = ids.length ? must(await db.from('lh_recruiters').select('id,email,handle,display_name').in('id', ids), 'recruiters') : [];
  const by = Object.fromEntries(recs.map(x => [x.id, x]));
  return { reports: r.data.map(x => ({ ...x, who: by[x.recruiter_id] || null })) };
};
A['reports.update'] = async (b) => {
  needAdmin(b);
  if (b.delete) must(await sb().from('lh_reports').delete().eq('id', b.id), 'report');
  else must(await sb().from('lh_reports').update({ status: b.status === 'done' ? 'done' : 'new' }).eq('id', b.id), 'report');
  return { ok: true };
};

A['billing.set'] = async (b) => {
  needAdmin(b);
  return { billing: await PLAN.setBilling(b.on === true) };
};

A['recruiters.list'] = async (b) => {
  needAdmin(b);
  const db = sb();
  const rows = must(await db.from('lh_recruiters').select('id,email,handle,display_name,role,status,plan_until,created_at,last_login_at').order('created_at', { ascending: false }).limit(300), 'recruiters');
  const count = async (t, id) => (await db.from(t).select('id', { count: 'exact', head: true }).eq('recruiter_id', id)).count || 0;
  const out = await Promise.all(rows.map(async r => ({ ...r, jobs: await count('lh_jobs', r.id), candidates: await count('lh_candidates', r.id), apps: await count('lh_applications', r.id) })));
  return { recruiters: out, billing: await PLAN.load(true) };
};

A['recruiters.update'] = async (b) => {
  needAdmin(b);
  const t = await T.byId(b.id);
  if (!t) throw new U.HttpError(404, 'Không tìm thấy recruiter.');
  if (t.id === b._rec.id || t.email_norm === T.ownerEmail()) throw new U.HttpError(400, 'Không thể khoá hoặc đổi quyền tài khoản chủ.');
  const patch = {};
  if (b.status !== undefined) {
    if (!['pending', 'active', 'suspended'].includes(b.status)) throw new U.HttpError(400, 'Trạng thái không hợp lệ.');
    patch.status = b.status;
  }
  if (b.role !== undefined) {
    if (!['admin', 'recruiter'].includes(b.role)) throw new U.HttpError(400, 'Quyền không hợp lệ.');
    patch.role = b.role;
  }
  if (b.handle !== undefined) {
    const h = T.cleanHandle(b.handle); T.checkHandle(h);
    const hit = await T.byHandle(h);
    if (hit && hit.id !== t.id) throw new U.HttpError(409, 'Đường dẫn này đã có người dùng.');
    patch.handle = h;
  }
  // Gói: plan_months > 0 cộng thêm tháng vào hạn Pro (tính từ hạn hiện tại nếu còn); 0 = về Free ngay; plan_lifetime = Pro vĩnh viễn.
  if (b.plan_lifetime === true) patch.plan_until = PLAN.LIFETIME_UNTIL; // gói vĩnh viễn
  else if (b.plan_months !== undefined) {
    const m = Math.floor(Number(b.plan_months));
    if (!(m >= 0 && m <= 36)) throw new U.HttpError(400, 'Số tháng không hợp lệ.');
    if (m === 0) patch.plan_until = null;
    else {
      const base = Math.max(Date.now(), t.plan_until ? new Date(t.plan_until).getTime() : 0), d = new Date(base);
      d.setUTCMonth(d.getUTCMonth() + m);
      patch.plan_until = d.toISOString();
    }
  }
  // Duyệt lần đầu: tặng Pro dùng thử
  const firstApproval = patch.status === 'active' && t.status === 'pending' && !t.plan_until;
  if (firstApproval && patch.plan_until === undefined) patch.plan_until = new Date(Date.now() + PLAN.TRIAL_DAYS * 86400e3).toISOString();
  if (!Object.keys(patch).length) return { recruiter: t };
  const row = must(await sb().from('lh_recruiters').update(patch).eq('id', t.id).select().single(), 'update recruiter');
  if (patch.status === 'active' && t.status !== 'active') await N.settle([N.emailRecruiterApproved(row, b._base)]);
  return { recruiter: { id: row.id, status: row.status, role: row.role, handle: row.handle, plan_until: row.plan_until } };
};

// ---------- handler ----------
exports.handler = U.wrap(async (event) => {
  if (event.httpMethod !== 'POST') throw new U.HttpError(405, 'Method not allowed');
  const rec = await T.requireUser(event);
  const b = await U.readInput(event, { fileField: 'file', maxChars: 6_500_000 });
  b._base = N.baseUrl(event);
  b._rec = rec;
  b._rid = await T.dataOwner(rec, b.as);
  const fn = Object.prototype.hasOwnProperty.call(A, b.action) ? A[b.action] : null;
  if (!fn) throw new U.HttpError(400, 'Hành động không hợp lệ.');
  return U.json(200, await fn(b));
});
exports._actions = A; // cho test
