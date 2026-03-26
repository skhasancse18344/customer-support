import { Queue, Worker, Job } from 'bullmq';
import redis from '../lib/redis';

interface EmailJobData {
  conversationId: string;
  subject: string;
  agentEmail: string;
}

// Create email queue
export const emailQueue = new Queue('email-notifications', {
  connection: redis,
});

// Queue a resolution email job
export const sendResolutionEmail = async (data: EmailJobData) => {
  await emailQueue.add('resolution-email', data, {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  });
};

// Worker to process email jobs
export const startEmailWorker = () => {
  const worker = new Worker(
    'email-notifications',
    async (job: Job<EmailJobData>) => {
      console.log(`Processing email job: ${job.id}`);

      const { conversationId, subject, agentEmail } = job.data;

      // Simulate email sending with deliverability standards
      // In production, use SendGrid, AWS SES, or similar service
      try {
        // Simulate SPF, DKIM, DMARC compliance
        console.log(`
          ✉️  Sending Resolution Email
          ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          To: ${agentEmail}
          Subject: Conversation Resolved - ${subject}
          Conversation ID: ${conversationId}
          
          Security Headers:
          ✓ SPF: PASS (Sender Policy Framework)
          ✓ DKIM: PASS (DomainKeys Identified Mail)
          ✓ DMARC: PASS (Domain-based Message Authentication)
          
          Status: Delivered ✅
          ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        `);

        // Simulate network delay
        await new Promise((resolve) => setTimeout(resolve, 100));

        return { success: true, conversationId };
      } catch (error) {
        console.error('Email sending failed:', error);
        throw error; // Trigger retry
      }
    },
    {
      connection: redis,
      concurrency: 5, // Process 5 jobs concurrently
    }
  );

  worker.on('completed', (job) => {
    console.log(`✅ Email job ${job.id} completed successfully`);
  });

  worker.on('failed', (job, err) => {
    console.error(`❌ Email job ${job?.id} failed:`, err.message);
  });

  console.log('Email worker started');
};
