/**
 * UC-005 Ranking / Scoring Engine
 *
 * Scores eligible candidates for a shift slot using:
 *   1. Fairness score      — inverse of late-shift count this month (weight 30%)
 *   2. Rest score          — hours since last shift end, capped at 24h (weight 30%)
 *   3. Preference score    — matches shift type (early/late) preference (weight 20%)
 *   4. Continuity score    — no same-day assignment overlap (weight 20%)
 *
 * Tie-breaker: fewer late shifts → more rest hours → alphabetical by staff_id
 */

import supabaseAdmin from '../../lib/supabase';
import { FilterResult, ShiftSlot, timeToMinutes } from './filter';

export interface RankedCandidate extends FilterResult {
  score: number;
  score_breakdown: {
    fairness: number;
    rest: number;
    preference: number;
    continuity: number;
  };
  late_shift_count: number;
  rest_hours: number;
}

const WEIGHTS = {
  fairness: 0.3,
  rest: 0.3,
  preference: 0.2,
  continuity: 0.2,
};

// Late shifts: start_time >= 18:00 (1080 minutes)
const LATE_SHIFT_THRESHOLD = 18 * 60;

/**
 * Returns the number of late shifts (start >= 18:00) the staff member has this calendar month.
 */
async function getLateShiftCount(staffId: number, month: string): Promise<number> {
  // month = "YYYY-MM"
  const startOfMonth = `${month}-01`;
  const endOfMonth = new Date(new Date(startOfMonth).setMonth(new Date(startOfMonth).getMonth() + 1))
    .toISOString()
    .split('T')[0];

  const { data } = await supabaseAdmin
    .from('assignments')
    .select('shift_slots!inner(start_time, rosters!inner(roster_date))')
    .eq('staff_id', staffId)
    .neq('status', 'cancelled');

  if (!data) return 0;

  type Row = { shift_slots: { start_time: string; rosters: { roster_date: string } } };
  let count = 0;

  for (const row of data as unknown as Row[]) {
    const rosterDate = row.shift_slots.rosters?.roster_date;
    if (!rosterDate) continue;
    if (rosterDate < startOfMonth || rosterDate >= endOfMonth) continue;
    if (timeToMinutes(row.shift_slots.start_time) >= LATE_SHIFT_THRESHOLD) {
      count++;
    }
  }

  return count;
}

/**
 * Returns hours since the staff member's last shift end, up to a maximum of 24.
 * Returns 24 if no prior shifts (maximally rested).
 */
async function getRestHours(staffId: number, rosterDate: string, slotStartTime: string): Promise<number> {
  const { data } = await supabaseAdmin
    .from('assignments')
    .select('shift_slots!inner(end_time, rosters!inner(roster_date))')
    .eq('staff_id', staffId)
    .neq('status', 'cancelled');

  if (!data || data.length === 0) return 24;

  type Row = { shift_slots: { end_time: string; rosters: { roster_date: string } } };

  const slotStartDt = new Date(`${rosterDate}T${slotStartTime}`);
  let lastEnd: Date | null = null;

  for (const row of data as unknown as Row[]) {
    const d = row.shift_slots.rosters?.roster_date;
    if (!d) continue;
    if (d >= rosterDate) continue;
    const endDt = new Date(`${d}T${row.shift_slots.end_time}`);
    if (!lastEnd || endDt > lastEnd) lastEnd = endDt;
  }

  if (!lastEnd) return 24;

  const hours = (slotStartDt.getTime() - lastEnd.getTime()) / (1000 * 60 * 60);
  return Math.min(24, Math.max(0, hours));
}

/**
 * Returns true if the staff member prefers this shift type.
 * Prefers early if start < 12:00, late if start >= 12:00.
 * This can be extended with a preferences table; for now uses a simple heuristic.
 */
async function getPreferenceScore(
  staffId: number,
  slotStart: number
): Promise<number> {
  // Try to look up a preferences table; gracefully default to 0.5 if absent
  try {
    const { data } = await supabaseAdmin
      .from('staff_preferences')
      .select('prefers_early, prefers_late')
      .eq('staff_id', staffId)
      .single();

    if (!data) return 0.5;

    const isEarly = slotStart < 720;
    if (isEarly && data.prefers_early) return 1.0;
    if (!isEarly && data.prefers_late) return 1.0;
    if (isEarly && data.prefers_late) return 0.0;
    if (!isEarly && data.prefers_early) return 0.0;
    return 0.5;
  } catch {
    return 0.5;
  }
}

