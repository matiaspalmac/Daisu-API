import dotenv from 'dotenv';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import app from './app.js';
import { setupSocket } from './sockets.js';

dotenv.config();

const port = process.env.PORT ?? 3001;

const server = createServer(app);

const io = new Server(server, {
  path: '/api/socket',
  cors: {
    origin: '*', // Allow all origins
    methods: ['GET', 'POST'],
  },
  connectionStateRecovery: {},
});

setupSocket(io);

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
