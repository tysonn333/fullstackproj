import apiClient from './client';
import type { Job, JobType } from '../types';

// The backend `jobs` table (docs/schema.sql) has columns:
//   job_id, job_date, pickup_time, service_type, pickup_loc, dropoff_loc, source.
// It exposes only GET /api/v1/jobs (list) and POST /api/v1/jobs/import.
// There is NO status column and NO PATCH /jobs/:id/status endpoint, so the old
// `updateStatus`, `get`, and `create` helpers were removed. No frontend page
// currently consumes jobsApi.

interface JobRow {
  job_id: number;
  job_date: string;
  pickup_time: string;
  service_type: JobType;
  pickup_loc: string | null;
  dropoff_loc: string | null;
  source: string;
  created_at: string;
}

function mapJob(row: JobRow): Job {
  return {
    id: String(row.job_id),
    job_number: String(row.job_id),
    job_type: row.service_type,
    status: 'pending',
    dispatch_time: row.pickup_time,
    pickup_address: row.pickup_loc ?? '',
    destination_address: row.dropoff_loc ?? undefined,
    created_at: row.created_at,
    updated_at: row.created_at,
  };
}

export const jobsApi = {
  list: async (filters?: {
    date?: string;
    from?: string;
    to?: string;
    service_type?: JobType;
    source?: string;
  }): Promise<Job[]> => {
    const params = new URLSearchParams();
    if (filters?.date) params.set('date', filters.date);
    if (filters?.from) params.set('from', filters.from);
    if (filters?.to) params.set('to', filters.to);
    if (filters?.service_type) params.set('service_type', filters.service_type);
    if (filters?.source) params.set('source', filters.source);
    const { data } = await apiClient.get<{ data: JobRow[] }>(`/api/v1/jobs?${params}`);
    return (data.data ?? []).map(mapJob);
  },

  import: async (
    jobs: Array<{
      job_date: string;
      pickup_time: string;
      service_type: JobType;
      pickup_loc: string;
      dropoff_loc: string;
      source?: string;
    }>
  ): Promise<{ imported: number; data: Job[] }> => {
    const { data } = await apiClient.post<{ imported: number; data: JobRow[] }>(
      '/api/v1/jobs/import',
      { jobs }
    );
    return { imported: data.imported ?? 0, data: (data.data ?? []).map(mapJob) };
  },

  /** Imports a raw call-centre CSV export (UC-002 job feed). */
  importRaw: async (raw: string): Promise<{ imported: number }> => {
    const { data } = await apiClient.post<{ imported: number }>('/api/v1/jobs/import', { raw });
    return { imported: data.imported ?? 0 };
  },
};
