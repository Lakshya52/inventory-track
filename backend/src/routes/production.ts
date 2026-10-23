import { Router } from 'express';
import { listBatches, submitForQc, fixBatch, listFixRecords } from '../controllers/productionController';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();
router.use(authenticate);
router.get('/batches', listBatches);
router.post('/submit-for-qc', authorize('ADMIN', 'PRODUCTION'), submitForQc);
router.post('/fix-batch', authorize('ADMIN', 'PRODUCTION'), fixBatch);
router.get('/fix-records', listFixRecords);
export default router;
