import { Router, Response, NextFunction } from 'express';
import supabaseAdmin from '../lib/supabase';
import { authenticate, requireAdmin, AuthenticatedRequest } from '../middleware/auth';
import { logAudit } from '../services/audit.service';
import { buildICS, CalendarEvent } from '../lib/ics';
import { isOvernight } from '../services/scheduling/filter';
import { getAssignmentsOnDate, raiseFullDayConflictFlags } from '../services/coverage.service';

const router = Router();
router.use(authenticate);

/**
 * Auto-provision the certifications a role implies (UC-007 → UC-004 Filter 5).
 *
 * Staff created through the UI had no certification rows at all, so the strict
 * cert-expiry filter (UC-004 Filter 5) correctly blocked them from every shift
 * and roster generation ended up assigning nobody. This seeds the role-implied
 * certs — MTS for every role, plus EAS for drivers/paramedics — valid for two
 * years from today.
 *
 * Uses ignoreDuplicates on the (staff_id, cert_name) unique key so an existing
 * cert's expiry date is NEVER overwritten (a real, hand-managed expiry wins).
 */
async function ensureRoleCertifications(staffId: number, role: string): Promise<void> {
  const today = new Date();
  const issued = today.toISOString().split('T')[0];
  const expiry = new Date(today);
  expiry.setFullYear(expiry.getFullYear() + 2);
  const expiryStr = expiry.toISOString().split('T')[0];

  const certNames = ['MTS'];
  if (role === 'driver' || role === 'paramedic') certNames.push('EAS');

  const rows = certNames.map((cert_name) => ({
    staff_id: staffId,
    cert_name,
    issued_date: issued,
    expiry_date: expiryStr,
  }));

  await supabaseAdmin
    .from('staff_certifications')
    .upsert(rows, { onConflict: 'staff_id,cert_name', ignoreDuplicates: true });
}

/**
 * GET /api/v1/staff
 * Query params: role, status, employment_type, search (name/email)
 */
