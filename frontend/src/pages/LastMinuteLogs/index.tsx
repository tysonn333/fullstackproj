import React, { useState, useEffect, useCallback } from 'react';
import { format, subDays } from 'date-fns';
import { auditApi } from '../../api/audit';
import { PageLoader } from '../../components/LoadingSpinner';
import { useToast } from '../../components/Toast';
import type { AuditLog } from '../../types';

const ACTION_LABELS: Record<string, string> = {
  reassign: 'Reassignment',
  assign: 'Assignment',
  update: 'Status Update',
  publish: 'Publish',
  generate: 'Generate',
  create: 'Create',
  resolve: 'Resolve',
  dismiss: 'Dismiss',
  approve: 'Approve',
  reject: 'Reject',
  login: 'Login',
  logout: 'Logout',
  create_account: 'Create Account',
  bulk_create_accounts: 'Bulk Account Creation',
  'import': 'Import',
  'delete': 'Delete',
};

const ACTION_COLORS: Record<string, string> = {
  reassign: 'badge-yellow',
  assign: 'badge-blue',
  update: 'badge-gray',
  publish: 'badge-green',
  generate: 'badge-blue',
  create: 'badge-green',
  resolve: 'badge-green',
  dismiss: 'badge-gray',
  approve: 'badge-green',
  reject: 'badge-red',
  login: 'badge-blue',
  logout: 'badge-gray',
  create_account: 'badge-blue',
  bulk_create_accounts: 'badge-purple',
  'import': 'badge-blue',
  'delete': 'badge-red',
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return format(d, 'dd MMM yyyy HH:mm:ss');
}

function formatTimeShort(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return format(d, 'dd MMM HH:mm');
}

function renderDetails(details: Record<string, unknown>): React.ReactNode {
  if (!details || Object.keys(details).length === 0) {
    return <span className="text-gray-400 text-xs">—</span>;
  }

  const entries: { label: string; value: string }[] = [];

  if (details.reason && typeof details.reason === 'string') {
    entries.push({ label: 'Reason', value: details.reason });
  }
  if (details.undone_reason && typeof details.undone_reason === 'string') {
    entries.push({ label: 'Undo Reason', value: details.undone_reason });
  }
  if (details.previous_staff_name && typeof details.previous_staff_name === 'string') {
    entries.push({ label: 'Previous Staff', value: details.previous_staff_name });
  } else if (details.previous_staff_id != null) {
    entries.push({ label: 'Previous Staff', value: `#${details.previous_staff_id}` });
  }
  if (details.new_staff_name && typeof details.new_staff_name === 'string') {
    entries.push({ label: 'New Staff', value: details.new_staff_name });
  } else if (details.new_staff_id != null) {
    entries.push({ label: 'New Staff', value: `#${details.new_staff_id}` });
  }
  if (details.staff_id != null) {
    entries.push({ label: 'Staff', value: `#${details.staff_id}` });
  }
  if (details.slot_id != null) {
    entries.push({ label: 'Slot', value: `#${details.slot_id}` });
  }
  if (details.roster_id != null) {
    entries.push({ label: 'Roster', value: `#${details.roster_id}` });
  }
  if (details.roster_date && typeof details.roster_date === 'string') {
    entries.push({ label: 'Date', value: details.roster_date });
  }
  if (details.score != null) {
    entries.push({ label: 'Score', value: String(details.score) });
  }

  if (entries.length === 0) {
    return (
      <details className="text-xs">
        <summary className="text-gray-400 cursor-pointer hover:text-gray-600">Raw JSON</summary>
        <pre className="mt-1 p-2 bg-gray-50 rounded text-[10px] overflow-x-auto max-h-32">
          {JSON.stringify(details, null, 2)}
        </pre>
      </details>
    );
  }

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
      {entries.map((e) => (
        <span key={e.label} className="text-gray-600">
          <span className="text-gray-400">{e.label}:</span>{' '}
          <span className="font-medium text-gray-800">{e.value}</span>
        </span>
      ))}
    </div>
  );
}

