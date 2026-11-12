import { Router } from 'express';
import { decideBatchGroup, decideBatchGroupsBulk, pending, records, stats, submit, submitBulk, reopenFailedBatch } from '../controllers/qcController';
import { create, getById, list, printInitial, reprint } from '../controllers/qrLabelController';
import { authenticate, authorize } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { upload } from '../config/upload';
import { completeQrReprintRequest, createQrReprintRequest, listQrReprintRequests, reviewQrReprintRequest } from '../controllers/qrReprintRequestController';

const router = Router();
router.use(authenticate);
router.post('/', authorize('ADMIN'), upload.array('images', 5), submit);
router.post('/bulk', authorize('ADMIN'), upload.array('images', 5), submitBulk);
router.post('/batches/:id/reopen', authorize('ADMIN'), reopenFailedBatch);
router.post('/batch-groups/:id/decision', authorize('ADMIN', 'QC'), decideBatchGroup);
router.post('/batch-groups/decisions/bulk', authorize('ADMIN', 'QC'), decideBatchGroupsBulk);
router.get('/stats', authorize('ADMIN', 'QC'), stats);
router.get('/pending', authorize('ADMIN', 'QC'), pending);
router.get('/records', authorize('ADMIN', 'QC'), records);

router.post('/qr-jobs', authorize('ADMIN'), create);
router.get('/qr-jobs', authorize('ADMIN', 'DISPATCH'), list);
router.post('/qr-jobs/:id/print', authorize('ADMIN', 'DISPATCH'), printInitial);
// Printing and reprinting are rate limited: each call drives a physical
// printer, so a stuck client must not flood the queue.
const printRateLimit = rateLimit({
  windowMs: 60_000,
  max: Number(process.env.PRINT_RATE_LIMIT_PER_MINUTE) || 20,
  message: 'Too many print requests. Please wait a minute and try again.',
});
router.post('/qr-jobs/:id/print', authorize('ADMIN', 'DISPATCH'), printRateLimit, printInitial);
// Reprint requests belong to Dispatch only. QC neither raises nor completes them.
router.post('/qr-jobs/:id/reprint-request', authorize('DISPATCH'), createQrReprintRequest);
router.get('/qr-jobs/reprint-requests', authorize('ADMIN', 'DISPATCH'), listQrReprintRequests);
router.post('/qr-jobs/reprint-requests/:requestId/review', authorize('ADMIN'), reviewQrReprintRequest);
router.post('/qr-jobs/reprint-requests/:requestId/complete', authorize('ADMIN', 'DISPATCH'), completeQrReprintRequest);
router.get('/qr-jobs/:id', authorize('ADMIN', 'DISPATCH'), getById);
router.post('/qr-jobs/:id/reprint', authorize('ADMIN', 'DISPATCH'), printRateLimit, reprint);

export default router;
