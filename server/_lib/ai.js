'use strict';
const { HttpError, toArr, clean } = require('./util');

// Nhiều nhà cung cấp AI, tự chuyển dự phòng. Thứ tự đặt qua AI_PROVIDERS (mặc định "gemini,groq");
// nhà nào chưa có API key thì bỏ qua. Tên model đổi thường xuyên nên luôn đặt qua biến môi trường.
const MODEL_MAIN = () => process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const MODEL_FAST = () => process.env.GROQ_MODEL_FAST || MODEL_MAIN();
const MODEL_VISION = () => process.env.GROQ_VISION_MODEL || '';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const providerOrder = () => String(process.env.AI_PROVIDERS || 'gemini,groq').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
const hasKey = p => !!(p === 'gemini' ? process.env.GEMINI_API_KEY : p === 'groq' ? process.env.GROQ_API_KEY : '');
const activeProviders = () => providerOrder().filter((p, i, a) => a.indexOf(p) === i && hasKey(p));
/** Có nhà cung cấp nào đọc được ảnh không (Gemini luôn đọc được; Groq cần GROQ_VISION_MODEL). */
const canSeeImages = () => activeProviders().some(p => p === 'gemini' || (p === 'groq' && !!MODEL_VISION()));

class ProviderError extends Error { constructor(msg, status) { super(msg); this.status = status; } }
const retryable = e => !e.status || e.status === 429 || e.status >= 500 || e.status === 408;

async function callGroq({ text, images, max_tokens, model, timeoutMs }) {
  const content = images && images.length
    ? [{ type: 'text', text }, ...images.map(u => ({ type: 'image_url', image_url: { url: u } }))]
    : text;
  const mdl = model || MODEL_MAIN();
  const body = { model: mdl, max_completion_tokens: max_tokens, temperature: 0.2, messages: [{ role: 'user', content }] };
  if (/^openai\/gpt-oss/.test(mdl)) body.reasoning_effort = 'low';
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.GROQ_API_KEY },
    body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
  });
  const raw = await r.text();
  if (!r.ok) throw Object.assign(new ProviderError(`Groq API ${r.status}: ${raw.slice(0, 240)}`, r.status), { retryAfter: Number(r.headers && r.headers.get && r.headers.get('retry-after')) || 0 });
  const msg = (JSON.parse(raw).choices || [{}])[0].message;
  return String((msg && msg.content) || '');
}

// Google hay khai tử model cũ ("no longer available", 404). Thử lần lượt: GEMINI_MODEL → gemini-3.8-flash → gemini-flash-latest.
const geminiModels = () => [process.env.GEMINI_MODEL, 'gemini-3.8-flash', 'gemini-flash-latest'].filter((m, i, a) => m && a.indexOf(m) === i);
const deadGemini = new Set(); // model đã bị Google từ chối (404) thì khỏi thử lại trong cùng instance

async function callGemini({ text, images, max_tokens, timeoutMs }) {
  const parts = [{ text }];
  for (const u of images || []) {
    const m = /^data:([^;]+);base64,(.+)$/.exec(u || '');
    if (m) parts.push({ inline_data: { mime_type: m[1], data: m[2] } });
  }
  const list = geminiModels().filter(m => !deadGemini.has(m));
  if (!list.length) deadGemini.clear(), list.push(...geminiModels());
  let lastErr;
  for (const mdl of list) {
    const gen = { maxOutputTokens: /2\.5-flash/.test(mdl) ? max_tokens : Math.min(max_tokens * 3, 16000), temperature: 0.2 };
    if (/2\.5-flash/.test(mdl)) gen.thinkingConfig = { thinkingBudget: 0 }; // đời 3.x có "suy nghĩ" ăn token đầu ra nên nới hạn mức
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(mdl) + ':generateContent', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: gen }), signal: AbortSignal.timeout(timeoutMs),
    });
    const raw = await r.text();
    if (!r.ok) {
      lastErr = Object.assign(new ProviderError(`Gemini API ${r.status} (${mdl}): ${raw.slice(0, 200)}`, r.status), { retryAfter: Number(r.headers && r.headers.get && r.headers.get('retry-after')) || 0 });
      if (r.status === 404 || (r.status === 400 && /model/i.test(raw))) { deadGemini.add(mdl); continue; } // model không còn → thử model kế
      throw lastErr;
    }
    const c = (JSON.parse(raw).candidates || [])[0];
    const out = c && c.content && (c.content.parts || []).map(p => p.text || '').join('');
    if (!out) throw new ProviderError('Gemini không trả nội dung (' + ((c && c.finishReason) || 'rỗng') + ').', 502);
    return out;
  }
  throw lastErr || new ProviderError('Gemini: không có model nào dùng được.', 404);
}
const CALL = { gemini: callGemini, groq: callGroq };

