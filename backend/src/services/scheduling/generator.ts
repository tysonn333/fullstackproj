/**
 * Roster Generator (UC-002 — orchestrates Guan Hee's UC-004 + UC-005)
 *
 * Strategy:
 *   1. Create (or reuse draft) a roster row for the date.
 *   2. Fetch all ambulances in service on that date.
 *   3. For each ambulance generate two shift slots (day 06:00–18:00, night
 *      18:00–06:00) for each crew position (driver, attendant), respecting the
 *      ambulance service_type.
 *   4. Group the driver + attendant slot of each ambulance/service/shift window
 *      and CREW THEM AS A PAIR using UC-005's pairCrew():
 *        • run UC-004 filter + UC-005 ranking to build a driver pool and an
 *          attendant pool (role-appropriate for each position);
 *        • pair the highest-scoring proximity-compatible driver + attendant;
 *        • assign both, updating running hours/shift counters (via the DB) so
 *          later slots reflect the new state.
 *   5. Where a pool is empty, leave that slot unassigned and raise a
 *      coverage_gap flag — naming any qualified MANAGEMENT staff (UC-002 A6:
 *      management is overflow only, deployed manually by the admin, never
 *      auto-assigned); where no proximity-compatible pair exists, assign the
 *      best pair and raise a proximity flag.
 *   6. Raise soft-rule flags for any assigned staff: consecutive_days at
 *      >= 7 days, and rest_violation for a pre-noon start after a late shift.
 *
 * Constrained (EAS) ambulances are crewed first so scarce driver/paramedic
 * staff are not spent on MTS work that any role could cover.
 */

import supabaseAdmin from '../../lib/supabase';
import { getEligibleCandidates, ShiftSlot, FilterResult, timeToMinutes } from './filter';
import { rankCandidates, pairCrew, RankedCandidate, BuddyMap } from './ranking';
import { logAudit } from '../audit.service';

interface GenerateOptions {
  rosterDate: string; // "YYYY-MM-DD"
  actorId: string;    // UUID of user triggering generation
  force?: boolean;    // If true, overwrites existing draft
  /**
   * UC-002 A1: when the call-centre job list has not arrived, generation is
   * deferred by default. Pass allowSkeleton=true to generate a skeleton roster
   * from historical/standard coverage (all active ambulances) anyway.
   */
  allowSkeleton?: boolean;
}

interface GenerateResult {
  roster_id: number;
  roster_date: string;
  slots_created: number;
  assignments_made: number;
  flags_raised: number;
  pairs_formed: number;
  jobs_considered: number;
  ambulances_rostered: number;
  skeleton: boolean;
  weekend_or_holiday: boolean;
  errors: string[];
}

/**
 * Raised when generation is requested but the call-centre job list for the
 * date has not been imported yet (UC-002 A1 — defer and notify admin).
 */
export class NoJobListError extends Error {
  code = 'NO_JOB_LIST' as const;
  constructor(rosterDate: string) {
    super(
      `Job list for ${rosterDate} not yet available. Auto-generation deferred — ` +
        `import the call-centre job list first, or generate a skeleton roster based on standard coverage.`
    );
  }
}

// Singapore public holidays (static reference list; extend per year).
const SG_PUBLIC_HOLIDAYS = new Set([
  // 2025
  '2025-01-01', '2025-01-29', '2025-01-30', '2025-03-31', '2025-04-18',
  '2025-05-01', '2025-05-12', '2025-06-07', '2025-08-09', '2025-10-20', '2025-12-25',
  // 2026
  '2026-01-01', '2026-02-17', '2026-02-18', '2026-03-21', '2026-04-03',
  '2026-05-01', '2026-05-27', '2026-06-01', '2026-08-10', '2026-11-09', '2026-12-25',
]);

