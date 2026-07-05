/**
 * UC-004 Filter Pipeline
 *
 * Filters staff eligibility for a given shift slot in strict order:
 *   1. Availability check      — hard block (leave / MC / unavailable)
 *   2. Rest hours check        — hard block (< 12 h since last shift end)
 *   3. Daily hours check       — hard block (> 12 h already scheduled that day)
 *   4. Consecutive days check  — SOFT FLAG only (>= 7 consecutive days)
 *   5. Certification match     — hard block based on service_type
 */

import supabaseAdmin from '../../lib/supabase';

export type StaffRole = 'driver' | 'medic' | 'emt' | 'paramedic';
export type ServiceType = 'MTS' | 'EAS' | 'both';
export type CrewPosition = 'driver' | 'attendant';

export interface ShiftSlot {
  slot_id: number;
  roster_id: number;
  ambulance_id: number;
  start_time: string; // "HH:MM:SS"
  end_time: string;
  service_type: 'MTS' | 'EAS';
  crew_position: CrewPosition;
}

export interface RosterRow {
  roster_date: string; // "YYYY-MM-DD"
}

export interface StaffCandidate {
  staff_id: number;
  full_name: string;
  role: StaffRole;
  employment_type: 'full_time' | 'part_time';
  status: 'active' | 'inactive';
}

export interface FilterResult {
  staff_id: number;
  full_name: string;
  role: StaffRole;
  eligible: boolean;
  hard_blocked: boolean;
  block_reason?: string;
  consecutive_days_flag: boolean;
  consecutive_days_count: number;
}

/**
 * Converts a time string "HH:MM" or "HH:MM:SS" to total minutes from midnight.
 */
