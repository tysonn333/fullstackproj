import { Router, Response, NextFunction } from 'express';
import supabaseAdmin from '../lib/supabase';
import { authenticate, requireAdmin, AuthenticatedRequest } from '../middleware/auth';
import { generateRoster } from '../services/scheduling/generator';
import { logAudit } from '../services/audit.service';
import { notifyRosterPublished } from '../services/notification.service';

const router = Router();
router.use(authenticate);

/**
 * GET /api/v1/roster?date=YYYY-MM-DD
 * Returns roster info for a given date, or all rosters if no date given.
 */
router.get('/', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    let query = supabaseAdmin
      .from('rosters')
      .select('*, profiles:published_by(name, role)')
      .order('roster_date', { ascending: false });

    if (req.query.date) query = query.eq('roster_date', req.query.date as string);
    if (req.query.status) query = query.eq('status', req.query.status as string);
    if (req.query.from) query = query.gte('roster_date', req.query.from as string);
    if (req.query.to) query = query.lte('roster_date', req.query.to as string);

    const { data, error } = await query;
    if (error) throw error;

    res.json({ data });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/roster/generate  (admin only)
 * Body: { date: "YYYY-MM-DD", force?: boolean }
 */
router.post('/generate', requireAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { date, force } = req.body;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: 'date is required in YYYY-MM-DD format' });
      return;
    }

    const result = await generateRoster({
      rosterDate: date,
      actorId: req.user!.id,
      force: Boolean(force),
    });

    res.status(201).json({ data: result });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('already exists')) {
      res.status(409).json({ error: err.message });
      return;
    }
    next(err);
  }
});

/**
 * GET /api/v1/roster/:id/slots
 * Returns all slots for a roster with assignments.
 */
router.get('/:id/slots', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const rosterId = parseInt(req.params.id, 10);

    // Verify roster exists
    const { data: roster, error: rosterErr } = await supabaseAdmin
      .from('rosters')
      .select('roster_id, roster_date, status')
      .eq('roster_id', rosterId)
      .single();

    if (rosterErr || !roster) {
      res.status(404).json({ error: 'Roster not found' });
      return;
    }

    const { data: slots, error: slotsErr } = await supabaseAdmin
      .from('shift_slots')
      .select(`
        *,
        ambulances(registration, service_type),
        assignments(
          assignment_id, staff_id, score, status, assigned_at,
          staff(full_name, role, employment_type, phone, email, home_postal, status)
        )
      `)
      .eq('roster_id', rosterId)
      .order('start_time', { ascending: true });

    if (slotsErr) throw slotsErr;

    res.json({
      roster,
      slots: slots ?? [],
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/v1/roster/:id/publish  (admin only)
 * Transitions roster from draft → published.
 */
router.put('/:id/publish', requireAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const rosterId = parseInt(req.params.id, 10);

    const { data: roster, error: fetchErr } = await supabaseAdmin
      .from('rosters')
      .select('*')
      .eq('roster_id', rosterId)
      .single();

    if (fetchErr || !roster) {
      res.status(404).json({ error: 'Roster not found' });
      return;
    }

    if (roster.status === 'published' || roster.status === 'locked') {
      res.status(409).json({ error: `Roster is already '${roster.status}'` });
      return;
    }

    // Check for critical unresolved flags before publishing
    const { data: criticalFlags } = await supabaseAdmin
      .from('flags')
      .select('flag_id, flag_type, message')
      .eq('roster_id', rosterId)
      .eq('severity', 'critical')
      .eq('status', 'active');

    const now = new Date().toISOString();

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('rosters')
      .update({
        status: 'published',
        published_at: now,
        published_by: req.user!.id,
      })
      .eq('roster_id', rosterId)
      .select()
      .single();

    if (updateErr || !updated) throw updateErr;

    await logAudit({
      entity_type: 'rosters',
      entity_id: rosterId,
      action: 'publish',
      actor_id: req.user!.id,
      details: { roster_date: roster.roster_date, critical_flags: criticalFlags?.length ?? 0 },
    });

    // Notify assigned staff
    await notifyRosterPublished(rosterId, roster.roster_date);

    res.json({
      data: updated,
      warnings:
        criticalFlags && criticalFlags.length > 0
          ? `Published with ${criticalFlags.length} unresolved critical flag(s). Review recommended.`
          : undefined,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
