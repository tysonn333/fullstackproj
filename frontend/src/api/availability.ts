import apiClient from './client';
import type { Availability, AvailabilityStatus, LeaveRequest, LeaveType, Staff } from '../types';

// ─── Row types ────────────────────────────────────────────────────────────────

interface AvailabilityRow {
  availability_id: number;
  staff_id: number;
  work_date: string;
  is_available: boolean;
  half_day: 'am' | 'pm' | null;
  start_time: string | null;
  end_time: string | null;
  source: string;
  created_at: string;
}

interface LeaveRow {
  leave_id: number;
  staff_id: number;
  start_date: string;
  end_date: string;
  leave_type: LeaveType;
  reason: string | null;
  status: LeaveRequest['status'];
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  staff?: { full_name: string; role: Staff['role'] } | null;
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function mapAvailability(row: AvailabilityRow): Availability {
  // "HH:MM:SS" → "HH:MM" for display.
  const start = row.start_time ? row.start_time.slice(0, 5) : undefined;
  const end = row.end_time ? row.end_time.slice(0, 5) : undefined;
  // A time window narrower than the whole day counts as partial availability,
  // as do legacy AM/PM-only rows (WhatsApp).
  const partialWindow = Boolean(start && end && !(start === '00:00' && end === '23:59'));
  let status: AvailabilityStatus;
  if (!row.is_available) status = 'unavailable';
  else if (partialWindow || row.half_day) status = 'partial';
  else status = 'available';
  return {
    id: String(row.availability_id),
    staff_id: String(row.staff_id),
    date: row.work_date,
    status,
    start_time: partialWindow ? start : row.half_day === 'am' ? '00:00' : row.half_day === 'pm' ? '12:00' : undefined,
    end_time: partialWindow ? end : row.half_day === 'am' ? '12:00' : row.half_day === 'pm' ? '23:59' : undefined,
    created_at: row.created_at,
    updated_at: row.created_at,
  };
}

function mapLeave(row: LeaveRow): LeaveRequest {
  return {
    id: String(row.leave_id),
    staff_id: String(row.staff_id),
    staff: row.staff
      ? ({
          id: String(row.staff_id),
          name: row.staff.full_name,
          role: row.staff.role,
        } as Staff)
      : undefined,
    leave_type: row.leave_type,
    start_date: row.start_date,
    end_date: row.end_date,
    reason: row.reason ?? '',
    status: row.status,
    reviewed_by: row.approved_by ?? undefined,
    reviewed_at: row.approved_at ?? undefined,
    created_at: row.created_at,
    updated_at: row.created_at,
  };
}

function lastDayOfMonth(month: string): string {
  // month = 'yyyy-MM'
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m, 0); // day 0 of next month → last day of this month
  const dd = String(d.getDate()).padStart(2, '0');
  return `${month}-${dd}`;
}

// ─── API ──────────────────────────────────────────────────────────────────────

export const availabilityApi = {
  // Availability
  getByStaff: async (staffId: string, month: string): Promise<Availability[]> => {
    const from = `${month}-01`;
    const to = lastDayOfMonth(month);
    const { data } = await apiClient.get<{ data: AvailabilityRow[] }>(
      `/api/v1/staff/${staffId}/availability?from=${from}&to=${to}`
    );
    return (data.data ?? []).map(mapAvailability);
  },

  upsert: async (payload: {
    staff_id: string;
    work_date: string;
    is_available: boolean;
    /** Available window "HH:MM" (e.g. 13:00–19:00); both null = whole day. */
    start_time?: string | null;
    end_time?: string | null;
  }): Promise<{ availability: Availability; flagsRaised: number }> => {
    const { data } = await apiClient.post<{ data: AvailabilityRow; flags_raised?: number }>(
      `/api/v1/staff/${payload.staff_id}/availability`,
      {
        work_date: payload.work_date,
        is_available: payload.is_available,
        start_time: payload.start_time ?? null,
        end_time: payload.end_time ?? null,
      }
    );
    // The backend raises coverage_gap / half_day_gap flags when a reduced
    // availability strands existing assignments (UC-003) — surface the count.
    return { availability: mapAvailability(data.data), flagsRaised: data.flags_raised ?? 0 };
  },

  // Leave Requests
  listLeaveRequests: async (params?: {
    staff_id?: string;
    status?: string;
    from?: string;
    to?: string;
  }): Promise<LeaveRequest[]> => {
    const qs = new URLSearchParams();
    if (params?.staff_id) qs.set('staff_id', params.staff_id);
    if (params?.status) qs.set('status', params.status);
    if (params?.from) qs.set('from', params.from);
    if (params?.to) qs.set('to', params.to);
    const { data } = await apiClient.get<{ data: LeaveRow[] }>(`/api/v1/leave?${qs}`);
    return (data.data ?? []).map(mapLeave);
  },

  createLeaveRequest: async (payload: {
    staff_id: string;
    leave_type: LeaveType;
    start_date: string;
    end_date: string;
    reason: string;
  }): Promise<LeaveRequest> => {
    const { data } = await apiClient.post<{ data: LeaveRow }>('/api/v1/leave', {
      staff_id: Number(payload.staff_id),
      leave_type: payload.leave_type,
      start_date: payload.start_date,
      end_date: payload.end_date,
      reason: payload.reason,
    });
    return mapLeave(data.data);
  },

  approveLeaveRequest: async (
    id: string,
    notes?: string
  ): Promise<{ request: LeaveRequest; conflictsCount: number; flagsRaised: number }> => {
    const { data } = await apiClient.put<{
      data: LeaveRow;
      conflicts_count?: number;
      flags_raised?: number;
    }>(`/api/v1/leave/${id}/approve`, { notes });
    // Approving leave can conflict with already-scheduled assignments; the
    // backend reports how many and how many flags it raised for the panel.
    return {
      request: mapLeave(data.data),
      conflictsCount: data.conflicts_count ?? 0,
      flagsRaised: data.flags_raised ?? 0,
    };
  },

  rejectLeaveRequest: async (id: string, notes?: string): Promise<LeaveRequest> => {
    const { data } = await apiClient.put<{ data: LeaveRow }>(`/api/v1/leave/${id}/reject`, {
      reason: notes,
    });
    return mapLeave(data.data);
  },
};
