import express, { Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.routes';
import conversationRoutes from './routes/conversation.routes';
import analyticsRoutes from './routes/analytics.routes';
import { startEmailWorker } from './jobs/email.job';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

app.use('/api/auth', authRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/analytics', analyticsRoutes);

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use((err: Error, _req: Request, res: Response, _next: any) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

startEmailWorker();

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;
