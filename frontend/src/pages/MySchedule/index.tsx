import React, { useState, useEffect } from 'react';
import { format, addDays, subDays, parseISO, isWeekend } from 'date-fns';
import { useAuth } from '../../hooks/useAuth';
import { meApi } from '../../api/me';
import { PageLoader } from '../../components/LoadingSpinner';
import { CrewGrid } from '../RosterView/CrewGrid';
import { StaffDetail } from '../RosterView/StaffDetail';
import type { ShiftSlot, Staff, JobType, StaffRole, EmploymentType, StaffStatus, AssignmentStatus, Assignment, Ambulance } from '../../types';

const SG_PUBLIC_HOLIDAYS = [
  '2026-01-01', '2026-02-17', '2026-02-18', '2026-03-21',
  '2026-04-03', '2026-05-01', '2026-05-27', '2026-06-01',
  '2026-08-10', '2026-11-09', '2026-12-25',
];

function mapAssignmentStatus(status: string): AssignmentStatus {
  if (status === 'cancelled') return 'dropped';
  return status as AssignmentStatus;
}

function mapMySlotToShiftSlot(
  slot: NonNullable<Awaited<ReturnType<typeof meApi.getRosterByDate>>>['slots'][number],
  rosterDate: string
): ShiftSlot {
  const assignments: Assignment[] = (slot.assignments ?? [])
    .filter((a) => a.status !== 'cancelled')
    .map((a) => ({
      id: String(a.assignment_id),
      slot_id: String(slot.slot_id),
      staff_id: String(a.staff_id),
      staff: a.staff?.full_name
        ? ({
            id: String(a.staff_id),
            name: a.staff.full_name,
            phone: a.staff.phone ?? '',
            email: a.staff.email ?? '',
            role: (a.staff.role ?? 'driver') as StaffRole,
            employment_type: (a.staff.employment_type ?? 'full_time') as EmploymentType,
            home_postal: a.staff.home_postal ?? '',
            status: (a.staff.status ?? 'active') as StaffStatus,
            created_at: '',
            updated_at: '',
          } as Staff)
        : undefined,
      status: mapAssignmentStatus(a.status),
      created_at: a.assigned_at,
      updated_at: a.assigned_at,
    }));

  const assignmentCount = assignments.length;
  const now = new Date();
  const start = new Date(`${rosterDate}T${slot.start_time}`);
  const end = new Date(`${rosterDate}T${slot.end_time}`);
  if (end <= start) end.setDate(end.getDate() + 1);
  const status: ShiftSlot['status'] =
    assignmentCount === 0
      ? 'unfilled'
      : now >= end
        ? 'completed'
        : now >= start
          ? 'active'
          : 'scheduled';

  const amb: Ambulance | undefined = slot.ambulances
    ? {
        id: slot.ambulance_id != null ? String(slot.ambulance_id) : '',
        call_sign: slot.ambulances.registration ?? '',
        vehicle_number: slot.ambulances.registration ?? '',
        type: (slot.ambulances.service_type as JobType) ?? 'MTS',
        status: 'active',
        created_at: '',
        updated_at: '',
      }
    : undefined;

  return {
    id: String(slot.slot_id),
    ambulance_id: slot.ambulance_id != null ? String(slot.ambulance_id) : '',
    ambulance: amb,
    shift_date: rosterDate,
    shift_start: slot.start_time,
    shift_end: slot.end_time,
    job_type: slot.service_type as JobType,
    required_role: slot.crew_position === 'driver' ? 'driver' : 'medic',
    status,
    assignments,
  };
}

export const MySchedule: React.FC = () => {
  const { profile } = useAuth();
  const staff = profile?.staff;

  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [rosterSlots, setRosterSlots] = useState<ShiftSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedStaff, setSelectedStaff] = useState<Staff | null>(null);

  const today = format(new Date(), 'yyyy-MM-dd');
  const isWeekendOrHoliday = isWeekend(parseISO(selectedDate)) || SG_PUBLIC_HOLIDAYS.includes(selectedDate);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const rosterData = await meApi.getRosterByDate(selectedDate);
        if (rosterData && rosterData.roster) {
          const mapped = (rosterData.slots ?? []).map((s) =>
            mapMySlotToShiftSlot(s, selectedDate)
          );
          setRosterSlots(mapped);
        } else {
          setRosterSlots([]);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to load roster';
        setError(msg);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [selectedDate]);

  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Schedule</h1>
          {staff && (
            <p className="text-gray-500 text-sm mt-1">
              {staff.full_name} &middot; {staff.role}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isWeekendOrHoliday && (
            <span className="badge-yellow badge text-xs">Weekend / PH</span>
          )}
          <button
            onClick={() => setSelectedDate(format(subDays(parseISO(selectedDate), 1), 'yyyy-MM-dd'))}
            className="btn-secondary btn-sm"
          >
            &larr; Prev
          </button>
          <span className="text-sm font-medium text-gray-700 min-w-[140px] text-center">
            {format(parseISO(selectedDate), 'EEEE, d MMM yyyy')}
            {isWeekendOrHoliday && (
              <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">
                {isWeekend(parseISO(selectedDate)) ? 'Weekend' : 'PH'}
              </span>
            )}
          </span>
          <button
            onClick={() => setSelectedDate(format(addDays(parseISO(selectedDate), 1), 'yyyy-MM-dd'))}
            className="btn-secondary btn-sm"
          >
            Next &rarr;
          </button>
          {selectedDate !== today && (
            <button
              onClick={() => setSelectedDate(today)}
              className="btn-secondary btn-sm"
            >
              Today
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <PageLoader label="Loading roster..." />
      ) : error ? (
        <div className="card p-6 text-center">
          <p className="text-red-600">{error}</p>
          <button onClick={() => window.location.reload()} className="btn-primary mt-4">
            Retry
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Stats bar */}
          {rosterSlots.length > 0 && (
            <div className="card">
              <div className="px-4 py-3 flex items-center gap-6 flex-wrap">
                <div className="flex items-center gap-1.5 text-sm">
                  <span className="w-2.5 h-2.5 bg-green-500 rounded-full" />
                  <span className="text-gray-600">
                    Active: <strong className="text-gray-900">{rosterSlots.filter(s => s.status === 'active').length}</strong>
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-sm">
                  <span className="w-2.5 h-2.5 bg-blue-500 rounded-full" />
                  <span className="text-gray-600">
                    Scheduled: <strong className="text-gray-900">{rosterSlots.filter(s => s.status === 'scheduled').length}</strong>
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-sm">
                  <span className="w-2.5 h-2.5 bg-amber-500 rounded-full" />
                  <span className="text-gray-600">
                    Unfilled: <strong className="text-gray-900">{rosterSlots.filter(s => s.status === 'unfilled').length}</strong>
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-sm">
                  <span className="w-2.5 h-2.5 bg-gray-400 rounded-full" />
                  <span className="text-gray-600">
                    Total slots: <strong className="text-gray-900">{rosterSlots.length}</strong>
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Crew Grid — read-only, no slot swapping */}
          {rosterSlots.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <p className="text-sm font-medium">No roster found for {selectedDate}</p>
            </div>
          ) : (
            <CrewGrid
              slots={rosterSlots}
              date={selectedDate}
              isReadOnly={false}
              isWeekendOrHoliday={isWeekendOrHoliday}
              onStaffClick={setSelectedStaff}
            />
          )}
        </div>
      )}

      {/* Staff detail modal */}
      {selectedStaff && (
        <StaffDetail
          staff={selectedStaff}
          onClose={() => setSelectedStaff(null)}
        />
      )}
    </div>
  );
};
