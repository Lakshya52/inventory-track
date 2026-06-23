import { Router } from 'express';
import { stats } from '../controllers/dashboardController';
import { authenticate } from '../middleware/auth';

const router = Router();
router.use(authenticate);
router.get('/', stats);
export default router;
