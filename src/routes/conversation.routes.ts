import { Router } from 'express';
import {
  createConversation,
  listConversations,
  claimConversation,
  resolveConversation,
  getConversation,
} from '../controllers/conversation.controller';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/rbac';
import { rateLimitConversation } from '../middleware/rateLimiter';

const router = Router();

// All routes require authentication
router.use(authenticate);

router.post(
  '/',
  authorize('TENANT_ADMIN', 'AGENT'),
  rateLimitConversation,
  createConversation
);

router.get('/', listConversations);
router.get('/:id', getConversation);

router.post(
  '/:id/claim',
  authorize('AGENT', 'TENANT_ADMIN'),
  claimConversation
);

router.post(
  '/:id/resolve',
  authorize('AGENT', 'TENANT_ADMIN'),
  resolveConversation
);

export default router;
