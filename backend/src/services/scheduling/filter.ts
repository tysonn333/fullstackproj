/**
 * UC-004 Filter Pipeline (Guan Hee)
 *
 * Filters staff eligibility for a given shift slot in strict order:
 *   0. Part-time shift-length   — hard block: a part-timer cannot work a single
 *                                 shift longer than 6 h (pure field check, run
 *                                 first so it costs no DB queries)
 *   1. Availability check      — hard block (leave / MC / unavailable)
 *   2. Rest hours check        — hard block (< 12 h since last shift end)
 *      └ post-late-shift rest  — SOFT FLAG: after a late shift (start ≥ 18:00)
 *        the next shift should not start before 12:00 (scheduling rules ref)
 *   3. Daily hours check       — hard block: per employment type — a part-timer
 *                                 caps at 6 h/day, a full-timer at 12 h/day
 *   4. Consecutive days check  — SOFT FLAG only (>= 7 consecutive days)
 *   5. Certification match     — hard block: role hierarchy AND a valid,
 *                                unexpired certification for the service type
 *
 * Every candidate carries a `filter_trace` recording the outcome of each step
 * it reached, so the reason a candidate was kept or dropped is fully
 * transparent to the caller (roster generator, reassignment UI, tests).
 */

import supabaseAdmin from '../../lib/supabase';

export type StaffRole = 'driver' | 'medic' | 'emt' | 'paramedic';
export type ServiceType = 'MTS' | 'EAS' | 'both';
export type CrewPosition = 'driver' | 'attendant';

export type FilterName =
  | 'part_time_hours'
  | 'availability'
  | 'rest_hours'
  | 'late_shift_rest'
  | 'daily_hours'
  | 'consecutive_days'
  | 'certification';

/**
 * Maximum minutes a staff member may be scheduled in a single day, by
 * employment type. A part-timer is capped at one 6-hour block; a full-timer at
 * two (12 hours) — matching the operational rule "try not to let staff work
 * more than 12 hours" while keeping part-timers to short shifts.
 */
export const PART_TIME_MAX_DAILY_MINUTES = 360; // 6 h
export const FULL_TIME_MAX_DAILY_MINUTES = 720; // 12 h

export interface FilterStep {
  filter: FilterName;
  passed: boolean;
  /** Soft filters (consecutive_days) can flag without failing. */
  soft?: boolean;
  detail: string;
}

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
  home_postal?: string | null;
  /** Management staff (UC-004 A2): overflow only — never auto-assigned. */
  is_management?: boolean;
}

export interface FilterResult {
  staff_id: number;
  full_name: string;
  role: StaffRole;
  employment_type: 'full_time' | 'part_time';
  home_postal: string | null;
  /** Management staff (UC-004 A2): eligible for MANUAL assignment only. */
  is_management?: boolean;
  eligible: boolean;
  hard_blocked: boolean;
  block_reason?: string;
  consecutive_days_flag: boolean;
  consecutive_days_count: number;
  /** Soft flag: shift starts before 12:00 on the day after a late shift
   *  (scheduling rules ref: "minimum rest period after late shift"). */
  late_shift_rest_flag?: boolean;
  filter_trace: FilterStep[];
}

