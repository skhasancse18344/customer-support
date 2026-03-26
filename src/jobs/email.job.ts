import { Queue, Worker, Job } from 'bullmq';
import redis from '../lib/redis';

interface EmailJobData {
  conversationId: string;
  subject: string;
  agentEmail: string;
}

export const emailQueue = new Queue('email-notifications', {
  connection: redis,
});

export const sendResolutionEmail = async (data: EmailJobData) => {
  await emailQueue.add('resolution-email', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  });
};

export const startEmailWorker = () => {
  const worker = new Worker(
    'email-notifications',
    async (job: Job<EmailJobData>) => {
      const { conversationId, subject, agentEmail } = job.data;
      // In production, replace with SendGrid/AWS SES
      console.log(`Email sent to ${agentEmail} - Resolved: ${subject} (${conversationId})`);
      return { success: true, conversationId };
    },
    { connection: redis, concurrency: 5 }
  );

  worker.on('failed', (job, err) => {
    console.error(`Email job ${job?.id} failed:`, err.message);
  });

  console.log('Email worker started');
};
