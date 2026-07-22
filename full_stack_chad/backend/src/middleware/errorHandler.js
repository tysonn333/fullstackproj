import { ZodError } from 'zod';

export function notFound(_req, res) {
  res.status(404).json({ error: 'Route not found' });
}

export function errorHandler(error, _req, res, _next) {
  if (error instanceof ZodError) {
    return res.status(422).json({
      error: 'Validation failed',
      details: error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })),
    });
  }

  const status = error.status ?? 500;
  if (status >= 500) console.error(error);
  res.status(status).json({ error: status >= 500 ? 'Unexpected server error' : error.message });
}
