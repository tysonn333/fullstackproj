/**
 * UC-005 Ranking / Scoring & Pairing Engine (Guan Hee)
 *
 * Scores each eligible candidate on a weighted composite of the criteria named
 * in the HLD (§8.3) and the use-case spec:
 *
 *   1. Fairness      — inverse of late-shift count this month   (weight 0.25)
 *   2. Rest          — hours since last shift end, capped 24h    (weight 0.20)
 *   3. Proximity     — how close home_postal is to the station   (weight 0.20)
 *   4. Cert fit      — exact role match preferred over over-      (weight 0.15)
 *                      qualified (a paramedic on an MTS slot)
 *   5. Preference    — early/late shift preference match          (weight 0.10)
 *   6. Continuity    — no overlapping same-day assignment         (weight 0.10)
 *
 * Tie-breaker: fewer late shifts → more rest hours → closer to station →
 * alphabetical by staff_id.
 *
 * It also implements the UC-005 driver + attendant PAIRING algorithm: rank both
 * pools, take the top of each, and if the two crew members do not live within
 * an acceptable radius of one another, walk the attendant list until a
 * proximity-compatible pair is found (falling back to the best-scoring pair
 * with a proximity flag if none is compatible).
 */

import supabaseAdmin from '../../lib/supabase';
import {
  FilterResult,
  ShiftSlot,
  StaffRole,
  timeToMinutes,
  shiftDurationMinutes,
  shiftEndDateTime,
} from './filter';
import { proximityScore, isProximityCompatible, distanceKm, STATION_POSTAL } from './proximity';

export interface RankedCandidate extends FilterResult {
  score: number;
  score_breakdown: {
    fairness: number;
    rest: number;
    proximity: number;
    cert_fit: number;
    preference: number;
    continuity: number;
  };
  late_shift_count: number;
  rest_hours: number;
  proximity_km: number;
}

export const WEIGHTS = {
  fairness: 0.25,
  rest: 0.2,
  proximity: 0.2,
  cert_fit: 0.15,
  preference: 0.1,
  continuity: 0.1,
};

// Late shifts: start_time >= 18:00 (1080 minutes)
const LATE_SHIFT_THRESHOLD = 18 * 60;

/**
 * Returns the number of late shifts (start >= 18:00) the staff member has this calendar month.
 */
async function getLateShiftCount(staffId: number, month: string): Promise<number> {
  // month = "YYYY-MM" — compute the boundary with string math so the result
  // is timezone-independent (Date/setMonth mixes UTC parsing with local-time
  // arithmetic and can land in the wrong month on negative-offset servers).
  const [year, mon] = month.split('-').map((n) => parseInt(n, 10));
  const startOfMonth = `${month}-01`;
  const endOfMonth =
    mon === 12
      ? `${year + 1}-01-01`
      : `${year}-${String(mon + 1).padStart(2, '0')}-01`;

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
    .select('shift_slots!inner(start_time, end_time, rosters!inner(roster_date))')
    .eq('staff_id', staffId)
    .neq('status', 'cancelled');

  if (!data || data.length === 0) return 24;

  type Row = { shift_slots: { start_time: string; end_time: string; rosters: { roster_date: string } } };

  const slotStartDt = new Date(`${rosterDate}T${slotStartTime}`);
  let lastEnd: Date | null = null;

  for (const row of data as unknown as Row[]) {
    const d = row.shift_slots.rosters?.roster_date;
    if (!d) continue;
    if (d >= rosterDate) continue;
    const endDt = shiftEndDateTime(d, row.shift_slots.start_time, row.shift_slots.end_time);
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

  // End times extend past 1440 for overnight shifts so same-day overlap
  // comparisons stay on one linear axis.
  const newStart = timeToMinutes(slot.start_time);
  const newEnd = newStart + shiftDurationMinutes(slot.start_time, slot.end_time);

  for (const row of data as unknown as Row[]) {
    const d = row.shift_slots.rosters?.roster_date;
    if (d !== rosterDate) continue;
    if (row.shift_slots.slot_id === slot.slot_id) continue;

    const existStart = timeToMinutes(row.shift_slots.start_time);
    const existEnd = existStart + shiftDurationMinutes(row.shift_slots.start_time, row.shift_slots.end_time);
    const overlap = Math.max(0, Math.min(newEnd, existEnd) - Math.max(newStart, existStart));
    if (overlap > 0) return 0.0;
  }

  return 1.0;
}

/**
 * Certification-fit score: an exact role match for the service is preferred
 * over an over-qualified one, so scarce dual-certified staff (drivers,
 * paramedics) are conserved for EAS work that only they can do.
 *
 *   EAS slot: driver / paramedic are the only options → full 1.0
 *   MTS slot: a medic / EMT is an exact fit (1.0); a driver or paramedic is
 *             over-qualified (0.6) so the ranker prefers to save them for EAS.
 */
export function certFitScore(role: StaffRole, serviceType: 'MTS' | 'EAS'): number {
  if (serviceType === 'EAS') return 1.0;
  // MTS slot
  if (role === 'medic' || role === 'emt') return 1.0; // exact fit
  if (role === 'paramedic' || role === 'driver') return 0.6; // over-qualified
  return 0.5;
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
  const proximityRaw = proximityScore(candidate.home_postal);
  const certFitRaw = certFitScore(candidate.role, slot.service_type);

  // Fairness: inverse late-shift count. Max capped at 20 shifts = 0 score.
  const fairnessRaw = 1 - Math.min(lateShiftCount, 20) / 20;

  // Rest: 0–24h normalised to 0–1
  const restRaw = restHours / 24;

  const score =
    (WEIGHTS.fairness * fairnessRaw +
      WEIGHTS.rest * restRaw +
      WEIGHTS.proximity * proximityRaw +
      WEIGHTS.cert_fit * certFitRaw +
      WEIGHTS.preference * preferenceRaw +
      WEIGHTS.continuity * continuityRaw) *
    100;

  const round2 = (n: number) => Math.round(n * 100) / 100;

  return {
    ...candidate,
    score: round2(score),
    score_breakdown: {
      fairness: round2(fairnessRaw),
      rest: round2(restRaw),
      proximity: round2(proximityRaw),
      cert_fit: round2(certFitRaw),
      preference: round2(preferenceRaw),
      continuity: round2(continuityRaw),
    },
    late_shift_count: lateShiftCount,
    rest_hours: round2(restHours),
    proximity_km: round2(distanceKm(candidate.home_postal, STATION_POSTAL)),
  };
}

/**
 * Ranks all eligible candidates for a slot.
 * Tie-breaker: fewer late shifts → more rest hours → closer to station →
 * alphabetical staff_id (ascending).
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
    // Tie-breaker 3: closer to station
    if (a.proximity_km !== b.proximity_km) return a.proximity_km - b.proximity_km;
    // Tie-breaker 4: alphabetical by staff_id ascending
    return a.staff_id - b.staff_id;
  });

  return scored;
}

// ── UC-005 Crew Pairing ───────────────────────────────────────────────────────

export interface CrewPair {
  driver: RankedCandidate | null;
  attendant: RankedCandidate | null;
  /** Combined score of the chosen pair (sum of the two member scores). */
  pair_score: number;
  /** Distance in km between the two crew members' homes. */
  pair_distance_km: number | null;
  /** True when the pair was formed despite exceeding the proximity radius. */
  proximity_flag: boolean;
  /** Human-readable explanation of how the pair was chosen. */
  note: string;
}

