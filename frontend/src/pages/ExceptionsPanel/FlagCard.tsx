import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, parseISO, isValid } from 'date-fns';
import { flagsApi } from '../../api/flags';
import { useToast } from '../../components/Toast';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import type { AuditLog, Flag } from '../../types';

interface FlagCardProps {
  flag: Flag;
  selected?: boolean;
  onSelect?: (id: string, checked: boolean) => void;
  onUpdate: (flag: Flag) => void;
  bulkMode?: boolean;
}

const severityConfig = {
  critical: {
    badge: 'badge-red',
    border: 'border-l-red-500',
    bg: 'bg-red-50',
    icon: '🚨',
    dot: 'bg-red-500',
  },
  warning: {
    badge: 'badge-yellow',
    border: 'border-l-amber-400',
    bg: 'bg-amber-50',
    icon: '⚠️',
    dot: 'bg-amber-400',
  },
  info: {
    badge: 'badge-blue',
    border: 'border-l-sky-400',
    bg: 'bg-sky-50',
    icon: 'ℹ️',
    dot: 'bg-sky-400',
  },
};

const flagTypeLabels: Record<string, string> = {
  coverage_gap: 'Coverage Gap',
  consecutive_days: 'Consecutive Days',
  half_day_gap: 'Half-Day Gap',
  cert_mismatch: 'Cert Mismatch',
  rest_violation: 'Rest Violation',
  other: 'Other',
};

const statusBadge: Record<string, string> = {
  resolved: 'badge-green',
  auto_resolved: 'badge-blue',
  dismissed: 'badge-gray',
  deferred: 'badge-yellow',
  rejected: 'badge-red',
};

// Actions that need a typed reason, and the minimum length required.
type FlagAction = 'resolve' | 'dismiss' | 'defer' | 'reject' | 'reopen';
const REASON_MIN: Record<string, number> = { reject: 10 };

