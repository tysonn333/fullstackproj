import { Router, Response, NextFunction } from 'express';
import supabaseAdmin from '../lib/supabase';
import { authenticate, ensureSelfOrAdmin, AuthenticatedRequest } from '../middleware/auth';
import { logAudit } from '../services/audit.service';
import { parseWhatsAppMessage } from '../integrations/whatsapp';
import {
  raiseHalfDayGapFlags,
  raiseFullDayConflictFlags,
  raiseAvailabilityWindowGapFlags,
} from '../services/coverage.service';
import { timeToMinutes, availabilityEndMinutes } from '../services/scheduling/filter';

const router = Router();

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

/**
 * Coverage-gap detection for a changed availability record (UC-003 / Chad).
 * A start/end window means only those hours are available; half_day='am'
 * (legacy / WhatsApp) means only the AM half is available → the PM half is
 * blocked. Returns the number of flags raised.
 */
async function detectCoverageGaps(
  staffId: number,
  staffName: string,
  workDate: string,
  isAvailable: boolean,
  halfDay: 'am' | 'pm' | null,
  startTime: string | null,
  endTime: string | null,
  source: string
): Promise<number> {
  if (!isAvailable) {
    return raiseFullDayConflictFlags(staffId, staffName, [workDate], `unavailability (${source})`);
  }
  if (startTime && endTime) {
    return raiseAvailabilityWindowGapFlags(staffId, staffName, workDate, startTime, endTime, source);
  }
  if (halfDay) {
    const blockedHalf = halfDay === 'am' ? 'pm' : 'am';
    return raiseHalfDayGapFlags(staffId, staffName, workDate, blockedHalf, source);
  }
  return 0;
}

/**
 * GET /api/v1/staff/:id/availability
 * Query: from, to (YYYY-MM-DD)
 */
router.get(
  '/staff/:id/availability',
  authenticate,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const staffId = parseInt(req.params.id, 10);
      let query = supabaseAdmin
        .from('availability')
        .select('*')
        .eq('staff_id', staffId)
        .order('work_date', { ascending: true });

      if (req.query.from) query = query.gte('work_date', req.query.from as string);
      if (req.query.to) query = query.lte('work_date', req.query.to as string);

      const { data, error } = await query;
      if (error) throw error;

      res.json({ data });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/staff/:id/availability
 * Body: { work_date, is_available, start_time?, end_time?, half_day? }
 * start_time/end_time ("HH:MM") mark the window the staff member IS available
 * for (e.g. 13:00–19:00); omit both for a full-day answer. half_day is the
 * legacy AM/PM shorthand still used by the WhatsApp path.
 */
router.post(
  '/staff/:id/availability',
  authenticate,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const staffId = parseInt(req.params.id, 10);
      const { work_date, is_available, half_day } = req.body;
      let { start_time, end_time } = req.body;

      if (!work_date || is_available === undefined) {
        res.status(400).json({ error: 'work_date and is_available are required' });
        return;
      }

      // Time window: both bounds or neither, valid HH:MM, start before end.
      start_time = start_time || null;
      end_time = end_time || null;
      if ((start_time === null) !== (end_time === null)) {
        res.status(400).json({ error: 'start_time and end_time must be provided together' });
        return;
      }
      if (start_time !== null) {
        if (!TIME_RE.test(start_time) || !TIME_RE.test(end_time)) {
          res.status(400).json({ error: 'start_time and end_time must be HH:MM (00:00–23:59)' });
          return;
        }
        if (timeToMinutes(start_time) >= availabilityEndMinutes(end_time)) {
          res.status(400).json({ error: 'start_time must be before end_time' });
          return;
        }
        if (!is_available) {
          res.status(400).json({ error: 'a time window only applies when is_available is true' });
          return;
        }
      }

      // Employees may only set their own availability; admins may set anyone's.
      if (!ensureSelfOrAdmin(req, res, staffId)) return;

      // Upsert — one availability record per staff per day. A time window
      // supersedes the legacy AM/PM shorthand, so half_day is cleared with it.
      const { data, error } = await supabaseAdmin
        .from('availability')
        .upsert(
          {
            staff_id: staffId,
            work_date,
            is_available: Boolean(is_available),
            half_day: start_time ? null : half_day ?? null,
            start_time,
            end_time,
            source: 'app',
            created_at: new Date().toISOString(),
          },
          { onConflict: 'staff_id,work_date' }
        )
        .select()
        .single();

      if (error) throw error;

      await logAudit({
        entity_type: 'availability',
        entity_id: data.availability_id,
        action: 'create',
        actor_id: req.user!.id,
        details: { staff_id: staffId, work_date, is_available, half_day, start_time, end_time },
      });

      // Chad (UC-003): a reduced availability may strand existing assignments —
      // raise half_day_gap / coverage_gap flags for the exceptions panel.
      const { data: staffRow } = await supabaseAdmin
        .from('staff')
        .select('full_name')
        .eq('staff_id', staffId)
        .single();
      const flagsRaised = await detectCoverageGaps(
        staffId,
        staffRow?.full_name ?? `Staff ${staffId}`,
        work_date,
        Boolean(is_available),
        start_time ? null : half_day ?? null,
        start_time,
        end_time,
        'availability update'
      );

      res.status(201).json({ data, flags_raised: flagsRaised });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/integrations/whatsapp/webhook
 * Receives WhatsApp messages and parses availability updates.
 * This endpoint intentionally has no auth — it is secured by verifying the sender's phone.
 */
router.post('/integrations/whatsapp/webhook', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { from, message, timestamp } = req.body;

    if (!from || !message) {
      res.status(400).json({ error: 'from and message are required' });
      return;
    }

    // Look up staff by phone number
    const { data: staff, error: staffErr } = await supabaseAdmin
      .from('staff')
      .select('staff_id, full_name, status')
      .eq('phone', from)
      .eq('status', 'active')
      .single();

    if (staffErr || !staff) {
      // Unknown sender — acknowledge but do nothing
      res.json({ received: true, processed: false, reason: 'Unknown sender' });
      return;
    }

    // Parse the message for availability intent
    const parsed = parseWhatsAppMessage(message);

    if (!parsed) {
      res.json({ received: true, processed: false, reason: 'Could not parse availability from message' });
      return;
    }

    const msgDate = timestamp
      ? new Date(timestamp).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0];

    const workDate = parsed.date ?? msgDate;

    const { data: avail, error: availErr } = await supabaseAdmin
      .from('availability')
      .upsert(
        {
          staff_id: staff.staff_id,
          work_date: workDate,
          is_available: parsed.is_available,
          half_day: parsed.half_day ?? null,
          // WhatsApp only carries AM/PM granularity — clear any stale window
          // a previous app submission left on this day.
          start_time: null,
          end_time: null,
          source: 'whatsapp',
          created_at: new Date().toISOString(),
        },
        { onConflict: 'staff_id,work_date' }
      )
      .select()
      .single();

    if (availErr) throw availErr;

    // Chad (UC-003 A2): part-timer half-day availability via WhatsApp can
    // create a staffing gap on an already-crewed slot — flag it immediately.
    const flagsRaised = await detectCoverageGaps(
      staff.staff_id,
      staff.full_name,
      workDate,
      parsed.is_available,
      parsed.half_day ?? null,
      null,
      null,
      'WhatsApp availability'
    );

    res.json({
      received: true,
      processed: true,
      availability_id: avail.availability_id,
      staff_id: staff.staff_id,
      work_date: workDate,
      is_available: parsed.is_available,
      flags_raised: flagsRaised,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
