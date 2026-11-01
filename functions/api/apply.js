import { run } from '../../server/_lib/cf.js';
import * as mod from '../../server/apply.js';
export const onRequest = (ctx) => run(mod.default || mod, ctx);