export const FlagCard: React.FC<FlagCardProps> = ({
  flag,
  selected = false,
  onSelect,
  onUpdate,
  bulkMode = false,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [action, setAction] = useState<FlagAction | null>(null);
  const [reason, setReason] = useState('');
  const [deferUntil, setDeferUntil] = useState('');
  const [loading, setLoading] = useState(false);
  const [notifying, setNotifying] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<AuditLog[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const { success, error: toastError } = useToast();
  const navigate = useNavigate();

  const config = severityConfig[flag.severity];
  // "Open" states can still be acted on (resolve/dismiss/defer/reject); a
  // deferred flag is still open, just snoozed.
  const isOpen = flag.status === 'active' || flag.status === 'deferred';
  const canReopen = flag.status === 'resolved' || flag.status === 'dismissed' || flag.status === 'rejected';

  // Staffing-gap flags can be resolved by finding a replacement — deep-link to
  // the Last-Minute Changes flow pre-seeded with the affected date (UC-006).
  const canFindReplacement =
    isOpen &&
    (flag.flag_type === 'coverage_gap' || flag.flag_type === 'half_day_gap') &&
    Boolean(flag.affected_date);

  const startAction = (a: FlagAction) => {
    setAction(a);
    setReason('');
    setDeferUntil('');
  };

  const reasonMin = action ? REASON_MIN[action] ?? 0 : 0;
  const reasonOk = action === 'reject' ? reason.trim().length >= reasonMin : reason.trim().length > 0;
  const deferOk = action !== 'defer' || Boolean(deferUntil);

  const handleAction = async () => {
    if (!action) return;
    if (action === 'defer') {
      if (!deferUntil) {
        toastError('Date required', 'Please pick a date to defer this flag until.');
        return;
      }
    } else if (action === 'reject') {
      if (reason.trim().length < REASON_MIN.reject) {
        toastError('Reason too short', `Please provide at least ${REASON_MIN.reject} characters.`);
        return;
      }
    } else if (!reason.trim()) {
      toastError('Reason required', 'Please provide a reason before proceeding.');
      return;
    }

    setLoading(true);
    try {
      let updated: Flag;
      switch (action) {
        case 'resolve':
          updated = await flagsApi.resolve(flag.id, reason);
          success('Flag resolved', flag.title);
          break;
        case 'dismiss':
          updated = await flagsApi.dismiss(flag.id, reason);
          success('Flag dismissed', flag.title);
          break;
        case 'defer':
          updated = await flagsApi.defer(flag.id, deferUntil, reason || undefined);
          success('Flag deferred', `Snoozed until ${deferUntil}`);
          break;
        case 'reject':
          updated = await flagsApi.reject(flag.id, reason);
          success('Flag rejected', flag.title);
          break;
        case 'reopen':
          updated = await flagsApi.reopen(flag.id);
          success('Flag reopened', flag.title);
          break;
        default:
          return;
      }
      onUpdate(updated);
      setAction(null);
      setReason('');
      setDeferUntil('');
    } catch {
      toastError('Action failed', 'Could not update the flag. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleReopen = async () => {
    setLoading(true);
    try {
      const updated = await flagsApi.reopen(flag.id);
      success('Flag reopened', flag.title);
      onUpdate(updated);
    } catch {
      toastError('Action failed', 'Could not reopen the flag. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleNotify = async () => {
    setNotifying(true);
    try {
      const payload = await flagsApi.notify(flag.id);
      // Browser-notification fallback: request permission, then show the
      // notification. If unsupported or denied, fall back to an in-app toast.
      if (typeof Notification !== 'undefined') {
        let permission = Notification.permission;
        if (permission === 'default') {
          permission = await Notification.requestPermission();
        }
        if (permission === 'granted') {
          new Notification(payload.title, { body: payload.body, tag: payload.tag });
          success('Notification sent', payload.body);
          return;
        }
      }
      success(payload.title, payload.body);
    } catch {
      toastError('Notify failed', 'Could not send the notification.');
    } finally {
      setNotifying(false);
    }
  };

  const toggleHistory = async () => {
    const next = !showHistory;
    setShowHistory(next);
    if (next && history === null) {
      setHistoryLoading(true);
      try {
        setHistory(await flagsApi.getAudit(flag.id));
      } catch {
        setHistory([]);
        toastError('History unavailable', 'Could not load this flag’s audit trail.');
      } finally {
        setHistoryLoading(false);
      }
    }
  };

  return (
    <div
      className={`
        card overflow-hidden border-l-4 transition-all
        ${config.border}
        ${selected ? 'ring-2 ring-blue-400' : ''}
        ${!isOpen ? 'opacity-60' : ''}
      `}
    >
      {/* Header row */}
      <div
        className={`flex items-start gap-3 p-4 cursor-pointer hover:bg-gray-50 transition-colors ${config.bg}`}
        onClick={() => setExpanded(!expanded)}
      >
        {/* Bulk checkbox */}
        {bulkMode && flag.status === 'active' && (
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => {
              e.stopPropagation();
              onSelect?.(flag.id, e.target.checked);
            }}
            className="mt-1 w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 flex-shrink-0"
          />
        )}

        {/* Severity dot */}
        <span className={`mt-1.5 w-2.5 h-2.5 rounded-full flex-shrink-0 ${config.dot} ${flag.severity === 'critical' ? 'animate-pulse' : ''}`} />

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-gray-900 text-sm">{flag.title}</p>
              <span className={`badge text-xs ${config.badge}`}>{flag.severity}</span>
              <span className="badge-gray badge text-xs">{flagTypeLabels[flag.flag_type] || flag.flag_type}</span>
              {flag.status !== 'active' && (
                <span className={`badge text-xs ${statusBadge[flag.status] ?? 'badge-gray'}`}>
                  {flag.status === 'auto_resolved' ? 'auto-resolved' : flag.status}
                </span>
              )}
              {flag.status === 'deferred' && flag.deferred_until && (
                <span className="text-[10px] text-amber-600">until {flag.deferred_until}</span>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-gray-400 flex-shrink-0">
              {flag.shift_start && <span>{flag.shift_start.slice(0, 5)}</span>}
              {flag.affected_date && isValid(parseISO(flag.affected_date)) && (
                <span>{format(parseISO(flag.affected_date), 'dd MMM')}</span>
              )}
            </div>
          </div>
          <p className="text-xs text-gray-600 mt-1 line-clamp-2">{flag.description}</p>

          {flag.staff && (
            <p className="text-xs text-gray-500 mt-1">
              Staff: <span className="font-medium text-gray-700">{flag.staff.name}</span>
              <span className="ml-1 opacity-60 capitalize">({flag.staff.role})</span>
            </p>
          )}
        </div>

        {/* Chevron */}
        <svg
          className={`w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {/* Expanded section */}
      {expanded && (
        <div className="border-t border-gray-100 p-4 space-y-4">
          {/* Replacement candidates */}
          {flag.replacement_candidates && flag.replacement_candidates.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
                Top Replacement Candidates
              </p>
              <div className="space-y-2">
                {flag.replacement_candidates.slice(0, 3).map((candidate, idx) => (
                  <div key={candidate.staff_id} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg border border-gray-100">
                    <div className="flex items-center gap-2.5">
                      <span className={`w-5 h-5 rounded-full text-xs flex items-center justify-center font-bold text-white ${
                        idx === 0 ? 'bg-green-500' : idx === 1 ? 'bg-sky-500' : 'bg-gray-400'
                      }`}>
                        {idx + 1}
                      </span>
                      <div>
                        <p className="text-sm font-medium text-gray-800">{candidate.staff.name}</p>
                        <p className="text-xs text-gray-500">{candidate.reason}</p>
                      </div>
                    </div>
                    <div className="text-right text-xs text-gray-500">
                      <p>{candidate.rest_hours}h rest</p>
                      <p>{candidate.current_load} shifts</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Action buttons */}
          {isOpen && !action && (
            <div className="flex gap-2 flex-wrap">
              {canFindReplacement && (
                <button
                  onClick={() => navigate(`/last-minute?date=${flag.affected_date}`)}
                  className="btn-primary btn-sm text-xs"
                >
                  🚑 Find Replacement
                </button>
              )}
              <button onClick={() => startAction('resolve')} className="btn-success btn-sm text-xs">
                ✓ Resolve
              </button>
              <button onClick={() => startAction('defer')} className="btn-secondary btn-sm text-xs">
                ⏰ Defer
              </button>
              <button onClick={() => startAction('dismiss')} className="btn-secondary btn-sm text-xs">
                × Dismiss
              </button>
              {flag.severity === 'critical' && (
                <button
                  onClick={() => startAction('reject')}
                  className="btn-secondary btn-sm text-xs text-red-600 border-red-200 hover:bg-red-50"
                >
                  ⊘ Reject
                </button>
              )}
              <button onClick={handleNotify} disabled={notifying} className="btn-secondary btn-sm text-xs">
                {notifying ? 'Notifying…' : '🔔 Notify'}
              </button>
              <button onClick={toggleHistory} className="btn-secondary btn-sm text-xs">
                🕘 History
              </button>
            </div>
          )}

          {/* Reopen / history for closed flags */}
          {canReopen && !action && (
            <div className="flex gap-2 flex-wrap">
              <button onClick={handleReopen} disabled={loading} className="btn-secondary btn-sm text-xs">
                {loading ? 'Reopening…' : '↺ Reopen'}
              </button>
              <button onClick={toggleHistory} className="btn-secondary btn-sm text-xs">
                🕘 History
              </button>
            </div>
          )}

          {/* Inline action form */}
          {action && action !== 'reopen' && (
            <div className="bg-gray-50 rounded-xl p-3 space-y-2">
              <p className="text-xs font-semibold text-gray-700">
                {action === 'resolve' && '✅ Resolving flag — reason required'}
                {action === 'dismiss' && '× Dismissing flag — reason required'}
                {action === 'defer' && '⏰ Deferring flag — pick a date'}
                {action === 'reject' && `⊘ Rejecting flag — reason (min ${REASON_MIN.reject} chars) required`}
              </p>
              {action === 'defer' && (
                <input
                  type="date"
                  value={deferUntil}
                  onChange={(e) => setDeferUntil(e.target.value)}
                  className="input text-xs w-44"
                  autoFocus
                />
              )}
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                className="input text-xs resize-none"
                placeholder={action === 'defer' ? 'Optional note...' : 'Enter reason...'}
                autoFocus={action !== 'defer'}
              />
              {action === 'reject' && reason.trim().length > 0 && reason.trim().length < REASON_MIN.reject && (
                <p className="text-xs text-amber-600">
                  {REASON_MIN.reject - reason.trim().length} more character(s) needed.
                </p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={handleAction}
                  disabled={loading || !reasonOk || !deferOk}
                  className={`btn-sm ${action === 'resolve' ? 'btn-success' : 'btn-secondary'}`}
                >
                  {loading ? <LoadingSpinner size="sm" color={action === 'resolve' ? 'border-white' : 'border-gray-600'} /> : 'Confirm'}
                </button>
                <button
                  onClick={() => { setAction(null); setReason(''); setDeferUntil(''); }}
                  disabled={loading}
                  className="btn-secondary btn-sm text-xs"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Audit history */}
          {showHistory && (
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Audit history</p>
              {historyLoading ? (
                <LoadingSpinner size="sm" />
              ) : history && history.length > 0 ? (
                <ul className="space-y-1.5">
                  {history.map((h) => {
                    const prev = h.details?.previous_status as string | undefined;
                    const next = h.details?.new_status as string | undefined;
                    const note = (h.details?.reason ?? h.details?.note) as string | undefined;
                    return (
                      <li key={h.log_id} className="text-xs text-gray-600 flex flex-wrap gap-x-2">
                        <span className="text-gray-400">{format(new Date(h.created_at), 'dd MMM HH:mm')}</span>
                        <span className="font-medium text-gray-800 capitalize">{h.action}</span>
                        {prev && next && (
                          <span className="text-gray-500">{prev} → {next}</span>
                        )}
                        <span className="text-gray-400">by {h.profiles?.name ?? 'Unknown'}</span>
                        {note && <span className="italic text-gray-500 w-full">"{note}"</span>}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-xs text-gray-400">No history recorded.</p>
              )}
            </div>
          )}

          {/* Resolved / closed info */}
          {!isOpen && flag.resolved_at && (
            <div className="text-xs text-gray-500">
              {flag.status === 'resolved' ? 'Resolved' :
               flag.status === 'auto_resolved' ? 'Auto-resolved by the system' :
               flag.status === 'rejected' ? 'Rejected' : 'Dismissed'} on{' '}
              {format(new Date(flag.resolved_at), 'dd MMM yyyy HH:mm')}
              {flag.resolution_reason && (
                <p className="mt-1 italic">"{flag.resolution_reason}"</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
