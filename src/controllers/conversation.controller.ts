import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import prisma from '../lib/prisma';
import { sendResolutionEmail } from '../jobs/email.job';

export const createConversation = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { subject, priority } = req.body;
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      res.status(403).json({ error: 'User must belong to a tenant' });
      return;
    }

    if (!subject) {
      res.status(400).json({ error: 'Subject is required' });
      return;
    }

    const conversation = await prisma.conversation.create({
      data: {
        subject,
        priority: priority || 1,
        tenantId,
        status: 'OPEN',
      },
      include: {
        assignedAgent: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    res.status(201).json({ conversation });
  } catch (error) {
    console.error('Create conversation error:', error);
    res.status(500).json({ error: 'Failed to create conversation' });
  }
};

export const listConversations = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { status, agentId, page = '1', limit = '20' } = req.query;
    const tenantId = req.user?.tenantId;
    const role = req.user?.role;

    if (!tenantId && role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    const where: any = {};

    // Tenant filtering (except for SUPER_ADMIN)
    if (tenantId) {
      where.tenantId = tenantId;
    }

    // Status filter
    if (status) {
      where.status = status;
    }

    // Agent filter
    if (agentId) {
      where.assignedAgentId = agentId;
    }

    const [conversations, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { createdAt: 'desc' },
        include: {
          assignedAgent: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
          _count: {
            select: { messages: true },
          },
        },
      }),
      prisma.conversation.count({ where }),
    ]);

    res.json({
      conversations,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    console.error('List conversations error:', error);
    res.status(500).json({ error: 'Failed to list conversations' });
  }
};

export const claimConversation = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const id = req.params.id as string;
    const userId = req.user?.userId;
    const tenantId = req.user?.tenantId;

    if (!userId || !tenantId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Use transaction with row-level locking to prevent race conditions
    const result = await prisma.$transaction(async (tx) => {
      // Lock the conversation row for update
      const conversation = await tx.$queryRaw<any[]>`
        SELECT * FROM conversations 
        WHERE id = ${id}::uuid 
        AND "tenantId" = ${tenantId}::uuid 
        FOR UPDATE NOWAIT
      `;

      if (!conversation || conversation.length === 0) {
        throw new Error('Conversation not found or access denied');
      }

      const conv = conversation[0];

      // Check if already assigned
      if (conv.assignedAgentId) {
        throw new Error('Conversation already claimed');
      }

      // Claim the conversation
      const updated = await tx.conversation.update({
        where: { id },
        data: {
          assignedAgentId: userId,
          status: 'IN_PROGRESS',
        },
        include: {
          assignedAgent: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      });

      return updated;
    });

    res.json({ conversation: result });
  } catch (error: any) {
    console.error('Claim conversation error:', error);

    if (error.message === 'Conversation not found or access denied') {
      res.status(404).json({ error: error.message });
    } else if (error.message === 'Conversation already claimed') {
      res.status(409).json({ error: error.message });
    } else if (error.code === '55P03') {
      // Lock not available error code
      res.status(409).json({ error: 'Conversation is being claimed by another agent' });
    } else {
      res.status(500).json({ error: 'Failed to claim conversation' });
    }
  }
};

export const resolveConversation = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const id = req.params.id as string;
    const userId = req.user?.userId;
    const tenantId = req.user?.tenantId;

    if (!userId || !tenantId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Verify conversation exists and user has access
    const existingConv = await prisma.conversation.findFirst({
      where: {
        id,
        tenantId,
      },
    });

    if (!existingConv) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    // Update conversation status
    const conversation = await prisma.conversation.update({
      where: { id },
      data: {
        status: 'RESOLVED',
        resolvedAt: new Date(),
      },
      include: {
        assignedAgent: {
          select: {
            email: true,
          },
        },
        messages: {
          take: 5,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    // Queue background job for sending resolution email
    await sendResolutionEmail({
      conversationId: conversation.id,
      subject: conversation.subject,
      agentEmail: conversation.assignedAgent?.email || 'unassigned',
    });

    res.json({ conversation });
  } catch (error) {
    console.error('Resolve conversation error:', error);
    res.status(500).json({ error: 'Failed to resolve conversation' });
  }
};

export const getConversation = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const id = req.params.id as string;
    const tenantId = req.user?.tenantId;
    const role = req.user?.role;

    const where: any = { id };

    if (tenantId && role !== 'SUPER_ADMIN') {
      where.tenantId = tenantId;
    }

    const conversation = await prisma.conversation.findFirst({
      where,
      include: {
        assignedAgent: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
        messages: {
          orderBy: { createdAt: 'asc' },
          include: {
            sender: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
    });

    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    res.json({ conversation });
  } catch (error) {
    console.error('Get conversation error:', error);
    res.status(500).json({ error: 'Failed to get conversation' });
  }
};
