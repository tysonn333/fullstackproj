import supabaseAdmin from '../lib/supabase';
import { logAudit } from './audit.service';
import { sendNotification } from './notification.service';
import { timeToMinutes, shiftDurationMinutes } from './scheduling/filter';

// How many days of advance notice a leave request needs before it overrides a
// planned/generated schedule automatically at submission time. Requests inside
// this window are left for admin approval and handled as a last-minute change.
const IMMEDIATE_OVERRIDE_LEAD_DAYS = 2;

type LeaveType = 'full_day' | 'half_am' | 'half_pm';

/**
 * Overlap in minutes between two [start, end) ranges (minutes from midnight).
 */
function overlapMinutes(s1: number, e1: number, s2: number, e2: number): number {
  return Math.max(0, Math.min(e1, e2) - Math.max(s1, s2));
}

/**
 * Whether a shift running [start_time, end_time) collides with the half of the
 * day blocked by a half-day leave. Full-day leave always collides.
 */
function shiftCollidesWithLeave(startTime: string, endTime: string, leaveType: LeaveType): boolean {
  if (leaveType === 'full_day') return true;
  const slotStart = timeToMinutes(startTime);
  const slotEnd = slotStart + shiftDurationMinutes(startTime, endTime);
  // half_am blocks 00:00–12:00, half_pm blocks 12:00–24:00
  const [winStart, winEnd] = leaveType === 'half_am' ? [0, 720] : [720, 1440];
  return overlapMinutes(slotStart, slotEnd, winStart, winEnd) > 0;
}

/**
 * Whole days from today (local midnight) until the given YYYY-MM-DD date.
 */
