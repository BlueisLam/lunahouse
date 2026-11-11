/* Chuẩn hoá địa điểm job: quận/phường → thành phố, tách Remote/Hybrid. Dùng chung cho trang chủ và admin. */
(function () {
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
    var raw = rawLocs(str), c = raw.filter(function (x) { return MODES.indexOf(x) < 0 && x !== NOLOC && x.charAt(0) !== UNKNOWN; });
    if (c.length) return c;
    var u = raw.filter(function (x) { return x.charAt(0) === UNKNOWN; }).map(function (x) { return x.slice(1); });
    return u.length ? u : [raw.indexOf('Remote') >= 0 ? REMOTE_ONLY : NOCITY];
  }
  /** Quận/huyện/phường/khu đô thị → thành phố cha, để danh sách chỉ còn cấp thành phố/tỉnh. */
  var DISTRICTS = [
    ['Hồ Chí Minh', 'thu duc|binh thanh|go vap|phu nhuan|tan binh|tan phu|binh tan|nha be|hoc mon|cu chi|binh chanh|can gio|thao dien|an phu|linh trung|hiep binh|tan son nhat|phu my hung|saigon pearl|landmark|vo van tan|cong hoa|nguyen van linh|quan [0-9]+|q ?[0-9]{1,2}|district [0-9]+'],
    ['Hà Nội', 'cau giay|dong da|ba dinh|hai ba trung|hoan kiem|tay ho|thanh xuan|long bien|hoang mai|ha dong|bac tu liem|nam tu liem|my dinh|yen hoa|nam trung yen|trung hoa|trung kinh|duy tan|pham hung|lang ha|keangnam|hoa lac|thach that|dong anh|gia lam|me tri|cau dien|nghia do|dich vong|trung yen']
  ].map(function (d) { return [new RegExp('^(' + d[1] + ')$'), d[0]]; });
  var UNKNOWN = '?';
  function rawLocs(str) {
    var out = [];
    String(str || '').split(/[,;\/|·]|\s-\s|\svà\s/i).forEach(function (x) {
      x = x.trim(); if (!x) return;
      var k = plain(x), name = null;
      LOC_MAP.forEach(function (m) { if (!name && m[0].test(k)) name = m[1]; });
      if (!name) {
        var core = k.replace(/\b(district|city|ward)\b/g, ' ').replace(/^(quan|phuong|huyen|xa|thi tran|kdt|khu do thi|khu dan cu|p|q|h|tp|thanh pho|tinh)\s+/, '').replace(/\s+/g, ' ').trim();
        LOC_MAP.forEach(function (m) { if (!name && m[0].test(core)) name = m[1]; });
        DISTRICTS.forEach(function (m) { if (!name && (m[0].test(core) || m[0].test(k))) name = m[1]; });
      }
      if (!name) name = UNKNOWN + x.charAt(0).toUpperCase() + x.slice(1);
      if (out.indexOf(name) < 0) out.push(name);
    });
    if (out.length > 1) out = out.filter(function (x) { return x.charAt(0) !== UNKNOWN; });
    return out.length ? out : [NOLOC];
  }
  var CITY_ORDER = ['Hồ Chí Minh', 'Hà Nội', 'Đà Nẵng'];
  function cityCmp(a, b) { var tail = function (x) { return x === NOCITY ? 2 : x === REMOTE_ONLY ? 1 : 0; }, ia = CITY_ORDER.indexOf(a), ib = CITY_ORDER.indexOf(b);
    return tail(a) - tail(b) || (ia < 0 ? 9 : ia) - (ib < 0 ? 9 : ib) || a.localeCompare(b, 'vi'); }

  window.LunaLoc = { plain: plain, rawLocs: rawLocs, locKeys: locKeys, modeKeys: modeKeys, cityCmp: cityCmp, NOLOC: NOLOC, NOCITY: NOCITY, REMOTE_ONLY: REMOTE_ONLY, MODES: MODES };
})();
