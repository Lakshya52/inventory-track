import { Router } from 'express';
import { pull, push, register, status, uploadAttachments } from '../controllers/syncController';
import { authenticate, authorize } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { upload } from '../config/upload';

const router = Router();
router.use(authenticate);
router.use(rateLimit({
  windowMs: 60_000,
  max: Number(process.env.SYNC_RATE_LIMIT_PER_MINUTE) || 180,
  message: 'Sync rate limit exceeded. The device will retry automatically.',
}));

router.post('/register', authorize('ADMIN', 'QC', 'DISPATCH', 'PRODUCTION'), register);
router.post('/push', authorize('ADMIN', 'QC', 'DISPATCH', 'PRODUCTION'), push);
router.get('/pull', authorize('ADMIN', 'QC', 'DISPATCH', 'PRODUCTION'), pull);
router.get('/status', authorize('ADMIN', 'QC', 'DISPATCH', 'PRODUCTION'), status);
router.post(
  '/attachments',
  authorize('ADMIN', 'QC', 'DISPATCH', 'PRODUCTION'),
  upload.array('images', 5),
  uploadAttachments
);

export default router;