function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${dateStr}T00:00:00`);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

interface ConflictRow {
  assignment_id: number;
  slot_id: number;
  status: string;
  shift_slots: {
    slot_id: number;
    roster_id: number;
    start_time: string;
    end_time: string;
    rosters: { roster_date: string; status: string };
  };
}

/**
 * Drops the staff member's already-planned assignments that clash with a leave
 * period and raises a coverage_gap flag on each vacated slot so the gap shows up
 * in the Exceptions panel / Last-Minute Change flow.
 *
 * This only ever *overrides* an existing (planned/generated) schedule — it never
 * creates assignments. `minLeadDays`, when set, restricts the override to shifts
 * that are at least that many days away (used at submission time so short-notice
 * requests are deferred to admin approval).
 */
async function overridePlannedAssignments(
  leave: { staff_id: number; start_date: string; end_date: string; leave_type: LeaveType },
  actorId: string,
  opts: { minLeadDays?: number } = {}
): Promise<number[]> {
  const { data } = await supabaseAdmin
    .from('assignments')
    .select(
      'assignment_id, slot_id, status, shift_slots!inner(slot_id, roster_id, start_time, end_time, rosters!inner(roster_date, status))'
    )
    .eq('staff_id', leave.staff_id)
    .neq('status', 'cancelled');

  if (!data) return [];

  const droppedIds: number[] = [];

  for (const row of data as unknown as ConflictRow[]) {
    const slot = row.shift_slots;
    const rosterDate = slot.rosters?.roster_date;
    if (!rosterDate) continue;

    // Must fall inside the leave window and collide with the blocked half.
    if (rosterDate < leave.start_date || rosterDate > leave.end_date) continue;
    if (!shiftCollidesWithLeave(slot.start_time, slot.end_time, leave.leave_type)) continue;
    // Never touch a locked roster.
    if (slot.rosters.status === 'locked') continue;
    // At submission time, only override shifts with enough lead time.
    if (opts.minLeadDays != null && daysUntil(rosterDate) < opts.minLeadDays) continue;

    // Drop the assignment.
    const { error: dropErr } = await supabaseAdmin
      .from('assignments')
      .update({ status: 'cancelled' })
      .eq('assignment_id', row.assignment_id);
    if (dropErr) continue;

    droppedIds.push(row.assignment_id);

    // Raise a coverage_gap flag on the vacated slot (skip if one is already active).
    const { data: existingFlag } = await supabaseAdmin
      .from('flags')
      .select('flag_id')
      .eq('slot_id', row.slot_id)
      .eq('flag_type', 'coverage_gap')
      .eq('status', 'active')
      .maybeSingle();

    if (!existingFlag) {
      await supabaseAdmin.from('flags').insert({
        roster_id: slot.roster_id,
        slot_id: row.slot_id,
        staff_id: null,
        flag_type: 'coverage_gap',
        severity: 'critical',
        message: `Coverage gap: staff ${leave.staff_id} on ${leave.leave_type.replace('_', ' ')} leave for ${rosterDate}; slot ${row.slot_id} needs re-filling`,
        status: 'active',
        created_at: new Date().toISOString(),
      });
    }

    await logAudit({
      entity_type: 'assignments',
      entity_id: row.assignment_id,
      action: 'update',
      actor_id: actorId,
      details: {
        reason: 'leave_override',
        slot_id: row.slot_id,
        staff_id: leave.staff_id,
        roster_date: rosterDate,
        leave_type: leave.leave_type,
      },
    });
  }

  return droppedIds;
}

export interface LeaveRequest {
  leave_id: number;
  staff_id: number;
  start_date: string;
  end_date: string;
  leave_type: 'full_day' | 'half_am' | 'half_pm';
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  approved_by?: string;
  approved_at?: string;
  created_at: string;
}

export interface CreateLeaveInput {
  staff_id: number;
  start_date: string;
  end_date: string;
  leave_type: 'full_day' | 'half_am' | 'half_pm';
  reason?: string;
  // User triggering the request; used to attribute the audit log of any
  // schedule overrides. Defaults to the staff member themselves.
  actor_id?: string;
}

/**
 * Creates a new leave request. Validates date range and checks for conflicts.
 *
 * When the request is filed with at least IMMEDIATE_OVERRIDE_LEAD_DAYS of
 * notice, it immediately overrides the already-planned schedule for the
 * affected days (drops the clashing shifts and flags the coverage gaps).
 * Shorter-notice requests leave the roster untouched until an admin approves
 * them, at which point they are handled as a last-minute change.
 */
export async function createLeaveRequest(
  input: CreateLeaveInput
): Promise<LeaveRequest> {
  const { staff_id, start_date, end_date, leave_type, reason } = input;

  // Validate dates
  if (new Date(start_date) > new Date(end_date)) {
    throw new Error('start_date must be on or before end_date');
  }

  // Check if staff exists
  const { data: staff, error: staffErr } = await supabaseAdmin
    .from('staff')
    .select('staff_id, status')
    .eq('staff_id', staff_id)
    .single();

  if (staffErr || !staff) {
    throw new Error(`Staff member ${staff_id} not found`);
  }

  if (staff.status !== 'active') {
    throw new Error(`Staff member ${staff_id} is not active`);
  }

  // Check for conflicting pending/approved leave
  const { data: conflicts } = await supabaseAdmin
    .from('leave_requests')
    .select('leave_id, start_date, end_date')
    .eq('staff_id', staff_id)
    .in('status', ['pending', 'approved'])
    .lte('start_date', end_date)
    .gte('end_date', start_date);

  if (conflicts && conflicts.length > 0) {
    throw new Error(
      `Conflicting leave request exists (leave_id: ${conflicts[0].leave_id}) for the requested dates`
    );
  }

  const { data: newLeave, error } = await supabaseAdmin
    .from('leave_requests')
    .insert({
      staff_id,
      start_date,
      end_date,
      leave_type,
      reason: reason ?? '',
      status: 'pending',
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error || !newLeave) {
    throw new Error(`Failed to create leave request: ${error?.message}`);
  }

  // Advance-notice requests immediately override the planned schedule; requests
  // inside the lead-time window are deferred to admin approval / last-minute
  // handling (minLeadDays keeps only shifts that are far enough out).
  await overridePlannedAssignments(
    {
      staff_id,
      start_date,
      end_date,
      leave_type,
    },
    input.actor_id ?? String(staff_id),
    { minLeadDays: IMMEDIATE_OVERRIDE_LEAD_DAYS }
  );

  return newLeave as LeaveRequest;
}

/**
 * Approves a leave request and checks for assignment conflicts.
 */
export async function approveLeave(
  leaveId: number,
  approvedBy: string,
  notes?: string
): Promise<{ leave: LeaveRequest; conflicts: number[] }> {
  const { data: leave, error: fetchErr } = await supabaseAdmin
    .from('leave_requests')
    .select('*')
    .eq('leave_id', leaveId)
    .single();

  if (fetchErr || !leave) {
    throw new Error(`Leave request ${leaveId} not found`);
  }

  if (leave.status !== 'pending') {
    throw new Error(`Leave request is already '${leave.status}'`);
  }

  // Override the planned/generated schedule for the whole leave period: drop
  // any still-clashing assignments (short-notice ones deferred at submission
  // time, plus anything assigned since) and flag each vacated slot as a
  // coverage gap for the Last-Minute Change flow.
  const conflictAssignmentIds = await overridePlannedAssignments(
    {
      staff_id: leave.staff_id,
      start_date: leave.start_date,
      end_date: leave.end_date,
      leave_type: leave.leave_type as LeaveType,
    },
    approvedBy
  );

  // Approve the leave
  const now = new Date().toISOString();
  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('leave_requests')
    .update({ status: 'approved', approved_by: approvedBy, approved_at: now })
    .eq('leave_id', leaveId)
    .select()
    .single();

  if (updateErr || !updated) {
    throw new Error(`Failed to approve leave: ${updateErr?.message}`);
  }

  await logAudit({
    entity_type: 'leave_requests',
    entity_id: leaveId,
    action: 'approve',
    actor_id: approvedBy,
    details: {
      leave_id: leaveId,
      staff_id: leave.staff_id,
      conflict_assignments: conflictAssignmentIds,
      notes: notes ?? '',
    },
  });

  await sendNotification({
    staffId: leave.staff_id,
    type: 'leave_approved',
    message: `Your leave request from ${leave.start_date} to ${leave.end_date} has been approved.${notes ? ` Notes: ${notes}` : ''}`,
    data: { leave_id: leaveId },
  });

  return { leave: updated as LeaveRequest, conflicts: conflictAssignmentIds };
}

/**
 * Rejects a leave request with a reason.
 */
export async function rejectLeave(
  leaveId: number,
  rejectedBy: string,
  reason?: string
): Promise<LeaveRequest> {
  const { data: leave, error: fetchErr } = await supabaseAdmin
    .from('leave_requests')
    .select('*')
    .eq('leave_id', leaveId)
    .single();

  if (fetchErr || !leave) {
    throw new Error(`Leave request ${leaveId} not found`);
  }

  if (leave.status !== 'pending') {
    throw new Error(`Leave request is already '${leave.status}'`);
  }

  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('leave_requests')
    .update({ status: 'rejected' })
    .eq('leave_id', leaveId)
    .select()
    .single();

  if (updateErr || !updated) {
    throw new Error(`Failed to reject leave: ${updateErr?.message}`);
  }

  await logAudit({
    entity_type: 'leave_requests',
    entity_id: leaveId,
    action: 'reject',
    actor_id: rejectedBy,
    details: { leave_id: leaveId, reason: reason ?? '' },
  });

  await sendNotification({
    staffId: leave.staff_id,
    type: 'leave_rejected',
    message: `Your leave request from ${leave.start_date} to ${leave.end_date} has been rejected.${reason ? ` Reason: ${reason}` : ''}`,
    data: { leave_id: leaveId, reason },
  });

  return updated as LeaveRequest;
}
