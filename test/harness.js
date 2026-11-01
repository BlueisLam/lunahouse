'use strict';
/** Dựng môi trường giả: DB trong bộ nhớ + fetch giả cho Telegram / Resend / Claude. Dùng chung cho test và dev-server. */
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-test-secret-test-secret-1234';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'correct horse battery staple';
process.env.TELEGRAM_BOT_TOKEN = '123:fake';
process.env.TELEGRAM_CHAT_ID = '999';
process.env.RESEND_API_KEY = 're_fake';
process.env.ADMIN_NOTIFY_EMAIL = 'admin@example.com';
process.env.GROQ_API_KEY = "gsk_fake";
process.env.SITE_URL = process.env.SITE_URL || 'http://localhost:8888';

const { FakeDB } = require('./fake-supabase');
const fake = new FakeDB();

const dbPath = require.resolve('../server/_lib/db.js');
const realDb = require(dbPath);
require.cache[dbPath].exports = { ...realDb, sb: () => fake };

const calls = [];
const state = { cv: null, failParse: false };

const DEFAULT_CV = {
  full_name: 'TÊN DO AI ĐỌC', date_of_birth: '1998', address: 'Hồ Chí Minh', phone_number: '0900000000', email: 'ai@example.com',
  gender: 'Male', positions: ['Backend Developer', 'Team Lead'], english_level: 'IELTS 6.5', total_years_experience: 6,
  years_experience_by_role: { backend: 6, team_lead: 2 }, project_domains: ['Banking', 'E-commerce'],
  technologies: ['Java', 'Spring Boot', 'PostgreSQL', 'Kafka', 'AWS'], expected_salary: '', notice_period: '', job_type_preference: 'Full-time',
  headline: 'Backend Java 6 năm, mạnh mảng Banking', cv_text: 'Nội dung CV mẫu…',
};

const real = global.fetch;
const resp = (status, body) => ({ ok: status < 400, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)), json: async () => body });

function claudeReply(body) {
  const c = body.messages[0].content;
  const text = typeof c === 'string' ? c : c.map(b => b.text || '').join('\n');
  if (text.includes('You are a CV parser')) {
    if (state.failParse) return null;
    return JSON.stringify(state.cv || DEFAULT_CV);
  }
  if (text.includes('Chấm độ phù hợp') || text.includes('Chấm độ phù hợp'.toLowerCase())) {
    const ids = [...text.matchAll(/"candidate_id":"([^"]+)"/g)].map(m => m[1]);
    return JSON.stringify(ids.map((id, i) => ({ candidate_id: id, score: 90 - i * 15, strengths: 'Mạnh về Java và Banking.', gaps: 'Chưa có Kafka production.' })));
  }
  if (text.includes('Đọc đoạn mô tả công việc')) {
    return '```json\n' + JSON.stringify({ title: 'Senior Java Developer', level: 'Senior', job_type: 'Full-time', salary_text: '45–70 triệu', location: 'Hồ Chí Minh', summary: 'Phát triển hệ thống core banking.', responsibilities: 'Thiết kế API\nReview code', requirements: '5+ năm Java\nSpring Boot', benefits: 'Bảo hiểm cao cấp', must_have_tech: ['Java', 'Spring Boot'], nice_to_have_tech: ['Kafka'], domains: ['Banking'], min_years: 5 }) + '\n```';
  }
  return '{}';
}

global.fetch = async (url, opts = {}) => {
  url = String(url);
  const body = opts.body ? JSON.parse(opts.body) : null;
  if (/telegram|resend|groq/.test(url)) calls.push({ url, body, headers: opts.headers });
  if (url.includes('api.telegram.org')) return resp(200, { ok: true });
  if (url.includes('api.resend.com')) return resp(200, { id: 'email_1' });
  if (url.includes('api.groq.com')) {
    const t = claudeReply(body);
    if (t === null) return resp(500, { error: 'boom' });
    return resp(200, { choices: [{ message: { role: 'assistant', content: t } }] });
  }
  return real(url, opts);
};

/** Gọi một handler như adapter Cloudflare sẽ gọi. */
const CV_TEXT = 'Nguyễn Văn An — Backend Developer. 6 năm kinh nghiệm Java, Spring Boot, PostgreSQL, Kafka. Dự án Banking và E-commerce. '.repeat(3);
async function invoke(mod, { method = 'POST', body, form, headers = {}, query } = {}) {
  const event = { httpMethod: method, headers: { host: 'localhost:8888', ...headers }, body: body === undefined ? '' : JSON.stringify(body), queryStringParameters: query || null, form: form || null };
  const r = await mod.handler(event, {});
  let json = null; try { json = JSON.parse(r.body); } catch {}
  return { status: r.statusCode, json, headers: r.headers || {}, raw: r };
}

const F = n => require('../server/' + n);
const fakePdf = (extra = '') => Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n' + extra + '\n%%EOF').toString('base64');

module.exports = { CV_TEXT, fake, calls, state, invoke, F, fakePdf, DEFAULT_CV };
