import { Router } from 'express';
import { pull, push, register, status, uploadAttachments } from '../controllers/syncController';
import { authenticate, authorize } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { upload } from '../config/upload';

const router = Router();
router.use((req, res, next) => {
  const startedAt = Date.now();
  res.on('finish', () => {
    console.info('[sync] request', JSON.stringify({
      request_id: (req as typeof req & { requestId?: string }).requestId || null,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration_ms: Date.now() - startedAt,
      user_role: req.user?.role || null,
      user_id: req.user?.userId || null,
    }));
  });
  next();
});
router.use(authenticate);
router.use(rateLimit({
  windowMs: 60_000,
  max: Number(process.env.SYNC_RATE_LIMIT_PER_MINUTE) || 180,
  message: 'Sync rate limit exceeded. The device will retry automatically.',
}));

router.post('/register', authorize('ADMIN', 'QC', 'DISPATCH'), register);
router.post('/push', authorize('ADMIN', 'QC', 'DISPATCH'), push);
router.get('/pull', authorize('ADMIN', 'QC', 'DISPATCH'), pull);
router.get('/status', authorize('ADMIN', 'QC', 'DISPATCH'), status);
router.post(
  '/attachments',
  authorize('ADMIN', 'QC', 'DISPATCH'),
  upload.array('images', 5),
  uploadAttachments
);

export default router;
