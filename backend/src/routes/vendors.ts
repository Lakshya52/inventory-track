import { Router } from 'express';
import { list, getById, create, update, setStatus, remove } from '../controllers/vendorController';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();
router.use(authenticate);
router.get('/', authorize('ADMIN', 'QC'), list);
router.get('/:id', authorize('ADMIN'), getById);
router.use(authorize('ADMIN'));

router.post('/', create);
router.put('/:id', update);
router.patch('/:id/status', setStatus);
router.delete('/:id', remove);

export default router;
