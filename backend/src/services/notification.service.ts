import supabaseAdmin from '../lib/supabase';

export interface NotificationPayload {
  staffId: number;
  type: 'assignment' | 'leave_approved' | 'leave_rejected' | 'roster_published' | 'swap_request';
  message: string;
  data?: Record<string, unknown>;
}

/**
 * Sends a notification to a staff member.
 * In production this would integrate with SMS/push/email providers.
 * Currently logs to console and stores in a notifications table if present.
 */
export async function sendNotification(payload: NotificationPayload): Promise<void> {
  console.log(`[NOTIFICATION] Staff ${payload.staffId} | Type: ${payload.type} | ${payload.message}`);

  // Attempt to persist in DB; table may not exist in all environments
  try {
    await supabaseAdmin.from('notifications').insert({
      staff_id: payload.staffId,
      type: payload.type,
      message: payload.message,
      data: payload.data ?? {},
      sent_at: new Date().toISOString(),
    });
  } catch {
    // Notifications table is optional; silently skip
  }
}

/**
 * Sends roster publication notifications to all assigned staff on that date.
 */
export async function notifyRosterPublished(rosterId: number, rosterDate: string): Promise<void> {
  const { data: assignments } = await supabaseAdmin
    .from('assignments')
    .select('staff_id, shift_slots!inner(roster_id)')
    .eq('shift_slots.roster_id', rosterId)
    .neq('status', 'cancelled');

  if (!assignments) return;

  const staffIds = [...new Set(assignments.map((a) => a.staff_id as number))];

  await Promise.allSettled(
    staffIds.map((id) =>
      sendNotification({
        staffId: id,
        type: 'roster_published',
        message: `The roster for ${rosterDate} has been published. Please check your assignments.`,
        data: { roster_id: rosterId, roster_date: rosterDate },
      })
    )
  );
}

/**
 * Sends a notification when a staff member is assigned to a slot.
 */
export async function notifyAssignment(
  staffId: number,
  slotId: number,
  shiftDate: string,
  startTime: string,
  endTime: string
): Promise<void> {
  await sendNotification({
    staffId,
    type: 'assignment',
    message: `You have been assigned to a shift on ${shiftDate} from ${startTime} to ${endTime}.`,
    data: { slot_id: slotId, shift_date: shiftDate, start_time: startTime, end_time: endTime },
  });
}
