import { PrismaClient, Role, ConversationStatus } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const BATCH_SIZE = 1000;
const NUM_TENANTS = 10;
const NUM_CONVERSATIONS = 200_000;
const NUM_MESSAGES = 1_000_000;

// Helper function to generate random item from array
const randomItem = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

// Helper function to batch insert
async function batchInsert<T>(
  items: T[],
  insertFn: (batch: T[]) => Promise<any>,
  batchSize: number = BATCH_SIZE
) {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await insertFn(batch);
    console.log(`Inserted ${Math.min(i + batchSize, items.length)}/${items.length}`);
  }
}

async function seed() {
  console.log('🌱 Starting database seed...');

  try {
    // Clean existing data
    console.log('Cleaning existing data...');
    await prisma.message.deleteMany();
    await prisma.conversation.deleteMany();
    await prisma.user.deleteMany();
    await prisma.tenant.deleteMany();

    // Create tenants
    console.log(`Creating ${NUM_TENANTS} tenants...`);
    const tenants = [];
    for (let i = 1; i <= NUM_TENANTS; i++) {
      tenants.push({
        id: undefined,
        name: `Tenant ${i}`,
      });
    }

    const createdTenants = await Promise.all(
      tenants.map((t) => prisma.tenant.create({ data: t }))
    );
    console.log(`✓ Created ${createdTenants.length} tenants`);

    // Create users (admins and agents for each tenant)
    console.log('Creating users...');
    const hashedPassword = await bcrypt.hash('password123', 10);
    const users = [];

    // Create 1 super admin
    users.push({
      email: 'superadmin@support-saas.com',
      password: hashedPassword,
      firstName: 'Super',
      lastName: 'Admin',
      role: 'SUPER_ADMIN' as Role,
      tenantId: null,
    });

    // For each tenant, create 1 admin and 5 agents
    for (const tenant of createdTenants) {
      users.push({
        email: `admin@${tenant.name.toLowerCase().replace(' ', '')}.com`,
        password: hashedPassword,
        firstName: 'Admin',
        lastName: tenant.name,
        role: 'TENANT_ADMIN' as Role,
        tenantId: tenant.id,
      });

      for (let i = 1; i <= 5; i++) {
        users.push({
          email: `agent${i}@${tenant.name.toLowerCase().replace(' ', '')}.com`,
          password: hashedPassword,
          firstName: `Agent${i}`,
          lastName: tenant.name,
          role: 'AGENT' as Role,
          tenantId: tenant.id,
        });
      }
    }

    const createdUsers = await Promise.all(
      users.map((u) => prisma.user.create({ data: u }))
    );
    console.log(`✓ Created ${createdUsers.length} users`);

    // Group users by tenant for conversation assignment
    const usersByTenant = new Map<string, typeof createdUsers>();
    createdUsers.forEach((user) => {
      if (user.tenantId) {
        if (!usersByTenant.has(user.tenantId)) {
          usersByTenant.set(user.tenantId, []);
        }
        usersByTenant.get(user.tenantId)!.push(user);
      }
    });

    // Create conversations
    console.log(`Creating ${NUM_CONVERSATIONS} conversations...`);
    const conversationsPerTenant = Math.floor(NUM_CONVERSATIONS / NUM_TENANTS);
    const statuses: ConversationStatus[] = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
    const subjects = [
      'Unable to login',
      'Payment issue',
      'Feature request',
      'Bug report',
      'Account settings',
      'Integration help',
      'Data export request',
      'Performance concern',
      'Security question',
      'Billing inquiry',
    ];

    const conversations = [];
    for (const tenant of createdTenants) {
      const tenantUsers = usersByTenant.get(tenant.id) || [];
      const agents = tenantUsers.filter((u) => u.role === 'AGENT');

      for (let i = 0; i < conversationsPerTenant; i++) {
        const status = randomItem(statuses);
        const assignedAgent = status !== 'OPEN' && agents.length > 0 
          ? randomItem(agents) 
          : null;

        conversations.push({
          subject: randomItem(subjects),
          status,
          priority: Math.floor(Math.random() * 5) + 1,
          tenantId: tenant.id,
          assignedAgentId: assignedAgent?.id || null,
          createdAt: new Date(
            Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000
          ), // Random date within last 30 days
          resolvedAt: status === 'RESOLVED' ? new Date() : null,
        });
      }
    }

    await batchInsert(
      conversations,
      (batch) => prisma.conversation.createMany({ data: batch })
    );
    console.log(`✓ Created ${NUM_CONVERSATIONS} conversations`);

    // Fetch created conversations for message assignment
    console.log('Fetching conversations for message assignment...');
    const createdConversations = await prisma.conversation.findMany({
      select: { id: true, tenantId: true },
    });

    // Create messages
    console.log(`Creating ${NUM_MESSAGES} messages...`);
    const messagesPerConversation = Math.floor(NUM_MESSAGES / NUM_CONVERSATIONS);
    const messageTexts = [
      'Hello, I need help with this issue.',
      'Can you please look into this?',
      'Thank you for your assistance.',
      'I am following up on my previous message.',
      'This is urgent, please respond ASAP.',
      'I appreciate your help.',
      'Could you provide more details?',
      'This resolved my issue, thanks!',
      'I still need help with this.',
      'Can we schedule a call?',
    ];

    const messages = [];
    for (const conversation of createdConversations) {
      const tenantUsers = usersByTenant.get(conversation.tenantId) || [];
      if (tenantUsers.length === 0) continue;

      const numMessages = Math.max(
        1,
        Math.floor(Math.random() * messagesPerConversation * 2)
      );

      for (let i = 0; i < numMessages; i++) {
        messages.push({
          content: randomItem(messageTexts),
          conversationId: conversation.id,
          senderId: randomItem(tenantUsers).id,
          createdAt: new Date(
            Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000
          ),
        });

        if (messages.length >= NUM_MESSAGES) break;
      }

      if (messages.length >= NUM_MESSAGES) break;
    }

    // Trim to exact count if over
    if (messages.length > NUM_MESSAGES) {
      messages.length = NUM_MESSAGES;
    }

    await batchInsert(
      messages,
      (batch) => prisma.message.createMany({ data: batch })
    );
    console.log(`✓ Created ${messages.length} messages`);

    console.log('\n✅ Seeding completed successfully!');
    console.log('\n📊 Summary:');
    console.log(`   Tenants: ${createdTenants.length}`);
    console.log(`   Users: ${createdUsers.length}`);
    console.log(`   Conversations: ${NUM_CONVERSATIONS}`);
    console.log(`   Messages: ${messages.length}`);
    console.log('\n🔑 Test Credentials:');
    console.log('   Super Admin: superadmin@support-saas.com / password123');
    console.log('   Tenant Admin: admin@tenant1.com / password123');
    console.log('   Agent: agent1@tenant1.com / password123');
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

seed();
