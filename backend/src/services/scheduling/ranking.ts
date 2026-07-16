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
 * The weights above are the defaults; each can be overridden with a
 * RANK_WEIGHT_* env var (see resolveWeights) and the set is normalised to
 * sum to 1, satisfying the UC-005 precondition that weights are configurable.
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
  LATE_SHIFT_START_MINUTES,
} from './filter';
import { proximityScore, isProximityCompatible, distanceKm, postalDistrict, STATION_POSTAL } from './proximity';

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
  /** Distance from home to the station; null when the postal code is missing
   *  or unmappable — a fake concrete number would mislead the UI. */
  proximity_km: number | null;
}

const DEFAULT_WEIGHTS = {
  fairness: 0.25,
  rest: 0.2,
  proximity: 0.2,
  cert_fit: 0.15,
  preference: 0.1,
  continuity: 0.1,
};

export type Weights = typeof DEFAULT_WEIGHTS;

/**
 * Resolves the ranking weights (UC-005 precondition: "ranking weights are
 * configured"). Each component can be overridden via a RANK_WEIGHT_* env var
 * (e.g. RANK_WEIGHT_FAIRNESS=0.4). Invalid or non-positive values fall back to
 * the default for that component, and the final set is normalised to sum to 1
 * so the composite score always stays on the 0–100 scale.
 */
export function resolveWeights(env: Record<string, string | undefined> = process.env): Weights {
  const read = (key: string, fallback: number): number => {
    const raw = env[`RANK_WEIGHT_${key}`];
    if (raw == null || raw === '') return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };

  const w = {
    fairness: read('FAIRNESS', DEFAULT_WEIGHTS.fairness),
    rest: read('REST', DEFAULT_WEIGHTS.rest),
    proximity: read('PROXIMITY', DEFAULT_WEIGHTS.proximity),
    cert_fit: read('CERT_FIT', DEFAULT_WEIGHTS.cert_fit),
    preference: read('PREFERENCE', DEFAULT_WEIGHTS.preference),
    continuity: read('CONTINUITY', DEFAULT_WEIGHTS.continuity),
  };

  const total = w.fairness + w.rest + w.proximity + w.cert_fit + w.preference + w.continuity;
  return {
    fairness: w.fairness / total,
    rest: w.rest / total,
    proximity: w.proximity / total,
    cert_fit: w.cert_fit / total,
    preference: w.preference / total,
    continuity: w.continuity / total,
  };
}

export const WEIGHTS = resolveWeights();

// ── Per-candidate assignment history (fetched ONCE per candidate) ─────────────

interface HistoryRow {
  shift_slots: {
    slot_id?: number;
    start_time: string;
    end_time: string;
    rosters: { roster_date: string };
  };
}

/**
 * The fairness, rest and continuity components all read the same assignment
 * history — fetch it in one query per candidate (previously three).
 */
async function fetchScoringHistory(staffId: number): Promise<HistoryRow[]> {
  const { data } = await supabaseAdmin
    .from('assignments')
    .select('shift_slots!inner(slot_id, start_time, end_time, rosters!inner(roster_date))')
    .eq('staff_id', staffId)
    .neq('status', 'cancelled');

  return (data ?? []) as unknown as HistoryRow[];
}

/**
 * Number of late shifts (start >= 18:00) the staff member has in the calendar month.
 */
function lateShiftCountFor(rows: HistoryRow[], month: string): number {
  // month = "YYYY-MM" — compute the boundary with string math so the result
  // is timezone-independent (Date/setMonth mixes UTC parsing with local-time
  // arithmetic and can land in the wrong month on negative-offset servers).
  const [year, mon] = month.split('-').map((n) => parseInt(n, 10));
  const startOfMonth = `${month}-01`;
  const endOfMonth =
    mon === 12
      ? `${year + 1}-01-01`
      : `${year}-${String(mon + 1).padStart(2, '0')}-01`;

  let count = 0;
  for (const row of rows) {
    const rosterDate = row.shift_slots.rosters?.roster_date;
    if (!rosterDate) continue;
    if (rosterDate < startOfMonth || rosterDate >= endOfMonth) continue;
    if (timeToMinutes(row.shift_slots.start_time) >= LATE_SHIFT_START_MINUTES) {
      count++;
    }
  }

  return count;
}

/**
 * Hours since the staff member's last shift end, up to a maximum of 24.
 * Returns 24 if no prior shifts (maximally rested).
 */
