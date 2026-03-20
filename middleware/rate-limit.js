import rateLimit from 'express-rate-limit';

// Auth endpoints: strict (login/register brute force protection)
export const authLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 10,               // 10 attempts per minute per IP
  message: { error: 'Too many attempts, try again in a minute' },
  standardHeaders: true,
  legacyHeaders: false,
});

// General API: moderate
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 100,              // 100 requests per minute per IP
  message: { error: 'Too many requests, slow down' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Write operations: stricter (creating resources, sending messages, etc)
export const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,               // 30 writes per minute per IP
  message: { error: 'Too many write operations, slow down' },
  standardHeaders: true,
  legacyHeaders: false,
});
