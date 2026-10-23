import { Router } from 'express';
import { pending, records, stats, submit, submitBulk } from '../controllers/qcController';
import { create, getById, list, reprint } from '../controllers/qrLabelController';
import { authenticate, authorize } from '../middleware/auth';
import { upload } from '../config/upload';

const router = Router();
router.use(authenticate);
router.post('/', authorize('ADMIN', 'QC'), upload.array('images', 5), submit);
router.post('/bulk', authorize('ADMIN', 'QC'), upload.array('images', 5), submitBulk);
router.get('/stats', stats);
router.get('/pending', pending);
router.get('/records', records);

router.post('/qr-jobs', authorize('ADMIN', 'QC'), create);
router.get('/qr-jobs', authorize('ADMIN', 'QC'), list);
router.get('/qr-jobs/:id', authorize('ADMIN', 'QC'), getById);
router.post('/qr-jobs/:id/reprint', authorize('ADMIN', 'QC'), reprint);

export default router;
