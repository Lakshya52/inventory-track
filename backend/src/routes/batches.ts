import { Router } from 'express';
import { create, finishGoods, list, getByBarcode, getById, search, update } from '../controllers/batchController';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();
router.use(authenticate);
router.post('/', authorize('ADMIN'), create);
router.post('/:id/finish-goods', authorize('ADMIN'), finishGoods);
router.get('/', list);
router.get('/search', search);
router.get('/barcode/:barcode', getByBarcode);
router.get('/:id', getById);
router.put('/:id', authorize('ADMIN'), update);
export default router;