interface CertRow {
  cert_name: string;
  expiry_date: string | null;
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
export function overlapMinutes(s1: number, e1: number, s2: number, e2: number): number {
  const start = Math.max(s1, s2);
  const end = Math.min(e1, e2);
  return Math.max(0, end - start);
}

/**
 * End of an availability window in minutes. The UI's scale tops out at 23:59,
 * which staff use to mean "until the end of the day" — treat it as 24:00 so a
 * shift ending exactly at midnight isn't blocked by the missing minute.
 */
export function availabilityEndMinutes(t: string): number {
  const m = timeToMinutes(t);
  return m >= 1439 ? 1440 : m;
}

/**
 * Checks whether a staff member is blocked by leave / marked unavailable.
 * Returns a human-readable block reason (shown to admins deciding who can
 * still be called for unfilled slots), or null when not blocked.
 */
async function isBlockedByLeaveOrAvailability(
  staffId: number,
  workDate: string,
  slotStart: number,
  slotEnd: number
): Promise<string | null> {
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
        return 'On approved leave (full day)';
      }
      // half_am blocks 00:00–12:00 (0–720 min)
      if (leave.leave_type === 'half_am') {
        if (overlapMinutes(slotStart, slotEnd, 0, 720) > 0) return 'On approved leave (AM half)';
      }
      // half_pm blocks 12:00–24:00 (720–1440 min)
      if (leave.leave_type === 'half_pm') {
        if (overlapMinutes(slotStart, slotEnd, 720, 1440) > 0) return 'On approved leave (PM half)';
      }
    }
  }

  // Check availability table — only respect explicit "not available" entries
  const { data: avail } = await supabaseAdmin
    .from('availability')
    .select('is_available, half_day, start_time, end_time, reason')
    .eq('staff_id', staffId)
    .eq('work_date', workDate)
    .single();

  if (avail) {
    if (!avail.is_available) {
      // Surface the staff member's stated reason so an admin can judge
      // whether they're still worth calling for an unfilled slot.
      return avail.reason
        ? `Marked unavailable — "${avail.reason}"`
        : 'Marked unavailable';
    }
    if (avail.start_time && avail.end_time) {
      // Time-window availability: block if any part of the slot's same-day
      // hours falls outside [start_time, end_time). Overnight minutes past
      // 24:00 belong to the next day and are not checked here — consistent
      // with how half-day rules treat overnight shifts.
      const availStart = timeToMinutes(avail.start_time);
      const availEnd = availabilityEndMinutes(avail.end_time);
      const sameDayEnd = Math.min(slotEnd, 1440);
      const window = `${avail.start_time.slice(0, 5)}–${avail.end_time.slice(0, 5)}`;
      if (
        overlapMinutes(slotStart, sameDayEnd, 0, availStart) > 0 ||
        overlapMinutes(slotStart, sameDayEnd, availEnd, 1440) > 0
      ) {
        return `Only available ${window} — slot falls outside those hours`;
      }
    } else if (avail.half_day === 'am') {
      // Legacy rows (e.g. WhatsApp): only AM is available; if slot is in PM, block
      if (overlapMinutes(slotStart, slotEnd, 720, 1440) > 0) return 'Only available for the AM half';
    } else if (avail.half_day === 'pm') {
      // Only PM is available; if slot is in AM, block
      if (overlapMinutes(slotStart, slotEnd, 0, 720) > 0) return 'Only available for the PM half';
    }
  }

  return null;
}

/** Shifts starting at or after 18:00 count as late shifts (shared with UC-005). */
export const LATE_SHIFT_START_MINUTES = 18 * 60;

/** After a late shift, the next shift should not start before 12:00 (soft rule). */
export const POST_LATE_SHIFT_EARLIEST_START = 12 * 60;

/** One staff member's assignment history row, as fetched once per candidate. */
export interface AssignmentHistoryRow {
  slot_id?: number;
  shift_slots: {
    start_time: string;
    end_time: string;
    rosters: { roster_date: string };
  };
}

/**
 * Fetches a staff member's non-cancelled assignment history in ONE query.
 * The rest-hours, daily-cap, consecutive-days and post-late-shift checks all
 * derive from this same data, so fetching it once (instead of once per check)
 * cuts the pipeline's DB round trips per candidate from 3 to 1.
 */
async function fetchAssignmentHistory(staffId: number): Promise<AssignmentHistoryRow[]> {
  const { data } = await supabaseAdmin
    .from('assignments')
    .select('slot_id, shift_slots!inner(start_time, end_time, rosters!inner(roster_date))')
    .eq('staff_id', staffId)
    .neq('status', 'cancelled');

  return (data ?? []) as unknown as AssignmentHistoryRow[];
}

