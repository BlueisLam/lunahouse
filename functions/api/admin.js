import { run } from '../../server/_lib/cf.js';
import * as mod from '../../server/admin-api.js';
export const onRequest = (ctx) => run(mod.default || mod, ctx);
