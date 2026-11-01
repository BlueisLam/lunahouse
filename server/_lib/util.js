'use strict';
const crypto = require('crypto');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // bỏ I, L, O, 0, 1 cho đỡ nhầm

function genCode() {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return 'LH-' + s;
}

/** Chuẩn hoá mã người dùng gõ: "lh 7k3q9x", "LH-7K3Q9X", "7k3q9x" → "LH-7K3Q9X". Sai định dạng → "". */
function normCode(v) {
  const s = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.length === 6) return 'LH-' + s;
  if (s.length === 8 && s.startsWith('LH')) return 'LH-' + s.slice(2);
  return '';
}

/** Bỏ dấu tiếng Việt, hạ chữ thường — dùng cho tìm kiếm và so khớp. */
function norm(s) {
  return String(s == null ? '' : s).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').trim();
}

const digits = s => String(s == null ? '' : s).replace(/\D/g, '');
/** 9 số cuối: so khớp được cả "0901234567" lẫn "+84 901 234 567". */
const phoneNorm = s => digits(s).slice(-9);

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Cắt độ dài, bỏ ký tự điều khiển. */
function clean(s, max = 200) {
  return String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
}

/** "A; B, C\nD" hoặc ["A"," B"] → ["A","B","C","D"] (bỏ trùng không phân biệt hoa thường). */
function toArr(v, maxItems = 80) {
  const raw = Array.isArray(v) ? v : String(v == null ? '' : v).split(/[;,\n]/);
  const seen = new Set(), out = [];
  for (const x of raw) {
    const t = clean(x, 80);
    const k = t.toLowerCase();
    if (t && !seen.has(k)) { seen.add(k); out.push(t); }
    if (out.length >= maxItems) break;
  }
  return out;
}

function slugify(s) {
  return norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'job';
}

const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function json(status, body, headers) {
  return {
    statusCode: status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...(headers || {}) },
    body: JSON.stringify(body),
  };
}

function parseBody(event, maxChars = 8_000_000) {
  let raw = event.body || '';
  if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
  if (raw.length > maxChars) throw new HttpError(413, 'Dữ liệu gửi lên quá lớn.');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new HttpError(400, 'Dữ liệu không hợp lệ.'); }
}

/**
 * Đọc dữ liệu gửi lên: JSON, hoặc multipart/form-data (event.form do adapter Cloudflare dựng sẵn).
 * Trả về object trường; file (nếu có) nằm ở b[fileField] = { name, buffer }.
 * JSON cũ vẫn dùng được: { cv: { name, data(base64) } }.
 */
async function readInput(event, { fileField, maxChars = 8_000_000 } = {}) {
  if (event.form) {
    const b = {};
    for (const [k, v] of event.form.entries()) {
      if (typeof v === 'string') b[k] = v;
      else if (k === fileField) b[k] = { name: v.name, buffer: Buffer.from(await v.arrayBuffer()) };
    }
    if (b.consent !== undefined) b.consent = b.consent === 'true' || b.consent === '1' || b.consent === 'on';
    return b;
  }
  const b = parseBody(event, maxChars);
  const f = b[fileField];
  if (fileField && f && typeof f.data === 'string') b[fileField] = { name: f.name, buffer: Buffer.from(f.data, 'base64') };
  else if (fileField && fileField === 'file' && typeof b.data === 'string') b.file = { name: b.name, buffer: Buffer.from(b.data, 'base64') };
  return b;
}

function clientIp(event) {
  const h = event.headers || {};
  return h['cf-connecting-ip'] || (h['x-forwarded-for'] || '').split(',')[0].trim() || '0.0.0.0';
}

/** Bọc handler: HttpError → JSON lỗi đúng mã; lỗi lạ → 500 chung chung (không lộ chi tiết). */
function wrap(fn) {
  return async (event, context) => {
    try { return await fn(event, context); }
    catch (e) {
      if (e instanceof HttpError) return json(e.status, { error: e.message });
      console.error(e);
      return json(500, { error: 'Có lỗi hệ thống, bạn thử lại sau ít phút nhé.' });
    }
  };
}

/** Nhận diện loại file qua byte đầu (không tin đuôi file / content-type do client gửi). */
function sniffFile(buf) {
  if (!buf || buf.length < 8) return null;
  // PDF chuẩn cho phép có vài byte rác (BOM, xuống dòng...) trước "%PDF-" trong 1024 byte đầu.
  if (buf.subarray(0, 1024).includes(Buffer.from('%PDF-'))) return 'pdf';
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return 'docx';
  if (buf[0] === 0x89 && buf.slice(1, 4).toString() === 'PNG') return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  return null;
}
const MIME = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', png: 'image/png', jpg: 'image/jpeg' };

module.exports = {
  HttpError, genCode, normCode, norm, digits, phoneNorm, esc, clean, toArr, slugify,
  sha256, sleep, json, parseBody, readInput, clientIp, wrap, sniffFile, MIME,
};
