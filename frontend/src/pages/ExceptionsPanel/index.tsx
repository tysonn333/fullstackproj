import React, { useState, useEffect, useCallback, useRef } from 'react';
import { flagsApi } from '../../api/flags';
import { FlagCard } from './FlagCard';
import { BulkActionModal } from './BulkActionModal';
import { PageLoader } from '../../components/LoadingSpinner';
import { useToast } from '../../components/Toast';
import type { Flag, FlagFilters, FlagSeverity, FlagType } from '../../types';

const REFRESH_INTERVAL = 30_000;

const sortFlags = (flags: Flag[]): Flag[] => {
  const severityOrder: Record<FlagSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return [...flags].sort((a, b) => {
    const sevDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (sevDiff !== 0) return sevDiff;
    const timeA = a.shift_start || '00:00';
    const timeB = b.shift_start || '00:00';
    return timeA.localeCompare(timeB);
  });
};

const FLAG_TYPE_OPTIONS: { value: FlagType; label: string }[] = [
  { value: 'coverage_gap', label: 'Coverage Gap' },
  { value: 'consecutive_days', label: 'Consecutive Days' },
  { value: 'half_day_gap', label: 'Half-Day Gap' },
  { value: 'cert_mismatch', label: 'Cert Mismatch' },
  { value: 'rest_violation', label: 'Rest Violation' },
  { value: 'other', label: 'Other' },
];

