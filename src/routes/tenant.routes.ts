import { Router } from 'express';
import { getAllTenants } from '../controllers/tenant.controller';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/rbac';

const router = Router();

router.use(authenticate);

router.get('/', authorize('SUPER_ADMIN'), getAllTenants);

export default router;
