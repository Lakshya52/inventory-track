import { Router } from 'express';
import {
  getPackingList,
  getPackingListPdf,
  listAll,
  listMine,
  cancel,
  raise,
  recallQr,
} from '../controllers/dispatchOrderController';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();
router.use(authenticate);
router.post('/', authorize('DISPATCH'), raise);
// The full order list is an administrator view. Dispatch only sees its own
// orders.
router.get('/all', authorize('ADMIN'), listAll);
router.get('/mine', authorize('DISPATCH'), listMine);
// There is no approval step: a raised order is released straight away. The
// dispatcher who raised it (or an administrator) can still cancel it while
// loading has not started.
router.post('/:id/cancel', authorize('DISPATCH', 'ADMIN'), cancel);
// Recall a printed QR label out of an open dispatch order, with or without an
// active loading session.
router.post('/recall-qr', authorize('DISPATCH', 'ADMIN'), recallQr);
router.get('/:id/packing-list', authorize('ADMIN', 'DISPATCH'), getPackingList);
router.get('/:id/packing-list.pdf', authorize('ADMIN', 'DISPATCH'), getPackingListPdf);
export default router;
