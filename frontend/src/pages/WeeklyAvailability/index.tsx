import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { addWeeks, startOfWeek, endOfWeek, eachDayOfInterval, format } from 'date-fns';
import { staffApi } from '../../api/staff';
import { availabilityApi } from '../../api/availability';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../hooks/useAuth';
import type { Staff, LeaveType } from '../../types';

// Each day may be set to one of these six states. The first three map to an
// availability record; the last three create a leave request. They collate
// into the same tables the Availability & Leave calendar reads from, so a
// submitted week shows up on the staff member's calendar automatically.
type DayStatus =
  | 'available'
  | 'unavailable'
  | 'partial'
  | 'leave_full'
  | 'leave_am'
  | 'leave_pm';

interface DaySelection {
  status: DayStatus | '';
  // Only relevant when status === 'partial' — which half they can work.
  partialHalf: 'am' | 'pm';
}

const STATUS_OPTIONS: { value: DayStatus; label: string; hint: string; active: string }[] = [
  { value: 'available', label: 'Available', hint: 'Full day', active: 'border-green-500 bg-green-50 text-green-700' },
  { value: 'unavailable', label: 'Unavailable', hint: 'Cannot work', active: 'border-red-500 bg-red-50 text-red-700' },
  { value: 'partial', label: 'Partial', hint: 'Part of the day', active: 'border-amber-500 bg-amber-50 text-amber-700' },
  { value: 'leave_full', label: 'Leave (full day)', hint: 'Off all day', active: 'border-red-500 bg-red-100 text-red-800' },
  { value: 'leave_am', label: 'Leave (half AM)', hint: 'Morning off', active: 'border-orange-500 bg-orange-50 text-orange-700' },
  { value: 'leave_pm', label: 'Leave (half PM)', hint: 'Afternoon off', active: 'border-amber-600 bg-amber-100 text-amber-800' },
];

const LEAVE_STATUSES: DayStatus[] = ['leave_full', 'leave_am', 'leave_pm'];
const LEAVE_TYPE_MAP: Record<string, LeaveType> = {
  leave_full: 'full_day',
  leave_am: 'half_am',
  leave_pm: 'half_pm',
};

