import { Router } from 'express';
import { signUp, signIn, refreshToken } from '../controllers/auth.controller';
import { rateLimitLogin } from '../middleware/rateLimiter';

const router = Router();

router.post('/signup', signUp);
router.post('/signin', rateLimitLogin, signIn);
router.post('/refresh', refreshToken);

export default router;