/**
 * Most recent shift strictly before workDate: its absolute end time and its
 * start-of-day minutes (used by the post-late-shift soft rule).
 * Returns null if no prior shift exists.
 */
export function lastShiftBefore(
  rows: AssignmentHistoryRow[],
  workDate: string
): { end: Date; startMinutes: number } | null {
  let last: { end: Date; startMinutes: number } | null = null;

  for (const row of rows) {
    const slotDate = row.shift_slots.rosters?.roster_date;
    if (!slotDate || slotDate >= workDate) continue;

    const endDt = shiftEndDateTime(slotDate, row.shift_slots.start_time, row.shift_slots.end_time);
    if (!last || endDt > last.end) {
      last = { end: endDt, startMinutes: timeToMinutes(row.shift_slots.start_time) };
    }
  }

  return last;
}

/**
 * Total scheduled minutes for a staff member on a given date (excluding the target slot).
 */
export function dailyScheduledMinutes(
  rows: AssignmentHistoryRow[],
  workDate: string,
  excludeSlotId?: number
): number {
  let total = 0;
  for (const row of rows) {
    if (row.slot_id === excludeSlotId) continue;
    const slotDate = row.shift_slots.rosters?.roster_date;
    if (slotDate !== workDate) continue;
    total += shiftDurationMinutes(row.shift_slots.start_time, row.shift_slots.end_time);
  }
  return total;
}

/**
 * Count of consecutive working days ending on (but not including) workDate.
 */
