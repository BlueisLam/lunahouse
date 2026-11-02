'use strict';
/** Chạy thử cả site trên máy: file tĩnh + Pages Functions + DB giả có dữ liệu mẫu. Không cần Supabase. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const seed = require('./seed');

const PORT = Number(process.env.PORT) || 8888;
const PUB = path.join(__dirname, '..', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.png': 'image/png' };
const API = { '/api/jobs': 'jobs-public', '/api/apply': 'apply', '/api/track': 'track', '/api/admin': 'admin-api', '/api/admin-login': 'admin-login', '/api/questions': 'questions' };
const PAGES = [[/^\/jobs\/.+/, '/job.html'], [/^\/apply\/?$/, '/apply.html'], [/^\/track\/?$/, '/track.html'], [/^\/q\/?$/, '/q.html']];

/** Đọc public/_headers để bản chạy thử có đúng CSP/headers như Cloudflare Pages. */
function staticHeaders(pathname) {
  const out = {}; let active = false;
  let txt = ''; try { txt = fs.readFileSync(path.join(PUB, '_headers'), 'utf8'); } catch (e) { return out; }
  for (const raw of txt.split('\n')) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (!/^\s/.test(raw)) { const rule = raw.trim(); const re = new RegExp('^' + rule.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'); active = re.test(pathname); continue; }
    if (active) { const i = raw.indexOf(':'); out[raw.slice(0, i).trim().toLowerCase()] = raw.slice(i + 1).trim(); }
  }
  return out;
}

function readBody(req) { return new Promise(r => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => r(Buffer.concat(c))); }); }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/cv') {
    const cv = require('../server/cv');
    const hdr = new Headers(); Object.entries(req.headers).forEach(([k, v]) => hdr.set(k, String(v)));
    const r = await cv.stream(new Request('http://localhost' + req.url, { headers: hdr }), async (db, p) => {
      const b = H.fake.files.get('lh-cv/' + p); return b ? new Response(b) : new Response('', { status: 404 });
    });
    res.writeHead(r.status, Object.fromEntries(r.headers)); return res.end(Buffer.from(await r.arrayBuffer()));
  }
  const fn = API[url.pathname];
  if (fn) {
    const body = await readBody(req);
    const headers = Object.fromEntries(Object.entries(req.headers));
    const multipart = (headers['content-type'] || '').startsWith('multipart/form-data');
    const form = multipart ? await new Response(body, { headers: { 'content-type': headers['content-type'] } }).formData() : null;
    const event = { httpMethod: req.method, headers, body: multipart ? '' : body.toString('utf8'), form, queryStringParameters: Object.fromEntries(url.searchParams) };
    const r = await H.F(fn).handler(event, {});
    res.writeHead(r.statusCode, r.headers || {}); return res.end(r.body);
  }
  if (url.pathname === '/sitemap.xml') { res.writeHead(200, { 'content-type': 'application/xml' }); return res.end(await require('../server/job-page').sitemap()); }
  if (/^\/jobs\/.+/.test(url.pathname)) {
    const out = await require('../server/job-page').render(fs.readFileSync(path.join(PUB, 'job.html'), 'utf8'), decodeURIComponent(url.pathname.split('/').pop()), url.hostname);
    res.writeHead(200, Object.assign({ 'content-type': TYPES['.html'] }, staticHeaders('/job')));
    return res.end(out || fs.readFileSync(path.join(PUB, 'job.html')));
  }
  let p = url.pathname;
  for (const [re, to] of PAGES) if (re.test(p)) p = to;
  let file = path.join(PUB, p);
  if (!file.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404, { 'content-type': TYPES['.html'] }); return res.end(fs.readFileSync(path.join(PUB, '404.html'))); }
  res.writeHead(200, Object.assign({ 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }, staticHeaders(url.pathname)));
  res.end(fs.readFileSync(file));
});

seed(H.fake).then(() => server.listen(PORT, () => console.log(`Lunahouse dev: http://localhost:${PORT}  (admin: ${process.env.ADMIN_PASSWORD})`)));
