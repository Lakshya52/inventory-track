import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { upload, importProducts, downloadSample } from '../controllers/importController';

const router = Router();
router.use(authenticate);
router.get('/sample', downloadSample);
router.post('/', authorize('ADMIN'), upload.single('file'), importProducts);
export default router;
