import { Router, Response, NextFunction } from 'express';
import supabaseAdmin from '../lib/supabase';
import { authenticate, ensureSelfOrAdmin, AuthenticatedRequest } from '../middleware/auth';
import { logAudit } from '../services/audit.service';
import {
  parseWhatsAppMessage,
  formatWhatsAppResponse,
  WHATSAPP_HELP_MESSAGE,
} from '../integrations/whatsapp';
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
  reason: string | null,
  source: string
): Promise<number> {
  if (!isAvailable) {
    // Quote the staff member's own reason in the flag so the admin can judge
    // whether they can still be called back for the stranded slot.
    const cause = reason ? `unavailability ("${reason}")` : `unavailability (${source})`;
    return raiseFullDayConflictFlags(staffId, staffName, [workDate], cause);
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
 * Body: { work_date, is_available, start_time?, end_time?, reason?, half_day? }
 * start_time/end_time ("HH:MM") mark the window the staff member IS available
 * for (e.g. 13:00–19:00); omit both for a full-day answer. reason is mandatory
 * when is_available=false — admins use it to decide whether the person can
 * still be called for unfilled slots. half_day is the legacy AM/PM shorthand
 * still used by the WhatsApp path.
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

      // Unavailability must carry a reason (mandatory in the form too).
      const reason: string | null =
        typeof req.body.reason === 'string' && req.body.reason.trim()
          ? req.body.reason.trim().slice(0, 500)
          : null;
      if (!is_available && !reason) {
        res.status(400).json({ error: 'reason is required when marking unavailable' });
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
            // A reason only makes sense while unavailable — clear it otherwise.
            reason: is_available ? null : reason,
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
        details: { staff_id: staffId, work_date, is_available, half_day, start_time, end_time, reason },
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
        is_available ? null : reason,
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
 * Receives WhatsApp messages and parses availability updates (UC-003 A2).
 * Understands relative dates ("today", "tmr"), date ranges ("20/07 to 22/07"
 * — one availability row per day), and time windows ("free 1pm-7pm") which
 * map onto the same start/end columns the app's time-range slider writes.
 * The `reply` field is the confirmation (or help) text to send back to the
 * sender; unparseable messages get usage examples instead of silence.
 * This endpoint intentionally has no auth — it is secured by verifying the sender's phone.
 */
const WHATSAPP_MAX_DAYS = 14;

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

    const msgDate = timestamp
      ? new Date(timestamp).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0];

    // Parse the message for availability intent ("today"/"tmr" resolve
    // against the message timestamp, not the server's processing time).
    const parsed = parseWhatsAppMessage(message, msgDate);

    if (!parsed) {
      res.json({
        received: true,
        processed: false,
        reason: 'Could not parse availability from message',
        reply: WHATSAPP_HELP_MESSAGE,
      });
      return;
    }

    // A message with no date means "for the day I sent this".
    const allDates = parsed.dates && parsed.dates.length > 0 ? parsed.dates : [msgDate];
    const workDates = allDates.slice(0, WHATSAPP_MAX_DAYS);
    const truncated = allDates.length - workDates.length;

    const window =
      parsed.start_time && parsed.end_time
        ? { start: parsed.start_time, end: parsed.end_time }
        : null;
    const halfDay = window ? null : parsed.half_day ?? null;
    const reason = parsed.is_available ? null : String(message).slice(0, 500);

    const availabilityIds: number[] = [];
    let flagsRaised = 0;

    for (const workDate of workDates) {
      const { data: avail, error: availErr } = await supabaseAdmin
        .from('availability')
        .upsert(
          {
            staff_id: staff.staff_id,
            work_date: workDate,
            is_available: parsed.is_available,
            half_day: halfDay,
            // A parsed window ("1pm-7pm") writes the same columns as the
            // app's time-range slider; otherwise clear any stale window a
            // previous submission left on this day. The raw text doubles as
            // the unavailability reason for admins.
            start_time: window?.start ?? null,
            end_time: window?.end ?? null,
            reason,
            source: 'whatsapp',
            created_at: new Date().toISOString(),
          },
          { onConflict: 'staff_id,work_date' }
        )
        .select()
        .single();

      if (availErr) throw availErr;
      availabilityIds.push(avail.availability_id);

      // Chad (UC-003 A2): reduced availability via WhatsApp can strand an
      // already-crewed slot — flag each affected day immediately.
      flagsRaised += await detectCoverageGaps(
        staff.staff_id,
        staff.full_name,
        workDate,
        parsed.is_available,
        halfDay,
        window?.start ?? null,
        window?.end ?? null,
        reason,
        'WhatsApp availability'
      );
    }

    let reply = formatWhatsAppResponse(
      staff.full_name,
      workDates,
      parsed.is_available,
      halfDay,
      window
    );
    if (truncated > 0) {
      reply += ` (Note: only the first ${WHATSAPP_MAX_DAYS} days were recorded — please send the remaining ${truncated} day${truncated === 1 ? '' : 's'} separately.)`;
    }

    res.json({
      received: true,
      processed: true,
      availability_id: availabilityIds[0],
      availability_ids: availabilityIds,
      staff_id: staff.staff_id,
      work_date: workDates[0],
      work_dates: workDates,
      days_processed: workDates.length,
      is_available: parsed.is_available,
      start_time: window?.start ?? null,
      end_time: window?.end ?? null,
      flags_raised: flagsRaised,
      reply,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
