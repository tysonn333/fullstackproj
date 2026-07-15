/**
 * Roster Generator
 *
 * UC-001 / UC-002: Auto-generates a draft roster for a given date.
 *
 * Strategy:
 *   1. Create (or reuse draft) a roster row for the date.
 *   2. Fetch all ambulances in service on that date.
 *   3. For each ambulance generate four 6-hour shift slots (00:00–06:00, 06:00–12:00,
 *      12:00–18:00, 18:00–00:00) for each crew position (driver, attendant), respecting
 *      the ambulance service_type.
 *   4. For each slot, run the filter + ranking pipeline and auto-assign the top-ranked
 *      eligible candidate.
 *   5. Where no candidate is available, leave the slot unassigned and raise a coverage_gap flag.
 *   6. Raise consecutive_days flags for any assigned staff reaching >= 7 consecutive days.
 */

import supabaseAdmin from '../../lib/supabase';
import { getEligibleCandidates, ShiftSlot } from './filter';
import { rankCandidates } from './ranking';
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
  errors: string[];
}

// Four 6-hour blocks covering the full 24h day.
// Block 3 (18:00–00:00) uses end_time "00:00:00" which crosses midnight
// — the filter helpers (isOvernight, shiftDurationMinutes) handle this correctly.
const SHIFT_BLOCKS: Array<{ start: string; end: string; label: string }> = [
  { start: '00:00:00', end: '06:00:00', label: '00:00–06:00' },
  { start: '06:00:00', end: '12:00:00', label: '06:00–12:00' },
  { start: '12:00:00', end: '18:00:00', label: '12:00–18:00' },
  { start: '18:00:00', end: '00:00:00', label: '18:00–24:00' },
];

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

export async function generateRoster(options: GenerateOptions): Promise<GenerateResult> {
  const { rosterDate, actorId, force = false } = options;
  const errors: string[] = [];
  let slotsCreated = 0;
  let assignmentsMade = 0;
  let flagsRaised = 0;

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
        for (const block of SHIFT_BLOCKS) {
          slotsToCreate.push({
            roster_id: rosterId,
            ambulance_id: amb.ambulance_id,
            start_time: block.start,
            end_time: block.end,
            service_type: svcType,
            crew_position: position,
          });
        }
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

  // Step 4: Auto-assign for each slot
  for (const slot of insertedSlots as ShiftSlot[]) {
    try {
      const filterResults = await getEligibleCandidates(slot, rosterDate);
      const ranked = await rankCandidates(filterResults, slot, rosterDate);

      if (ranked.length === 0) {
        // No eligible candidates — raise coverage_gap flag
        await raiseFlag(
          rosterId,
          slot.slot_id,
          null,
          'coverage_gap',
          'critical',
          `No eligible staff for slot ${slot.slot_id} (${slot.service_type} ${slot.crew_position} ${slot.start_time}–${slot.end_time})`
        );
        flagsRaised++;
        continue;
      }

      const best = ranked[0];

      // Assign
      const { error: assignError } = await supabaseAdmin.from('assignments').insert({
        slot_id: slot.slot_id,
        staff_id: best.staff_id,
        score: best.score,
        status: 'assigned',
        assigned_at: new Date().toISOString(),
      });

      if (assignError) {
        errors.push(`Slot ${slot.slot_id}: ${assignError.message}`);
        continue;
      }

      assignmentsMade++;

      // Raise consecutive days soft flag if applicable
      if (best.consecutive_days_flag) {
        await raiseFlag(
          rosterId,
          slot.slot_id,
          best.staff_id,
          'consecutive_days',
          'warning',
          `Staff ${best.full_name} has worked ${best.consecutive_days_count} consecutive days prior to ${rosterDate}`
        );
        flagsRaised++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Slot ${slot.slot_id}: ${msg}`);
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
      flags_raised: flagsRaised,
    },
  });

  return {
    roster_id: rosterId,
    roster_date: rosterDate,
    slots_created: slotsCreated,
    assignments_made: assignmentsMade,
    flags_raised: flagsRaised,
    errors,
  };
}
