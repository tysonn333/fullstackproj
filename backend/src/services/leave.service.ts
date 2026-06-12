import supabaseAdmin from '../lib/supabase';
import { logAudit } from './audit.service';
import { sendNotification } from './notification.service';

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
}

/**
 * Creates a new leave request. Validates date range and checks for conflicts.
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

  return newLeave as LeaveRequest;
}

/**
 * Approves a leave request and checks for assignment conflicts.
 */
export async function approveLeave(
  leaveId: number,
  approvedBy: string
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

  // Find any assignments in the leave period that would conflict
  const { data: assignmentsInPeriod } = await supabaseAdmin
    .from('assignments')
    .select('assignment_id, slot_id, shift_slots!inner(rosters!inner(roster_date))')
    .eq('staff_id', leave.staff_id)
    .neq('status', 'cancelled');

  type ARow = {
    assignment_id: number;
    slot_id: number;
    shift_slots: { rosters: { roster_date: string } };
  };

  const conflictAssignmentIds: number[] = [];

  if (assignmentsInPeriod) {
    for (const row of assignmentsInPeriod as unknown as ARow[]) {
      const d = row.shift_slots.rosters?.roster_date;
      if (d && d >= leave.start_date && d <= leave.end_date) {
        conflictAssignmentIds.push(row.assignment_id);
      }
    }
  }

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
    details: { leave_id: leaveId, staff_id: leave.staff_id, conflict_assignments: conflictAssignmentIds },
  });

  await sendNotification({
    staffId: leave.staff_id,
    type: 'leave_approved',
    message: `Your leave request from ${leave.start_date} to ${leave.end_date} has been approved.`,
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
