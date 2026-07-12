import apiClient from './client';
import type {
  Staff,
  Certification,
  StaffFilters,
  StaffPreferences,
  PaginatedResponse,
  Assignment,
  JobType,
} from '../types';

export interface ExpiringCert {
  cert_id: number;
  staff_id: number;
  staff_name: string;
  staff_role: string;
  cert_name: string;
  expiry_date: string;
  expired: boolean;
  days_to_expiry: number;
}

export interface MarkUnavailableResult {
  staff_id: number;
  date: string;
  assignments_cancelled: number;
  flags_raised: number;
  affected_slots: Array<{
    slot_id: number;
    start_time: string;
    end_time: string;
    service_type: string;
    crew_position: string;
  }>;
}

// ─── Row types (raw Supabase rows returned by the backend) ────────────────────

interface StaffRow {
  staff_id: number;
  full_name: string;
  phone: string | null;
  email: string | null;
  role: Staff['role'];
  employment_type: Staff['employment_type'];
  home_postal: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  staff_certifications?: CertRow[];
}

interface CertRow {
  cert_id: number;
  staff_id: number;
  cert_name: string;
  issued_date: string | null;
  expiry_date: string | null;
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

export function mapStaff(row: StaffRow): Staff {
  return {
    id: String(row.staff_id),
    name: row.full_name,
    phone: row.phone ?? '',
    email: row.email ?? '',
    role: row.role,
    employment_type: row.employment_type,
    home_postal: row.home_postal ?? '',
    status: row.status as Staff['status'],
    created_at: row.created_at,
    updated_at: row.updated_at,
    certifications: row.staff_certifications
      ? row.staff_certifications.map(mapCert)
      : undefined,
  };
}

function mapCert(row: CertRow): Certification {
  return {
    id: String(row.cert_id),
    staff_id: String(row.staff_id),
    cert_name: row.cert_name,
    cert_number: undefined,
    issued_at: row.issued_date ?? '',
    expires_at: row.expiry_date ?? '',
    created_at: '',
    updated_at: '',
  };
}

// ─── API ──────────────────────────────────────────────────────────────────────

export const staffApi = {
  list: async (filters?: StaffFilters): Promise<PaginatedResponse<Staff>> => {
    const params = new URLSearchParams();
    if (filters?.search) params.set('search', filters.search);
    if (filters?.role) params.set('role', filters.role);
    if (filters?.status) params.set('status', filters.status);
    if (filters?.employment_type) params.set('employment_type', filters.employment_type);
    const { data } = await apiClient.get<{ data: StaffRow[] }>(`/api/v1/staff?${params}`);
    const rows = (data.data ?? []).map(mapStaff);
    return { data: rows, total: rows.length, page: 1, per_page: rows.length };
  },

  get: async (id: string): Promise<Staff> => {
    const { data } = await apiClient.get<{ data: StaffRow }>(`/api/v1/staff/${id}`);
    return mapStaff(data.data);
  },

  create: async (
    payload: Omit<Staff, 'id' | 'created_at' | 'updated_at' | 'certifications'>
  ): Promise<Staff> => {
    const body = {
      full_name: payload.name,
      phone: payload.phone,
      email: payload.email,
      role: payload.role,
      employment_type: payload.employment_type,
      home_postal: payload.home_postal,
    };
    const { data } = await apiClient.post<{ data: StaffRow }>('/api/v1/staff', body);
    return mapStaff(data.data);
  },

  update: async (
    id: string,
    payload: Partial<Omit<Staff, 'id' | 'created_at' | 'updated_at'>>
  ): Promise<Staff> => {
    const body: Record<string, unknown> = {};
    if (payload.name !== undefined) body.full_name = payload.name;
    if (payload.phone !== undefined) body.phone = payload.phone;
    if (payload.email !== undefined) body.email = payload.email;
    if (payload.role !== undefined) body.role = payload.role;
    if (payload.employment_type !== undefined) body.employment_type = payload.employment_type;
    if (payload.home_postal !== undefined) body.home_postal = payload.home_postal;
    if (payload.status !== undefined) body.status = payload.status;
    const { data } = await apiClient.put<{ data: StaffRow }>(`/api/v1/staff/${id}`, body);
    return mapStaff(data.data);
  },

  deactivate: async (id: string): Promise<Staff> => {
    const { data } = await apiClient.delete<{ data: StaffRow }>(`/api/v1/staff/${id}`);
    return mapStaff(data.data);
  },

  // Certifications
  getCertifications: async (staffId: string): Promise<Certification[]> => {
    const { data } = await apiClient.get<{ data: CertRow[] }>(
      `/api/v1/staff/${staffId}/certifications`
    );
    return (data.data ?? []).map(mapCert);
  },

  addCertification: async (
    staffId: string,
    payload: Omit<Certification, 'id' | 'staff_id' | 'created_at' | 'updated_at'>
  ): Promise<Certification> => {
    const body = {
      cert_name: payload.cert_name,
      issued_date: payload.issued_at,
      expiry_date: payload.expires_at,
    };
    const { data } = await apiClient.post<{ data: CertRow }>(
      `/api/v1/staff/${staffId}/certifications`,
      body
    );
    return mapCert(data.data);
  },

  removeCertification: async (staffId: string, certId: string): Promise<void> => {
    await apiClient.delete(`/api/v1/staff/${staffId}/certifications/${certId}`);
  },

  // Preferences (UC-005 / UC-007 soft signals)
  getPreferences: async (staffId: string): Promise<StaffPreferences> => {
    const { data } = await apiClient.get<{
      data: { staff_id: number; prefers_early: boolean; prefers_late: boolean; buddy_staff_id: number | null };
    }>(`/api/v1/staff/${staffId}/preferences`);
    return {
      staff_id: String(data.data.staff_id),
      prefers_early: data.data.prefers_early,
      prefers_late: data.data.prefers_late,
      buddy_staff_id: data.data.buddy_staff_id != null ? String(data.data.buddy_staff_id) : null,
    };
  },

  updatePreferences: async (
    staffId: string,
    prefs: { prefers_early: boolean; prefers_late: boolean; buddy_staff_id: string | null }
  ): Promise<void> => {
    await apiClient.put(`/api/v1/staff/${staffId}/preferences`, {
      prefers_early: prefs.prefers_early,
      prefers_late: prefs.prefers_late,
      buddy_staff_id: prefs.buddy_staff_id != null ? Number(prefs.buddy_staff_id) : null,
    });
  },

  // UC-006 A3 — staff absent for the whole day
  markUnavailable: async (
    staffId: string,
    date: string,
    reason?: string
  ): Promise<MarkUnavailableResult> => {
    const { data } = await apiClient.post<MarkUnavailableResult>(
      `/api/v1/staff/${staffId}/mark-unavailable`,
      { date, reason }
    );
    return data;
  },

  // UC-007 A1 — certification expiry alerts
  getExpiringCerts: async (days = 30): Promise<ExpiringCert[]> => {
    const { data } = await apiClient.get<{ data: ExpiringCert[] }>(
      `/api/v1/staff/expiring-certs?days=${days}`
    );
    return data.data ?? [];
  },

  getWeeklySchedule: async (
    staffId: string,
    weekStart: string
  ): Promise<{
    assignments: Assignment[];
    total_hours: number;
    consecutive_days: number;
  }> => {
    const { data } = await apiClient.get<{
      data: {
        assignments: WeeklyAssignmentRow[];
        total_hours: number;
        consecutive_days: number;
      };
    }>(`/api/v1/staff/${staffId}/schedule?week_start=${weekStart}`);
    return {
      assignments: (data.data.assignments ?? []).map(mapWeeklyAssignment),
      total_hours: data.data.total_hours,
      consecutive_days: data.data.consecutive_days,
    };
  },
};

// ─── Weekly-schedule assignment mapping ───────────────────────────────────────

interface WeeklyAssignmentRow {
  assignment_id: number;
  slot_id: number;
  staff_id: number;
  status: string;
  assigned_at: string;
  shift_slots?: {
    slot_id: number;
    ambulance_id: number | null;
    start_time: string;
    end_time: string;
    service_type: string;
    crew_position: string;
    rosters?: { roster_date: string };
  };
}

function mapAssignmentStatus(status: string): Assignment['status'] {
  if (status === 'cancelled') return 'dropped';
  return status as Assignment['status'];
}

function mapWeeklyAssignment(row: WeeklyAssignmentRow): Assignment {
  const slot = row.shift_slots;
  return {
    id: String(row.assignment_id),
    slot_id: String(row.slot_id),
    staff_id: String(row.staff_id),
    status: mapAssignmentStatus(row.status),
    created_at: row.assigned_at,
    updated_at: row.assigned_at,
    slot: slot
      ? {
          id: String(slot.slot_id),
          ambulance_id: slot.ambulance_id != null ? String(slot.ambulance_id) : '',
          shift_date: slot.rosters?.roster_date ?? '',
          shift_start: slot.start_time,
          shift_end: slot.end_time,
          job_type: slot.service_type as JobType,
          required_role: slot.crew_position === 'driver' ? 'driver' : 'medic',
          status: 'scheduled',
        }
      : undefined,
  };
}
