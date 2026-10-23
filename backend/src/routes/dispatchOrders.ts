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
router.get('/pending', authorize('ADMIN'), listPending);
router.get('/all', authorize('ADMIN'), listAll);
router.get('/mine', authorize('DISPATCH'), listMine);
router.post('/:id/approve', authorize('ADMIN'), approve);
router.post('/:id/reject', authorize('ADMIN'), reject);
router.get('/:id/packing-list', authorize('ADMIN', 'DISPATCH'), getPackingList);
export default router;
