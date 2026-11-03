import { Router } from 'express';
import { login, logout, me, refresh, registerTenant } from '../controllers/authController';
import { authenticate } from '../middleware/auth';
import { getCurrentTenant, getCurrentTenantLogo, getPrinterLabelSize, updateCurrentTenant, updatePrinterLabelSize } from '../controllers/tenantController';
import { authorize } from '../middleware/auth';

const router = Router();
router.post('/register', registerTenant);
router.post('/login', login);
router.post('/refresh', refresh);
router.post('/logout', authenticate, logout);
router.get('/me', authenticate, me);
router.get('/tenant', authenticate, getCurrentTenant);
router.put('/tenant', authenticate, updateCurrentTenant);
router.get('/tenant/printer-label-size', authenticate, getPrinterLabelSize);
router.put('/tenant/printer-label-size', authenticate, authorize('ADMIN'), updatePrinterLabelSize);
export default router;
