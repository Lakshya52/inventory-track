import { Router } from 'express';
import { list, create, update, remove } from '../controllers/clientController';
import { handlers as partyImport, importUpload } from '../controllers/partyImportController';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();
router.use(authenticate);
router.get('/', list);

const imports = partyImport('clients');
router.get('/import/template', imports.downloadTemplate);
router.post('/import/validate', authorize('ADMIN'), importUpload.single('file'), imports.validate);
router.post('/import/apply', authorize('ADMIN'), importUpload.single('file'), imports.apply);

router.post('/', authorize('ADMIN'), create);
router.put('/:id', authorize('ADMIN'), update);
router.delete('/:id', authorize('ADMIN'), remove);
export default router;
