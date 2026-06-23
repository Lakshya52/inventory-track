import { Router } from 'express';
import { submit } from '../controllers/qcController';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();
router.use(authenticate);
router.post('/', authorize('ADMIN', 'QC'), submit);
export default router;
