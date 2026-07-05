import React, { useState, useEffect, useCallback } from 'react';
import { format, addDays, subDays, isWeekend, parseISO } from 'date-fns';
import { rosterApi } from '../../api/roster';
import { flagsApi } from '../../api/flags';
import { CrewGrid } from './CrewGrid';
import { StaffDetail } from './StaffDetail';
import { PageLoader } from '../../components/LoadingSpinner';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import type { ShiftSlot, Staff, Flag, Roster } from '../../types';

// Singapore public holidays (simplified list - would come from API in production)
const SG_PUBLIC_HOLIDAYS_2024 = [
  '2024-01-01', '2024-02-10', '2024-02-11', '2024-03-29',
  '2024-04-10', '2024-05-01', '2024-05-22', '2024-05-23',
  '2024-06-17', '2024-08-09', '2024-10-31', '2024-12-25',
];

export const RosterView: React.FC = () => {
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [slots, setSlots] = useState<ShiftSlot[]>([]);
  const [roster, setRoster] = useState<Roster | null>(null);
  const [activeFlags, setActiveFlags] = useState<Flag[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedStaff, setSelectedStaff] = useState<Staff | null>(null);

  const { error: toastError, success: toastSuccess } = useToast();
  const { confirm } = useConfirm();

  const today = format(new Date(), 'yyyy-MM-dd');
  const isReadOnly = selectedDate < today;
  const isWeekendOrHoliday = isWeekend(parseISO(selectedDate)) || SG_PUBLIC_HOLIDAYS_2024.includes(selectedDate);

  const loadRoster = useCallback(async (date: string) => {
    setLoading(true);
    setError(null);
    try {
      const [slotsData, rosterData, flagsData] = await Promise.all([
        rosterApi.getSlots(date),
        rosterApi.getByDate(date),
        flagsApi.list({ status: 'active', date_from: date, date_to: date }),
      ]);
      setSlots(slotsData);
      setRoster(rosterData);
      setActiveFlags(flagsData.data || []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load roster';
      setError(msg);
      toastError('Load failed', msg);
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  useEffect(() => {
    loadRoster(selectedDate);
  }, [selectedDate, loadRoster]);

  const runGenerate = useCallback(async (force: boolean) => {
    setGenerating(true);
    try {
      const summary = await rosterApi.generate(selectedDate, force);
      toastSuccess(
        'Roster generated',
        `${summary.assignments_made} of ${summary.slots_created} slots crewed` +
          (summary.flags_raised > 0 ? ` · ${summary.flags_raised} flag(s) raised` : '')
      );
      await loadRoster(selectedDate);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Generation failed';
      toastError('Generation failed', msg);
    } finally {
      setGenerating(false);
    }
  }, [selectedDate, loadRoster, toastSuccess, toastError]);

  const handleGenerate = () => {
    if (roster) {
      confirm({
        title: 'Regenerate roster?',
        message:
          `A roster already exists for ${format(parseISO(selectedDate), 'dd MMM yyyy')}. ` +
          'Regenerating will discard its current slots, assignments, and flags, then rebuild from scratch.',
        confirmLabel: 'Regenerate',
        variant: 'warning',
        onConfirm: () => runGenerate(true),
      });
    } else {
      runGenerate(false);
    }
  };

  const handlePublish = () => {
    confirm({
      title: 'Publish roster?',
      message:
        `Publishing locks the roster for ${format(parseISO(selectedDate), 'dd MMM yyyy')} ` +
        'and notifies assigned staff. You can still handle last-minute changes afterwards.',
      confirmLabel: 'Publish',
      variant: 'info',
      onConfirm: async () => {
        setPublishing(true);
        try {
          await rosterApi.publish(selectedDate);
          toastSuccess('Roster published', 'Assigned staff have been notified.');
          await loadRoster(selectedDate);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Publish failed';
          toastError('Publish failed', msg);
        } finally {
          setPublishing(false);
        }
      },
    });
  };

  const handlePrevDay = () => setSelectedDate(format(subDays(parseISO(selectedDate), 1), 'yyyy-MM-dd'));
  const handleNextDay = () => setSelectedDate(format(addDays(parseISO(selectedDate), 1), 'yyyy-MM-dd'));
  const handleToday = () => setSelectedDate(today);

  const severityBadge: Record<string, string> = {
    critical: 'badge-red',
    warning: 'badge-yellow',
    info: 'badge-blue',
  };

  const flagTypeLabelMap: Record<string, string> = {
    coverage_gap: 'Coverage Gap',
    consecutive_days: 'Consecutive Days',
    half_day_gap: 'Half-Day Gap',
    cert_mismatch: 'Cert Mismatch',
    rest_violation: 'Rest Violation',
    other: 'Other',
  };

  const exceptionsPanel = (
    <div className="card h-fit">
      <div className="card-header">
        <h3 className="text-sm font-semibold text-gray-800">Active Exceptions</h3>
        {activeFlags.length > 0 && (
          <span className="badge-red badge">{activeFlags.length}</span>
        )}
      </div>
      <div className="max-h-96 overflow-y-auto divide-y divide-gray-50">
        {activeFlags.length === 0 ? (
          <div className="p-4 text-center text-sm text-gray-400">
            <svg className="w-8 h-8 mx-auto mb-2 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            No active exceptions
          </div>
        ) : (
          activeFlags.map((flag) => (
            <div
              key={flag.id}
              className={`p-3 text-xs ${
                flag.severity === 'critical' ? 'severity-critical' :
                flag.severity === 'warning' ? 'severity-warning' : 'severity-info'
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <p className="font-semibold text-gray-800 leading-tight">{flag.title}</p>
                <span className={`badge flex-shrink-0 ${severityBadge[flag.severity]}`}>
                  {flag.severity}
                </span>
              </div>
              <p className="text-gray-600 leading-relaxed">{flag.description}</p>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="badge-gray badge">{flagTypeLabelMap[flag.flag_type]}</span>
                {flag.shift_start && (
                  <span className="text-gray-400">{flag.shift_start.slice(0, 5)}</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );

  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="page-header flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Roster View</h1>
          <p className="text-gray-500 text-sm mt-0.5">UC-001 — Daily crew scheduling overview</p>
        </div>
        <div className="flex items-center gap-2">
          {isWeekendOrHoliday && (
            <span className="badge-yellow badge text-xs">Weekend / PH</span>
          )}
          {isReadOnly && (
            <span className="badge-gray badge text-xs">Read Only</span>
          )}
          {roster?.published && (
            <span className="badge-green badge text-xs">Published</span>
          )}
          {roster && !roster.published && !isReadOnly && (
            <span className="badge-blue badge text-xs">Draft</span>
          )}
          <button
            onClick={() => loadRoster(selectedDate)}
            className="btn-secondary btn-sm"
            disabled={loading}
          >
            <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
          {!isReadOnly && (
            <button
              onClick={handleGenerate}
              className="btn-primary btn-sm"
              disabled={generating || loading}
            >
              <svg className={`w-4 h-4 ${generating ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              {generating ? 'Generating…' : roster ? 'Regenerate' : 'Generate Roster'}
            </button>
          )}
          {roster && !roster.published && !isReadOnly && (
            <button
              onClick={handlePublish}
              className="btn-primary btn-sm"
              disabled={publishing || generating || loading}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M5 13l4 4L19 7" />
              </svg>
              {publishing ? 'Publishing…' : 'Publish'}
            </button>
          )}
        </div>
      </div>

      {/* Date Navigator */}
      <div className="card mb-5">
        <div className="flex items-center justify-between px-4 py-3">
          <button
            onClick={handlePrevDay}
            className="btn-secondary btn-sm"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Previous
          </button>

          <div className="flex items-center gap-3">
            <div className="text-center">
              <p className="text-lg font-bold text-gray-900">
                {format(parseISO(selectedDate), 'EEEE, dd MMMM yyyy')}
              </p>
              {selectedDate === today && (
                <span className="text-xs text-blue-600 font-medium">Today</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="input text-sm py-1.5 w-40"
              />
              {selectedDate !== today && (
                <button onClick={handleToday} className="btn-secondary btn-sm">
                  Today
                </button>
              )}
            </div>
          </div>

          <button
            onClick={handleNextDay}
            className="btn-secondary btn-sm"
          >
            Next
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* Stats bar */}
        <div className="px-4 pb-3 flex items-center gap-6 flex-wrap">
          <div className="flex items-center gap-1.5 text-sm">
            <span className="w-2.5 h-2.5 bg-green-500 rounded-full" />
            <span className="text-gray-600">Active: <strong className="text-gray-900">{slots.filter(s => s.status === 'active').length}</strong></span>
          </div>
          <div className="flex items-center gap-1.5 text-sm">
            <span className="w-2.5 h-2.5 bg-blue-500 rounded-full" />
            <span className="text-gray-600">Scheduled: <strong className="text-gray-900">{slots.filter(s => s.status === 'scheduled').length}</strong></span>
          </div>
          <div className="flex items-center gap-1.5 text-sm">
            <span className="w-2.5 h-2.5 bg-amber-500 rounded-full" />
            <span className="text-gray-600">Unfilled: <strong className="text-gray-900">{slots.filter(s => s.status === 'unfilled').length}</strong></span>
          </div>
          <div className="flex items-center gap-1.5 text-sm">
            <span className="w-2.5 h-2.5 bg-gray-400 rounded-full" />
            <span className="text-gray-600">Total slots: <strong className="text-gray-900">{isWeekendOrHoliday ? Math.min(slots.length, 2) : slots.length}</strong></span>
          </div>
          {activeFlags.length > 0 && (
            <div className="flex items-center gap-1.5 text-sm">
              <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
              <span className="text-red-700">Exceptions: <strong>{activeFlags.length}</strong></span>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <PageLoader label="Loading roster..." />
      ) : error ? (
        <div className="card p-8 text-center">
          <svg className="w-12 h-12 mx-auto mb-3 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-red-600 font-medium">{error}</p>
          <button onClick={() => loadRoster(selectedDate)} className="btn-secondary btn-sm mt-3">
            Try again
          </button>
        </div>
      ) : (
        <CrewGrid
          slots={slots}
          date={selectedDate}
          isReadOnly={isReadOnly}
          isWeekendOrHoliday={isWeekendOrHoliday}
          onStaffClick={setSelectedStaff}
          exceptionsPanel={exceptionsPanel}
        />
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