export const WeeklyAvailability: React.FC = () => {
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();
  const { isAdmin, staffId: myStaffId } = useAuth();

  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<string>('');
  const [loadingStaff, setLoadingStaff] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<{ staff?: string; days?: string; reason?: string }>({});

  // The "following week" — next Monday through Sunday relative to today.
  const { weekStart, weekEnd, days } = useMemo(() => {
    const start = startOfWeek(addWeeks(new Date(), 1), { weekStartsOn: 1 });
    const end = endOfWeek(addWeeks(new Date(), 1), { weekStartsOn: 1 });
    return {
      weekStart: start,
      weekEnd: end,
      days: eachDayOfInterval({ start, end }),
    };
  }, []);

  const [selections, setSelections] = useState<Record<string, DaySelection>>(() =>
    Object.fromEntries(
      eachDayOfInterval({
        start: startOfWeek(addWeeks(new Date(), 1), { weekStartsOn: 1 }),
        end: endOfWeek(addWeeks(new Date(), 1), { weekStartsOn: 1 }),
      }).map((d) => [format(d, 'yyyy-MM-dd'), { status: '', partialHalf: 'am' } as DaySelection])
    )
  );

  // Load staff. Only full-time staff state weekly availability here. Employees
  // are locked to their own record; admins can submit for any full-timer.
  useEffect(() => {
    staffApi
      .list({ status: 'active' })
      .then((r) => {
        const fullTimers = r.data.filter((s) => s.employment_type === 'full_time');
        if (isAdmin) {
          setStaffList(fullTimers);
          if (fullTimers.length > 0) setSelectedStaffId(fullTimers[0].id);
        } else {
          const mine =
            myStaffId != null ? fullTimers.filter((s) => s.id === String(myStaffId)) : [];
          setStaffList(mine);
          if (mine.length > 0) setSelectedStaffId(mine[0].id);
        }
      })
      .catch(() => toastError('Failed to load staff list'))
      .finally(() => setLoadingStaff(false));
  }, [isAdmin, myStaffId, toastError]);

  const setDayStatus = (dateStr: string, status: DayStatus) => {
    setSelections((prev) => ({
      ...prev,
      [dateStr]: { ...prev[dateStr], status },
    }));
    setErrors((prev) => ({ ...prev, days: undefined, reason: undefined }));
  };

  const setDayHalf = (dateStr: string, partialHalf: 'am' | 'pm') => {
    setSelections((prev) => ({
      ...prev,
      [dateStr]: { ...prev[dateStr], partialHalf },
    }));
  };

  const hasLeave = Object.values(selections).some((s) => LEAVE_STATUSES.includes(s.status as DayStatus));
  const filledCount = Object.values(selections).filter((s) => s.status !== '').length;

  const validate = (): boolean => {
    const errs: typeof errors = {};
    if (!selectedStaffId) errs.staff = 'Select a staff member';
    if (filledCount === 0) errs.days = 'Set availability for at least one day';
    if (hasLeave && !reason.trim()) errs.reason = 'A reason is required when requesting leave';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);

    // Build one request per filled day. Availability days upsert; leave days
    // create a leave request. Run them all and collect per-day failures so one
    // bad day (e.g. a conflicting leave request) doesn't hide the rest.
    const tasks: { dateStr: string; run: () => Promise<unknown> }[] = [];
    for (const [dateStr, sel] of Object.entries(selections)) {
      if (!sel.status) continue;
      const status = sel.status as DayStatus;
      if (status === 'available') {
        tasks.push({ dateStr, run: () => availabilityApi.upsert({ staff_id: selectedStaffId, work_date: dateStr, is_available: true, half_day: null }) });
      } else if (status === 'unavailable') {
        tasks.push({ dateStr, run: () => availabilityApi.upsert({ staff_id: selectedStaffId, work_date: dateStr, is_available: false, half_day: null }) });
      } else if (status === 'partial') {
        tasks.push({ dateStr, run: () => availabilityApi.upsert({ staff_id: selectedStaffId, work_date: dateStr, is_available: true, half_day: sel.partialHalf }) });
      } else {
        const leave_type = LEAVE_TYPE_MAP[status];
        tasks.push({
          dateStr,
          run: () =>
            availabilityApi.createLeaveRequest({
              staff_id: selectedStaffId,
              leave_type,
              start_date: dateStr,
              end_date: dateStr,
              reason: reason.trim(),
            }),
        });
      }
    }

    const results = await Promise.allSettled(tasks.map((t) => t.run()));
    const failures = results
      .map((r, i) => ({ r, dateStr: tasks[i].dateStr }))
      .filter((x) => x.r.status === 'rejected');

    setSubmitting(false);

    if (failures.length === 0) {
      success('Availability submitted', `Saved ${tasks.length} day(s) for the week of ${format(weekStart, 'dd MMM')}.`);
      navigate('/availability');
      return;
    }

    const okCount = tasks.length - failures.length;
    const failedDays = failures.map((f) => format(new Date(f.dateStr), 'EEE dd MMM')).join(', ');
    const firstErr = failures[0].r as PromiseRejectedResult;
    const detail = firstErr.reason instanceof Error ? firstErr.reason.message : 'Some entries could not be saved';
    toastError(
      `Saved ${okCount}/${tasks.length} day(s)`,
      `Could not save: ${failedDays}. ${detail}`
    );
  };

  const selectedStaff = staffList.find((s) => s.id === selectedStaffId);

  return (
    <div className="max-w-screen-lg mx-auto px-4 py-6">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Weekly Availability</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Full-timers — state your availability for the following week
            {` (${format(weekStart, 'dd MMM')} – ${format(weekEnd, 'dd MMM yyyy')})`}
          </p>
        </div>
        <button type="button" onClick={() => navigate('/availability')} className="btn-secondary btn-sm">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Calendar
        </button>
      </div>

      <form onSubmit={handleSubmit} noValidate>
        <div className="card">
          <div className="card-body space-y-6">
            {/* Staff member (name to match with the database) */}
            <div className="form-group">
              <label className="label">Name *</label>
              {loadingStaff ? (
                <div className="py-2"><LoadingSpinner size="sm" /></div>
              ) : staffList.length === 0 ? (
                <p className="text-sm text-gray-500">No full-time staff available to select.</p>
              ) : (
                <select
                  value={selectedStaffId}
                  onChange={(e) => {
                    setSelectedStaffId(e.target.value);
                    setErrors((prev) => ({ ...prev, staff: undefined }));
                  }}
                  disabled={!isAdmin && staffList.length <= 1}
                  className={`input ${errors.staff ? 'input-error' : ''}`}
                >
                  <option value="">Select staff member...</option>
                  {staffList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} — {s.role}
                    </option>
                  ))}
                </select>
              )}
              {errors.staff && <p className="text-xs text-red-600 mt-1">{errors.staff}</p>}
              {selectedStaff && (
                <p className="text-xs text-gray-500 mt-1">Submitting availability for {selectedStaff.name}.</p>
              )}
            </div>

            {/* Per-day availability */}
            <div className="form-group">
              <label className="label">Availability for the following week *</label>
              {errors.days && <p className="text-xs text-red-600 mb-2">{errors.days}</p>}
              <div className="space-y-3">
                {days.map((day) => {
                  const dateStr = format(day, 'yyyy-MM-dd');
                  const sel = selections[dateStr];
                  return (
                    <div key={dateStr} className="rounded-xl border border-gray-200 p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{format(day, 'EEEE')}</p>
                          <p className="text-xs text-gray-500">{format(day, 'dd MMM yyyy')}</p>
                        </div>
                        {sel.status === 'partial' && (
                          <div className="flex items-center gap-1 text-xs">
                            <span className="text-gray-500 mr-1">Half:</span>
                            {(['am', 'pm'] as const).map((h) => (
                              <button
                                key={h}
                                type="button"
                                onClick={() => setDayHalf(dateStr, h)}
                                className={`px-2 py-1 rounded-md border font-medium uppercase ${
                                  sel.partialHalf === h
                                    ? 'border-amber-500 bg-amber-50 text-amber-700'
                                    : 'border-gray-200 text-gray-500 hover:border-gray-300'
                                }`}
                              >
                                {h}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {STATUS_OPTIONS.map((opt) => {
                          const isActive = sel.status === opt.value;
                          return (
                            <label
                              key={opt.value}
                              className={`flex flex-col items-start px-3 py-2 rounded-lg border-2 cursor-pointer transition-all ${
                                isActive ? opt.active : 'border-gray-200 hover:border-gray-300 text-gray-600'
                              }`}
                            >
                              <input
                                type="radio"
                                name={`day-${dateStr}`}
                                value={opt.value}
                                checked={isActive}
                                onChange={() => setDayStatus(dateStr, opt.value)}
                                className="sr-only"
                              />
                              <span className="text-sm font-semibold">{opt.label}</span>
                              <span className="text-[11px] opacity-70">{opt.hint}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Reason — required when any leave option is chosen */}
            {hasLeave && (
              <div className="form-group">
                <label className="label">Reason for leave *</label>
                <textarea
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                    setErrors((prev) => ({ ...prev, reason: undefined }));
                  }}
                  rows={2}
                  className={`input resize-none ${errors.reason ? 'input-error' : ''}`}
                  placeholder="e.g. Monday preplanned event, Tuesday going doctor..."
                />
                {errors.reason && <p className="text-xs text-red-600 mt-1">{errors.reason}</p>}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-gray-100">
            <span className="text-xs text-gray-500">{filledCount} of {days.length} days set</span>
            <div className="flex gap-3">
              <button type="button" onClick={() => navigate('/availability')} disabled={submitting} className="btn-secondary">
                Cancel
              </button>
              <button type="submit" disabled={submitting || staffList.length === 0} className="btn-primary">
                {submitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <LoadingSpinner size="sm" color="border-white" />
                    Submitting...
                  </span>
                ) : (
                  'Submit Availability'
                )}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
};