function restHoursFor(rows: HistoryRow[], rosterDate: string, slotStartTime: string): number {
  const slotStartDt = new Date(`${rosterDate}T${slotStartTime}`);
  let lastEnd: Date | null = null;

  for (const row of rows) {
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
function continuityScoreFor(rows: HistoryRow[], rosterDate: string, slot: ShiftSlot): number {
  // End times extend past 1440 for overnight shifts so same-day overlap
  // comparisons stay on one linear axis.
  const newStart = timeToMinutes(slot.start_time);
  const newEnd = newStart + shiftDurationMinutes(slot.start_time, slot.end_time);

  for (const row of rows) {
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

  // Two round trips per candidate, run concurrently: one assignment-history
  // fetch feeding fairness + rest + continuity (previously three separate
  // queries), and the preferences lookup.
  const [history, preferenceRaw] = await Promise.all([
    fetchScoringHistory(candidate.staff_id),
    getPreferenceScore(candidate.staff_id, slotStart),
  ]);
  const lateShiftCount = lateShiftCountFor(history, month);
  const restHours = restHoursFor(history, rosterDate, slot.start_time);
  const continuityRaw = continuityScoreFor(history, rosterDate, slot);
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
    // Only report a distance we can actually derive; an unmappable postal
    // would otherwise produce the same fallback distance for everyone.
    proximity_km:
      postalDistrict(candidate.home_postal) == null
        ? null
        : round2(distanceKm(candidate.home_postal, STATION_POSTAL)),
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
    // Tie-breaker 3: closer to station (unknown distance sorts as farthest)
    const aKm = a.proximity_km ?? Number.POSITIVE_INFINITY;
    const bKm = b.proximity_km ?? Number.POSITIVE_INFINITY;
    if (aKm !== bKm) return aKm - bKm;
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
  /** True when the pair was chosen because of a buddy preference. */
  buddy_pair: boolean;
  /** Human-readable explanation of how the pair was chosen. */
  note: string;
}

/** staff_id → preferred partner's staff_id (from staff_preferences.buddy_staff_id). */
export type BuddyMap = Map<number, number>;

// A buddy preference is honoured only when the partner ranks within the top N
// of the opposite pool (UC-005 A3 — soft signal, never forced).
const BUDDY_TOP_N = 3;

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
 * Buddy preferences (UC-005 A3) are honoured as a soft signal: when a member
 * of the top-3 of one pool names a buddy who sits in the top-3 of the other
 * pool AND the two are proximity-compatible, that pair is chosen
 * preferentially. Otherwise the preference is ignored (never forced).
 *
 * Either pool may be empty — the corresponding side of the pair is returned as
 * null so the caller can raise a coverage_gap flag for that role.
 */
export function pairCrew(
  rankedDrivers: RankedCandidate[],
  rankedAttendants: RankedCandidate[],
  buddies?: BuddyMap
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
      buddy_pair: false,
      note:
        drivers.length === 0 && attendants.length === 0
          ? 'No eligible driver or attendant'
          : drivers.length === 0
          ? 'No eligible driver'
          : 'No eligible attendant',
    };
  }

  // Buddy pass: best-scoring mutual/one-way buddy pair within the top 3 of
  // each pool, if proximity-compatible.
  if (buddies && buddies.size > 0) {
    const topDrivers = drivers.slice(0, BUDDY_TOP_N);
    const topAttendants = attendants.slice(0, BUDDY_TOP_N);
    let bestBuddy: { driver: RankedCandidate; attendant: RankedCandidate; combined: number } | null = null;

    for (const driver of topDrivers) {
      for (const attendant of topAttendants) {
        const isBuddyPair =
          buddies.get(driver.staff_id) === attendant.staff_id ||
          buddies.get(attendant.staff_id) === driver.staff_id;
        if (!isBuddyPair) continue;
        if (!isProximityCompatible(driver.home_postal, attendant.home_postal)) continue;
        const combined = driver.score + attendant.score;
        if (!bestBuddy || combined > bestBuddy.combined) {
          bestBuddy = { driver, attendant, combined };
        }
      }
    }

    if (bestBuddy) {
      return {
        driver: bestBuddy.driver,
        attendant: bestBuddy.attendant,
        pair_score: bestBuddy.combined,
        pair_distance_km: round2(distanceKm(bestBuddy.driver.home_postal, bestBuddy.attendant.home_postal)),
        proximity_flag: false,
        buddy_pair: true,
        note: 'Buddy-preference pair (both in top 3, proximity-compatible)',
      };
    }
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
          buddy_pair: false,
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
    buddy_pair: false,
    note: 'No proximity-compatible pair — assigned best-scoring pair with a proximity flag',
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
