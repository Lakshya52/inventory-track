import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { upload, downloadTemplate, validateImport, applyImport } from '../controllers/importController';

const router = Router();
router.use(authenticate);
router.get('/template', downloadTemplate);
router.post('/validate', authorize('ADMIN'), upload.single('file'), validateImport);
router.post('/apply', authorize('ADMIN'), upload.single('file'), applyImport);
export default router;