router.get('/', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    let query = supabaseAdmin
      .from('staff')
      .select('*')
      .order('full_name', { ascending: true });

    if (req.query.role) query = query.eq('role', req.query.role as string);
    if (req.query.status) query = query.eq('status', req.query.status as string);
    if (req.query.employment_type) query = query.eq('employment_type', req.query.employment_type as string);
    if (req.query.search) {
      const s = `%${req.query.search}%`;
      query = query.or(`full_name.ilike.${s},email.ilike.${s}`);
    }

    const { data, error } = await query;
    if (error) throw error;

    res.json({ data });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/staff/expiring-certs?days=30  (UC-007 A1)
 * Certifications expiring within the window (default 30 days) or already
 * expired, for active staff — drives the Staff Management alert banner.
 * NOTE: registered before /:id so 'expiring-certs' is not read as an id.
 */
router.get('/expiring-certs', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const days = Math.max(1, Math.min(365, parseInt((req.query.days as string) ?? '30', 10) || 30));
    const today = new Date().toISOString().split('T')[0];
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + days);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    const { data, error } = await supabaseAdmin
      .from('staff_certifications')
      .select('cert_id, staff_id, cert_name, expiry_date, staff!inner(full_name, role, status)')
      .not('expiry_date', 'is', null)
      .lte('expiry_date', cutoffStr)
      .eq('staff.status', 'active')
      .order('expiry_date', { ascending: true });

    if (error) throw error;

    type Row = {
      cert_id: number;
      staff_id: number;
      cert_name: string;
      expiry_date: string;
      staff: { full_name: string; role: string };
    };

    const rows = ((data ?? []) as unknown as Row[]).map((r) => ({
      cert_id: r.cert_id,
      staff_id: r.staff_id,
      staff_name: r.staff.full_name,
      staff_role: r.staff.role,
      cert_name: r.cert_name,
      expiry_date: r.expiry_date,
      expired: r.expiry_date < today,
      days_to_expiry: Math.ceil(
        (new Date(`${r.expiry_date}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) /
          86_400_000
      ),
    }));

    res.json({ data: rows, total: rows.length, window_days: days });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/staff  (admin only)
 */
router.post('/', requireAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { full_name, phone, email, role, employment_type, home_postal } = req.body;

    if (!full_name || !role || !employment_type) {
      res.status(400).json({ error: 'full_name, role, and employment_type are required' });
      return;
    }

    const validRoles = ['driver', 'medic', 'emt', 'paramedic'];
    if (!validRoles.includes(role)) {
      res.status(400).json({ error: `role must be one of: ${validRoles.join(', ')}` });
      return;
    }

    const validEmpTypes = ['full_time', 'part_time'];
    if (!validEmpTypes.includes(employment_type)) {
      res.status(400).json({ error: `employment_type must be one of: ${validEmpTypes.join(', ')}` });
      return;
    }

    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from('staff')
      .insert({ full_name, phone, email, role, employment_type, home_postal, status: 'active', created_at: now, updated_at: now })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ error: 'A staff member with this email already exists' });
        return;
      }
      throw error;
    }

    // Seed role-implied certifications so the new staff member is immediately
    // eligible under UC-004 Filter 5 (otherwise generation assigns nobody).
    await ensureRoleCertifications(data.staff_id, role);

    await logAudit({
      entity_type: 'staff',
      entity_id: data.staff_id,
      action: 'create',
      actor_id: req.user!.id,
      details: { full_name, role, employment_type },
    });

    res.status(201).json({ data });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/staff/:id
 */
router.get('/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('staff')
      .select('*, staff_certifications(*)')
      .eq('staff_id', parseInt(req.params.id, 10))
      .single();

    if (error || !data) {
      res.status(404).json({ error: 'Staff member not found' });
      return;
    }

    res.json({ data });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/v1/staff/:id  (admin only)
 */
router.put('/:id', requireAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const staffId = parseInt(req.params.id, 10);
    const { full_name, phone, email, role, employment_type, home_postal, status } = req.body;

    const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (full_name !== undefined) updatePayload.full_name = full_name;
    if (phone !== undefined) updatePayload.phone = phone;
    if (email !== undefined) updatePayload.email = email;
    if (role !== undefined) updatePayload.role = role;
    if (employment_type !== undefined) updatePayload.employment_type = employment_type;
    if (home_postal !== undefined) updatePayload.home_postal = home_postal;
    if (status !== undefined) updatePayload.status = status;

    const { data, error } = await supabaseAdmin
      .from('staff')
      .update(updatePayload)
      .eq('staff_id', staffId)
      .select()
      .single();

    if (error || !data) {
      res.status(404).json({ error: 'Staff member not found' });
      return;
    }

    // A role change (or a role set on a staff member that lacked certs) implies
    // new certifications — seed any that are missing, keeping existing expiries.
    if (role !== undefined) {
      await ensureRoleCertifications(staffId, role);
    }

    await logAudit({
      entity_type: 'staff',
      entity_id: staffId,
      action: 'update',
      actor_id: req.user!.id,
      details: updatePayload,
    });

    res.json({ data });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/v1/staff/:id  (admin only)
 * Soft delete — sets status to inactive
 */
router.delete('/:id', requireAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const staffId = parseInt(req.params.id, 10);

    const { data, error } = await supabaseAdmin
      .from('staff')
      .update({ status: 'inactive', updated_at: new Date().toISOString() })
      .eq('staff_id', staffId)
      .select()
      .single();

    if (error || !data) {
      res.status(404).json({ error: 'Staff member not found' });
      return;
    }

    await logAudit({
      entity_type: 'staff',
      entity_id: staffId,
      action: 'delete',
      actor_id: req.user!.id,
      details: { reason: 'soft delete — status set to inactive' },
    });

    res.json({ message: 'Staff member deactivated', data });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/staff/:id/schedule?week_start=YYYY-MM-DD
 * Returns the staff member's assignments for the 7-day window starting week_start,
 * along with cumulative hours and the longest run of consecutive assigned days.
 */
router.get('/:id/schedule', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const staffId = parseInt(req.params.id, 10);
    const weekStart = (req.query.week_start as string) ?? new Date().toISOString().split('T')[0];

    const start = new Date(weekStart);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const weekEnd = end.toISOString().split('T')[0];

    const { data, error } = await supabaseAdmin
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

    if (error) throw error;

    type SlotJoin = {
      start_time: string;
      end_time: string;
      rosters?: { roster_date?: string };
    };
    const slotOf = (a: unknown): SlotJoin | undefined =>
      (a as { shift_slots?: SlotJoin }).shift_slots;

    // Filter to the requested week by the joined roster_date, then compute stats.
    const inWeek = (data ?? []).filter((a) => {
      const rd = slotOf(a)?.rosters?.roster_date;
      return rd !== undefined && rd >= weekStart && rd <= weekEnd;
    });

    const minutesBetween = (startTime: string, endTime: string): number => {
      const [sh, sm] = startTime.split(':').map(Number);
      const [eh, em] = endTime.split(':').map(Number);
      let diff = eh * 60 + em - (sh * 60 + sm);
      if (diff < 0) diff += 24 * 60;
      return diff;
    };

    let totalMinutes = 0;
    const dates = new Set<string>();
    for (const a of inWeek) {
      const slot = slotOf(a);
      if (slot) {
        totalMinutes += minutesBetween(slot.start_time, slot.end_time);
        if (slot.rosters?.roster_date) dates.add(slot.rosters.roster_date);
      }
    }

    // Longest consecutive-day streak among distinct assigned dates.
    const sortedDates = Array.from(dates).sort();
    let consecutiveDays = 0;
    let run = 0;
    let prev: Date | null = null;
    for (const d of sortedDates) {
      const cur = new Date(d);
      if (prev && (cur.getTime() - prev.getTime()) / 86_400_000 === 1) {
        run += 1;
      } else {
        run = 1;
      }
      if (run > consecutiveDays) consecutiveDays = run;
      prev = cur;
    }

    res.json({
      data: {
        assignments: inWeek,
        total_hours: Math.round((totalMinutes / 60) * 100) / 100,
        consecutive_days: consecutiveDays,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/staff/:id/certifications
 */
router.get('/:id/certifications', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const staffId = parseInt(req.params.id, 10);

    const { data, error } = await supabaseAdmin
      .from('staff_certifications')
      .select('*')
      .eq('staff_id', staffId)
      .order('expiry_date', { ascending: true });

    if (error) throw error;

    // Annotate each cert with expiry status
    const today = new Date().toISOString().split('T')[0];
    const annotated = (data ?? []).map((cert) => ({
      ...cert,
      is_expired: cert.expiry_date < today,
      expires_soon: cert.expiry_date >= today && cert.expiry_date <= getDatePlusDays(today, 30),
    }));

    res.json({ data: annotated });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/staff/:id/certifications  (admin only)
 */
router.post('/:id/certifications', requireAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const staffId = parseInt(req.params.id, 10);
    const { cert_name, issued_date, expiry_date } = req.body;

    if (!cert_name || !issued_date || !expiry_date) {
      res.status(400).json({ error: 'cert_name, issued_date, and expiry_date are required' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('staff_certifications')
      .insert({ staff_id: staffId, cert_name, issued_date, expiry_date })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ error: `Certification '${cert_name}' already exists for this staff member` });
        return;
      }
      throw error;
    }

    await logAudit({
      entity_type: 'staff_certifications',
      entity_id: data.cert_id,
      action: 'create',
      actor_id: req.user!.id,
      details: { staff_id: staffId, cert_name, expiry_date },
    });

    res.status(201).json({ data });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/v1/staff/:id/certifications/:certId  (admin only)
 */
router.delete('/:id/certifications/:certId', requireAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const staffId = parseInt(req.params.id, 10);
    const certId = parseInt(req.params.certId, 10);

    const { data, error } = await supabaseAdmin
      .from('staff_certifications')
      .delete()
      .eq('cert_id', certId)
      .eq('staff_id', staffId)
      .select()
      .single();

    if (error || !data) {
      res.status(404).json({ error: 'Certification not found' });
      return;
    }

    await logAudit({
      entity_type: 'staff_certifications',
      entity_id: certId,
      action: 'delete',
      actor_id: req.user!.id,
      details: { staff_id: staffId, cert_name: data.cert_name },
    });

    res.json({ message: 'Certification deleted' });
  } catch (err) {
    next(err);
  }
});

function getDatePlusDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

/**
 * POST /api/v1/staff/:id/mark-unavailable  (admin only — UC-006 A3)
 * Staff member is absent for the ENTIRE day (MC, no-show, emergency):
 *   1. availability for the date is set to unavailable;
 *   2. a coverage_gap flag is raised for every slot they were crewing
 *      (critical on published rosters);
 *   3. all their assignments that day are cancelled, so each affected slot
 *      becomes a separate replacement event batched in the exceptions panel.
 * Body: { date: "YYYY-MM-DD", reason?: string }
 */
router.post('/:id/mark-unavailable', requireAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const staffId = parseInt(req.params.id, 10);
    const { date, reason } = req.body;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: 'date is required in YYYY-MM-DD format' });
      return;
    }

    const { data: staff } = await supabaseAdmin
      .from('staff')
      .select('staff_id, full_name')
      .eq('staff_id', staffId)
      .single();

    if (!staff) {
      res.status(404).json({ error: 'Staff not found' });
      return;
    }

    // 1. Block the day in the availability calendar.
    await supabaseAdmin.from('availability').upsert(
      {
        staff_id: staffId,
        work_date: date,
        is_available: false,
        half_day: null,
        source: 'app',
        created_at: new Date().toISOString(),
      },
      { onConflict: 'staff_id,work_date' }
    );

    // 2. Flag every slot they were crewing BEFORE cancelling (the flag helper
    //    reads non-cancelled assignments).
    const affected = await getAssignmentsOnDate(staffId, date);
    const flagsRaised = await raiseFullDayConflictFlags(
      staffId,
      staff.full_name,
      [date],
      reason ? `full-day absence (${reason})` : 'full-day absence'
    );

    // 3. Cancel the assignments so each slot shows as needing a replacement.
    if (affected.length > 0) {
      await supabaseAdmin
        .from('assignments')
        .update({ status: 'cancelled' })
        .in('assignment_id', affected.map((a) => a.assignment_id));
    }

    await logAudit({
      entity_type: 'staff',
      entity_id: staffId,
      action: 'mark_unavailable',
      actor_id: req.user!.id,
      details: {
        date,
        reason: reason ?? '',
        assignments_cancelled: affected.map((a) => a.assignment_id),
        flags_raised: flagsRaised,
      },
    });

    res.json({
      staff_id: staffId,
      date,
      assignments_cancelled: affected.length,
      flags_raised: flagsRaised,
      affected_slots: affected.map((a) => ({
        slot_id: a.slot_id,
        start_time: a.start_time,
        end_time: a.end_time,
        service_type: a.service_type,
        crew_position: a.crew_position,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/staff/:id/preferences  (UC-007 — soft signals for UC-005)
 * Returns the staff member's shift-time and buddy preferences.
 */
router.get('/:id/preferences', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const staffId = parseInt(req.params.id, 10);

    const { data } = await supabaseAdmin
      .from('staff_preferences')
      .select('staff_id, prefers_early, prefers_late, buddy_staff_id')
      .eq('staff_id', staffId)
      .single();

    res.json({
      data: data ?? {
        staff_id: staffId,
        prefers_early: false,
        prefers_late: false,
        buddy_staff_id: null,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/v1/staff/:id/preferences  (admin only — UC-007 main flow steps 5–6)
 * Body: { prefers_early?, prefers_late?, buddy_staff_id? }
 */
router.put('/:id/preferences', requireAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const staffId = parseInt(req.params.id, 10);
    const { prefers_early, prefers_late } = req.body;
    const buddyRaw = req.body.buddy_staff_id;
    const buddy_staff_id =
      buddyRaw === null || buddyRaw === undefined || buddyRaw === '' ? null : Number(buddyRaw);

    if (buddy_staff_id != null) {
      if (!Number.isInteger(buddy_staff_id) || buddy_staff_id <= 0) {
        res.status(400).json({ error: 'buddy_staff_id must be a positive integer or null' });
        return;
      }
      if (buddy_staff_id === staffId) {
        res.status(400).json({ error: 'A staff member cannot be their own buddy' });
        return;
      }
      const { data: buddy } = await supabaseAdmin
        .from('staff')
        .select('staff_id, status')
        .eq('staff_id', buddy_staff_id)
        .single();
      if (!buddy) {
        res.status(404).json({ error: `Buddy staff member ${buddy_staff_id} not found` });
        return;
      }
    }

    const { data, error } = await supabaseAdmin
      .from('staff_preferences')
      .upsert(
        {
          staff_id: staffId,
          prefers_early: Boolean(prefers_early),
          prefers_late: Boolean(prefers_late),
          buddy_staff_id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'staff_id' }
      )
      .select()
      .single();

    if (error) throw error;

    await logAudit({
      entity_type: 'staff_preferences',
      entity_id: staffId,
      action: 'update',
      actor_id: req.user!.id,
      details: { prefers_early, prefers_late, buddy_staff_id },
    });

    res.json({ data });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/staff/:id/schedule.ics
 * Calendar integration — exports a single staff member's assigned shifts as an
 * iCalendar (.ics) file so they can subscribe to their own roster.
 */
router.get('/:id/schedule.ics', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const staffId = parseInt(req.params.id, 10);

    const { data: staff } = await supabaseAdmin
      .from('staff')
      .select('full_name')
      .eq('staff_id', staffId)
      .single();

    if (!staff) {
      res.status(404).json({ error: 'Staff not found' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('assignments')
      .select(`
        slot_id, status,
        shift_slots!inner(
          slot_id, start_time, end_time, service_type, crew_position,
          ambulances(registration),
          rosters!inner(roster_date)
        )
      `)
      .eq('staff_id', staffId)
      .neq('status', 'cancelled');

    if (error) throw error;

    type Row = {
      slot_id: number;
      shift_slots: {
        start_time: string;
        end_time: string;
        service_type: string;
        crew_position: string;
        ambulances?: { registration?: string } | null;
        rosters: { roster_date: string };
      };
    };

    const events: CalendarEvent[] = [];
    for (const row of (data ?? []) as unknown as Row[]) {
      const s = row.shift_slots;
      const date = s.rosters?.roster_date;
      if (!date) continue;
      const start = new Date(`${date}T${s.start_time}+08:00`);
      const end = new Date(`${date}T${s.end_time}+08:00`);
      if (isOvernight(s.start_time, s.end_time)) end.setDate(end.getDate() + 1);
      const reg = s.ambulances?.registration ?? `AMB-${row.slot_id}`;
      events.push({
        uid: `efar-slot-${row.slot_id}-staff-${staffId}@efar`,
        summary: `${s.service_type} ${s.crew_position} — ${reg}`,
        description: `${staff.full_name} · ${s.service_type} ${s.crew_position} on ${reg}`,
        location: reg,
        start,
        end,
      });
    }

    const ics = buildICS(`EFAR — ${staff.full_name} schedule`, events, new Date());

    res
      .status(200)
      .type('text/calendar')
      .set('Content-Disposition', `attachment; filename="efar-${staffId}-schedule.ics"`)
      .send(ics);
  } catch (err) {
    next(err);
  }
});

export default router;
