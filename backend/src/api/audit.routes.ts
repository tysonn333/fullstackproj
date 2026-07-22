/**
 * Audit-log read + undo API (UC-006 last-minute-change trail — Jayden)
 *
 * Exposes the write-only audit_log that assignment/roster/flag actions already
 * populate:
 *   • GET  /api/v1/audit            — paginated, filterable history
 *   • POST /api/v1/audit/:id/undo   — revert a reassignment, marking the
 *                                     original log entry as undone (no new row)
 *
 * Admin-only. The undo path re-validates the previous staff member through the
 * UC-004 filter + UC-005 ranking so a revert can never re-create an ineligible
 * assignment.
 */

import { Router, Response, NextFunction } from 'express';
import supabaseAdmin from '../lib/supabase';
import { authenticate, requireAdmin, AuthenticatedRequest } from '../middleware/auth';
import { getEligibleCandidates } from '../services/scheduling/filter';
import { rankCandidates } from '../services/scheduling/ranking';

const router = Router();
router.use(authenticate);
router.use(requireAdmin);

/**
 * Fetch a slot with its roster date — mirrors the helper in assignment.routes.
 */
async function fetchSlotWithDate(
  slotId: number
): Promise<{ slot: Record<string, unknown>; rosterDate: string } | null> {
  const { data, error } = await supabaseAdmin
    .from('shift_slots')
    .select('*, rosters!inner(roster_date, status)')
    .eq('slot_id', slotId)
    .single();

  if (error || !data) return null;

  return {
    slot: data as unknown as Record<string, unknown>,
    rosterDate: (data as { rosters: { roster_date: string } }).rosters.roster_date,
  };
}

/**
 * GET /api/v1/audit
 * Query: entity_type, action, from (YYYY-MM-DD), to (YYYY-MM-DD), page, limit
 */
router.get('/', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const {
      entity_type,
      action,
      from,
      to,
      page: pageStr,
      limit: limitStr,
    } = req.query as Record<string, string | undefined>;

    const page = Math.max(1, parseInt(pageStr ?? '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(limitStr ?? '50', 10) || 50));
    const offset = (page - 1) * limit;

    let query = supabaseAdmin
      .from('audit_log')
      .select('*, profiles:actor_id(name, role)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (entity_type) query = query.eq('entity_type', entity_type);
    if (action) query = query.eq('action', action);
    if (from) query = query.gte('created_at', `${from}T00:00:00Z`);
    if (to) query = query.lte('created_at', `${to}T23:59:59Z`);

    const { data, error, count } = await query;

    if (error) throw error;

    res.json({
      data: data ?? [],
      total: count ?? 0,
      page,
      limit,
      total_pages: Math.ceil((count ?? 0) / limit),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/audit/:id/undo
 * Undoes a reassignment by updating the existing audit log entry (not creating
 * a new one). Body: { reason?: string }
 */
router.post('/:id/undo', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const logId = parseInt(req.params.id, 10);
    const { reason } = req.body;

    if (!Number.isInteger(logId) || logId <= 0) {
      res.status(400).json({ error: 'Invalid audit log ID' });
      return;
    }

    // Fetch the audit log entry
    const { data: logEntry, error: fetchErr } = await supabaseAdmin
      .from('audit_log')
      .select('*')
      .eq('log_id', logId)
      .single();

    if (fetchErr || !logEntry) {
      res.status(404).json({ error: 'Audit log entry not found' });
      return;
    }

    // Validate it's a reassign action
    if (logEntry.action !== 'reassign') {
      res.status(422).json({ error: 'Only reassign actions can be undone' });
      return;
    }

    const details = logEntry.details as Record<string, unknown> | null;
    if (!details || details.undone) {
      res.status(409).json({ error: 'This reassignment has already been undone' });
      return;
    }

    const slot_id = Number(details.slot_id);
    const previous_staff_id = Number(details.previous_staff_id);
    const roster_id = Number(details.roster_id);

    if (!slot_id || !previous_staff_id || !roster_id) {
      res
        .status(422)
        .json({ error: 'Audit log entry is missing required details (slot_id, previous_staff_id, roster_id)' });
      return;
    }

    // Verify roster exists and is in a mutable state
    const { data: roster, error: rosterErr } = await supabaseAdmin
      .from('rosters')
      .select('roster_id, roster_date, status')
      .eq('roster_id', roster_id)
      .single();

    if (rosterErr || !roster) {
      res.status(404).json({ error: 'Roster not found' });
      return;
    }

    if (!['draft', 'published', 'locked'].includes(roster.status)) {
      res.status(409).json({ error: 'Cannot undo: roster is not in a mutable state' });
      return;
    }

    // Fetch current assignment for the slot
    const { data: currentAssignment } = await supabaseAdmin
      .from('assignments')
      .select('*')
      .eq('slot_id', slot_id)
      .single();

    // Validate the previous staff (the one we are restoring) is still eligible
    const slotResult = await fetchSlotWithDate(slot_id);
    if (!slotResult) {
      res.status(404).json({ error: 'Slot not found' });
      return;
    }

    const slotTyped = slotResult.slot as unknown as Exclude<Parameters<typeof getEligibleCandidates>[0], null>;
    const filterResults = await getEligibleCandidates(slotTyped, slotResult.rosterDate);
    const candidate = filterResults.find((c) => c.staff_id === previous_staff_id);

    if (!candidate || candidate.hard_blocked) {
      res.status(422).json({
        error: `Cannot undo: staff #${previous_staff_id} is not eligible: ${
          candidate?.block_reason ?? 'not found in eligible pool'
        }`,
      });
      return;
    }

    // Score the staff member
    const rankedNew = await rankCandidates(
      filterResults.filter((c) => c.staff_id === previous_staff_id),
      slotTyped,
      slotResult.rosterDate
    );
    const newScore = rankedNew[0]?.score ?? 0;

    const assignmentValues = {
      slot_id,
      staff_id: previous_staff_id,
      score: newScore,
      status: currentAssignment && currentAssignment.status !== 'cancelled' ? 'swapped' : 'assigned',
      assigned_at: new Date().toISOString(),
    };

    const { data: updatedAssignment, error: assignErr } = currentAssignment
      ? await supabaseAdmin
          .from('assignments')
          .update(assignmentValues)
          .eq('assignment_id', currentAssignment.assignment_id)
          .select()
          .single()
      : await supabaseAdmin
          .from('assignments')
          .insert(assignmentValues)
          .select()
          .single();

    if (assignErr) throw assignErr;

    // Mark the existing audit log entry as undone (no new audit entry created)
    const undoDetails = {
      ...details,
      undone: true,
      undone_reason: reason ?? '',
      undone_at: new Date().toISOString(),
      undone_by: req.user!.id,
    };

    const { error: updateAuditErr } = await supabaseAdmin
      .from('audit_log')
      .update({ details: undoDetails })
      .eq('log_id', logId);

    if (updateAuditErr) throw updateAuditErr;

    res.json({
      success: true,
      data: updatedAssignment,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
