import { Router } from 'express';
import { login, logout, me, refresh, registerTenant } from '../controllers/authController';
import { authenticate } from '../middleware/auth';
import { getCurrentTenant, getCurrentTenantLogo, updateCurrentTenant } from '../controllers/tenantController';

const router = Router();
router.post('/register', registerTenant);
router.post('/login', login);
router.post('/refresh', refresh);
router.post('/logout', authenticate, logout);
router.get('/me', authenticate, me);
router.get('/tenant', authenticate, getCurrentTenant);
router.put('/tenant', authenticate, updateCurrentTenant);
export default router;
