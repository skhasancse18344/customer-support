import { PrismaClient, Role, ConversationStatus } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

async function seed() {
  console.log('Seeding database...');

  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.user.deleteMany();
  await prisma.tenant.deleteMany();

  const hash = await bcrypt.hash('password123', 10);

  // Create 3 tenants
  const tenants = await Promise.all(
    ['Acme Corp', 'Globex Inc', 'Initech'].map((name) =>
      prisma.tenant.create({ data: { name } })
    )
  );

  // Create super admin
  await prisma.user.create({
    data: {
      email: 'superadmin@support-saas.com',
      password: hash,
      firstName: 'Super',
      lastName: 'Admin',
      role: 'SUPER_ADMIN',
    },
  });

  // Create admin + 3 agents per tenant
  const allUsers: { id: string; tenantId: string; role: Role }[] = [];
  for (const tenant of tenants) {
    const slug = tenant.name.toLowerCase().replace(/\s+/g, '');
    const admin = await prisma.user.create({
      data: { email: `admin@${slug}.com`, password: hash, firstName: 'Admin', lastName: tenant.name, role: 'TENANT_ADMIN', tenantId: tenant.id },
    });
    allUsers.push({ id: admin.id, tenantId: tenant.id, role: admin.role });

    for (let i = 1; i <= 3; i++) {
      const agent = await prisma.user.create({
        data: { email: `agent${i}@${slug}.com`, password: hash, firstName: `Agent${i}`, lastName: tenant.name, role: 'AGENT', tenantId: tenant.id },
      });
      allUsers.push({ id: agent.id, tenantId: tenant.id, role: agent.role });
    }
  }

  // Create 100 conversations
  const statuses: ConversationStatus[] = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
  const subjects = ['Login issue', 'Payment problem', 'Feature request', 'Bug report', 'Billing inquiry'];

  const conversations = [];
  for (const tenant of tenants) {
    const agents = allUsers.filter((u) => u.tenantId === tenant.id && u.role === 'AGENT');
    for (let i = 0; i < 33; i++) {
      const status = pick(statuses);
      conversations.push({
        subject: pick(subjects),
        status,
        priority: Math.floor(Math.random() * 5) + 1,
        tenantId: tenant.id,
        assignedAgentId: status !== 'OPEN' && agents.length ? pick(agents).id : null,
        resolvedAt: status === 'RESOLVED' ? new Date() : null,
      });
    }
  }
  await prisma.conversation.createMany({ data: conversations });

  // Create ~500 messages
  const created = await prisma.conversation.findMany({ select: { id: true, tenantId: true } });
  const texts = ['I need help.', 'Looking into this.', 'Thanks!', 'Any update?', 'Resolved.'];
  const messages = [];
  for (const conv of created) {
    const users = allUsers.filter((u) => u.tenantId === conv.tenantId);
    if (!users.length) continue;
    const count = Math.floor(Math.random() * 5) + 1;
    for (let i = 0; i < count; i++) {
      messages.push({ content: pick(texts), conversationId: conv.id, senderId: pick(users).id });
    }
  }
  await prisma.message.createMany({ data: messages });

  console.log(`Done: ${tenants.length} tenants, ${allUsers.length + 1} users, ${conversations.length} conversations, ${messages.length} messages`);
  console.log('Credentials: superadmin@support-saas.com / password123');
  console.log('             admin@acmecorp.com / password123');
  console.log('             agent1@acmecorp.com / password123');

  await prisma.$disconnect();
}

seed();