export const ExceptionsPanel: React.FC = () => {
  const [flags, setFlags] = useState<Flag[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [autoRefreshCountdown, setAutoRefreshCountdown] = useState(30);
  const [filters, setFilters] = useState<FlagFilters>({ status: 'active' });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkMode, setBulkMode] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { success, error: toastError } = useToast();

  const loadFlags = useCallback(async (showLoader = true) => {
    if (showLoader) setLoading(true);
    try {
      const result = await flagsApi.list(filters);
      setFlags(sortFlags(result.data));
      setTotal(result.total);
    } catch {
      toastError('Failed to load flags');
    } finally {
      setLoading(false);
    }
  }, [filters, toastError]);

  // Initial load + auto-refresh
  useEffect(() => {
    loadFlags();
    setAutoRefreshCountdown(30);

    intervalRef.current = setInterval(() => {
      loadFlags(false);
      setAutoRefreshCountdown(30);
    }, REFRESH_INTERVAL);

    countdownRef.current = setInterval(() => {
      setAutoRefreshCountdown((prev) => (prev <= 1 ? 30 : prev - 1));
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [loadFlags]);

  const handleFlagUpdate = (updated: Flag) => {
    setFlags((prev) => sortFlags(
      filters.status && filters.status !== updated.status
        ? prev.filter((f) => f.id !== updated.id)
        : prev.map((f) => (f.id === updated.id ? updated : f))
    ));
    setSelectedIds((prev) => { const next = new Set(prev); next.delete(updated.id); return next; });
  };

  const handleSelect = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    const activeFlags = flags.filter((f) => f.status === 'active');
    if (selectedIds.size === activeFlags.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(activeFlags.map((f) => f.id)));
    }
  };

  const handleBulkComplete = (_action: 'resolve' | 'dismiss', _count: number) => {
    setSelectedIds(new Set());
    setBulkMode(false);
    loadFlags(false);
  };

  const handleExportCsv = async () => {
    setExportLoading(true);
    try {
      const blob = await flagsApi.exportCsv(filters);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `flags-export-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      success('Export complete', 'Flags exported to CSV.');
    } catch {
      toastError('Export failed', 'Could not export flags.');
    } finally {
      setExportLoading(false);
    }
  };

  const filterChange = (key: keyof FlagFilters) => (
    e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>
  ) => {
    setFilters((prev) => ({ ...prev, [key]: e.target.value || undefined }));
    setSelectedIds(new Set());
  };

  const criticalCount = flags.filter((f) => f.severity === 'critical' && f.status === 'active').length;
  const warningCount = flags.filter((f) => f.severity === 'warning' && f.status === 'active').length;
  const infoCount = flags.filter((f) => f.severity === 'info' && f.status === 'active').length;
  const activeFlags = flags.filter((f) => f.status === 'active');

  return (
    <div className="max-w-screen-xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="page-header flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Exceptions Panel</h1>
          <p className="text-gray-500 text-sm mt-0.5">UC-008 — Scheduling flags and exception management</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Auto-refresh indicator */}
          <div className="flex items-center gap-1.5 text-xs text-gray-500 bg-gray-100 px-3 py-1.5 rounded-full">
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
            Refresh in {autoRefreshCountdown}s
          </div>

          {/* Manual refresh */}
          <button
            onClick={() => loadFlags(false)}
            className="btn-secondary btn-sm"
            disabled={loading}
          >
            <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>

          {/* Bulk mode toggle */}
          {activeFlags.length >= 10 && (
            <button
              onClick={() => { setBulkMode(!bulkMode); setSelectedIds(new Set()); }}
              className={`btn-sm ${bulkMode ? 'btn-primary' : 'btn-secondary'}`}
            >
              {bulkMode ? 'Exit Bulk Mode' : 'Bulk Select'}
            </button>
          )}

          {/* CSV Export */}
          <button
            onClick={handleExportCsv}
            disabled={exportLoading}
            className="btn-secondary btn-sm"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            {exportLoading ? 'Exporting...' : 'Export CSV'}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Total Active', value: activeFlags.length, color: 'text-gray-900', bg: 'bg-white' },
          { label: 'Critical', value: criticalCount, color: 'text-red-600', bg: criticalCount > 0 ? 'bg-red-50' : 'bg-white' },
          { label: 'Warning', value: warningCount, color: 'text-amber-600', bg: warningCount > 0 ? 'bg-amber-50' : 'bg-white' },
          { label: 'Info', value: infoCount, color: 'text-blue-600', bg: 'bg-white' },
        ].map((stat) => (
          <div key={stat.label} className={`card px-4 py-3 ${stat.bg}`}>
            <p className="text-xs text-gray-500">{stat.label}</p>
            <p className={`text-2xl font-bold mt-0.5 ${stat.color}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="card mb-4">
        <div className="flex flex-wrap gap-3 p-4 items-end">
          <div className="form-group">
            <label className="label text-xs">Status</label>
            <select
              value={filters.status || ''}
              onChange={filterChange('status')}
              className="input text-sm w-36"
            >
              <option value="">All Statuses</option>
              <option value="active">Active</option>
              <option value="resolved">Resolved</option>
              <option value="dismissed">Dismissed</option>
            </select>
          </div>
          <div className="form-group">
            <label className="label text-xs">Severity</label>
            <select
              value={filters.severity || ''}
              onChange={filterChange('severity')}
              className="input text-sm w-36"
            >
              <option value="">All Severities</option>
              <option value="critical">Critical</option>
              <option value="warning">Warning</option>
              <option value="info">Info</option>
            </select>
          </div>
          <div className="form-group">
            <label className="label text-xs">Flag Type</label>
            <select
              value={filters.flag_type || ''}
              onChange={filterChange('flag_type')}
              className="input text-sm w-48"
            >
              <option value="">All Types</option>
              {FLAG_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="label text-xs">Date From</label>
            <input type="date" value={filters.date_from || ''} onChange={filterChange('date_from')} className="input text-sm w-40" />
          </div>
          <div className="form-group">
            <label className="label text-xs">Date To</label>
            <input type="date" value={filters.date_to || ''} onChange={filterChange('date_to')} className="input text-sm w-40" />
          </div>
          {(filters.severity || filters.flag_type || filters.date_from || filters.date_to) && (
            <button
              onClick={() => setFilters({ status: filters.status })}
              className="btn-secondary btn-sm self-end"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Bulk action bar */}
      {bulkMode && selectedIds.size > 0 && (
        <div className="mb-4 flex items-center justify-between px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl">
          <p className="text-sm font-medium text-blue-800">
            {selectedIds.size} flag(s) selected
          </p>
          <div className="flex gap-2">
            <button onClick={() => setSelectedIds(new Set())} className="btn-secondary btn-sm text-xs">
              Clear selection
            </button>
            <button
              onClick={() => setShowBulkModal(true)}
              className="btn-primary btn-sm text-xs"
            >
              Apply Bulk Action
            </button>
          </div>
        </div>
      )}

      {/* Select all (bulk mode) */}
      {bulkMode && (
        <div className="mb-3 flex items-center gap-2">
          <input
            type="checkbox"
            checked={selectedIds.size === activeFlags.length && activeFlags.length > 0}
            onChange={handleSelectAll}
            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <label className="text-sm text-gray-600">
            Select all active ({activeFlags.length})
          </label>
        </div>
      )}

      {/* Flags list */}
      {loading ? (
        <PageLoader label="Loading exceptions..." />
      ) : flags.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">All clear!</h3>
          <p className="text-gray-500 text-sm">No exceptions found matching your filters.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {flags.map((flag) => (
            <FlagCard
              key={flag.id}
              flag={flag}
              selected={selectedIds.has(flag.id)}
              onSelect={handleSelect}
              onUpdate={handleFlagUpdate}
              bulkMode={bulkMode}
            />
          ))}
          <p className="text-xs text-gray-400 text-right pt-2">
            Showing {flags.length} of {total} flags
          </p>
        </div>
      )}

      {/* Bulk action modal */}
      {showBulkModal && (
        <BulkActionModal
          selectedIds={Array.from(selectedIds)}
          onClose={() => setShowBulkModal(false)}
          onComplete={handleBulkComplete}
        />
      )}
    </div>
  );
};
