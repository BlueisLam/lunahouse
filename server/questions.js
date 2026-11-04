'use strict';
/**
 * Hỏi đáp dưới job.
 *  - Ứng viên đặt câu hỏi (tên + email + nội dung) → tạo thread RIÊNG TƯ, báo Telegram cho admin,
 *    gửi email kèm link riêng /q?t=TOKEN để ứng viên xem và nhắn tiếp.
 *  - Thread chỉ hiện công khai dưới job khi admin bật is_public. Email và token không bao giờ lộ ra ngoài.
 */
const crypto = require('crypto');
const { sb, must } = require('./_lib/db');
const U = require('./_lib/util');
const N = require('./_lib/notify');
const T = require('./_lib/tenant');

const MAX_PER_IP_HOUR = 6;
const MAX_MSG_PER_THREAD = 60;
const MIN_BODY = 5, MAX_BODY = 1500;
const PUBLIC_LIMIT = 40;

/** Tên hiển thị công khai: chỉ lấy tên gọi (từ cuối), vd "Nguyễn Văn An" → "An". */
const displayName = full => {
  const w = U.clean(full, 80).split(/\s+/).filter(Boolean);
  return w.length ? w[w.length - 1] : 'Ẩn danh';
};
const pubMsg = m => ({ from: m.sender, body: m.body, at: m.created_at });

function readBody(raw) {
  const body = U.clean(raw, MAX_BODY + 50).replace(/\r/g, '').replace(/\n{3,}/g, '\n\n');
  if (body.length < MIN_BODY) throw new U.HttpError(400, 'Bạn viết rõ hơn một chút nhé (ít nhất ' + MIN_BODY + ' ký tự).');
  if (body.length > MAX_BODY) throw new U.HttpError(400, 'Nội dung dài quá, bạn rút gọn dưới ' + MAX_BODY + ' ký tự nhé.');
  return body;
}

async function tooMany(db, event) {
  const ipHash = U.sha256((process.env.SESSION_SECRET || '') + U.clientIp(event));
  const since = new Date(Date.now() - 3600e3).toISOString();
  const recent = await db.from('lh_messages').select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).gte('created_at', since);
  if ((recent.count || 0) >= MAX_PER_IP_HOUR) throw new U.HttpError(429, 'Bạn gửi hơi nhiều trong thời gian ngắn. Thử lại sau một giờ nhé.');
  return ipHash;
}

// ---------- GET ----------
async function listPublic(db, slug) {
  const job = must(await db.from('lh_jobs').select('id,status,recruiter_id').eq('slug', U.clean(slug, 80)).maybeSingle(), 'job');
  const owner = job && await T.byId(job.recruiter_id);
  if (!job || job.status !== 'open' || !owner || owner.status !== 'active') return U.json(200, { threads: [] });
  const threads = must(await db.from('lh_threads').select('id,author_name,created_at').eq('job_id', job.id).eq('is_public', true).order('updated_at', { ascending: false }).limit(PUBLIC_LIMIT), 'threads');
  if (!threads.length) return U.json(200, { threads: [] });
  const msgs = must(await db.from('lh_messages').select('thread_id,sender,body,created_at').in('thread_id', threads.map(t => t.id)).order('created_at', { ascending: true }), 'messages');
  const by = {};
  msgs.forEach(m => { (by[m.thread_id] = by[m.thread_id] || []).push(pubMsg(m)); });
  return U.json(200, {
    threads: threads.map(t => ({ name: displayName(t.author_name), at: t.created_at, messages: by[t.id] || [] })).filter(t => t.messages.length),
  }, { 'cache-control': 'public, max-age=30' });
}

async function viewPrivate(db, token) {
  const t = token && /^[a-f0-9]{20,64}$/.test(token)
    ? must(await db.from('lh_threads').select('id,job_id,recruiter_id,token,author_name,is_public,created_at').eq('token', token).maybeSingle(), 'thread') : null;
  if (!t) { await U.sleep(400); throw new U.HttpError(404, 'Không tìm thấy hội thoại này. Bạn mở lại link trong email nhé.'); }
  const job = must(await db.from('lh_jobs').select('title,slug,status').eq('id', t.job_id).maybeSingle(), 'job');
  const owner = await T.byId(t.recruiter_id);
  const msgs = must(await db.from('lh_messages').select('sender,body,created_at').eq('thread_id', t.id).order('created_at', { ascending: true }), 'messages');
  return U.json(200, {
    name: t.author_name, is_public: t.is_public, profile: owner ? T.publicProfile(owner) : null,
    job: job ? { title: job.title, slug: job.slug, open: job.status === 'open' } : null,
    messages: msgs.map(pubMsg),
  }, { 'cache-control': 'no-store' });
}

