import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import path from 'path';
import { randomUUID } from 'crypto';
import authRoutes from './routes/auth';
import productRoutes from './routes/products';
import batchRoutes from './routes/batches';
import qcRoutes from './routes/qc';
import dispatchRoutes from './routes/dispatch';
import dispatchOrderRoutes from './routes/dispatchOrders';
import dashboardRoutes from './routes/dashboard';
import activityRoutes from './routes/activity';
import userRoutes, { profileRoutes } from './routes/users';
import importRoutes from './routes/import';
import shelfLocationRoutes from './routes/shelfLocations';
import clientRoutes from './routes/clients';
import reportRoutes from './routes/reports';
import syncRoutes from './routes/sync';
import { errorHandler } from './middleware/errorHandler';
import { rateLimit } from './middleware/rateLimit';
import { ensureAdminSchema } from './config/schema';
import { checkDatabase, closePool } from './config/database';

const app = express();
const PORT = Number(process.env.PORT) || 3001;

const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

function isOriginAllowed(origin: string): boolean {
  return allowedOrigins.some((allowed) => {
    if (allowed === '*') return true;
    if (!allowed.includes('*')) return origin === allowed;
    const [prefix, suffix] = allowed.split('*');
    return origin.startsWith(prefix) && origin.endsWith(suffix);
  });
}

app.set('trust proxy', 1);
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(compression());
app.use(cors({
  origin: allowedOrigins.length === 0
    ? true
    : (origin, callback) => {
        if (!origin || isOriginAllowed(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error(`Origin ${origin} is not allowed by CORS`));
      },
  credentials: true,
  exposedHeaders: ['RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset', 'X-Request-Id'],
}));
app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  const requestId = String(req.headers['x-request-id'] || randomUUID());
  res.setHeader('X-Request-Id', requestId);
  (req as any).requestId = requestId;
  next();
});
app.use('/api', rateLimit({
  windowMs: 60_000,
  max: Number(process.env.API_RATE_LIMIT_PER_MINUTE) || 600,
}));

app.use('/uploads', express.static(path.join(__dirname, '../uploads'), {
  maxAge: '7d',
  immutable: false,
}));

app.use('/api/auth/login', rateLimit({
  windowMs: 60_000,
  max: Number(process.env.LOGIN_RATE_LIMIT_PER_MINUTE) || 20,
  message: 'Too many sign-in attempts. Please wait a minute and try again.',
}));
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/profile', profileRoutes());
app.use('/api/products', productRoutes);
app.use('/api/batches', batchRoutes);
app.use('/api/qc', qcRoutes);
app.use('/api/dispatch', dispatchRoutes);
app.use('/api/dispatch-orders', dispatchOrderRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/products/import', importRoutes);
app.use('/api/shelf-locations', shelfLocationRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/sync', syncRoutes);

app.get('/api/health', async (_req, res) => {
  const db = await checkDatabase();
  res.status(db ? 200 : 503).json({
    status: db ? 'ok' : 'degraded',
    database: db ? 'up' : 'down',
    uptime_seconds: Math.round(process.uptime()),
    server_time: new Date().toISOString(),
  });
});

app.use(errorHandler);

let server: ReturnType<typeof app.listen> | null = null;

async function start(): Promise<void> {
  await ensureAdminSchema();
  server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Backend running on http://0.0.0.0:${PORT}`);
  });
}

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} received, shutting down...`);
  const timer = setTimeout(() => process.exit(1), 10_000);
  timer.unref();
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
  await closePool();
  clearTimeout(timer);
  process.exit(0);
}

process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

export default app;