/**
 * Gọi AI. Thử lần lượt các nhà cung cấp theo AI_PROVIDERS; nhà nào hết hạn mức (429), lỗi máy chủ, quá giờ
 * hoặc lỗi cấu hình thì chuyển sang nhà kế tiếp. Nhà cuối cùng thì đợi và thử lại tối đa 3 lần khi bị 429.
 * images: mảng data URL. model: tên model Groq (chỉ Groq dùng).
 */
async function llm({ text, images, max_tokens = 2000, model, timeoutMs = 100000 }) {
  const hasImg = !!(images && images.length);
  let list = activeProviders();
  if (hasImg) list = list.filter(p => p === 'gemini' || !!model); // Groq chỉ đọc ảnh khi có model vision
  if (!list.length) {
    if (!activeProviders().length) throw new HttpError(400, 'Chưa cấu hình GEMINI_API_KEY hoặc GROQ_API_KEY trong biến môi trường.');
    throw new HttpError(400, 'Chưa có AI nào đọc được ảnh. Đặt GEMINI_API_KEY hoặc GROQ_VISION_MODEL.');
  }
  const errs = [];
  for (let i = 0; i < list.length; i++) {
    const p = list[i], last = i === list.length - 1;
    for (let attempt = 0; attempt < (last ? 3 : 1); attempt++) {
      try { return await CALL[p]({ text, images, max_tokens, model, timeoutMs }); }
      catch (e) {
        if (e.name === 'TimeoutError' || e.name === 'AbortError') e = new ProviderError(p + ' quá thời gian chờ.', 408);
        if (last && e.status === 429 && attempt < 2) { await sleep(Math.min(e.retryAfter || 5, 10) * 1000); continue; }
        errs.push(e.message);
        if (!retryable(e) && !last) console.warn('[ai]', p, 'lỗi cấu hình, chuyển nhà kế tiếp:', e.message);
        else if (!last) console.warn('[ai]', p, 'không dùng được, chuyển nhà kế tiếp:', e.message);
        break;
      }
    }
  }
  throw new Error(errs.length > 1 ? errs.join(' | ') : errs[0]);
}

/** Lấy JSON object/array đầu tiên trong câu trả lời (model đôi khi bọc ```json). */
function extractJson(text) {
  const s = String(text || '');
  const o = s.indexOf('{'), a = s.indexOf('[');
  const tryParse = (from, close) => {
    const end = s.lastIndexOf(close);
    if (from < 0 || end <= from) return undefined;
    try { return JSON.parse(s.slice(from, end + 1)); } catch { return undefined; }
  };
  const first = (a >= 0 && (o < 0 || a < o)) ? [tryParse(a, ']'), tryParse(o, '}')] : [tryParse(o, '}'), tryParse(a, ']')];
  const hit = first.find(x => x !== undefined);
  if (hit === undefined) throw new Error('Không đọc được JSON từ câu trả lời của AI.');
  return hit;
}

// ---------- Đọc CV ----------
const PARSE_PROMPT = `You are a CV parser for a recruiter. Read the CV text below and return ONE JSON object only — no markdown fences, no commentary.

Fields and rules (follow strictly):
full_name: candidate full legal name exactly as written in the CV.
date_of_birth: "DD/MM/YYYY" if available. If only a year is available, "YYYY". If not mentioned, estimate as (year the candidate started university - 18) and output that year as "YYYY". If the university start year is also missing, "".
address: city or province name ONLY, no street/ward/district. Keep Vietnamese names in Vietnamese (e.g. "Hà Nội", "Hồ Chí Minh", "Đà Nẵng").
phone_number: exactly as shown.
email: exactly as shown.
gender: "Male" or "Female". If not mentioned, default to "Male".
positions: array of ALL job positions/roles mentioned, e.g. ["Backend Developer","Team Lead"].
english_level: e.g. "IELTS 6.5", "TOEIC 800", "Fluent", "Intermediate". "" if not mentioned.
total_years_experience: total professional working experience in years, number (integer or decimal). Exclude internships unless that is all there is. 0 if fresher.
years_experience_by_role: object mapping snake_case roles to years, e.g. {"backend":6,"team_lead":3}. {} if not derivable.
project_domains: array of industries/fields of projects, e.g. ["E-commerce","Banking","Healthcare","ERP","CRM"].
technologies: array of ALL programming languages, frameworks, libraries, databases, tools and platforms mentioned. Canonical names (React, Node.js, Spring Boot, PostgreSQL, AWS...). Do not invent any.
expected_salary: as stated in the CV, else "".
notice_period: as stated in the CV, else "".
job_type_preference: one of "Full-time","Part-time","Freelance","Contract","Internship" or "" if not stated.
headline: ONE short line in Vietnamese: seniority + main stack + strongest domain (max 18 words).
cv_text: cleaned plain text of the CV, max 3000 characters.

Never invent facts. Use "" / [] / {} when the CV is silent. Output the JSON object only.`;

