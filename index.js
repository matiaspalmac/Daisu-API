import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { config } from './src/config/index.js';
import { corsOptions } from './src/config/cors.js';
import app from './app.js';
import { setupSocket } from './src/sockets/index.js';
import { socketAuthMiddleware } from './src/sockets/middleware.js';
import { runCleanup } from './src/services/cleanup.js';

const server = createServer(app);

const io = new Server(server, {
  path: '/api/socket',
  cors: {
    origin: corsOptions.origin,
    methods: ['GET', 'POST'],
  },
  connectionStateRecovery: {},
});

// Socket authentication
io.use(socketAuthMiddleware);

// Socket event handlers
setupSocket(io);

server.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
});

// Cleanup scheduler
const cleanupInterval = setInterval(() => runCleanup().catch(console.error), config.cleanupIntervalMs);
runCleanup().catch(console.error);

// Graceful shutdown
let shuttingDown = false;
const shutdown = (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] Received ${signal}. Closing server gracefully...`);
  clearInterval(cleanupInterval);
  const forceExitTimer = setTimeout(() => {
    console.warn('[shutdown] Force exit after timeout');
    process.exit(1);
  }, config.shutdownTimeoutMs);
  io.close(() => {
    server.close((err) => {
      clearTimeout(forceExitTimer);
      if (err) { console.error('[shutdown] Error:', err); process.exit(1); }
      console.log('[shutdown] Server closed cleanly');
      process.exit(0);
    });
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => console.error('[runtime] Unhandled rejection:', reason));
process.on('uncaughtException', (error) => { console.error('[runtime] Uncaught exception:', error); shutdown('uncaughtException'); });
