import apiClient from './client';
import type { Roster, ShiftSlot, Assignment, Staff, Ambulance, JobType } from '../types';

// ─── Row types ────────────────────────────────────────────────────────────────

interface RosterRow {
  roster_id: number;
  roster_date: string;
  status: 'draft' | 'published' | 'locked';
  generated_at: string | null;
  published_at: string | null;
  published_by: string | null;
}

interface AssignmentRow {
  assignment_id: number;
  staff_id: number;
  score: number | null;
  status: string;
  assigned_at: string;
  staff?: {
    full_name?: string;
    role?: Staff['role'];
    employment_type?: Staff['employment_type'];
  } | null;
}

interface SlotRow {
  slot_id: number;
  roster_id: number;
  ambulance_id: number | null;
  start_time: string;
  end_time: string;
  service_type: string;
  crew_position: string;
  ambulances?: { registration?: string; service_type?: string } | null;
  assignments?: AssignmentRow[] | null;
}

interface RankedCandidateRow {
  staff_id: number;
  full_name: string;
  role: Staff['role'];
  eligible: boolean;
  hard_blocked: boolean;
  block_reason?: string;
  consecutive_days_flag: boolean;
  consecutive_days_count: number;
  score: number;
  rest_hours: number;
  late_shift_count: number;
}