/**
 * Pairs a driver with an attendant (medic / EMT / paramedic) from two already
 * ranked pools, implementing UC-005 main-flow steps 5–7:
 *
 *   • take the top-ranked driver + top-ranked attendant;
 *   • if they are not proximity-compatible, keep the top driver and walk the
 *     attendant list for the first compatible partner;
 *   • if still none, try the next driver, and so on;
 *   • if no compatible combination exists, fall back to the highest combined
 *     score and raise a proximity flag.
 *
 * Either pool may be empty — the corresponding side of the pair is returned as
 * null so the caller can raise a coverage_gap flag for that role.
 */
export function pairCrew(
  rankedDrivers: RankedCandidate[],
  rankedAttendants: RankedCandidate[]
): CrewPair {
  const drivers = [...rankedDrivers];
  const attendants = [...rankedAttendants];

  if (drivers.length === 0 || attendants.length === 0) {
    const driver = drivers[0] ?? null;
    const attendant = attendants[0] ?? null;
    return {
      driver,
      attendant,
      pair_score: (driver?.score ?? 0) + (attendant?.score ?? 0),
      pair_distance_km: null,
      proximity_flag: false,
      note:
        drivers.length === 0 && attendants.length === 0
          ? 'No eligible driver or attendant'
          : drivers.length === 0
          ? 'No eligible driver'
          : 'No eligible attendant',
    };
  }

  // First compatible pair, scanning drivers then attendants in ranked order.
  for (const driver of drivers) {
    for (const attendant of attendants) {
      if (isProximityCompatible(driver.home_postal, attendant.home_postal)) {
        return {
          driver,
          attendant,
          pair_score: driver.score + attendant.score,
          pair_distance_km: round2(distanceKm(driver.home_postal, attendant.home_postal)),
          proximity_flag: false,
          note: 'Top proximity-compatible pair',
        };
      }
    }
  }

  // No compatible pair — fall back to the highest combined score and flag it.
  let best: { driver: RankedCandidate; attendant: RankedCandidate; combined: number } | null = null;
  for (const driver of drivers) {
    for (const attendant of attendants) {
      const combined = driver.score + attendant.score;
      if (!best || combined > best.combined) {
        best = { driver, attendant, combined };
      }
    }
  }

  const chosen = best!;
  return {
    driver: chosen.driver,
    attendant: chosen.attendant,
    pair_score: chosen.combined,
    pair_distance_km: round2(distanceKm(chosen.driver.home_postal, chosen.attendant.home_postal)),
    proximity_flag: true,
    note: 'No proximity-compatible pair — assigned best-scoring pair with a proximity flag',
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
