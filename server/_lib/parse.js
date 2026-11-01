'use strict';
/** Đọc CV của một ứng viên bằng Claude rồi ghi kỹ năng, năm kinh nghiệm, domain... vào lh_candidates. */
const { sb, must, BUCKET } = require('./db');
const AI = require('./ai');
const U = require('./util');

async function parseCandidate(id) {
  const db = sb();
  try {
    const cand = must(await db.from('lh_candidates').select('*').eq('id', id).maybeSingle(), 'cand');
    if (!cand || !cand.cv_path) throw new Error('Hồ sơ chưa có file CV.');
    must(await db.from('lh_candidates').update({ parse_status: 'pending', parse_error: '' }).eq('id', id), 'pending');

    const dl = await db.storage.from(BUCKET).download(cand.cv_path);
    if (dl.error) throw new Error('Không tải được file CV: ' + dl.error.message);
    const buffer = Buffer.from(await dl.data.arrayBuffer());
    const kind = U.sniffFile(buffer);
    if (!kind) throw new Error('Không nhận diện được định dạng file CV.');

    let docxText = '', url = '';
    if (kind === 'docx') {
      const mammoth = require('mammoth');
      docxText = (await mammoth.extractRawText({ buffer })).value;
      if (!docxText.trim()) throw new Error('File DOCX không có nội dung văn bản.');
    } else {
      const s = await db.storage.from(BUCKET).createSignedUrl(cand.cv_path, 600);
      url = (s && s.data && (s.data.signedUrl || s.data.signedURL)) || '';
    }

    let text;
    try {
      text = await AI.claude({ content: AI.cvContent({ buffer, kind, docxText, url }), max_tokens: 3000, model: AI.MODEL_MAIN() });
    } catch (e) {
      if (!url) throw e;
      // Claude không tải được link → gửi thẳng file (base64)
      text = await AI.claude({ content: AI.cvContent({ buffer, kind, docxText }), max_tokens: 3000, model: AI.MODEL_MAIN() });
    }
    const parsed = AI.shapeParsed(AI.extractJson(text));
    const merged = AI.mergeParsed(cand, parsed);

    // Admin tải CV lên → có thể trùng người đã có trong kho: đánh dấu để gộp, không tự xoá gì.
    let dup_of = null;
    if (cand.source === 'admin') {
      const em = (merged.email || '').toLowerCase(), ph = U.phoneNorm(merged.phone_number);
      let other = null;
      if (em) other = must(await db.from('lh_candidates').select('id').eq('email_norm', em).limit(2), 'dup email').find(x => x.id !== id);
      if (!other && ph.length === 9) other = must(await db.from('lh_candidates').select('id').eq('phone_norm', ph).limit(2), 'dup phone').find(x => x.id !== id);
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
