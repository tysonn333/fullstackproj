import { Router, Response, NextFunction } from 'express';
import supabaseAdmin from '../lib/supabase';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { parseCallCentreJobs } from '../integrations/callcentre';
import { logAudit } from '../services/audit.service';

const router = Router();
router.use(authenticate);

/**
 * GET /api/v1/jobs
 * Query: date, from, to, service_type, source
 */
router.get('/', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    let query = supabaseAdmin
      .from('jobs')
      .select('*')
      .order('job_date', { ascending: false })
      .order('pickup_time', { ascending: true });

    if (req.query.date) query = query.eq('job_date', req.query.date as string);
    if (req.query.from) query = query.gte('job_date', req.query.from as string);
    if (req.query.to) query = query.lte('job_date', req.query.to as string);
    if (req.query.service_type) query = query.eq('service_type', req.query.service_type as string);
    if (req.query.source) query = query.eq('source', req.query.source as string);

    const { data, error } = await query;
    if (error) throw error;

    res.json({ data, total: data?.length ?? 0 });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/jobs/import
 * Imports jobs from call centre data.
 * Body: { jobs: Array<{ job_date, pickup_time, service_type, pickup_loc, dropoff_loc, source? }> }
 *   OR  { raw: string } — raw CSV/text from call centre for parsing
 */
router.post('/import', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    let jobsToInsert: Array<{
      job_date: string;
      pickup_time: string;
      service_type: string;
      pickup_loc: string;
      dropoff_loc: string;
      source: string;
    }> = [];

    if (req.body.raw) {
      // Parse raw call centre export
      const parsed = parseCallCentreJobs(req.body.raw);
      jobsToInsert = parsed;
    } else if (Array.isArray(req.body.jobs)) {
      jobsToInsert = req.body.jobs.map((j: Record<string, unknown>) => ({
        job_date: j.job_date as string,
        pickup_time: j.pickup_time as string,
        service_type: j.service_type as string,
        pickup_loc: j.pickup_loc as string,
        dropoff_loc: j.dropoff_loc as string,
        source: (j.source as string) ?? 'call_centre',
        created_at: new Date().toISOString(),
      }));
    } else {
      res.status(400).json({ error: 'Provide either jobs array or raw string' });
      return;
    }

    if (jobsToInsert.length === 0) {
      res.status(400).json({ error: 'No valid jobs to import' });
      return;
    }

    // Validate required fields
    const invalid = jobsToInsert.filter((j) => !j.job_date || !j.pickup_time || !j.service_type);
    if (invalid.length > 0) {
      res.status(400).json({
        error: `${invalid.length} job(s) are missing required fields (job_date, pickup_time, service_type)`,
      });
      return;
    }

    const validServiceTypes = ['MTS', 'EAS'];
    const badType = jobsToInsert.find((j) => !validServiceTypes.includes(j.service_type));
    if (badType) {
      res.status(400).json({
        error: `Invalid service_type '${badType.service_type}'. Must be MTS or EAS.`,
      });
      return;
    }

    const withTimestamp = jobsToInsert.map((j) => ({
      ...j,
      created_at: new Date().toISOString(),
    }));

    const { data, error } = await supabaseAdmin
      .from('jobs')
      .insert(withTimestamp)
      .select();

    if (error) throw error;

    await logAudit({
      entity_type: 'jobs',
      entity_id: 0,
      action: 'import',
      actor_id: req.user!.id,
      details: { count: data?.length ?? 0, source: 'call_centre' },
    });

    res.status(201).json({
      imported: data?.length ?? 0,
      data,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
