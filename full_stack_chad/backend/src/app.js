import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { authMiddleware, adminOnly } from './middleware/auth.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { authRoutes } from './routes/authRoutes.js';
import { staffRoutes } from './routes/staffRoutes.js';
import { availabilityRoutes } from './routes/availabilityRoutes.js';
import { exceptionRoutes } from './routes/exceptionRoutes.js';
import { AvailabilityService } from './services/availabilityService.js';
import { ExceptionService } from './services/exceptionService.js';

export function createApp({ repository, config }) {
  const app = express();
  const auth = authMiddleware(config);

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(compression());
  app.use(cors({ origin: config.frontendUrl, credentials: true }));
  app.use(express.json({ limit: '200kb' }));
  app.use(morgan('dev'));
  app.use('/api', rateLimit({ windowMs: 60_000, max: 180, standardHeaders: true, legacyHeaders: false }));

  app.get('/api/health', (_req, res) => res.json({ status: 'ok', storage: config.supabaseConfigured ? 'supabase' : 'local' }));
  app.use('/api/auth', authRoutes({ repository, config }));
  app.use('/api/staff', auth, adminOnly, staffRoutes({ repository }));
  app.use('/api/availability', auth, adminOnly, availabilityRoutes({ service: new AvailabilityService(repository) }));
  app.use('/api/exceptions', auth, adminOnly, exceptionRoutes({ service: new ExceptionService(repository) }));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
