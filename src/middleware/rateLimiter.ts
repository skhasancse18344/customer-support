import { Request, Response, NextFunction } from 'express';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import redis from '../lib/redis';

const loginLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:login',
  points: 5,
  duration: 900,
  blockDuration: 900,
});

const conversationLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:conversation',
  points: 10,
  duration: 60,
});

export const rateLimitLogin = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    await loginLimiter.consume(req.ip || 'unknown');
    next();
  } catch (error: any) {
    res.status(429).json({ error: 'Too many login attempts. Try again later.' });
  }
};

export const rateLimitConversation = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    await conversationLimiter.consume(req.ip || 'unknown');
    next();
  } catch (error: any) {
    res.status(429).json({ error: 'Too many requests. Slow down.' });
  }
};
