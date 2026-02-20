import express from 'express';
import logger from 'morgan';
import cors from 'cors';
import { createTables } from './db.js';
import userRoutes from './routes/users.js';
import chatRoutes from './routes/chats.js';

const routes = [
  userRoutes,
  chatRoutes,
];

const app = express();

// Middleware
app.use(express.json());
app.use(cors());
app.use(logger('dev'));

// Initialize database tables
createTables();

// Routes
app.use('/api', ...routes);

export default app;
