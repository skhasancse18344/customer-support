import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import prisma from '../lib/prisma';
import redis from '../lib/redis';

const CACHE_TTL = 3600;

export const getTopActiveConversations = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const tenantId = req.user?.tenantId;
    const role = req.user?.role;

    if (!tenantId && role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const cacheKey = `analytics:top:${tenantId || 'all'}`;

    const cached = await redis.get(cacheKey);
    if (cached) {
      res.json({ data: JSON.parse(cached), cached: true });
      return;
    }

    const where: any = {};
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    where.createdAt = { gte: thirtyDaysAgo };
    if (tenantId) where.tenantId = tenantId;

    const conversations = await prisma.conversation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: {
        tenant: { select: { name: true } },
        _count: { select: { messages: true } },
      },
    });

    const data = conversations
      .map((c) => ({
        id: c.id,
        subject: c.subject,
        status: c.status,
        tenantId: c.tenantId,
        tenantName: c.tenant.name,
        messageCount: c._count.messages,
        createdAt: c.createdAt,
      }))
      .sort((a, b) => b.messageCount - a.messageCount);

    await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(data));

    res.json({ data, cached: false });
  } catch (error) {
    console.error('Get top conversations error:', error);
    res.status(500).json({ error: 'Failed to get top conversations' });
  }
};
