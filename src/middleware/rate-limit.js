import rateLimit from 'express-rate-limit';
import { config } from '../config/index.js';

// Auth endpoints: strict (login/register brute force protection)
export const authLimiter = rateLimit({
  windowMs: config.rateLimit.auth.windowMs,
  max: config.rateLimit.auth.max,
  message: { error: 'Too many attempts, try again in a minute', code: 'RATE_LIMIT' },
  standardHeaders: true,
  legacyHeaders: false,
});

// General API: moderate
export const apiLimiter = rateLimit({
  windowMs: config.rateLimit.api.windowMs,
  max: config.rateLimit.api.max,
  message: { error: 'Too many requests, slow down', code: 'RATE_LIMIT' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Write operations: stricter (creating resources, sending messages, etc)
export const writeLimiter = rateLimit({
  windowMs: config.rateLimit.write.windowMs,
  max: config.rateLimit.write.max,
  message: { error: 'Too many write operations, slow down', code: 'RATE_LIMIT' },
  standardHeaders: true,
  legacyHeaders: false,
});
