import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import {
  listAllUsers,
  listUsers,
  addUser,
  updateUser,
  changePassword,
  setUserStatus,
  deleteUser,
  updateProfile,
} from '../controllers/userController';

const router = Router();

// All user management requires authentication + admin
router.use(authenticate);
router.use(authorize('ADMIN'));

router.get('/', listAllUsers);
router.post('/', addUser);

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