/** Ghép prompt đọc CV với nội dung chữ của CV. */
function cvPrompt(text) {
  return PARSE_PROMPT + '\n\n--- CV ---\n' + String(text || '').slice(0, 16000);
}

/** Chuẩn hoá kết quả AI thành các cột của lh_candidates. */
function shapeParsed(raw) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const roles = {};
  if (raw.years_experience_by_role && typeof raw.years_experience_by_role === 'object' && !Array.isArray(raw.years_experience_by_role)) {
    for (const [k, v] of Object.entries(raw.years_experience_by_role)) {
      const n = parseFloat(v);
      if (!isNaN(n)) roles[clean(k, 40).toLowerCase().replace(/\s+/g, '_')] = n;
    }
  }
  const yrs = parseFloat(raw.total_years_experience);
  const jt = ['Full-time', 'Part-time', 'Freelance', 'Contract', 'Internship'];
  return {
    full_name: clean(raw.full_name, 120),
    date_of_birth: clean(raw.date_of_birth, 12),
    address: clean(raw.address, 80),
    phone_number: clean(raw.phone_number, 30),
    email: clean(raw.email, 120),
    gender: raw.gender === 'Female' ? 'Female' : 'Male',
    positions: toArr(raw.positions, 20),
    english_level: clean(raw.english_level, 60),
    total_years_experience: isNaN(yrs) ? 0 : Math.max(0, Math.min(60, yrs)),
    years_experience_by_role: roles,
    project_domains: toArr(raw.project_domains, 30),
    technologies: toArr(raw.technologies, 120),
    expected_salary: clean(raw.expected_salary, 80),
    notice_period: clean(raw.notice_period, 80),
    job_type_preference: jt.includes(raw.job_type_preference) ? raw.job_type_preference : '',
    headline: clean(raw.headline, 200),
    cv_text: clean(raw.cv_text, 6000),
  };
}

/**
 * Gộp kết quả đọc CV vào hồ sơ hiện có.
 * - Thông tin liên hệ ứng viên tự điền khi nộp (tên, email, sđt, địa chỉ, lương, notice): KHÔNG bị AI ghi đè nếu đã có.
 * - Phần suy ra từ CV (kỹ năng, năm kinh nghiệm, domain...): luôn lấy từ lần đọc mới nhất.
 */
function mergeParsed(cur, p) {
  const blank = v => v == null || v === '' || (Array.isArray(v) && !v.length);
  const placeholder = /^\(đang phân tích\)/.test(cur.full_name || '');
  const out = {};
  const keepIfFilled = ['full_name', 'email', 'phone_number', 'address', 'expected_salary', 'notice_period', 'job_type_preference'];
  for (const k of keepIfFilled) {
    const curVal = k === 'full_name' && placeholder ? '' : cur[k];
    out[k] = blank(curVal) ? p[k] : curVal;
  }
  for (const k of ['date_of_birth', 'gender', 'positions', 'english_level', 'total_years_experience', 'years_experience_by_role',
    'project_domains', 'technologies', 'headline', 'cv_text']) out[k] = p[k];
  if (!out.full_name) out.full_name = 'Chưa rõ tên';
  return out;
}

