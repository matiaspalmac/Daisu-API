import dotenv from 'dotenv';
dotenv.config();

export const config = Object.freeze({
  port: Number(process.env.PORT) || 3001,
  nodeEnv: process.env.NODE_ENV || 'development',
  jwt: {
    secret: process.env.JWT_SECRET || 'change-me-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  db: {
    url: process.env.DB_URL,
    authToken: process.env.DB_TOKEN,
  },
  cors: {
    allowedOrigins: process.env.ALLOWED_ORIGINS || '',
  },
  bcryptRounds: 10,
  bodyLimit: '5mb',
  cleanupIntervalMs: 5 * 60 * 1000,
  notificationRetentionDays: 90,
  rateLimit: {
    auth: { windowMs: 60000, max: 10 },
    api: { windowMs: 60000, max: 100 },
    write: { windowMs: 60000, max: 30 },
    socketMessages: { windowMs: 30000, max: 15 },
  },
  messageEditWindowMs: 15 * 60 * 1000,
  shutdownTimeoutMs: 10000,
});
