import { Router } from 'express';
import { getCertificate, signQzRequest } from '../controllers/printerController';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();
router.use(authenticate, authorize('ADMIN', 'QC'));
router.get('/certificate', getCertificate);
router.post('/sign', signQzRequest);

export default router;
