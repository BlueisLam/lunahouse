import { loadEnv } from '../../server/_lib/cf.js';
import cv from '../../server/cv.js';
export const onRequestGet = ({ request, env }) => { loadEnv(env); return cv.stream(request); };
