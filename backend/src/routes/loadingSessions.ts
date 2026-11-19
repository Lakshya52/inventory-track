import { Router } from 'express';
import { active, cancel, finalise, getById, latestClosedByOrder, recallQr, recallSealed, reloadOrder, scan, start, stream } from '../controllers/loadingSessionController';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();
router.use(authenticate);
router.post('/', authorize('ADMIN', 'DISPATCH'), start);
router.get('/active', authorize('ADMIN', 'QC', 'DISPATCH'), active);
router.get('/active/stream', authorize('ADMIN', 'QC'), stream);
router.get('/by-order/:orderId', authorize('ADMIN', 'DISPATCH'), latestClosedByOrder);
router.get('/:id', authorize('DISPATCH', 'QC', 'ADMIN'), getById);
router.post('/:id/scan', authorize('ADMIN', 'DISPATCH'), scan);
router.post('/:id/recall-qr', authorize('ADMIN', 'DISPATCH'), recallQr);
router.post('/:id/recall-sealed', authorize('ADMIN', 'DISPATCH'), recallSealed);
router.post('/:id/reload', authorize('ADMIN', 'DISPATCH'), reloadOrder);
router.post('/:id/finalise', authorize('ADMIN', 'DISPATCH'), finalise);
router.post('/:id/cancel', authorize('ADMIN', 'DISPATCH'), cancel);
export default router;
