import { Router } from 'express';
import { create, finishGoods, list, getByBarcode, getById, search, update } from '../controllers/batchController';
import { authenticate, authorize } from '../middleware/auth';
import { createGroup } from '../controllers/batchGroupController';

const router = Router();
router.use(authenticate);
router.post('/', authorize('QC'), create);
router.post('/group', authorize('QC'), createGroup);
router.post('/:id/finish-goods', authorize('QC'), finishGoods);
router.get('/', list);
router.get('/search', search);
router.get('/barcode/:barcode', getByBarcode);
router.get('/:id', getById);
router.put('/:id', authorize('QC'), update);
export default router;
