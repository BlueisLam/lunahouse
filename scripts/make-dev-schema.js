'use strict';
// Tạo supabase/schema.dev.sql từ schema.sql: bảng lhdev_*, bucket lhdev-cv. Chạy: npm run schema:dev
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');
const out = '-- Tự sinh từ schema.sql bằng `npm run schema:dev`. KHÔNG sửa tay.\n' +
  src.replace(/\blh_/g, 'lhdev_').replace(/'lh-cv'/g, "'lhdev-cv'");
fs.writeFileSync(path.join(__dirname, '..', 'supabase', 'schema.dev.sql'), out);
console.log('Đã tạo supabase/schema.dev.sql');
