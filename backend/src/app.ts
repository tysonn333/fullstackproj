import './lib/env';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import { errorHandler, notFound } from './middleware/errorHandler';

import authRoutes from './api/auth.routes';
import staffRoutes from './api/staff.routes';
import availabilityRoutes from './api/availability.routes';
import leaveRoutes from './api/leave.routes';
import rosterRoutes from './api/roster.routes';
import assignmentRoutes from './api/assignment.routes';
import flagsRoutes from './api/flags.routes';
import jobsRoutes from './api/jobs.routes';

const app = express();

// ── Security & logging middleware ──────────────────────────────────────────

app.use(helmet());

const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
app.use(
  cors({
    origin: [frontendUrl, 'http://localhost:5173', 'http://localhost:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ── Health check ──────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});

// ── API routes ─────────────────────────────────────────────────────────────

const API = '/api/v1';

app.use(`${API}/auth`, authRoutes);
app.use(`${API}/staff`, staffRoutes);
app.use(`${API}`, availabilityRoutes);        // Handles /api/v1/staff/:id/availability and /api/v1/integrations/...
app.use(`${API}/leave`, leaveRoutes);
app.use(`${API}/roster`, rosterRoutes);
app.use(`${API}`, assignmentRoutes);          // Handles /api/v1/slots/..., /api/v1/assignments/..., and /api/v1/:id/reassign/... (no /roster segment — the frontend calls it this way)
app.use(`${API}/flags`, flagsRoutes);
app.use(`${API}/jobs`, jobsRoutes);

// ── 404 & error handlers ──────────────────────────────────────────────────

app.use(notFound);
app.use(errorHandler);

// ── Server startup ─────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? '3000', 10);

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`[SERVER] EFAR Backend running on port ${PORT}`);
    console.log(`[SERVER] Environment: ${process.env.NODE_ENV ?? 'development'}`);
    console.log(`[SERVER] CORS origin: ${frontendUrl}`);
  });
}

export default app;
