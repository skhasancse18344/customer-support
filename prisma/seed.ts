import { PrismaClient, Role, ConversationStatus } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const BATCH_SIZE = 1000;
const TOTAL_CONVERSATIONS = 200_000;
const TOTAL_MESSAGES = 1_000_000;

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

async function batchInsert<T>(
  items: T[],
  insertFn: (batch: T[]) => Promise<any>,
  label: string
) {
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    await insertFn(batch);
    if ((i + BATCH_SIZE) % 10_000 === 0 || i + BATCH_SIZE >= items.length) {
      console.log(`  ${label}: ${Math.min(i + BATCH_SIZE, items.length)}/${items.length}`);
    }
  }
}

async function seed() {
  console.log('Seeding database...');
  const start = Date.now();

  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.user.deleteMany();
  await prisma.tenant.deleteMany();

  const hash = await bcrypt.hash('password123', 10);

  // Create 10 tenants
  const tenantNames = [
    'Acme Corp', 'Globex Inc', 'Initech', 'Umbrella Co', 'Stark Industries',
    'Wayne Enterprises', 'Oscorp', 'Cyberdyne', 'Soylent Corp', 'Aperture Science',
  ];
  const tenants = await Promise.all(
    tenantNames.map((name) => prisma.tenant.create({ data: { name } }))
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

  console.log(`Users created: ${allUsers.length + 1}`);

  // Build 200,000 conversations
  console.log(`Building ${TOTAL_CONVERSATIONS} conversations...`);
  const statuses: ConversationStatus[] = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
  const subjects = [
    'Login issue', 'Payment problem', 'Feature request', 'Bug report',
    'Billing inquiry', 'Account locked', 'Slow performance', 'Data export',
    'Integration help', 'Password reset',
  ];

  const perTenant = Math.ceil(TOTAL_CONVERSATIONS / tenants.length);
  const conversations: any[] = [];

  for (const tenant of tenants) {
    const agents = allUsers.filter((u) => u.tenantId === tenant.id && u.role === 'AGENT');
    for (let i = 0; i < perTenant && conversations.length < TOTAL_CONVERSATIONS; i++) {
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

  await batchInsert(
    conversations,
    (batch) => prisma.conversation.createMany({ data: batch }),
    'Conversations'
  );

  // Fetch conversation IDs for message generation
  console.log('Fetching conversation IDs...');
  const convRows = await prisma.conversation.findMany({
    select: { id: true, tenantId: true },
  });

  // Build 1,000,000 messages
  console.log(`Building ${TOTAL_MESSAGES} messages...`);
  const texts = [
    'I need help with this issue.',
    'Looking into this now.',
    'Thanks for reaching out!',
    'Any update on this?',
    'This has been resolved.',
    'Can you provide more details?',
    'I have attached a screenshot.',
    'Let me escalate this.',
    'Please try clearing your cache.',
    'Is this still an issue?',
  ];

  const msgsPerConv = Math.ceil(TOTAL_MESSAGES / convRows.length);
  const messages: any[] = [];

  for (const conv of convRows) {
    const users = allUsers.filter((u) => u.tenantId === conv.tenantId);
    if (!users.length) continue;
    const count = Math.min(msgsPerConv, Math.floor(Math.random() * 3) + msgsPerConv - 1);
    for (let i = 0; i < count && messages.length < TOTAL_MESSAGES; i++) {
      messages.push({
        content: pick(texts),
        conversationId: conv.id,
        senderId: pick(users).id,
      });
    }
  }

  await batchInsert(
    messages,
    (batch) => prisma.message.createMany({ data: batch }),
    'Messages'
  );

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s: ${tenants.length} tenants, ${allUsers.length + 1} users, ${conversations.length} conversations, ${messages.length} messages`);
  console.log('Credentials: superadmin@support-saas.com / password123');
  console.log('             admin@acmecorp.com / password123');
  console.log('             agent1@acmecorp.com / password123');

  await prisma.$disconnect();
}

seed();