/** Weekend / public-holiday days run the reduced 2-ambulance baseline (UC-002 A3). */
export function isWeekendOrPublicHoliday(dateStr: string): boolean {
  const day = new Date(`${dateStr}T00:00:00`).getDay();
  return day === 0 || day === 6 || SG_PUBLIC_HOLIDAYS.has(dateStr);
}

const WEEKEND_BASELINE_AMBULANCES = 2;

// Each job is assumed to occupy a crew for this long from its pickup time when
// estimating how many ambulances must run concurrently.
const JOB_DURATION_MINUTES = 120;

interface JobRow {
  job_id: number;
  pickup_time: string;
  service_type: 'MTS' | 'EAS';
}

/**
 * Peak number of jobs in-flight at the same moment, treating each job as a
 * [pickup, pickup + JOB_DURATION_MINUTES) interval. Two simultaneous 06:30
 * jobs → peak 2 → at least 2 ambulances needed (UC-002 main flow step 3).
 */
export function peakConcurrentJobs(jobs: Array<{ pickup_time: string }>): number {
  if (jobs.length === 0) return 0;
  const events: Array<{ t: number; delta: number }> = [];
  for (const job of jobs) {
    const start = timeToMinutes(job.pickup_time);
    events.push({ t: start, delta: 1 });
    events.push({ t: start + JOB_DURATION_MINUTES, delta: -1 });
  }
  events.sort((a, b) => a.t - b.t || a.delta - b.delta);
  let current = 0;
  let peak = 0;
  for (const ev of events) {
    current += ev.delta;
    peak = Math.max(peak, current);
  }
  return peak;
}

const DAY_SHIFT_START = '06:00:00';
const DAY_SHIFT_END = '18:00:00';
const NIGHT_SHIFT_START = '18:00:00';
const NIGHT_SHIFT_END = '06:00:00'; // next day — end_time <= start_time marks an overnight shift

// Roles that can fill each crew position (UC spec: 1 driver + 1 medic/EMT/paramedic).
const DRIVER_ROLES = new Set(['driver']);
const ATTENDANT_ROLES = new Set(['medic', 'emt', 'paramedic']);

async function upsertRoster(rosterDate: string, force: boolean): Promise<number> {
  // Check for existing roster
  const { data: existing } = await supabaseAdmin
    .from('rosters')
    .select('roster_id, status')
    .eq('roster_date', rosterDate)
    .single();

  if (existing) {
    if (existing.status !== 'draft' && !force) {
      throw new Error(
        `Roster for ${rosterDate} already exists with status '${existing.status}'. Use force=true to regenerate.`
      );
    }

    // Delete old slots + assignments + flags for a fresh regeneration
    const { data: oldSlots } = await supabaseAdmin
      .from('shift_slots')
      .select('slot_id')
      .eq('roster_id', existing.roster_id);

    if (oldSlots && oldSlots.length > 0) {
      const slotIds = oldSlots.map((s) => s.slot_id);
      await supabaseAdmin.from('assignments').delete().in('slot_id', slotIds);
      await supabaseAdmin.from('flags').delete().eq('roster_id', existing.roster_id);
      await supabaseAdmin.from('shift_slots').delete().eq('roster_id', existing.roster_id);
    }

    await supabaseAdmin
      .from('rosters')
      .update({ status: 'draft', generated_at: new Date().toISOString() })
      .eq('roster_id', existing.roster_id);

    return existing.roster_id;
  }

  // Create new roster
  const { data: newRoster, error } = await supabaseAdmin
    .from('rosters')
    .insert({
      roster_date: rosterDate,
      status: 'draft',
      generated_at: new Date().toISOString(),
    })
    .select('roster_id')
    .single();

  if (error || !newRoster) {
    throw new Error(`Failed to create roster: ${error?.message}`);
  }

  return newRoster.roster_id;
}