export const LastMinuteLogs: React.FC = () => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedAction, setSelectedAction] = useState('');
  const [dateFrom, setDateFrom] = useState(format(subDays(new Date(), 7), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [undoTargetId, setUndoTargetId] = useState<number | null>(null);
  const [undoReason, setUndoReason] = useState('');
  const [undoing, setUndoing] = useState(false);

  const { success, error: toastError } = useToast();

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const result = await auditApi.list({
        entity_type: selectedAction === 'all' ? undefined : 'assignments',
        action: selectedAction || undefined,
        from: dateFrom || undefined,
        to: dateTo || undefined,
        page,
        limit: 30,
      });
      setLogs(result.data.filter((log) => !(log.action === 'reassign' && log.details?.undone === true)));
      setTotal(result.total);
      setTotalPages(result.total_pages);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [selectedAction, dateFrom, dateTo, page]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const handleUndoStart = (logId: number) => {
    setUndoTargetId(logId);
    setUndoReason('');
  };

  const handleUndoCancel = () => {
    setUndoTargetId(null);
    setUndoReason('');
  };

  const handleUndoConfirm = async () => {
    if (undoTargetId === null) return;
    setUndoing(true);
    try {
      await auditApi.undo(undoTargetId, undoReason || undefined);
      success('Undo successful', 'The assignment has been reverted. The log entry is now marked as undone.');
      setUndoTargetId(null);
      setUndoReason('');
      loadLogs();
    } catch {
      toastError('Undo failed', 'Could not revert the assignment. The slot may have been modified since.');
    } finally {
      setUndoing(false);
    }
  };

  const handleReset = () => {
    setSelectedAction('');
    setDateFrom(format(subDays(new Date(), 7), 'yyyy-MM-dd'));
    setDateTo(format(new Date(), 'yyyy-MM-dd'));
    setPage(1);
  };

  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-6">
      <div className="page-header">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Last-Minute Change Logs</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Full audit trail of all assignment changes, swaps, and reassignments
          </p>
        </div>
        <span className="badge-gray badge text-xs">
          {total} total entries
        </span>
      </div>

      {/* Filters */}
      <div className="card mb-4">
        <div className="flex flex-wrap items-end gap-3 px-4 py-3">
          <div className="form-group mb-0">
            <label className="label text-xs">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
              className="input text-sm w-40"
            />
          </div>
          <div className="form-group mb-0">
            <label className="label text-xs">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
              className="input text-sm w-40"
            />
          </div>
          <div className="form-group mb-0">
            <label className="label text-xs">Action</label>
            <select
              value={selectedAction}
              onChange={(e) => { setSelectedAction(e.target.value); setPage(1); }}
              className="input text-sm w-44"
            >
              <option value="">All Actions</option>
              <option value="reassign">Reassignment</option>
              <option value="assign">Assignment</option>
              <option value="update">Status Update</option>
            </select>
          </div>
          <button onClick={handleReset} className="btn-secondary btn-sm">
            Reset Filters
          </button>
          <button onClick={loadLogs} className="btn-primary btn-sm" disabled={loading}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <PageLoader label="Loading audit logs..." />
        ) : logs.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-sm font-medium">No audit logs found</p>
            <p className="text-xs mt-1">Try adjusting your filters or date range</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-40">Timestamp</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-28">Action</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-28">Entity</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-36">Actor</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {logs.map((log) => {
                  const isExpanded = expandedRow === log.log_id;
                  return (
                    <React.Fragment key={log.log_id}>
                      <tr
                        onClick={() => setExpandedRow(isExpanded ? null : log.log_id)}
                        className={`hover:bg-gray-50 cursor-pointer transition-colors ${isExpanded ? 'bg-blue-50' : ''}`}
                      >
                        <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap" title={formatTime(log.created_at)}>
                          {formatTimeShort(log.created_at)}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`badge text-[10px] ${ACTION_COLORS[log.action] || 'badge-gray'}`}>
                            {ACTION_LABELS[log.action] || log.action}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col">
                            <span className="text-xs font-medium text-gray-800">{log.entity_type}</span>
                            {log.entity_id != null && (
                              <span className="text-[10px] text-gray-400">ID #{log.entity_id}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center text-blue-700 font-bold text-[9px] flex-shrink-0">
                              {log.profiles?.name?.charAt(0) || '?'}
                            </div>
                            <div className="flex flex-col">
                              <span className="text-xs font-medium text-gray-800 truncate max-w-[120px]">
                                {log.profiles?.name || 'Unknown'}
                              </span>
                              {log.profiles?.role && (
                                <span className="text-[9px] text-gray-400 capitalize">{log.profiles.role}</span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {renderDetails(log.details)}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-gray-50">
                          <td colSpan={5} className="px-4 py-3">
                            <div className="text-xs space-y-1">
                              <div className="flex gap-4">
                                <span className="text-gray-400">Log ID:</span>
                                <span className="font-mono text-gray-700">#{log.log_id}</span>
                              </div>
                              <div className="flex gap-4">
                                <span className="text-gray-400">Created:</span>
                                <span className="text-gray-700">{formatTime(log.created_at)}</span>
                              </div>
                              <div className="flex gap-4">
                                <span className="text-gray-400">Entity ID:</span>
                                <span className="font-mono text-gray-700">{log.entity_id ?? '—'}</span>
                              </div>
                              <div className="flex gap-4">
                                <span className="text-gray-400">Actor ID:</span>
                                <span className="font-mono text-gray-700">{log.actor_id || '—'}</span>
                              </div>
                              <div>
                                <span className="text-gray-400">Reason:</span>
                                <p className="mt-0.5 text-gray-700">{String(log.details?.reason ?? '—')}</p>
                              </div>
                              {log.details?.undone === true && (
                                <div>
                                  <span className="text-gray-400">Undo Reason:</span>
                                  <p className="mt-0.5 text-gray-700">{String(log.details?.undone_reason || '—')}</p>
                                </div>
                              )}
                              {log.action === 'reassign' && !log.details?.undone && Boolean(log.details?.slot_id && log.details?.previous_staff_id && log.details?.roster_id) && (
                                <div className="pt-2">
                                  {undoTargetId === log.log_id ? (
                                    <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
                                      <input
                                        type="text"
                                        value={undoReason}
                                        onChange={(e) => setUndoReason(e.target.value)}
                                        placeholder="Reason for undo (optional)"
                                        className="input text-xs w-full"
                                        disabled={undoing}
                                        autoFocus
                                      />
                                      <div className="flex gap-2">
                                        <button
                                          onClick={handleUndoConfirm}
                                          disabled={undoing}
                                          className="btn-danger btn-sm text-xs flex-1"
                                        >
                                          {undoing ? (
                                            <span className="flex items-center justify-center gap-1.5">
                                              <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                              Undoing...
                                            </span>
                                          ) : 'Confirm Undo'}
                                        </button>
                                        <button
                                          onClick={handleUndoCancel}
                                          disabled={undoing}
                                          className="btn-secondary btn-sm text-xs"
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleUndoStart(log.log_id); }}
                                      className="btn-secondary btn-sm text-xs text-red-600 border-red-200 hover:bg-red-50"
                                    >
                                      <span className="flex items-center gap-1.5">
                                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                            d="M3 10h10a5 5 0 015 5v2M3 10l4-4m-4 4l4 4" />
                                        </svg>
                                        Undo Reassignment
                                      </span>
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50">
            <p className="text-xs text-gray-500">
              Page {page} of {totalPages} · {total} entries
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="btn-secondary btn-sm text-xs"
              >
                Previous
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                .map((p, idx, arr) => (
                  <React.Fragment key={p}>
                    {idx > 0 && arr[idx - 1] !== p - 1 && (
                      <span className="text-gray-300 text-xs">…</span>
                    )}
                    <button
                      onClick={() => setPage(p)}
                      className={`btn-sm text-xs min-w-[2rem] ${p === page ? 'btn-primary' : 'btn-secondary'}`}
                    >
                      {p}
                    </button>
                  </React.Fragment>
                ))}
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="btn-secondary btn-sm text-xs"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
