import { loadEnv } from '../server/_lib/cf.js';
import * as seo from '../server/job-page.js';

export async function onRequest({ env }) {
  loadEnv(env);
  const mod = seo.default || seo;
  try {
    return new Response(await mod.sitemap(), { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=300' } });
  } catch (e) { return new Response('Sitemap tạm thời không có.', { status: 503 }); }
}
