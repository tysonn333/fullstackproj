import apiClient from './client';
import type { Job, JobStatus, JobType } from '../types';

export const jobsApi = {
  list: async (filters?: {
    status?: JobStatus;
    job_type?: JobType;
    date?: string;
    assignment_id?: string;
  }): Promise<Job[]> => {
    const params = new URLSearchParams();
    if (filters?.status) params.set('status', filters.status);
    if (filters?.job_type) params.set('job_type', filters.job_type);
    if (filters?.date) params.set('date', filters.date);
    if (filters?.assignment_id) params.set('assignment_id', filters.assignment_id);
    const { data } = await apiClient.get<{ data: Job[] }>(`/api/jobs?${params}`);
    return data.data;
  },

  get: async (id: string): Promise<Job> => {
    const { data } = await apiClient.get<{ data: Job }>(`/api/jobs/${id}`);
    return data.data;
  },

  create: async (payload: Omit<Job, 'id' | 'created_at' | 'updated_at'>): Promise<Job> => {
    const { data } = await apiClient.post<{ data: Job }>('/api/jobs', payload);
    return data.data;
  },

  updateStatus: async (id: string, status: JobStatus, notes?: string): Promise<Job> => {
    const { data } = await apiClient.patch<{ data: Job }>(`/api/jobs/${id}/status`, { status, notes });
    return data.data;
  },
};
