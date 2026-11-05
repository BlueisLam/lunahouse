'use strict';
/** DB giả trong bộ nhớ, mô phỏng đúng phần API supabase-js mà backend dùng (để test không cần mạng). */
const crypto = require('crypto');

const DEFAULTS = {
  lh_jobs: () => ({ level: '', job_type: 'Full-time', salary_text: '', location: '', summary: '', lang: 'vi', responsibilities: '', requirements: '', benefits: '', must_have_tech: [], nice_to_have_tech: [], domains: [], min_years: 0, status: 'draft' }),
  lh_candidates: () => ({ full_name: '', date_of_birth: '', address: '', phone_number: '', email: '', gender: 'Male', positions: [], english_level: '', total_years_experience: 0, years_experience_by_role: {}, project_domains: [], technologies: [], cv_upload_date: new Date().toISOString(), is_open_to_work: true, job_type_preference: '', expected_salary: '', notice_period: '', headline: '', notes: '', links: '', cv_path: '', cv_filename: '', cv_text: '', source: 'apply', parse_status: 'none', parse_error: '', dup_of: null }),
  lh_applications: () => ({ job_id: null, status: 'new', public_note: '', internal_note: '', cover_note: '', match_score: null, match_reason: '', next_action: '', next_action_date: null, ip_hash: '' }),
  lh_activities: () => ({ type: 'note', note: '', meta: {} }),
  lh_threads: () => ({ is_public: false, unread_admin: true, last_from: 'candidate' }),
  lh_messages: () => ({ ip_hash: '' }),
  lh_settings: () => ({}),
  lh_reports: () => ({ kind: 'bug', page: '', status: 'new' }),
  lh_recruiters: () => ({ auth_id: null, display_name: '', title: '', bio: '', contact_email: '', zalo: '', facebook: '', linkedin: '', telegram: '', communities: [], role: 'recruiter', status: 'pending', telegram_chat_id: '', notify_email: '', ip_hash: '', last_login_at: null, plan_until: null, ai_month: '', ai_count: 0, logo_url: '', cover_url: '' }),
};

function derive(table, row) {
  if (table === 'lh_recruiters') row.email_norm = String(row.email || '').trim().toLowerCase();
  if (table === 'lh_candidates') {
    row.email_norm = String(row.email || '').trim().toLowerCase();
    row.phone_norm = String(row.phone_number || '').replace(/\D/g, '').slice(-9);
  }
  return row;
}

function uniqueCheck(db, table, row, selfId) {
  const rows = db.t[table].filter(r => r.id !== selfId);
  const dupe = (msg) => ({ code: '23505', message: `duplicate key value violates unique constraint "${msg}"`, details: `Key (${msg})` });
  if (table === 'lh_applications') {
    if (rows.some(r => r.code === row.code)) return dupe('lh_applications_code_key code');
    if (row.job_id && rows.some(r => r.job_id === row.job_id && r.candidate_id === row.candidate_id)) return dupe('lh_app_job_cand');
  }
  if (table === 'lh_recruiters') {
    if (rows.some(r => r.email_norm === row.email_norm)) return dupe('lh_rec_email email_norm');
    if (rows.some(r => String(r.handle).toLowerCase() === String(row.handle).toLowerCase())) return dupe('lh_rec_handle handle');
    if (row.auth_id && rows.some(r => r.auth_id === row.auth_id)) return dupe('lh_recruiters_auth_id_key auth_id');
  }
  if (table === 'lh_jobs' && rows.some(r => r.slug === row.slug)) return dupe('lh_jobs_slug_key slug');
  if (table === 'lh_threads' && rows.some(r => r.token === row.token)) return dupe('lh_threads_token_key token');
  return null;
}

