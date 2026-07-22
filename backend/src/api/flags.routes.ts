import { Router, Response, NextFunction } from 'express';
import supabaseAdmin from '../lib/supabase';
import { authenticate, requireAdmin, AuthenticatedRequest } from '../middleware/auth';
import { logAudit, AuditAction } from '../services/audit.service';

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
      details: {
        flag_type: flag.flag_type,
        resolution_note,
        previous_status: flag.status,
        new_status: 'resolved',
      },
    });

    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/v1/flags/:id/dismiss
 * Body: { reason } — a reason of >= 10 characters is required (Chad UC-008).
 */
router.put('/:id/dismiss', requireAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const flagId = parseInt(req.params.id, 10);
    const reason: string = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';

    if (reason.length < 10) {
      res.status(422).json({ error: 'A reason of at least 10 characters is required to dismiss a flag' });
      return;
    }

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
        resolution_note: reason,
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
      details: {
        flag_type: flag.flag_type,
        reason,
        previous_status: flag.status,
        new_status: 'dismissed',
      },
    });

    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * Shared helper: load a flag by id or send 404. Returns null when not found
 * (response already sent), otherwise the flag row.
 */
async function loadFlagOr404(
  flagId: number,
  res: Response
): Promise<Record<string, unknown> | null> {
  const { data: flag, error } = await supabaseAdmin
    .from('flags')
    .select('*')
    .eq('flag_id', flagId)
    .single();
  if (error || !flag) {
    res.status(404).json({ error: 'Flag not found' });
    return null;
  }
  return flag;
}

/**
 * PUT /api/v1/flags/:id/defer  (admin) — Chad UC-008
 * Snooze a flag until a future date. Body: { deferred_until (YYYY-MM-DD), note? }
 */
