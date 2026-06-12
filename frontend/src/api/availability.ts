import apiClient from './client';
import type { Availability, LeaveRequest, LeaveType } from '../types';

export const availabilityApi = {
  // Availability
  getByStaff: async (staffId: string, month: string): Promise<Availability[]> => {
    const { data } = await apiClient.get<{ data: Availability[] }>(
      `/api/availability?staff_id=${staffId}&month=${month}`
    );
    return data.data;
  },

  upsert: async (payload: Omit<Availability, 'id' | 'created_at' | 'updated_at'>): Promise<Availability> => {
    const { data } = await apiClient.post<{ data: Availability }>('/api/availability', payload);
    return data.data;
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
    const { data } = await apiClient.get<{ data: LeaveRequest[] }>(`/api/leave-requests?${qs}`);
    return data.data;
  },

  createLeaveRequest: async (payload: {
    staff_id: string;
    leave_type: LeaveType;
    start_date: string;
    end_date: string;
    reason: string;
  }): Promise<LeaveRequest> => {
    const { data } = await apiClient.post<{ data: LeaveRequest }>('/api/leave-requests', payload);
    return data.data;
  },

  approveLeaveRequest: async (id: string, notes?: string): Promise<LeaveRequest> => {
    const { data } = await apiClient.patch<{ data: LeaveRequest }>(`/api/leave-requests/${id}/approve`, { notes });
    return data.data;
  },

  rejectLeaveRequest: async (id: string, notes?: string): Promise<LeaveRequest> => {
    const { data } = await apiClient.patch<{ data: LeaveRequest }>(`/api/leave-requests/${id}/reject`, { notes });
    return data.data;
  },

  deleteLeaveRequest: async (id: string): Promise<void> => {
    await apiClient.delete(`/api/leave-requests/${id}`);
  },
};
