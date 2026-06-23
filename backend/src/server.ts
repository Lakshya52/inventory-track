import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth';
import productRoutes from './routes/products';
import batchRoutes from './routes/batches';
import qcRoutes from './routes/qc';
import dispatchRoutes from './routes/dispatch';
import dashboardRoutes from './routes/dashboard';
import activityRoutes from './routes/activity';
import userRoutes, { profileRoutes } from './routes/users';
import { errorHandler } from './middleware/errorHandler';

const app = express();
const PORT = Number(process.env.PORT) || 3001;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/profile', profileRoutes());
app.use('/api/products', productRoutes);
app.use('/api/batches', batchRoutes);
app.use('/api/qc', qcRoutes);
app.use('/api/dispatch', dispatchRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/activity', activityRoutes);

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.use(errorHandler);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend running on http://0.0.0.0:${PORT}`);
});
