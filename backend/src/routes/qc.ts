import { Router } from 'express';
import { pending, records, stats, submit, submitBulk, reopenFailedBatch } from '../controllers/qcController';
import { create, getById, list, reprint } from '../controllers/qrLabelController';
import { authenticate, authorize } from '../middleware/auth';
import { upload } from '../config/upload';
import { completeQrReprintRequest, createQrReprintRequest, listQrReprintRequests } from '../controllers/qrReprintRequestController';

const router = Router();
router.use(authenticate);
router.post('/', authorize('ADMIN'), upload.array('images', 5), submit);
router.post('/bulk', authorize('ADMIN'), upload.array('images', 5), submitBulk);
router.post('/batches/:id/reopen', authorize('ADMIN'), reopenFailedBatch);
router.get('/stats', authorize('ADMIN'), stats);
router.get('/pending', authorize('ADMIN'), pending);
router.get('/records', authorize('ADMIN'), records);

router.post('/qr-jobs', authorize('ADMIN'), create);
router.get('/qr-jobs', authorize('ADMIN', 'QC'), list);
router.post('/qr-jobs/:id/reprint-request', authorize('QC'), createQrReprintRequest);
router.get('/qr-jobs/reprint-requests', authorize('ADMIN'), listQrReprintRequests);
router.post('/qr-jobs/reprint-requests/:requestId/complete', authorize('ADMIN'), completeQrReprintRequest);
router.get('/qr-jobs/:id', authorize('ADMIN', 'QC'), getById);
router.post('/qr-jobs/:id/reprint', authorize('ADMIN'), reprint);

export default router;
