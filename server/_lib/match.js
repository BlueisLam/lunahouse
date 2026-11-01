'use strict';
const { norm, toArr } = require('./util');

/**
 * Chuẩn hoá tên công nghệ để so khớp: "Node.js" = "NodeJS" = "node js", "Postgres" = "PostgreSQL"...
 * Giữ # và + (C#, C++) để không nhầm với C.
 */
const ALIAS = {
  reactjs: 'react', vuejs: 'vue', nodejs: 'node', expressjs: 'express', nextjs: 'next', nestjs: 'nest',
  postgres: 'postgresql', psql: 'postgresql', mongo: 'mongodb', golang: 'go', k8s: 'kubernetes',
  js: 'javascript', ts: 'typescript', dotnet: '.net', 'asp.net': 'asp.net', springboot: 'spring boot',
  reactnative: 'react native', gcp: 'google cloud', 'amazon web services': 'aws',
};

function canon(t) {
  let s = norm(t).replace(/[^a-z0-9#+.\s]/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/\.js\b/g, 'js');
  const squashed = s.replace(/\s/g, '');
  if (ALIAS[squashed]) return ALIAS[squashed];
  if (ALIAS[s]) return ALIAS[s];
  return s;
}
const tokens = s => (s.match(/[a-z0-9#+.]+/g) || []);

/** a khớp b nếu bằng nhau, hoặc mọi từ của tên ngắn hơn nằm trong tên dài hơn ("spring" ⊂ "spring boot"; "java" ⊄ "javascript"). */
function techMatch(a, b) {
  const x = canon(a), y = canon(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const tx = tokens(x), ty = tokens(y);
  const [s, l] = tx.length <= ty.length ? [tx, ty] : [ty, tx];
  return s.length > 0 && s.every(t => l.includes(t));
}

/**
 * Tầng 1 — lọc cứng, không tốn tiền AI.
 * job: {must_have_tech[], nice_to_have_tech[], domains[], min_years}
 * cands: dòng lh_candidates (light)
 * Trả về mảng {c, pre, overlap[], niceHit[], domainHit} đã sắp xếp giảm dần theo điểm sơ bộ.
 */
function stage1(job, cands) {
  const must = toArr(job.must_have_tech), nice = toArr(job.nice_to_have_tech), doms = toArr(job.domains);
  const minY = Number(job.min_years) || 0;
  const out = [];
  for (const c of cands) {
    if (c.is_open_to_work === false) continue;
    const yrs = Number(c.total_years_experience) || 0;
    if (minY && yrs < minY) continue;
    const techs = toArr(c.technologies, 200);
    const overlap = must.filter(m => techs.some(t => techMatch(t, m)));
    if (must.length && overlap.length === 0) continue;
    const niceHit = nice.filter(m => techs.some(t => techMatch(t, m)));
    const cd = toArr(c.project_domains).map(norm);
    const domainHit = doms.some(d => cd.includes(norm(d)));
    const pre = overlap.length * 10 + niceHit.length * 3 + Math.min(yrs, 15) + (domainHit ? 8 : 0);
    out.push({ c, pre, overlap, niceHit, domainHit });
  }
  return out.sort((a, b) => b.pre - a.pre);
}

module.exports = { stage1, techMatch, canon };
