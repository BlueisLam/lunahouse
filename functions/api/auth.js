import { run } from '../../server/_lib/cf.js';
import * as mod from '../../server/auth.js';
export const onRequest = (ctx) => run(mod.default || mod, ctx);
