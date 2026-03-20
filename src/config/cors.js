import { config } from './index.js';

const normalizeOrigin = (value) => value?.trim().replace(/\/$/, '');

const rawAllowedOrigins = config.cors.allowedOrigins
  .split(',')
  .map((origin) => normalizeOrigin(origin))
  .filter(Boolean);

const allowAllOrigins = rawAllowedOrigins.includes('*');
const allowedOrigins = rawAllowedOrigins.filter((origin) => origin !== '*');

export const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowAllOrigins) {
      return callback(null, true);
    }
    if (allowedOrigins.length === 0) {
      return callback(null, true);
    }
    if (allowedOrigins.includes(normalizeOrigin(origin))) {
      return callback(null, true);
    }
    return callback(new Error(`Not allowed by CORS: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
};
