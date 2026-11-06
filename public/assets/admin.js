/* Luna admin — kho CV, jobs, pipeline, matching */
(function () {
  'use strict';
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  };
  var norm = function (s) { return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').trim(); };
  var TERM = ['hired', 'rejected', 'withdrawn'];
  var MAX_CV = 4 * 1024 * 1024;

  var S = {
    jobs: [], cands: [], apps: [], stages: [], ST: {}, tab: 'overview', open: null,
    f: { q: '', tech: [], dom: [], minY: '', openOnly: false, sort: 'new', techLimit: 12, domLimit: 8 },
    pjob: '', pollN: 0, pollT: null, unread: 0, threads: [], plan: null, me: null, viewing: null, as: store('lh_as'), recs: [],
  };
  function store(k, v) { try { if (v === undefined) return sessionStorage.getItem(k) || ''; if (v) sessionStorage.setItem(k, v); else sessionStorage.removeItem(k); } catch (e) {} return v || ''; }
  var VIEWS = {};
  var NAV = [['overview', 'Tổng quan', '◧'], ['candidates', 'Ứng viên', '▤'], ['pipeline', 'Pipeline', '◈'], ['jobs', 'Việc làm', '▦'], ['matching', 'Matching', '◎'], ['report', 'Báo cáo', '▥'], ['inbox', 'Hỏi đáp', '✉']];

  function navList() {
    var l = NAV.concat([['settings', 'Cài đặt', '⚙']]);
    if (S.me && S.me.role === 'admin') l.push(['recruiters', 'Recruiter', '☷']);
    return l;
  }

  /* ---------- tiện ích ---------- */
  function api(action, data) {
    return fetch('/api/admin', { method: 'POST', headers: { 'content-type': 'application/json', 'x-lh': '1' }, body: JSON.stringify(Object.assign({ action: action }, data || {}, S.as ? { as: S.as } : {})) })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (r.status === 401) { showLogin(); throw new Error('Phiên đăng nhập đã hết, bạn đăng nhập lại nhé.'); }
          if (!r.ok) throw new Error(j.error || 'Có lỗi xảy ra.');
          return j;
        });
      });
  }
  function apiForm(fd) {
    if (S.as) fd.append('as', S.as);
    return fetch('/api/admin', { method: 'POST', headers: { 'x-lh': '1' }, body: fd }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401) { showLogin(); throw new Error('Phiên đăng nhập đã hết, bạn đăng nhập lại nhé.'); }
        if (!r.ok) throw new Error(j.error || 'Có lỗi xảy ra.');
        return j;
      });
    });
  }
  (function () {
    var h = location.hostname;
    if (/\.pages\.dev$/.test(h) && h.split('.').length > 3) document.addEventListener('DOMContentLoaded', function () {
      var d = document.createElement('div'); d.className = 'devstrip'; d.textContent = 'DEV · bản thử nghiệm, không phải trang thật';
      document.body.insertBefore(d, document.body.firstChild);
    });
  })();
  var toastT;
  function toast(m, err) {
    var t = $('.admtoast'); if (t) t.remove();
    t = document.createElement('div'); t.className = 'admtoast' + (err ? ' err' : ''); t.textContent = m; document.body.appendChild(t);
    clearTimeout(toastT); toastT = setTimeout(function () { t.remove(); }, err ? 5500 : 2600);
  }
  function fail(e) { toast(e.message || 'Có lỗi xảy ra.', true); }
  function dt(iso) {
    var d = new Date(iso); if (isNaN(d)) return '';
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function ago(iso) {
    var s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 90) return 'vừa xong'; if (s < 3600) return Math.round(s / 60) + ' phút'; if (s < 86400) return Math.round(s / 3600) + ' giờ'; return Math.round(s / 86400) + ' ngày';
  }
  function todayISO() { var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
  function plusDays(n) { var d = new Date(); d.setDate(d.getDate() + n); var p = function (x) { return (x < 10 ? '0' : '') + x; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
  function shortDate(iso) { var m = /^\d{4}-(\d{2})-(\d{2})/.exec(iso || ''); return m ? m[2] + '/' + m[1] : ''; }
  function copy(text, btn) {
    var done = function () { if (btn) { var o = btn.textContent; btn.textContent = 'Đã chép'; setTimeout(function () { btn.textContent = o; }, 1500); } };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, done);
    else { var t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch (e) {} t.remove(); done(); }
  }
  function setHash(h) { try { history.replaceState(null, '', '#/' + h); } catch (e) {} }
  function stLabel(k) { return (S.ST[k] || {}).label || k; }
  function stClass(k) { return 's-' + k; }
  function prep(c) {
    c.positions = c.positions || []; c.technologies = c.technologies || []; c.project_domains = c.project_domains || [];
    c._t = c.technologies.map(norm); c._d = c.project_domains.map(norm);
    c._h = norm([c.full_name, c.email, c.phone_number, c.address, c.headline, c.positions.join(' '), c.technologies.join(' '), c.project_domains.join(' ')].join(' '));
    return c;
  }
  function jobTitle(id) { var j = S.jobs.filter(function (x) { return x.id === id; })[0]; return j ? j.title : ''; }
  /* Hồ sơ "Kho tài năng" (không gắn job) chỉ là pool, không đi qua pipeline. */
  function jobApps() { return S.apps.filter(function (a) { return !!a.job_id; }); }
  function activeApps() { return jobApps().filter(function (a) { return TERM.indexOf(a.status) < 0; }); }

  /* ---------- đăng nhập / đăng ký ---------- */
  var AUTH = { google: false, supabase_url: '' };
  function post(body) {
    return fetch('/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j.error || 'Có lỗi xảy ra.'); e.pending = !!j.pending; throw e; } return j; }); });
  }
  function slug(v) { return String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 30); }
  function showLogin(mode, arg) {
    $('#app').classList.add('hide'); $('#login').classList.remove('hide'); closeLayer(true);
    renderLogin(mode || 'login', arg);
  }
  function renderLogin(mode, arg) {
    var f = function (id, label, type, extra) { return '<div class="field"><label for="' + id + '">' + label + '</label><input class="in" id="' + id + '" type="' + type + '" ' + (extra || '') + '></div>'; };
    var head = function (t, sub) { return '<span class="logo"><span class="moon" aria-hidden="true"></span>Luna</span><h1>' + t + '</h1><p class="sub">' + sub + '</p><div id="lerr" class="alert err hide" role="alert"></div>'; };
    var hp = '<input class="hp" type="text" id="l-web" tabindex="-1" autocomplete="off" aria-hidden="true">';
    var g = AUTH.google ? '<button class="btn ghost block" type="button" id="lgoogle">Tiếp tục với Google</button><div class="lsep"><span>hoặc</span></div>' : '';
    var h = '';
    if (mode === 'login') h = head('Đăng nhập', 'Khu vực quản lý tuyển dụng của bạn.') + g + f('l-email', 'Email', 'email', 'autocomplete="username" required') + f('l-pw', 'Mật khẩu', 'password', 'autocomplete="current-password" required') +
      '<button class="btn block" type="submit" id="lbtn">Đăng nhập</button><p class="lnk"><a href="#" data-lm="forgot">Quên mật khẩu?</a> · <a href="#" data-lm="register">Tạo tài khoản recruiter</a></p>';
    if (mode === 'register') h = head('Tạo tài khoản recruiter', 'Miễn phí. Tài khoản sẽ được duyệt trước khi dùng, thường trong 1 ngày.') + g + f('l-name', 'Tên hiển thị', 'text', 'autocomplete="name" maxlength="60" required placeholder="Ví dụ: Lam"') +
      f('l-email', 'Email', 'email', 'autocomplete="username" required') + f('l-pw', 'Mật khẩu (ít nhất 8 ký tự)', 'password', 'autocomplete="new-password" minlength="8" required') +
      '<div class="field"><label for="l-handle">Đường dẫn trang của bạn</label><div class="hbox"><span>' + esc(location.host) + '/</span><input class="in" id="l-handle" maxlength="30" required placeholder="ten-cua-ban" autocapitalize="none"></div><div class="help">Chữ thường, số, dấu gạch ngang. Ứng viên sẽ vào trang này để xem job của bạn.</div></div>' + hp +
      '<button class="btn block" type="submit" id="lbtn">Gửi đăng ký</button><p class="lnk"><a href="#" data-lm="login">Đã có tài khoản? Đăng nhập</a></p>';
    if (mode === 'forgot') h = head('Quên mật khẩu', 'Nhập email đã đăng ký, mình gửi link đặt lại mật khẩu.') + f('l-email', 'Email', 'email', 'autocomplete="username" required') +
      '<button class="btn block" type="submit" id="lbtn">Gửi link</button><p class="lnk"><a href="#" data-lm="login">Quay lại đăng nhập</a></p>';
    if (mode === 'reset') h = head('Đặt mật khẩu mới', 'Chọn mật khẩu mới cho tài khoản của bạn.') + f('l-pw', 'Mật khẩu mới (ít nhất 8 ký tự)', 'password', 'autocomplete="new-password" minlength="8" required') +
      '<button class="btn block" type="submit" id="lbtn">Đổi mật khẩu</button>';
    if (mode === 'done') h = '<span class="logo"><span class="moon" aria-hidden="true"></span>Luna</span><h1>' + esc(arg.title) + '</h1><p class="sub">' + esc(arg.text) + '</p><p class="lnk"><a href="#" data-lm="login">Về trang đăng nhập</a></p>';
    $('#lcard').innerHTML = '<form id="lf" data-mode="' + mode + '" novalidate>' + h + '</form>';
    var first = $('#lf input:not(.hp)'); if (first) setTimeout(function () { first.focus(); }, 50);
    if (mode === 'register') {
      var hd = $('#l-handle'); hd.dataset.touched = '';
      hd.addEventListener('input', function () { hd.dataset.touched = '1'; });
      $('#l-name').addEventListener('input', function () { if (!hd.dataset.touched) hd.value = slug($('#l-name').value); });
    }
    var gb = $('#lgoogle'); if (gb) gb.addEventListener('click', function () { location.href = AUTH.supabase_url + '/auth/v1/authorize?provider=google&redirect_to=' + encodeURIComponent(location.origin + '/admin/'); });
    $('#lf').addEventListener('submit', function (e) { e.preventDefault(); submitAuth(mode, arg); });
  }
  function submitAuth(mode, arg) {
    var btn = $('#lbtn'), err = $('#lerr'), label = btn.textContent, v = function (id) { var el = $('#' + id); return el ? el.value : ''; };
    err.classList.add('hide'); btn.disabled = true; btn.textContent = 'Đang xử lý…';
    var body = { action: mode, email: v('l-email').trim(), password: v('l-pw') };
    if (mode === 'register') Object.assign(body, { display_name: v('l-name').trim(), handle: slug(v('l-handle')), website: v('l-web') });
    if (mode === 'reset') body = { action: 'reset', token: arg, password: v('l-pw') };
    post(body).then(function () {
      if (mode === 'login') { store('lh_as', ''); S.as = ''; return boot(); }
      if (mode === 'register') return renderLogin('done', { title: 'Đã nhận đăng ký', text: 'Cảm ơn bạn! Tài khoản đang chờ duyệt. Mình sẽ gửi email ngay khi được duyệt, sau đó bạn đăng nhập và dùng bình thường.' });
      if (mode === 'forgot') return renderLogin('done', { title: 'Kiểm tra email của bạn', text: 'Nếu email này đã đăng ký, mình vừa gửi link đặt lại mật khẩu. Link hết hạn sau ít phút.' });
      if (mode === 'reset') { history.replaceState(null, '', '/admin/'); return renderLogin('done', { title: 'Đã đổi mật khẩu', text: 'Bạn đăng nhập lại bằng mật khẩu mới nhé.' }); }
    }).catch(function (e) {
      if (e.pending) return renderLogin('done', { title: 'Tài khoản đang chờ duyệt', text: e.message });
      err.textContent = e.message; err.classList.remove('hide'); btn.disabled = false; btn.textContent = label;
    });
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest('[data-lm]'); if (!a) return; e.preventDefault(); renderLogin(a.getAttribute('data-lm'));
  });
  function logout() {
    post({ action: 'logout' }).then(function () { store('lh_as', ''); S.as = ''; S.me = null; showLogin('login'); });
  }
  /** Đăng nhập Google: Supabase đưa về /admin/#access_token=... */
  function googleReturn() {
    var m = /[#&]access_token=([^&]+)/.exec(location.hash);
    if (!m) return false;
    var token = decodeURIComponent(m[1]);
    history.replaceState(null, '', '/admin/');
    showLogin('login');
    post({ action: 'google', access_token: token }).then(boot).catch(function (e) {
      if (e.pending) return renderLogin('done', { title: 'Tài khoản đang chờ duyệt', text: e.message });
      renderLogin('login'); var er = $('#lerr'); er.textContent = e.message; er.classList.remove('hide');
    });
    return true;
  }

  /* ---------- khởi động ---------- */
  function boot() {
    // Hỏi bootstrap trước: chưa đăng nhập thì chỉ tốn 1 request (không bắn thêm 2 request 401).
    api('bootstrap').then(function (b) {
      return Promise.all([api('candidates.list'), api('apps.list')]).then(function (l) { return [b, l[0], l[1]]; });
    }).then(function (r) {
      S.me = r[0].me; S.viewing = r[0].viewing; S.plan = r[0].plan;
      S.jobs = r[0].jobs; S.unread = r[0].unread_threads || 0; S.stages = r[0].stages; S.ST = {}; S.stages.forEach(function (s) { S.ST[s.key] = s; });
      S.cands = r[1].candidates.map(prep); S.apps = r[2].applications;
      $('#login').classList.add('hide'); $('#app').classList.remove('hide');
      shell(); asBar(); route(); ensurePoll();
    }).catch(function (e) {
      if (/đăng nhập lại/.test(e.message)) return;
      if (S.as && /Không tìm thấy|quyền/.test(e.message)) { S.as = ''; store('lh_as', ''); return boot(); }
      showLogin('login'); var er = $('#lerr'); er.textContent = /Chưa đăng nhập/.test(e.message) ? '' : e.message; if (er.textContent) er.classList.remove('hide');
    });
  }
  function refreshApps() { return api('apps.list').then(function (r) { S.apps = r.applications; renderNav(); }); }
  function refreshCands() { return api('candidates.list').then(function (r) { S.cands = r.candidates.map(prep); renderNav(); ensurePoll(); }); }
  function refreshJobs() { return api('bootstrap').then(function (r) { S.jobs = r.jobs; S.unread = r.unread_threads || 0; renderNav(); }); }

  function shell() {
    var rail = navList().map(function (n) { return '<a class="nv" data-nav="' + n[0] + '" href="#/' + n[0] + '"><span class="i">' + n[2] + '</span>' + n[1] + '<span class="ct num" data-ct="' + n[0] + '"></span></a>'; }).join('');
    var tabs = navList().map(function (n) { return '<a data-nav="' + n[0] + '" href="#/' + n[0] + '"><i>' + n[2] + '</i>' + n[1] + '</a>'; }).join('');
    $('#app').innerHTML = '<div class="shell"><aside class="rail"><a class="logo" href="#/overview"><span class="moon" aria-hidden="true"></span>Luna</a>' + rail +
      '<span class="sp"></span><button class="nv" data-theme-toggle type="button"><span class="i">◐</span>Sáng / tối</button><a class="nv" href="' + pubUrl() + '" target="_blank" rel="noopener"><span class="i">↗</span>Trang công khai</a><button class="nv" data-act="logout" type="button"><span class="i">⎋</span>Đăng xuất</button></aside>' +
      '<main class="main"><div class="mtop"><a class="logo" href="#/overview"><span class="moon" aria-hidden="true"></span>Luna</a><span class="sp"></span>' + '<button class="theme-btn" type="button" data-act="reload" aria-label="Tải lại trang" title="Tải lại">&#8635;</button>' + '<button class="theme-btn" type="button" data-theme-toggle aria-label="Đổi giao diện sáng hoặc tối" title="Đổi giao diện sáng / tối"><svg class="ic-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg><svg class="ic-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg></button>' + '<button class="b sm" data-act="logout" type="button">Đăng xuất</button></div><div id="view"></div></main>' +
      '<nav class="tabbar" aria-label="Điều hướng">' + tabs + '</nav></div>';
  }
  function renderNav() {
    $$('[data-nav]').forEach(function (a) { a.classList.toggle('on', a.getAttribute('data-nav') === S.tab); });
    var ct = { candidates: S.cands.length, pipeline: activeApps().length, inbox: S.unread > 0 ? S.unread : null };
    $$('[data-ct]').forEach(function (el) { var v = ct[el.getAttribute('data-ct')]; el.textContent = v == null ? '' : v; });
  }

  function pubUrl() { var h = (S.viewing || S.me || {}).handle; return h ? '/' + h : '/'; }
  function asBar() {
    var old = $('#asbar'); if (old) old.remove();
    if (!S.viewing) return;
    var bar = document.createElement('div'); bar.id = 'asbar'; bar.className = 'asbar';
    bar.innerHTML = '<span>Đang xem dữ liệu của <b>' + esc(S.viewing.display_name) + '</b> (' + esc(S.viewing.email) + ')</span><button class="b sm" type="button" data-act="as-exit">Quay về dữ liệu của tôi</button>';
    var main = $('.main'); if (main) main.insertBefore(bar, main.firstChild);
  }

  /* ---------- gói Free / Pro ---------- */
  function vnd(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + 'đ'; }
  /** Mã VietQR đã điền sẵn số tiền và nội dung chuyển khoản (ngân hàng nào quét cũng được). */
  function payUrl(p, kind) {
    var amount = kind === 'lifetime' ? p.price.lifetime : p.price.month, memo = 'LUNA ' + S.me.handle;
    return 'https://img.vietqr.io/image/' + encodeURIComponent(p.pay.bank) + '-' + encodeURIComponent(p.pay.account) + '-compact2.png?amount=' + amount + '&addInfo=' + encodeURIComponent(memo) + '&accountName=' + encodeURIComponent(p.pay.name || '');
  }
  function payBox(p) {
    if (!p.pay) return '';
    var memo = 'LUNA ' + S.me.handle;
    return '<div class="payqr"><img id="payimg" src="' + esc(payUrl(p, 'month')) + '" alt="Mã QR chuyển khoản" width="220" height="220"><div class="payside">' +
      '<div class="seg" role="group" aria-label="Chọn gói"><button type="button" class="on" data-act="pay-plan" data-v="month">1 tháng · ' + vnd(p.price.month) + '</button><button type="button" data-act="pay-plan" data-v="lifetime">Vĩnh viễn · ' + vnd(p.price.lifetime) + '</button></div>' +
      '<dl><dt>Ngân hàng</dt><dd>' + esc(p.pay.bank) + '</dd><dt>Số tài khoản</dt><dd><b class="num">' + esc(p.pay.account) + '</b> <button class="b sm" type="button" data-act="copy-url" data-v="' + esc(p.pay.account) + '">Chép</button></dd>' +
      (p.pay.name ? '<dt>Chủ tài khoản</dt><dd>' + esc(p.pay.name) + '</dd>' : '') + '<dt>Nội dung</dt><dd><b class="num">' + esc(memo) + '</b> <button class="b sm" type="button" data-act="copy-url" data-v="' + esc(memo) + '">Chép</button></dd></dl>' +
      '<div class="muted">Quét bằng app ngân hàng, số tiền và nội dung đã điền sẵn. Chuyển xong tài khoản được nâng Pro, thường trong ngày.</div></div></div>';
  }
  var PERKS = [
    ['📌', 'Job đang mở', '3 job', 'Không giới hạn'],
    ['👥', 'Hồ sơ ứng viên', '100 hồ sơ', 'Không giới hạn'],
    ['🤖', 'AI đọc CV', '30 lượt / tháng', 'Không giới hạn'],
    ['🎯', 'Chấm điểm AI hàng loạt', '', 'Có'],
    ['✍️', 'Viết JD bằng AI', '', 'Có'],
    ['📊', 'Báo cáo ngày, tuần, quý, năm + xuất CSV', 'Chỉ theo tháng', 'Đầy đủ'],
    ['🔔', 'Thông báo hồ sơ mới qua Telegram', '', 'Có'],
    ['🎨', 'Logo và ảnh bìa trang riêng', '', 'Có'],
    ['✨', 'Bỏ chữ "Powered by Luna"', '', 'Có']
  ];
  function perksBox() {
    return '<div class="perks"><div class="perks-h"><span></span><span>Free</span><span class="pro">Pro</span></div>' + PERKS.map(function (k) {
      return '<div class="perk"><span class="pn"><i>' + k[0] + '</i>' + esc(k[1]) + '</span><span class="pf">' + (k[2] ? esc(k[2]) : '<em>–</em>') + '</span><span class="pp">✓ ' + esc(k[3]) + '</span></div>';
    }).join('') + '</div>';
  }
  function planBox() {
    var p = S.plan; if (!p || !p.billing) return '';
    var u = p.usage, L = p.limits, bar = function (n, max, label) { return '<div class="use"><span>' + label + '</span><b class="num">' + n + (p.pro ? '' : ' / ' + max) + '</b></div>'; };
    var until = p.plan_until ? new Date(p.plan_until).toLocaleDateString('vi-VN') : '';
    var head = p.role_admin ? '<span class="badge ok">Admin · dùng đủ tính năng</span>' : p.pro ? '<span class="badge ok">Gói Pro</span> <span class="muted">' + (p.lifetime ? 'vĩnh viễn' : 'đến ' + esc(until)) + '</span>' : '<span class="badge warn">Gói Free</span>' + (until ? ' <span class="muted">Pro đã hết hạn ' + esc(until) + '</span>' : '');
    var up = p.pro ? '' : '<div class="plan-up"><div><b>Nâng cấp Pro: ' + vnd(p.price.month) + '/tháng</b> <s class="muted">' + vnd(p.price.month_list) + '</s> · hoặc <b>' + vnd(p.price.year) + '/năm</b> (tiết kiệm ' + vnd(p.price.month * 12 - p.price.year) + ')</div>' +
      perksBox() +
      payBox(p) + '<div class="payinfo">' + (p.payment_info ? esc(p.payment_info) : p.pay ? '' : 'Liên hệ quản trị viên để nâng cấp, sau khi chuyển khoản tài khoản sẽ được nâng ngay.') + '</div></div>';
    return '<section class="box planbox"><h2>Gói của bạn ' + head + '</h2><div class="uses">' + bar(u.jobs, L.jobs, 'Job đang mở') + bar(u.candidates, L.candidates, 'Ứng viên') + bar(u.ai, L.ai_month, 'Lượt AI đọc CV tháng này') + '</div>' + up + '</section>';
  }

  /* ---------- cài đặt hồ sơ công khai ---------- */
  var KINDS = { linkedin: 1, facebook: 1, zalo: 1 };
  function commText(list) { return (list || []).map(function (c) { return [c.kind, c.name, c.note, c.url].join(' | '); }).join('\n'); }
  function parseComm(t) {
    return String(t || '').split('\n').map(function (l) {
      var p = l.split('|').map(function (x) { return x.trim(); });
      return p.length >= 4 ? { kind: KINDS[p[0].toLowerCase()] ? p[0].toLowerCase() : 'facebook', name: p[1], note: p[2], url: p[3] } : null;
    }).filter(Boolean);
  }
  VIEWS.settings = function () {
    var m = S.me, url = location.origin + '/' + m.handle;
    var f = function (id, label, val, extra, help) { return '<div class="field"><label for="' + id + '">' + label + '</label><input class="i2" id="' + id + '" value="' + esc(val || '') + '" ' + (extra || '') + '>' + (help ? '<div class="help">' + help + '</div>' : '') + '</div>'; };
    $('#view').innerHTML = '<div class="ph"><h1>Cài đặt</h1></div>' + planBox() +
      (S.viewing ? '<div class="alert err" style="margin-bottom:14px">Đây là hồ sơ của chính bạn, không phải của ' + esc(S.viewing.display_name) + '.</div>' : '') +
      '<form id="pf" class="box setgrid" novalidate>' +
      '<h2>Trang công khai của bạn</h2><div class="setrow"><div class="pubu"><a href="' + esc('/' + m.handle) + '" target="_blank" rel="noopener">' + esc(url) + '</a> <button class="b sm" type="button" data-act="copy-url" data-v="' + esc(url) + '">Chép link</button></div></div>' +
      '<div class="setrow two">' + f('p-name', 'Tên hiển thị', m.display_name, 'maxlength="60"') + f('p-title', 'Chức danh', m.title, 'maxlength="80" placeholder="Talent Acquisition"') + '</div>' +
      '<div class="setrow"><div class="field"><label for="p-bio">Giới thiệu ngắn (hiện ở đầu trang)</label><textarea class="i2" id="p-bio" maxlength="400" placeholder="Để trống thì dùng câu giới thiệu mặc định.">' + esc(m.bio || '') + '</textarea></div></div>' +
      '<div class="setrow two">' + f('p-cemail', 'Email liên hệ công khai', m.contact_email, 'type="email"', 'Hiện ở chân trang và dùng làm địa chỉ trả lời email cho ứng viên.') + f('p-zalo', 'Link Zalo', m.zalo, 'placeholder="https://zalo.me/..."') + '</div>' +
      '<div class="setrow two">' + f('p-fb', 'Link Facebook', m.facebook, 'placeholder="https://facebook.com/..."') + f('p-in', 'Link LinkedIn', m.linkedin, 'placeholder="https://linkedin.com/in/..."') + '</div>' +
      '<div class="setrow">' + f('p-tg', 'Link Telegram', m.telegram, 'placeholder="https://t.me/..."') + '</div>' +
      '<div class="setrow two">' + f('p-logo', 'Logo trang riêng (link ảnh https)' + (S.plan && S.plan.billing ? ' · Pro' : ''), m.logo_url, (S.me.pro ? '' : 'disabled ') + 'placeholder="https://..."') + f('p-cover', 'Ảnh bìa (link ảnh https)' + (S.plan && S.plan.billing ? ' · Pro' : ''), m.cover_url, (S.me.pro ? '' : 'disabled ') + 'placeholder="https://..."') + '</div>' +
      '<div class="setrow"><div class="field"><label for="p-comm">Cộng đồng bạn quản lý hoặc giới thiệu</label><textarea class="i2" id="p-comm" rows="5" placeholder="facebook | Tên nhóm | Nhóm Facebook | https://facebook.com/groups/...">' + esc(commText(m.communities)) + '</textarea><div class="help">Mỗi dòng một nhóm: loại (facebook, linkedin, zalo) | tên | ghi chú | link https.</div></div></div>' +
      '<h2>Thông báo hồ sơ mới</h2>' +
      '<div class="setrow two">' + f('p-nemail', 'Email nhận thông báo', m.notify_email, 'type="email"', 'Để trống thì dùng email đăng nhập (' + esc(m.email) + ').') + f('p-chat', 'Telegram chat id', m.telegram_chat_id, 'inputmode="numeric" placeholder="Ví dụ: 123456789"', (S.plan && S.plan.billing ? 'Chỉ có ở gói Pro. ' : '') + 'Nhắn bot @userinfobot để biết chat id của bạn, rồi nhắn /start cho bot Luna của site này để nhận thông báo.') + '</div>' +
      '<div class="setrow"><button class="b pri" type="submit" id="psave">Lưu thay đổi</button></div></form>' +
      '<section class="box repbox"><h2>Báo lỗi / góp ý cho admin</h2><form id="rf" class="setf">' +
      '<div class="setrow two"><div class="field"><label for="r-kind">Loại</label><select class="i2" id="r-kind"><option value="bug">🐞 Báo lỗi</option><option value="idea">💡 Góp ý, đề xuất tính năng</option><option value="abuse">🚩 Tố cáo nội dung vi phạm</option><option value="other">📝 Khác</option></select></div></div>' +
      '<div class="setrow"><div class="field"><label for="r-msg">Nội dung</label><textarea class="i2" id="r-msg" rows="4" maxlength="2000" placeholder="Bạn gặp gì, ở mục nào, bấm gì thì bị? Càng cụ thể càng dễ sửa."></textarea></div></div>' +
      '<div class="setrow"><button class="b pri" type="submit" id="rsend">Gửi cho admin</button></div></form></section>';
    $('#rf').addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = $('#rsend'); btn.disabled = true;
      api('reports.send', { kind: $('#r-kind').value, message: $('#r-msg').value, page: 'Cài đặt' })
        .then(function () { $('#r-msg').value = ''; toast('Đã gửi, cảm ơn bạn!'); }).catch(fail).then(function () { btn.disabled = false; });
    });
    $('#pf').addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = $('#psave'); btn.disabled = true;
      api('profile.save', {
        display_name: $('#p-name').value, title: $('#p-title').value, bio: $('#p-bio').value, contact_email: $('#p-cemail').value, zalo: $('#p-zalo').value,
        facebook: $('#p-fb').value, linkedin: $('#p-in').value, telegram: $('#p-tg').value, communities: parseComm($('#p-comm').value),
        notify_email: $('#p-nemail').value, telegram_chat_id: $('#p-chat').value,
        logo_url: $('#p-logo').value, cover_url: $('#p-cover').value,
      }).then(function (r) { S.me = r.me; toast('Đã lưu'); }).catch(fail).then(function () { btn.disabled = false; });
    });
  };

  /* ---------- quản lý recruiter (chỉ admin tổng) ---------- */
  var RST = { pending: ['Chờ duyệt', 'warn'], active: ['Đang hoạt động', 'ok'], suspended: ['Đã khoá', 'err'] };
  VIEWS.recruiters = function () {
    if (!S.me || S.me.role !== 'admin') { $('#view').innerHTML = '<div class="none">Bạn không có quyền xem mục này.</div>'; return; }
    $('#view').innerHTML = '<div class="ph"><h1>Recruiter</h1></div><div id="billbox"></div><div id="repbox"></div><div class="box" id="reclist"><div class="none">Đang tải…</div></div>';
    api('recruiters.list').then(function (r) { S.recs = r.recruiters; S.billing = !!r.billing; paintRecs(); }).catch(fail);
    loadReports();
  };
  var RKIND = { bug: '🐞 Lỗi', idea: '💡 Góp ý', abuse: '🚩 Vi phạm', other: '📝 Khác' };
  function loadReports() { api('reports.list').then(function (r) { S.reports = r.reports; S.repMissing = !!r.missing; paintReports(); }).catch(fail); }
  function paintReports() {
    var box = $('#repbox'); if (!box || S.tab !== 'recruiters') return;
    if (S.repMissing) { box.innerHTML = '<div class="box repadm"><div class="muted">Chưa có bảng báo cáo. Chạy file SQL <b>2026-11-bao-cao.sql</b> trong Supabase để xem danh sách tại đây.</div></div>'; return; }
    var list = S.reports || [], open = list.filter(function (x) { return x.status !== 'done'; });
    box.innerHTML = '<div class="box repadm"><h2>Báo cáo từ recruiter ' + (open.length ? '<span class="badge warn">' + open.length + ' mới</span>' : '') + '</h2>' +
      (list.length ? list.map(function (x) {
        var w = x.who ? esc(x.who.display_name || x.who.email) + ' <span class="muted">/' + esc(x.who.handle) + '</span>' : '<span class="muted">đã xoá</span>';
        return '<div class="li rep' + (x.status === 'done' ? ' done' : '') + '"><div class="repm"><div><b>' + (RKIND[x.kind] || RKIND.other) + '</b> · ' + w + ' <span class="muted">· ' + esc(new Date(x.created_at).toLocaleString('vi-VN')) + (x.page ? ' · ' + esc(x.page) : '') + '</span></div><div class="reptx">' + esc(x.message) + '</div></div>' +
          '<div class="recb"><button class="b sm" type="button" data-act="rep-set" data-id="' + x.id + '" data-v="' + (x.status === 'done' ? 'new' : 'done') + '">' + (x.status === 'done' ? 'Mở lại' : 'Đã xử lý') + '</button><button class="b sm" type="button" data-act="rep-del" data-id="' + x.id + '">Xoá</button></div></div>';
      }).join('') : '<div class="none">Chưa có báo cáo nào.</div>') + '</div>';
  }
  function isProRec(r) { return r.plan_until && new Date(r.plan_until).getTime() > Date.now(); }
  function planTag(r) { return isProRec(r) ? (new Date(r.plan_until).getUTCFullYear() >= 2099 ? ' <span class="badge ok">Pro vĩnh viễn</span>' : ' <span class="badge ok">Pro đến ' + esc(new Date(r.plan_until).toLocaleDateString('vi-VN')) + '</span>') : ' <span class="badge">Free</span>'; }
  function paintRecs() {
    var box = $('#reclist'); if (!box || S.tab !== 'recruiters') return;
    var bb = $('#billbox');
    if (bb) bb.innerHTML = '<div class="box billsw"><div><b>Tính phí gói Free / Pro: ' + (S.billing ? '<span class="badge warn">ĐANG BẬT</span>' : '<span class="badge ok">ĐANG TẮT</span>') + '</b>' +
      '<div class="muted">' + (S.billing ? 'Người dùng Free bị giới hạn job, ứng viên, lượt AI và thấy giá nâng cấp Pro.' : 'Mọi recruiter dùng đủ tính năng, không giới hạn và không thấy chữ Pro hay giá. Hợp để mở web miễn phí giai đoạn đầu.') + '</div></div>' +
      '<button class="b ' + (S.billing ? '' : 'pri') + '" type="button" data-act="bill-toggle">' + (S.billing ? 'Tắt tính phí' : 'Bật tính phí') + '</button></div>';
    var order = { pending: 0, active: 1, suspended: 2 };
    var list = S.recs.slice().sort(function (a, b) { return order[a.status] - order[b.status]; });
    box.innerHTML = list.map(function (r) {
      var st = RST[r.status] || [r.status, ''], self = r.id === S.me.id || r.email.toLowerCase() === (S.me.email || '').toLowerCase();
      var btns = '';
      if (r.status === 'pending') btns += '<button class="b pri sm" type="button" data-act="rec-set" data-id="' + r.id + '" data-k="status" data-v="active">Duyệt</button>';
      if (r.status === 'active' && !self) btns += '<button class="b sm" type="button" data-act="rec-set" data-id="' + r.id + '" data-k="status" data-v="suspended">Khoá</button>';
      if (r.status === 'suspended') btns += '<button class="b sm" type="button" data-act="rec-set" data-id="' + r.id + '" data-k="status" data-v="active">Mở khoá</button>';
      if (r.status === 'active' && !self) btns += '<button class="b sm" type="button" data-act="rec-set" data-id="' + r.id + '" data-k="role" data-v="' + (r.role === 'admin' ? 'recruiter' : 'admin') + '">' + (r.role === 'admin' ? 'Hạ xuống recruiter' : 'Cấp quyền admin') + '</button>';
      if (r.status === 'active' && r.role !== 'admin') btns += '<button class="b sm" type="button" data-act="rec-plan" data-id="' + r.id + '" data-m="1">+1 tháng Pro</button><button class="b sm" type="button" data-act="rec-plan" data-id="' + r.id + '" data-m="life">Pro vĩnh viễn</button>' + (isProRec(r) ? '<button class="b sm" type="button" data-act="rec-plan" data-id="' + r.id + '" data-m="0">Về Free</button>' : '');
      if (r.status !== 'pending' && r.id !== S.me.id) btns += '<button class="b sm" type="button" data-act="rec-view" data-id="' + r.id + '">Xem dữ liệu</button>';
      return '<div class="li rec"><div class="tx"><div class="t1">' + esc(r.display_name) + ' <span class="badge ' + st[1] + '">' + st[0] + '</span>' + (r.role === 'admin' ? ' <span class="badge dup">Admin</span>' : planTag(r)) + '</div>' +
        '<div class="t2">' + esc(r.email) + ' · <a href="/' + esc(r.handle) + '" target="_blank" rel="noopener">/' + esc(r.handle) + '</a></div>' +
        '<div class="t2">' + r.jobs + ' job · ' + r.candidates + ' ứng viên · ' + r.apps + ' hồ sơ · ' + (r.last_login_at ? 'đăng nhập ' + ago(r.last_login_at) + ' trước' : 'chưa đăng nhập') + '</div></div><div class="recb">' + btns + '</div></div>';
    }).join('') || '<div class="none">Chưa có recruiter nào.</div>';
  }

  /* ---------- định tuyến ---------- */
  function route() {
    var h = location.hash.replace(/^#\/?/, '').split('/');
    var a = h[0] || 'overview', id = h[1] || '';
    var tab = a === 'candidate' ? 'candidates' : a === 'app' ? 'pipeline' : a === 'job' ? 'jobs' : a;
    if (!VIEWS[tab]) tab = 'overview';
    S.tab = tab; closeLayer(true); renderNav(); VIEWS[tab]();
    try { var on = document.querySelector('.tabbar a.on'); if (on && on.scrollIntoView) on.scrollIntoView({ inline: 'center', block: 'nearest' }); } catch (e) { /* bỏ qua */ }
    if (id) { if (a === 'inbox') openThread(id); else if (a === 'candidate' || a === 'candidates') openCandidate(id); else if (a === 'app') openApp(id); else if (a === 'job' || a === 'jobs') openJob(id); }
  }
  window.addEventListener('hashchange', function () { if ($('#app') && !$('#app').classList.contains('hide')) route(); });

  /* ---------- tổng quan ---------- */
  VIEWS.overview = function () {
    var act = activeApps(), today = todayISO(), end = plusDays(7);
    var open = S.jobs.filter(function (j) { return j.status === 'open'; }).length;
    var interviewing = jobApps().filter(function (a) { return a.status === 'interview1' || a.status === 'interview2'; }).length;
    var fresh = jobApps().filter(function (a) { return a.status === 'new'; });
    var poolSince = new Date(Date.now() - 14 * 864e5).toISOString();
    var pool = S.apps.filter(function (a) { return !a.job_id && a.status === 'new' && a.created_at >= poolSince; });
    var due = act.filter(function (a) { return a.next_action_date && a.next_action_date <= end; }).sort(function (a, b) { return a.next_action_date < b.next_action_date ? -1 : 1; });
    var attn = S.cands.filter(function (c) { return c.parse_status === 'failed' || c.dup_of; });
    var row = function (a, right) {
      return '<div class="li" data-act="app" data-id="' + a.id + '"><span class="sdot ' + stClass(a.status) + '"></span><div class="tx"><div class="t1">' + esc(a.candidate_name) + '</div><div class="t2">' + esc(a.job_title) + '</div></div>' + right + '</div>';
    };
    $('#view').innerHTML = '<div class="ph"><h1>Tổng quan</h1></div>' +
      '<div class="metrics"><div><b>' + S.cands.length + '</b><span>CV trong kho</span></div><div><b>' + open + '</b><span>Job đang mở</span></div><div><b>' + act.length + '</b><span>Application đang chạy</span></div><div><b>' + interviewing + '</b><span>Đang phỏng vấn</span></div><div><b>' + fresh.length + '</b><span>Hồ sơ mới chưa xem</span></div></div>' +
      '<div class="cols2"><section class="box"><h2>Việc cần làm <span class="ct">7 ngày tới</span></h2>' +
      (due.length ? due.slice(0, 10).map(function (a) {
        return row(a, '<div style="text-align:right"><div class="t2" style="font-size:12.5px;color:var(--ink-2)">' + esc(a.next_action) + '</div><span class="dt num ' + (a.next_action_date < today ? 'late' : '') + '">' + shortDate(a.next_action_date) + (a.next_action_date < today ? ' · trễ' : '') + '</span></div>');
      }).join('') : '<div class="none">Không có việc nào đến hạn. Đặt "việc tiếp theo" và ngày hạn trong từng application để thấy ở đây.</div>') + '</section>' +
      '<section class="box"><h2>Hồ sơ mới <span class="ct">' + fresh.length + '</span></h2>' +
      (fresh.length ? fresh.slice(0, 8).map(function (a) { return row(a, '<span class="dt num">' + ago(a.created_at) + '</span>'); }).join('') : '<div class="none">Chưa có hồ sơ mới nào cần xem.</div>') + '</section></div>' +
      (pool.length ? '<section class="box" style="margin-top:16px"><h2>Mới vào kho tài năng <span class="ct">14 ngày qua · ' + pool.length + '</span></h2>' + pool.slice(0, 8).map(function (a) {
        return '<div class="li" data-act="cand" data-id="' + a.candidate_id + '"><div class="tx"><div class="t1">' + esc(a.candidate_name) + '</div><div class="t2">Chưa gắn job · dùng Matching khi có vị trí phù hợp</div></div><span class="dt num">' + ago(a.created_at) + '</span></div>';
      }).join('') + '</section>' : '') +
      (attn.length ? '<section class="box" style="margin-top:16px"><h2>Cần xử lý <span class="ct">' + attn.length + '</span></h2>' + attn.slice(0, 8).map(function (c) {
        return '<div class="li" data-act="cand" data-id="' + c.id + '"><div class="tx"><div class="t1">' + esc(c.full_name) + '</div><div class="t2">' + esc(c.cv_filename || c.email) + '</div></div>' +
          (c.parse_status === 'failed' ? '<span class="badge err">Đọc CV lỗi</span>' : '<span class="badge dup">Có thể trùng</span>') + '</div>';
      }).join('') + '</section>' : '');
  };

  /* ---------- kho ứng viên ---------- */
  function freq(field) {
    var m = {};
    S.cands.forEach(function (c) {
      var seen = {};
      (c[field] || []).forEach(function (v) { var k = norm(v); if (!k || seen[k]) return; seen[k] = 1; if (!m[k]) m[k] = { label: v, n: 0 }; m[k].n++; });
    });
    return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return b.n - a.n || a.label.localeCompare(b.label); });
  }
  function filtered() {
    var f = S.f, toks = norm(f.q).split(/\s+/).filter(Boolean);
    var list = S.cands.filter(function (c) {
      if (f.openOnly && !c.is_open_to_work) return false;
      if (f.minY !== '' && Number(c.total_years_experience) < Number(f.minY)) return false;
      if (f.tech.length && !f.tech.every(function (t) { return c._t.indexOf(norm(t)) >= 0; })) return false;
      if (f.dom.length && !f.dom.some(function (d) { return c._d.indexOf(norm(d)) >= 0; })) return false;
      if (toks.length && !toks.every(function (t) { return c._h.indexOf(t) >= 0; })) return false;
      return true;
    });
    if (f.sort === 'name') list.sort(function (a, b) { return a.full_name.localeCompare(b.full_name, 'vi'); });
    if (f.sort === 'years') list.sort(function (a, b) { return Number(b.total_years_experience) - Number(a.total_years_experience); });
    return list;
  }
  VIEWS.candidates = function () {
    $('#view').innerHTML = '<div class="ph"><h1>Ứng viên</h1><span class="sp"></span><label class="b pri" for="upl">+ Thêm CV</label><input class="sr" id="upl" type="file" multiple accept=".pdf,.docx,.jpg,.jpeg,.png"></div>' +
      '<div class="dz" id="dz">Kéo thả CV vào đây hoặc bấm "Thêm CV". AI sẽ đọc và điền sẵn thông tin. <span class="muted">(PDF, DOCX, JPG, PNG · tối đa 4MB mỗi file)</span><div id="upst"></div></div>' +
      '<div class="tb"><input class="i2 grow" id="cq" type="search" placeholder="Tìm tên, kỹ năng, vị trí, email…" value="' + esc(S.f.q) + '"><select class="i2" id="csort" style="width:auto"><option value="new">Mới nhất</option><option value="name">Tên A–Z</option><option value="years">Kinh nghiệm</option></select><button class="b" id="cfilt" type="button">Bộ lọc</button></div>' +
      '<div class="cgrid"><aside class="side box" id="cside"></aside><div class="box" id="clist"></div></div>';
    $('#csort').value = S.f.sort;
    paintCands();
  };
  function paintCands() {
    if (S.tab !== 'candidates' || !$('#clist')) return;
    var f = S.f, techs = freq('technologies'), doms = freq('project_domains'), mx = techs.length ? techs[0].n : 1, dmx = doms.length ? doms[0].n : 1;
    var fq = function (x, kind, max, on) {
      return '<button class="fq' + (on ? ' on' : '') + '" type="button" data-' + kind + '="' + esc(x.label) + '"><span class="bar" style="width:' + Math.max(8, Math.round(x.n / max * 100)) + '%"></span><span class="n">' + esc(x.label) + '</span><span class="c">' + x.n + '</span></button>';
    };
    var isOn = function (arr, l) { return arr.some(function (t) { return norm(t) === norm(l); }); };
    $('#cside').innerHTML =
      '<div class="grp"><span class="lbl">Tech stack' + (f.tech.length ? '<button data-act="rtech" type="button">Bỏ ' + f.tech.length + '</button>' : '') + '</span>' +
      (techs.length ? techs.slice(0, f.techLimit).map(function (t) { return fq(t, 'tech', mx, isOn(f.tech, t.label)); }).join('') : '<span class="muted">Chưa có dữ liệu</span>') +
      (techs.length > f.techLimit ? '<button class="more" data-act="mtech" type="button">Xem thêm ' + (techs.length - f.techLimit) + '</button>' : '') + '</div>' +
      (doms.length ? '<div class="grp"><span class="lbl">Domain' + (f.dom.length ? '<button data-act="rdom" type="button">Bỏ ' + f.dom.length + '</button>' : '') + '</span>' +
        doms.slice(0, f.domLimit).map(function (t) { return fq(t, 'dom', dmx, isOn(f.dom, t.label)); }).join('') +
        (doms.length > f.domLimit ? '<button class="more" data-act="mdom" type="button">Xem thêm ' + (doms.length - f.domLimit) + '</button>' : '') + '</div>' : '') +
      '<div class="grp"><span class="lbl">Điều kiện</span><div class="fld"><label class="lbl" for="cy" style="text-transform:none;letter-spacing:0;font-size:12.5px;font-weight:500">Kinh nghiệm từ (năm)</label><input class="i2" id="cy" type="number" min="0" step="0.5" value="' + esc(f.minY) + '"></div>' +
      '<label class="chk"><input type="checkbox" id="co"' + (f.openOnly ? ' checked' : '') + '>Chỉ người đang tìm việc</label></div>';

    var list = filtered(), hits = f.tech.map(norm).concat(norm(f.q).split(/\s+/).filter(Boolean));
    var hit = function (t) { var n = norm(t); return hits.some(function (h) { return h && (n === h || n.indexOf(h) >= 0); }); };
    $('#clist').innerHTML = (list.length ? '<div style="padding:10px 16px;color:var(--muted);font-size:13px">' + list.length + (list.length !== S.cands.length ? ' / ' + S.cands.length : '') + ' ứng viên</div>' : '') +
      (list.length ? list.map(function (c) {
        var techs = c.technologies.slice().sort(function (a, b) { return (hit(b) ? 1 : 0) - (hit(a) ? 1 : 0); });
        return '<div class="row" data-act="cand" data-id="' + c.id + '"><span class="nm"><span class="dot ' + (c.is_open_to_work ? '' : 'off') + '" title="' + (c.is_open_to_work ? 'Đang tìm việc' : 'Không tìm việc') + '"></span><span class="t">' + esc(c.full_name) + '</span>' +
          (c.parse_status === 'pending' ? '<span class="badge wait">Đang đọc CV</span>' : c.parse_status === 'failed' ? '<span class="badge err">Lỗi đọc CV</span>' : c.dup_of ? '<span class="badge dup">Trùng?</span>' : '') + '</span>' +
          '<span class="ps">' + esc(c.positions[0] || c.headline || '—') + '</span><span class="yr">' + (Number(c.total_years_experience) || 0) + '<em>y</em></span>' +
          '<span class="ch">' + techs.slice(0, 4).map(function (t) { return '<span class="mini' + (hit(t) ? ' hit' : '') + '">' + esc(t) + '</span>'; }).join('') + (techs.length > 4 ? '<span class="mini">+' + (techs.length - 4) + '</span>' : '') + '</span><span class="go">›</span></div>';
      }).join('') : '<div class="none" style="border:0;padding:36px 20px">' + (S.cands.length ? 'Không ai khớp bộ lọc. Thử bỏ bớt điều kiện.' : 'Kho đang trống. Bấm "Thêm CV" hoặc đợi ứng viên nộp hồ sơ trên trang công khai.') + '</div>');
  }

  function uploadFiles(files) {
    files = Array.prototype.slice.call(files || []);
    if (!files.length) return;
    var st = $('#upst'), ok = 0, bad = 0;
    var next = function (i) {
      if (i >= files.length) {
        if (st) st.textContent = '';
        toast('Đã tải ' + ok + ' CV' + (bad ? ', ' + bad + ' lỗi' : '') + '. AI đang đọc, danh sách sẽ tự cập nhật.', bad > 0 && ok === 0);
        return refreshCands().then(function () { paintCands(); });
      }
      var f = files[i], ext = (f.name.split('.').pop() || '').toLowerCase();
      if (st) st.textContent = 'Đang tải ' + (i + 1) + '/' + files.length + ': ' + f.name;
      if (['pdf', 'docx', 'jpg', 'jpeg', 'png'].indexOf(ext) < 0 || f.size > MAX_CV) { bad++; toast(f.name + ': định dạng không hỗ trợ hoặc lớn hơn 4MB', true); return next(i + 1); }
      var fd = new FormData(); fd.append('action', 'candidates.upload'); fd.append('file', f, f.name);
      apiForm(fd).then(function () { ok++; }).catch(function (e) { bad++; fail(e); }).then(function () { next(i + 1); });
    };
    next(0);
  }

  // ---------- Bóc chữ từ CV ngay trên trình duyệt (Groq chỉ nhận chữ; cũng đỡ tốn CPU của server) ----------
  var pdfLib;
  function loadPdf() {
    if (!pdfLib) pdfLib = import('/assets/vendor/pdf.min.mjs').then(function (m) { m.GlobalWorkerOptions.workerSrc = '/assets/vendor/pdf.worker.min.mjs'; return m; });
    return pdfLib;
  }
  function pdfExtract(buf) {
    return loadPdf().then(function (pdfjs) {
      return pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
    }).then(function (doc) {
      var n = Math.min(doc.numPages, 8), out = [], i = 1;
      var step = function () {
        if (i > n) return Promise.resolve(out.join('\n').replace(/[ \t]+/g, ' ').trim());
        return doc.getPage(i++).then(function (pg) { return pg.getTextContent(); }).then(function (tc) {
          var line = '';
          tc.items.forEach(function (it) { line += it.str + (it.hasEOL ? '\n' : ' '); });
          out.push(line); return step();
        });
      };
      return step().then(function (text) {
        if (text.length >= 200) return { text: text.slice(0, 40000) };
        // PDF scan: render vài trang thành ảnh (chỉ dùng được khi server có GROQ_VISION_MODEL)
        var imgs = [], j = 1, m = Math.min(doc.numPages, 2);
        var shot = function () {
          if (j > m) return Promise.resolve({ text: text, images: imgs });
          return doc.getPage(j++).then(function (pg) {
            var vp = pg.getViewport({ scale: 1.4 }), cv = document.createElement('canvas');
            cv.width = vp.width; cv.height = vp.height;
            return pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise.then(function () { imgs.push(cv.toDataURL('image/jpeg', 0.7)); return shot(); });
          });
        };
        return shot();
      });
    });
  }
  function imgExtract(buf, ext) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(new Blob([buf], { type: ext === 'png' ? 'image/png' : 'image/jpeg' })), im = new Image();
      im.onload = function () {
        var k = Math.min(1, 1600 / Math.max(im.width, im.height)), cv = document.createElement('canvas');
        cv.width = Math.round(im.width * k); cv.height = Math.round(im.height * k);
        cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url);
        res({ images: [cv.toDataURL('image/jpeg', 0.75)] });
      };
      im.onerror = function () { URL.revokeObjectURL(url); rej(new Error('Không mở được ảnh CV.')); };
      im.src = url;
    });
  }
  function prepareCv(c) {
    var ext = (c.cv_filename || '').split('.').pop().toLowerCase();
    if (ext === 'docx') return Promise.resolve({});
    return fetch('/api/cv?id=' + encodeURIComponent(c.id), { headers: { 'x-lh': '1' } }).then(function (r) {
      if (!r.ok) throw new Error('Không tải được CV');
      return r.arrayBuffer();
    }).then(function (buf) { return ext === 'pdf' ? pdfExtract(buf) : imgExtract(buf, ext); }).catch(function () { return {}; });
  }

  // Hàng đợi đọc CV: trang admin gọi AI lần lượt từng hồ sơ đang chờ (mỗi lần một hồ sơ).
  function ensurePoll() {
    if (S.parsing) return;
    var tried = S.tried || (S.tried = {});
    var next = S.cands.filter(function (c) { return c.parse_status === 'pending' && !tried[c.id]; })[0];
    if (!next) return;
    S.parsing = true; tried[next.id] = true;
    prepareCv(next).then(function (extra) { return api('candidates.parse', Object.assign({ id: next.id }, extra)); }).catch(function () {}).then(function () {
      return api('candidates.list');
    }).then(function (r) {
      S.cands = r.candidates.map(prep); renderNav(); paintCands();
      S.parsing = false;
      if (!S.cands.some(function (c) { return c.parse_status === 'pending' && !tried[c.id]; })) toast('AI đã đọc xong CV');
      ensurePoll();
    }).catch(function () { S.parsing = false; });
  }

  /* ---------- drawer ---------- */
  function drawer(html) {
    var L = $('#layer');
    L.innerHTML = '<div class="scrim" data-act="close"></div><aside class="drawer" role="dialog" aria-modal="true">' + html + '</aside>';
    document.body.style.overflow = 'hidden';
  }
  function closeLayer(silent) {
    $('#layer').innerHTML = ''; document.body.style.overflow = '';
    if (!silent && S.open) { S.open = null; setHash(S.tab); }
  }
  function field(label, k, val, o) {
    o = o || {};
    return '<div class="fld"><label class="lbl">' + label + '</label>' + (o.area ? '<textarea class="i2" data-k="' + k + '"' + (o.list ? ' data-list="1"' : '') + (o.ph ? ' placeholder="' + esc(o.ph) + '"' : '') + '>' + esc(val) + '</textarea>'
      : '<input class="i2" data-k="' + k + '"' + (o.type ? ' type="' + o.type + '"' : '') + (o.step ? ' step="' + o.step + '" min="0"' : '') + (o.ph ? ' placeholder="' + esc(o.ph) + '"' : '') + ' value="' + esc(val) + '">') + '</div>';
  }
  function collect() {
    var o = {};
    $$('.drawer [data-k]').forEach(function (el) { o[el.getAttribute('data-k')] = el.type === 'checkbox' ? el.checked : el.value; });
    return o;
  }

  /* ---------- hồ sơ ứng viên ---------- */
  function openCandidate(id) {
    S.open = { type: 'cand', id: id }; setHash('candidates/' + id);
    api('candidates.get', { id: id }).then(function (r) {
      var c = r.candidate, roles = Object.keys(c.years_experience_by_role || {}).map(function (k) { return k + ':' + c.years_experience_by_role[k]; }).join('; ');
      var dup = c.dup_of ? S.cands.filter(function (x) { return x.id === c.dup_of; })[0] : null;
      var jobs = S.jobs.filter(function (j) { return j.status !== 'closed'; });
      drawer('<div class="dh"><div style="flex:1;min-width:0"><h2>' + esc(c.full_name) + '</h2><div class="s">' + esc(c.headline || c.positions.join(' · ') || 'Chưa có mô tả') + '</div></div><button class="b sm" data-act="close" type="button">Đóng</button></div><div class="db">' +
        (c.parse_status === 'pending' ? '<div class="alert info" style="margin-top:14px">AI đang đọc CV này. <button class="b sm" data-act="reopen" data-id="' + c.id + '" type="button">Tải lại</button></div>' : '') +
        (c.parse_status === 'failed' ? '<div class="alert err" style="margin-top:14px">Không đọc được CV: ' + esc(c.parse_error) + ' <button class="b sm" data-act="reparse" data-id="' + c.id + '" type="button">Đọc lại</button></div>' : '') +
        (dup ? '<div class="alert info" style="margin-top:14px">Có thể trùng với <b>' + esc(dup.full_name) + '</b> (' + esc(dup.email || dup.phone_number) + '). <button class="b sm" data-act="merge" data-from="' + c.id + '" data-to="' + dup.id + '" type="button">Gộp vào hồ sơ đó</button></div>' : '') +
        (r.cv_url ? '<div class="sec"><span class="lbl">CV gốc</span><a class="cvl" href="' + esc(r.cv_url) + '" target="_blank" rel="noopener"><span class="ic">' + esc((c.cv_filename.split('.').pop() || 'CV').toUpperCase().slice(0, 4)) + '</span><span style="flex:1;min-width:0"><b>' + esc(c.cv_filename || 'Mở CV') + '</b><br><span class="muted" style="font-size:12.5px">Mở trong tab mới · link có hiệu lực 1 giờ</span></span></a></div>' : '') +
        '<div class="sec"><span class="lbl">Pipeline (' + r.applications.length + ')</span>' +
        (r.applications.length ? r.applications.map(function (a) {
          return '<div class="li" style="padding:9px 0;border-top:0" data-act="app" data-id="' + a.id + '"><span class="sdot ' + stClass(a.status) + '"></span><div class="tx"><div class="t1">' + esc(a.job_title) + '</div><div class="t2">' + esc(stLabel(a.status)) + ' · ' + esc(a.code) + '</div></div><span class="muted">›</span></div>';
        }).join('') : '<div class="muted" style="margin-bottom:8px">Chưa thuộc job nào.</div>') +
        '<div style="display:flex;gap:8px;margin-top:6px"><select class="i2" id="addjob"><option value="">Thêm vào job…</option>' + jobs.map(function (j) { return '<option value="' + j.id + '">' + esc(j.title) + '</option>'; }).join('') + '</select><button class="b" data-act="addapp" data-id="' + c.id + '" type="button">Thêm</button></div></div>' +
        '<div class="sec"><span class="lbl">Trạng thái</span><label class="chk" style="margin-bottom:12px"><input type="checkbox" data-k="is_open_to_work"' + (c.is_open_to_work ? ' checked' : '') + '>Đang mở với cơ hội mới</label>' +
        '<div class="g2"><div class="fld"><label class="lbl">Loại hình mong muốn</label><select class="i2" data-k="job_type_preference">' + ['', 'Full-time', 'Part-time', 'Freelance', 'Contract', 'Internship'].map(function (o) { return '<option value="' + o + '"' + (c.job_type_preference === o ? ' selected' : '') + '>' + (o || '—') + '</option>'; }).join('') + '</select></div>' +
        field('Lương mong muốn', 'expected_salary', c.expected_salary) + '</div>' + field('Thời gian báo nghỉ', 'notice_period', c.notice_period) +
        field('Ghi chú của bạn', 'notes', c.notes, { area: 1, ph: 'Đã phone screen, chờ feedback…' }) + '</div>' +
        '<div class="sec"><span class="lbl">Liên hệ</span><div class="g2">' + field('Họ tên', 'full_name', c.full_name) + field('Điện thoại', 'phone_number', c.phone_number, { type: 'tel' }) + '</div>' +
        '<div class="g2">' + field('Email', 'email', c.email, { type: 'email' }) + field('Tỉnh / thành', 'address', c.address) + '</div>' +
        '<div class="g2">' + field('Ngày sinh', 'date_of_birth', c.date_of_birth, { ph: 'DD/MM/YYYY hoặc YYYY' }) + '<div class="fld"><label class="lbl">Giới tính</label><select class="i2" data-k="gender"><option' + (c.gender === 'Male' ? ' selected' : '') + '>Male</option><option' + (c.gender === 'Female' ? ' selected' : '') + '>Female</option></select></div></div>' +
        field('Link (LinkedIn / GitHub)', 'links', c.links) +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' + (c.phone_number ? '<a class="b sm" href="tel:' + esc(c.phone_number) + '">Gọi</a><a class="b sm" href="https://zalo.me/' + esc(String(c.phone_number).replace(/\D/g, '')) + '" target="_blank" rel="noopener">Zalo</a>' : '') + (c.email ? '<a class="b sm" href="mailto:' + esc(c.email) + '">Email</a>' : '') + '</div></div>' +
        '<div class="sec"><span class="lbl">Chuyên môn</span><div class="g2">' + field('Tổng năm kinh nghiệm', 'total_years_experience', c.total_years_experience, { type: 'number', step: '0.5' }) + field('Tiếng Anh', 'english_level', c.english_level) + '</div>' +
        field('Vị trí (cách nhau bằng dấu phẩy)', 'positions', (c.positions || []).join(', '), { list: 1 }) + field('Năm theo vai trò', 'years_experience_by_role', roles, { ph: 'backend:6; team_lead:2' }) +
        field('Domain dự án', 'project_domains', (c.project_domains || []).join(', '), { list: 1 }) + field('Technologies', 'technologies', (c.technologies || []).join(', '), { area: 1, list: 1 }) + field('Tóm tắt', 'headline', c.headline) + '</div>' +
        (c.cv_text ? '<div class="sec"><span class="lbl">Text CV (AI trích)</span><div class="cvtext">' + esc(c.cv_text) + '</div></div>' : '') +
        '</div><div class="df"><button class="b pri" data-act="savecand" data-id="' + c.id + '" type="button">Lưu thay đổi</button>' + (c.cv_path ? '<button class="b" data-act="reparse" data-id="' + c.id + '" type="button">AI đọc lại CV</button>' : '') + '<button class="b dng" data-act="delcand" data-id="' + c.id + '" type="button">Xoá</button></div>');
    }).catch(fail);
  }

  /* ---------- báo cáo ---------- */
  var REP_COLS = [['received', 'Hồ sơ nhận'], ['pool', 'Vào kho'], ['screening', 'Screening'], ['submitted', 'Gửi khách'], ['interview', 'Phỏng vấn'], ['offer', 'Offer'], ['hired', 'Nhận việc'], ['rejected', 'Từ chối'], ['withdrawn', 'Rút']];
  var REP_PRESETS = [['today', 'Hôm nay'], ['week', 'Tuần này'], ['7d', '7 ngày'], ['30d', '30 ngày'], ['month', 'Tháng này'], ['quarter', 'Quý này'], ['year', 'Năm nay'], ['custom', 'Tuỳ chọn']];
  function repRange(p) {
    var t = todayISO(), y = t.slice(0, 4), m = Number(t.slice(5, 7)), q = Math.floor((m - 1) / 3) * 3 + 1, pd = function (n) { return (n < 10 ? '0' : '') + n; };
    if (p === 'today') return { from: t, to: t, group: 'day' };
    if (p === 'week') { var dn = new Date(); var back = (dn.getDay() + 6) % 7; return { from: plusDays(-back), to: t, group: 'day' }; }
    if (p === '7d') return { from: plusDays(-6), to: t, group: 'day' };
    if (p === '30d') return { from: plusDays(-29), to: t, group: 'day' };
    if (p === 'month') return { from: y + '-' + pd(m) + '-01', to: t, group: 'day' };
    if (p === 'quarter') return { from: y + '-' + pd(q) + '-01', to: t, group: 'month' };
    return { from: y + '-01-01', to: t, group: 'month' };
  }
  VIEWS.report = function () {
    if (!S.rep) S.rep = Object.assign({ preset: 'quarter', data: null, busy: false }, repRange('quarter'));
    if (!isPro()) S.rep.group = 'month';
    paintReport();
    if (!S.rep.data) loadReport();
  };
  function isPro() { return !!(S.me && S.me.pro); }
  function loadReport() {
    var r = S.rep; if (!isPro()) r.group = 'month'; r.busy = true; paintReport();
    api('report.get', { from: r.from, to: r.to, group: r.group }).then(function (d) { r.data = d; r.busy = false; paintReport(); }).catch(function (e) { r.busy = false; paintReport(); fail(e); });
  }
  function paintReport() {
    if (S.tab !== 'report') return;
    var r = S.rep, d = r.data, G = [['day', 'Ngày'], ['week', 'Tuần'], ['month', 'Tháng'], ['quarter', 'Quý'], ['year', 'Năm']];
    var ctl = '<div class="rep-ctl"><div class="seg" role="group" aria-label="Khoảng thời gian">' + REP_PRESETS.map(function (p) {
      return '<button type="button" class="' + (r.preset === p[0] ? 'on' : '') + '" data-act="rpreset" data-id="' + p[0] + '">' + p[1] + '</button>';
    }).join('') + '</div>' +
      '<label class="rl">Từ <input class="i2" type="date" id="rfrom" value="' + esc(r.from) + '"></label><label class="rl">đến <input class="i2" type="date" id="rto" value="' + esc(r.to) + '"></label>' +
      '<label class="rl">Xem theo <select class="i2" id="rgroup" style="width:auto"' + (isPro() ? '' : ' disabled title="Gói Free chỉ xem theo tháng"') + '>' + G.map(function (g) { return '<option value="' + g[0] + '"' + (r.group === g[0] ? ' selected' : '') + '>' + g[1] + '</option>'; }).join('') + '</select></label>' +
      '<span class="sp"></span><button class="b" type="button" data-act="rcsv"' + (d ? '' : ' disabled') + '>Tải CSV</button></div>';
    var body = '';
    if (!d) body = '<div class="box"><div class="none">' + (r.busy ? 'Đang tính báo cáo…' : 'Chưa có dữ liệu.') + '</div></div>';
    else {
      var T = d.totals, pc = function (v) { return v == null ? '–' : v + '%'; };
      var max = Math.max.apply(null, d.rows.map(function (x) { return x.received; }).concat([1]));
      body = '<div class="metrics" style="grid-template-columns:repeat(6,1fr)">' + [['received', 'Hồ sơ nhận'], ['interview', 'Phỏng vấn'], ['offer', 'Offer'], ['hired', 'Nhận việc'], ['rejected', 'Từ chối'], ['withdrawn', 'Ứng viên rút']].map(function (c) {
        return '<div><b>' + T[c[0]] + '</b><span>' + c[1] + '</span></div>';
      }).join('') + '</div>' +
        '<p class="muted" style="margin:-6px 0 16px">Tỉ lệ hồ sơ vào phỏng vấn <b>' + pc(d.rates.interview) + '</b> · phỏng vấn ra offer <b>' + pc(d.rates.offer) + '</b> · hồ sơ đến nhận việc <b>' + pc(d.rates.hired) + '</b>' +
        (d.avg_days_to_hire != null ? ' · trung bình <b>' + d.avg_days_to_hire + '</b> ngày từ lúc nộp đến nhận việc' : '') + '</p>' +
        '<section class="box"><h2>Theo ' + esc(G.filter(function (g) { return g[0] === d.group; })[0][1].toLowerCase()) + '</h2><div class="tbl"><table class="rep"><thead><tr><th>Kỳ</th>' + REP_COLS.map(function (c) { return '<th class="n">' + c[1] + '</th>'; }).join('') + '</tr></thead><tbody>' +
        d.rows.map(function (x) {
          return '<tr><td>' + esc(x.label) + '</td>' + REP_COLS.map(function (c) {
            var v = x[c[0]], bar = c[0] === 'received' && v ? '<i class="bar" style="width:' + Math.round(v / max * 56) + 'px"></i>' : '';
            return '<td class="n num' + (v ? '' : ' z') + '">' + bar + v + '</td>';
          }).join('') + '</tr>';
        }).join('') + '</tbody><tfoot><tr><td>Tổng</td>' + REP_COLS.map(function (c) { return '<td class="n num">' + T[c[0]] + '</td>'; }).join('') + '</tr></tfoot></table></div></section>' +
        '<section class="box" style="margin-top:16px"><h2>Theo job</h2><div class="tbl"><table class="rep"><thead><tr><th>Job</th>' + REP_COLS.filter(function (c) { return c[0] !== 'pool'; }).map(function (c) { return '<th class="n">' + c[1] + '</th>'; }).join('') + '</tr></thead><tbody>' +
        (d.by_job.length ? d.by_job.map(function (x) { return '<tr><td>' + esc(x.title) + '</td>' + REP_COLS.filter(function (c) { return c[0] !== 'pool'; }).map(function (c) { return '<td class="n num' + (x[c[0]] ? '' : ' z') + '">' + x[c[0]] + '</td>'; }).join('') + '</tr>'; }).join('') : '<tr><td colspan="8" class="none" style="border:0">Chưa có hoạt động nào trong khoảng này.</td></tr>') +
        '</tbody></table></div></section>' +
        '<p class="muted" style="margin-top:12px;font-size:12.5px">Giờ Việt Nam. "Hồ sơ nhận" là hồ sơ nộp vào một job cụ thể; người nộp vào Kho tài năng đếm riêng ở cột "Vào kho" và không nằm trong phễu. Các mốc còn lại tính theo ngày hồ sơ được chuyển sang trạng thái đó (Phỏng vấn gồm vòng 1 và vòng 2).</p>';
    }
    $('#view').innerHTML = '<div class="ph"><h1>Báo cáo</h1></div>' + ctl + (r.busy && d ? '<p class="muted">Đang cập nhật…</p>' : '') + body;
  }
  function repCsv() {
    var d = S.rep && S.rep.data; if (!d) return;
    var q = function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var head = ['Kỳ'].concat(REP_COLS.map(function (c) { return c[1]; }));
    var lines = [head].concat(d.rows.map(function (x) { return [x.label].concat(REP_COLS.map(function (c) { return x[c[0]]; })); }))
      .concat([['Tổng'].concat(REP_COLS.map(function (c) { return d.totals[c[0]]; })), [], ['Theo job']], d.by_job.map(function (x) { return [x.title].concat(REP_COLS.map(function (c) { return c[0] === 'pool' ? '' : x[c[0]]; })); }));
    var blob = new Blob(['\ufeff' + lines.map(function (l) { return l.map(q).join(','); }).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'bao-cao-' + d.from + '-' + d.to + '.csv';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  /* ---------- pipeline ---------- */
  VIEWS.pipeline = function () {
    var jobs = S.jobs;
    $('#view').innerHTML = '<div class="ph"><h1>Pipeline</h1><span class="sp"></span><select class="i2" id="pjob" style="width:auto;max-width:260px"><option value="">Tất cả job</option>' + jobs.map(function (j) { return '<option value="' + j.id + '"' + (S.pjob === j.id ? ' selected' : '') + '>' + esc(j.title) + '</option>'; }).join('') + '</select></div><div id="kan"></div>';
    paintPipe();
  };
  function paintPipe() {
    if (S.tab !== 'pipeline' || !$('#kan')) return;
    var today = todayISO(), list = jobApps().filter(function (a) { return !S.pjob || a.job_id === S.pjob; });
    if (!list.length) { $('#kan').innerHTML = '<div class="box"><div class="none" style="border:0;padding:36px 20px">Chưa có application nào. Ứng viên nộp vào một job cụ thể sẽ xuất hiện ở đây. Người nộp vào Kho tài năng nằm ở mục Ứng viên; khi có job mới, dùng Matching để thêm người từ kho CV.</div></div>'; return; }
    $('#kan').innerHTML = '<div class="kan">' + S.stages.map(function (s) {
      var items = list.filter(function (a) { return a.status === s.key; });
      return '<section class="col ' + stClass(s.key) + (items.length ? '' : ' empty') + '" data-st="' + s.key + '"><h3><span class="sdot"></span>' + esc(s.label) + '<span class="ct">' + items.length + '</span></h3>' +
        items.map(function (a) {
          return '<div class="card" draggable="true" data-act="app" data-id="' + a.id + '"><div class="t1"><span>' + esc(a.candidate_name) + '</span>' + (a.match_score != null ? '<span class="sc">' + a.match_score + '</span>' : '') + '</div>' +
            '<div class="t2">' + esc(a.job_title) + '</div>' + ((a.next_action || a.next_action_date) ? '<div class="t3"><span>' + esc(a.next_action) + '</span>' + (a.next_action_date ? '<span class="num ' + (a.next_action_date < today && TERM.indexOf(a.status) < 0 ? 'late' : '') + '">' + shortDate(a.next_action_date) + '</span>' : '') + '</div>' : '') + '</div>';
        }).join('') + '</section>';
    }).join('') + '</div>';
  }


  /* ---------- kéo thả trong pipeline (chuột; không gửi email) ---------- */
  var dragId = null;
  function moveApp(id, to) {
    var a = S.apps.filter(function (x) { return x.id === id; })[0];
    if (!a || a.status === to) return;
    var from = a.status; a.status = to; paintPipe(); renderNav();
    // Chỉ đổi trạng thái: KHÔNG kèm notify nên không gửi email cho ứng viên.
    api('apps.update', { id: id, status: to }).then(function () {
      toast('Đã chuyển ' + a.candidate_name + ' sang ' + stLabel(to));
      return refreshApps().then(function () { if (S.tab === 'pipeline') paintPipe(); });
    }).catch(function (e) { a.status = from; paintPipe(); renderNav(); fail(e); });
  }
  document.addEventListener('dragstart', function (e) {
    var c = e.target.closest && e.target.closest('.kan .card'); if (!c) return;
    dragId = c.getAttribute('data-id'); c.classList.add('dragging');
    try { e.dataTransfer.setData('text/plain', dragId); e.dataTransfer.effectAllowed = 'move'; } catch (x) {}
  });
  document.addEventListener('dragend', function () {
    dragId = null;
    [].forEach.call(document.querySelectorAll('.kan .dragging, .kan .col.over'), function (n) { n.classList.remove('dragging', 'over'); });
  });
  document.addEventListener('dragover', function (e) {
    var col = dragId && e.target.closest && e.target.closest('.kan .col'); if (!col) return;
    e.preventDefault(); try { e.dataTransfer.dropEffect = 'move'; } catch (x) {}
    [].forEach.call(document.querySelectorAll('.kan .col.over'), function (n) { if (n !== col) n.classList.remove('over'); });
    col.classList.add('over');
  });
  document.addEventListener('drop', function (e) {
    var col = dragId && e.target.closest && e.target.closest('.kan .col'); if (!col) return;
    e.preventDefault(); var id = dragId; dragId = null; col.classList.remove('over');
    moveApp(id, col.getAttribute('data-st'));
  });

  function openApp(id) {
    S.open = { type: 'app', id: id }; setHash('app/' + id);
    api('apps.get', { id: id }).then(function (r) {
      var a = r.application, c = r.candidate || {}, link = location.origin + '/track?code=' + encodeURIComponent(a.code);
      drawer('<div class="dh"><div style="flex:1;min-width:0"><h2>' + esc(c.full_name || '') + '</h2><div class="s">' + esc(r.job ? r.job.title : 'Kho tài năng') + '</div></div><button class="b sm" data-act="close" type="button">Đóng</button></div><div class="db">' +
        '<div class="sec"><div class="codebox"><b>' + esc(a.code) + '</b><button class="b sm" data-act="copy" data-t="' + esc(a.code) + '" type="button">Chép mã</button><button class="b sm" data-act="copy" data-t="' + esc(link) + '" type="button">Chép link tra cứu</button></div></div>' +
        '<div class="sec"><span class="lbl">Trạng thái</span><select class="i2 sel-st" data-k="status">' + S.stages.map(function (s) { return '<option value="' + s.key + '"' + (a.status === s.key ? ' selected' : '') + '>' + esc(s.label) + '</option>'; }).join('') + '</select>' +
        '<div class="fld" style="margin-top:12px"><label class="lbl">Lời nhắn / feedback cho ứng viên (chỉ hiện ở trang tra cứu khi bạn nhập; nếu bị từ chối sẽ hiện là Feedback)</label><textarea class="i2" data-k="public_note" maxlength="1000" placeholder="VD: Lịch phỏng vấn 14h thứ Năm (online qua Google Meet)… Hoặc khi từ chối: feedback ngắn, lý do chưa phù hợp, gợi ý cải thiện.">' + esc(a.public_note) + '</textarea></div>' +
        '<label class="chk"><input type="checkbox" data-k="notify">Báo cho ứng viên qua email khi lưu</label></div>' +
        '<div class="sec"><span class="lbl">Việc tiếp theo</span><div class="g2">' + field('Làm gì', 'next_action', a.next_action) + '<div class="fld"><label class="lbl">Hạn</label><input class="i2" type="date" data-k="next_action_date" value="' + esc(a.next_action_date || '') + '"></div></div>' +
        '<div class="fld"><label class="lbl">Ghi chú nội bộ (ứng viên không thấy)</label><textarea class="i2" data-k="internal_note">' + esc(a.internal_note) + '</textarea></div>' +
        (a.cover_note ? '<div class="fld"><label class="lbl">Lời nhắn của ứng viên</label><div class="cvtext" style="font-family:var(--body);font-size:14px">' + esc(a.cover_note) + '</div></div>' : '') +
        (a.match_score != null ? '<div class="muted">Điểm matching: <b class="num">' + a.match_score + '</b>' + (a.match_reason ? ' · ' + esc(a.match_reason) : '') + '</div>' : '') + '</div>' +
        '<div class="sec"><span class="lbl">Ứng viên</span><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="b sm" data-act="cand" data-id="' + esc(c.id) + '" type="button">Mở hồ sơ</button>' + (r.cv_url ? '<a class="b sm pri" href="' + esc(r.cv_url) + '" target="_blank" rel="noopener">Xem CV</a>' : '') + (c.phone_number ? '<a class="b sm" href="tel:' + esc(c.phone_number) + '">Gọi ' + esc(c.phone_number) + '</a><a class="b sm" href="https://zalo.me/' + esc(String(c.phone_number).replace(/\D/g, '')) + '" target="_blank" rel="noopener">Zalo</a>' : '') + (c.email ? '<a class="b sm" href="mailto:' + esc(c.email) + '">Email</a>' : '') + '</div></div>' +
        '<div class="sec"><span class="lbl">Nhật ký</span><div style="display:flex;gap:8px;margin-bottom:8px"><input class="i2" id="newnote" placeholder="Thêm ghi chú nhanh…"><button class="b" data-act="addnote" data-id="' + a.id + '" type="button">Thêm</button></div>' +
        r.activities.map(function (x) {
          var txt = x.type === 'status' ? (x.meta && x.meta.from ? esc(stLabel(x.meta.from)) + ' → <b>' + esc(stLabel(x.meta.to)) + '</b>' : '<b>' + esc(stLabel(x.meta && x.meta.to)) + '</b>') + (x.note ? ' · ' + esc(x.note) : '') : esc(x.note);
          return '<div class="act ' + esc(x.type) + '">' + txt + '<span class="d">' + dt(x.created_at) + '</span></div>';
        }).join('') + '</div></div><div class="df"><button class="b pri" data-act="saveapp" data-id="' + a.id + '" type="button">Lưu</button></div>');
    }).catch(fail);
  }

  /* ---------- jobs ---------- */
  /* ---------- việc làm: lọc, nhóm theo địa điểm, ưu tiên, thao tác nhanh ---------- */
  var JLABEL = { open: 'Đang mở', draft: 'Nháp', paused: 'Tạm dừng', closed: 'Đã đóng' };
  var PRIO = { urgent: ['Gấp', 3], high: ['Cao', 2], normal: ['Thường', 1] };
  var PRIO_NEXT = { normal: 'high', high: 'urgent', urgent: 'normal' };
  var JF = { q: '', status: 'all', loc: '', mode: '', prio: '', group: 'loc', sort: 'prio', pick: false, sel: {} };
  var LOC_MAP = [[/^(ho chi minh|hcm|tp ?hcm|tphcm|hcmc|sai gon|saigon|tp ho chi minh)$/, 'Hồ Chí Minh'], [/^(ha noi|hn|hanoi)$/, 'Hà Nội'], [/^(da nang|dn)$/, 'Đà Nẵng'],
    [/^(remote|wfh|work from home|tu xa|lam viec tu xa)$/, 'Remote'], [/^hybrid$/, 'Hybrid'], [/^(can tho)$/, 'Cần Thơ'], [/^(hai phong)$/, 'Hải Phòng'], [/^(binh duong)$/, 'Bình Dương'], [/^(dong nai)$/, 'Đồng Nai']];
  var NOLOC = 'Chưa ghi địa điểm';
  function plain(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[.]/g, '').replace(/\s+/g, ' ').trim(); }
  /** Tách "Hồ Chí Minh, Hà Nội / Remote" thành các địa điểm chuẩn hoá; một job có thể thuộc nhiều địa điểm. */
  var MODES = ['Remote', 'Hybrid'], NOCITY = 'Chưa ghi thành phố', REMOTE_ONLY = 'Làm việc từ xa';
  /** Hình thức làm việc (Remote/Hybrid) tách riêng khỏi thành phố để các nhóm cùng cấp. */
  function modeKeys(str) { return rawLocs(str).filter(function (x) { return MODES.indexOf(x) >= 0; }); }
  /** Chỉ các thành phố/tỉnh. Job chỉ ghi Remote → nhóm "Làm việc từ xa"; không ghi gì → "Chưa ghi thành phố". */
  function locKeys(str) {
    var raw = rawLocs(str), c = raw.filter(function (x) { return MODES.indexOf(x) < 0 && x !== NOLOC; });
    return c.length ? c : [raw.indexOf('Remote') >= 0 ? REMOTE_ONLY : NOCITY];
  }
  function rawLocs(str) {
    var out = [];
    String(str || '').split(/[,;\/|·]|\s-\s|\svà\s/i).forEach(function (x) {
      x = x.trim(); if (!x) return;
      var k = plain(x), name = null;
      LOC_MAP.forEach(function (m) { if (!name && m[0].test(k)) name = m[1]; });
      name = name || (x.charAt(0).toUpperCase() + x.slice(1));
      if (out.indexOf(name) < 0) out.push(name);
    });
    return out.length ? out : [NOLOC];
  }
  var CITY_ORDER = ['Hồ Chí Minh', 'Hà Nội', 'Đà Nẵng'];
  function cityCmp(a, b) { var tail = function (x) { return x === NOCITY ? 2 : x === REMOTE_ONLY ? 1 : 0; }, ia = CITY_ORDER.indexOf(a), ib = CITY_ORDER.indexOf(b);
    return tail(a) - tail(b) || (ia < 0 ? 9 : ia) - (ib < 0 ? 9 : ib) || a.localeCompare(b, 'vi'); }
  function prioBadge(j) { var p = j.priority || 'normal'; return p === 'normal' ? '' : ' <span class="pri ' + p + '" title="Mức ưu tiên">' + (p === 'urgent' ? '🔥 ' : '▲ ') + PRIO[p][0] + '</span>'; }
  function jobsFiltered(count) {
    var q = plain(JF.q);
    var list = S.jobs.filter(function (j) {
      if (JF.status !== 'all' && j.status !== JF.status) return false;
      if (JF.prio && (j.priority || 'normal') !== JF.prio) return false;
      if (JF.loc && locKeys(j.location).indexOf(JF.loc) < 0) return false;
      if (JF.mode && modeKeys(j.location).indexOf(JF.mode) < 0) return false;
      if (q && plain([j.title, j.level, j.location, (j.must_have_tech || []).join(' ')].join(' ')).indexOf(q) < 0) return false;
      return true;
    });
    var ord = { open: 0, paused: 1, draft: 2, closed: 3 };
    list.sort(function (a, b) {
      if (JF.sort === 'title') return String(a.title).localeCompare(String(b.title), 'vi');
      if (JF.sort === 'apps') return (count[b.id] || 0) - (count[a.id] || 0) || String(b.created_at).localeCompare(String(a.created_at));
      if (JF.sort === 'new') return String(b.created_at).localeCompare(String(a.created_at));
      return PRIO[b.priority || 'normal'][1] - PRIO[a.priority || 'normal'][1] || ord[a.status] - ord[b.status] || String(b.created_at).localeCompare(String(a.created_at));
    });
    return list;
  }
  function jobRow(j, count) {
    var n = count[j.id] || 0, picked = !!JF.sel[j.id], p = j.priority || 'normal';
    var locs = rawLocs(j.location).filter(function (x) { return x !== NOLOC; });
    var meta = [j.level, j.job_type, j.salary_text].filter(Boolean).join(' · ');
    return '<div class="jrow2' + (picked ? ' sel' : '') + (j.status === 'closed' ? ' off' : '') + '" data-act="' + (JF.pick ? 'jpick' : 'job') + '" data-id="' + j.id + '">' +
      (JF.pick ? '<span class="jck" aria-hidden="true">' + (picked ? '✓' : '') + '</span>' : '') +
      '<div class="jmain"><div class="t1">' + esc(j.title) + prioBadge(j) + (j.lang === 'en' ? ' <span class="stt draft">EN</span>' : '') + '</div>' +
      '<div class="t2">' + esc(meta) + (locs.length ? (meta ? ' · ' : '') + '📍 ' + esc(locs.join(', ')) : '') + '</div>' +
      '<div class="t2">' + (j.must_have_tech || []).slice(0, 4).map(esc).join(', ') + '</div></div>' +
      '<div class="jside"><span class="stt ' + j.status + '">' + JLABEL[j.status] + '</span><span class="muted num">' + n + ' hồ sơ</span></div>' +
      (JF.pick ? '' : '<div class="jact">' +
        '<button class="b sm" type="button" data-act="jprio" data-id="' + j.id + '" title="Đổi mức ưu tiên: Thường → Cao → Gấp">⚑ ' + PRIO[p][0] + '</button>' +
        (j.status === 'open' ? '<button class="b sm" type="button" data-act="jstat" data-id="' + j.id + '" data-v="paused">⏸ Tạm dừng</button>' : j.status === 'closed' ? '<button class="b sm" type="button" data-act="jstat" data-id="' + j.id + '" data-v="draft">↺ Mở lại nháp</button>' : '<button class="b sm" type="button" data-act="jstat" data-id="' + j.id + '" data-v="open">▶ Mở tuyển</button>') +
        (j.status === 'open' || j.status === 'paused' ? '<button class="b sm" type="button" data-act="jstat" data-id="' + j.id + '" data-v="closed">✕ Đóng</button>' : '') +
        '<button class="b sm" type="button" data-act="jdup" data-id="' + j.id + '">⧉ Nhân đôi</button>' +
        (n ? '<button class="b sm" type="button" data-act="jpipe" data-id="' + j.id + '">Pipeline</button>' : '') +
        (j.status === 'open' ? '<button class="b sm" type="button" data-act="copy" data-t="' + esc(location.origin + '/jobs/' + j.slug) + '">🔗 Chép link</button><a class="b sm" href="/jobs/' + esc(j.slug) + '" target="_blank" rel="noopener">↗ Xem</a>' : '') +
      '</div>') + '</div>';
  }
  function paintJobs() {
    var box = $('#jbody'); if (!box || S.tab !== 'jobs') return;
    var count = {}; S.apps.forEach(function (a) { if (a.job_id) count[a.job_id] = (count[a.job_id] || 0) + 1; });
    var list = jobsFiltered(count), html = '';
    if (!list.length) html = '<div class="none" style="border:0;padding:36px 20px">' + (S.jobs.length ? 'Không có job nào khớp bộ lọc. Thử bỏ bớt điều kiện.' : 'Chưa có job nào. Bấm "Tạo job", bạn có thể dán nguyên JD để AI điền sẵn form.') + '</div>';
    else if (JF.group === 'none') html = list.map(function (j) { return jobRow(j, count); }).join('');
    else {
      var groups = {}, order = [];
      list.forEach(function (j) {
        var keys = JF.group === 'loc' ? locKeys(j.location) : JF.group === 'status' ? [JLABEL[j.status]] : [PRIO[j.priority || 'normal'][0]];
        keys.forEach(function (k) { if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(j); });
      });
      if (JF.group === 'loc') order.sort(cityCmp);
      html = order.map(function (k) {
        var open = groups[k].filter(function (j) { return j.status === 'open'; }).length;
        return '<div class="jgrp"><span>' + (JF.group === 'loc' && k !== NOCITY && k !== REMOTE_ONLY ? '📍 ' : '') + esc(k) + '</span><span class="muted">' + groups[k].length + ' job' + (open ? ' · ' + open + ' đang mở' : '') + '</span></div>' + groups[k].map(function (j) { return jobRow(j, count); }).join('');
      }).join('');
    }
    box.innerHTML = html;
    var n = Object.keys(JF.sel).length, bar = $('#jbar');
    if (bar) { bar.classList.toggle('on', JF.pick); bar.innerHTML = '<b>' + n + ' đã chọn</b>' +
      '<button class="b sm" type="button" data-act="jall">Chọn tất cả (' + list.length + ')</button>' +
      '<button class="b sm" type="button" data-act="jbulk" data-k="status" data-v="open"' + (n ? '' : ' disabled') + '>▶ Mở</button>' +
      '<button class="b sm" type="button" data-act="jbulk" data-k="status" data-v="paused"' + (n ? '' : ' disabled') + '>⏸ Tạm dừng</button>' +
      '<button class="b sm" type="button" data-act="jbulk" data-k="status" data-v="closed"' + (n ? '' : ' disabled') + '>✕ Đóng</button>' +
      '<select class="i2" id="jbprio"' + (n ? '' : ' disabled') + '><option value="">Ưu tiên…</option><option value="normal">Thường</option><option value="high">Cao</option><option value="urgent">Gấp</option></select>' +
      '<button class="b sm dng" type="button" data-act="jbulk" data-k="delete" data-v="1"' + (n ? '' : ' disabled') + '>Xoá</button>' +
      '<button class="b sm" type="button" data-act="jpickoff">Xong</button>'; }
    var cb = $('#jpickbtn'); if (cb) cb.textContent = JF.pick ? 'Thoát chọn' : 'Chọn nhiều';
  }
  function paintJobFilters() {
    var el = $('#jflt'); if (!el) return;
    var st = { all: S.jobs.length, open: 0, draft: 0, paused: 0, closed: 0 }, urgent = 0;
    S.jobs.forEach(function (j) { st[j.status]++; if (j.priority === 'urgent' && j.status === 'open') urgent++; });
    var jl = $('#jloc'); if (jl) jl.innerHTML = cityOpts();
    var chip = function (act, val, label, n, on) { return '<button type="button" class="chp' + (on ? ' on' : '') + '" data-act="' + act + '" data-v="' + esc(val) + '">' + esc(label) + ' <i>' + n + '</i></button>'; };
    el.innerHTML =
      '<div class="jsum">' + S.jobs.length + ' job · <b>' + st.open + '</b> đang mở' + (urgent ? ' · <span class="pri urgent">🔥 ' + urgent + ' gấp</span>' : '') + '</div>' +
      '<div class="chips2">' + [['all', 'Tất cả'], ['open', 'Đang mở'], ['draft', 'Nháp'], ['paused', 'Tạm dừng'], ['closed', 'Đã đóng']].map(function (x) { return chip('jfs', x[0], x[1], st[x[0]], JF.status === x[0]); }).join('') + '</div>';
  }
  function cityOpts() {
    var c = {}; S.jobs.forEach(function (j) { locKeys(j.location).forEach(function (k) { c[k] = (c[k] || 0) + 1; }); });
    return '<option value="">Mọi thành phố</option>' + Object.keys(c).sort(cityCmp).map(function (k) { return '<option value="' + esc(k) + '"' + (JF.loc === k ? ' selected' : '') + '>' + esc(k) + ' (' + c[k] + ')</option>'; }).join('');
  }
  VIEWS.jobs = function () {
    $('#view').innerHTML = '<div class="ph"><h1>Việc làm</h1><span class="sp"></span><button class="b" id="jpickbtn" data-act="jpicktoggle" type="button">Chọn nhiều</button><button class="b pri" data-act="newjob" type="button">+ Tạo job</button></div>' +
      '<div id="jflt"></div>' +
      '<div class="tb jtb"><input class="i2 grow" id="jq" type="search" placeholder="Tìm tên job, địa điểm, công nghệ…" value="' + esc(JF.q) + '">' +
      '<select class="i2" id="jloc" aria-label="Lọc theo thành phố">' + cityOpts() + '</select>' +
      '<select class="i2" id="jmode" aria-label="Lọc theo hình thức"><option value="">Mọi hình thức</option><option value="Remote"' + (JF.mode === 'Remote' ? ' selected' : '') + '>Remote</option><option value="Hybrid"' + (JF.mode === 'Hybrid' ? ' selected' : '') + '>Hybrid</option></select>' +
      '<select class="i2" id="jprio" aria-label="Lọc theo ưu tiên"><option value="">Mọi ưu tiên</option><option value="urgent"' + (JF.prio === 'urgent' ? ' selected' : '') + '>🔥 Gấp</option><option value="high"' + (JF.prio === 'high' ? ' selected' : '') + '>▲ Cao</option><option value="normal"' + (JF.prio === 'normal' ? ' selected' : '') + '>Thường</option></select>' +
      '<select class="i2" id="jgroup" aria-label="Nhóm theo"><option value="loc"' + (JF.group === 'loc' ? ' selected' : '') + '>Nhóm: Thành phố</option><option value="status"' + (JF.group === 'status' ? ' selected' : '') + '>Nhóm: Trạng thái</option><option value="prio"' + (JF.group === 'prio' ? ' selected' : '') + '>Nhóm: Ưu tiên</option><option value="none"' + (JF.group === 'none' ? ' selected' : '') + '>Không nhóm</option></select>' +
      '<select class="i2" id="jsort" aria-label="Sắp xếp"><option value="prio"' + (JF.sort === 'prio' ? ' selected' : '') + '>Xếp: Ưu tiên</option><option value="new"' + (JF.sort === 'new' ? ' selected' : '') + '>Xếp: Mới nhất</option><option value="apps"' + (JF.sort === 'apps' ? ' selected' : '') + '>Xếp: Nhiều hồ sơ</option><option value="title"' + (JF.sort === 'title' ? ' selected' : '') + '>Xếp: Tên A-Z</option></select></div>' +
      '<div class="box" id="jbody"></div><div class="jbar" id="jbar"></div>';
    paintJobFilters(); paintJobs();
    $('#jq').addEventListener('input', function (e) { JF.q = e.target.value; paintJobs(); });
    $('#jloc').addEventListener('change', function (e) { JF.loc = e.target.value; paintJobs(); });
    $('#jmode').addEventListener('change', function (e) { JF.mode = e.target.value; paintJobs(); });
    $('#jprio').addEventListener('change', function (e) { JF.prio = e.target.value; paintJobs(); });
    $('#jgroup').addEventListener('change', function (e) { JF.group = e.target.value; paintJobs(); });
    $('#jsort').addEventListener('change', function (e) { JF.sort = e.target.value; paintJobs(); });
  };
  function jobsReload() { return refreshJobs().then(function () { paintJobFilters(); paintJobs(); }); }
  function jobsBulk(payload, okMsg) {
    var ids = Object.keys(JF.sel); if (!ids.length) return toast('Chọn ít nhất một job.', true);
    return api('jobs.bulk', Object.assign({ ids: ids }, payload)).then(function (r) {
      var sk = (r.skipped || []).length;
      toast((payload.delete ? 'Đã xoá ' + (r.deleted || 0) + ' job' : 'Đã cập nhật ' + (r.updated || 0) + ' job') + (sk ? ' · bỏ qua ' + sk + ' (' + r.skipped[0].why + ')' : ''), !!sk && !(r.updated || r.deleted));
      JF.sel = {}; return jobsReload();
    }).catch(fail);
  }
  function openJob(id) {
    var j = id === 'new' ? { id: '', title: '', level: '', job_type: 'Full-time', salary_text: '', location: '', summary: '', responsibilities: '', requirements: '', benefits: '', must_have_tech: [], nice_to_have_tech: [], domains: [], min_years: 0, status: 'draft', slug: '', lang: 'vi' }
      : S.jobs.filter(function (x) { return x.id === id; })[0];
    if (!j) return;
    S.open = { type: 'job', id: id }; setHash('job/' + id);
    var langSel = '<div class="fld" style="margin-top:10px"><label class="lbl">Ngôn ngữ JD (AI viết và trang job hiển thị theo ngôn ngữ này)</label><select class="i2" data-k="lang"><option value="vi"' + (j.lang === 'en' ? '' : ' selected') + '>Tiếng Việt</option><option value="en"' + (j.lang === 'en' ? ' selected' : '') + '>English</option></select></div>';
    var sel = function (k, opts, val) { return '<select class="i2" data-k="' + k + '">' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (val === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>'; };
    drawer('<div class="dh"><div style="flex:1;min-width:0"><h2>' + esc(j.title || 'Job mới') + '</h2><div class="s">' + (j.slug ? esc(location.origin + '/jobs/' + j.slug) : 'Chưa lưu') + '</div></div><button class="b sm" data-act="close" type="button">Đóng</button></div><div class="db">' +
      (j.id ? '' : '<div class="sec"><span class="lbl">Dán JD để AI điền sẵn</span><textarea class="i2" id="jdtext" placeholder="Dán nguyên nội dung JD (từ khách hàng hoặc nơi khác)…" style="min-height:110px"></textarea>' + langSel + '<div style="margin-top:8px"><button class="b" data-act="jdai" type="button">Điền tự động bằng AI</button></div></div>') +
      '<div class="sec"><span class="lbl">Thông tin chính</span>' + field('Tên vị trí', 'title', j.title) + (j.id ? langSel + '<div class="muted" style="font-size:12.5px;margin:-4px 0 12px">Đổi ngôn ngữ chỉ đổi nhãn và form trên trang job. Nội dung JD bạn tự sửa, hoặc tạo lại bằng AI.</div>' : '') +
      '<div class="g2"><div class="fld"><label class="lbl">Cấp độ</label>' + sel('level', [['', '—'], ['Intern', 'Intern'], ['Junior', 'Junior'], ['Mid', 'Mid'], ['Senior', 'Senior'], ['Lead', 'Lead']], j.level) + '</div><div class="fld"><label class="lbl">Loại hình</label>' + sel('job_type', ['Full-time', 'Part-time', 'Freelance', 'Contract', 'Internship'].map(function (x) { return [x, x]; }), j.job_type) + '</div></div>' +
      '<div class="g2">' + field('Mức lương hiển thị', 'salary_text', j.salary_text, { ph: 'VD: 25–40 triệu, Thoả thuận' }) + field('Địa điểm làm việc', 'location', j.location, { ph: 'VD: Hồ Chí Minh, Hà Nội, Remote' }) + '</div><div class="locq">' + ['Hồ Chí Minh', 'Hà Nội', 'Đà Nẵng', 'Remote', 'Hybrid'].map(function (x) { return '<button class="chp" type="button" data-act="locadd" data-v="' + x + '">+ ' + x + '</button>'; }).join('') + '</div><div class="g2">' + field('Kinh nghiệm tối thiểu (năm)', 'min_years', j.min_years, { type: 'number', step: '0.5' }) + '</div>' +
      '<div class="g2"><div class="fld"><label class="lbl">Trạng thái</label>' + sel('status', [['draft', 'Nháp (chưa hiện)'], ['open', 'Đang mở (hiện công khai)'], ['paused', 'Tạm dừng'], ['closed', 'Đã đóng']], j.status) + '</div><div class="fld"><label class="lbl">Mức ưu tiên (chỉ mình bạn thấy)</label>' + sel('priority', [['normal', 'Thường'], ['high', '▲ Cao'], ['urgent', '🔥 Gấp']], j.priority || 'normal') + '</div></div>' +
      '<div class="sec"><span class="lbl">Nội dung JD</span>' + field('Tóm tắt (1–2 câu)', 'summary', j.summary, { area: 1 }) + field('Bạn sẽ làm gì (mỗi ý một dòng)', 'responsibilities', j.responsibilities, { area: 1 }) + field('Bạn cần có (mỗi ý một dòng)', 'requirements', j.requirements, { area: 1 }) + field('Quyền lợi (mỗi ý một dòng)', 'benefits', j.benefits, { area: 1 }) +
      '<div class="muted" style="font-size:12.5px">Số lượng tuyển không hiển thị. Giờ làm việc 9:00–18:00 T2–T6 và quy trình phỏng vấn 2 vòng offline tự thêm vào trang JD.</div></div>' +
      '<div class="sec"><span class="lbl">Dùng cho matching</span>' + field('Tech bắt buộc (cách nhau bằng dấu phẩy)', 'must_have_tech', (j.must_have_tech || []).join(', '), { list: 1 }) + field('Tech là điểm cộng', 'nice_to_have_tech', (j.nice_to_have_tech || []).join(', '), { list: 1 }) + field('Domain ưu tiên', 'domains', (j.domains || []).join(', '), { list: 1 }) + '</div></div>' +
      '<div class="df"><button class="b pri" data-act="savejob" data-id="' + esc(j.id) + '" type="button">Lưu job</button>' +
      (j.id ? '<a class="b" href="/jobs/' + esc(j.slug) + '" target="_blank" rel="noopener">Xem trang công khai</a><button class="b" data-act="copy" data-t="' + esc(location.origin + '/jobs/' + j.slug) + '" type="button">Chép link</button><button class="b dng" data-act="deljob" data-id="' + j.id + '" type="button">Xoá</button>' : '') + '</div>');
  }

  /* ---------- matching ---------- */
  var MATCH = { job: '', res: null, busy: false };
  VIEWS.matching = function () {
    var jobs = S.jobs.filter(function (j) { return j.status !== 'closed'; });
    $('#view').innerHTML = '<div class="ph"><h1>Matching</h1></div><div class="box" style="padding:16px;margin-bottom:16px"><div class="tb" style="margin:0"><select class="i2 grow" id="mjob"><option value="">Chọn job…</option>' +
      jobs.map(function (j) { return '<option value="' + j.id + '"' + (MATCH.job === j.id ? ' selected' : '') + '>' + esc(j.title) + (j.status !== 'open' ? ' (' + j.status + ')' : '') + '</option>'; }).join('') +
      '</select><button class="b pri" id="mgo" data-act="matchgo" type="button">Tìm ứng viên phù hợp</button></div><div class="muted" style="font-size:13px;margin-top:10px">Tầng 1 lọc cứng theo năm kinh nghiệm và tech bắt buộc của job (miễn phí). Tầng 2 để AI chấm điểm tối đa 24 người đứng đầu, kèm lý do mạnh và thiếu.</div><div id="mprog"></div></div><div id="mres"></div>';
    if (MATCH.res && MATCH.job) paintMatch();
  };
  function runMatch() {
    var job = $('#mjob').value;
    if (!job) return toast('Chọn một job trước nhé.', true);
    if (MATCH.busy) return;
    MATCH.busy = true; MATCH.job = job; MATCH.res = null; $('#mres').innerHTML = '';
    var prog = $('#mprog'), btn = $('#mgo'); btn.disabled = true;
    prog.innerHTML = '<div class="muted" style="margin-top:12px">Đang lọc cứng…</div>';
    var pool;
    api('match.stage1', { job_id: job }).then(function (s1) {
      pool = s1.pool;
      if (!pool.length) { prog.innerHTML = '<div class="alert info" style="margin:12px 0 0">Tầng 1 không giữ lại ai (' + s1.total + ' CV trong kho). Thử giảm "kinh nghiệm tối thiểu" hoặc bớt tech bắt buộc ở job này.</div>'; return null; }
      var todo = pool.slice(0, 24), results = [], i = 0;
      var step = function () {
        if (i >= todo.length) return Promise.resolve(results);
        var batch = todo.slice(i, i + 6);
        prog.innerHTML = '<div style="margin-top:12px">Tầng 1: <b>' + s1.passed + '</b> / ' + s1.total + ' người qua lọc cứng · AI đang chấm điểm ' + Math.min(i + 6, todo.length) + '/' + todo.length + '</div><div class="bar-wrap"><i style="width:' + Math.round(i / todo.length * 100) + '%"></i></div>';
        return api('match.score', { job_id: job, ids: batch.map(function (p) { return p.id; }) }).then(function (r) { results = results.concat(r.results); i += 6; return step(); });
      };
      return step().then(function (results) {
        var by = {}; results.forEach(function (x) { by[x.candidate_id] = x; });
        MATCH.res = todo.map(function (p) { var x = by[p.id] || {}; return Object.assign({}, p, { score: x.score || 0, strengths: x.strengths || '', gaps: x.gaps || '' }); }).sort(function (a, b) { return b.score - a.score; });
        MATCH.meta = { total: s1.total, passed: s1.passed };
        prog.innerHTML = '<div style="margin-top:12px">Tầng 1: <b>' + s1.passed + '</b> / ' + s1.total + ' người qua lọc cứng · đã chấm điểm <b>' + todo.length + '</b></div>';
        paintMatch();
      });
    }).catch(fail).then(function () { MATCH.busy = false; var b = $('#mgo'); if (b) b.disabled = false; });
  }
  function paintMatch() {
    var el = $('#mres'); if (!el || !MATCH.res) return;
    var rows = MATCH.res;
    el.innerHTML = '<div class="box">' + rows.map(function (r) {
      var k = r.score >= 70 ? 'hi' : r.score >= 50 ? 'md' : 'lo';
      return '<div class="mrow"><input type="checkbox" data-pick="' + r.id + '"' + (r.has_app ? ' disabled' : (r.score >= 70 ? ' checked' : '')) + ' aria-label="Chọn ' + esc(r.name) + '"><div><div class="t1"><a href="#/candidates/' + r.id + '" style="color:inherit">' + esc(r.name) + '</a><small>' + (Number(r.years) || 0) + ' năm' + (r.positions && r.positions[0] ? ' · ' + esc(r.positions[0]) : '') + '</small>' + (r.has_app ? ' <span class="badge wait">Đã trong pipeline</span>' : '') + '</div>' +
        '<div class="chips" style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap">' + (r.overlap || []).map(function (t) { return '<span class="mini hit">' + esc(t) + '</span>'; }).join('') + (r.niceHit || []).map(function (t) { return '<span class="mini">' + esc(t) + '</span>'; }).join('') + '</div>' +
        (r.strengths ? '<div class="g"><b>Mạnh:</b> ' + esc(r.strengths) + '</div>' : '') + (r.gaps ? '<div class="g x"><b>Thiếu:</b> ' + esc(r.gaps) + '</div>' : '') + '</div><div class="score ' + k + '">' + r.score + '</div></div>';
    }).join('') + '</div><div class="sticky-act"><button class="b pri" data-act="addpicked" type="button">Thêm người đã chọn vào pipeline</button></div>';
  }
  function addPicked() {
    var ids = $$('[data-pick]:checked').map(function (x) { return x.getAttribute('data-pick'); });
    if (!ids.length) return toast('Chưa chọn ai.', true);
    var btn = $('[data-act="addpicked"]'); btn.disabled = true;
    var made = 0, i = 0;
    var next = function () {
      if (i >= ids.length) return Promise.resolve();
      var p = MATCH.res.filter(function (r) { return r.id === ids[i]; })[0]; i++;
      return api('apps.create', { job_id: MATCH.job, candidate_id: p.id, match_score: p.score, match_reason: p.strengths }).then(function (r) { if (r.created) { made++; p.has_app = true; } }).then(next);
    };
    next().then(function () { toast('Đã thêm ' + made + ' người vào pipeline'); return refreshApps(); }).then(paintMatch).catch(fail).then(function () { btn.disabled = false; });
  }


  /* ---------- hỏi đáp dưới job ---------- */
  VIEWS.inbox = function () {
    $('#view').innerHTML = '<div class="ph"><h1>Hỏi đáp</h1></div><div class="box" id="thlist"><div class="none">Đang tải…</div></div>';
    loadThreads();
  };
  function loadThreads() {
    return api('threads.list').then(function (r) {
      S.threads = r.threads; S.unread = r.threads.filter(function (t) { return t.unread_admin; }).length; renderNav();
      var el = $('#thlist'); if (!el) return;
      el.innerHTML = r.threads.length ? r.threads.map(function (t) {
        return '<div class="li' + (t.unread_admin ? ' unread' : '') + '" data-act="thread" data-id="' + t.id + '"><span class="sdot"></span><div class="tx"><div class="t1">' + esc(t.author_name) + ' · ' + esc(t.job_title) + '</div><div class="t2">' + (t.last_from === 'recruiter' ? 'Bạn: ' : '') + esc(t.last_body) + '</div></div>' +
          (t.is_public ? '<span class="stt open">Công khai</span>' : '') + '<span class="dt num">' + ago(t.updated_at) + '</span></div>';
      }).join('') : '<div class="none">Chưa có câu hỏi nào. Ứng viên đặt câu hỏi ở cuối trang mỗi job, bạn sẽ nhận thông báo Telegram.</div>';
    }).catch(fail);
  }
  function openThread(id) {
    S.open = { type: 'thread', id: id }; setHash('inbox/' + id);
    return api('threads.get', { id: id }).then(function (r) {
      var t = r.thread;
      var bubbles = r.messages.map(function (m) {
        return '<div class="msg ' + (m.sender === 'recruiter' ? 'me' : 'them') + '"><div class="who">' + (m.sender === 'recruiter' ? 'Bạn' : esc(t.author_name)) + ' · ' + dt(m.created_at) + '</div><div class="bd">' + esc(m.body) + '</div></div>';
      }).join('');
      drawer('<div class="dh"><div style="flex:1;min-width:0"><h2>' + esc(t.author_name) + '</h2><div class="s">' + esc(t.job_title) + ' · <a href="mailto:' + esc(t.author_email) + '">' + esc(t.author_email) + '</a></div></div><button class="b sm" data-act="close" type="button">Đóng</button></div><div class="db">' +
        '<div class="sec"><span class="lbl">Hiển thị</span><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span class="stt ' + (t.is_public ? 'open' : 'draft') + '">' + (t.is_public ? 'Đang công khai dưới job' : 'Riêng tư (chỉ bạn và ứng viên)') + '</span>' +
        '<button class="b sm" data-act="tpub" data-id="' + t.id + '" data-v="' + (t.is_public ? '0' : '1') + '" type="button">' + (t.is_public ? 'Gỡ công khai' : 'Đăng công khai') + '</button></div>' +
        '<div class="muted" style="font-size:12.5px;margin-top:6px">Khi công khai, người xem chỉ thấy tên gọi (VD "' + esc(String(t.author_name).trim().split(/\s+/).pop()) + '") và nội dung hỏi đáp, không thấy email.</div></div>' +
        '<div class="sec"><span class="lbl">Hội thoại</span><div class="thread">' + bubbles + '</div></div>' +
        '<div class="sec"><span class="lbl">Trả lời</span><textarea class="i2" id="treply" maxlength="1500" placeholder="Nội dung trả lời. Ứng viên sẽ nhận email kèm link để xem và nhắn tiếp."></textarea>' +
        '<label class="chk"><input type="checkbox" id="tpubnow"' + (t.is_public ? ' disabled checked' : '') + '>Đăng công khai cùng lúc</label></div></div>' +
        '<div class="df"><button class="b pri" data-act="tsend" data-id="' + t.id + '" type="button">Gửi trả lời</button><button class="b dng" data-act="tdel" data-id="' + t.id + '" type="button">Xoá</button></div>');
      var tb = $('.drawer .thread'); if (tb) tb.scrollTop = tb.scrollHeight;
      return loadThreadsIfOpen();
    }).catch(fail);
  }
  function loadThreadsIfOpen() { return S.tab === 'inbox' && $('#thlist') ? loadThreads() : refreshJobs().catch(function () {}); }

  /* ---------- sự kiện ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act],[data-tech],[data-dom]'); if (!t) return;
    var act = t.getAttribute('data-act'), id = t.getAttribute('data-id');
    if (t.hasAttribute('data-tech') && !act) { var v = t.getAttribute('data-tech'), i = S.f.tech.indexOf(v); if (i >= 0) S.f.tech.splice(i, 1); else S.f.tech.push(v); return paintCands(); }
    if (t.hasAttribute('data-dom') && !act) { var d = t.getAttribute('data-dom'), j = S.f.dom.indexOf(d); if (j >= 0) S.f.dom.splice(j, 1); else S.f.dom.push(d); return paintCands(); }
    switch (act) {
      case 'rpreset': { var pv = id; S.rep.preset = pv; if (pv !== 'custom') Object.assign(S.rep, repRange(pv)); S.rep.data = null; return pv === 'custom' ? paintReport() : loadReport(); }
      case 'rcsv': if (!isPro()) return toast('Xuất CSV và xem theo ngày/tuần/quý/năm chỉ có ở gói Pro. Xem mục Cài đặt để nâng cấp.', true); return repCsv();
      case 'logout': return logout();
      case 'pay-plan': { var im = $('#payimg'); if (im && S.plan && S.plan.pay) im.src = payUrl(S.plan, t.getAttribute('data-v')); $$('[data-act="pay-plan"]').forEach(function (x) { x.classList.toggle('on', x === t); }); return; }
      case 'copy-url': return copy(t.getAttribute('data-v'), t);
      case 'as-exit': S.as = ''; store('lh_as', ''); location.hash = '#/overview'; return boot();
      case 'rep-set': return api('reports.update', { id: id, status: t.getAttribute('data-v') }).then(loadReports).catch(fail);
      case 'rep-del': if (!confirm('Xoá báo cáo này?')) return; return api('reports.update', { id: id, delete: true }).then(loadReports).catch(fail);
      case 'reload': location.reload(); return;
      case 'bill-toggle': {
        var turnOn = !S.billing;
        if (!confirm(turnOn ? 'Bật tính phí? Người dùng Free sẽ bị giới hạn và thấy giá nâng cấp Pro.' : 'Tắt tính phí? Mọi người dùng đủ tính năng, không giới hạn.')) return;
        return api('billing.set', { on: turnOn }).then(function (r) { S.billing = !!r.billing; toast(S.billing ? 'Đã bật tính phí' : 'Đã tắt tính phí'); paintRecs(); return api('bootstrap').then(function (d) { S.plan = d.plan; S.me = d.me; }).catch(function () {}); }).catch(fail);
      }
      case 'rec-plan': {
        var life = t.getAttribute('data-m') === 'life', mo = life ? 0 : Number(t.getAttribute('data-m'));
        if (!life && mo === 0 && !confirm('Đưa tài khoản này về gói Free ngay?')) return;
        if (life && !confirm('Cấp gói Pro vĩnh viễn cho tài khoản này?')) return;
        return api('recruiters.update', life ? { id: id, plan_lifetime: true } : { id: id, plan_months: mo }).then(function () { toast(life ? 'Đã cấp Pro vĩnh viễn' : mo ? 'Đã cộng ' + mo + ' tháng Pro' : 'Đã về gói Free'); return api('recruiters.list'); }).then(function (r) { S.recs = r.recruiters; paintRecs(); }).catch(fail);
      }
      case 'rec-view': S.as = id; store('lh_as', id); location.hash = '#/overview'; return boot();
      case 'rec-set': {
        var k = t.getAttribute('data-k'), v2 = t.getAttribute('data-v'), pay = { id: id };
        if (k === 'status' && v2 === 'suspended' && !confirm('Khoá tài khoản này? Họ sẽ không đăng nhập được và job của họ sẽ ẩn khỏi trang công khai.')) return;
        pay[k] = v2;
        return api('recruiters.update', pay).then(function () { toast('Đã cập nhật'); return api('recruiters.list'); }).then(function (r) { S.recs = r.recruiters; paintRecs(); }).catch(fail);
      }
      case 'close': return closeLayer();
      case 'thread': return openThread(id);
      case 'tpub': return api('threads.publish', { id: id, is_public: t.getAttribute('data-v') === '1' }).then(function (r) { toast(r.is_public ? 'Đã đăng công khai dưới job' : 'Đã gỡ khỏi trang công khai'); return openThread(id); }).catch(fail);
      case 'tsend': {
        var body = $('#treply').value.trim(); if (body.length < 2) return toast('Bạn chưa nhập nội dung trả lời.', true);
        t.disabled = true;
        return api('threads.reply', { id: id, body: body, publish: !!($('#tpubnow') && $('#tpubnow').checked && !$('#tpubnow').disabled) }).then(function () { toast('Đã gửi, ứng viên nhận email'); return openThread(id); }).catch(function (e) { t.disabled = false; fail(e); });
      }
      case 'tdel':
        if (!confirm('Xoá cuộc hội thoại này? Không hoàn tác được.')) return;
        return api('threads.delete', { id: id }).then(function () { toast('Đã xoá'); closeLayer(); return loadThreadsIfOpen(); }).catch(fail);
      case 'cand': return openCandidate(id);
      case 'app': return openApp(id);
      case 'job': return openJob(id);
      case 'jpicktoggle': JF.pick = !JF.pick; if (!JF.pick) JF.sel = {}; return paintJobs();
      case 'jpickoff': JF.pick = false; JF.sel = {}; return paintJobs();
      case 'jpick': if (JF.sel[id]) delete JF.sel[id]; else JF.sel[id] = 1; return paintJobs();
      case 'jall': jobsFiltered((function () { var c = {}; S.apps.forEach(function (a) { if (a.job_id) c[a.job_id] = 1; }); return c; })()).forEach(function (j) { JF.sel[j.id] = 1; }); return paintJobs();
      case 'jfs': JF.status = t.getAttribute('data-v'); paintJobFilters(); return paintJobs();
            case 'jprio': { var cur = S.jobs.filter(function (x) { return x.id === id; })[0]; if (!cur) return; var nx = PRIO_NEXT[cur.priority || 'normal'];
        return api('jobs.save', { id: id, priority: nx }).then(function () { toast('Ưu tiên: ' + PRIO[nx][0]); return jobsReload(); }).catch(fail); }
      case 'jstat': { var sv = t.getAttribute('data-v');
        return api('jobs.save', { id: id, status: sv }).then(function () { toast('Đã chuyển sang "' + JLABEL[sv] + '"'); return jobsReload(); }).catch(fail); }
      case 'jdup': return api('jobs.duplicate', { id: id }).then(function (r) { toast('Đã nhân đôi thành bản nháp'); return refreshJobs().then(function () { VIEWS.jobs(); openJob(r.job.id); }); }).catch(fail);
      case 'jpipe': S.pjob = id; location.hash = '#/pipeline'; return;
      case 'jbulk': {
        var bk = t.getAttribute('data-k'), bv = t.getAttribute('data-v'), nn = Object.keys(JF.sel).length;
        if (bk === 'delete') { if (!confirm('Xoá ' + nn + ' job đã chọn? Job đã có hồ sơ sẽ được giữ lại. Không hoàn tác được.')) return; return jobsBulk({ delete: true }); }
        if (bv === 'closed' && !confirm('Đóng ' + nn + ' job đã chọn?')) return;
        return jobsBulk({ status: bv }); }
      case 'locadd': { var li = $('.drawer [data-k="location"]'); if (!li) return; var v = t.getAttribute('data-v'), parts = li.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
        if (parts.map(plain).indexOf(plain(v)) < 0) parts.push(v); li.value = parts.join(', '); return; }
      case 'newjob': return openJob('new');
      case 'rtech': S.f.tech = []; return paintCands();
      case 'rdom': S.f.dom = []; return paintCands();
      case 'mtech': S.f.techLimit = 999; return paintCands();
      case 'mdom': S.f.domLimit = 999; return paintCands();
      case 'copy': return copy(t.getAttribute('data-t'), t);
      case 'reopen': return openCandidate(id);
      case 'matchgo': return runMatch();
      case 'addpicked': return addPicked();
      case 'savecand': return saveCand(id);
      case 'saveapp': return saveApp(id);
      case 'savejob': return saveJob(id);
      case 'reparse': return api('candidates.reparse', { id: id }).then(function () { if (S.tried) delete S.tried[id]; toast('AI đang đọc lại CV'); return refreshCands(); }).then(function () { paintCands(); openCandidate(id); }).catch(fail);
      case 'delcand':
        if (!confirm('Xoá hồ sơ này cùng toàn bộ application và file CV? Không hoàn tác được.')) return;
        return api('candidates.delete', { id: id }).then(function () { toast('Đã xoá hồ sơ'); closeLayer(); return Promise.all([refreshCands(), refreshApps()]); }).then(function () { paintCands(); }).catch(fail);
      case 'merge':
        if (!confirm('Gộp hồ sơ này vào hồ sơ cũ? Kỹ năng và application sẽ được hợp nhất.')) return;
        return api('candidates.merge', { from: t.getAttribute('data-from'), to: t.getAttribute('data-to') }).then(function (r) { toast('Đã gộp hồ sơ'); return Promise.all([refreshCands(), refreshApps()]).then(function () { paintCands(); openCandidate(r.id); }); }).catch(fail);
      case 'addapp': {
        var jid = $('#addjob').value; if (!jid) return toast('Chọn job trước nhé.', true);
        return api('apps.create', { job_id: jid, candidate_id: id }).then(function (r) { toast(r.created ? 'Đã thêm vào pipeline' : 'Ứng viên đã có trong job này', !r.created); return refreshApps(); }).then(function () { openCandidate(id); }).catch(fail);
      }
      case 'addnote': {
        var n = $('#newnote').value.trim(); if (!n) return;
        return api('activities.add', { application_id: id, note: n }).then(function () { openApp(id); }).catch(fail);
      }
      case 'jdai': {
        var txt = $('#jdtext').value.trim(); if (txt.length < 40) return toast('Dán nội dung JD dài hơn nhé.', true);
        t.disabled = true; t.textContent = 'AI đang đọc…';
        return api('jobs.fromText', { text: txt, lang: ($('.drawer [data-k="lang"]') || {}).value || 'vi' }).then(function (r) {
          Object.keys(r.job).forEach(function (k) {
            var el = $('.drawer [data-k="' + k + '"]'); if (!el) return;
            el.value = Array.isArray(r.job[k]) ? r.job[k].join(', ') : r.job[k];
          });
          toast('Đã điền form, bạn kiểm tra lại rồi bấm Lưu job');
        }).catch(fail).then(function () { t.disabled = false; t.textContent = 'Điền tự động bằng AI'; });
      }
      case 'deljob':
        if (!confirm('Xoá job này?')) return;
        return api('jobs.delete', { id: id }).then(function () { toast('Đã xoá job'); closeLayer(); return refreshJobs(); }).then(function () { VIEWS.jobs(); }).catch(fail);
    }
  });

  function saveCand(id) {
    var o = collect(); o.id = id;
    api('candidates.save', o).then(function (r) {
      var i = S.cands.findIndex(function (c) { return c.id === id; });
      if (i >= 0) S.cands[i] = prep(Object.assign(S.cands[i], r.candidate)); else S.cands.unshift(prep(r.candidate));
      toast('Đã lưu'); paintCands(); renderNav();
    }).catch(fail);
  }
  function saveApp(id) {
    var o = collect(); o.id = id;
    api('apps.update', o).then(function (r) {
      toast(o.notify ? (r.emailed ? 'Đã lưu và gửi email cho ứng viên' : 'Đã lưu (chưa gửi được email, kiểm tra cấu hình Resend)') : 'Đã lưu', o.notify && !r.emailed);
      return refreshApps();
    }).then(function () { if (S.tab === 'pipeline') paintPipe(); if (S.tab === 'overview') VIEWS.overview(); openApp(id); }).catch(fail);
  }
  function saveJob(id) {
    var o = collect(); if (id) o.id = id;
    api('jobs.save', o).then(function (r) { toast('Đã lưu job'); return refreshJobs().then(function () { VIEWS.jobs(); openJob(r.job.id); }); }).catch(fail);
  }

  document.addEventListener('input', function (e) {
    var t = e.target;
    if (t.id === 'cq') { S.f.q = t.value; clearTimeout(S._qt); S._qt = setTimeout(paintCands, 120); }
    if (t.id === 'cy') { S.f.minY = t.value; paintCands(); var el = $('#cy'); if (el) { el.focus(); } }
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.id === 'co') { S.f.openOnly = t.checked; paintCands(); }
    if (S.rep && (t.id === 'rfrom' || t.id === 'rto' || t.id === 'rgroup')) {
      if (t.id === 'rgroup') S.rep.group = t.value; else { S.rep[t.id === 'rfrom' ? 'from' : 'to'] = t.value; S.rep.preset = 'custom'; }
      if (S.rep.from && S.rep.to) { S.rep.data = null; loadReport(); }
    }
    if (t.id === 'csort') { S.f.sort = t.value; paintCands(); }
    if (t.id === 'pjob') { S.pjob = t.value; paintPipe(); }
    if (t.id === 'mjob') { MATCH.job = t.value; MATCH.res = null; $('#mres').innerHTML = ''; $('#mprog').innerHTML = ''; }
    if (t.id === 'upl') { uploadFiles(t.files); t.value = ''; }
  });
  document.addEventListener('change', function (e) { if (e.target && e.target.id === 'jbprio' && e.target.value) { var v = e.target.value; e.target.value = ''; jobsBulk({ priority: v }); } });
  document.addEventListener('click', function (e) { if (e.target.id === 'cfilt') $('#cside').classList.toggle('open'); });
  document.addEventListener('dragover', function (e) { var dz = $('#dz'); if (dz && e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) { e.preventDefault(); dz.classList.add('over'); } });
  document.addEventListener('dragleave', function (e) { var dz = $('#dz'); if (dz && !e.relatedTarget) dz.classList.remove('over'); });
  document.addEventListener('drop', function (e) { var dz = $('#dz'); if (dz && e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); dz.classList.remove('over'); uploadFiles(e.dataTransfer.files); } });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && $('#layer .drawer')) closeLayer();
    if ((e.metaKey || e.ctrlKey) && e.key === 'k' && $('#cq')) { e.preventDefault(); $('#cq').focus(); }
  });

  function init() {
    fetch('/api/auth').then(function (r) { return r.json(); }).then(function (j) { AUTH = j || AUTH; }).catch(function () {}).then(function () {
      var rm = /^#\/reset\/([A-Za-z0-9_-]+)/.exec(location.hash);
      if (rm) return showLogin('reset', rm[1]);
      if (location.hash === '#/register') { history.replaceState(null, '', '/admin/'); return fetch('/api/admin', { method: 'POST', headers: { 'content-type': 'application/json', 'x-lh': '1' }, body: '{"action":"bootstrap"}' }).then(function (r) { if (r.ok) return boot(); showLogin('register'); }); }
      if (googleReturn()) return;
      boot();
    });
  }
  /* Dùng như ứng dụng trên iPhone (ghim màn hình chính) thì không có nút tải lại: kéo từ đầu trang xuống để tải lại. */
  (function pullToRefresh() {
    var standalone = (window.navigator && window.navigator.standalone) || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    if (!standalone) return;
    var ind = document.createElement('div'); ind.className = 'ptr'; ind.textContent = '\u21BB Kéo xuống để tải lại'; document.body.appendChild(ind);
    var y0 = null, dy = 0;
    function reset() { y0 = null; dy = 0; ind.style.opacity = '0'; ind.style.transform = 'translate(-50%, -40px)'; }
    document.addEventListener('touchstart', function (e) {
      var t = e.target, blocked = t.closest && t.closest('.drawer, textarea, input, select, .kan, table, .scroll');
      y0 = (window.scrollY <= 0 && !blocked && e.touches.length === 1) ? e.touches[0].clientY : null; dy = 0;
    }, { passive: true });
    document.addEventListener('touchmove', function (e) {
      if (y0 === null) return;
      dy = e.touches[0].clientY - y0;
      if (dy <= 8 || window.scrollY > 0) { ind.style.opacity = '0'; return; }
      var k = Math.min(dy, 120);
      ind.style.opacity = String(Math.min(1, k / 80)); ind.style.transform = 'translate(-50%, ' + (k / 2 - 40) + 'px)';
      ind.textContent = dy > 90 ? '\u21BB Thả để tải lại' : '\u21BB Kéo xuống để tải lại';
    }, { passive: true });
    document.addEventListener('touchend', function () { var go = y0 !== null && dy > 90 && window.scrollY <= 0; reset(); if (go) location.reload(); }, { passive: true });
    document.addEventListener('touchcancel', reset, { passive: true });
  })();
  init();
})();
