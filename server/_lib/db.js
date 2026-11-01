'use strict';
const { createClient } = require('@supabase/supabase-js');
const { HttpError } = require('./util');

const BUCKET = 'lh-cv';
let client;

function sb() {
  if (client) return client;
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new HttpError(500, 'Chưa cấu hình SUPABASE_URL / SUPABASE_SERVICE_KEY.');
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
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

module.exports = { sb, must, BUCKET };
