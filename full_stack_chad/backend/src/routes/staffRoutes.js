import express from 'express';

export function staffRoutes({ repository }) {
  const router = express.Router();
  router.get('/', async (_req, res, next) => {
    try {
      res.json({ data: await repository.listStaff() });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