/**
 * Returns 1 if no same-day slot overlap, 0 if overlap exists.
 */
async function getContinuityScore(
  staffId: number,
  rosterDate: string,
  slot: ShiftSlot
): Promise<number> {
  const { data } = await supabaseAdmin
    .from('assignments')
    .select('shift_slots!inner(slot_id, start_time, end_time, rosters!inner(roster_date))')
    .eq('staff_id', staffId)
    .neq('status', 'cancelled');

  if (!data) return 1.0;

  type Row = {
    shift_slots: {
      slot_id: number;
      start_time: string;
      end_time: string;
      rosters: { roster_date: string };
    };
  };

  const newStart = timeToMinutes(slot.start_time);
  const newEnd = timeToMinutes(slot.end_time);

  for (const row of data as unknown as Row[]) {
    const d = row.shift_slots.rosters?.roster_date;
    if (d !== rosterDate) continue;
    if (row.shift_slots.slot_id === slot.slot_id) continue;

    const existStart = timeToMinutes(row.shift_slots.start_time);
    const existEnd = timeToMinutes(row.shift_slots.end_time);
    const overlap = Math.max(0, Math.min(newEnd, existEnd) - Math.max(newStart, existStart));
    if (overlap > 0) return 0.0;
  }

  return 1.0;
}

/**
 * Computes the composite score (0–100) for a candidate for a given slot.
 */
export async function scoreCandidate(
  candidate: FilterResult,
  slot: ShiftSlot,
  rosterDate: string,
  month: string
): Promise<RankedCandidate> {
  const slotStart = timeToMinutes(slot.start_time);

  const lateShiftCount = await getLateShiftCount(candidate.staff_id, month);
  const restHours = await getRestHours(candidate.staff_id, rosterDate, slot.start_time);
  const preferenceRaw = await getPreferenceScore(candidate.staff_id, slotStart);
  const continuityRaw = await getContinuityScore(candidate.staff_id, rosterDate, slot);

  // Fairness: inverse late-shift count. Max capped at 20 shifts = 0 score.
  const fairnessRaw = 1 - Math.min(lateShiftCount, 20) / 20;

  // Rest: 0–24h normalised to 0–1
  const restRaw = restHours / 24;

  const score =
    (WEIGHTS.fairness * fairnessRaw +
      WEIGHTS.rest * restRaw +
      WEIGHTS.preference * preferenceRaw +
      WEIGHTS.continuity * continuityRaw) *
    100;

  return {
    ...candidate,
    score: Math.round(score * 100) / 100,
    score_breakdown: {
      fairness: Math.round(fairnessRaw * 100) / 100,
      rest: Math.round(restRaw * 100) / 100,
      preference: Math.round(preferenceRaw * 100) / 100,
      continuity: Math.round(continuityRaw * 100) / 100,
    },
    late_shift_count: lateShiftCount,
    rest_hours: Math.round(restHours * 100) / 100,
  };
}

/**
 * Ranks all eligible candidates for a slot.
 * Tie-breaker: fewer late shifts → more rest hours → alphabetical staff_id (ascending).
 */
export async function rankCandidates(
  eligibleCandidates: FilterResult[],
  slot: ShiftSlot,
  rosterDate: string
): Promise<RankedCandidate[]> {
  const month = rosterDate.substring(0, 7); // "YYYY-MM"

  const onlyEligible = eligibleCandidates.filter((c) => c.eligible);

  const scored = await Promise.all(
    onlyEligible.map((c) => scoreCandidate(c, slot, rosterDate, month))
  );

  scored.sort((a, b) => {
    // Primary: higher score first
    if (b.score !== a.score) return b.score - a.score;
    // Tie-breaker 1: fewer late shifts
    if (a.late_shift_count !== b.late_shift_count) return a.late_shift_count - b.late_shift_count;
    // Tie-breaker 2: more rest hours
    if (b.rest_hours !== a.rest_hours) return b.rest_hours - a.rest_hours;
    // Tie-breaker 3: alphabetical by staff_id ascending
    return a.staff_id - b.staff_id;
  });

  return scored;
}
