// ─── Core Entity Types ───────────────────────────────────────────────────────

export type EmploymentType = 'full_time' | 'part_time';
export type StaffRole = 'driver' | 'medic' | 'emt' | 'paramedic';
export type StaffStatus = 'active' | 'inactive' | 'on_leave';

export interface Staff {
  id: string;
  name: string;
  phone: string;
  email: string;
  role: StaffRole;
  employment_type: EmploymentType;
  home_postal: string;
  /** Management staff (UC-002 A6): overflow only, never auto-assigned. */
  is_management?: boolean;
  status: StaffStatus;
  created_at: string;
  updated_at: string;
  certifications?: Certification[];
}

export interface Certification {
  id: string;
  staff_id: string;
  cert_name: string;
  cert_number?: string;
  issued_at: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

// UC-005 / UC-007 soft scheduling signals
export interface StaffPreferences {
  staff_id: string;
  prefers_early: boolean;
  prefers_late: boolean;
  buddy_staff_id: string | null;
}

// ─── Availability & Leave Types ───────────────────────────────────────────────

export type LeaveType = 'full_day' | 'half_am' | 'half_pm';
export type LeaveStatus = 'pending' | 'approved' | 'rejected';
export type AvailabilityStatus = 'available' | 'unavailable' | 'partial';

export interface LeaveRequest {
  id: string;
  staff_id: string;
  staff?: Staff;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  reason: string;
  status: LeaveStatus;
  reviewed_by?: string;
  reviewed_at?: string;
  review_notes?: string;
  created_at: string;
  updated_at: string;
}

export interface Availability {
  id: string;
  staff_id: string;
  staff?: Staff;
  date: string;
  status: AvailabilityStatus;
  start_time?: string;
  end_time?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

// ─── Roster & Scheduling Types ────────────────────────────────────────────────

export type JobType = 'MTS' | 'EAS';
export type ShiftStatus = 'scheduled' | 'active' | 'completed' | 'cancelled' | 'unfilled';
export type AssignmentStatus = 'assigned' | 'confirmed' | 'completed' | 'swapped' | 'dropped';

export interface Ambulance {
  id: string;
  call_sign: string;
  vehicle_number: string;
  type: JobType;
  status: 'active' | 'maintenance' | 'offline';
  created_at: string;
  updated_at: string;
}

export interface ShiftSlot {
  id: string;
  ambulance_id: string;
  ambulance?: Ambulance;
  shift_date: string;
  shift_start: string;
  shift_end: string;
  job_type: JobType;
  required_role: StaffRole;
  status: ShiftStatus;
  assignments?: Assignment[];
}

export interface Assignment {
  id: string;
  slot_id: string;
  slot?: ShiftSlot;
  staff_id: string;
  staff?: Staff;
  status: AssignmentStatus;
  swap_reason?: string;
  confirmed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface Roster {
  id: string;
  roster_date: string;
  published: boolean;
  published_at?: string;
  published_by?: string;
  slots: ShiftSlot[];
  created_at: string;
  updated_at: string;
}

// ─── Job Types ────────────────────────────────────────────────────────────────

export type JobStatus = 'pending' | 'dispatched' | 'en_route' | 'on_scene' | 'completed' | 'cancelled';

export interface Job {
  id: string;
  job_number: string;
  assignment_id?: string;
  assignment?: Assignment;
  job_type: JobType;
  status: JobStatus;
  dispatch_time?: string;
  pickup_address: string;
  destination_address?: string;
  patient_name?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

// ─── Exception / Flag Types ───────────────────────────────────────────────────

export type FlagSeverity = 'critical' | 'warning' | 'info';
export type FlagType = 'coverage_gap' | 'consecutive_days' | 'half_day_gap' | 'cert_mismatch' | 'rest_violation' | 'other';
export type FlagStatus = 'active' | 'resolved' | 'dismissed' | 'auto_resolved';

export interface ReplacementCandidate {
  staff_id: string;
  staff: Staff;
  score: number;
  current_load: number;
  rest_hours: number;
  flags: number;
  reason: string;
}

export interface Flag {
  id: string;
  flag_type: FlagType;
  severity: FlagSeverity;
  status: FlagStatus;
  title: string;
  description: string;
  affected_date: string;
  shift_start?: string;
  slot_id?: string;
  slot?: ShiftSlot;
  staff_id?: string;
  staff?: Staff;
  replacement_candidates?: ReplacementCandidate[];
  resolved_by?: string;
  resolved_at?: string;
  resolution_reason?: string;
  created_at: string;
  updated_at: string;
}

// ─── Audit Log ────────────────────────────────────────────────────────────────

export type AuditAction =
  | 'staff_created' | 'staff_updated' | 'staff_deactivated'
  | 'assignment_created' | 'assignment_swapped' | 'assignment_dropped'
  | 'leave_requested' | 'leave_approved' | 'leave_rejected'
  | 'flag_resolved' | 'flag_dismissed'
  | 'roster_published';

export interface AuditLog {
  id: string;
  action: AuditAction;
  entity_type: string;
  entity_id: string;
  actor_id: string;
  actor?: Staff;
  changes: Record<string, unknown>;
  notes?: string;
  created_at: string;
}

// ─── API Response Types ───────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data: T;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  per_page: number;
}

export interface ApiError {
  message: string;
  code?: string;
  details?: Record<string, string[]>;
}

// ─── Filter / Query Types ─────────────────────────────────────────────────────

export interface StaffFilters {
  search?: string;
  role?: StaffRole | '';
  status?: StaffStatus | '';
  employment_type?: EmploymentType | '';
}

export interface RosterFilters {
  date: string;
}

export interface FlagFilters {
  severity?: FlagSeverity | '';
  flag_type?: FlagType | '';
  status?: FlagStatus | '';
  date_from?: string;
  date_to?: string;
}

// ─── UI State Types ───────────────────────────────────────────────────────────

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message?: string;
}

export interface ConfirmDialogState {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info';
  onConfirm: () => void | Promise<void>;
}
