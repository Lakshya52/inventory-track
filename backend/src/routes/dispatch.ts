import { Router } from 'express';
import { submit, today } from '../controllers/dispatchController';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();
router.use(authenticate);
router.post('/', authorize('ADMIN', 'DISPATCH'), submit);
router.get('/today', today);
export default router;