// ---------- POST ----------
async function ask(db, b, event) {
  if (b.website) return U.json(200, { ok: true, token: 'x'.repeat(32) }); // honeypot
  const name = U.clean(b.name, 80), emailRaw = U.clean(b.email, 120).toLowerCase();
  if (name.length < 2) throw new U.HttpError(400, 'Bạn nhập giúp mình tên nhé.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(emailRaw)) throw new U.HttpError(400, 'Email chưa đúng định dạng.');
  const body = readBody(b.body);
  const ipHash = await tooMany(db, event);

  const job = must(await db.from('lh_jobs').select('id,title,slug,status,recruiter_id').eq('slug', U.clean(b.job_slug, 80)).maybeSingle(), 'job');
  const rec = job && await T.byId(job.recruiter_id);
  if (!job || job.status !== 'open' || !rec || rec.status !== 'active') throw new U.HttpError(404, 'Vị trí này không còn nhận câu hỏi.');

  const token = crypto.randomBytes(18).toString('hex');
  const thread = must(await db.from('lh_threads').insert({ job_id: job.id, recruiter_id: job.recruiter_id, token, author_name: name, author_email: emailRaw, is_public: false, unread_admin: true, last_from: 'candidate' }).select().single(), 'thread');
  must(await db.from('lh_messages').insert({ thread_id: thread.id, sender: 'candidate', body, ip_hash: ipHash }), 'message');

  const base = N.baseUrl(event);
  await N.settle([N.notifyThreadMessage({ thread, job, body, first: true, base, rec }), N.emailThreadReceipt({ thread, job, body, base, rec })]);
  return U.json(200, { ok: true, token, link: N.threadLink(base, thread) });
}

async function say(db, b, event) {
  if (b.website) return U.json(200, { ok: true });
  const token = String(b.token || '');
  const thread = /^[a-f0-9]{20,64}$/.test(token) ? must(await db.from('lh_threads').select('*').eq('token', token).maybeSingle(), 'thread') : null;
  if (!thread) throw new U.HttpError(404, 'Không tìm thấy hội thoại này.');
  const body = readBody(b.body);
  const ipHash = await tooMany(db, event);
  const count = await db.from('lh_messages').select('id', { count: 'exact', head: true }).eq('thread_id', thread.id);
  if ((count.count || 0) >= MAX_MSG_PER_THREAD) throw new U.HttpError(429, 'Hội thoại này đã dài, bạn nhắn thẳng cho mình qua Zalo nhé.');

  must(await db.from('lh_messages').insert({ thread_id: thread.id, sender: 'candidate', body, ip_hash: ipHash }), 'message');
  must(await db.from('lh_threads').update({ unread_admin: true, last_from: 'candidate' }).eq('id', thread.id), 'thread update');
  const job = must(await db.from('lh_jobs').select('title').eq('id', thread.job_id).maybeSingle(), 'job');
  await N.notifyThreadMessage({ thread, job, body, first: false, base: N.baseUrl(event), rec: await T.byId(thread.recruiter_id) });
  return U.json(200, { ok: true });
}

exports.handler = U.wrap(async (event) => {
  const db = sb();
  if (event.httpMethod === 'GET') {
    const q = event.queryStringParameters || {};
    if (q.t) return viewPrivate(db, String(q.t));
    if (q.job) return listPublic(db, q.job);
    throw new U.HttpError(400, 'Thiếu tham số.');
  }
  if (event.httpMethod !== 'POST') throw new U.HttpError(405, 'Method not allowed');
  const b = U.parseBody(event, 20_000);
  if (b.action === 'ask') return ask(db, b, event);
  if (b.action === 'say') return say(db, b, event);
  throw new U.HttpError(400, 'Hành động không hợp lệ.');
});
