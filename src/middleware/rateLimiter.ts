import { Request, Response, NextFunction } from 'express';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import redis from '../lib/redis';

// Login rate limiter: 5 attempts per 15 minutes
const loginLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:login',
  points: parseInt(process.env.RATE_LIMIT_LOGIN_POINTS || '5'),
  duration: parseInt(process.env.RATE_LIMIT_LOGIN_DURATION || '900'),
  blockDuration: 900, // Block for 15 minutes
});

// Conversation creation rate limiter: 10 per minute
const conversationLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:conversation',
  points: parseInt(process.env.RATE_LIMIT_CONVERSATION_POINTS || '10'),
  duration: parseInt(process.env.RATE_LIMIT_CONVERSATION_DURATION || '60'),
});

export const rateLimitLogin = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    await loginLimiter.consume(key);
    next();
  } catch (error: any) {
    if (error.msBeforeNext) {
      res.status(429).json({
        error: 'Too many login attempts. Please try again later.',
        retryAfter: Math.ceil(error.msBeforeNext / 1000),
      });
    } else {
      res.status(500).json({ error: 'Rate limiting error' });
    }
  }
};

export const rateLimitConversation = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    await conversationLimiter.consume(key);
    next();
  } catch (error: any) {
    if (error.msBeforeNext) {
      res.status(429).json({
        error: 'Too many conversation requests. Please slow down.',
        retryAfter: Math.ceil(error.msBeforeNext / 1000),
      });
    } else {
      res.status(500).json({ error: 'Rate limiting error' });
    }
  }
};
