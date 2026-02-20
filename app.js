import express from 'express';
import logger from 'morgan';
import cors from 'cors';
import dotenv from 'dotenv';
import { createTables } from './db.js';
import userRoutes from './routes/users.js';
import chatRoutes from './routes/chats.js';
import statsRoutes from './routes/stats.js';
import socialRoutes from './routes/social.js';
import analyticsRoutes from './routes/analytics.js';

dotenv.config();

const app = express();
const normalizeOrigin = value => value?.trim().replace(/\/$/, '');
const rawAllowedOrigins = (process.env.ALLOWED_ORIGINS || '')
	.split(',')
	.map(origin => normalizeOrigin(origin))
	.filter(Boolean);
const allowAllOrigins = rawAllowedOrigins.includes('*');
const allowedOrigins = rawAllowedOrigins.filter(origin => origin !== '*');

const corsOptions = {
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
app.use('/api', analyticsRoutes);
app.use('/api', socialRoutes);

// Health check
app.get('/health', (_, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));
app.get('/', (_, res) => res.json({ service: 'daisu-api', status: 'ok', ts: new Date().toISOString() }));

export default app;
