import React, { useState, useEffect, useCallback } from 'react';
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval,
  startOfWeek, endOfWeek, isSameMonth, isToday, parseISO
} from 'date-fns';
import { staffApi } from '../../api/staff';
import { availabilityApi } from '../../api/availability';
import { LeaveRequestForm } from './LeaveRequestForm';
import { AvailabilityForm } from './AvailabilityForm';
import { AdminApprovalPanel } from './AdminApprovalPanel';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../hooks/useAuth';
import type { Staff, LeaveRequest, Availability } from '../../types';

type TabType = 'calendar' | 'availability' | 'request' | 'admin';

const leaveTypeColors: Record<string, string> = {
  full_day: 'bg-red-200 text-red-800',
  half_am: 'bg-orange-200 text-orange-800',
  half_pm: 'bg-amber-200 text-amber-800',
};

const availabilityColors: Record<string, string> = {
  available: 'bg-green-100',
  unavailable: 'bg-red-100',
  partial: 'bg-amber-100',
};

export const AvailabilityLeave: React.FC = () => {
  const [tab, setTab] = useState<TabType>('calendar');
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<string>('');
  const [currentMonth, setCurrentMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [availability, setAvailability] = useState<Availability[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [loadingStaff, setLoadingStaff] = useState(true);
  const [loadingCalendar, setLoadingCalendar] = useState(false);
  const [loadingLeave, setLoadingLeave] = useState(false);

  const { error: toastError } = useToast();
  const { isAdmin, staffId: myStaffId, user } = useAuth();
  const myEmail = user?.email ?? null;

  // Load staff. Employees can only act on their own record, so lock the
  // selection to themselves; admins get the full list and pick anyone.
  useEffect(() => {
    staffApi.list({ status: 'active' })
      .then((r) => {
        if (isAdmin) {
          setStaffList(r.data);
          if (r.data.length > 0) setSelectedStaffId(r.data[0].id);
        } else {
          // Primary: the staff link resolved by the backend (/auth/me).
          // Fallback: match the login email against the staff list directly,
          // so an employee still sees THEIR record even if the profile link
          // hasn't resolved yet (e.g. database without profiles.staff_id).
          let mine = myStaffId != null
            ? r.data.filter((s) => s.id === String(myStaffId))
            : [];
          if (mine.length === 0 && myEmail) {
            mine = r.data.filter(
              (s) => s.email && s.email.toLowerCase() === myEmail.toLowerCase()
            );
          }
          setStaffList(mine);
          if (mine.length > 0) setSelectedStaffId(mine[0].id);
        }
      })
      .catch(() => toastError('Failed to load staff list'))
      .finally(() => setLoadingStaff(false));
  }, [toastError, isAdmin, myStaffId, myEmail]);

  // Load calendar data when staff / month changes
  const loadCalendar = useCallback(async () => {
    if (!selectedStaffId) return;
    setLoadingCalendar(true);
    try {
      const [avail, leaves] = await Promise.all([
        availabilityApi.getByStaff(selectedStaffId, currentMonth),
        availabilityApi.listLeaveRequests({
          staff_id: selectedStaffId,
          from: `${currentMonth}-01`,
          to: format(endOfMonth(parseISO(`${currentMonth}-01`)), 'yyyy-MM-dd'),
        }),
      ]);
      setAvailability(avail);
      setLeaveRequests(leaves);
    } catch {
      toastError('Failed to load calendar data');
    } finally {
      setLoadingCalendar(false);
    }
  }, [selectedStaffId, currentMonth, toastError]);

  useEffect(() => {
    if (tab === 'calendar') loadCalendar();
  }, [tab, loadCalendar]);

  // Load all pending leave requests for admin view
  const loadAllLeave = useCallback(async () => {
    setLoadingLeave(true);
    try {
      const reqs = await availabilityApi.listLeaveRequests();
      setLeaveRequests(reqs);
    } catch {
      toastError('Failed to load leave requests');
    } finally {
      setLoadingLeave(false);
    }
  }, [toastError]);

  useEffect(() => {
    if (tab === 'admin') loadAllLeave();
  }, [tab, loadAllLeave]);

  // Build calendar grid
  const monthStart = parseISO(`${currentMonth}-01`);
  const calendarStart = startOfWeek(startOfMonth(monthStart), { weekStartsOn: 1 });
  const calendarEnd = endOfWeek(endOfMonth(monthStart), { weekStartsOn: 1 });
  const calendarDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  const getDateInfo = (date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    const avail = availability.find((a) => a.date === dateStr);
    const leave = leaveRequests.find(
      (l) => l.status !== 'rejected' && l.start_date <= dateStr && l.end_date >= dateStr
    );
    return { avail, leave };
  };

  const selectedStaff = staffList.find((s) => s.id === selectedStaffId);

  // Employee whose login matches no staff record — tell them exactly what's
  // wrong instead of showing empty lists.
  const unlinkedNotice = !isAdmin && !loadingStaff && staffList.length === 0 && (
    <div className="mb-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
      Your login {myEmail ? <strong>{myEmail}</strong> : ''} isn&apos;t linked to a staff record yet.
      Ask an admin to add you in Staff Management with this exact email — the link happens
      automatically on your next sign-in.
    </div>
  );

  const handleLeaveCreated = (req: LeaveRequest) => {
    setLeaveRequests((prev) => [req, ...prev]);
    setTab('calendar');
  };

  const handleLeaveUpdated = (updated: LeaveRequest) => {
    setLeaveRequests((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  };

  const prevMonth = () => {
    const [y, m] = currentMonth.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    setCurrentMonth(format(d, 'yyyy-MM'));
  };

  const nextMonth = () => {
    const [y, m] = currentMonth.split('-').map(Number);
    const d = new Date(y, m, 1);
    setCurrentMonth(format(d, 'yyyy-MM'));
  };

  const [availabilityDate, setAvailabilityDate] = useState<string | undefined>(undefined);

  const handleAvailabilitySaved = () => {
    setTab('calendar');
    loadCalendar();
  };

  // Clicking a calendar day jumps to the form with that date pre-filled.
  const openAvailabilityFor = (dateStr: string) => {
    setAvailabilityDate(dateStr);
    setTab('availability');
  };

  const tabs: { id: TabType; label: string }[] = [
    { id: 'calendar', label: 'Availability Calendar' },
    { id: 'availability', label: 'Set Availability' },
    { id: 'request', label: 'Submit Leave Request' },
    // Approving leave is an admin action.
    ...(isAdmin ? [{ id: 'admin' as TabType, label: 'Admin Approvals' }] : []),
  ];

  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Availability & Leave</h1>
          <p className="text-gray-500 text-sm mt-0.5">UC-003 — Leave requests and availability management</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-gray-100 rounded-xl mb-5 w-fit">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === t.id
                ? 'bg-white text-blue-700 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {unlinkedNotice}

      {/* Calendar Tab */}
      {tab === 'calendar' && (
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5">
          {/* Left: Staff selector */}
          <div className="space-y-4">
            <div className="card">
              <div className="card-header">
                <h3 className="section-title text-sm">Staff Member</h3>
              </div>
              <div className="p-3 max-h-80 overflow-y-auto space-y-1">
                {loadingStaff ? (
                  <div className="flex justify-center py-4"><LoadingSpinner size="sm" /></div>
                ) : (
                  staffList.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setSelectedStaffId(s.id)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left ${
                        selectedStaffId === s.id
                          ? 'bg-blue-50 text-blue-700 font-medium'
                          : 'hover:bg-gray-50 text-gray-700'
                      }`}
                    >
                      <div className="w-7 h-7 bg-gray-200 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">
                        {s.name.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate">{s.name}</p>
                        <p className="text-xs opacity-60 capitalize">{s.role}</p>
                      </div>
                      {s.employment_type === 'part_time' && (
                        <span className="ml-auto badge-gray badge text-xs flex-shrink-0">PT</span>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* Legend */}
            <div className="card p-4">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-3">Legend</p>
              <div className="space-y-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-4 h-4 rounded bg-green-100 border border-green-200 flex-shrink-0" />
                  <span className="text-gray-600">Available</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-4 h-4 rounded bg-red-100 border border-red-200 flex-shrink-0" />
                  <span className="text-gray-600">Unavailable</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-4 h-4 rounded bg-amber-100 border border-amber-200 flex-shrink-0" />
                  <span className="text-gray-600">Partial availability</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-4 h-4 rounded bg-red-200 border border-red-300 flex-shrink-0" />
                  <span className="text-gray-600">Leave (full day)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-4 h-4 rounded bg-orange-200 border border-orange-300 flex-shrink-0" />
                  <span className="text-gray-600">Leave (half AM)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-4 h-4 rounded bg-amber-200 border border-amber-300 flex-shrink-0" />
                  <span className="text-gray-600">Leave (half PM)</span>
                </div>
              </div>
            </div>
          </div>

          {/* Calendar */}
          <div className="card">
            {/* Month nav */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <button onClick={prevMonth} className="btn-secondary btn-sm">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <div className="text-center">
                <p className="font-bold text-gray-900">{format(monthStart, 'MMMM yyyy')}</p>
                {selectedStaff && (
                  <p className="text-xs text-gray-500 mt-0.5">{selectedStaff.name}</p>
                )}
              </div>
              <button onClick={nextMonth} className="btn-secondary btn-sm">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>

            {loadingCalendar ? (
              <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
            ) : (
              <div className="p-4">
                {/* Day headers */}
                <div className="grid grid-cols-7 mb-2">
                  {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                    <div key={d} className="text-center text-xs font-semibold text-gray-500 py-1">{d}</div>
                  ))}
                </div>

                {/* Day cells */}
                <div className="grid grid-cols-7 gap-1">
                  {calendarDays.map((day) => {
                    const { avail, leave } = getDateInfo(day);
                    const inCurrentMonth = isSameMonth(day, monthStart);
                    const today = isToday(day);
                    const isWeekendDay = day.getDay() === 0 || day.getDay() === 6;

                    let bgClass = 'bg-white';
                    if (leave) bgClass = leaveTypeColors[leave.leave_type] || 'bg-red-200';
                    else if (avail) bgClass = availabilityColors[avail.status] || 'bg-white';
                    else if (isWeekendDay) bgClass = 'bg-gray-50';

                    // Half-day gap indicator
                    const isHalfDay = leave?.leave_type === 'half_am' || leave?.leave_type === 'half_pm';

                    return (
                      <button
                        type="button"
                        key={day.toISOString()}
                        onClick={() => openAvailabilityFor(format(day, 'yyyy-MM-dd'))}
                        title="Click to set availability for this day"
                        className={`
                          relative aspect-square rounded-lg flex flex-col items-center justify-start pt-1.5 px-1 text-xs
                          transition-all hover:ring-2 hover:ring-blue-300 cursor-pointer
                          ${inCurrentMonth ? 'opacity-100' : 'opacity-30'}
                          ${bgClass}
                          ${today ? 'ring-2 ring-blue-500' : 'border border-gray-100'}
                        `}
                      >
                        <span className={`font-semibold ${today ? 'text-blue-700' : inCurrentMonth ? 'text-gray-800' : 'text-gray-400'}`}>
                          {format(day, 'd')}
                        </span>
                        {leave && (
                          <div className="mt-0.5 w-full">
                            <span className="text-[9px] font-medium leading-tight block text-center truncate">
                              {leave.leave_type === 'full_day' ? 'Leave' : leave.leave_type === 'half_am' ? '▲ AM' : '▼ PM'}
                            </span>
                          </div>
                        )}
                        {isHalfDay && (
                          <div className="absolute bottom-0 left-0 right-0 h-1 bg-orange-400/40 rounded-b-lg" title="Half-day gap" />
                        )}
                        {avail?.status === 'partial' && !leave && (
                          <div className="mt-0.5 w-full">
                            <span className="text-[9px] text-amber-700 font-medium leading-tight block text-center truncate">
                              {avail.start_time && avail.end_time
                                ? `${avail.start_time}–${avail.end_time}`
                                : 'Partial'}
                            </span>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Leave list for this month */}
                {leaveRequests.filter(r => r.status !== 'rejected').length > 0 && (
                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Leave This Month</p>
                    <div className="space-y-1.5">
                      {leaveRequests.filter(r => r.status !== 'rejected').map((req) => (
                        <div key={req.id} className="flex items-center justify-between text-xs">
                          <span className="text-gray-700">
                            {format(parseISO(req.start_date), 'dd MMM')}
                            {req.start_date !== req.end_date && ` — ${format(parseISO(req.end_date), 'dd MMM')}`}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className={`badge ${leaveTypeColors[req.leave_type]} text-[10px]`}>
                              {req.leave_type.replace('_', ' ')}
                            </span>
                            <span className={`badge text-[10px] ${
                              req.status === 'approved' ? 'badge-green' :
                              req.status === 'pending' ? 'badge-yellow' : 'badge-red'
                            }`}>{req.status}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Set Availability Tab */}
      {tab === 'availability' && (
        <div className="max-w-2xl">
          <div className="card">
            <div className="card-header">
              <h3 className="section-title">Set Availability</h3>
              <p className="text-xs text-gray-500">Records feed directly into UC-004 eligibility filtering</p>
            </div>
            <div className="card-body">
              {loadingStaff ? (
                <div className="flex justify-center py-6"><LoadingSpinner size="md" /></div>
              ) : staffList.length === 0 ? (
                <p className="text-sm text-gray-500">No staff available.</p>
              ) : (
                <AvailabilityForm
                  staffList={staffList}
                  initialStaffId={selectedStaffId || undefined}
                  initialDate={availabilityDate}
                  onSaved={handleAvailabilitySaved}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Leave Request Form Tab */}
      {tab === 'request' && (
        <div className="max-w-lg">
          <div className="card">
            <div className="card-header">
              <h3 className="section-title">New Leave Request</h3>
            </div>
            <div className="card-body">
              <LeaveRequestForm
                staffList={staffList}
                onCreated={handleLeaveCreated}
              />
            </div>
          </div>
        </div>
      )}

      {/* Admin Approval Tab */}
      {tab === 'admin' && (
        <div className="max-w-2xl">
          <AdminApprovalPanel
            requests={leaveRequests}
            loading={loadingLeave}
            onUpdate={handleLeaveUpdated}
          />
        </div>
      )}
    </div>
  );
};
