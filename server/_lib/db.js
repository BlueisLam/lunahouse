'use strict';
const { createClient } = require('@supabase/supabase-js');
const { HttpError } = require('./util');

const BUCKET = 'lh-cv';
let client;

/**
 * Môi trường dev dùng chung một project Supabase với production nhưng khác bảng/bucket:
 * TABLE_PREFIX=lhdev_  và  BUCKET_NAME=lhdev-cv  (production không đặt gì, giữ lh_ và lh-cv).
 */
const tablePrefix = () => process.env.TABLE_PREFIX || 'lh_';
const bucketName = () => process.env.BUCKET_NAME || BUCKET;
const mapTable = (t) => (typeof t === 'string' && t.startsWith('lh_') ? tablePrefix() + t.slice(3) : t);
const mapBucket = (b) => (b === BUCKET ? bucketName() : b);

function sb() {
  if (!client) {
    const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) throw new HttpError(500, 'Chưa cấu hình SUPABASE_URL / SUPABASE_SERVICE_KEY.');
    client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  const c = client;
  return new Proxy(c, {
    get(t, k) {
      if (k === 'from') return (name) => t.from(mapTable(name));
      if (k === 'storage') return { from: (b) => t.storage.from(mapBucket(b)) };
      return t[k];
    },
  });
}

/** Ném lỗi nếu Supabase trả error; trả về data. */
function must(res, what) {
  if (res && res.error) {
    console.error('[db]', what || '', res.error);
    const e = new Error((what ? what + ': ' : '') + res.error.message);
    e.code = res.error.code; e.details = res.error.details;
    throw e;
  }
  return res.data;
}

module.exports = { sb, must, BUCKET, mapTable, mapBucket };
