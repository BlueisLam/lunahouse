/* Luna admin — kho CV, jobs, pipeline, matching */
(function () {
  'use strict';
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  };
  var norm = function (s) { return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').trim(); };
  var TERM = ['hired', 'rejected', 'withdrawn'];
  var MAX_CV = 4 * 1024 * 1024;

  var S = {
    jobs: [], cands: [], apps: [], stages: [], ST: {}, tab: 'overview', open: null,
    f: { q: '', tech: [], dom: [], minY: '', openOnly: false, sort: 'new', techLimit: 12, domLimit: 8 },
    pjob: '', pollN: 0, pollT: null,
  };
  var NAV = [['overview', 'Tổng quan', '◧'], ['candidates', 'Ứng viên', '▤'], ['pipeline', 'Pipeline', '◈'], ['jobs', 'Việc làm', '▦'], ['matching', 'Matching', '◎']];

  /* ---------- tiện ích ---------- */
  function api(action, data) {
    return fetch('/api/admin', { method: 'POST', headers: { 'content-type': 'application/json', 'x-lh': '1' }, body: JSON.stringify(Object.assign({ action: action }, data || {})) })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (r.status === 401) { showLogin(); throw new Error('Phiên đăng nhập đã hết, bạn đăng nhập lại nhé.'); }
          if (!r.ok) throw new Error(j.error || 'Có lỗi xảy ra.');
          return j;
        });
      });
  }
  function apiForm(fd) {
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
  function activeApps() { return S.apps.filter(function (a) { return TERM.indexOf(a.status) < 0; }); }

  /* ---------- đăng nhập ---------- */
  function showLogin() {
    $('#app').classList.add('hide'); $('#login').classList.remove('hide'); closeLayer(true);
    setTimeout(function () { var p = $('#pw'); if (p) p.focus(); }, 50);
  }
  $('#lf').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = $('#lbtn'), err = $('#lerr'); err.classList.add('hide'); btn.disabled = true; btn.textContent = 'Đang kiểm tra…';
    fetch('/api/admin-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: $('#pw').value }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'Không đăng nhập được.'); }); })
      .then(function () { $('#pw').value = ''; boot(); })
      .catch(function (e2) { err.textContent = e2.message; err.classList.remove('hide'); })
      .then(function () { btn.disabled = false; btn.textContent = 'Đăng nhập'; });
  });
  function logout() {
    fetch('/api/admin-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ logout: true }) }).then(showLogin);
  }

  /* ---------- khởi động ---------- */
  function boot() {
    // Hỏi bootstrap trước: chưa đăng nhập thì chỉ tốn 1 request (không bắn thêm 2 request 401).
    api('bootstrap').then(function (b) {
      return Promise.all([api('candidates.list'), api('apps.list')]).then(function (l) { return [b, l[0], l[1]]; });
    }).then(function (r) {
      S.jobs = r[0].jobs; S.stages = r[0].stages; S.ST = {}; S.stages.forEach(function (s) { S.ST[s.key] = s; });
      S.cands = r[1].candidates.map(prep); S.apps = r[2].applications;
      $('#login').classList.add('hide'); $('#app').classList.remove('hide');
      shell(); route(); ensurePoll();
    }).catch(function (e) {
      if (/đăng nhập/.test(e.message)) return;
      showLogin(); var er = $('#lerr'); er.textContent = e.message; er.classList.remove('hide');
    });
  }
  function refreshApps() { return api('apps.list').then(function (r) { S.apps = r.applications; renderNav(); }); }
  function refreshCands() { return api('candidates.list').then(function (r) { S.cands = r.candidates.map(prep); renderNav(); ensurePoll(); }); }
  function refreshJobs() { return api('bootstrap').then(function (r) { S.jobs = r.jobs; }); }

  function shell() {
    var rail = NAV.map(function (n) { return '<a class="nv" data-nav="' + n[0] + '" href="#/' + n[0] + '"><span class="i">' + n[2] + '</span>' + n[1] + '<span class="ct num" data-ct="' + n[0] + '"></span></a>'; }).join('');
    var tabs = NAV.map(function (n) { return '<a data-nav="' + n[0] + '" href="#/' + n[0] + '"><i>' + n[2] + '</i>' + n[1] + '</a>'; }).join('');
    $('#app').innerHTML = '<div class="shell"><aside class="rail"><a class="logo" href="#/overview"><span class="moon" aria-hidden="true"></span>Luna</a>' + rail +
      '<span class="sp"></span><a class="nv" href="/" target="_blank" rel="noopener"><span class="i">↗</span>Trang công khai</a><button class="nv" data-act="logout" type="button"><span class="i">⎋</span>Đăng xuất</button></aside>' +
      '<main class="main"><div class="mtop"><a class="logo" href="#/overview"><span class="moon" aria-hidden="true"></span>Luna</a><span class="sp"></span><button class="b sm" data-act="logout" type="button">Đăng xuất</button></div><div id="view"></div></main>' +
      '<nav class="tabbar" aria-label="Điều hướng">' + tabs + '</nav></div>';
  }
  function renderNav() {
    $$('[data-nav]').forEach(function (a) { a.classList.toggle('on', a.getAttribute('data-nav') === S.tab); });
    var ct = { candidates: S.cands.length, pipeline: activeApps().length };
    $$('[data-ct]').forEach(function (el) { var v = ct[el.getAttribute('data-ct')]; el.textContent = v == null ? '' : v; });
  }

  /* ---------- định tuyến ---------- */
  var VIEWS = {};
  function route() {
    var h = location.hash.replace(/^#\/?/, '').split('/');
    var a = h[0] || 'overview', id = h[1] || '';
    var tab = a === 'candidate' ? 'candidates' : a === 'app' ? 'pipeline' : a === 'job' ? 'jobs' : a;
    if (!VIEWS[tab]) tab = 'overview';
    S.tab = tab; closeLayer(true); renderNav(); VIEWS[tab]();
    if (id) { if (a === 'candidate' || a === 'candidates') openCandidate(id); else if (a === 'app') openApp(id); else if (a === 'job' || a === 'jobs') openJob(id); }
  }
  window.addEventListener('hashchange', function () { if ($('#app') && !$('#app').classList.contains('hide')) route(); });

  /* ---------- tổng quan ---------- */
  VIEWS.overview = function () {
    var act = activeApps(), today = todayISO(), end = plusDays(7);
    var open = S.jobs.filter(function (j) { return j.status === 'open'; }).length;
    var interviewing = S.apps.filter(function (a) { return a.status === 'interview1' || a.status === 'interview2'; }).length;
    var fresh = S.apps.filter(function (a) { return a.status === 'new'; });
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

  /* ---------- pipeline ---------- */
  VIEWS.pipeline = function () {
    var jobs = S.jobs;
    $('#view').innerHTML = '<div class="ph"><h1>Pipeline</h1><span class="sp"></span><select class="i2" id="pjob" style="width:auto;max-width:260px"><option value="">Tất cả job</option>' + jobs.map(function (j) { return '<option value="' + j.id + '"' + (S.pjob === j.id ? ' selected' : '') + '>' + esc(j.title) + '</option>'; }).join('') + '</select></div><div id="kan"></div>';
    paintPipe();
  };
  function paintPipe() {
    if (S.tab !== 'pipeline' || !$('#kan')) return;
    var today = todayISO(), list = S.apps.filter(function (a) { return !S.pjob || a.job_id === S.pjob; });
    if (!list.length) { $('#kan').innerHTML = '<div class="box"><div class="none" style="border:0;padding:36px 20px">Chưa có application nào. Ứng viên nộp hồ sơ trên trang công khai sẽ xuất hiện ở đây, hoặc dùng Matching để thêm người từ kho CV.</div></div>'; return; }
    $('#kan').innerHTML = '<div class="kan">' + S.stages.map(function (s) {
      var items = list.filter(function (a) { return a.status === s.key; });
      return '<section class="col ' + stClass(s.key) + (items.length ? '' : ' empty') + '"><h3><span class="sdot"></span>' + esc(s.label) + '<span class="ct">' + items.length + '</span></h3>' +
        items.map(function (a) {
          return '<div class="card" data-act="app" data-id="' + a.id + '"><div class="t1"><span>' + esc(a.candidate_name) + '</span>' + (a.match_score != null ? '<span class="sc">' + a.match_score + '</span>' : '') + '</div>' +
            '<div class="t2">' + esc(a.job_title) + '</div>' + ((a.next_action || a.next_action_date) ? '<div class="t3"><span>' + esc(a.next_action) + '</span>' + (a.next_action_date ? '<span class="num ' + (a.next_action_date < today && TERM.indexOf(a.status) < 0 ? 'late' : '') + '">' + shortDate(a.next_action_date) + '</span>' : '') + '</div>' : '') + '</div>';
        }).join('') + '</section>';
    }).join('') + '</div>';
  }

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
        '<div class="sec"><span class="lbl">Ứng viên</span><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="b sm" data-act="cand" data-id="' + esc(c.id) + '" type="button">Mở hồ sơ</button>' + (c.phone_number ? '<a class="b sm" href="tel:' + esc(c.phone_number) + '">Gọi ' + esc(c.phone_number) + '</a><a class="b sm" href="https://zalo.me/' + esc(String(c.phone_number).replace(/\D/g, '')) + '" target="_blank" rel="noopener">Zalo</a>' : '') + (c.email ? '<a class="b sm" href="mailto:' + esc(c.email) + '">Email</a>' : '') + '</div></div>' +
        '<div class="sec"><span class="lbl">Nhật ký</span><div style="display:flex;gap:8px;margin-bottom:8px"><input class="i2" id="newnote" placeholder="Thêm ghi chú nhanh…"><button class="b" data-act="addnote" data-id="' + a.id + '" type="button">Thêm</button></div>' +
        r.activities.map(function (x) {
          var txt = x.type === 'status' ? (x.meta && x.meta.from ? esc(stLabel(x.meta.from)) + ' → <b>' + esc(stLabel(x.meta.to)) + '</b>' : '<b>' + esc(stLabel(x.meta && x.meta.to)) + '</b>') + (x.note ? ' · ' + esc(x.note) : '') : esc(x.note);
          return '<div class="act ' + esc(x.type) + '">' + txt + '<span class="d">' + dt(x.created_at) + '</span></div>';
        }).join('') + '</div></div><div class="df"><button class="b pri" data-act="saveapp" data-id="' + a.id + '" type="button">Lưu</button></div>');
    }).catch(fail);
  }

  /* ---------- jobs ---------- */
  VIEWS.jobs = function () {
    var count = {}; S.apps.forEach(function (a) { if (a.job_id) count[a.job_id] = (count[a.job_id] || 0) + 1; });
    var label = { open: 'Đang mở', draft: 'Nháp', paused: 'Tạm dừng', closed: 'Đã đóng' };
    $('#view').innerHTML = '<div class="ph"><h1>Việc làm</h1><span class="sp"></span><button class="b pri" data-act="newjob" type="button">+ Tạo job</button></div><div class="box">' +
      (S.jobs.length ? S.jobs.map(function (j) {
        return '<div class="jrow" data-act="job" data-id="' + j.id + '"><div><div class="t1">' + esc(j.title) + '</div><div class="t2">' + esc([j.level, j.job_type, j.salary_text].filter(Boolean).join(' · ')) + ' · ' + (j.must_have_tech || []).slice(0, 4).map(esc).join(', ') + '</div></div><span class="apc muted num">' + (count[j.id] || 0) + ' hồ sơ</span><span class="stt ' + j.status + '">' + label[j.status] + '</span></div>';
      }).join('') : '<div class="none" style="border:0;padding:36px 20px">Chưa có job nào. Bấm "Tạo job", bạn có thể dán nguyên JD để AI điền sẵn form.</div>') + '</div>';
  };
  function openJob(id) {
    var j = id === 'new' ? { id: '', title: '', level: '', job_type: 'Full-time', salary_text: '', location: '', summary: '', responsibilities: '', requirements: '', benefits: '', must_have_tech: [], nice_to_have_tech: [], domains: [], min_years: 0, status: 'draft', slug: '' }
      : S.jobs.filter(function (x) { return x.id === id; })[0];
    if (!j) return;
    S.open = { type: 'job', id: id }; setHash('job/' + id);
    var sel = function (k, opts, val) { return '<select class="i2" data-k="' + k + '">' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (val === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>'; };
    drawer('<div class="dh"><div style="flex:1;min-width:0"><h2>' + esc(j.title || 'Job mới') + '</h2><div class="s">' + (j.slug ? esc(location.origin + '/jobs/' + j.slug) : 'Chưa lưu') + '</div></div><button class="b sm" data-act="close" type="button">Đóng</button></div><div class="db">' +
      (j.id ? '' : '<div class="sec"><span class="lbl">Dán JD để AI điền sẵn</span><textarea class="i2" id="jdtext" placeholder="Dán nguyên nội dung JD (từ khách hàng hoặc nơi khác)…" style="min-height:110px"></textarea><div style="margin-top:8px"><button class="b" data-act="jdai" type="button">Điền tự động bằng AI</button></div></div>') +
      '<div class="sec"><span class="lbl">Thông tin chính</span>' + field('Tên vị trí', 'title', j.title) +
      '<div class="g2"><div class="fld"><label class="lbl">Cấp độ</label>' + sel('level', [['', '—'], ['Intern', 'Intern'], ['Junior', 'Junior'], ['Mid', 'Mid'], ['Senior', 'Senior'], ['Lead', 'Lead']], j.level) + '</div><div class="fld"><label class="lbl">Loại hình</label>' + sel('job_type', ['Full-time', 'Part-time', 'Freelance', 'Contract', 'Internship'].map(function (x) { return [x, x]; }), j.job_type) + '</div></div>' +
      '<div class="g2">' + field('Mức lương hiển thị', 'salary_text', j.salary_text, { ph: 'VD: 25–40 triệu, Thoả thuận' }) + field('Địa điểm làm việc', 'location', j.location, { ph: 'VD: Hồ Chí Minh, Hà Nội, Remote' }) + '</div><div class="g2">' + field('Kinh nghiệm tối thiểu (năm)', 'min_years', j.min_years, { type: 'number', step: '0.5' }) + '</div>' +
      '<div class="fld"><label class="lbl">Trạng thái</label>' + sel('status', [['draft', 'Nháp (chưa hiện)'], ['open', 'Đang mở (hiện công khai)'], ['paused', 'Tạm dừng'], ['closed', 'Đã đóng']], j.status) + '</div></div>' +
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

  /* ---------- sự kiện ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act],[data-tech],[data-dom]'); if (!t) return;
    var act = t.getAttribute('data-act'), id = t.getAttribute('data-id');
    if (t.hasAttribute('data-tech') && !act) { var v = t.getAttribute('data-tech'), i = S.f.tech.indexOf(v); if (i >= 0) S.f.tech.splice(i, 1); else S.f.tech.push(v); return paintCands(); }
    if (t.hasAttribute('data-dom') && !act) { var d = t.getAttribute('data-dom'), j = S.f.dom.indexOf(d); if (j >= 0) S.f.dom.splice(j, 1); else S.f.dom.push(d); return paintCands(); }
    switch (act) {
      case 'logout': return logout();
      case 'close': return closeLayer();
      case 'cand': return openCandidate(id);
      case 'app': return openApp(id);
      case 'job': return openJob(id);
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
        return api('jobs.fromText', { text: txt }).then(function (r) {
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
    if (t.id === 'csort') { S.f.sort = t.value; paintCands(); }
    if (t.id === 'pjob') { S.pjob = t.value; paintPipe(); }
    if (t.id === 'mjob') { MATCH.job = t.value; MATCH.res = null; $('#mres').innerHTML = ''; $('#mprog').innerHTML = ''; }
    if (t.id === 'upl') { uploadFiles(t.files); t.value = ''; }
  });
  document.addEventListener('click', function (e) { if (e.target.id === 'cfilt') $('#cside').classList.toggle('open'); });
  document.addEventListener('dragover', function (e) { var dz = $('#dz'); if (dz && e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) { e.preventDefault(); dz.classList.add('over'); } });
  document.addEventListener('dragleave', function (e) { var dz = $('#dz'); if (dz && !e.relatedTarget) dz.classList.remove('over'); });
  document.addEventListener('drop', function (e) { var dz = $('#dz'); if (dz && e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); dz.classList.remove('over'); uploadFiles(e.dataTransfer.files); } });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && $('#layer .drawer')) closeLayer();
    if ((e.metaKey || e.ctrlKey) && e.key === 'k' && $('#cq')) { e.preventDefault(); $('#cq').focus(); }
  });

  boot();
})();