export function timeToMinutes(t: string): number {
  const parts = t.split(':');
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

/**
 * A shift whose end_time is <= its start_time crosses midnight (e.g. 18:00–06:00).
 */
export function isOvernight(startTime: string, endTime: string): boolean {
  return timeToMinutes(endTime) <= timeToMinutes(startTime);
}

/**
 * Duration of a shift in minutes, handling shifts that cross midnight.
 */
export function shiftDurationMinutes(startTime: string, endTime: string): number {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  return end > start ? end - start : end + 1440 - start;
}

/**
 * Absolute end of a shift that starts on shiftDate — rolls to the next day
 * for overnight shifts.
 */
export function shiftEndDateTime(shiftDate: string, startTime: string, endTime: string): Date {
  const end = new Date(`${shiftDate}T${endTime}`);
  if (isOvernight(startTime, endTime)) {
    end.setDate(end.getDate() + 1);
  }
  return end;
}

/**
 * Computes overlap in minutes between two [start, end) ranges (all in minutes).
 */
function overlapMinutes(s1: number, e1: number, s2: number, e2: number): number {
  const start = Math.max(s1, s2);
  const end = Math.min(e1, e2);
  return Math.max(0, end - start);
}

/**
 * Checks whether a staff member is blocked by leave / marked unavailable.
 * Returns true if blocked.
 */
async function isBlockedByLeaveOrAvailability(
  staffId: number,
  workDate: string,
  slotStart: number,
  slotEnd: number
): Promise<boolean> {
  // Check approved leave that covers this date
  const { data: leaves } = await supabaseAdmin
    .from('leave_requests')
    .select('start_date, end_date, leave_type')
    .eq('staff_id', staffId)
    .eq('status', 'approved')
    .lte('start_date', workDate)
    .gte('end_date', workDate);

  if (leaves && leaves.length > 0) {
    for (const leave of leaves) {
      if (leave.leave_type === 'full_day') {
        return true;
      }
      // half_am blocks 00:00–12:00 (0–720 min)
      if (leave.leave_type === 'half_am') {
        if (overlapMinutes(slotStart, slotEnd, 0, 720) > 0) return true;
      }
      // half_pm blocks 12:00–24:00 (720–1440 min)
      if (leave.leave_type === 'half_pm') {
        if (overlapMinutes(slotStart, slotEnd, 720, 1440) > 0) return true;
      }
    }
  }

  // Check availability table — only respect explicit "not available" entries
  const { data: avail } = await supabaseAdmin
    .from('availability')
    .select('is_available, half_day')
    .eq('staff_id', staffId)
    .eq('work_date', workDate)
    .single();

  if (avail) {
    if (!avail.is_available) {
      return true;
    }
    // half_day availability restricts the other half
    if (avail.half_day === 'am') {
      // Only AM is available; if slot is in PM, block
      if (overlapMinutes(slotStart, slotEnd, 720, 1440) > 0) return true;
    }
    if (avail.half_day === 'pm') {
      // Only PM is available; if slot is in AM, block
      if (overlapMinutes(slotStart, slotEnd, 0, 720) > 0) return true;
    }
  }

  return false;
}

/**
 * Returns the end time of the last completed/assigned shift before workDate for the staff.
 * Returns null if no prior shift exists.
 */
async function getLastShiftEnd(
  staffId: number,
  workDate: string
): Promise<Date | null> {
  // Get all assignments for slots before or on the work date, ordered desc
  const { data } = await supabaseAdmin
    .from('assignments')
    .select('shift_slots!inner(roster_id, start_time, end_time, rosters!inner(roster_date))')
    .eq('staff_id', staffId)
    .neq('status', 'cancelled')
    .order('shift_slots(rosters(roster_date))', { ascending: false })
    .limit(20);

  if (!data || data.length === 0) return null;

  // Find the most recent shift strictly before workDate
  type AssignRow = {
    shift_slots: {
      roster_id: number;
      start_time: string;
      end_time: string;
      rosters: { roster_date: string };
    };
  };

  const rows = data as unknown as AssignRow[];
  let lastEnd: Date | null = null;

  for (const row of rows) {
    const slotDate = row.shift_slots.rosters?.roster_date;
    if (!slotDate) continue;
    if (slotDate >= workDate) continue;

    const endDt = shiftEndDateTime(slotDate, row.shift_slots.start_time, row.shift_slots.end_time);
    if (!lastEnd || endDt > lastEnd) {
      lastEnd = endDt;
    }
  }

  return lastEnd;
}

/**
 * Returns total scheduled minutes for a staff member on a given date (excluding the target slot).
 */
async function getDailyScheduledMinutes(
  staffId: number,
  workDate: string,
  excludeSlotId?: number
): Promise<number> {
  const { data } = await supabaseAdmin
    .from('assignments')
    .select('slot_id, shift_slots!inner(start_time, end_time, rosters!inner(roster_date))')
    .eq('staff_id', staffId)
    .neq('status', 'cancelled');

  if (!data) return 0;

  type AssignRow = {
    slot_id: number;
    shift_slots: {
      start_time: string;
      end_time: string;
      rosters: { roster_date: string };
    };
  };

  let total = 0;
  for (const row of data as unknown as AssignRow[]) {
    if (row.slot_id === excludeSlotId) continue;
    const slotDate = row.shift_slots.rosters?.roster_date;
    if (slotDate !== workDate) continue;
    total += shiftDurationMinutes(row.shift_slots.start_time, row.shift_slots.end_time);
  }

  return total;
}

/**
 * Returns count of consecutive working days ending on (but not including) workDate.
 */
async function getConsecutiveDays(staffId: number, workDate: string): Promise<number> {
  const { data } = await supabaseAdmin
    .from('assignments')
    .select('shift_slots!inner(rosters!inner(roster_date))')
    .eq('staff_id', staffId)
    .neq('status', 'cancelled');

  if (!data) return 0;

  type AssignRow = { shift_slots: { rosters: { roster_date: string } } };

  const workDates = new Set<string>();
  for (const row of data as unknown as AssignRow[]) {
    const d = row.shift_slots.rosters?.roster_date;
    if (d && d < workDate) workDates.add(d);
  }

  // Walk backwards from workDate - 1 day
  let count = 0;
  const current = new Date(workDate);
  current.setDate(current.getDate() - 1);

  while (true) {
    const dateStr = current.toISOString().split('T')[0];
    if (workDates.has(dateStr)) {
      count++;
      current.setDate(current.getDate() - 1);
    } else {
      break;
    }
  }

  return count;
}

/**
 * Determines if a staff role is eligible for the given service type.
 * Certification hierarchy:
 *   driver     → MTS and EAS
 *   medic      → MTS only
 *   emt        → MTS only
 *   paramedic  → MTS and EAS
 */
export function isCertEligible(role: StaffRole, serviceType: 'MTS' | 'EAS'): boolean {
  switch (role) {
    case 'driver':
      return true; // driver eligible for any service type
    case 'medic':
      return serviceType === 'MTS';
    case 'emt':
      return serviceType === 'MTS';
    case 'paramedic':
      return true; // paramedic eligible for MTS and EAS
    default:
      return false;
  }
}

/**
 * Main filter pipeline: given a slot and a list of candidates, returns filter results.
 */
export async function filterCandidates(
  slot: ShiftSlot,
  rosterDate: string,
  candidates: StaffCandidate[]
): Promise<FilterResult[]> {
  const slotStart = timeToMinutes(slot.start_time);
  const slotDuration = shiftDurationMinutes(slot.start_time, slot.end_time);
  // For overnight slots the end extends past 1440 so half-day overlap checks
  // against the roster date's AM/PM windows still work.
  const slotEnd = slotStart + slotDuration;

  const results: FilterResult[] = [];

  for (const candidate of candidates) {
    // Skip inactive staff immediately
    if (candidate.status !== 'active') {
      results.push({
        staff_id: candidate.staff_id,
        full_name: candidate.full_name,
        role: candidate.role,
        eligible: false,
        hard_blocked: true,
        block_reason: 'Staff member is inactive',
        consecutive_days_flag: false,
        consecutive_days_count: 0,
      });
      continue;
    }

    // --- Step 1: Availability / Leave check ---
    const blockedByLeave = await isBlockedByLeaveOrAvailability(
      candidate.staff_id,
      rosterDate,
      slotStart,
      slotEnd
    );
    if (blockedByLeave) {
      results.push({
        staff_id: candidate.staff_id,
        full_name: candidate.full_name,
        role: candidate.role,
        eligible: false,
        hard_blocked: true,
        block_reason: 'On approved leave or marked unavailable',
        consecutive_days_flag: false,
        consecutive_days_count: 0,
      });
      continue;
    }

    // --- Step 2: Rest hours check (min 12 h) ---
    const lastEnd = await getLastShiftEnd(candidate.staff_id, rosterDate);
    if (lastEnd) {
      const shiftStartDt = new Date(`${rosterDate}T${slot.start_time}`);
      const restHours = (shiftStartDt.getTime() - lastEnd.getTime()) / (1000 * 60 * 60);
      if (restHours < 12) {
        results.push({
          staff_id: candidate.staff_id,
          full_name: candidate.full_name,
          role: candidate.role,
          eligible: false,
          hard_blocked: true,
          block_reason: `Insufficient rest (${restHours.toFixed(1)}h < 12h required)`,
          consecutive_days_flag: false,
          consecutive_days_count: 0,
        });
        continue;
      }
    }

    // --- Step 3: Daily hours check (max 12 h) ---
    const dailyMinutes = await getDailyScheduledMinutes(
      candidate.staff_id,
      rosterDate,
      slot.slot_id
    );
    if (dailyMinutes + slotDuration > 720) {
      // 720 min = 12 h
      results.push({
        staff_id: candidate.staff_id,
        full_name: candidate.full_name,
        role: candidate.role,
        eligible: false,
        hard_blocked: true,
        block_reason: `Would exceed 12h daily limit (${((dailyMinutes + slotDuration) / 60).toFixed(1)}h)`,
        consecutive_days_flag: false,
        consecutive_days_count: 0,
      });
      continue;
    }

    // --- Step 4: Consecutive days (SOFT flag, NOT a hard block) ---
    const consecutiveDays = await getConsecutiveDays(candidate.staff_id, rosterDate);
    const consecutiveFlag = consecutiveDays >= 6; // 6 prior + today = 7+ consecutive

    // --- Step 5: Certification / role match ---
    if (!isCertEligible(candidate.role, slot.service_type)) {
      results.push({
        staff_id: candidate.staff_id,
        full_name: candidate.full_name,
        role: candidate.role,
        eligible: false,
        hard_blocked: true,
        block_reason: `Role '${candidate.role}' not eligible for service type '${slot.service_type}'`,
        consecutive_days_flag: consecutiveFlag,
        consecutive_days_count: consecutiveDays,
      });
      continue;
    }

    // Passed all filters
    results.push({
      staff_id: candidate.staff_id,
      full_name: candidate.full_name,
      role: candidate.role,
      eligible: true,
      hard_blocked: false,
      consecutive_days_flag: consecutiveFlag,
      consecutive_days_count: consecutiveDays,
    });
  }

  return results;
}

/**
 * Fetches all active staff and runs the filter pipeline for a slot.
 */
export async function getEligibleCandidates(
  slot: ShiftSlot,
  rosterDate: string
): Promise<FilterResult[]> {
  const { data: staffList, error } = await supabaseAdmin
    .from('staff')
    .select('staff_id, full_name, role, employment_type, status')
    .eq('status', 'active');

  if (error) throw new Error(`Failed to fetch staff: ${error.message}`);

  return filterCandidates(slot, rosterDate, (staffList ?? []) as StaffCandidate[]);
}