router.put('/:id/defer', requireAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const flagId = parseInt(req.params.id, 10);
    const { deferred_until, note } = req.body;

    if (!deferred_until || !/^\d{4}-\d{2}-\d{2}$/.test(String(deferred_until))) {
      res.status(422).json({ error: 'A defer date (deferred_until, YYYY-MM-DD) is required' });
      return;
    }

    const flag = await loadFlagOr404(flagId, res);
    if (!flag) return;

    if (!['active', 'deferred'].includes(flag.status as string)) {
      res.status(409).json({ error: `Cannot defer a flag that is '${flag.status}'` });
      return;
    }

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('flags')
      .update({
        status: 'deferred',
        deferred_until,
        resolution_note: typeof note === 'string' && note.trim() ? note.trim() : null,
      })
      .eq('flag_id', flagId)
      .select()
      .single();

    if (updateErr || !updated) throw updateErr;

    await logAudit({
      entity_type: 'flags',
      entity_id: flagId,
      action: 'defer',
      actor_id: req.user!.id,
      details: {
        flag_type: flag.flag_type,
        deferred_until,
        note: note ?? null,
        previous_status: flag.status,
        new_status: 'deferred',
      },
    });

    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/v1/flags/:id/reject  (admin) — Chad UC-008
 * Reject a flag as not a real problem. Requires a reason of >= 10 characters.
 * Body: { reason }
 */
router.put('/:id/reject', requireAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const flagId = parseInt(req.params.id, 10);
    const reason: string = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';

    if (reason.length < 10) {
      res.status(422).json({ error: 'A reason of at least 10 characters is required to reject a flag' });
      return;
    }

    const flag = await loadFlagOr404(flagId, res);
    if (!flag) return;

    if (!['active', 'deferred'].includes(flag.status as string)) {
      res.status(409).json({ error: `Flag is already '${flag.status}'` });
      return;
    }

    const now = new Date().toISOString();
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('flags')
      .update({
        status: 'rejected',
        resolved_at: now,
        resolved_by: req.user!.id,
        resolution_note: reason,
      })
      .eq('flag_id', flagId)
      .select()
      .single();

    if (updateErr || !updated) throw updateErr;

    await logAudit({
      entity_type: 'flags',
      entity_id: flagId,
      action: 'reject',
      actor_id: req.user!.id,
      details: {
        flag_type: flag.flag_type,
        reason,
        previous_status: flag.status,
        new_status: 'rejected',
      },
    });

    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/v1/flags/:id/reopen  (admin) — Chad UC-008
 * Return a resolved/dismissed/rejected/deferred flag to active.
 */
router.put('/:id/reopen', requireAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const flagId = parseInt(req.params.id, 10);

    const flag = await loadFlagOr404(flagId, res);
    if (!flag) return;

    if (flag.status === 'active') {
      res.status(409).json({ error: 'Flag is already active' });
      return;
    }

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('flags')
      .update({
        status: 'active',
        resolved_at: null,
        resolved_by: null,
        deferred_until: null,
      })
      .eq('flag_id', flagId)
      .select()
      .single();

    if (updateErr || !updated) throw updateErr;

    await logAudit({
      entity_type: 'flags',
      entity_id: flagId,
      action: 'reopen',
      actor_id: req.user!.id,
      details: {
        flag_type: flag.flag_type,
        previous_status: flag.status,
        new_status: 'active',
      },
    });

    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/flags/:id/audit  (admin) — Chad UC-008
 * Full action history for one flag, newest first, read from the audit log.
 */
router.get('/:id/audit', requireAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const flagId = parseInt(req.params.id, 10);

    const flag = await loadFlagOr404(flagId, res);
    if (!flag) return;

    const { data, error } = await supabaseAdmin
      .from('audit_log')
      .select('*, profiles:actor_id(name, role)')
      .eq('entity_type', 'flags')
      .eq('entity_id', flagId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({ data: data ?? [] });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/flags/:id/notify  (admin) — Chad UC-008
 * Returns a browser-notification payload for a single flag and records that a
 * notification was requested. Body: none.
 */
router.post('/:id/notify', requireAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const flagId = parseInt(req.params.id, 10);

    const { data: flag, error } = await supabaseAdmin
      .from('flags')
      .select('*, rosters(roster_date), shift_slots(start_time, end_time)')
      .eq('flag_id', flagId)
      .single();

    if (error || !flag) {
      res.status(404).json({ error: 'Flag not found' });
      return;
    }

    const rosterDate = (flag.rosters as { roster_date?: string } | null)?.roster_date ?? '';
    const slot = flag.shift_slots as { start_time?: string; end_time?: string } | null;
    const window = slot?.start_time && slot?.end_time
      ? `${String(slot.start_time).slice(0, 5)}-${String(slot.end_time).slice(0, 5)}`
      : '';
    const payload = {
      title: `${String(flag.severity).toUpperCase()}: Scheduling exception`,
      body: `${rosterDate} ${window} - ${flag.message}`.trim(),
      tag: `flag-${flagId}`,
    };

    await logAudit({
      entity_type: 'flags',
      entity_id: flagId,
      action: 'notify',
      actor_id: req.user!.id,
      details: { flag_type: flag.flag_type, note: 'Browser notification requested' },
    });

    res.json({ data: payload });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/flags/bulk-action
 * Body: { flag_ids: number[], action: 'resolve'|'dismiss'|'defer'|'reject'|'reopen', reason?, deferred_until? }
 * dismiss/reject require a reason of >= 10 characters; defer requires
 * deferred_until (YYYY-MM-DD) (Chad UC-008).
 */
const BULK_ACTIONS: Record<string, { newStatus: string; from: string[]; kind: 'terminal' | 'defer' | 'reopen' }> = {
  resolve: { newStatus: 'resolved', from: ['active', 'deferred'], kind: 'terminal' },
  dismiss: { newStatus: 'dismissed', from: ['active', 'deferred'], kind: 'terminal' },
  reject: { newStatus: 'rejected', from: ['active', 'deferred'], kind: 'terminal' },
  defer: { newStatus: 'deferred', from: ['active'], kind: 'defer' },
  reopen: { newStatus: 'active', from: ['resolved', 'dismissed', 'rejected', 'deferred'], kind: 'reopen' },
};

router.post('/bulk-action', requireAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { flag_ids, action, reason, deferred_until } = req.body;

    if (!Array.isArray(flag_ids) || flag_ids.length === 0) {
      res.status(400).json({ error: 'flag_ids must be a non-empty array' });
      return;
    }

    const spec = BULK_ACTIONS[action as string];
    if (!spec) {
      res.status(400).json({ error: `action must be one of: ${Object.keys(BULK_ACTIONS).join(', ')}` });
      return;
    }

    if (flag_ids.length > 100) {
      res.status(400).json({ error: 'Cannot process more than 100 flags at once' });
      return;
    }

    if (
      (action === 'reject' || action === 'dismiss') &&
      (typeof reason !== 'string' || reason.trim().length < 10)
    ) {
      res.status(422).json({ error: `A reason of at least 10 characters is required to ${action} flags` });
      return;
    }

    if (action === 'defer' && (!deferred_until || !/^\d{4}-\d{2}-\d{2}$/.test(String(deferred_until)))) {
      res.status(422).json({ error: 'A defer date (deferred_until, YYYY-MM-DD) is required' });
      return;
    }

    const now = new Date().toISOString();
    const update: Record<string, unknown> = { status: spec.newStatus };
    if (spec.kind === 'terminal') {
      update.resolved_at = now;
      update.resolved_by = req.user!.id;
      if (typeof reason === 'string' && reason.trim()) update.resolution_note = reason.trim();
    } else if (spec.kind === 'defer') {
      update.deferred_until = deferred_until;
      if (typeof reason === 'string' && reason.trim()) update.resolution_note = reason.trim();
    } else {
      // reopen — clear terminal / deferral bookkeeping
      update.resolved_at = null;
      update.resolved_by = null;
      update.deferred_until = null;
    }

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('flags')
      .update(update)
      .in('flag_id', flag_ids)
      .in('status', spec.from)
      .select('flag_id, status');

    if (updateErr) throw updateErr;

    await logAudit({
      entity_type: 'flags',
      entity_id: 0,
      action: action as AuditAction,
      actor_id: req.user!.id,
      details: { flag_ids, action, reason, new_status: spec.newStatus, updated_count: updated?.length ?? 0 },
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
