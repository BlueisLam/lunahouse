'use strict';
const { HttpError, toArr, clean } = require('./util');

// Groq (API tương thích OpenAI). Tên model đổi thường xuyên, nên luôn đặt qua biến GROQ_MODEL.
const MODEL_MAIN = () => process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const MODEL_FAST = () => process.env.GROQ_MODEL_FAST || MODEL_MAIN();
const MODEL_VISION = () => process.env.GROQ_VISION_MODEL || '';
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Gọi Groq. images: mảng data URL (chỉ khi có GROQ_VISION_MODEL). Tự thử lại khi bị giới hạn tốc độ (429). */
async function llm({ text, images, max_tokens = 2000, model, timeoutMs = 100000 }) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new HttpError(400, 'Chưa cấu hình GROQ_API_KEY trong biến môi trường.');
  const content = images && images.length
    ? [{ type: 'text', text }, ...images.map(u => ({ type: 'image_url', image_url: { url: u } }))]
    : text;
  const mdl = model || MODEL_MAIN();
  const body = { model: mdl, max_completion_tokens: max_tokens, temperature: 0.2, messages: [{ role: 'user', content }] };
  if (/^openai\/gpt-oss/.test(mdl)) body.reasoning_effort = 'low';
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const raw = await r.text();
    if (r.status === 429 && attempt < 2) {
      const wait = Math.min(Number((r.headers && r.headers.get && r.headers.get('retry-after')) || 5), 10);
      lastErr = new Error('Groq đang giới hạn tốc độ (429).');
      await sleep(wait * 1000);
      continue;
    }
    if (!r.ok) throw new Error(`Groq API ${r.status}: ${raw.slice(0, 240)}`);
    const data = JSON.parse(raw);
    const msg = data.choices && data.choices[0] && data.choices[0].message;
    return String((msg && msg.content) || '');
  }
  throw lastErr || new Error('Groq không phản hồi.');
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
    salary: job.salary_text, summary: job.summary, responsibilities: job.responsibilities, requirements: job.requirements,
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
async function jdFromText(text) {
  const prompt = `Đọc đoạn mô tả công việc (JD) dưới đây và trả về DUY NHẤT một JSON object, không thêm chữ nào khác:
{
 "title": "tên vị trí",
 "level": "Junior | Mid | Senior | Lead | ''",
 "job_type": "Full-time | Part-time | Freelance | Contract | Internship",
 "salary_text": "mức lương nếu JD có ghi, nếu không thì ''",
 "summary": "1–2 câu tóm tắt vị trí, tiếng Việt",
 "responsibilities": "mỗi ý một dòng, tiếng Việt, không ký hiệu đầu dòng",
 "requirements": "mỗi ý một dòng, tiếng Việt, không ký hiệu đầu dòng",
 "benefits": "mỗi ý một dòng, tiếng Việt, không ký hiệu đầu dòng; '' nếu JD không nêu",
 "must_have_tech": ["công nghệ bắt buộc"],
 "nice_to_have_tech": ["công nghệ ưu tiên / là điểm cộng"],
 "domains": ["lĩnh vực dự án, ví dụ Banking, E-commerce"],
 "min_years": số năm kinh nghiệm tối thiểu (số, 0 nếu không nêu)
}
Quy tắc: KHÔNG đưa địa điểm làm việc, số lượng tuyển, tên khách hàng hay thông tin nhận diện công ty vào bất kỳ trường nào. Không bịa thông tin không có trong JD.

--- JD ---
${String(text).slice(0, 12000)}`;
  const out = await llm({ text: prompt, max_tokens: 3000, model: MODEL_FAST(), timeoutMs: 24000 });
  return extractJson(out);
}

module.exports = { llm, extractJson, cvPrompt, shapeParsed, mergeParsed, scoreBatch, jdFromText, PARSE_PROMPT, MODEL_MAIN, MODEL_FAST, MODEL_VISION };
