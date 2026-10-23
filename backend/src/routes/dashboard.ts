import { Router } from 'express';
import { stats, adminStats } from '../controllers/dashboardController';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();
router.use(authenticate);
router.get('/', stats);
router.get('/admin', authorize('ADMIN'), adminStats);
export default router;
