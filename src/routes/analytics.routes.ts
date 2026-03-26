import { Router } from 'express';
import { getTopActiveConversations } from '../controllers/analytics.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/top-conversations', getTopActiveConversations);

export default router;
