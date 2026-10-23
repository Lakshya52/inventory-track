import { Router } from 'express';
import { login, logout, me, refresh } from '../controllers/authController';
import { authenticate } from '../middleware/auth';

const router = Router();
router.post('/login', login);
router.post('/refresh', refresh);
router.post('/logout', authenticate, logout);
router.get('/me', authenticate, me);
export default router;
