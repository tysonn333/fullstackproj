import { Router, Response, NextFunction } from 'express';
import supabaseAdmin from '../lib/supabase';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { getEligibleCandidates, ShiftSlot } from '../services/scheduling/filter';
import { rankCandidates } from '../services/scheduling/ranking';
import { logAudit } from '../services/audit.service';
import { notifyAssignment } from '../services/notification.service';

const router = Router();
router.use(authenticate);

/**
 * Helper: Fetch a slot with its roster date.
 */
async function fetchSlotWithDate(slotId: number): Promise<{ slot: ShiftSlot; rosterDate: string } | null> {
  const { data, error } = await supabaseAdmin
    .from('shift_slots')
    .select('*, rosters!inner(roster_date, status)')
    .eq('slot_id', slotId)
    .single();

  if (error || !data) return null;

  return {
    slot: data as unknown as ShiftSlot,
    rosterDate: (data as { rosters: { roster_date: string } }).rosters.roster_date,
  };
}

/**
 * GET /api/v1/slots/:id/eligible
 * Returns all candidates with their filter results (eligible + blocked).
 */
router.get('/slots/:id/eligible', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const slotId = parseInt(req.params.id, 10);
    const result = await fetchSlotWithDate(slotId);

    if (!result) {
      res.status(404).json({ error: 'Slot not found' });
      return;
    }

    const filterResults = await getEligibleCandidates(result.slot, result.rosterDate);

    res.json({
      slot_id: slotId,
      roster_date: result.rosterDate,
      total: filterResults.length,
      eligible_count: filterResults.filter((r) => r.eligible).length,
      results: filterResults,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/slots/:id/ranked
 * Returns ranked eligible candidates for a slot.
 */
router.get('/slots/:id/ranked', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const slotId = parseInt(req.params.id, 10);
    const result = await fetchSlotWithDate(slotId);

    if (!result) {
      res.status(404).json({ error: 'Slot not found' });
      return;
    }

    const filterResults = await getEligibleCandidates(result.slot, result.rosterDate);
    const ranked = await rankCandidates(filterResults, result.slot, result.rosterDate);

    res.json({
      slot_id: slotId,
      roster_date: result.rosterDate,
      ranked_candidates: ranked,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/slots/:id/assign
 * Assigns a specific staff member to a slot.
 * Body: { staff_id }
 */
router.post('/slots/:id/assign', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const slotId = parseInt(req.params.id, 10);
    const { staff_id } = req.body;

    if (!staff_id) {
      res.status(400).json({ error: 'staff_id is required' });
      return;
    }

    const result = await fetchSlotWithDate(slotId);
    if (!result) {
      res.status(404).json({ error: 'Slot not found' });
      return;
    }

    // Check if slot already assigned
    const { data: existing } = await supabaseAdmin
      .from('assignments')
      .select('assignment_id, status')
      .eq('slot_id', slotId)
      .neq('status', 'cancelled')
      .single();

    if (existing) {
      res.status(409).json({
        error: `Slot already has an active assignment (assignment_id: ${existing.assignment_id}). Cancel it first or use PUT /assignments/:id.`,
      });
      return;
    }

    // Run filter to validate eligibility
    const filterResults = await getEligibleCandidates(result.slot, result.rosterDate);
    const candidate = filterResults.find((c) => c.staff_id === staff_id);

    if (!candidate) {
      res.status(404).json({ error: `Staff member ${staff_id} not found in eligible pool` });
      return;
    }

    if (candidate.hard_blocked) {
      res.status(422).json({
        error: `Staff member ${staff_id} is not eligible: ${candidate.block_reason}`,
      });
      return;
    }

    // Score the candidate
    const ranked = await rankCandidates(
      filterResults.filter((c) => c.staff_id === staff_id),
      result.slot,
      result.rosterDate
    );
    const score = ranked[0]?.score ?? 0;

    const { data: assignment, error: assignErr } = await supabaseAdmin
      .from('assignments')
      .insert({
        slot_id: slotId,
        staff_id,
        score,
        status: 'assigned',
        assigned_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (assignErr) {
      if (assignErr.code === '23505') {
        res.status(409).json({ error: 'This slot is already assigned' });
        return;
      }
      throw assignErr;
    }

    await logAudit({
      entity_type: 'assignments',
      entity_id: assignment.assignment_id,
      action: 'assign',
      actor_id: req.user!.id,
      details: { slot_id: slotId, staff_id, score, roster_date: result.rosterDate },
    });

    await notifyAssignment(
      staff_id,
      slotId,
      result.rosterDate,
      result.slot.start_time,
      result.slot.end_time
    );

    // Raise consecutive days flag if applicable
    if (candidate.consecutive_days_flag) {
      const { data: rosterRow } = await supabaseAdmin
        .from('shift_slots')
        .select('roster_id')
        .eq('slot_id', slotId)
        .single();

      if (rosterRow) {
        await supabaseAdmin.from('flags').insert({
          roster_id: rosterRow.roster_id,
          slot_id: slotId,
          staff_id,
          flag_type: 'consecutive_days',
          severity: 'warning',
          message: `Staff ${candidate.full_name} has ${candidate.consecutive_days_count} consecutive working days prior to this shift`,
          status: 'active',
          created_at: new Date().toISOString(),
        });
      }
    }

    res.status(201).json({ data: assignment });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/v1/assignments/:id
 * Updates assignment status or swaps staff member.
 * Body: { status?, staff_id? }
 */
router.put('/assignments/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const assignmentId = parseInt(req.params.id, 10);
    const { status, staff_id } = req.body;

    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from('assignments')
      .select('*, shift_slots!inner(slot_id, roster_id, start_time, end_time, service_type, crew_position, rosters!inner(roster_date, status))')
      .eq('assignment_id', assignmentId)
      .single();

    if (fetchErr || !existing) {
      res.status(404).json({ error: 'Assignment not found' });
      return;
    }

    // Prevent edits to locked rosters
    const rosterStatus = (existing as { shift_slots: { rosters: { status: string } } }).shift_slots.rosters.status;
    if (rosterStatus === 'locked') {
      res.status(403).json({ error: 'Cannot modify assignments in a locked roster' });
      return;
    }

    const update: Record<string, unknown> = {};
    if (status) {
      const validStatuses = ['assigned', 'confirmed', 'swapped', 'cancelled'];
      if (!validStatuses.includes(status)) {
        res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });
        return;
      }
      update.status = status;
    }

    if (staff_id && staff_id !== existing.staff_id) {
      // Validate new staff eligibility
      const slotData = existing.shift_slots as unknown as ShiftSlot;
      const rosterDate = (existing as { shift_slots: { rosters: { roster_date: string } } }).shift_slots.rosters.roster_date;
      const filterResults = await getEligibleCandidates(slotData, rosterDate);
      const newCandidate = filterResults.find((c) => c.staff_id === staff_id);

      if (!newCandidate || newCandidate.hard_blocked) {
        res.status(422).json({
          error: `New staff member ${staff_id} is not eligible: ${newCandidate?.block_reason ?? 'not in staff pool'}`,
        });
        return;
      }

      update.staff_id = staff_id;
      update.status = 'swapped';
    }

    if (Object.keys(update).length === 0) {
      res.status(400).json({ error: 'No valid fields to update (status or staff_id required)' });
      return;
    }

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('assignments')
      .update(update)
      .eq('assignment_id', assignmentId)
      .select()
      .single();

    if (updateErr || !updated) throw updateErr;

    await logAudit({
      entity_type: 'assignments',
      entity_id: assignmentId,
      action: staff_id ? 'reassign' : 'update',
      actor_id: req.user!.id,
      details: { changes: update, previous_staff_id: existing.staff_id },
    });

    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/roster/:id/reassign
 * Last-minute change: reassign a slot within a published roster.
 * Body: { slot_id, new_staff_id, reason? }
 */
router.post('/:id/reassign', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const rosterId = parseInt(req.params.id, 10);
    const { slot_id, new_staff_id, reason } = req.body;

    if (!slot_id || !new_staff_id) {
      res.status(400).json({ error: 'slot_id and new_staff_id are required' });
      return;
    }

    // Verify roster exists and is published
    const { data: roster, error: rosterErr } = await supabaseAdmin
      .from('rosters')
      .select('roster_id, roster_date, status')
      .eq('roster_id', rosterId)
      .single();

    if (rosterErr || !roster) {
      res.status(404).json({ error: 'Roster not found' });
      return;
    }

    if (!['published', 'locked'].includes(roster.status)) {
      res.status(409).json({ error: 'Reassignment only allowed on published or locked rosters' });
      return;
    }

    // Fetch current assignment for the slot
    const { data: currentAssignment } = await supabaseAdmin
      .from('assignments')
      .select('*')
      .eq('slot_id', slot_id)
      .neq('status', 'cancelled')
      .single();

    // Fetch slot
    const slotResult = await fetchSlotWithDate(slot_id);
    if (!slotResult) {
      res.status(404).json({ error: 'Slot not found' });
      return;
    }

    // Validate new staff eligibility
    const filterResults = await getEligibleCandidates(slotResult.slot, slotResult.rosterDate);
    const newCandidate = filterResults.find((c) => c.staff_id === new_staff_id);

    if (!newCandidate || newCandidate.hard_blocked) {
      res.status(422).json({
        error: `Staff member ${new_staff_id} is not eligible: ${newCandidate?.block_reason ?? 'not found'}`,
      });
      return;
    }

    // Cancel old assignment if it exists
    if (currentAssignment) {
      await supabaseAdmin
        .from('assignments')
        .update({ status: 'cancelled' })
        .eq('assignment_id', currentAssignment.assignment_id);
    }

    // Create new assignment
    const { data: newAssignment, error: assignErr } = await supabaseAdmin
      .from('assignments')
      .insert({
        slot_id,
        staff_id: new_staff_id,
        score: 0,
        status: 'assigned',
        assigned_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (assignErr) throw assignErr;

    await logAudit({
      entity_type: 'assignments',
      entity_id: newAssignment.assignment_id,
      action: 'reassign',
      actor_id: req.user!.id,
      details: {
        roster_id: rosterId,
        slot_id,
        previous_staff_id: currentAssignment?.staff_id,
        new_staff_id,
        reason: reason ?? '',
      },
    });

    res.json({
      data: newAssignment,
      previous_assignment: currentAssignment ?? null,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/roster/:id/reassign/:slotId/candidates
 * Returns ranked candidates for last-minute reassignment.
 */
router.get('/:id/reassign/:slotId/candidates', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const slotId = parseInt(req.params.slotId, 10);
    const result = await fetchSlotWithDate(slotId);

    if (!result) {
      res.status(404).json({ error: 'Slot not found' });
      return;
    }

    const filterResults = await getEligibleCandidates(result.slot, result.rosterDate);
    const ranked = await rankCandidates(filterResults, result.slot, result.rosterDate);

    // Also include currently assigned staff_id for reference
    const { data: currentAssignment } = await supabaseAdmin
      .from('assignments')
      .select('staff_id')
      .eq('slot_id', slotId)
      .neq('status', 'cancelled')
      .single();

    res.json({
      slot_id: slotId,
      roster_date: result.rosterDate,
      current_staff_id: currentAssignment?.staff_id ?? null,
      candidates: ranked,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
