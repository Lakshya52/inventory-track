import { Router } from 'express';
import { create, list, remove, update } from '../controllers/masterDataController';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();
router.use(authenticate);
router.get('/:kind', list);
router.use(authorize('ADMIN'));
router.post('/:kind', create);
router.put('/:kind/:id', update);
router.delete('/:kind/:id', remove);

export default router;
