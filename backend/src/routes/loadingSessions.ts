import { Router } from 'express';
import { active, finalise, getById, scan, start, stream } from '../controllers/loadingSessionController';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();
router.use(authenticate);
router.post('/', authorize('DISPATCH'), start);
router.get('/active', authorize('ADMIN', 'QC', 'DISPATCH'), active);
router.get('/active/stream', authorize('ADMIN', 'QC'), stream);
router.get('/:id', authorize('DISPATCH', 'QC', 'ADMIN'), getById);
router.post('/:id/scan', authorize('DISPATCH'), scan);
router.post('/:id/finalise', authorize('DISPATCH'), finalise);
export default router;
