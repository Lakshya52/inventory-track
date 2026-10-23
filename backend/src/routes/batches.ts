import { Router } from 'express';
import { create, list, getByBarcode, getById, search, update } from '../controllers/batchController';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();
router.use(authenticate);
router.post('/', authorize('ADMIN', 'PRODUCTION'), create);
router.get('/', list);
router.get('/search', search);
router.get('/barcode/:barcode', getByBarcode);
router.get('/:id', getById);
router.put('/:id', authorize('ADMIN', 'PRODUCTION'), update);
export default router;
