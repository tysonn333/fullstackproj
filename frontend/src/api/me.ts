import apiClient from './client';

interface MyAssignmentRow {
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

interface MyRosterSlot {
  slot_id: number;
  roster_id: number;
  ambulance_id: number | null;
  start_time: string;
  end_time: string;
  service_type: string;
  crew_position: string;
  ambulances?: { registration?: string; service_type?: string } | null;
  assignments?: {
    assignment_id: number;
    staff_id: number;
    score: number | null;
    status: string;
    assigned_at: string;
    staff?: {
      full_name?: string;
      role?: string;
      employment_type?: string;
      phone?: string | null;
      email?: string | null;
      home_postal?: string | null;
      status?: string;
    } | null;
  }[];
  is_my_slot: boolean;
}

export const meApi = {
  getSchedule: async (date: string): Promise<{ date: string; assignments: MyAssignmentRow[] }> => {
    const { data } = await apiClient.get<{ data: { date: string; assignments: MyAssignmentRow[] } }>(
      `/api/v1/me/schedule?date=${date}`
    );
    return data.data;
  },

  getTodayRoster: async (): Promise<{
    roster: { roster_id: number; roster_date: string; status: string } | null;
    slots: MyRosterSlot[];
    my_staff_id: number;
  } | null> => {
    const { data } = await apiClient.get<{
      data: {
        roster: { roster_id: number; roster_date: string; status: string };
        slots: MyRosterSlot[];
      } | null;
      my_staff_id: number;
    }>('/api/v1/me/roster/today');
    if (!data.data) return null;
    return { ...data.data, my_staff_id: data.my_staff_id };
  },

  getRosterByDate: async (date: string): Promise<{
    roster: { roster_id: number; roster_date: string; status: string } | null;
    slots: MyRosterSlot[];
    my_staff_id: number;
  } | null> => {
    const { data } = await apiClient.get<{
      data: {
        roster: { roster_id: number; roster_date: string; status: string };
        slots: MyRosterSlot[];
      } | null;
      my_staff_id: number;
    }>(`/api/v1/me/roster?date=${date}`);
    if (!data.data) return null;
    return { ...data.data, my_staff_id: data.my_staff_id };
  },
};
