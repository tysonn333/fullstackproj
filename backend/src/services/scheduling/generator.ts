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
 *      coverage_gap flag; where no proximity-compatible pair exists, assign the
 *      best pair and raise a proximity flag.
 *   6. Raise consecutive_days flags for any assigned staff reaching >= 7 days.
 *
 * Constrained (EAS) ambulances are crewed first so scarce driver/paramedic
 * staff are not spent on MTS work that any role could cover.
 */

import supabaseAdmin from '../../lib/supabase';
import { getEligibleCandidates, ShiftSlot, FilterResult } from './filter';
import { rankCandidates, pairCrew, RankedCandidate } from './ranking';
import { logAudit } from '../audit.service';

interface GenerateOptions {
  rosterDate: string; // "YYYY-MM-DD"
  actorId: string;    // UUID of user triggering generation
  force?: boolean;    // If true, overwrites existing draft
}

interface GenerateResult {
  roster_id: number;
  roster_date: string;
  slots_created: number;
  assignments_made: number;
  flags_raised: number;
  pairs_formed: number;
  errors: string[];
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

export async function generateRoster(options: GenerateOptions): Promise<GenerateResult> {
  const { rosterDate, actorId, force = false } = options;
  const errors: string[] = [];
  let slotsCreated = 0;
  let assignmentsMade = 0;
  let flagsRaised = 0;
  let pairsFormed = 0;

  // Step 1: Create / reset roster row
  const rosterId = await upsertRoster(rosterDate, force);

  // Step 2: Fetch active ambulances
  const { data: ambulances, error: ambError } = await supabaseAdmin
    .from('ambulances')
    .select('ambulance_id, registration, service_type')
    .eq('status', 'active');

  if (ambError || !ambulances || ambulances.length === 0) {
    throw new Error('No active ambulances found for roster generation');
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

  for (const group of orderedGroups) {
    try {
      const rankedDrivers = group.driverSlot
        ? await rankedPoolForPosition(group.driverSlot, rosterDate, DRIVER_ROLES)
        : [];
      const rankedAttendants = group.attendantSlot
        ? await rankedPoolForPosition(group.attendantSlot, rosterDate, ATTENDANT_ROLES)
        : [];

      const pair = pairCrew(rankedDrivers, rankedAttendants);

      // Assign the driver side
      if (group.driverSlot) {
        if (pair.driver) {
          const err = await assignStaffToSlot(group.driverSlot.slot_id, pair.driver);
          if (err) {
            errors.push(`Slot ${group.driverSlot.slot_id} (driver): ${err}`);
          } else {
            assignmentsMade++;
            if (pair.driver.consecutive_days_flag) {
              await raiseFlag(
                rosterId,
                group.driverSlot.slot_id,
                pair.driver.staff_id,
                'consecutive_days',
                'warning',
                `Driver ${pair.driver.full_name} has worked ${pair.driver.consecutive_days_count} consecutive days prior to ${rosterDate}`
              );
              flagsRaised++;
            }
          }
        } else {
          await raiseFlag(
            rosterId,
            group.driverSlot.slot_id,
            null,
            'coverage_gap',
            'critical',
            `No eligible driver for ${group.service_type} slot ${group.driverSlot.slot_id} (${group.driverSlot.start_time}–${group.driverSlot.end_time})`
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
            if (pair.attendant.consecutive_days_flag) {
              await raiseFlag(
                rosterId,
                group.attendantSlot.slot_id,
                pair.attendant.staff_id,
                'consecutive_days',
                'warning',
                `Attendant ${pair.attendant.full_name} has worked ${pair.attendant.consecutive_days_count} consecutive days prior to ${rosterDate}`
              );
              flagsRaised++;
            }
          }
        } else {
          await raiseFlag(
            rosterId,
            group.attendantSlot.slot_id,
            null,
            'coverage_gap',
            'critical',
            `No eligible attendant for ${group.service_type} slot ${group.attendantSlot.slot_id} (${group.attendantSlot.start_time}–${group.attendantSlot.end_time})`
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
    },
  });

  return {
    roster_id: rosterId,
    roster_date: rosterDate,
    slots_created: slotsCreated,
    assignments_made: assignmentsMade,
    flags_raised: flagsRaised,
    pairs_formed: pairsFormed,
    errors,
  };
}
