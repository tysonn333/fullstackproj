import express from 'express';
import { z } from 'zod';
import { exceptionsToCsv } from '../services/csvService.js';

const actionSchema = z.object({
  action: z.enum(['resolve', 'defer', 'dismiss', 'reject', 'reopen']),
  note: z.string().max(500).optional(),
  deferred_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export function exceptionRoutes({ service }) {
  const router = express.Router();

  router.get('/', async (req, res, next) => {
    try {
      const data = await service.list(req.query);
      res.json({ data });
    } catch (error) {
      next(error);
    }
  });

  router.get('/export.csv', async (req, res, next) => {
    try {
      const data = await service.list(req.query);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="scheduling-exceptions.csv"');
      res.send(exceptionsToCsv(data));
    } catch (error) {
      next(error);
    }
  });

  router.patch('/:id/action', async (req, res, next) => {
    try {
      const input = actionSchema.parse(req.body);
      const data = await service.action(req.params.id, input, req.user);
      if (!data) return res.status(404).json({ error: 'Exception not found' });
      res.json({ data });
    } catch (error) {
      next(error);
    }
  });

  router.post('/bulk-action', async (req, res, next) => {
    try {
      const ids = z.array(z.string()).min(1).max(100).parse(req.body.ids);
      const input = actionSchema.parse(req.body);
      const data = await service.bulkAction(ids, input, req.user);
      res.json({ data, count: data.length });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id/audit', async (req, res, next) => {
    try {
      const data = await service.audit(req.params.id);
      if (!data) return res.status(404).json({ error: 'Exception not found' });
      res.json({ data });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:id/notify', async (req, res, next) => {
    try {
      const data = await service.notification(req.params.id, req.user);
      if (!data) return res.status(404).json({ error: 'Exception not found' });
      res.json({ data });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