class Query {
  constructor(db, table) { this.db = db; this.table = table; this.op = 'select'; this.filters = []; this._order = null; this._limit = null; this._range = null; this._cols = '*'; this._head = false; this._count = false; this._wantRows = false; this._single = null; }
  select(cols, opts) {
    if (this.op === 'select') { this._cols = cols || '*'; if (opts && opts.count) this._count = true; if (opts && opts.head) this._head = true; }
    else { this._wantRows = true; this._cols = cols || '*'; }
    return this;
  }
  insert(v) { this.op = 'insert'; this.payload = v; return this; }
  update(v) { this.op = 'update'; this.payload = v; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(c, v) { this.filters.push(r => r[c] === v); return this; }
  in(c, arr) { this.filters.push(r => arr.includes(r[c])); return this; }
  gte(c, v) { this.filters.push(r => r[c] >= v); return this; }
  lte(c, v) { this.filters.push(r => r[c] <= v); return this; }
  is(c, v) { this.filters.push(r => (v === null ? r[c] == null : r[c] === v)); return this; }
  order(c, o) { this._order = [c, !(o && o.ascending === false)]; return this; }
  limit(n) { this._limit = n; return this; }
  range(a, b) { this._range = [a, b]; return this; }
  single() { this._single = 'single'; return this; }
  maybeSingle() { this._single = 'maybe'; return this; }
  then(res, rej) { return Promise.resolve().then(() => this.exec()).then(res, rej); }

  project(row) {
    if (this._cols === '*') return { ...row };
    const out = {};
    this._cols.split(',').map(s => s.trim()).forEach(c => { out[c] = row[c]; });
    return out;
  }

  exec() {
    const db = this.db, t = this.table, rows = db.t[t];
    if (!rows) return { data: null, error: { message: 'no such table ' + t } };
    const match = r => this.filters.every(f => f(r));
    let out = [];
    if (this.op === 'insert') {
      const list = [].concat(this.payload);
      for (const p of list) {
        const row = derive(t, { id: crypto.randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...DEFAULTS[t](), ...p });
        const bad = uniqueCheck(db, t, row, null);
        if (bad) return { data: null, error: bad };
        rows.push(row); out.push(row);
      }
    } else if (this.op === 'update') {
      for (const r of rows.filter(match)) {
        const next = derive(t, { ...r, ...this.payload, updated_at: new Date().toISOString() });
        const bad = uniqueCheck(db, t, next, r.id);
        if (bad) return { data: null, error: bad };
        Object.assign(r, next); out.push(r);
      }
    } else if (this.op === 'delete') {
      const gone = rows.filter(match);
      db.t[t] = rows.filter(r => !gone.includes(r));
      if (t === 'lh_candidates') gone.forEach(g => { db.t.lh_applications = db.t.lh_applications.filter(a => a.candidate_id !== g.id); });
      if (t === 'lh_threads') gone.forEach(g => { db.t.lh_messages = db.t.lh_messages.filter(m => m.thread_id !== g.id); });
      if (t === 'lh_jobs') gone.forEach(g => { const ts = db.t.lh_threads.filter(x => x.job_id === g.id).map(x => x.id); db.t.lh_threads = db.t.lh_threads.filter(x => x.job_id !== g.id); db.t.lh_messages = db.t.lh_messages.filter(m => !ts.includes(m.thread_id)); });
      if (t === 'lh_applications') gone.forEach(g => { db.t.lh_activities = db.t.lh_activities.filter(a => a.application_id !== g.id); });
      return { data: null, error: null };
    } else {
      out = rows.filter(match);
      if (this._count && this._head) return { data: null, count: out.length, error: null };
    }
    if (this.op !== 'select' && !this._wantRows) return { data: null, error: null };
    if (this._order) { const [c, asc] = this._order; out = [...out].sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1)); }
    if (this._range) out = out.slice(this._range[0], this._range[1] + 1);
    if (this._limit != null) out = out.slice(0, this._limit);
    out = out.map(r => this.project(r));
    if (this._single === 'single') return out.length === 1 ? { data: out[0], error: null } : { data: null, error: { message: 'single row expected, got ' + out.length } };
    if (this._single === 'maybe') return { data: out[0] || null, error: null };
    return { data: out, error: null, count: this._count ? out.length : undefined };
  }
}

class FakeDB {
  constructor() {
    this.t = { lh_recruiters: [], lh_jobs: [], lh_candidates: [], lh_applications: [], lh_activities: [], lh_threads: [], lh_messages: [], lh_settings: [], lh_reports: [] };
    this.files = new Map();
    const self = this;
    this.storage = {
      from: (bucket) => ({
        upload: async (path, buf) => { if (self.files.has(bucket + '/' + path)) return { error: { message: 'exists' } }; self.files.set(bucket + '/' + path, Buffer.from(buf)); return { data: { path }, error: null }; },
        download: async (path) => { const b = self.files.get(bucket + '/' + path); return b ? { data: { arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }, error: null } : { data: null, error: { message: 'not found' } }; },
        createSignedUrl: async (path) => ({ data: { signedUrl: 'https://fake.supabase.co/sign/' + path + '?token=x' }, error: null }),
        remove: async (paths) => { paths.forEach(p => self.files.delete(bucket + '/' + p)); return { data: null, error: null }; },
      }),
    };
  }
  from(table) { return new Query(this, table); }
}

module.exports = { FakeDB };
