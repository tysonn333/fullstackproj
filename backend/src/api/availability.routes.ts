import { Router, Response, NextFunction } from 'express';
import supabaseAdmin from '../lib/supabase';
import { authenticate, ensureSelfOrAdmin, AuthenticatedRequest } from '../middleware/auth';
import { logAudit } from '../services/audit.service';
import { parseWhatsAppMessage } from '../integrations/whatsapp';
import {
  raiseHalfDayGapFlags,
  raiseFullDayConflictFlags,
} from '../services/coverage.service';

const router = Router();

/**
 * Coverage-gap detection for a changed availability record (UC-003 / Chad).
 * half_day='am' means only the AM half is available → the PM half is blocked.
 * Returns the number of flags raised.
 */
async function detectCoverageGaps(
  staffId: number,
  staffName: string,
  workDate: string,
  isAvailable: boolean,
  halfDay: 'am' | 'pm' | null,
  source: string
): Promise<number> {
  if (!isAvailable) {
    return raiseFullDayConflictFlags(staffId, staffName, [workDate], `unavailability (${source})`);
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
 * Body: { work_date, is_available, half_day? }
 */
router.post(
  '/staff/:id/availability',
  authenticate,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const staffId = parseInt(req.params.id, 10);
      const { work_date, is_available, half_day } = req.body;

      if (!work_date || is_available === undefined) {
        res.status(400).json({ error: 'work_date and is_available are required' });
        return;
      }

      // Employees may only set their own availability; admins may set anyone's.
      if (!ensureSelfOrAdmin(req, res, staffId)) return;

      // Upsert — one availability record per staff per day
      const { data, error } = await supabaseAdmin
        .from('availability')
        .upsert(
          {
            staff_id: staffId,
            work_date,
            is_available: Boolean(is_available),
            half_day: half_day ?? null,
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
        details: { staff_id: staffId, work_date, is_available, half_day },
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
        half_day ?? null,
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
