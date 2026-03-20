import express from 'express';
import logger from 'morgan';
import cors from 'cors';
import helmet from 'helmet';
import crypto from 'node:crypto';
import swaggerUi from 'swagger-ui-express';
import swaggerSpec from './docs/swagger.js';
import { config } from './src/config/index.js';
import { corsOptions } from './src/config/cors.js';
import { db, createTables } from './src/db/index.js';
import { mountRoutes } from './src/routes.js';
import { authLimiter, apiLimiter } from './middleware/rate-limit.js';

const app = express();

// Security & parsing
app.use(helmet());
app.use(express.json({ limit: config.bodyLimit }));
app.use(cors(corsOptions));
app.use(logger('dev'));

// Request ID
app.use((req, res, next) => {
  req.requestId = crypto.randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
});

// Initialize database
createTables();

// Rate limiting
app.use('/api', apiLimiter);
app.use('/api/login', authLimiter);
app.use('/api/createuser', authLimiter);

// API Documentation
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Daisu API Docs',
}));

// Routes (auto-loaded from src/modules/)
await mountRoutes(app);

// Health check
app.get('/health', async (_, res) => {
  try {
    await db.execute('SELECT 1');
    res.json({ status: 'ok', db: 'connected', ts: new Date().toISOString() });
  } catch (e) {
    res.status(503).json({ status: 'error', db: 'disconnected', ts: new Date().toISOString() });
  }
});

app.get('/', (_, res) => res.json({ service: 'daisu-api', status: 'ok', ts: new Date().toISOString() }));

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found', path: req.originalUrl });
});

// Global error handler
app.use((err, req, res, next) => {
  if (err.message?.includes('CORS')) return res.status(403).json({ error: 'Not allowed by CORS' });
  console.error('[error]', err.stack || err.message || err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

export default app;
