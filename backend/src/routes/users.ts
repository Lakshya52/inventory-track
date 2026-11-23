import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import {
  listAllUsers,
  listUsersPage,
  listUsers,
  addUser,
  updateUser,
  changePassword,
  setUserStatus,
  deleteUser,
  updateProfile,
} from '../controllers/userController';
import { handlers as userImport, importUpload } from '../controllers/userImportController';

const router = Router();

// All user management requires authentication + admin
router.use(authenticate);
router.use(authorize('ADMIN'));

router.get('/', listAllUsers);
router.post('/', addUser);

// Excel bulk import — registered before /:type so the catch-all cannot shadow it.
const imports = userImport();
router.get('/import/template', imports.downloadTemplate);
router.post('/import/validate', importUpload.single('file'), imports.validate);
router.post('/import/apply', importUpload.single('file'), imports.apply);

// Paginated list for the web UI (must precede /:type).
router.get('/paged', listUsersPage);

// Legacy/compatible role-scoped routes, e.g. /api/users/qc
router.get('/:type', listUsers);
router.post('/:type', addUser);

router.put('/:type/:id', updateUser);
router.put('/:type/:id/password', changePassword);
router.patch('/:type/:id/status', setUserStatus);
router.delete('/:type/:id', deleteUser);

export default router;

export function profileRoutes() {
  const profileRouter = Router();
  profileRouter.use(authenticate);
  profileRouter.put('/', updateProfile);
  return profileRouter;
}
