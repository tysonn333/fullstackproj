import apiClient from './client';
import type { Flag, FlagFilters, PaginatedResponse } from '../types';

export const flagsApi = {
  list: async (filters?: FlagFilters): Promise<PaginatedResponse<Flag>> => {
    const params = new URLSearchParams();
    if (filters?.severity) params.set('severity', filters.severity);
    if (filters?.flag_type) params.set('flag_type', filters.flag_type);
    if (filters?.status) params.set('status', filters.status);
    if (filters?.date_from) params.set('date_from', filters.date_from);
    if (filters?.date_to) params.set('date_to', filters.date_to);
    const { data } = await apiClient.get<PaginatedResponse<Flag>>(`/api/flags?${params}`);
    return data;
  },

  getActive: async (): Promise<Flag[]> => {
    const { data } = await apiClient.get<{ data: Flag[] }>('/api/flags/active');
    return data.data;
  },

  getCount: async (): Promise<{ total: number; critical: number; warning: number; info: number }> => {
    const { data } = await apiClient.get('/api/flags/count');
    return data.data;
  },

  get: async (id: string): Promise<Flag> => {
    const { data } = await apiClient.get<{ data: Flag }>(`/api/flags/${id}`);
    return data.data;
  },

  resolve: async (id: string, reason: string): Promise<Flag> => {
    const { data } = await apiClient.patch<{ data: Flag }>(`/api/flags/${id}/resolve`, { reason });
    return data.data;
  },

  dismiss: async (id: string, reason: string): Promise<Flag> => {
    const { data } = await apiClient.patch<{ data: Flag }>(`/api/flags/${id}/dismiss`, { reason });
    return data.data;
  },

  bulkResolve: async (ids: string[], reason: string): Promise<{ resolved: number }> => {
    const { data } = await apiClient.post('/api/flags/bulk-resolve', { ids, reason });
    return data.data;
  },

  bulkDismiss: async (ids: string[], reason: string): Promise<{ dismissed: number }> => {
    const { data } = await apiClient.post('/api/flags/bulk-dismiss', { ids, reason });
    return data.data;
  },

  exportCsv: async (filters?: FlagFilters): Promise<Blob> => {
    const params = new URLSearchParams();
    if (filters?.severity) params.set('severity', filters.severity);
    if (filters?.flag_type) params.set('flag_type', filters.flag_type);
    if (filters?.status) params.set('status', filters.status);
    const response = await apiClient.get(`/api/flags/export?${params}`, {
      responseType: 'blob',
    });
    return response.data;
  },
};
