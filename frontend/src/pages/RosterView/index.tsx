import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { format, addDays, subDays, isWeekend, parseISO } from 'date-fns';
import { rosterApi } from '../../api/roster';
import { flagsApi } from '../../api/flags';
import { calendarApi } from '../../api/calendar';
import { CrewGrid } from './CrewGrid';
import { CalendarGrid } from './CalendarGrid';
import { SlotSwapDialog } from './SlotSwapDialog';
import { StaffDetail } from './StaffDetail';
import { ImportJobsModal } from './ImportJobsModal';
import { PageLoader } from '../../components/LoadingSpinner';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { useAuth } from '../../hooks/useAuth';
import type { ShiftSlot, Staff, Flag, Roster } from '../../types';

// Singapore public holidays (simplified static list, incl. observed days —
// extend each year; would come from an API in production)
const SG_PUBLIC_HOLIDAYS = [
  // 2024
  '2024-01-01', '2024-02-10', '2024-02-11', '2024-03-29',
  '2024-04-10', '2024-05-01', '2024-05-22', '2024-05-23',
  '2024-06-17', '2024-08-09', '2024-10-31', '2024-12-25',
  // 2025
  '2025-01-01', '2025-01-29', '2025-01-30', '2025-03-31',
  '2025-04-18', '2025-05-01', '2025-05-12', '2025-06-07',
  '2025-08-09', '2025-10-20', '2025-12-25',
  // 2026
  '2026-01-01', '2026-02-17', '2026-02-18', '2026-03-21',
  '2026-04-03', '2026-05-01', '2026-05-27', '2026-06-01',
  '2026-08-10', '2026-11-09', '2026-12-25',
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
  const [rosterDates, setRosterDates] = useState<Set<string>>(new Set());
  const [swapSlots, setSwapSlots] = useState<{ slotId: string; role: 'driver' | 'attendant' } | null>(null);
  const [showImportJobs, setShowImportJobs] = useState(false);
  const [exporting, setExporting] = useState(false);

  const { error: toastError, success: toastSuccess } = useToast();
  const { confirm } = useConfirm();
  const { isAdmin } = useAuth();

  const today = format(new Date(), 'yyyy-MM-dd');
  const isReadOnly = selectedDate < today;
  const isWeekendOrHoliday = isWeekend(parseISO(selectedDate)) || SG_PUBLIC_HOLIDAYS.includes(selectedDate);

  const refreshRosterDates = useCallback(async (date: string) => {
    const d = parseISO(date);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const from = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const to = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    try {
      setRosterDates(await rosterApi.getRosterDatesInRange(from, to));
    } catch {
      /* non-critical calendar decoration */
    }
  }, []);

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

  const runGenerate = useCallback(async (force: boolean, allowSkeleton = false) => {
    setGenerating(true);
    try {
      const summary = await rosterApi.generate(selectedDate, force, allowSkeleton);
      toastSuccess(
        summary.skeleton ? 'Skeleton roster generated' : 'Roster generated',
        `${summary.assignments_made} of ${summary.slots_created} slots crewed` +
          (summary.jobs_considered ? ` · ${summary.jobs_considered} job(s)` : '') +
          (summary.weekend_or_holiday ? ' · weekend/PH baseline' : '') +
          (summary.flags_raised > 0 ? ` · ${summary.flags_raised} flag(s) raised` : '')
      );
      await loadRoster(selectedDate);
      await refreshRosterDates(selectedDate);
    } catch (err: unknown) {
      // UC-002 A1: job list absent — offer the skeleton fallback.
      const resp = axios.isAxiosError(err)
        ? (err.response?.data as { error?: string; code?: string } | undefined)
        : undefined;
      if (resp?.code === 'NO_JOB_LIST') {
        setGenerating(false);
        confirm({
          title: 'Job list not yet available',
          message:
            `No call-centre jobs are imported for ${format(parseISO(selectedDate), 'dd MMM yyyy')}. ` +
            'Generation is normally deferred until the job list arrives. You can import jobs first ' +
            '(Import Jobs button), or generate a skeleton roster from standard coverage now.',
          confirmLabel: 'Generate skeleton',
          variant: 'warning',
          onConfirm: () => runGenerate(force, true),
        });
        return;
      }
      const msg = resp?.error ?? (err instanceof Error ? err.message : 'Generation failed');
      toastError('Generation failed', msg);
    } finally {
      setGenerating(false);
    }
  }, [selectedDate, loadRoster, refreshRosterDates, toastSuccess, toastError, confirm]);

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

  const handleExportCalendar = async () => {
    if (!roster) return;
    setExporting(true);
    try {
      await calendarApi.downloadRoster(roster.id, selectedDate);
      toastSuccess('Calendar exported', 'The .ics file was downloaded — import it into your calendar app.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Export failed';
      toastError('Calendar export failed', msg);
    } finally {
      setExporting(false);
    }
  };

  const handleMonthChange = useCallback((year: number, month: number) => {
    const from = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const to = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    rosterApi
      .getRosterDatesInRange(from, to)
      .then(setRosterDates)
      .catch(() => { /* non-critical */ });
  }, []);

  const handleSlotSwap = useCallback((slotId: string, role: 'driver' | 'attendant') => {
    setSwapSlots({ slotId, role });
  }, []);
  const handleSwapDone = useCallback(() => {
    setSwapSlots(null);
    loadRoster(selectedDate);
  }, [loadRoster, selectedDate]);

  const swapSlot = swapSlots ? slots.find((s) => s.id === swapSlots.slotId) ?? null : null;

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
        <div className="flex items-center gap-2 flex-wrap">
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
          {roster && (
            <button
              onClick={handleExportCalendar}
              className="btn-secondary btn-sm"
              disabled={exporting}
              title="Export this roster as an .ics calendar file"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              {exporting ? 'Exporting…' : 'Add to Calendar'}
            </button>
          )}
          {!isReadOnly && isAdmin && (
            <button
              onClick={() => setShowImportJobs(true)}
              className="btn-secondary btn-sm"
              title="Import the call-centre job list (UC-002 input feed)"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Import Jobs
            </button>
          )}
          {!isReadOnly && isAdmin && (
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
          {roster && !roster.published && !isReadOnly && isAdmin && (
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

      {/* Date header + quick nav */}
      <div className="card mb-4">
        <div className="flex items-center justify-between px-4 py-3">
          <button onClick={handlePrevDay} className="btn-secondary btn-sm">
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
            {selectedDate !== today && (
              <button onClick={handleToday} className="btn-secondary btn-sm">
                Today
              </button>
            )}
          </div>

          <button onClick={handleNextDay} className="btn-secondary btn-sm">
            Next
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Calendar + Main content */}
      <div className="flex gap-4 items-start">
        {/* Calendar sidebar */}
        <div className="w-64 flex-shrink-0">
          <CalendarGrid
            selectedDate={selectedDate}
            onDateSelect={setSelectedDate}
            onMonthChange={handleMonthChange}
            rosterDates={rosterDates}
          />
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          {/* Stats bar */}
          <div className="card mb-4">
            <div className="px-4 py-3 flex items-center gap-6 flex-wrap">
              {!roster && !loading && !error && (
                <div className="flex items-center gap-1.5 text-sm text-gray-500">
                  No roster for this date
                </div>
              )}
              <div className="flex items-center gap-1.5 text-sm">
                <span className="w-2.5 h-2.5 bg-green-500 rounded-full" />
                <span className="text-gray-600">Active: <strong className="text-gray-900">{slots.filter(s => s.status === 'active').length}</strong></span>
              </div>
              <div className="flex items-center gap-1.5 text-sm">
                <span className="w-2.5 h-2.5 bg-sky-500 rounded-full" />
                <span className="text-gray-600">Scheduled: <strong className="text-gray-900">{slots.filter(s => s.status === 'scheduled').length}</strong></span>
              </div>
              <div className="flex items-center gap-1.5 text-sm">
                <span className="w-2.5 h-2.5 bg-amber-500 rounded-full" />
                <span className="text-gray-600">Unfilled: <strong className="text-gray-900">{slots.filter(s => s.status === 'unfilled').length}</strong></span>
              </div>
              <div className="flex items-center gap-1.5 text-sm">
                <span className="w-2.5 h-2.5 bg-gray-400 rounded-full" />
                <span className="text-gray-600">Total slots: <strong className="text-gray-900">{slots.length}</strong></span>
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
              onSlotSwap={isAdmin && !isReadOnly ? handleSlotSwap : undefined}
              exceptionsPanel={exceptionsPanel}
            />
          )}
        </div>
      </div>

      {/* UC-002 job feed import */}
      {showImportJobs && (
        <ImportJobsModal
          date={selectedDate}
          onClose={() => setShowImportJobs(false)}
          onImported={() => loadRoster(selectedDate)}
        />
      )}

      {/* Slot assign / swap dialog (UC-005 ranking) */}
      {swapSlot && swapSlots && (
        <SlotSwapDialog
          slot={swapSlot}
          role={swapSlots.role}
          onClose={() => setSwapSlots(null)}
          onSwap={handleSwapDone}
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
