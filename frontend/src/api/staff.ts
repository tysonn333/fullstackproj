import apiClient from './client';
import type { Staff, Certification, StaffFilters, PaginatedResponse } from '../types';

export const staffApi = {
  list: async (filters?: StaffFilters): Promise<PaginatedResponse<Staff>> => {
    const params = new URLSearchParams();
    if (filters?.search) params.set('search', filters.search);
    if (filters?.role) params.set('role', filters.role);
    if (filters?.status) params.set('status', filters.status);
    if (filters?.employment_type) params.set('employment_type', filters.employment_type);
    const { data } = await apiClient.get<PaginatedResponse<Staff>>(`/api/staff?${params}`);
    return data;
  },

  get: async (id: string): Promise<Staff> => {
    const { data } = await apiClient.get<{ data: Staff }>(`/api/staff/${id}`);
    return data.data;
  },

  create: async (payload: Omit<Staff, 'id' | 'created_at' | 'updated_at' | 'certifications'>): Promise<Staff> => {
    const { data } = await apiClient.post<{ data: Staff }>('/api/staff', payload);
    return data.data;
  },

  update: async (id: string, payload: Partial<Omit<Staff, 'id' | 'created_at' | 'updated_at'>>): Promise<Staff> => {
    const { data } = await apiClient.patch<{ data: Staff }>(`/api/staff/${id}`, payload);
    return data.data;
  },

  deactivate: async (id: string): Promise<Staff> => {
    const { data } = await apiClient.patch<{ data: Staff }>(`/api/staff/${id}/deactivate`);
    return data.data;
  },

  // Certifications
  getCertifications: async (staffId: string): Promise<Certification[]> => {
    const { data } = await apiClient.get<{ data: Certification[] }>(`/api/staff/${staffId}/certifications`);
    return data.data;
  },

  addCertification: async (
    staffId: string,
    payload: Omit<Certification, 'id' | 'staff_id' | 'created_at' | 'updated_at'>
  ): Promise<Certification> => {
    const { data } = await apiClient.post<{ data: Certification }>(`/api/staff/${staffId}/certifications`, payload);
    return data.data;
  },

  removeCertification: async (staffId: string, certId: string): Promise<void> => {
    await apiClient.delete(`/api/staff/${staffId}/certifications/${certId}`);
  },

  getWeeklySchedule: async (staffId: string, weekStart: string): Promise<{
    assignments: import('../types').Assignment[];
    total_hours: number;
    consecutive_days: number;
  }> => {
    const { data } = await apiClient.get(`/api/staff/${staffId}/schedule?week_start=${weekStart}`);
    return data.data;
  },
};
