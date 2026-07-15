import { Router, Response, NextFunction } from 'express';
import supabaseAdmin from '../lib/supabase';
import { authenticate, requireRole, AuthenticatedRequest } from '../middleware/auth';

const router = Router();
router.use(authenticate);
router.use(requireRole('staff'));

/**
 * Look up staff record by auth user — tries profile_id first, falls back to email.
 */
async function findStaffByAuthUser(userId: string, userEmail?: string): Promise<number | null> {
  // Try profile_id
  const { data: byProfile } = await supabaseAdmin
    .from('staff')
    .select('staff_id')
    .eq('profile_id', userId)
    .maybeSingle();

  if (byProfile) return byProfile.staff_id;

  // Fall back to email
  if (userEmail) {
    const { data: byEmail } = await supabaseAdmin
      .from('staff')
      .select('staff_id')
      .eq('email', userEmail)
      .maybeSingle();

    if (byEmail) return byEmail.staff_id;
  }

  return null;
}

/**
 * GET /api/v1/me/schedule?date=YYYY-MM-DD
 * Returns the logged-in staff member's assignments for the given date
 * (plus a 7-day window around it for context).
 */
router.get('/schedule', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const date = (req.query.date as string) ?? new Date().toISOString().split('T')[0];

    const staffId = await findStaffByAuthUser(req.user!.id, req.user?.email);
    if (!staffId) {
      res.status(404).json({ error: 'Staff record not linked to this account' });
      return;
    }

    // Determine week range
    const start = new Date(date);
    start.setDate(start.getDate() - 3);
    const weekStart = start.toISOString().split('T')[0];
    const end = new Date(date);
    end.setDate(end.getDate() + 3);
    const weekEnd = end.toISOString().split('T')[0];

    const { data: assignments, error: assignErr } = await supabaseAdmin
      .from('assignments')
      .select(`
        assignment_id, slot_id, staff_id, status, assigned_at,
        shift_slots!inner(
          slot_id, roster_id, ambulance_id, start_time, end_time, service_type, crew_position,
          rosters!inner(roster_date)
        )
      `)
      .eq('staff_id', staffId)
      .neq('status', 'cancelled');

    if (assignErr) throw assignErr;

    // Filter to the window
    type AssignWithRosterDate = { shift_slots: { rosters: { roster_date: string } } };
    const inWindow = (assignments ?? []).filter((a) => {
      const rosterDate = (a as unknown as AssignWithRosterDate).shift_slots.rosters.roster_date;
      return rosterDate >= weekStart && rosterDate <= weekEnd;
    });

    res.json({ data: { date, assignments: inWindow } });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/me/roster/today
 * Returns today's roster (read-only) with the staff member's own slots highlighted.
 */
router.get('/roster/today', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const staffId = await findStaffByAuthUser(req.user!.id, req.user?.email);
    if (!staffId) {
      res.status(404).json({ error: 'Staff record not linked to this account' });
      return;
    }

    // Fetch today's roster
    const { data: rosters, error: rosterErr } = await supabaseAdmin
      .from('rosters')
      .select('roster_id, roster_date, status')
      .eq('roster_date', today)
      .single();

    if (rosterErr || !rosters) {
      res.json({ data: null, my_staff_id: staffId });
      return;
    }

    // Fetch slots with assignments
    const { data: slots, error: slotsErr } = await supabaseAdmin
      .from('shift_slots')
      .select(`*, ambulances(registration, service_type)`)
      .eq('roster_id', rosters.roster_id)
      .order('start_time', { ascending: true });

    if (slotsErr) throw slotsErr;

    const slotIds = (slots ?? []).map((s: { slot_id: number }) => s.slot_id);

    let assignmentsMap: Record<number, unknown[]> = {};
    if (slotIds.length > 0) {
      const { data: assignments, error: assignErr } = await supabaseAdmin
        .from('assignments')
        .select(`*, staff(full_name, role, employment_type, phone, email, home_postal, status)`)
        .in('slot_id', slotIds)
        .neq('status', 'cancelled');

      if (assignErr) throw assignErr;

      for (const a of assignments ?? []) {
        const sid = (a as Record<string, unknown>).slot_id as number;
        if (!assignmentsMap[sid]) assignmentsMap[sid] = [];
        assignmentsMap[sid].push(a);
      }
    }

    const mergedSlots = (slots ?? []).map((slot: Record<string, unknown>) => ({
      ...slot,
      assignments: assignmentsMap[slot.slot_id as number] ?? [],
      is_my_slot: (assignmentsMap[slot.slot_id as number] ?? []).some(
        (a) => (a as { staff_id: number }).staff_id === staffId
      ),
    }));

    res.json({
      data: { roster: rosters, slots: mergedSlots },
      my_staff_id: staffId,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/me/roster?date=YYYY-MM-DD
 * Returns a read-only roster for any date (not just today).
 */
router.get('/roster', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const date = (req.query.date as string) ?? new Date().toISOString().split('T')[0];

    const staffId = await findStaffByAuthUser(req.user!.id, req.user?.email);
    if (!staffId) {
      res.status(404).json({ error: 'Staff record not linked to this account' });
      return;
    }

    const { data: rosters, error: rosterErr } = await supabaseAdmin
      .from('rosters')
      .select('roster_id, roster_date, status')
      .eq('roster_date', date)
      .single();

    if (rosterErr || !rosters) {
      res.json({ data: null, my_staff_id: staffId });
      return;
    }

    const { data: slots, error: slotsErr } = await supabaseAdmin
      .from('shift_slots')
      .select(`*, ambulances(registration, service_type)`)
      .eq('roster_id', rosters.roster_id)
      .order('start_time', { ascending: true });

    if (slotsErr) throw slotsErr;

    const slotIds = (slots ?? []).map((s: { slot_id: number }) => s.slot_id);

    let assignmentsMap: Record<number, unknown[]> = {};
    if (slotIds.length > 0) {
      const { data: assignments, error: assignErr } = await supabaseAdmin
        .from('assignments')
        .select(`*, staff(full_name, role, employment_type, phone, email, home_postal, status)`)
        .in('slot_id', slotIds)
        .neq('status', 'cancelled');

      if (assignErr) throw assignErr;

      for (const a of assignments ?? []) {
        const sid = (a as Record<string, unknown>).slot_id as number;
        if (!assignmentsMap[sid]) assignmentsMap[sid] = [];
        assignmentsMap[sid].push(a);
      }
    }

    const mergedSlots = (slots ?? []).map((slot: Record<string, unknown>) => ({
      ...slot,
      assignments: assignmentsMap[slot.slot_id as number] ?? [],
      is_my_slot: (assignmentsMap[slot.slot_id as number] ?? []).some(
        (a) => (a as { staff_id: number }).staff_id === staffId
      ),
    }));

    res.json({
      data: { roster: rosters, slots: mergedSlots },
      my_staff_id: staffId,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
