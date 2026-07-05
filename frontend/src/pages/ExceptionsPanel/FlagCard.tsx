import React, { useState } from 'react';
import { format, parseISO, isValid } from 'date-fns';
import { flagsApi } from '../../api/flags';
import { useToast } from '../../components/Toast';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import type { Flag } from '../../types';

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
    border: 'border-l-blue-400',
    bg: 'bg-blue-50',
    icon: 'ℹ️',
    dot: 'bg-blue-400',
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

export const FlagCard: React.FC<FlagCardProps> = ({
  flag,
  selected = false,
  onSelect,
  onUpdate,
  bulkMode = false,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [action, setAction] = useState<'resolve' | 'dismiss' | null>(null);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const { success, error: toastError } = useToast();

  const config = severityConfig[flag.severity];
  const isActive = flag.status === 'active';

  const handleAction = async () => {
    if (!reason.trim()) {
      toastError('Reason required', 'Please provide a reason before proceeding.');
      return;
    }
    setLoading(true);
    try {
      let updated: Flag;
      if (action === 'resolve') {
        updated = await flagsApi.resolve(flag.id, reason);
        success('Flag resolved', flag.title);
      } else {
        updated = await flagsApi.dismiss(flag.id, reason);
        success('Flag dismissed', flag.title);
      }
      onUpdate(updated);
      setAction(null);
      setReason('');
    } catch {
      toastError('Action failed', 'Could not update the flag. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className={`
        card overflow-hidden border-l-4 transition-all
        ${config.border}
        ${selected ? 'ring-2 ring-blue-400' : ''}
        ${flag.status !== 'active' ? 'opacity-60' : ''}
      `}
    >
      {/* Header row */}
      <div
        className={`flex items-start gap-3 p-4 cursor-pointer hover:bg-gray-50 transition-colors ${config.bg}`}
        onClick={() => setExpanded(!expanded)}
      >
        {/* Bulk checkbox */}
        {bulkMode && isActive && (
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
                <span className={`badge text-xs ${flag.status === 'resolved' ? 'badge-green' : 'badge-gray'}`}>
                  {flag.status}
                </span>
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
                        idx === 0 ? 'bg-green-500' : idx === 1 ? 'bg-blue-500' : 'bg-gray-400'
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
          {isActive && !action && (
            <div className="flex gap-2">
              <button
                onClick={() => setAction('resolve')}
                className="btn-success btn-sm text-xs"
              >
                ✓ Resolve
              </button>
              <button
                onClick={() => setAction('dismiss')}
                className="btn-secondary btn-sm text-xs"
              >
                × Dismiss
              </button>
            </div>
          )}

          {/* Inline action form */}
          {action && (
            <div className="bg-gray-50 rounded-xl p-3 space-y-2">
              <p className="text-xs font-semibold text-gray-700">
                {action === 'resolve' ? '✅ Resolving flag' : '× Dismissing flag'} — reason required
              </p>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                className="input text-xs resize-none"
                placeholder="Enter reason..."
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  onClick={handleAction}
                  disabled={loading || !reason.trim()}
                  className={`btn-sm ${action === 'resolve' ? 'btn-success' : 'btn-secondary'}`}
                >
                  {loading ? <LoadingSpinner size="sm" color={action === 'resolve' ? 'border-white' : 'border-gray-600'} /> : 'Confirm'}
                </button>
                <button
                  onClick={() => { setAction(null); setReason(''); }}
                  disabled={loading}
                  className="btn-secondary btn-sm text-xs"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Resolved info */}
          {flag.status !== 'active' && flag.resolved_at && (
            <div className="text-xs text-gray-500">
              {flag.status === 'resolved' ? 'Resolved' : 'Dismissed'} on{' '}
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
