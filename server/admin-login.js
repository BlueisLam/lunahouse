'use strict';
const U = require('./_lib/util');
const A = require('./_lib/auth');
const N = require('./_lib/notify');

exports.handler = U.wrap(async (event) => {
  if (event.httpMethod !== 'POST') throw new U.HttpError(405, 'Method not allowed');
  const b = U.parseBody(event, 2000);

  if (b.logout) {
    return U.json(200, { ok: true }, { 'set-cookie': A.sessionCookie(event, '', 0) });
  }

  if (!A.checkPassword(b.password || '')) {
    await U.sleep(900);
    await N.settle([N.telegram(`⚠️ Đăng nhập admin sai mật khẩu (IP ${U.esc(U.clientIp(event))})`)]);
    throw new U.HttpError(401, 'Sai mật khẩu.');
  }
  const token = A.newSession();
  return U.json(200, { ok: true }, { 'set-cookie': A.sessionCookie(event, token, A.DAYS * 86400) });
});
