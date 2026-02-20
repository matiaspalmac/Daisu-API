import dotenv from 'dotenv';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import app from './app.js';
import { setupSocket } from './sockets.js';

dotenv.config();

const port = process.env.PORT ?? 3001;
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

const server = createServer(app);

const io = new Server(server, {
  path: '/api/socket',
  cors: {
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.length === 0 && process.env.NODE_ENV !== 'production') {
        return callback(null, true);
      }
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST'],
  },
  connectionStateRecovery: {},
});

setupSocket(io);

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

let shuttingDown = false;

const shutdown = (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] Received ${signal}. Closing server gracefully...`);

  const forceExitTimer = setTimeout(() => {
    console.warn('[shutdown] Force exit after timeout');
    process.exit(1);
  }, 10000);

  io.close(() => {
    server.close((err) => {
      clearTimeout(forceExitTimer);
      if (err) {
        console.error('[shutdown] Error while closing server:', err);
        process.exit(1);
      }
      console.log('[shutdown] Server closed cleanly');
      process.exit(0);
    });
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  console.error('[runtime] Unhandled rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[runtime] Uncaught exception:', error);
  shutdown('uncaughtException');
});
