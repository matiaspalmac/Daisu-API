import express from 'express';
import logger from 'morgan';
import cors from 'cors';
import dotenv from 'dotenv';
import { createTables } from './db.js';
import userRoutes from './routes/users.js';
import chatRoutes from './routes/chats.js';
import statsRoutes from './routes/stats.js';
import socialRoutes from './routes/social.js';

dotenv.config();

const app = express();
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
	.split(',')
	.map(origin => origin.trim())
	.filter(Boolean);

const corsOptions = {
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
	methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
};

// Middleware
app.use(express.json({ limit: '5mb' }));
app.use(cors(corsOptions));
app.use(logger('dev'));

// Initialize database tables
createTables();

// Routes
app.use('/api', userRoutes);
app.use('/api', chatRoutes);
app.use('/api', statsRoutes);
app.use('/api', socialRoutes);

// Health check
app.get('/health', (_, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

export default app;
