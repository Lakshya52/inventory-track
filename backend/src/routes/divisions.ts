import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { listDivisions, createDivision, updateDivision, deleteDivision } from '../controllers/divisionController';

const router = Router();
router.use(authenticate, authorize('ADMIN'));

router.get('/', listDivisions);
router.post('/', createDivision);
router.put('/:id', updateDivision);
router.delete('/:id', deleteDivision);

export default router;
