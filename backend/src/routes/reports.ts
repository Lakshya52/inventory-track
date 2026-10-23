import { Router } from 'express';
import {
  summary,
  qcReport,
  dispatchReport,
  dispatchRequests,
  inventory,
  batchesReport,
} from '../controllers/reportController';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();
router.use(authenticate);
router.use(authorize('ADMIN'));

router.get('/summary', summary);
router.get('/qc', qcReport);
router.get('/dispatch', dispatchReport);
router.get('/dispatch-requests', dispatchRequests);
router.get('/inventory', inventory);
router.get('/batches', batchesReport);

export default router;
