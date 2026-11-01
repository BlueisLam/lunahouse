'use strict';
const { esc } = require('./util');
const { BY_KEY } = require('./status');

const site = () => (process.env.SITE_URL || process.env.URL || 'https://lunahouse.click').replace(/\/$/, '');

async function postJson(url, body, headers) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(headers || {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(7000),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${new URL(url).host} ${r.status} ${text.slice(0, 200)}`);
  return text;
}

/** Gửi Telegram (HTML). Thiếu cấu hình thì bỏ qua, không làm hỏng luồng chính. */
async function telegram(html) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return { skipped: 'telegram' };
  await postJson(`https://api.telegram.org/bot${token}/sendMessage`, {
    chat_id: chat, text: html, parse_mode: 'HTML', disable_web_page_preview: true,
  });
  return { ok: true };
}

/** Gửi email qua Resend. */
async function email({ to, subject, html }) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !to) return { skipped: 'email' };
  await postJson('https://api.resend.com/emails', {
    from: process.env.MAIL_FROM || 'Luna <onboarding@resend.dev>',
    to: [].concat(to), subject, html,
    reply_to: process.env.MAIL_REPLY_TO || undefined,
  }, { authorization: `Bearer ${key}` });
  return { ok: true };
}

/** Chạy nhiều tác vụ thông báo song song, lỗi cái nào chỉ log cái đó. */
async function settle(tasks) {
  const res = await Promise.allSettled(tasks);
  res.forEach(r => { if (r.status === 'rejected') console.error('[notify]', r.reason && r.reason.message); });
  return res;
}

// ---------- Mẫu email ----------
function shell(inner) {
  return `<!doctype html><html><body style="margin:0;background:#f4f2fb;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#17143a;line-height:1.55">
<table role="presentation" width="100%" style="max-width:560px;margin:0 auto"><tr><td style="padding:0 4px 14px;font-weight:700;font-size:16px">&#127769; Luna</td></tr>
<tr><td style="background:#fff;border:1px solid #dedaf0;border-radius:12px;padding:24px">${inner}</td></tr>
<tr><td style="padding:14px 4px;color:#7a77a0;font-size:12px">Email tự động từ ${esc(site().replace(/^https?:\/\//, ''))}. Bạn có thể trả lời trực tiếp email này.</td></tr></table></body></html>`;
}
const codeBox = code => `<div style="margin:16px 0;padding:14px 16px;background:#f4f2fb;border:1px dashed #b9b3e6;border-radius:10px;text-align:center">
<div style="font-size:12px;color:#7a77a0;letter-spacing:.08em">MÃ HỒ SƠ</div>
<div style="font-family:Consolas,Menlo,monospace;font-size:26px;font-weight:700;letter-spacing:.12em">${esc(code)}</div></div>`;
const btn = (href, text) => `<a href="${esc(href)}" style="display:inline-block;background:#4b3fd1;color:#fff;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:8px">${esc(text)}</a>`;

/** Có hồ sơ mới → Telegram + email cho admin. */
async function notifyNewApplication({ app, cand, job, duplicate }) {
  const link = `${site()}/admin/#/candidate/${cand.id}`;
  const lines = [
    duplicate ? '🔁 <b>Ứng viên nộp lại</b>' : '🆕 <b>Hồ sơ mới</b>',
    `<b>${esc(cand.full_name)}</b> → ${esc(job ? job.title : 'Kho tài năng (không chọn vị trí)')}`,
    `📞 ${esc(cand.phone_number)}   ✉️ ${esc(cand.email)}`,
    cand.address ? `📍 ${esc(cand.address)}` : '',
    cand.expected_salary ? `💰 ${esc(cand.expected_salary)}` : '',
    cand.notice_period ? `⏳ ${esc(cand.notice_period)}` : '',
    app.cover_note ? `💬 ${esc(app.cover_note.slice(0, 300))}` : '',
    `🔖 ${esc(app.code)}`,
    `<a href="${esc(link)}">Mở trong admin</a>`,
  ].filter(Boolean);
  const subject = `${duplicate ? 'Nộp lại' : 'Hồ sơ mới'}: ${cand.full_name} — ${job ? job.title : 'Kho tài năng'}`;
  const inner = `<p style="margin:0 0 8px;font-size:18px;font-weight:700">${esc(cand.full_name)}</p>
<p style="margin:0 0 12px;color:#403c66">${esc(job ? job.title : 'Kho tài năng')}</p>
<p style="margin:0 0 4px">📞 ${esc(cand.phone_number)}<br>✉️ ${esc(cand.email)}${cand.address ? '<br>📍 ' + esc(cand.address) : ''}${cand.expected_salary ? '<br>💰 ' + esc(cand.expected_salary) : ''}${cand.notice_period ? '<br>⏳ ' + esc(cand.notice_period) : ''}</p>
${app.cover_note ? `<p style="margin:12px 0;padding:10px 12px;background:#f4f2fb;border-radius:8px">${esc(app.cover_note)}</p>` : ''}
<p style="margin:16px 0 0">${btn(link, 'Mở hồ sơ trong admin')}</p>`;
  return settle([
    telegram(lines.join('\n')),
    email({ to: process.env.ADMIN_NOTIFY_EMAIL, subject, html: shell(inner) }),
  ]);
}

/** Email xác nhận cho ứng viên, kèm mã tra cứu. */
function emailReceipt({ app, cand, job }) {
  const track = `${site()}/track?code=${encodeURIComponent(app.code)}`;
  const inner = `<p style="margin:0 0 10px;font-size:18px;font-weight:700">Mình đã nhận hồ sơ của bạn</p>
<p style="margin:0 0 6px">Chào ${esc(cand.full_name)},</p>
<p style="margin:0 0 6px">Cảm ơn bạn đã ứng tuyển <b>${esc(job ? job.title : 'vào kho tài năng của Luna')}</b>. Mình sẽ xem hồ sơ trong vòng 1–3 ngày làm việc và liên hệ nếu phù hợp.</p>
${codeBox(app.code)}
<p style="margin:0 0 16px">Dùng mã này cùng email hoặc số điện thoại bạn đã nộp để tra cứu tiến độ bất cứ lúc nào.</p>
<p style="margin:0">${btn(track, 'Tra cứu hồ sơ')}</p>`;
  return email({ to: cand.email, subject: `[${app.code}] Đã nhận hồ sơ ${job ? job.title : ''}`.trim(), html: shell(inner) });
}

/** Email báo ứng viên khi admin đổi trạng thái (admin chủ động tick). */
function emailStatus({ app, cand, job }) {
  const st = BY_KEY[app.status] || { pub: app.status, hint: '' };
  const track = `${site()}/track?code=${encodeURIComponent(app.code)}`;
  const inner = `<p style="margin:0 0 10px;font-size:18px;font-weight:700">${esc(st.pub)}</p>
<p style="margin:0 0 6px">Chào ${esc(cand.full_name)}, hồ sơ <b>${esc(job ? job.title : 'của bạn')}</b> vừa có cập nhật.</p>
<p style="margin:0 0 6px">${esc(st.hint)}</p>
${app.public_note ? `<p style="margin:12px 0;padding:10px 12px;background:#f4f2fb;border-radius:8px">${esc(app.public_note)}</p>` : ''}
<p style="margin:16px 0 0">${btn(track, 'Xem chi tiết')}</p>`;
  return email({ to: cand.email, subject: `[${app.code}] ${st.pub}`, html: shell(inner) });
}

module.exports = { telegram, email, settle, notifyNewApplication, emailReceipt, emailStatus, site };
