import { Router } from 'express';
import { create, createFamily, list, getById, renameFamily, search, remove, update } from '../controllers/productController';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();
router.use(authenticate);
router.post('/', authorize('ADMIN'), create);
router.post('/family', authorize('ADMIN'), createFamily);
router.put('/family', authorize('ADMIN'), renameFamily);
router.get('/', list);
router.get('/search', search);
router.get('/:id', getById);
router.delete('/:id', authorize('ADMIN'), remove);
router.put('/:id', authorize('ADMIN'), update);
export default router;
