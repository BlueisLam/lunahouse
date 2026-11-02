import { loadEnv } from '../../server/_lib/cf.js';
import * as seo from '../../server/job-page.js';

// /jobs/<slug>: phục vụ job.html kèm SEO của đúng job. Lỗi thì trả trang gốc.
export async function onRequest({ request, env, params }) {
  loadEnv(env);
  const url = new URL(request.url);
  let asset = await env.ASSETS.fetch(new URL('/job', url));
  if (asset.status >= 300 && asset.status < 400 && asset.headers.get('location')) asset = await env.ASSETS.fetch(new URL(asset.headers.get('location'), url));
  const mod = seo.default || seo;
  const slug = Array.isArray(params.slug) ? params.slug[0] : params.slug;
  const out = asset.ok ? await mod.render(await asset.clone().text(), decodeURIComponent(slug || ''), url.hostname) : null;
  if (!out) return asset;
  const h = new Headers(asset.headers);
  h.delete('content-length'); h.delete('etag');
  h.set('content-type', 'text/html; charset=utf-8');
  h.set('cache-control', 'public, max-age=60');
  return new Response(out, { status: 200, headers: h });
}
