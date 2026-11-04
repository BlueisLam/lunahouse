import { loadEnv } from '../server/_lib/cf.js';
import * as tenantMod from '../server/_lib/tenant.js';
import { esc } from '../server/_lib/util.js';

// /<handle>: trang riêng của từng recruiter (cùng khung với trang chủ, dữ liệu do site.js nạp theo handle).
// Đường dẫn hệ thống (apply, track, admin...) và file tĩnh được chuyển thẳng cho phần tệp tĩnh.
export async function onRequest(ctx) {
  const { request, env, params, next } = ctx;
  loadEnv(env);
  const T = tenantMod.default || tenantMod;
  const url = new URL(request.url);
  const raw = Array.isArray(params.handle) ? params.handle[0] : params.handle;
  const handle = decodeURIComponent(raw || '').toLowerCase();
  if (request.method !== 'GET' || !/^[a-z0-9-]{3,30}$/.test(handle) || T.RESERVED.has(handle)) return next();

  let rec = null;
  try { rec = await T.publicByHandle(handle); } catch (e) { console.warn('[handle]', e && e.message); return next(); }
  const notFound = async () => {
    const r = await env.ASSETS.fetch(new URL('/404.html', url));
    return new Response(r.body, { status: 404, headers: r.headers });
  };
  if (!rec) return notFound();

  let asset = await env.ASSETS.fetch(new URL('/', url));
  if (asset.status >= 300 && asset.status < 400 && asset.headers.get('location')) asset = await env.ASSETS.fetch(new URL(asset.headers.get('location'), url));
  if (!asset.ok) return asset;
  const origin = (env.SEO_ORIGIN || 'https://lunahouse.click').replace(/\/$/, '');
  const canon = `${origin}/${rec.handle}`;
  const name = rec.display_name || rec.handle;
  const title = `${name} · ${rec.title || 'Recruiter'} · Luna`;
  const desc = (rec.bio || `${name} đang tuyển dụng IT và game. Xem vị trí đang mở, nộp CV một lần và tra cứu tiến độ hồ sơ.`).slice(0, 155);
  const prod = /(^|\.)lunahouse\.click$/.test(url.hostname);
  let html = await asset.text();
  html = html
    .replace(/<title>[\s\S]*?<\/title>\s*/i, '')
    .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>\s*/gi, '')
    .replace(/<link rel="canonical"[^>]*>\s*/i, '')
    .replace(/<meta\s+(name="description"|property="og:(title|description|url)"|name="twitter:title")[^>]*>\s*/gi, '')
    .replace('</head>', [
      `<title>${esc(title)}</title>`, `<meta name="description" content="${esc(desc)}">`, `<link rel="canonical" href="${esc(canon)}">`,
      `<meta property="og:title" content="${esc(title)}">`, `<meta property="og:description" content="${esc(desc)}">`, `<meta property="og:url" content="${esc(canon)}">`,
      prod ? '' : '<meta name="robots" content="noindex, nofollow">',
    ].filter(Boolean).join('\n') + '\n</head>');
  const h = new Headers(asset.headers);
  h.delete('content-length'); h.delete('etag');
  h.set('content-type', 'text/html; charset=utf-8');
  h.set('cache-control', 'public, max-age=60');
  return new Response(html, { status: 200, headers: h });
}
