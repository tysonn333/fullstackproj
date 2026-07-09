import { Router, Response, NextFunction } from 'express';
import supabaseAdmin from '../lib/supabase';
import { authenticate, requireAdmin, ensureSelfOrAdmin, AuthenticatedRequest } from '../middleware/auth';
import { createLeaveRequest, approveLeave, rejectLeave } from '../services/leave.service';

const router = Router();
router.use(authenticate);

/**
 * GET /api/v1/leave
 * Query: status, staff_id, from, to
 */
router.get('/', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    let query = supabaseAdmin
      .from('leave_requests')
      .select('*, staff(full_name, role)')
      .order('created_at', { ascending: false });

    if (req.query.status) query = query.eq('status', req.query.status as string);
    if (req.query.staff_id) query = query.eq('staff_id', parseInt(req.query.staff_id as string, 10));
    if (req.query.from) query = query.gte('start_date', req.query.from as string);
    if (req.query.to) query = query.lte('end_date', req.query.to as string);

    const { data, error } = await query;
    if (error) throw error;

    res.json({ data });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/leave
 * Body: { staff_id, start_date, end_date, leave_type, reason }
 */
router.post('/', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { start_date, end_date, leave_type, reason } = req.body;
    const staff_id = Number(req.body.staff_id);

    if (!staff_id || !start_date || !end_date || !leave_type) {
      res.status(400).json({ error: 'staff_id, start_date, end_date, and leave_type are required' });
      return;
    }

    // Employees may only file leave for themselves; admins for anyone.
    if (!ensureSelfOrAdmin(req, res, staff_id)) return;

    const validLeaveTypes = ['full_day', 'half_am', 'half_pm'];
    if (!validLeaveTypes.includes(leave_type)) {
      res.status(400).json({ error: `leave_type must be one of: ${validLeaveTypes.join(', ')}` });
      return;
    }

    const leave = await createLeaveRequest({ staff_id, start_date, end_date, leave_type, reason });
    res.status(201).json({ data: leave });
  } catch (err: unknown) {
    if (err instanceof Error && (err.message.includes('not found') || err.message.includes('Conflicting'))) {
      res.status(409).json({ error: err.message });
      return;
    }
    next(err);
  }
});

/**
 * PUT /api/v1/leave/:id/approve  (admin only)
 * Body: { notes? }
 */
router.put('/:id/approve', requireAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const leaveId = parseInt(req.params.id, 10);
    const { notes } = req.body;
    const { leave, conflicts } = await approveLeave(leaveId, req.user!.id, notes);

    res.json({
      data: leave,
      conflicts_count: conflicts.length,
      conflicting_assignment_ids: conflicts,
      message:
        conflicts.length > 0
          ? `Leave approved. Warning: ${conflicts.length} existing assignment(s) conflict with this leave.`
          : 'Leave approved successfully.',
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('not found')) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof Error && err.message.includes('already')) {
      res.status(409).json({ error: err.message });
      return;
    }
    next(err);
  }
});

/**
 * PUT /api/v1/leave/:id/reject  (admin only)
 * Body: { reason? }
 */
router.put('/:id/reject', requireAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const leaveId = parseInt(req.params.id, 10);
    const { reason } = req.body;

    const leave = await rejectLeave(leaveId, req.user!.id, reason);
    res.json({ data: leave });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('not found')) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof Error && err.message.includes('already')) {
      res.status(409).json({ error: err.message });
      return;
    }
    next(err);
  }
});

export default router;
