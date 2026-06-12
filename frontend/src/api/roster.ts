import apiClient from './client';
import type { Roster, ShiftSlot, Assignment, Staff } from '../types';

export const rosterApi = {
  getByDate: async (date: string): Promise<Roster | null> => {
    try {
      const { data } = await apiClient.get<{ data: Roster }>(`/api/roster?date=${date}`);
      return data.data;
    } catch (err: unknown) {
      if ((err as { response?: { status: number } }).response?.status === 404) return null;
      throw err;
    }
  },

  getSlots: async (date: string): Promise<ShiftSlot[]> => {
    const { data } = await apiClient.get<{ data: ShiftSlot[] }>(`/api/roster/slots?date=${date}`);
    return data.data;
  },

  publish: async (date: string): Promise<Roster> => {
    const { data } = await apiClient.post<{ data: Roster }>('/api/roster/publish', { date });
    return data.data;
  },

  getAssignment: async (slotId: string): Promise<Assignment | null> => {
    try {
      const { data } = await apiClient.get<{ data: Assignment }>(`/api/roster/slots/${slotId}/assignment`);
      return data.data;
    } catch {
      return null;
    }
  },

  flagDropped: async (slotId: string, staffId: string, reason?: string): Promise<Assignment> => {
    const { data } = await apiClient.patch<{ data: Assignment }>(
      `/api/roster/slots/${slotId}/drop`,
      { staff_id: staffId, reason }
    );
    return data.data;
  },

  confirmSwap: async (slotId: string, newStaffId: string, reason?: string): Promise<Assignment> => {
    const { data } = await apiClient.patch<{ data: Assignment }>(
      `/api/roster/slots/${slotId}/swap`,
      { new_staff_id: newStaffId, reason }
    );
    return data.data;
  },

  getReplacementCandidates: async (slotId: string): Promise<{
    staff: Staff;
    current_load: number;
    rest_hours: number;
    active_flags: number;
    score: number;
    reason: string;
  }[]> => {
    const { data } = await apiClient.get(`/api/roster/slots/${slotId}/candidates`);
    return data.data;
  },
};