async function raiseFlag(
  rosterId: number,
  slotId: number | null,
  staffId: number | null,
  flagType: string,
  severity: 'critical' | 'warning' | 'info',
  message: string
): Promise<void> {
  await supabaseAdmin.from('flags').insert({
    roster_id: rosterId,
    slot_id: slotId,
    staff_id: staffId,
    flag_type: flagType,
    severity,
    message,
    status: 'active',
    created_at: new Date().toISOString(),
  });
}

/**
 * Ranks the pool for one slot, then restricts it to the roles valid for that
 * crew position. Returns the ranked, role-appropriate candidates.
 */
async function rankedPoolForPosition(
  slot: ShiftSlot,
  rosterDate: string,
  allowedRoles: Set<string>
): Promise<RankedCandidate[]> {
  const filterResults: FilterResult[] = await getEligibleCandidates(slot, rosterDate);
  const roleScoped = filterResults.filter((c) => allowedRoles.has(c.role));
  return rankCandidates(roleScoped, slot, rosterDate);
}

/**
 * Coverage-gap message for a slot no regular staff can fill (UC-004 A2 /
 * UC-002 A6). When qualified MANAGEMENT staff pass all filters, the flag
 * names them so the admin can confirm the deployment deliberately — the
 * generator itself never auto-assigns management.
 */
export function coverageGapMessage(
  position: 'driver' | 'attendant',
  slot: ShiftSlot,
  managementCandidates: Array<{ full_name: string }>
): string {
  const where = `${slot.service_type} slot ${slot.slot_id} (${slot.start_time}–${slot.end_time})`;
  if (managementCandidates.length === 0) {
    return `No eligible ${position} for ${where}`;
  }
  const names = managementCandidates.map((m) => m.full_name).join(', ');
  return (
    `No eligible regular ${position} for ${where} — MANAGEMENT DEPLOYMENT REQUIRED: ` +
    `${names} pass${managementCandidates.length === 1 ? 'es' : ''} all filters and can be assigned manually ` +
    `via Find Replacement / the ranking modal`
  );
}

async function assignStaffToSlot(
  slotId: number,
  candidate: RankedCandidate
): Promise<string | null> {
  const { error } = await supabaseAdmin.from('assignments').insert({
    slot_id: slotId,
    staff_id: candidate.staff_id,
    score: candidate.score,
    status: 'assigned',
    assigned_at: new Date().toISOString(),
  });
  return error ? error.message : null;
}

interface SlotGroup {
  key: string;
  service_type: 'MTS' | 'EAS';
  driverSlot?: ShiftSlot;
  attendantSlot?: ShiftSlot;
}

/** Loads buddy preferences (UC-005 A3) — tolerant of the table being absent. */
async function loadBuddyMap(): Promise<BuddyMap> {
  const map: BuddyMap = new Map();
  try {
    const { data } = await supabaseAdmin
      .from('staff_preferences')
      .select('staff_id, buddy_staff_id')
      .not('buddy_staff_id', 'is', null);
    for (const row of (data ?? []) as Array<{ staff_id: number; buddy_staff_id: number }>) {
      if (row.buddy_staff_id != null) map.set(row.staff_id, row.buddy_staff_id);
    }
  } catch {
    // staff_preferences (or the buddy column) may not exist yet — soft signal only
  }
  return map;
}

