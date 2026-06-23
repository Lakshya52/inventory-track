import { Router } from 'express';
import { create, list, getById, search, remove, update } from '../controllers/productController';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();
router.use(authenticate);
router.post('/', authorize('ADMIN'), create);
router.get('/', list);
router.get('/search', search);
router.get('/:id', getById);
router.delete('/:id', authorize('ADMIN'), remove);
router.put('/:id', authorize('ADMIN'), update);
export default router;
