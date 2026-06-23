import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { listUsers, addUser, deleteUser, updateProfile } from '../controllers/userController';

const router = Router();

// All user management requires authentication + admin
router.use(authenticate);
router.use(authorize('ADMIN'));

router.get('/:type', listUsers);        // GET /api/users/qc or /api/users/dispatch
router.post('/:type', addUser);         // POST /api/users/qc or /api/users/dispatch
router.delete('/:type/:id', deleteUser); // DELETE /api/users/qc/:id or /api/users/dispatch/:id

export default router;

export function profileRoutes() {
  const profileRouter = Router();
  profileRouter.use(authenticate);
  profileRouter.put('/', updateProfile);
  return profileRouter;
}
