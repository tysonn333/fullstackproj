import apiClient from './client';
import type { Roster, ShiftSlot, Assignment, Staff, Ambulance, JobType } from '../types';
import type { ScoreBreakdown } from './engine';

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
    phone?: string | null;
    email?: string | null;
    home_postal?: string | null;
    status?: Staff['status'];
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
  // PostgREST embeds this as a single object (UNIQUE slot_id) or null, not an array.
  assignments?: AssignmentRow[] | AssignmentRow | null;
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
  late_shift_rest_flag?: boolean;
  score: number;
  rest_hours: number;
  late_shift_count: number;
  proximity_km?: number;
}

interface ReplacementCandidate {
  staff: Staff;
  current_load: number;
  rest_hours: number;
  active_flags: number;
  score: number;
  reason: string;
  proximity_km?: number;
}

// Full ranked candidate from GET /slots/:id/ranked (UC-005), including Guan
// Hee's 6-component score breakdown — powers the RosterView ranking modal.
interface RankedRow {
  staff_id: number;
  full_name: string;
  role: Staff['role'];
  employment_type?: Staff['employment_type'];
  home_postal?: string | null;
  score: number;
  score_breakdown: ScoreBreakdown;
  rest_hours: number;
  late_shift_count: number;
  proximity_km: number | null;
  consecutive_days_flag: boolean;
  consecutive_days_count: number;
  late_shift_rest_flag?: boolean;
}

export interface SlotCandidate {
  staff: Staff;
  score: number;
  score_breakdown: ScoreBreakdown;
  rest_hours: number;
  late_shift_count: number;
  /** null when the staff member's postal code is missing/unmappable. */
  proximity_km: number | null;
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
    phone: a.staff.phone ?? '',
    email: a.staff.email ?? '',
    role: a.staff.role ?? 'driver',
    employment_type: a.staff.employment_type ?? 'full_time',
    home_postal: a.staff.home_postal ?? '',
    status: a.staff.status ?? 'active',
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

function slotStatus(row: SlotRow, rosterDate: string, assignmentCount: number): ShiftSlot['status'] {
  if (assignmentCount === 0) return 'unfilled';
  const now = new Date();
  const start = new Date(`${rosterDate}T${row.start_time}`);
  const end = new Date(`${rosterDate}T${row.end_time}`);
  if (end <= start) end.setDate(end.getDate() + 1); // overnight shift
  if (now >= end) return 'completed';
  if (now >= start) return 'active';
  return 'scheduled';
}

function mapSlot(row: SlotRow, rosterDate: string): ShiftSlot {
  // Because assignments has a UNIQUE(slot_id) constraint, PostgREST embeds it
  // as a single object (or null) rather than an array — normalize to an array.
  const rawAssignments = Array.isArray(row.assignments)
    ? row.assignments
    : row.assignments
    ? [row.assignments]
    : [];
  const assignments = rawAssignments
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
    status: slotStatus(row, rosterDate, assignments.length),
    assignments,
  };
}

function mapCandidate(c: RankedCandidateRow): ReplacementCandidate {
  const reason = c.block_reason
    ? c.block_reason
    : `${c.rest_hours}h rest · ${c.late_shift_count} late shift(s)` +
      (c.consecutive_days_flag ? ` · ${c.consecutive_days_count} consecutive days` : '') +
      (c.late_shift_rest_flag ? ' · early start after late shift' : '');
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
    proximity_km: c.proximity_km,
  };
}

function mapSlotCandidate(c: RankedRow): SlotCandidate {
  return {
    staff: {
      id: String(c.staff_id),
      name: c.full_name,
      phone: '',
      email: '',
      role: c.role,
      employment_type: c.employment_type ?? 'full_time',
      home_postal: c.home_postal ?? '',
      status: 'active',
      created_at: '',
      updated_at: '',
    },
    score: c.score,
    score_breakdown: c.score_breakdown,
    rest_hours: c.rest_hours,
    late_shift_count: c.late_shift_count,
    proximity_km: c.proximity_km,
    reason:
      `${c.rest_hours}h rest` +
      (c.proximity_km != null ? ` · ${c.proximity_km}km from base` : '') +
      ` · ${c.late_shift_count} late shift(s)` +
      (c.consecutive_days_flag ? ` · ${c.consecutive_days_count} consecutive days` : '') +
      (c.late_shift_rest_flag ? ' · early start after late shift' : ''),
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
  pairs_formed?: number;
  jobs_considered?: number;
  ambulances_rostered?: number;
  skeleton?: boolean;
  weekend_or_holiday?: boolean;
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
  generate: async (date: string, force = false, allowSkeleton = false): Promise<GenerationSummary> => {
    const { data } = await apiClient.post<{ data: GenerationSummary }>(
      '/api/v1/roster/generate',
      { date, force, allow_skeleton: allowSkeleton }
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
   * Marks the currently-assigned staff on a slot as dropped by cancelling
   * their assignment. The subsequent confirmSwap() fills the slot again via
   * the reassign endpoint.
   */
  flagDropped: async (assignmentId: string, slotId: string): Promise<Assignment> => {
    const { data } = await apiClient.put<{ data: AssignmentRow }>(
      `/api/v1/assignments/${assignmentId}`,
      { status: 'cancelled' }
    );
    return mapAssignment(data.data, Number(slotId));
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

  /** Set of dates within [from, to] that have a roster — drives the calendar. */
  getRosterDatesInRange: async (from: string, to: string): Promise<Set<string>> => {
    const { data } = await apiClient.get<{ data: RosterRow[] }>(
      `/api/v1/roster?from=${from}&to=${to}`
    );
    return new Set((data.data ?? []).map((r) => r.roster_date));
  },

  /**
   * Ranked eligible candidates for a slot WITH the full 6-component score
   * breakdown (UC-005), for the RosterView assign/swap ranking modal.
   */
  getSlotCandidates: async (slotId: string): Promise<SlotCandidate[]> => {
    const { data } = await apiClient.get<{ ranked_candidates: RankedRow[] }>(
      `/api/v1/slots/${slotId}/ranked`
    );
    return (data.ranked_candidates ?? []).map(mapSlotCandidate);
  },

  /**
   * Assign a staff member to a slot from the RosterView. Works on DRAFT rosters
   * (unlike the published-only reassign flow): if the slot already has an active
   * occupant we swap via PUT /assignments/:id, otherwise we fill it via
   * POST /slots/:id/assign. Both are admin-gated on the backend.
   */
  assignToSlot: async (slot: ShiftSlot, staffId: string): Promise<void> => {
    const current = slot.assignments && slot.assignments.length > 0 ? slot.assignments[0] : null;
    if (current) {
      await apiClient.put(`/api/v1/assignments/${current.id}`, { staff_id: Number(staffId) });
    } else {
      await apiClient.post(`/api/v1/slots/${slot.id}/assign`, { staff_id: Number(staffId) });
    }
  },
};
