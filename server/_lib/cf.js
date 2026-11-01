'use strict';
/**
 * Cầu nối Cloudflare Pages Functions ↔ handler kiểu (event → {statusCode, headers, body}).
 * Mỗi file trong functions/api/ chỉ cần: export const onRequest = (ctx) => run(handlerModule, ctx).
 */
const MAX_BODY = 6 * 1024 * 1024;
const SEC = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'cache-control': 'no-store',
};

function reply(status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...SEC } });
}

/** Cloudflare đưa biến môi trường qua env; các thư viện bên dưới đọc process.env. */
function loadEnv(env) {
  for (const [k, v] of Object.entries(env || {})) if (typeof v === 'string') process.env[k] = v;
}

async function run(mod, ctx) {
  const { request, env } = ctx;
  loadEnv(env);

  const len = Number(request.headers.get('content-length') || 0);
  if (len > MAX_BODY) return reply(413, { error: 'Dữ liệu gửi lên quá lớn.' });

  const url = new URL(request.url);
  const headers = {};
  request.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  const event = { httpMethod: request.method, headers, queryStringParameters: Object.fromEntries(url.searchParams), body: '', form: null };

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const ct = headers['content-type'] || '';
    try {
      if (ct.startsWith('multipart/form-data')) event.form = await request.formData();
      else event.body = await request.text();
    } catch { return reply(400, { error: 'Dữ liệu không hợp lệ.' }); }
  }

  const r = await mod.handler(event, {});
  const out = new Headers();
  for (const [k, v] of Object.entries({ ...SEC, ...(r.headers || {}) })) {
    if (Array.isArray(v)) v.forEach(x => out.append(k, x)); else out.set(k, String(v));
  }
  return new Response(r.body || null, { status: r.statusCode, headers: out });
}

module.exports = { run, loadEnv };