export async function generateRoster(options: GenerateOptions): Promise<GenerateResult> {
  const { rosterDate, actorId, force = false, allowSkeleton = false } = options;
  const errors: string[] = [];
  let slotsCreated = 0;
  let assignmentsMade = 0;
  let flagsRaised = 0;
  let pairsFormed = 0;

  // Step 0: Retrieve the call-centre job list for the date (UC-002 step 1).
  // Deferred with NoJobListError when absent, unless the admin explicitly
  // asked for a skeleton roster (A1). Checked BEFORE touching the roster row
  // so a deferred run never wipes an existing draft.
  const { data: jobRows, error: jobsError } = await supabaseAdmin
    .from('jobs')
    .select('job_id, pickup_time, service_type')
    .eq('job_date', rosterDate);

  if (jobsError) {
    throw new Error(`Failed to read job list: ${jobsError.message}`);
  }

  const jobs = (jobRows ?? []) as JobRow[];
  const skeleton = jobs.length === 0;

  if (skeleton && !allowSkeleton) {
    throw new NoJobListError(rosterDate);
  }

  const weekendOrHoliday = isWeekendOrPublicHoliday(rosterDate);

  // Step 1: Create / reset roster row
  const rosterId = await upsertRoster(rosterDate, force);

  // Step 2: Fetch active ambulances
  const { data: allAmbulances, error: ambError } = await supabaseAdmin
    .from('ambulances')
    .select('ambulance_id, registration, service_type')
    .eq('status', 'active');

  if (ambError || !allAmbulances || allAmbulances.length === 0) {
    throw new Error('No active ambulances found for roster generation');
  }

  // Step 2b: Decide how many ambulances to run and which ones (UC-002 step 3).
  //   • Job-driven days: peak concurrent jobs sets the minimum fleet size.
  //   • Skeleton days: standard coverage — the whole active fleet.
  //   • Weekend / public holiday (A3): reduced to the 2-ambulance baseline.
  const easJobs = jobs.filter((j) => j.service_type === 'EAS').length;
  const mtsJobs = jobs.filter((j) => j.service_type === 'MTS').length;
  const peak = peakConcurrentJobs(jobs);

  let ambulancesNeeded = skeleton ? allAmbulances.length : Math.max(1, peak);
  if (weekendOrHoliday) {
    ambulancesNeeded = Math.min(ambulancesNeeded, WEEKEND_BASELINE_AMBULANCES);
    // The baseline always keeps two ambulances on the road for discharge + A&E.
    ambulancesNeeded = Math.max(
      Math.min(WEEKEND_BASELINE_AMBULANCES, allAmbulances.length),
      Math.min(ambulancesNeeded, allAmbulances.length)
    );
  }
  ambulancesNeeded = Math.min(ambulancesNeeded, allAmbulances.length);

  // Prefer ambulances whose service type matches the day's job mix: EAS demand
  // pulls EAS/both vehicles to the front, MTS demand pulls MTS/both.
  const coverageScore = (svc: string): number => {
    let score = 0;
    if (easJobs > 0 && (svc === 'EAS' || svc === 'both')) score += 2;
    if (mtsJobs > 0 && (svc === 'MTS' || svc === 'both')) score += 1;
    if (skeleton) score += svc === 'both' ? 1 : 0;
    return score;
  };
  const ambulances = [...allAmbulances]
    .sort(
      (a, b) =>
        coverageScore(b.service_type) - coverageScore(a.service_type) ||
        a.ambulance_id - b.ambulance_id
    )
    .slice(0, ambulancesNeeded);

  // Demand beyond the fleet cannot be covered — surface it immediately.
  if (!skeleton && peak > allAmbulances.length) {
    await raiseFlag(
      rosterId,
      null,
      null,
      'coverage_gap',
      'critical',
      `Job demand peaks at ${peak} concurrent job(s) but only ${allAmbulances.length} ambulance(s) are active on ${rosterDate}`
    );
    flagsRaised++;
  }

  // Step 3: Create shift slots
  const slotsToCreate: Omit<ShiftSlot, 'slot_id'>[] = [];

  for (const amb of ambulances) {
    const serviceTypes: Array<'MTS' | 'EAS'> =
      amb.service_type === 'both' ? ['MTS', 'EAS'] : [amb.service_type as 'MTS' | 'EAS'];

    for (const svcType of serviceTypes) {
      for (const position of ['driver', 'attendant'] as const) {
        // Day shift
        slotsToCreate.push({
          roster_id: rosterId,
          ambulance_id: amb.ambulance_id,
          start_time: DAY_SHIFT_START,
          end_time: DAY_SHIFT_END,
          service_type: svcType,
          crew_position: position,
        });
        // Night shift
        slotsToCreate.push({
          roster_id: rosterId,
          ambulance_id: amb.ambulance_id,
          start_time: NIGHT_SHIFT_START,
          end_time: NIGHT_SHIFT_END,
          service_type: svcType,
          crew_position: position,
        });
      }
    }
  }

  // Insert all slots
  const { data: insertedSlots, error: slotError } = await supabaseAdmin
    .from('shift_slots')
    .insert(slotsToCreate)
    .select('slot_id, roster_id, ambulance_id, start_time, end_time, service_type, crew_position');

  if (slotError || !insertedSlots) {
    throw new Error(`Failed to create shift slots: ${slotError?.message}`);
  }

  slotsCreated = insertedSlots.length;

  // Step 4: Group each ambulance/service/shift-window's driver + attendant slot
  // so they are crewed together as a proximity-compatible pair (UC-005).
  const groups = new Map<string, SlotGroup>();
  for (const slot of insertedSlots as ShiftSlot[]) {
    const key = `${slot.ambulance_id}|${slot.service_type}|${slot.start_time}`;
    const group = groups.get(key) ?? { key, service_type: slot.service_type };
    if (slot.crew_position === 'driver') group.driverSlot = slot;
    else group.attendantSlot = slot;
    groups.set(key, group);
  }

  // Fill the most constrained slots first: EAS can only be crewed by
  // drivers/paramedics, so crew EAS pairs before MTS to conserve scarce staff.
  const orderedGroups = [...groups.values()].sort((a, b) => {
    const rank = (s: string) => (s === 'EAS' ? 0 : 1);
    if (rank(a.service_type) !== rank(b.service_type)) return rank(a.service_type) - rank(b.service_type);
    return a.key.localeCompare(b.key);
  });

  const buddyMap = await loadBuddyMap();

  for (const group of orderedGroups) {
    try {
      const rankedDriversAll = group.driverSlot
        ? await rankedPoolForPosition(group.driverSlot, rosterDate, DRIVER_ROLES)
        : [];
      const rankedAttendantsAll = group.attendantSlot
        ? await rankedPoolForPosition(group.attendantSlot, rosterDate, ATTENDANT_ROLES)
        : [];

      // Management staff are overflow only (UC-002 A6): they never enter the
      // auto-assignment pools, but when a pool would otherwise be empty they
      // are named in the coverage-gap flag for the admin to deploy manually.
      const rankedDrivers = rankedDriversAll.filter((c) => !c.is_management);
      const mgmtDrivers = rankedDriversAll.filter((c) => c.is_management);
      const rankedAttendants = rankedAttendantsAll.filter((c) => !c.is_management);
      const mgmtAttendants = rankedAttendantsAll.filter((c) => c.is_management);

      const pair = pairCrew(rankedDrivers, rankedAttendants, buddyMap);

      // Soft flags an assigned crew member carries out of the UC-004 pipeline:
      // 7+ consecutive days, and a pre-noon start straight after a late shift.
      const raiseSoftFlags = async (
        slotId: number,
        member: RankedCandidate,
        positionLabel: string
      ): Promise<void> => {
        if (member.consecutive_days_flag) {
          await raiseFlag(
            rosterId,
            slotId,
            member.staff_id,
            'consecutive_days',
            'warning',
            `${positionLabel} ${member.full_name} has worked ${member.consecutive_days_count} consecutive days prior to ${rosterDate}`
          );
          flagsRaised++;
        }
        if (member.late_shift_rest_flag) {
          await raiseFlag(
            rosterId,
            slotId,
            member.staff_id,
            'rest_violation',
            'warning',
            `${positionLabel} ${member.full_name} starts before 12:00 on ${rosterDate} right after a late shift — recommend a later start (soft rule)`
          );
          flagsRaised++;
        }
      };

      // Assign the driver side
      if (group.driverSlot) {
        if (pair.driver) {
          const err = await assignStaffToSlot(group.driverSlot.slot_id, pair.driver);
          if (err) {
            errors.push(`Slot ${group.driverSlot.slot_id} (driver): ${err}`);
          } else {
            assignmentsMade++;
            await raiseSoftFlags(group.driverSlot.slot_id, pair.driver, 'Driver');
          }
        } else {
          await raiseFlag(
            rosterId,
            group.driverSlot.slot_id,
            null,
            'coverage_gap',
            'critical',
            coverageGapMessage('driver', group.driverSlot, mgmtDrivers)
          );
          flagsRaised++;
        }
      }

      // Assign the attendant side
      if (group.attendantSlot) {
        if (pair.attendant) {
          const err = await assignStaffToSlot(group.attendantSlot.slot_id, pair.attendant);
          if (err) {
            errors.push(`Slot ${group.attendantSlot.slot_id} (attendant): ${err}`);
          } else {
            assignmentsMade++;
            await raiseSoftFlags(group.attendantSlot.slot_id, pair.attendant, 'Attendant');
          }
        } else {
          await raiseFlag(
            rosterId,
            group.attendantSlot.slot_id,
            null,
            'coverage_gap',
            'critical',
            coverageGapMessage('attendant', group.attendantSlot, mgmtAttendants)
          );
          flagsRaised++;
        }
      }

      // UC-008 flag table: "Buddy preference not met" is informational only.
      if (pair.driver && pair.attendant && !pair.buddy_pair) {
        const driverBuddy = buddyMap.get(pair.driver.staff_id);
        const attendantBuddy = buddyMap.get(pair.attendant.staff_id);
        const unmetBuddy =
          (driverBuddy != null && driverBuddy !== pair.attendant.staff_id) ||
          (attendantBuddy != null && attendantBuddy !== pair.driver.staff_id);
        if (unmetBuddy) {
          await raiseFlag(
            rosterId,
            group.driverSlot?.slot_id ?? group.attendantSlot?.slot_id ?? null,
            pair.driver.staff_id,
            'other',
            'info',
            `Buddy preference not met on the ${group.service_type} ${group.driverSlot?.start_time ?? ''} shift — preferred partner was unavailable or ranked too low. No action required.`
          );
          flagsRaised++;
        }
      }

      // A crew pair that had to be formed across an unacceptable distance.
      if (pair.driver && pair.attendant) {
        pairsFormed++;
        if (pair.proximity_flag) {
          await raiseFlag(
            rosterId,
            group.driverSlot?.slot_id ?? group.attendantSlot?.slot_id ?? null,
            pair.driver.staff_id,
            'other',
            'info',
            `Proximity: ${pair.driver.full_name} and ${pair.attendant.full_name} live ~${pair.pair_distance_km ?? '?'}km apart (exceeds the pairing radius) on the ${group.service_type} ${group.driverSlot?.start_time ?? ''} shift`
          );
          flagsRaised++;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Group ${group.key}: ${msg}`);
    }
  }

  // Step 5: Audit log
  await logAudit({
    entity_type: 'rosters',
    entity_id: rosterId,
    action: 'generate',
    actor_id: actorId,
    details: {
      roster_date: rosterDate,
      slots_created: slotsCreated,
      assignments_made: assignmentsMade,
      pairs_formed: pairsFormed,
      flags_raised: flagsRaised,
      jobs_considered: jobs.length,
      ambulances_rostered: ambulances.length,
      skeleton,
      weekend_or_holiday: weekendOrHoliday,
    },
  });

  return {
    roster_id: rosterId,
    roster_date: rosterDate,
    slots_created: slotsCreated,
    assignments_made: assignmentsMade,
    flags_raised: flagsRaised,
    pairs_formed: pairsFormed,
    jobs_considered: jobs.length,
    ambulances_rostered: ambulances.length,
    skeleton,
    weekend_or_holiday: weekendOrHoliday,
    errors,
  };
}
