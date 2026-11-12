/* Xuất JD ra PDF: dựng một trang in gọn trong iframe ẩn rồi mở hộp thoại in (chọn "Lưu thành PDF").
   Dùng chung cho trang job công khai và trang admin. Font hệ thống nên tiếng Việt luôn đúng dấu. */
(function () {
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var lines = function (t) { return String(t || '').split(/\r?\n/).map(function (x) { return x.replace(/^\s*[-•*–·]\s*/, '').trim(); }).filter(Boolean); };
  var list = function (t) { var a = lines(t); return a.length ? '<ul>' + a.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : ''; };
  var chips = function (a) { return (a || []).length ? '<div class="chips">' + a.map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('') + '</div>' : ''; };

  var CSS = '@page{size:A4;margin:16mm 16mm 18mm}*{box-sizing:border-box}html{-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    'body{margin:0;font:13.5px/1.55 -apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color:#1a1740}' +
    '.top{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #1a1740;padding-bottom:8px;margin-bottom:18px;font-size:12px;color:#5b5880}.top b{color:#1a1740;font-size:14px;letter-spacing:.02em}' +
    '.tag{display:inline-block;background:#ece9ff;color:#4a3fd0;border-radius:99px;padding:2px 11px;font-size:12px;font-weight:700;margin-right:6px}' +
    'h1{font-size:25px;line-height:1.2;margin:10px 0 8px}.meta{color:#5b5880;margin-bottom:6px}.meta span+span:before{content:"·";margin:0 8px}' +
    'h2{font-size:14px;text-transform:uppercase;letter-spacing:.06em;color:#4a3fd0;margin:20px 0 6px;break-after:avoid}section{break-inside:avoid-page}' +
    'p{margin:0 0 8px}ul{margin:0;padding-left:20px}li{margin:0 0 4px}.sum{font-size:15px;margin-top:12px}' +
    '.chips{display:flex;flex-wrap:wrap;gap:6px}.chips span{border:1px solid #cfcbe8;border-radius:6px;padding:2px 9px;font:12px ui-monospace,Menlo,Consolas,monospace}' +
    '.foot{margin-top:26px;padding-top:10px;border-top:1px solid #d9d6ee;color:#5b5880;font-size:12px}.foot a{color:#4a3fd0;text-decoration:none}';

  function html(j, o) {
    o = o || {};
    var en = j.lang === 'en', t = function (v, e) { return en ? e : v; };
    var years = Number(j.min_years) ? (en ? j.min_years + '+ years of experience' : 'Từ ' + j.min_years + ' năm kinh nghiệm') : '';
    var meta = [j.job_type || 'Full-time', j.salary_text || t('Thoả thuận', 'Negotiable'), j.location, years].filter(Boolean);
    var sec = function (h, body) { return body ? '<section><h2>' + h + '</h2>' + body + '</section>' : ''; };
    var levels = String(j.level || '').split(/\s*,\s*/).filter(Boolean);
    var title = 'JD - ' + (j.title || 'Job');
    return '<!doctype html><html lang="' + (en ? 'en' : 'vi') + '"><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>' + CSS + '</style></head><body>' +
      '<div class="top"><b>' + esc(o.brand || 'Luna') + '</b><span>' + t('Mô tả công việc', 'Job description') + '</span></div>' +
      levels.map(function (l) { return '<span class="tag">' + esc(l) + '</span>'; }).join('') +
      '<h1>' + esc(j.title) + '</h1><div class="meta">' + meta.map(function (m) { return '<span>' + esc(m) + '</span>'; }).join('') + '</div>' +
      (j.summary ? '<p class="sum">' + esc(j.summary) + '</p>' : '') +
      sec(t('Bạn sẽ làm gì', 'What you will do'), list(j.responsibilities)) +
      sec(t('Bạn cần có', 'What you need'), list(j.requirements)) +
      sec(t('Công nghệ chính', 'Main tech'), chips(j.must_have_tech)) +
      sec(t('Là điểm cộng', 'Nice to have'), chips(j.nice_to_have_tech)) +
      sec(t('Lĩnh vực', 'Domain'), (j.domains || []).length ? '<p>' + esc((j.domains || []).join(', ')) + '</p>' : '') +
      sec(t('Quyền lợi', 'Benefits'), list(j.benefits)) +
      sec(t('Cách làm việc', 'How we work'), '<ul><li>' + t('Giờ làm việc 9:00–18:00, thứ Hai đến thứ Sáu.', 'Working hours 9:00–18:00, Monday to Friday.') + '</li></ul>') +
      '<div class="foot">' + (o.url ? t('Ứng tuyển: ', 'Apply: ') + '<a href="' + esc(o.url) + '">' + esc(o.url) + '</a>' : '') + '</div></body></html>';
  }

  /** Mở hộp thoại in cho JD này. Trả về false nếu trình duyệt chặn. */
  function print(j, o) {
    var f = document.createElement('iframe');
    f.setAttribute('aria-hidden', 'true'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0';
    var done = function () { setTimeout(function () { if (f.parentNode) f.parentNode.removeChild(f); }, 60000); };
    f.onload = function () {
      try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { /* bỏ qua */ }
      done();
    };
    f.srcdoc = html(j, o);
    document.body.appendChild(f);
    return true;
  }
  window.LunaJD = { html: html, print: print };
})();
