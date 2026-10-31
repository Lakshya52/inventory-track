import { Router } from 'express';
import {
  getPackingList,
  getPackingListPdf,
  listAll,
  listMine,
  raise,
} from '../controllers/dispatchOrderController';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();
router.use(authenticate);
router.post('/', authorize('DISPATCH'), raise);
router.get('/all', authorize('ADMIN'), listAll);
router.get('/mine', authorize('DISPATCH'), listMine);
router.get('/:id/packing-list', authorize('ADMIN', 'DISPATCH'), getPackingList);
router.get('/:id/packing-list.pdf', authorize('ADMIN', 'DISPATCH'), getPackingListPdf);
export default router;
