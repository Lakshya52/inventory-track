import { Router } from 'express';
import {
  approve,
  getPackingList,
  getPackingListPdf,
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
router.get('/pending', authorize('QC'), listPending);
router.get('/all', authorize('ADMIN', 'QC'), listAll);
router.get('/mine', authorize('DISPATCH'), listMine);
router.post('/:id/approve', authorize('QC'), approve);
router.post('/:id/reject', authorize('QC'), reject);
router.get('/:id/packing-list', authorize('ADMIN', 'QC', 'DISPATCH'), getPackingList);
router.get('/:id/packing-list.pdf', authorize('ADMIN', 'QC', 'DISPATCH'), getPackingListPdf);
export default router;
