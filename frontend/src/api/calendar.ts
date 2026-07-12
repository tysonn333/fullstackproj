import apiClient from './client';

/**
 * Calendar integration (UC-001 / UC-006 support).
 *
 * The .ics endpoints require the Supabase JWT, so we fetch them through the
 * authenticated axios client as text, wrap the body in a Blob, and trigger a
 * browser download. This lets an admin export a whole roster, or a staff
 * member their own shifts, into Google / Apple / Outlook calendars.
 */

function triggerDownload(icsText: string, filename: string): void {
  const blob = new Blob([icsText], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const calendarApi = {
  /** Downloads every crewed shift in a roster as an .ics file. */
  downloadRoster: async (rosterId: string, date: string): Promise<void> => {
    const { data } = await apiClient.get<string>(`/api/v1/roster/${rosterId}/calendar.ics`, {
      responseType: 'text',
    });
    triggerDownload(data, `efar-roster-${date}.ics`);
  },

  /** Downloads a single staff member's assigned shifts as an .ics file. */
  downloadStaffSchedule: async (staffId: string, staffName?: string): Promise<void> => {
    const { data } = await apiClient.get<string>(`/api/v1/staff/${staffId}/schedule.ics`, {
      responseType: 'text',
    });
    const safe = (staffName ?? staffId).replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    triggerDownload(data, `efar-${safe}-schedule.ics`);
  },
};
