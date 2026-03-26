import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';

type RoleType = 'SUPER_ADMIN' | 'TENANT_ADMIN' | 'AGENT';

export const authorize = (...allowedRoles: RoleType[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!allowedRoles.includes(req.user.role as RoleType)) {
      res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
      return;
    }

    next();
  };
};
