import { Router, Response, NextFunction } from 'express';
import supabaseAdmin from '../lib/supabase';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { logAudit } from '../services/audit.service';

const router = Router();
router.use(authenticate);

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
 * POST /api/v1/staff
 */
router.post('/', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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
 * PUT /api/v1/staff/:id
 */
router.put('/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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
 * DELETE /api/v1/staff/:id
 * Soft delete — sets status to inactive
 */
router.delete('/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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
 * POST /api/v1/staff/:id/certifications
 */
router.post('/:id/certifications', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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
 * DELETE /api/v1/staff/:id/certifications/:certId
 */
router.delete('/:id/certifications/:certId', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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

export default router;
