'use strict';
/** Chạy thử cả site trên máy: file tĩnh + Pages Functions + DB giả có dữ liệu mẫu. Không cần Supabase. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const seed = require('./seed');

const PORT = Number(process.env.PORT) || 8888;
const PUB = path.join(__dirname, '..', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.png': 'image/png' };
const API = { '/api/jobs': 'jobs-public', '/api/apply': 'apply', '/api/track': 'track', '/api/admin': 'admin-api', '/api/admin-login': 'admin-login' };
const PAGES = [[/^\/jobs\/.+/, '/job.html'], [/^\/apply\/?$/, '/apply.html'], [/^\/track\/?$/, '/track.html']];

function readBody(req) { return new Promise(r => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => r(Buffer.concat(c))); }); }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
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
  let p = url.pathname;
  for (const [re, to] of PAGES) if (re.test(p)) p = to;
  let file = path.join(PUB, p);
  if (!file.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404, { 'content-type': TYPES['.html'] }); return res.end(fs.readFileSync(path.join(PUB, '404.html'))); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});

seed(H.fake).then(() => server.listen(PORT, () => console.log(`Lunahouse dev: http://localhost:${PORT}  (admin: ${process.env.ADMIN_PASSWORD})`)));
