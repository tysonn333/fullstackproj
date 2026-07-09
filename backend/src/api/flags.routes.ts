import { Router, Response, NextFunction } from 'express';
import supabaseAdmin from '../lib/supabase';
import { authenticate, requireAdmin, AuthenticatedRequest } from '../middleware/auth';
import { logAudit } from '../services/audit.service';

const router = Router();
router.use(authenticate);

/**
 * GET /api/v1/flags
 * Query: roster_id, status, severity, flag_type, staff_id
 */
router.get('/', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    let query = supabaseAdmin
      .from('flags')
      .select(`
        *,
        rosters(roster_date, status),
        shift_slots(start_time, end_time, service_type, crew_position),
        staff(full_name, role),
        profiles:resolved_by(name)
      `)
      .order('created_at', { ascending: false });

    if (req.query.roster_id) query = query.eq('roster_id', parseInt(req.query.roster_id as string, 10));
    if (req.query.status) query = query.eq('status', req.query.status as string);
    if (req.query.severity) query = query.eq('severity', req.query.severity as string);
    if (req.query.flag_type) query = query.eq('flag_type', req.query.flag_type as string);
    if (req.query.staff_id) query = query.eq('staff_id', parseInt(req.query.staff_id as string, 10));

    const { data, error } = await query;
    if (error) throw error;

    res.json({ data, total: data?.length ?? 0 });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/v1/flags/:id/resolve
 * Body: { resolution_note? }
 */
router.put('/:id/resolve', requireAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const flagId = parseInt(req.params.id, 10);
    const { resolution_note } = req.body;

    const { data: flag, error: fetchErr } = await supabaseAdmin
      .from('flags')
      .select('*')
      .eq('flag_id', flagId)
      .single();

    if (fetchErr || !flag) {
      res.status(404).json({ error: 'Flag not found' });
      return;
    }

    if (flag.status === 'resolved') {
      res.status(409).json({ error: 'Flag is already resolved' });
      return;
    }

    const now = new Date().toISOString();
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('flags')
      .update({
        status: 'resolved',
        resolved_at: now,
        resolved_by: req.user!.id,
        ...(resolution_note ? { message: `${flag.message} | Resolution: ${resolution_note}` } : {}),
      })
      .eq('flag_id', flagId)
      .select()
      .single();

    if (updateErr || !updated) throw updateErr;

    await logAudit({
      entity_type: 'flags',
      entity_id: flagId,
      action: 'resolve',
      actor_id: req.user!.id,
      details: { flag_type: flag.flag_type, resolution_note },
    });

    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/v1/flags/:id/dismiss
 * Body: { reason? }
 */
router.put('/:id/dismiss', requireAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const flagId = parseInt(req.params.id, 10);
    const { reason } = req.body;

    const { data: flag, error: fetchErr } = await supabaseAdmin
      .from('flags')
      .select('*')
      .eq('flag_id', flagId)
      .single();

    if (fetchErr || !flag) {
      res.status(404).json({ error: 'Flag not found' });
      return;
    }

    if (['resolved', 'dismissed'].includes(flag.status)) {
      res.status(409).json({ error: `Flag is already '${flag.status}'` });
      return;
    }

    const now = new Date().toISOString();
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('flags')
      .update({
        status: 'dismissed',
        resolved_at: now,
        resolved_by: req.user!.id,
      })
      .eq('flag_id', flagId)
      .select()
      .single();

    if (updateErr || !updated) throw updateErr;

    await logAudit({
      entity_type: 'flags',
      entity_id: flagId,
      action: 'dismiss',
      actor_id: req.user!.id,
      details: { flag_type: flag.flag_type, reason },
    });

    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/flags/bulk-action
 * Body: { flag_ids: number[], action: 'resolve' | 'dismiss', reason? }
 */
router.post('/bulk-action', requireAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { flag_ids, action, reason } = req.body;

    if (!Array.isArray(flag_ids) || flag_ids.length === 0) {
      res.status(400).json({ error: 'flag_ids must be a non-empty array' });
      return;
    }

    if (!['resolve', 'dismiss'].includes(action)) {
      res.status(400).json({ error: "action must be 'resolve' or 'dismiss'" });
      return;
    }

    if (flag_ids.length > 100) {
      res.status(400).json({ error: 'Cannot process more than 100 flags at once' });
      return;
    }

    const now = new Date().toISOString();
    const newStatus = action === 'resolve' ? 'resolved' : 'dismissed';

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('flags')
      .update({
        status: newStatus,
        resolved_at: now,
        resolved_by: req.user!.id,
      })
      .in('flag_id', flag_ids)
      .in('status', ['active']) // Only act on active flags
      .select('flag_id, status');

    if (updateErr) throw updateErr;

    await logAudit({
      entity_type: 'flags',
      entity_id: 0,
      action: action === 'resolve' ? 'resolve' : 'dismiss',
      actor_id: req.user!.id,
      details: { flag_ids, action, reason, updated_count: updated?.length ?? 0 },
    });

    res.json({
      updated_count: updated?.length ?? 0,
      skipped_count: flag_ids.length - (updated?.length ?? 0),
      data: updated,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/flags/export
 * Returns flags as a CSV-compatible JSON array for export.
 * Query params same as GET /flags
 */
router.get('/export', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    let query = supabaseAdmin
      .from('flags')
      .select(`
        flag_id, flag_type, severity, message, status, created_at, resolved_at,
        rosters(roster_date),
        shift_slots(start_time, end_time, service_type, crew_position),
        staff(full_name, role),
        profiles:resolved_by(name)
      `)
      .order('created_at', { ascending: false });

    if (req.query.roster_id) query = query.eq('roster_id', parseInt(req.query.roster_id as string, 10));
    if (req.query.status) query = query.eq('status', req.query.status as string);
    if (req.query.severity) query = query.eq('severity', req.query.severity as string);
    if (req.query.flag_type) query = query.eq('flag_type', req.query.flag_type as string);

    const { data, error } = await query;
    if (error) throw error;

    // Flatten for CSV export
    const rows = (data ?? []).map((f: Record<string, unknown>) => ({
      flag_id: f.flag_id,
      flag_type: f.flag_type,
      severity: f.severity,
      message: f.message,
      status: f.status,
      created_at: f.created_at,
      resolved_at: f.resolved_at,
      roster_date: (f.rosters as { roster_date?: string })?.roster_date,
      shift_start: (f.shift_slots as { start_time?: string })?.start_time,
      shift_end: (f.shift_slots as { end_time?: string })?.end_time,
      service_type: (f.shift_slots as { service_type?: string })?.service_type,
      crew_position: (f.shift_slots as { crew_position?: string })?.crew_position,
      staff_name: (f.staff as { full_name?: string })?.full_name,
      staff_role: (f.staff as { role?: string })?.role,
      resolved_by: (f.profiles as { name?: string })?.name,
    }));

    if (req.query.format === 'csv') {
      if (rows.length === 0) {
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="flags.csv"');
        res.send('');
        return;
      }

      const headers = Object.keys(rows[0]);
      const csvLines = [
        headers.join(','),
        ...rows.map((row) =>
          headers
            .map((h) => {
              const val = (row as Record<string, unknown>)[h];
              if (val === null || val === undefined) return '';
              const str = String(val);
              return str.includes(',') || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
            })
            .join(',')
        ),
      ];

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="flags.csv"');
      res.send(csvLines.join('\n'));
      return;
    }

    res.json({ data: rows, total: rows.length });
  } catch (err) {
    next(err);
  }
});

export default router;
