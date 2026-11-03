import { Router } from 'express';
import { list, create, update, remove } from '../controllers/shelfLocationController';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();
router.use(authenticate);
router.get('/', list);
router.post('/', authorize('ADMIN', 'QC'), create);
router.put('/:id', authorize('ADMIN', 'QC'), update);
router.delete('/:id', authorize('ADMIN', 'QC'), remove);
export default router;
