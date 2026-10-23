import { Router } from 'express';
import { approvedOrders, ready, records, stats, submit, submitBulk, today } from '../controllers/dispatchController';
import { authenticate, authorize } from '../middleware/auth';
import { upload } from '../config/upload';

const router = Router();
router.use(authenticate);
router.post('/', authorize('ADMIN', 'DISPATCH'), upload.array('images', 5), submit);
router.post('/bulk', authorize('ADMIN', 'DISPATCH'), upload.array('images', 5), submitBulk);
router.get('/today', today);
router.get('/stats', stats);
router.get('/ready', ready);
router.get('/records', records);
router.get('/approved-orders', approvedOrders);
export default router;