export function consecutivePriorDays(rows: AssignmentHistoryRow[], workDate: string): number {
  const workDates = new Set<string>();
  for (const row of rows) {
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
 * Fetches certifications for a set of staff, keyed by staff_id, in one query.
 */
async function fetchCertifications(staffIds: number[]): Promise<Map<number, CertRow[]>> {
  const map = new Map<number, CertRow[]>();
  if (staffIds.length === 0) return map;

  const { data } = await supabaseAdmin
    .from('staff_certifications')
    .select('staff_id, cert_name, expiry_date')
    .in('staff_id', staffIds);

  for (const row of (data ?? []) as Array<CertRow & { staff_id: number }>) {
    const list = map.get(row.staff_id) ?? [];
    list.push({ cert_name: row.cert_name, expiry_date: row.expiry_date });
    map.set(row.staff_id, list);
  }
  return map;
}

/**
 * Returns true when the staff holds a valid (unexpired as of rosterDate)
 * certification matching the required service type.
 */
function hasValidCertification(
  certs: CertRow[] | undefined,
  serviceType: 'MTS' | 'EAS',
  rosterDate: string
): boolean {
  if (!certs || certs.length === 0) return false;
  return certs.some(
    (c) =>
      c.cert_name?.toUpperCase() === serviceType &&
      (!c.expiry_date || c.expiry_date >= rosterDate)
  );
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

  const certsByStaff = await fetchCertifications(candidates.map((c) => c.staff_id));

  // Evaluate one candidate through the ordered pipeline. Steps within a
  // candidate stay sequential (later filters only run if earlier ones pass),
  // but candidates are independent of each other, so the caller runs them
  // concurrently — this turned a ~(N candidates × 4 queries) serial chain into
  // roughly the latency of a single candidate, which is what makes the
  // ranking modal load fast.
  async function evaluateCandidate(candidate: StaffCandidate): Promise<FilterResult> {
    const trace: FilterStep[] = [];
    const base = {
      staff_id: candidate.staff_id,
      full_name: candidate.full_name,
      role: candidate.role,
      employment_type: candidate.employment_type,
      home_postal: candidate.home_postal ?? null,
      is_management: candidate.is_management ?? false,
    };

    // Skip inactive staff immediately
    if (candidate.status !== 'active') {
      return {
        ...base,
        eligible: false,
        hard_blocked: true,
        block_reason: 'Staff member is inactive',
        consecutive_days_flag: false,
        consecutive_days_count: 0,
        late_shift_rest_flag: false,
        filter_trace: [{ filter: 'availability', passed: false, detail: 'Staff member is inactive' }],
      };
    }

    // --- Step 0: Part-time shift-length cap (pure field check, no DB query) ---
    // A part-timer cannot be assigned a single shift longer than 6 h. Run
    // before the availability query so it costs nothing when it applies.
    if (candidate.employment_type === 'part_time' && slotDuration > PART_TIME_MAX_DAILY_MINUTES) {
      const reason = `Part-time staff cannot work shifts exceeding ${PART_TIME_MAX_DAILY_MINUTES / 60}h (this slot is ${(slotDuration / 60).toFixed(1)}h)`;
      trace.push({ filter: 'part_time_hours', passed: false, detail: reason });
      return {
        ...base,
        eligible: false,
        hard_blocked: true,
        block_reason: reason,
        consecutive_days_flag: false,
        consecutive_days_count: 0,
        late_shift_rest_flag: false,
        filter_trace: trace,
      };
    }

    // --- Step 1: Availability / Leave check ---
    const availabilityBlock = await isBlockedByLeaveOrAvailability(
      candidate.staff_id,
      rosterDate,
      slotStart,
      slotEnd
    );
    if (availabilityBlock) {
      trace.push({ filter: 'availability', passed: false, detail: availabilityBlock });
      return {
        ...base,
        eligible: false,
        hard_blocked: true,
        block_reason: availabilityBlock,
        consecutive_days_flag: false,
        consecutive_days_count: 0,
        late_shift_rest_flag: false,
        filter_trace: trace,
      };
    }
    trace.push({ filter: 'availability', passed: true, detail: 'Available on this date' });

    // Steps 2–4 all derive from the same assignment history — fetched once.
    const history = await fetchAssignmentHistory(candidate.staff_id);

    // --- Step 2: Rest hours check (min 12 h) ---
    const lastShift = lastShiftBefore(history, rosterDate);
    if (lastShift) {
      const shiftStartDt = new Date(`${rosterDate}T${slot.start_time}`);
      const restHours = (shiftStartDt.getTime() - lastShift.end.getTime()) / (1000 * 60 * 60);
      if (restHours < 12) {
        trace.push({
          filter: 'rest_hours',
          passed: false,
          detail: `Insufficient rest (${restHours.toFixed(1)}h < 12h required)`,
        });
        return {
          ...base,
          eligible: false,
          hard_blocked: true,
          block_reason: `Insufficient rest (${restHours.toFixed(1)}h < 12h required)`,
          consecutive_days_flag: false,
          consecutive_days_count: 0,
          late_shift_rest_flag: false,
          filter_trace: trace,
        };
      }
    }
    trace.push({ filter: 'rest_hours', passed: true, detail: 'At least 12h rest since last shift' });

    // --- Step 2b: Post-late-shift rest (SOFT rule, scheduling rules ref) ---
    // After a late shift (start >= 18:00) the next shift should not start
    // before 12:00. Traced only when it actually fires so a clean candidate
    // still shows the canonical five-stage pipeline.
    const lateShiftRestFlag =
      !!lastShift &&
      lastShift.startMinutes >= LATE_SHIFT_START_MINUTES &&
      slotStart < POST_LATE_SHIFT_EARLIEST_START;
    if (lateShiftRestFlag) {
      trace.push({
        filter: 'late_shift_rest',
        passed: true,
        soft: true,
        detail: `Soft flag: previous shift was a late shift — this shift starts before 12:00`,
      });
    }

    // --- Step 3: Daily hours check (per employment type) ---
    const dailyMinutes = dailyScheduledMinutes(history, rosterDate, slot.slot_id);
    const dailyCap =
      candidate.employment_type === 'part_time'
        ? PART_TIME_MAX_DAILY_MINUTES
        : FULL_TIME_MAX_DAILY_MINUTES;
    const dailyCapHours = dailyCap / 60;
    if (dailyMinutes + slotDuration > dailyCap) {
      const totalHours = ((dailyMinutes + slotDuration) / 60).toFixed(1);
      trace.push({
        filter: 'daily_hours',
        passed: false,
        detail: `Would exceed ${dailyCapHours}h daily limit (${totalHours}h)`,
      });
      return {
        ...base,
        eligible: false,
        hard_blocked: true,
        block_reason: `Would exceed ${dailyCapHours}h daily limit (${totalHours}h)`,
        consecutive_days_flag: false,
        consecutive_days_count: 0,
        late_shift_rest_flag: lateShiftRestFlag,
        filter_trace: trace,
      };
    }
    trace.push({ filter: 'daily_hours', passed: true, detail: `Within ${dailyCapHours}h daily limit` });

    // --- Step 4: Consecutive days (SOFT flag, NOT a hard block) ---
    const consecutiveDays = consecutivePriorDays(history, rosterDate);
    const consecutiveFlag = consecutiveDays >= 6; // 6 prior + today = 7+ consecutive
    trace.push({
      filter: 'consecutive_days',
      passed: true,
      soft: true,
      detail: consecutiveFlag
        ? `Soft flag: ${consecutiveDays} consecutive days prior (7+ with this shift)`
        : `${consecutiveDays} consecutive days prior`,
    });

    // --- Step 5: Certification / role match ---
    // (a) role hierarchy, (b) a real, unexpired cert row for the service type.
    if (!isCertEligible(candidate.role, slot.service_type)) {
      const reason = `Role '${candidate.role}' not eligible for service type '${slot.service_type}'`;
      trace.push({ filter: 'certification', passed: false, detail: reason });
      return {
        ...base,
        eligible: false,
        hard_blocked: true,
        block_reason: reason,
        consecutive_days_flag: consecutiveFlag,
        consecutive_days_count: consecutiveDays,
        late_shift_rest_flag: lateShiftRestFlag,
        filter_trace: trace,
      };
    }
    if (!hasValidCertification(certsByStaff.get(candidate.staff_id), slot.service_type, rosterDate)) {
      const reason = `Missing or expired ${slot.service_type} certification`;
      trace.push({ filter: 'certification', passed: false, detail: reason });
      return {
        ...base,
        eligible: false,
        hard_blocked: true,
        block_reason: reason,
        consecutive_days_flag: consecutiveFlag,
        consecutive_days_count: consecutiveDays,
        late_shift_rest_flag: lateShiftRestFlag,
        filter_trace: trace,
      };
    }
    trace.push({
      filter: 'certification',
      passed: true,
      detail: `Holds a valid ${slot.service_type} certification`,
    });

    // Passed all filters
    return {
      ...base,
      eligible: true,
      hard_blocked: false,
      consecutive_days_flag: consecutiveFlag,
      consecutive_days_count: consecutiveDays,
      late_shift_rest_flag: lateShiftRestFlag,
      filter_trace: trace,
    };
  }

  // Candidates are independent — evaluate them all concurrently.
  // Promise.all preserves input order, so results stay aligned with the pool.
  return Promise.all(candidates.map(evaluateCandidate));
}

/**
 * Fetches all active staff and runs the filter pipeline for a slot.
 */
export async function getEligibleCandidates(
  slot: ShiftSlot,
  rosterDate: string
): Promise<FilterResult[]> {
  // is_management is a later addition — fall back to a select without it so
  // the engine keeps working against a database that predates the migration.
  const withMgmt = await supabaseAdmin
    .from('staff')
    .select('staff_id, full_name, role, employment_type, status, home_postal, is_management')
    .eq('status', 'active');

  let staffList: unknown[] | null = withMgmt.data;
  let error = withMgmt.error;

  if (error) {
    const withoutMgmt = await supabaseAdmin
      .from('staff')
      .select('staff_id, full_name, role, employment_type, status, home_postal')
      .eq('status', 'active');
    staffList = withoutMgmt.data;
    error = withoutMgmt.error;
  }

  if (error) throw new Error(`Failed to fetch staff: ${error.message}`);

  return filterCandidates(slot, rosterDate, (staffList ?? []) as StaffCandidate[]);
}
