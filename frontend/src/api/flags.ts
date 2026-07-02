import apiClient from './client';
import type { Flag, FlagFilters, FlagType, FlagStatus, PaginatedResponse, Staff } from '../types';

// ─── Row types ────────────────────────────────────────────────────────────────

interface FlagRow {
  flag_id: number;
  roster_id: number | null;
  slot_id: number | null;
  staff_id: number | null;
  flag_type: FlagType;
  severity: Flag['severity'];
  message: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  rosters?: { roster_date?: string; status?: string } | null;
  shift_slots?: {
    start_time?: string;
    end_time?: string;
    service_type?: string;
    crew_position?: string;
  } | null;
  staff?: { full_name?: string; role?: Staff['role'] } | null;
}

const FLAG_TYPE_LABELS: Record<string, string> = {
  coverage_gap: 'Coverage Gap',
  consecutive_days: 'Consecutive Days',
  half_day_gap: 'Half-Day Gap',
  cert_mismatch: 'Cert Mismatch',
  rest_violation: 'Rest Violation',
  other: 'Other',
};

function mapFlagStatus(status: string): FlagStatus {
  if (status === 'auto_resolved') return 'resolved';
  return status as FlagStatus;
}

function mapFlag(row: FlagRow): Flag {
  return {
    id: String(row.flag_id),
    flag_type: row.flag_type,
    severity: row.severity,
    status: mapFlagStatus(row.status),
    title: FLAG_TYPE_LABELS[row.flag_type] ?? row.flag_type,
    description: row.message,
    affected_date: row.rosters?.roster_date ?? (row.created_at ? row.created_at.slice(0, 10) : ''),
    shift_start: row.shift_slots?.start_time,
    slot_id: row.slot_id != null ? String(row.slot_id) : undefined,
    staff_id: row.staff_id != null ? String(row.staff_id) : undefined,
    staff: row.staff?.full_name
      ? ({
          id: row.staff_id != null ? String(row.staff_id) : '',
          name: row.staff.full_name,
          role: row.staff.role,
        } as Staff)
      : undefined,
    resolved_by: row.resolved_by ?? undefined,
    resolved_at: row.resolved_at ?? undefined,
    created_at: row.created_at,
    updated_at: row.resolved_at ?? row.created_at,
  };
}

// ─── API ──────────────────────────────────────────────────────────────────────

export const flagsApi = {
  list: async (filters?: FlagFilters): Promise<PaginatedResponse<Flag>> => {
    const params = new URLSearchParams();
    if (filters?.severity) params.set('severity', filters.severity);
    if (filters?.flag_type) params.set('flag_type', filters.flag_type);
    if (filters?.status) params.set('status', filters.status);
    const { data } = await apiClient.get<{ data: FlagRow[]; total: number }>(
      `/api/v1/flags?${params}`
    );
    let rows = (data.data ?? []).map(mapFlag);
    // Backend has no date filter — apply date_from/date_to client-side on affected_date.
    if (filters?.date_from) rows = rows.filter((f) => f.affected_date >= filters.date_from!);
    if (filters?.date_to) rows = rows.filter((f) => f.affected_date <= filters.date_to!);
    return { data: rows, total: rows.length, page: 1, per_page: rows.length };
  },

  getActive: async (): Promise<Flag[]> => {
    const { data } = await apiClient.get<{ data: FlagRow[] }>('/api/v1/flags?status=active');
    return (data.data ?? []).map(mapFlag);
  },

  getCount: async (): Promise<{ total: number; critical: number; warning: number; info: number }> => {
    const { data } = await apiClient.get<{ data: FlagRow[] }>('/api/v1/flags?status=active');
    const rows = data.data ?? [];
    return {
      total: rows.length,
      critical: rows.filter((f) => f.severity === 'critical').length,
      warning: rows.filter((f) => f.severity === 'warning').length,
      info: rows.filter((f) => f.severity === 'info').length,
    };
  },

  resolve: async (id: string, reason: string): Promise<Flag> => {
    const { data } = await apiClient.put<{ data: FlagRow }>(`/api/v1/flags/${id}/resolve`, {
      resolution_note: reason,
    });
    return mapFlag(data.data);
  },

  dismiss: async (id: string, reason: string): Promise<Flag> => {
    const { data } = await apiClient.put<{ data: FlagRow }>(`/api/v1/flags/${id}/dismiss`, {
      reason,
    });
    return mapFlag(data.data);
  },

  bulkResolve: async (ids: string[], reason: string): Promise<{ resolved: number }> => {
    const { data } = await apiClient.post<{ updated_count: number }>('/api/v1/flags/bulk-action', {
      flag_ids: ids.map(Number),
      action: 'resolve',
      reason,
    });
    return { resolved: data.updated_count ?? 0 };
  },

  bulkDismiss: async (ids: string[], reason: string): Promise<{ dismissed: number }> => {
    const { data } = await apiClient.post<{ updated_count: number }>('/api/v1/flags/bulk-action', {
      flag_ids: ids.map(Number),
      action: 'dismiss',
      reason,
    });
    return { dismissed: data.updated_count ?? 0 };
  },

  exportCsv: async (filters?: FlagFilters): Promise<Blob> => {
    const params = new URLSearchParams();
    params.set('format', 'csv');
    if (filters?.severity) params.set('severity', filters.severity);
    if (filters?.flag_type) params.set('flag_type', filters.flag_type);
    if (filters?.status) params.set('status', filters.status);
    const response = await apiClient.get(`/api/v1/flags/export?${params}`, {
      responseType: 'blob',
    });
    return response.data;
  },
};
