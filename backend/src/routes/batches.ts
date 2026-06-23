import { Router } from 'express';
import { create, list, getByBarcode, search } from '../controllers/batchController';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();
router.use(authenticate);
router.post('/', authorize('ADMIN'), create);
router.get('/', list);
router.get('/search', search);
router.get('/barcode/:barcode', getByBarcode);
export default router;