// ---------- Chấm điểm matching (tầng 2) ----------
function scorePrompt(job, cands) {
  return `Bạn là trợ lý tuyển dụng IT. Chấm độ phù hợp của từng ứng viên với job dưới đây.

JOB:
${JSON.stringify({
    title: job.title, level: job.level, job_type: job.job_type, min_years: job.min_years,
    must_have: job.must_have_tech, nice_to_have: job.nice_to_have_tech, domains: job.domains,
    salary: job.salary_text, location: job.location, summary: job.summary, responsibilities: job.responsibilities, requirements: job.requirements,
  })}

ỨNG VIÊN:
${JSON.stringify(cands.map(c => ({
    candidate_id: c.id, years: c.total_years_experience, by_role: c.years_experience_by_role,
    positions: c.positions, technologies: c.technologies, domains: c.project_domains,
    english: c.english_level, expected_salary: c.expected_salary, headline: c.headline,
  })))}

Trả về DUY NHẤT một JSON array, mỗi phần tử:
{"candidate_id":"...","score":0-100,"strengths":"...","gaps":"..."}

Quy tắc chấm:
- score phản ánh khả năng ứng viên qua được vòng sàng lọc của khách hàng.
- Công nghệ tương đương được tính là phù hợp (React ~ Next.js, MySQL ~ PostgreSQL, Java ~ Kotlin backend).
- Thiếu tech bắt buộc, thiếu năm kinh nghiệm, hoặc sai domain thì trừ điểm mạnh.
- strengths và gaps viết TIẾNG VIỆT, mỗi phần tối đa 25 từ, cụ thể, không nói chung chung.
- Chỉ trả JSON array, không thêm chữ nào khác.`;
}

async function scoreBatch(job, cands) {
  const text = await llm({ text: scorePrompt(job, cands), max_tokens: 3000, model: MODEL_MAIN(), timeoutMs: 24000 });
  const arr = extractJson(text);
  const by = {};
  (Array.isArray(arr) ? arr : []).forEach(s => { by[String(s.candidate_id)] = s; });
  return cands.map(c => {
    const s = by[String(c.id)] || {};
    const sc = Math.round(Number(s.score));
    return { candidate_id: c.id, score: isNaN(sc) ? 0 : Math.max(0, Math.min(100, sc)), strengths: clean(s.strengths, 300), gaps: clean(s.gaps, 300) };
  });
}

// ---------- Dán JD → điền form ----------
async function jdFromText(text, lang) {
  const en = lang === 'en';
  const prompt = `Đọc đoạn mô tả công việc (JD) dưới đây và trả về DUY NHẤT một JSON object, không thêm chữ nào khác:
{
 "title": "tên vị trí",
 "level": "Junior | Mid | Senior | Lead | ''",
 "job_type": "Full-time | Part-time | Freelance | Contract | Internship",
 "salary_text": "mức lương nếu JD có ghi, nếu không thì ''",
 "location": "địa điểm làm việc nếu JD có ghi (tỉnh/thành phố, hoặc Remote / Hybrid), nếu không thì ''",
 "summary": "1–2 câu tóm tắt vị trí, ${en ? 'tiếng Anh' : 'tiếng Việt'}",
 "responsibilities": "mỗi ý một dòng, ${en ? 'tiếng Anh' : 'tiếng Việt'}, không ký hiệu đầu dòng",
 "requirements": "mỗi ý một dòng, ${en ? 'tiếng Anh' : 'tiếng Việt'}, không ký hiệu đầu dòng",
 "benefits": "mỗi ý một dòng, ${en ? 'tiếng Anh' : 'tiếng Việt'}, không ký hiệu đầu dòng; '' nếu JD không nêu",
 "must_have_tech": ["công nghệ bắt buộc"],
 "nice_to_have_tech": ["công nghệ ưu tiên / là điểm cộng"],
 "domains": ["lĩnh vực dự án, ví dụ Banking, E-commerce"],
 "min_years": số năm kinh nghiệm tối thiểu (số, 0 nếu không nêu)
}
Quy tắc: Địa điểm chỉ đưa vào trường location. KHÔNG đưa số lượng tuyển, tên khách hàng hay thông tin nhận diện công ty vào bất kỳ trường nào. Không bịa thông tin không có trong JD.${en ? '\nNGÔN NGỮ ĐẦU RA: viết bằng tiếng Anh tự nhiên, chuyên nghiệp cho TẤT CẢ trường chữ (title, summary, responsibilities, requirements, benefits, salary_text, location). Nếu JD gốc là tiếng Việt thì dịch sang tiếng Anh; giữ nguyên tên công nghệ.' : '\nNGÔN NGỮ ĐẦU RA: tiếng Việt cho các trường mô tả; tên công nghệ và chức danh quen thuộc có thể giữ tiếng Anh. Nếu JD gốc là tiếng Anh thì dịch sang tiếng Việt.'}

--- JD ---
${String(text).slice(0, 12000)}`;
  const out = await llm({ text: prompt, max_tokens: 3000, model: MODEL_FAST(), timeoutMs: 24000 });
  return extractJson(out);
}

module.exports = { llm, extractJson, cvPrompt, shapeParsed, mergeParsed, scoreBatch, jdFromText, PARSE_PROMPT, MODEL_MAIN, MODEL_FAST, MODEL_VISION, canSeeImages, activeProviders };
