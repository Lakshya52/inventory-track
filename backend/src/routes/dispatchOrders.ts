import { Router } from 'express';
import {
  approve,
  getPackingList,
  listAll,
  listMine,
  listPending,
  raise,
  reject,
} from '../controllers/dispatchOrderController';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();
router.use(authenticate);
router.post('/', authorize('DISPATCH'), raise);
router.get('/pending', authorize('ADMIN', 'QC'), listPending);
router.get('/all', authorize('ADMIN', 'QC'), listAll);
router.get('/mine', authorize('DISPATCH'), listMine);
router.post('/:id/approve', authorize('ADMIN', 'QC'), approve);
router.post('/:id/reject', authorize('ADMIN', 'QC'), reject);
router.get('/:id/packing-list', authorize('DISPATCH'), getPackingList);
export default router;
