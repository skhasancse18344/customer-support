import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import prisma from '../lib/prisma';
import redis from '../lib/redis';

const CACHE_KEY_PREFIX = 'analytics:top-conversations:';
const CACHE_TTL = 3600; // 1 hour

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

    const cacheKey = `${CACHE_KEY_PREFIX}${tenantId || 'all'}`;

    // Try to get from cache first
    const cachedResult = await redis.get(cacheKey);
    if (cachedResult) {
      console.log('Cache hit for top conversations');
      res.json({
        data: JSON.parse(cachedResult),
        cached: true,
      });
      return;
    }

    console.log('Cache miss - executing query');

    // Calculate date 30 days ago
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Heavy aggregation query with message count
    const topConversations = await prisma.$queryRaw<any[]>`
      SELECT 
        c.id,
        c.subject,
        c.status,
        c."tenantId",
        t.name as "tenantName",
        COUNT(m.id) as "messageCount",
        c."createdAt",
        c."updatedAt"
      FROM conversations c
      LEFT JOIN messages m ON m."conversationId" = c.id
      LEFT JOIN tenants t ON t.id = c."tenantId"
      WHERE c."createdAt" >= ${thirtyDaysAgo}
        ${tenantId ? prisma.$queryRaw`AND c."tenantId" = ${tenantId}::uuid` : prisma.$queryRaw``}
      GROUP BY c.id, c.subject, c.status, c."tenantId", t.name, c."createdAt", c."updatedAt"
      ORDER BY "messageCount" DESC
      LIMIT 10
    `;

    // Format the results
    const formattedResults = topConversations.map((conv) => ({
      id: conv.id,
      subject: conv.subject,
      status: conv.status,
      tenantId: conv.tenantId,
      tenantName: conv.tenantName,
      messageCount: parseInt(conv.messageCount),
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
    }));

    // Cache the result
    await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(formattedResults));

    res.json({
      data: formattedResults,
      cached: false,
    });
  } catch (error) {
    console.error('Get top conversations error:', error);
    res.status(500).json({ error: 'Failed to get top conversations' });
  }
};

// Invalidate cache when new messages or conversations are created
export const invalidateTopConversationsCache = async (tenantId?: string) => {
  try {
    const keys = [];
    
    if (tenantId) {
      keys.push(`${CACHE_KEY_PREFIX}${tenantId}`);
    }
    
    // Also invalidate the "all" cache for super admins
    keys.push(`${CACHE_KEY_PREFIX}all`);

    for (const key of keys) {
      await redis.del(key);
    }

    console.log('Cache invalidated for keys:', keys);
  } catch (error) {
    console.error('Cache invalidation error:', error);
  }
};
