/* Luna — trang công khai: danh sách job, JD + ứng tuyển, tra cứu hồ sơ */
(function () {
  'use strict';
  var LH = window.LH || {};
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var MAX_CV = 4 * 1024 * 1024;

  function api(path, body) {
    var opt = body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
    return fetch(path, opt).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || 'Có lỗi xảy ra, bạn thử lại nhé.'); e.status = r.status; throw e; }
        return j;
      });
    });
  }

  function fmtDate(iso, withTime) {
    var d = new Date(iso); if (isNaN(d)) return '';
    var s = d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    return withTime ? s + ' · ' + d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : s;
  }
  function bullets(text) {
    return String(text || '').split('\n').map(function (l) { return l.replace(/^\s*[-•*·–]\s*/, '').trim(); }).filter(Boolean);
  }
  function list(text) { var b = bullets(text); return b.length ? '<ul>' + b.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : ''; }
  function chips(arr, cls, max) {
    arr = (arr || []).slice(0, max || 99);
    return arr.map(function (t) { return '<span class="chip ' + (cls || '') + '">' + esc(t) + '</span>'; }).join('');
  }

  /* ---------- khung trang ---------- */
  function chrome() {
    var page = document.body.getAttribute('data-page');
    var nav = [['/', 'Việc làm', 'home'], ['/apply', 'Gửi CV', 'apply'], ['/track', 'Tra cứu', 'track']];
    var top = $('#top');
    if (top) {
      top.className = 'top';
      top.innerHTML = '<div class="wrap"><a class="logo" href="/"><span class="moon" aria-hidden="true"></span>' + esc(LH.brand || 'Luna') + '</a>' +
        '<nav class="nav" aria-label="Điều hướng">' + nav.map(function (n) {
          return '<a href="' + n[0] + '"' + (page === n[2] || (page === 'job' && n[2] === 'home') ? ' aria-current="page"' : '') + '>' + n[1] + '</a>';
        }).join('') + '</nav></div>';
    }
    var foot = $('#foot');
    if (foot) {
      var contact = [];
      if (LH.contactEmail) contact.push('<a href="mailto:' + esc(LH.contactEmail) + '">' + esc(LH.contactEmail) + '</a>');
      var ext = function (u, label) { return /^https:\/\//.test(u || '') ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + label + '</a>' : ''; };
      [ext(LH.zalo, 'Zalo'), ext(LH.facebook, 'Facebook'), ext(LH.linkedin, 'LinkedIn')].forEach(function (x) { if (x) contact.push(x); });
      if (LH.telegram) contact.push('<a href="' + esc(LH.telegram) + '" rel="noopener">Telegram</a>');
      foot.className = 'foot';
      foot.innerHTML = '<div class="wrap"><span>' + esc(LH.brand || 'Luna') + ' · ' + esc(LH.recruiter || '') + (LH.title ? ', ' + esc(LH.title) : '') + '</span>' +
        contact.join('') + '<span class="sp"><a href="/privacy.html">Quyền riêng tư</a></span></div>';
    }
  }

  function communities() {
    var box = $('#community'), list = (LH.communities || []).filter(function (c) { return /^https:\/\//.test(c.url || ''); });
    if (!box || !list.length) return;
    var ico = { linkedin: 'in', facebook: 'f', zalo: 'Z' };
    box.innerHTML = '<div class="sec-head" style="margin-top:44px"><h2>Cộng đồng tuyển dụng IT</h2></div>' +
      '<div class="comm">' + list.map(function (c) {
        return '<a class="comm-i" href="' + esc(c.url) + '" target="_blank" rel="noopener noreferrer"><span class="ci ' + esc(c.kind || '') + '" aria-hidden="true">' + (ico[c.kind] || '#') + '</span>' +
          '<span><b>' + esc(c.name || '') + '</b><small>' + esc(c.note || '') + '</small></span></a>';
      }).join('') + '</div>';
  }

  /* ---------- trang chủ ---------- */
  function home() {
    communities();
    var state = { jobs: [], q: '', level: '' };
    var box = $('#jobs');
    function render() {
      var q = state.q.toLowerCase();
      var rows = state.jobs.filter(function (j) {
        if (state.level && j.level !== state.level) return false;
        if (!q) return true;
        return (j.title + ' ' + j.level + ' ' + (j.must_have_tech || []).join(' ') + ' ' + (j.domains || []).join(' ')).toLowerCase().indexOf(q) >= 0;
      });
      $('#count').textContent = state.jobs.length;
      if (!state.jobs.length) {
        box.innerHTML = '<div class="empty"><h3>Hiện chưa có vị trí nào đang mở</h3><p>Bạn vẫn có thể gửi CV vào kho tài năng. Khi có vị trí phù hợp, mình sẽ liên hệ bạn trước khi đăng công khai.</p></div>';
        return;
      }
      if (!rows.length) { box.innerHTML = '<div class="empty"><h3>Không có vị trí khớp bộ lọc</h3><p>Thử bỏ bớt từ khoá, hoặc gửi CV vào kho tài năng ở bên dưới.</p></div>'; return; }
      box.innerHTML = rows.map(function (j) {
        return '<a class="job" href="/jobs/' + encodeURIComponent(j.slug) + '"><div><h3>' + esc(j.title) + '</h3><div class="meta">' +
          (j.level ? '<span><b>' + esc(j.level) + '</b></span>' : '') + '<span>' + esc(j.job_type || 'Full-time') + '</span>' +
          '<span>' + esc(j.salary_text || 'Thoả thuận') + '</span></div></div><span class="go" aria-hidden="true">→</span>' +
          '<div class="chips">' + chips(j.must_have_tech, 'mono', 6) + '</div></a>';
      }).join('');
    }
    function pills() {
      var levels = []; state.jobs.forEach(function (j) { if (j.level && levels.indexOf(j.level) < 0) levels.push(j.level); });
      var el = $('#levels');
      if (levels.length < 2) { el.innerHTML = ''; return; }
      el.innerHTML = ['Tất cả'].concat(levels).map(function (l, i) {
        var val = i === 0 ? '' : l;
        return '<button class="pill" type="button" data-l="' + esc(val) + '" aria-pressed="' + (state.level === val) + '">' + esc(l) + '</button>';
      }).join('');
    }
    $('#levels').addEventListener('click', function (e) {
      var b = e.target.closest('[data-l]'); if (!b) return;
      state.level = b.getAttribute('data-l'); pills(); render();
    });
    $('#q').addEventListener('input', function (e) { state.q = e.target.value.trim(); render(); });
    api('/api/jobs').then(function (r) { state.jobs = r.jobs || []; pills(); render(); })
      .catch(function () { box.innerHTML = '<div class="empty"><h3>Không tải được danh sách</h3><p>Bạn thử tải lại trang sau ít phút nhé.</p></div>'; });
  }

  /* ---------- trang JD ---------- */
  function jobPage() {
    var slug = decodeURIComponent(location.pathname.replace(/\/+$/, '').split('/').pop() || '');
    var app = $('#app');
    api('/api/jobs?slug=' + encodeURIComponent(slug)).then(function (r) {
      var j = r.job;
      document.title = j.title + ' · ' + (LH.brand || 'Luna');
      var meta = $('meta[name="description"]'); if (meta) meta.setAttribute('content', (j.summary || j.title).slice(0, 155));
      var nice = (j.nice_to_have_tech || []);
      app.innerHTML =
        '<div class="wrap"><div class="crumb"><a href="/">← Tất cả vị trí</a></div>' +
        '<header class="jd-head">' + (j.level ? '<span class="tag">' + esc(j.level) + '</span>' : '') + '<h1>' + esc(j.title) + '</h1>' +
        '<div class="jd-meta"><span>' + esc(j.job_type || 'Full-time') + '</span><span>' + esc(j.salary_text || 'Thoả thuận') + '</span>' +
        (Number(j.min_years) ? '<span>Từ ' + esc(j.min_years) + ' năm kinh nghiệm</span>' : '') + '</div></header>' +
        '<div class="jd-grid"><div class="jd-body">' +
        (j.summary ? '<section><p style="font-size:18px">' + esc(j.summary) + '</p></section>' : '') +
        (bullets(j.responsibilities).length ? '<section><h2>Bạn sẽ làm gì</h2>' + list(j.responsibilities) + '</section>' : '') +
        (bullets(j.requirements).length ? '<section><h2>Bạn cần có</h2>' + list(j.requirements) + '</section>' : '') +
        (nice.length ? '<section><h2>Là điểm cộng</h2><div class="chips">' + chips(nice, 'nice') + '</div></section>' : '') +
        (bullets(j.benefits).length ? '<section><h2>Quyền lợi</h2>' + list(j.benefits) + '</section>' : '') +
        '<section><h2>Cách làm việc và quy trình</h2><ul><li>Giờ làm việc 9:00–18:00, thứ Hai đến thứ Sáu.</li>' +
        '<li>Phỏng vấn 2 vòng, online hoặc offline tuỳ vị trí.</li><li>Bạn tra cứu tiến độ hồ sơ bất cứ lúc nào bằng mã hồ sơ.</li></ul></section></div>' +
        '<aside class="side"><div class="facts"><dl>' +
        ((j.must_have_tech || []).length ? '<div><dt>Công nghệ chính</dt><dd><div class="chips">' + chips(j.must_have_tech, 'mono') + '</div></dd></div>' : '') +
        ((j.domains || []).length ? '<div><dt>Lĩnh vực</dt><dd>' + esc(j.domains.join(', ')) + '</dd></div>' : '') +
        '<div><dt>Mức lương</dt><dd>' + esc(j.salary_text || 'Thoả thuận') + '</dd></div></dl></div>' +
        '<a class="btn block" href="#apply">Ứng tuyển vị trí này</a></aside></div>' +
        '<section class="apply-box" id="apply"><h2>Ứng tuyển</h2><p class="sub">Điền một lần, nhận mã hồ sơ để theo dõi kết quả.</p><div id="form"></div></section></div>' +
        '<div class="stickybar" id="sticky"><a class="btn block" href="#apply">Ứng tuyển vị trí này</a></div>';
      document.body.classList.add('has-sticky');
      mountApply($('#form'), j);
      var form = $('#apply'), bar = $('#sticky');
      if ('IntersectionObserver' in window) new IntersectionObserver(function (en) { bar.classList.toggle('gone', en[0].isIntersecting); }, { threshold: 0.05 }).observe(form);
    }).catch(function (e) {
      app.innerHTML = '<div class="wrap"><div class="empty" style="padding-top:64px"><h3>' + (e.status === 404 ? 'Vị trí này đã đóng hoặc không tồn tại' : 'Không tải được JD') + '</h3><p>' +
        (e.status === 404 ? 'Có thể vị trí đã tuyển xong. Bạn xem các vị trí đang mở hoặc gửi CV vào kho tài năng nhé.' : 'Bạn thử tải lại trang.') + '</p><p style="margin-top:20px"><a class="btn" href="/">Xem vị trí đang mở</a></p></div></div>';
    });
  }

  /* ---------- form ứng tuyển (dùng chung JD + kho tài năng) ---------- */
  function mountApply(el, job) {
    el.innerHTML =
      '<form id="af" novalidate><div id="aerr" role="alert" class="alert err hide"></div>' +
      '<div class="row2"><div class="field"><label for="f-name">Họ và tên</label><input class="in" id="f-name" name="full_name" autocomplete="name" required maxlength="100"></div>' +
      '<div class="field"><label for="f-phone">Số điện thoại</label><input class="in" id="f-phone" name="phone_number" type="tel" inputmode="tel" autocomplete="tel" placeholder="09xx xxx xxx" required></div></div>' +
      '<div class="field"><label for="f-email">Email</label><input class="in" id="f-email" name="email" type="email" inputmode="email" autocomplete="email" required maxlength="120"><span class="help">Mã hồ sơ sẽ được gửi vào email này.</span></div>' +
      '<div class="row2"><div class="field"><label for="f-addr">Tỉnh / thành phố <span class="opt">(không bắt buộc)</span></label><input class="in" id="f-addr" name="address" list="cities" autocomplete="address-level1" maxlength="60"><datalist id="cities"><option>Hà Nội</option><option>Hồ Chí Minh</option><option>Đà Nẵng</option><option>Hải Phòng</option><option>Cần Thơ</option><option>Huế</option><option>Bình Dương</option><option>Đồng Nai</option></datalist></div>' +
      '<div class="field"><label for="f-sal">Lương mong muốn <span class="opt">(không bắt buộc)</span></label><input class="in" id="f-sal" name="expected_salary" placeholder="VD: 35 triệu, thoả thuận" maxlength="60"></div></div>' +
      '<div class="row2"><div class="field"><label for="f-notice">Thời gian có thể bắt đầu <span class="opt">(không bắt buộc)</span></label><select class="in" id="f-notice" name="notice_period"><option value="">Chọn…</option><option>Có thể bắt đầu ngay</option><option>Sau 2 tuần</option><option>Sau 1 tháng</option><option>Sau 2 tháng trở lên</option></select></div>' +
      '<div class="field"><label for="f-links">LinkedIn / GitHub <span class="opt">(không bắt buộc)</span></label><input class="in" id="f-links" name="links" type="url" inputmode="url" placeholder="https://" maxlength="300"></div></div>' +
      '<div class="field"><span class="lab">CV của bạn</span><label class="drop" id="drop" for="f-cv"><span class="ico" aria-hidden="true">⬆</span><span><span class="t" id="cvt">Chọn file CV</span><br><span class="s" id="cvs">PDF, DOCX, JPG hoặc PNG · tối đa 4MB</span></span><input id="f-cv" type="file" accept=".pdf,.docx,.jpg,.jpeg,.png,application/pdf"></label></div>' +
      '<div class="field"><label for="f-note">Lời nhắn <span class="opt">(không bắt buộc)</span></label><textarea class="in" id="f-note" name="cover_note" maxlength="1200" placeholder="Vài dòng về điều bạn đang tìm kiếm."></textarea></div>' +
      '<input class="hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">' +
      '<label class="check" style="margin-bottom:20px"><input type="checkbox" id="f-consent"><span>Mình đồng ý để ' + esc(LH.recruiter || 'Luna') + ' lưu hồ sơ và thông tin liên hệ này để phục vụ tuyển dụng, kể cả liên hệ về các vị trí phù hợp khác. Xem <a href="/privacy.html" target="_blank" rel="noopener">chính sách quyền riêng tư</a>.</span></label>' +
      '<button class="btn block" type="submit" id="asub">' + (job ? 'Gửi hồ sơ ứng tuyển' : 'Gửi CV vào kho tài năng') + '</button></form>';

    var file = null, form = $('#af'), err = $('#aerr'), drop = $('#drop');
    function showErr(m, focus) { err.textContent = m; err.classList.remove('hide'); err.scrollIntoView({ block: 'center', behavior: 'smooth' }); if (focus) focus.focus(); }
    function setFile(f) {
      file = null; drop.classList.remove('has'); $('#cvt').textContent = 'Chọn file CV'; $('#cvs').textContent = 'PDF, DOCX, JPG hoặc PNG · tối đa 4MB';
      if (!f) return;
      var ext = (f.name.split('.').pop() || '').toLowerCase();
      if (['pdf', 'docx', 'jpg', 'jpeg', 'png'].indexOf(ext) < 0) return showErr('Mình chỉ nhận CV dạng PDF, DOCX, JPG hoặc PNG.');
      if (f.size > MAX_CV) return showErr('CV lớn hơn 4MB. Bạn nén file hoặc xuất lại PDF nhẹ hơn nhé.');
      err.classList.add('hide'); file = f; drop.classList.add('has');
      $('#cvt').textContent = f.name; $('#cvs').textContent = (f.size / 1024 < 1024 ? Math.round(f.size / 1024) + ' KB' : (f.size / 1048576).toFixed(1) + ' MB') + ' · bấm để đổi file';
    }
    $('#f-cv').addEventListener('change', function (e) { setFile(e.target.files[0]); });
    ['dragenter', 'dragover'].forEach(function (n) { drop.addEventListener(n, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (n) { drop.addEventListener(n, function () { drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) { e.preventDefault(); if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]); });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      err.classList.add('hide');
      var v = function (id) { return $(id).value.trim(); };
      if (v('#f-name').length < 2) return showErr('Bạn nhập giúp mình họ tên nhé.', $('#f-name'));
      if (v('#f-phone').replace(/\D/g, '').length < 9) return showErr('Số điện thoại chưa đúng, bạn kiểm tra lại nhé.', $('#f-phone'));
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v('#f-email'))) return showErr('Email chưa đúng định dạng.', $('#f-email'));
      if (!file) return showErr('Bạn chưa chọn file CV.');
      if (!$('#f-consent').checked) return showErr('Bạn cần đồng ý cho mình lưu hồ sơ để tiếp tục.', $('#f-consent'));

      var btn = $('#asub'), label = btn.textContent;
      btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Đang gửi…';
      var fd = new FormData();
      var put = function (k, val) { fd.append(k, val == null ? '' : val); };
      put('job_slug', job ? job.slug : ''); put('full_name', v('#f-name')); put('phone_number', v('#f-phone')); put('email', v('#f-email'));
      put('address', v('#f-addr')); put('expected_salary', v('#f-sal')); put('notice_period', $('#f-notice').value); put('links', v('#f-links'));
      put('cover_note', v('#f-note')); put('website', form.elements.website.value); put('consent', 'true'); fd.append('cv', file, file.name);
      fetch('/api/apply', { method: 'POST', body: fd }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (j) {
          if (!res.ok) { var e = new Error(j.error || 'Có lỗi xảy ra, bạn thử lại nhé.'); e.status = res.status; throw e; }
          return j;
        });
      }).then(function (r) {
        if (r.duplicate) { el.innerHTML = '<div class="alert info">' + esc(r.message) + '</div><p><a class="btn ghost" href="/track">Tra cứu hồ sơ</a></p>'; return; }
        success(el, r, job);
      }).catch(function (e2) {
        btn.disabled = false; btn.textContent = label; showErr(e2.message);
      });
    });
  }

  function copyText(text, btn) {
    var done = function () { var o = btn.textContent; btn.textContent = 'Đã chép'; setTimeout(function () { btn.textContent = o; }, 1600); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, done);
    else {
      var t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); } catch (e) {} t.remove(); done();
    }
  }

  function success(el, r, job) {
    el.innerHTML = '<div class="stub"><div class="stub-top"><div class="kicker"><span class="moon" aria-hidden="true"></span>Đã nhận hồ sơ</div>' +
      '<div class="ttl">' + esc(r.job_title || 'Kho tài năng ' + (LH.brand || 'Luna')) + '</div>' +
      '<div class="code"><span id="ccode">' + esc(r.code) + '</span><button type="button" id="ccopy">Sao chép</button></div></div>' +
      '<div class="stub-bot"><p>Mình đã gửi email xác nhận tới <b>' + esc(r.email) + '</b> (nhớ xem cả mục Spam). Giữ mã này để tra cứu tiến độ bất cứ lúc nào, cùng với email hoặc số điện thoại bạn vừa nhập.</p>' +
      '<div class="hero-actions" style="margin-top:18px"><a class="btn" href="/track?code=' + encodeURIComponent(r.code) + '">Tra cứu hồ sơ</a><a class="btn ghost" href="/">Xem vị trí khác</a></div></div></div>';
    $('#ccopy').addEventListener('click', function () { copyText(r.code, this); });
    el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    var bar = $('#sticky'); if (bar) bar.classList.add('gone');
  }

  function applyPage() { mountApply($('#form'), null); }

  /* ---------- tra cứu ---------- */
  function trackPage() {
    var out = $('#out'), form = $('#tf');
    var params = new URLSearchParams(location.search);
    if (params.get('code')) $('#t-code').value = params.get('code');
    var last = null;

    function render(r) {
      last = { code: r.code, contact: $('#t-contact').value.trim() };
      var good = r.status === 'hired' || r.status === 'offer';
      var events = {}; (r.timeline || []).forEach(function (t) { events[t.status] = t.at; });
      var items;
      var idx = r.flow.map(function (f) { return f.key; }).indexOf(r.status);
      if (idx >= 0) {
        items = r.flow.map(function (f, i) {
          var st = r.status === 'hired' ? (i === idx ? 'now' : 'done') : i < idx ? 'done' : i === idx ? 'now' : '';
          return { cls: st, label: f.label, at: events[f.key] };
        });
      } else {
        items = (r.timeline || []).filter(function (t) { return t.status !== r.status; }).map(function (t) { return { cls: 'done', label: t.label, at: t.at }; });
        items.push({ cls: 'end', label: r.status_label, at: events[r.status], sub: r.failed_after ? 'Dừng sau bước: ' + r.failed_after : '' });
      }
      out.innerHTML = '<div class="stub"><div class="stub-top"><div class="kicker"><span class="moon" aria-hidden="true"></span>Hồ sơ của ' + esc(r.candidate_name) + '</div>' +
        '<div class="ttl">' + esc(r.job_title || 'Kho tài năng ' + (LH.brand || 'Luna')) + '</div><div class="code"><span>' + esc(r.code) + '</span></div></div>' +
        '<div class="stub-bot"><div class="state ' + (good ? 'good' : r.terminal && !good ? 'end' : '') + '">' + esc(r.status_label) + '</div>' +
        '<p class="hint">' + esc(r.hint) + '</p>' +
        (r.public_note ? '<div class="note"><b>' + (r.status === 'rejected' ? 'Feedback từ ' : 'Lời nhắn từ ') + esc(LH.recruiter || 'nhà tuyển dụng') + '</b>' + esc(r.public_note) + '</div>' : '') +
        '<ol class="tl">' + items.map(function (i) {
          return '<li class="' + i.cls + '">' + esc(i.label) + (i.at ? '<span class="d">' + fmtDate(i.at, true) + '</span>' : '') + (i.sub ? '<span class="d">' + esc(i.sub) + '</span>' : '') + '</li>';
        }).join('') + '</ol>' +
        '<p class="when">Nộp ngày ' + fmtDate(r.applied_at) + ' · cập nhật ' + fmtDate(r.updated_at, true) + '</p>' +
        '<div class="hero-actions" style="margin-top:18px">' + (r.terminal ? '' : '<button class="btn ghost small" type="button" id="wd">Rút hồ sơ</button>') +
        '<button class="btn ghost small" type="button" id="again">Tra cứu mã khác</button></div></div></div>';
      form.classList.add('hide');
      out.scrollIntoView({ block: 'start', behavior: 'smooth' });
      $('#again').addEventListener('click', function () { out.innerHTML = ''; form.classList.remove('hide'); $('#t-code').focus(); });
      var wd = $('#wd');
      if (wd) wd.addEventListener('click', function () {
        if (!confirm('Rút hồ sơ khỏi vị trí này? Bạn sẽ không thể hoàn tác.')) return;
        wd.disabled = true;
        api('/api/track', { code: last.code, contact: last.contact, action: 'withdraw' }).then(render).catch(function (e) { wd.disabled = false; alert(e.message); });
      });
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var err = $('#terr'); err.classList.add('hide');
      var code = $('#t-code').value.trim(), contact = $('#t-contact').value.trim();
      if (!code || !contact) { err.textContent = 'Bạn nhập đủ mã hồ sơ và email hoặc số điện thoại nhé.'; err.classList.remove('hide'); return; }
      var btn = $('#tsub'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Đang tra cứu…';
      api('/api/track', { code: code, contact: contact }).then(render).catch(function (e2) {
        err.textContent = e2.message; err.classList.remove('hide');
      }).then(function () { btn.disabled = false; btn.textContent = 'Tra cứu'; });
    });
  }

  function privacyPage() {
    var el = $('#contact');
    if (el) el.innerHTML = LH.contactEmail ? '<a href="mailto:' + esc(LH.contactEmail) + '">' + esc(LH.contactEmail) + '</a>' : 'cách trả lời trực tiếp email xác nhận mà bạn nhận được khi nộp hồ sơ';
  }

  document.addEventListener('DOMContentLoaded', function () {
    chrome();
    var p = document.body.getAttribute('data-page');
    if (p === 'home') home();
    else if (p === 'job') jobPage();
    else if (p === 'apply') applyPage();
    else if (p === 'track') trackPage();
    else if (p === 'privacy') privacyPage();
  });
})();
