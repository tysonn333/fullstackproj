/**
 * Coverage-gap detection (UC-003 — Jadon / Chad)
 *
 * When a staff member becomes (partially) unavailable AFTER being assigned —
 * half-day leave approved, part-timer sends half-day availability over
 * WhatsApp, or an availability record is edited — the affected shift slots
 * must surface in the exceptions panel (UC-008) so the admin can source cover.
 *
 * Shared by:
 *   • leave.service.approveLeave      (half-day leave → half_day_gap flags,
 *                                      published-roster conflicts → coverage_gap)
 *   • availability routes (app form)  (half-day availability → half_day_gap)
 *   • WhatsApp webhook (part-timers)  (half-day availability → half_day_gap)
 */

import supabaseAdmin from '../lib/supabase';
import { timeToMinutes, shiftDurationMinutes } from './scheduling/filter';

interface AffectedAssignment {
  assignment_id: number;
  slot_id: number;
  roster_id: number;
  roster_status: string;
  start_time: string;
  end_time: string;
  service_type: string;
  crew_position: string;
}

/**
 * All non-cancelled assignments a staff member holds on a given date, with the
 * slot timing needed for half-day overlap checks.
 */
export async function getAssignmentsOnDate(
  staffId: number,
  workDate: string
): Promise<AffectedAssignment[]> {
  const { data } = await supabaseAdmin
    .from('assignments')
    .select(
      `assignment_id, slot_id,
       shift_slots!inner(slot_id, roster_id, start_time, end_time, service_type, crew_position,
         rosters!inner(roster_date, status))`
    )
    .eq('staff_id', staffId)
    .neq('status', 'cancelled');

  type Row = {
    assignment_id: number;
    slot_id: number;
    shift_slots: {
      roster_id: number;
      start_time: string;
      end_time: string;
      service_type: string;
      crew_position: string;
      rosters: { roster_date: string; status: string };
    };
  };

  return ((data ?? []) as unknown as Row[])
    .filter((r) => r.shift_slots.rosters?.roster_date === workDate)
    .map((r) => ({
      assignment_id: r.assignment_id,
      slot_id: r.slot_id,
      roster_id: r.shift_slots.roster_id,
      roster_status: r.shift_slots.rosters.status,
      start_time: r.shift_slots.start_time,
      end_time: r.shift_slots.end_time,
      service_type: r.shift_slots.service_type,
      crew_position: r.shift_slots.crew_position,
    }));
}

/** True when the slot's hours overlap the blocked half of the day. */
function overlapsHalf(startTime: string, endTime: string, blockedHalf: 'am' | 'pm'): boolean {
  const start = timeToMinutes(startTime);
  const end = start + shiftDurationMinutes(startTime, endTime); // extends past 1440 overnight
  const [blockStart, blockEnd] = blockedHalf === 'am' ? [0, 720] : [720, 1440];
  return Math.max(start, blockStart) < Math.min(end, blockEnd);
}

/** Skip inserting a duplicate flag of the same type on the same slot+staff. */
async function flagAlreadyActive(
  slotId: number,
  staffId: number,
  flagType: string
): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('flags')
    .select('flag_id')
    .eq('slot_id', slotId)
    .eq('staff_id', staffId)
    .eq('flag_type', flagType)
    .eq('status', 'active')
    .limit(1);
  return Boolean(data && data.length > 0);
}

/**
 * Raises half_day_gap flags for every assignment the staff member holds on
 * workDate whose slot overlaps the half of the day they are now blocked from
 * (UC-003 step 8 + Chad's half-day coverage-gap detection).
 *
 * `blockedHalf` is the half the staff CANNOT work. Returns the number of flags
 * raised.
 */
export async function raiseHalfDayGapFlags(
  staffId: number,
  staffName: string,
  workDate: string,
  blockedHalf: 'am' | 'pm',
  source: string
): Promise<number> {
  const assignments = await getAssignmentsOnDate(staffId, workDate);
  let raised = 0;

  for (const a of assignments) {
    if (!overlapsHalf(a.start_time, a.end_time, blockedHalf)) continue;
    if (await flagAlreadyActive(a.slot_id, staffId, 'half_day_gap')) continue;

    await supabaseAdmin.from('flags').insert({
      roster_id: a.roster_id,
      slot_id: a.slot_id,
      staff_id: staffId,
      flag_type: 'half_day_gap',
      severity: 'warning',
      message:
        `${staffName} is unavailable for the ${blockedHalf.toUpperCase()} half of ${workDate} (${source}) ` +
        `but is assigned to the ${a.service_type} ${a.crew_position} slot ${a.start_time}–${a.end_time}. ` +
        `A part-timer replacement is needed for the uncovered half.`,
      status: 'active',
      created_at: new Date().toISOString(),
    });
    raised++;
  }

  return raised;
}

/**
 * Raises coverage_gap flags for every assignment the staff member holds in a
 * date range they are now fully unavailable for (UC-003 E1 — leave approved
 * after the roster was published). Published/locked rosters get a critical
 * flag; drafts a warning (a regenerate will fix those).
 *
 * Returns the number of flags raised.
 */
export async function raiseFullDayConflictFlags(
  staffId: number,
  staffName: string,
  dates: string[],
  reason: string
): Promise<number> {
  let raised = 0;

  for (const workDate of dates) {
    const assignments = await getAssignmentsOnDate(staffId, workDate);
    for (const a of assignments) {
      if (await flagAlreadyActive(a.slot_id, staffId, 'coverage_gap')) continue;

      const published = ['published', 'locked'].includes(a.roster_status);
      await supabaseAdmin.from('flags').insert({
        roster_id: a.roster_id,
        slot_id: a.slot_id,
        staff_id: staffId,
        flag_type: 'coverage_gap',
        severity: published ? 'critical' : 'warning',
        message:
          `${staffName} is on ${reason} for ${workDate} but is assigned to the ` +
          `${a.service_type} ${a.crew_position} slot ${a.start_time}–${a.end_time}` +
          (published ? ' on a PUBLISHED roster — arrange a replacement (UC-006).' : '.'),
        status: 'active',
        created_at: new Date().toISOString(),
      });
      raised++;
    }
  }

  return raised;
}

/** Enumerates the dates of an inclusive YYYY-MM-DD range. */
export function datesBetween(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const current = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  while (current <= end) {
    const y = current.getFullYear();
    const m = String(current.getMonth() + 1).padStart(2, '0');
    const d = String(current.getDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${d}`);
    current.setDate(current.getDate() + 1);
  }
  return dates;
}
