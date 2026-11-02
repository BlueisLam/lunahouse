/* Giao diện sáng/tối. Nạp đồng bộ trong <head> để không bị nháy màu khi tải trang.
   Chưa chọn thì theo hệ điều hành; bấm nút thì nhớ lựa chọn trong trình duyệt. */
(function () {
  var K = 'lh-theme', d = document.documentElement;
  function stored() { try { var v = localStorage.getItem(K); return v === 'dark' || v === 'light' ? v : ''; } catch (e) { return ''; } }
  function sys() { return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
  function cur() { return d.getAttribute('data-theme') || sys(); }
  function paint() {
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', cur() === 'dark' ? '#0e0c24' : '#f4f2fb');
  }
  var s = stored(); if (s) d.setAttribute('data-theme', s);
  paint();
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-theme-toggle]'); if (!b) return;
    var n = cur() === 'dark' ? 'light' : 'dark';
    d.setAttribute('data-theme', n);
    try { localStorage.setItem(K, n); } catch (x) {}
    paint();
  });
  window.LHTheme = { get: cur };
})();