interface ReplacementCandidate {
  staff: Staff;
  current_load: number;
  rest_hours: number;
  active_flags: number;
  score: number;
  reason: string;
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function mapRoster(row: RosterRow): Roster {
  return {
    id: String(row.roster_id),
    roster_date: row.roster_date,
    published: row.status !== 'draft',
    published_at: row.published_at ?? undefined,
    published_by: row.published_by ?? undefined,
    slots: [],
    created_at: row.generated_at ?? '',
    updated_at: row.published_at ?? row.generated_at ?? '',
  };
}

function mapAssignmentStatus(status: string): Assignment['status'] {
  if (status === 'cancelled') return 'dropped';
  return status as Assignment['status'];
}

function mapAmbulance(row: SlotRow): Ambulance | undefined {
  if (!row.ambulances) return undefined;
  const reg = row.ambulances.registration ?? '';
  return {
    id: row.ambulance_id != null ? String(row.ambulance_id) : '',
    call_sign: reg,
    vehicle_number: reg,
    type: (row.ambulances.service_type as Ambulance['type']) ?? 'MTS',
    status: 'active',
    created_at: '',
    updated_at: '',
  };
}

function mapNestedStaff(a: AssignmentRow): Staff | undefined {
  if (!a.staff?.full_name) return undefined;
  return {
    id: String(a.staff_id),
    name: a.staff.full_name,
    phone: '',
    email: '',
    role: a.staff.role ?? 'driver',
    employment_type: a.staff.employment_type ?? 'full_time',
    home_postal: '',
    status: 'active',
    created_at: '',
    updated_at: '',
  };
}

function mapAssignment(a: AssignmentRow, slotId: number): Assignment {
  return {
    id: String(a.assignment_id),
    slot_id: String(slotId),
    staff_id: String(a.staff_id),
    staff: mapNestedStaff(a),
    status: mapAssignmentStatus(a.status),
    created_at: a.assigned_at,
    updated_at: a.assigned_at,
  };
}

function mapSlot(row: SlotRow, rosterDate: string): ShiftSlot {
  const assignments = (row.assignments ?? [])
    .filter((a) => a.status !== 'cancelled')
    .map((a) => mapAssignment(a, row.slot_id));
  return {
    id: String(row.slot_id),
    ambulance_id: row.ambulance_id != null ? String(row.ambulance_id) : '',
    ambulance: mapAmbulance(row),
    shift_date: rosterDate,
    shift_start: row.start_time,
    shift_end: row.end_time,
    job_type: row.service_type as JobType,
    required_role: row.crew_position === 'driver' ? 'driver' : 'medic',
    status: assignments.length === 0 ? 'unfilled' : 'scheduled',
    assignments,
  };
}

function mapCandidate(c: RankedCandidateRow): ReplacementCandidate {
  const reason = c.block_reason
    ? c.block_reason
    : `${c.rest_hours}h rest · ${c.late_shift_count} late shift(s)` +
      (c.consecutive_days_flag ? ` · ${c.consecutive_days_count} consecutive days` : '');
  return {
    staff: {
      id: String(c.staff_id),
      name: c.full_name,
      phone: '',
      email: '',
      role: c.role,
      employment_type: 'full_time',
      home_postal: '',
      status: 'active',
      created_at: '',
      updated_at: '',
    },
    current_load: c.late_shift_count,
    rest_hours: c.rest_hours,
    active_flags: 0,
    score: c.score,
    reason,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getRosterByDate(date: string): Promise<RosterRow | null> {
  const { data } = await apiClient.get<{ data: RosterRow[] }>(`/api/v1/roster?date=${date}`);
  return data.data && data.data.length > 0 ? data.data[0] : null;
}

async function getRosterDateForSlot(slotId: string): Promise<string> {
  const { data } = await apiClient.get<{ roster_date: string }>(
    `/api/v1/slots/${slotId}/ranked`
  );
  return data.roster_date;
}

// ─── API ──────────────────────────────────────────────────────────────────────

export interface GenerationSummary {
  roster_id: number;
  roster_date: string;
  slots_created: number;
  assignments_made: number;
  flags_raised: number;
  errors: string[];
}

export const rosterApi = {
  getByDate: async (date: string): Promise<Roster | null> => {
    const roster = await getRosterByDate(date);
    return roster ? mapRoster(roster) : null;
  },

  /**
   * UC-002 — Auto-generate the roster for a date. Creates shift slots for every
   * in-service ambulance, runs the filter + ranking pipeline, auto-assigns the
   * best crew to each slot, and raises flags for any gaps. Pass force=true to
   * regenerate over an existing draft (wipes its slots/assignments/flags first).
   */
  generate: async (date: string, force = false): Promise<GenerationSummary> => {
    const { data } = await apiClient.post<{ data: GenerationSummary }>(
      '/api/v1/roster/generate',
      { date, force }
    );
    return data.data;
  },

  getSlots: async (date: string): Promise<ShiftSlot[]> => {
    const roster = await getRosterByDate(date);
    if (!roster) return [];
    const { data } = await apiClient.get<{ roster: RosterRow; slots: SlotRow[] }>(
      `/api/v1/roster/${roster.roster_id}/slots`
    );
    return (data.slots ?? []).map((s) => mapSlot(s, roster.roster_date));
  },

  publish: async (date: string): Promise<Roster> => {
    const roster = await getRosterByDate(date);
    if (!roster) throw new Error(`No roster found for ${date}`);
    const { data } = await apiClient.put<{ data: RosterRow }>(
      `/api/v1/roster/${roster.roster_id}/publish`
    );
    return mapRoster(data.data);
  },

  getReplacementCandidates: async (slotId: string): Promise<ReplacementCandidate[]> => {
    const { data } = await apiClient.get<{ ranked_candidates: RankedCandidateRow[] }>(
      `/api/v1/slots/${slotId}/ranked`
    );
    return (data.ranked_candidates ?? []).map(mapCandidate);
  },

  /**
   * Marks the currently-assigned staff on a slot as dropped. The backend has no
   * standalone "drop" endpoint — the cancellation of the previous assignment is
   * handled atomically by the reassign endpoint used in confirmSwap(). This is a
   * client-side acknowledgement so the UI can advance to candidate selection; its
   * return value is not consumed by the caller.
   */
  flagDropped: async (slotId: string, staffId: string, _reason?: string): Promise<Assignment> => {
    return {
      id: '',
      slot_id: slotId,
      staff_id: staffId,
      status: 'dropped',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  },

  confirmSwap: async (slotId: string, newStaffId: string, reason?: string): Promise<Assignment> => {
    const rosterDate = await getRosterDateForSlot(slotId);
    const roster = await getRosterByDate(rosterDate);
    if (!roster) throw new Error('Roster not found for slot');
    const { data } = await apiClient.post<{ data: AssignmentRow }>(
      `/api/v1/${roster.roster_id}/reassign`,
      {
        slot_id: Number(slotId),
        new_staff_id: Number(newStaffId),
        reason,
      }
    );
    return mapAssignment(data.data, Number(slotId));
  },
};
