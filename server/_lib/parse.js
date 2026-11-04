'use strict';
/**
 * Đọc CV của một ứng viên bằng AI (Groq) rồi ghi kỹ năng, năm kinh nghiệm, domain... vào lh_candidates.
 * Groq chỉ nhận chữ, nên:
 *  - DOCX: bóc chữ ngay tại server (mammoth).
 *  - PDF: trình duyệt admin bóc chữ rồi gửi lên (opts.text).
 *  - Ảnh / PDF scan: gửi ảnh (opts.images) nếu có đặt GROQ_VISION_MODEL, không thì báo lỗi rõ ràng.
 */
const { sb, must, BUCKET } = require('./db');
const AI = require('./ai');
const U = require('./util');

async function parseCandidate(id, opts = {}) {
  const db = sb();
  try {
    const cand = must(await db.from('lh_candidates').select('*').eq('id', id).maybeSingle(), 'cand');
    if (!cand || !cand.cv_path) throw new Error('Hồ sơ chưa có file CV.');
    must(await db.from('lh_candidates').update({ parse_status: 'pending', parse_error: '' }).eq('id', id), 'pending');

    let text = String(opts.text || '').trim();
    const images = (Array.isArray(opts.images) ? opts.images : []).filter(u => /^data:image\/(png|jpeg);base64,/.test(u)).slice(0, 3);

    if (text.length < 80 && !images.length) {
      // Không có chữ từ trình duyệt → thử DOCX ở server
      const dl = await db.storage.from(BUCKET).download(cand.cv_path);
      if (dl.error) throw new Error('Không tải được file CV: ' + dl.error.message);
      const buffer = Buffer.from(await dl.data.arrayBuffer());
      const kind = U.sniffFile(buffer);
      if (kind === 'docx') {
        const mammoth = require('mammoth');
        // Cloudflare dùng bản mammoth cho trình duyệt (chỉ nhận arrayBuffer), Node dùng bản chỉ nhận buffer: đưa cả hai.
        const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        text = String((await mammoth.extractRawText({ buffer, arrayBuffer })).value || '').trim();
        if (!text) throw new Error('File DOCX không có nội dung văn bản.');
      } else {
        throw new Error('Chưa lấy được chữ từ CV. Hãy mở trang admin trên trình duyệt để đọc PDF, hoặc dùng file PDF/DOCX có chữ (không phải ảnh chụp).');
      }
    }

    let out;
    if (text.length >= 80) {
      out = await AI.llm({ text: AI.cvPrompt(text), max_tokens: 4500, model: AI.MODEL_MAIN() });
    } else {
      if (!AI.canSeeImages()) throw new Error('CV này là ảnh/bản scan, mà chưa đặt GEMINI_API_KEY hoặc GROQ_VISION_MODEL nên AI không đọc được. Dùng PDF có chữ, hoặc nhập tay thông tin.');
      out = await AI.llm({ text: AI.PARSE_PROMPT, images, max_tokens: 4500, model: AI.MODEL_VISION() || undefined });
    }
    const parsed = AI.shapeParsed(AI.extractJson(out));
    const merged = AI.mergeParsed(cand, parsed);

    // Admin tải CV lên → có thể trùng người đã có trong kho: đánh dấu để gộp, không tự xoá gì.
    let dup_of = null;
    if (cand.source === 'admin') {
      const em = (merged.email || '').toLowerCase(), ph = U.phoneNorm(merged.phone_number);
      let other = null;
      if (em) other = must(await db.from('lh_candidates').select('id').eq('recruiter_id', cand.recruiter_id).eq('email_norm', em).limit(2), 'dup email').find(x => x.id !== id);
      if (!other && ph.length === 9) other = must(await db.from('lh_candidates').select('id').eq('recruiter_id', cand.recruiter_id).eq('phone_norm', ph).limit(2), 'dup phone').find(x => x.id !== id);
      if (other) dup_of = other.id;
    }

    must(await db.from('lh_candidates').update({ ...merged, dup_of, parse_status: 'done', parse_error: '' }).eq('id', id), 'save parsed');
    return { ok: true, status: 'done' };
  } catch (e) {
    console.error('[parse]', id, e.message);
    try { await db.from('lh_candidates').update({ parse_status: 'failed', parse_error: String(e.message).slice(0, 300) }).eq('id', id); } catch {}
    return { ok: false, status: 'failed', error: String(e.message).slice(0, 300) };
  }
}

module.exports = { parseCandidate };
