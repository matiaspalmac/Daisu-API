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
