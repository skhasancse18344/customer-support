import { Router } from 'express';
import { getAgentsByTenant } from '../controllers/user.controller';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/rbac';

const router = Router();

router.use(authenticate);

router.get('/agents', authorize('SUPER_ADMIN', 'TENANT_ADMIN'), getAgentsByTenant);

export default router;
