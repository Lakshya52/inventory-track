import { Router } from 'express';
import { list, getById, create, update, setStatus, remove } from '../controllers/vendorController';
import { handlers as partyImport, importUpload } from '../controllers/partyImportController';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();
router.use(authenticate);
router.get('/', authorize('ADMIN', 'QC'), list);

const imports = partyImport('vendors');
router.get('/import/template', imports.downloadTemplate);
router.post('/import/validate', authorize('ADMIN'), importUpload.single('file'), imports.validate);
router.post('/import/apply', authorize('ADMIN'), importUpload.single('file'), imports.apply);

router.get('/:id', authorize('ADMIN'), getById);
router.use(authorize('ADMIN'));

router.post('/', create);
router.put('/:id', update);
router.patch('/:id/status', setStatus);
router.delete('/:id', remove);
export default router;
