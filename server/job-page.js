'use strict';
/**
 * SEO cho trang chi tiết job.
 * Trang /jobs/<slug> vốn do JS dựng ở trình duyệt; Google đọc được nhưng bản xem trước khi chia sẻ
 * (Facebook, Zalo, LinkedIn) thì không chạy JS. Hàm này nhét title, mô tả, canonical, Open Graph và
 * JSON-LD JobPosting vào HTML ngay từ server. Lỗi gì cũng trả lại HTML gốc, không làm hỏng trang.
 */
const { sb, must } = require('./_lib/db');
const { esc } = require('./_lib/util');
const T = require('./_lib/tenant');

const SITE = () => (process.env.SEO_ORIGIN || 'https://lunahouse.click').replace(/\/$/, ''); // cố định, không theo SITE_URL (bản xem thử vẫn trỏ canonical về production)
const BRAND = 'Luna';
const COLS = 'slug,title,level,job_type,salary_text,location,summary,lang,responsibilities,requirements,benefits,created_at,recruiter_id';

const arr = v => (Array.isArray(v) ? v : String(v || '').split('\n')).map(s => String(s).trim()).filter(Boolean);
const trunc = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
const EMP = { 'full-time': 'FULL_TIME', 'part-time': 'PART_TIME', contract: 'CONTRACTOR', freelance: 'CONTRACTOR', intern: 'INTERN', internship: 'INTERN' };

function jobPosting(j, url, rec) {
  const desc = [j.summary].concat(arr(j.responsibilities), arr(j.requirements), arr(j.benefits)).filter(Boolean);
  const ld = {
    '@context': 'https://schema.org', '@type': 'JobPosting',
    title: j.title, description: '<p>' + desc.map(esc).join('</p><p>') + '</p>',
    datePosted: String(j.created_at || '').slice(0, 10) || undefined,
    employmentType: EMP[String(j.job_type || 'full-time').toLowerCase()] || 'FULL_TIME',
    hiringOrganization: { '@type': 'Organization', name: (rec && rec.display_name ? rec.display_name + ' · ' : '') + BRAND + ' · Personal recruiting', sameAs: SITE() + (rec && rec.handle ? '/' + rec.handle : '') },
    jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressCountry: 'VN', addressLocality: j.location || undefined } },
    directApply: true, url,
    inLanguage: j.lang === 'en' ? 'en' : 'vi',
  };
  return JSON.stringify(ld).replace(/</g, '\\u003c');
}

function inject(html, j, host, rec) {
  const url = SITE() + '/jobs/' + encodeURIComponent(j.slug);
  const title = j.title + ' · ' + BRAND;
  const desc = trunc(j.summary || j.title, 155);
  const prod = /(^|\.)lunahouse\.click$/.test(host || '');
  const head = [
    '<title>' + esc(title) + '</title>',
    '<meta name="description" content="' + esc(desc) + '">',
    '<link rel="canonical" href="' + esc(url) + '">',
    prod ? '' : '<meta name="robots" content="noindex, nofollow">',
    '<meta property="og:title" content="' + esc(title) + '">',
    '<meta property="og:description" content="' + esc(desc) + '">',
    '<meta property="og:type" content="website">',
    '<meta property="og:url" content="' + esc(url) + '">',
    '<meta property="og:site_name" content="' + BRAND + '">',
    '<meta property="og:image" content="' + SITE() + '/assets/og.png">',
    '<meta name="twitter:card" content="summary_large_image">',
    '<script type="application/ld+json">' + jobPosting(j, url, rec) + '</script>',
  ].filter(Boolean).join('\n');
  return html
    .replace(/<title>[\s\S]*?<\/title>\s*/i, '')
    .replace(/<meta\s+(name="description"|property="og:[a-z:_]+")[^>]*>\s*/gi, '')
    .replace(/<html lang="[a-z-]+"/i, '<html lang="' + (j.lang === 'en' ? 'en' : 'vi') + '"')
    .replace('</head>', head + '\n</head>');
}

/** Trả HTML đã nhét SEO, hoặc null nếu không có job (để dùng HTML gốc). */
async function render(html, slug, host) {
  try {
    const j = must(await sb().from('lh_jobs').select(COLS).eq('status', 'open').eq('slug', String(slug).slice(0, 80)).maybeSingle(), 'job');
    const rec = j && await T.byId(j.recruiter_id);
    if (!j || !rec || rec.status !== 'active') return html.replace('</head>', '<meta name="robots" content="noindex">\n</head>');
    return inject(html, j, host, rec);
  } catch (e) { console.warn('[seo] bỏ qua:', e && e.message); return null; }
}

async function sitemap() {
  const db = sb();
  const recs = (must(await db.from('lh_recruiters').select('id,handle,created_at').eq('status', 'active'), 'recruiters') || []);
  const active = new Map(recs.map(r => [r.id, r]));
  const rows = (must(await db.from('lh_jobs').select('slug,created_at,recruiter_id').eq('status', 'open').order('created_at', { ascending: false }), 'jobs') || []).filter(r => active.has(r.recruiter_id));
  const u = (loc, last, pr) => '<url><loc>' + esc(SITE() + loc) + '</loc>' + (last ? '<lastmod>' + String(last).slice(0, 10) + '</lastmod>' : '') + '<priority>' + pr + '</priority></url>';
  const owner = process.env.ADMIN_EMAIL ? await T.byEmail(process.env.ADMIN_EMAIL) : null;
  const pages = recs.filter(r => !owner || r.id !== owner.id).map(r => u('/' + encodeURIComponent(r.handle), r.created_at, '0.6'));
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    [u('/', rows[0] && rows[0].created_at, '1.0')].concat(pages, rows.map(r => u('/jobs/' + encodeURIComponent(r.slug), r.created_at, '0.8'))).join('\n') + '\n</urlset>\n';
}

module.exports = { render, sitemap, inject };
