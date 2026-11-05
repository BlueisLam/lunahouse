'use strict';
const { esc } = require('./util');
const { BY_KEY } = require('./status');
const T = require('./tenant');

const site = () => (process.env.SITE_URL || process.env.URL || 'https://lunahouse.click').replace(/\/$/, '');

const envTag = () => (process.env.ENV_LABEL ? `[${process.env.ENV_LABEL}] ` : '');

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
async function telegram(html, chatId) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = chatId === undefined ? process.env.TELEGRAM_CHAT_ID : chatId;
  if (!token || !chat) return { skipped: 'telegram' };
  await postJson(`https://api.telegram.org/bot${token}/sendMessage`, {
    chat_id: chat, text: (envTag() ? `<b>${envTag().trim()}</b> ` : '') + html, parse_mode: 'HTML', disable_web_page_preview: true,
  });
  return { ok: true };
}

/** Địa chỉ người gửi: giữ email của MAIL_FROM, đổi tên hiển thị thành "<tên recruiter> · Luna". */
function fromAddr(name) {
  const base = process.env.MAIL_FROM || 'Luna <onboarding@resend.dev>';
  const m = base.match(/<([^>]+)>/);
  const clean = String(name || '').replace(/[<>"\r\n]/g, '').trim();
  return m && clean ? `${clean} · Luna <${m[1]}>` : base;
}

/** Gửi email qua Resend. */
async function email({ to, subject, html, replyTo, fromName }) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !to) {
    console.warn('[notify] bỏ qua email "' + subject + '": ' + (!key ? 'thiếu RESEND_API_KEY ở môi trường này' : 'không có địa chỉ người nhận (ADMIN_NOTIFY_EMAIL?)'));
    return { skipped: 'email' };
  }
  await postJson('https://api.resend.com/emails', {
    from: fromAddr(fromName),
    to: [].concat(to), subject: envTag() + subject, html,
    reply_to: replyTo || process.env.MAIL_REPLY_TO || undefined,
  }, { authorization: `Bearer ${key}` });
  console.log('[notify] đã gửi email "' + subject + '"');
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
async function notifyNewApplication({ app, cand, job, duplicate, reapply, rec }) {
  const tg = T.notifyTarget(rec);
  const link = `${site()}/admin/#/candidate/${cand.id}`;
  const lines = [
    reapply ? '🔄 <b>Nộp lại sau khi rút hồ sơ</b> (CV mới đã được lưu)' : duplicate ? '🔁 <b>Ứng viên nộp lại</b>' : '🆕 <b>Hồ sơ mới</b>',
    `<b>${esc(cand.full_name)}</b> → ${esc(job ? job.title : 'Kho tài năng (không chọn vị trí)')}`,
    `📞 ${esc(cand.phone_number)}   ✉️ ${esc(cand.email)}`,
    cand.address ? `📍 ${esc(cand.address)}` : '',
    cand.expected_salary ? `💰 ${esc(cand.expected_salary)}` : '',
    cand.notice_period ? `⏳ ${esc(cand.notice_period)}` : '',
    app.cover_note ? `💬 ${esc(app.cover_note.slice(0, 300))}` : '',
    `🔖 ${esc(app.code)}`,
    `<a href="${esc(link)}">Mở trong admin</a>`,
  ].filter(Boolean);
  const subject = `${reapply || duplicate ? 'Nộp lại' : 'Hồ sơ mới'}: ${cand.full_name} — ${job ? job.title : 'Kho tài năng'}`;
  const inner = `<p style="margin:0 0 8px;font-size:18px;font-weight:700">${esc(cand.full_name)}</p>
<p style="margin:0 0 12px;color:#403c66">${esc(job ? job.title : 'Kho tài năng')}</p>
<p style="margin:0 0 4px">📞 ${esc(cand.phone_number)}<br>✉️ ${esc(cand.email)}${cand.address ? '<br>📍 ' + esc(cand.address) : ''}${cand.expected_salary ? '<br>💰 ' + esc(cand.expected_salary) : ''}${cand.notice_period ? '<br>⏳ ' + esc(cand.notice_period) : ''}</p>
${app.cover_note ? `<p style="margin:12px 0;padding:10px 12px;background:#f4f2fb;border-radius:8px">${esc(app.cover_note)}</p>` : ''}
<p style="margin:16px 0 0">${btn(link, 'Mở hồ sơ trong admin')}</p>`;
  return settle([
    telegram(lines.join('\n'), tg.chat),
    email({ to: tg.to, subject, html: shell(inner), fromName: '' }),
  ]);
}

/** Email xác nhận cho ứng viên, kèm mã tra cứu. */
function emailReceipt({ app, cand, job, rec }) {
  const tg = T.notifyTarget(rec);
  const track = `${site()}/track?code=${encodeURIComponent(app.code)}`;
  const inner = `<p style="margin:0 0 10px;font-size:18px;font-weight:700">Mình đã nhận hồ sơ của bạn</p>
<p style="margin:0 0 6px">Chào ${esc(cand.full_name)},</p>
<p style="margin:0 0 6px">Cảm ơn bạn đã ứng tuyển <b>${esc(job ? job.title : 'vào kho tài năng của Luna')}</b>. Mình sẽ xem hồ sơ trong vòng 1–3 ngày làm việc và liên hệ nếu phù hợp.</p>
${codeBox(app.code)}
<p style="margin:0 0 16px">Dùng mã này cùng email hoặc số điện thoại bạn đã nộp để tra cứu tiến độ bất cứ lúc nào.</p>
<p style="margin:0">${btn(track, 'Tra cứu hồ sơ')}</p>`;
  return email({ to: cand.email, subject: `[${app.code}] Đã nhận hồ sơ ${job ? job.title : ''}`.trim(), html: shell(inner), replyTo: tg.replyTo, fromName: tg.name });
}

/** Email báo ứng viên khi admin đổi trạng thái (admin chủ động tick). */
function emailStatus({ app, cand, job, rec }) {
  const tg = T.notifyTarget(rec);
  const st = BY_KEY[app.status] || { pub: app.status, hint: '' };
  const track = `${site()}/track?code=${encodeURIComponent(app.code)}`;
  const inner = `<p style="margin:0 0 10px;font-size:18px;font-weight:700">${esc(st.pub)}</p>
<p style="margin:0 0 6px">Chào ${esc(cand.full_name)}, hồ sơ <b>${esc(job ? job.title : 'của bạn')}</b> vừa có cập nhật.</p>
<p style="margin:0 0 6px">${esc(st.hint)}</p>
${app.public_note ? `<p style="margin:12px 0;padding:10px 12px;background:#f4f2fb;border-radius:8px">${esc(app.public_note)}</p>` : ''}
<p style="margin:16px 0 0">${btn(track, 'Xem chi tiết')}</p>`;
  return email({ to: cand.email, subject: `[${app.code}] ${st.pub}`, html: shell(inner), replyTo: tg.replyTo, fromName: tg.name });
}


/**
 * Địa chỉ gốc để dựng link trong email. Ưu tiên host của chính request (để bản dev gửi link dev,
 * không trỏ nhầm sang production); host lạ thì dùng SITE_URL.
 */
function baseUrl(event) {
  const h = event && event.headers || {};
  const host = String(h['x-forwarded-host'] || h.host || '').toLowerCase().split(',')[0].trim();
  if (/^([a-z0-9-]+\.)*(lunahouse\.click|pages\.dev)$/.test(host)) return 'https://' + host;
  if (/^localhost(:\d+)?$/.test(host)) return 'http://' + host;
  return site();
}
const threadLink = (base, thread) => `${base}/q?t=${encodeURIComponent(thread.token)}`;
const quote = txt => `<p style="margin:12px 0;padding:10px 12px;background:#f4f2fb;border-radius:8px;white-space:pre-wrap">${esc(txt)}</p>`;

/** Ứng viên đặt câu hỏi / nhắn thêm → Telegram cho admin. */
function notifyThreadMessage({ thread, job, body, first, base, rec }) {
  const tg = T.notifyTarget(rec);
  const link = `${base || site()}/admin/#/inbox/${thread.id}`;
  return settle([telegram([
    first ? '❓ <b>Câu hỏi mới dưới job</b>' : '💬 <b>Ứng viên nhắn thêm</b>',
    `<b>${esc(thread.author_name)}</b> (${esc(thread.author_email)}) → ${esc(job ? job.title : '')}`,
    esc(String(body).slice(0, 500)),
    `<a href="${esc(link)}">Trả lời trong admin</a>`,
  ].join('\n'), tg.chat)]);
}

/** Email cho ứng viên sau khi gửi câu hỏi: kèm link riêng để xem hội thoại. */
function emailThreadReceipt({ thread, job, body, base, rec }) {
  const tg = T.notifyTarget(rec);
  const link = threadLink(base || site(), thread);
  const inner = `<p style="margin:0 0 10px;font-size:18px;font-weight:700">Mình đã nhận câu hỏi của bạn</p>
<p style="margin:0 0 6px">Chào ${esc(thread.author_name)}, bạn hỏi về vị trí <b>${esc(job ? job.title : '')}</b>:</p>
${quote(body)}
<p style="margin:0 0 6px">Mình sẽ trả lời sớm và báo bạn qua email này. Hội thoại chỉ có mình và bạn xem được, trừ khi mình đăng công khai (mình sẽ không đăng email hay số điện thoại của bạn).</p>
<p style="margin:16px 0 0">${btn(link, 'Xem hội thoại của bạn')}</p>`;
  return email({ to: thread.author_email, subject: `Đã nhận câu hỏi về ${job ? job.title : 'vị trí'}`, html: shell(inner), replyTo: tg.replyTo, fromName: tg.name });
}

/** Email báo ứng viên khi recruiter trả lời. */
function emailThreadReply({ thread, job, body, base, rec }) {
  const tg = T.notifyTarget(rec);
  const link = threadLink(base || site(), thread);
  const inner = `<p style="margin:0 0 10px;font-size:18px;font-weight:700">Mình đã trả lời câu hỏi của bạn</p>
<p style="margin:0 0 6px">Chào ${esc(thread.author_name)}, về vị trí <b>${esc(job ? job.title : '')}</b>:</p>
${quote(body)}
<p style="margin:16px 0 0">${btn(link, 'Xem và trả lời tiếp')}</p>`;
  return email({ to: thread.author_email, subject: `${tg.name || 'Luna'} đã trả lời câu hỏi về ${job ? job.title : 'vị trí'}`, html: shell(inner), replyTo: tg.replyTo, fromName: tg.name });
}

/** Có người đăng ký recruiter mới → báo tài khoản chủ để duyệt. */
async function notifyNewRecruiter(rec, base) {
  const owner = T.notifyTarget(null);
  const link = `${base || site()}/admin/#/recruiters`;
  const inner = `<p style="margin:0 0 8px;font-size:18px;font-weight:700">Có recruiter mới chờ duyệt</p>
<p style="margin:0 0 12px"><b>${esc(rec.display_name)}</b> (${esc(rec.email)})<br>Đường dẫn: /${esc(rec.handle)}</p>
<p style="margin:16px 0 0">${btn(link, 'Mở danh sách recruiter')}</p>`;
  return settle([
    telegram(`🧑‍💼 <b>Recruiter mới chờ duyệt</b>\n${esc(rec.display_name)} (${esc(rec.email)}) → /${esc(rec.handle)}\n<a href="${esc(link)}">Duyệt trong admin</a>`, owner.chat),
    email({ to: owner.to, subject: `Recruiter mới chờ duyệt: ${rec.display_name}`, html: shell(inner) }),
  ]);
}

/** Báo cho recruiter biết tài khoản đã được duyệt. */
function emailRecruiterApproved(rec, base) {
  const b = base || site();
  const inner = `<p style="margin:0 0 10px;font-size:18px;font-weight:700">Tài khoản của bạn đã được duyệt</p>
<p style="margin:0 0 6px">Chào ${esc(rec.display_name)}, bạn có thể đăng nhập, đăng job và nhận hồ sơ ngay bây giờ.</p>
<p style="margin:0 0 6px">Mình tặng bạn <b>1 tháng gói Pro</b> để dùng thử đầy đủ tính năng.</p>
<p style="margin:0 0 14px">Trang công khai của bạn: <b>${esc(b.replace(/^https?:\/\//, ''))}/${esc(rec.handle)}</b></p>
<p style="margin:0">${btn(b + '/admin/', 'Đăng nhập')}</p>`;
  return email({ to: rec.email, subject: 'Tài khoản Luna của bạn đã được duyệt', html: shell(inner) });
}

/** Email đặt lại mật khẩu. */
function emailPasswordReset(rec, link) {
  const inner = `<p style="margin:0 0 10px;font-size:18px;font-weight:700">Đặt lại mật khẩu</p>
<p style="margin:0 0 14px">Chào ${esc(rec.display_name)}, bấm nút dưới để đặt mật khẩu mới. Link dùng được một lần và sẽ hết hạn sau ít phút. Nếu bạn không yêu cầu, cứ bỏ qua email này.</p>
<p style="margin:0">${btn(link, 'Đặt mật khẩu mới')}</p>`;
  return email({ to: rec.email, subject: 'Đặt lại mật khẩu Luna', html: shell(inner) });
}

module.exports = { notifyNewRecruiter, emailRecruiterApproved, emailPasswordReset, baseUrl, threadLink, notifyThreadMessage, emailThreadReceipt, emailThreadReply, telegram, email, settle, notifyNewApplication, emailReceipt, emailStatus, site };
