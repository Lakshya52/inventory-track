import { Router } from 'express';
import { getCertificate, signQzRequest } from '../controllers/printerController';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();
// Dispatch prints the QR labels, so it needs the signing certificate and the
// ability to sign each direct-printing job.
router.use(authenticate, authorize('ADMIN', 'QC', 'DISPATCH'));
router.get('/certificate', getCertificate);
router.post('/sign', signQzRequest);

export default router;
