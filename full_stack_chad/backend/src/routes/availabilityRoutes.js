import express from 'express';
import { currentMonthRange } from '../utils/date.js';

export function availabilityRoutes({ service }) {
  const router = express.Router();

  router.get('/', async (req, res, next) => {
    try {
      const range = currentMonthRange(req.query.month);
      const data = await service.list({ ...range, staffId: req.query.staff_id });
      res.json({ data });
    } catch (error) {
      next(error);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      res.status(201).json({ data: await service.create(req.body) });
    } catch (error) {
      next(error);
    }
  });

  router.put('/:id', async (req, res, next) => {
    try {
      const data = await service.update(req.params.id, req.body);
      if (!data) return res.status(404).json({ error: 'Availability record not found' });
      res.json({ data });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      const removed = await service.remove(req.params.id);
      if (!removed) return res.status(404).json({ error: 'Availability record not found' });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.post('/:id/whatsapp', async (req, res, next) => {
    try {
      const data = await service.whatsappLink(req.params.id, req.body.message);
      if (!data) return res.status(404).json({ error: 'Availability record not found' });
      res.json({ data });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
