import apiClient from './client';
import type { AuditLog, AuditFilters } from '../types';

export interface PaginatedAuditResponse {
  data: AuditLog[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}

export const auditApi = {
  list: async (filters?: AuditFilters): Promise<PaginatedAuditResponse> => {
    const params: Record<string, string> = {};
    if (filters?.entity_type) params.entity_type = filters.entity_type;
    if (filters?.action) params.action = filters.action;
    if (filters?.from) params.from = filters.from;
    if (filters?.to) params.to = filters.to;
    if (filters?.page) params.page = String(filters.page);
    if (filters?.limit) params.limit = String(filters.limit);

    const { data } = await apiClient.get<PaginatedAuditResponse>('/api/v1/audit', { params });
    return data;
  },

  undo: async (logId: number, reason?: string): Promise<void> => {
    await apiClient.post(`/api/v1/audit/${logId}/undo`, { reason });
  },
};
