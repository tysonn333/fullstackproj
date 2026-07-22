import React, { useState } from 'react';
import { flagsApi } from '../../api/flags';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { useToast } from '../../components/Toast';

type BulkAction = 'resolve' | 'defer' | 'dismiss';

interface BulkActionModalProps {
  selectedIds: string[];
  onClose: () => void;
  onComplete: (action: BulkAction, count: number) => void;
}

// Minimum reason length per action (Chad UC-008 parity: dismiss needs >= 10).
const REASON_MIN: Record<string, number> = { dismiss: 10 };

export const BulkActionModal: React.FC<BulkActionModalProps> = ({
  selectedIds,
  onClose,
  onComplete,
}) => {
  const [action, setAction] = useState<BulkAction | null>(null);
  const [reason, setReason] = useState('');
  const [deferUntil, setDeferUntil] = useState('');
  const [loading, setLoading] = useState(false);
  const { success, error: toastError } = useToast();

  const reasonMin = action ? REASON_MIN[action] ?? 0 : 0;
  const reasonOk = action === 'defer' ? true : reasonMin > 0 ? reason.trim().length >= reasonMin : reason.trim().length > 0;
  const deferOk = action !== 'defer' || Boolean(deferUntil);
  const canSubmit = Boolean(action) && reasonOk && deferOk && !loading;

  const handleSubmit = async () => {
    if (!action || !canSubmit) return;
    setLoading(true);
    try {
      let count = 0;
      if (action === 'resolve') {
        count = (await flagsApi.bulkResolve(selectedIds, reason)).resolved;
        success('Flags resolved', `${count} flag(s) have been resolved.`);
      } else if (action === 'dismiss') {
        count = (await flagsApi.bulkDismiss(selectedIds, reason)).dismissed;
        success('Flags dismissed', `${count} flag(s) have been dismissed.`);
      } else {
        count = (await flagsApi.bulkDefer(selectedIds, deferUntil, reason || undefined)).deferred;
        success('Flags deferred', `${count} flag(s) snoozed until ${deferUntil}.`);
      }
      onComplete(action, count);
      onClose();
    } catch {
      toastError('Bulk action failed', 'Could not process all flags. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const actionButtons: { key: BulkAction; icon: string; label: string; hint: string; activeClass: string }[] = [
    { key: 'resolve', icon: '✅', label: 'Resolve All', hint: 'Issue has been addressed', activeClass: 'border-green-500 bg-green-50' },
    { key: 'defer', icon: '⏰', label: 'Defer All', hint: 'Snooze until a chosen date', activeClass: 'border-sky-400 bg-sky-50' },
    { key: 'dismiss', icon: '×', label: 'Dismiss All', hint: 'No action needed', activeClass: 'border-amber-400 bg-amber-50' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Bulk Action</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              Acting on <span className="font-semibold text-blue-600">{selectedIds.length}</span> selected flag(s)
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* Action selection */}
          <div>
            <p className="label mb-2">Select Action</p>
            <div className="grid grid-cols-3 gap-3">
              {actionButtons.map((b) => (
                <button
                  key={b.key}
                  onClick={() => setAction(b.key)}
                  className={`p-4 rounded-xl border-2 text-left transition-all ${
                    action === b.key ? b.activeClass : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">{b.icon}</span>
                    <span className="font-semibold text-gray-900 text-sm">{b.label}</span>
                  </div>
                  <p className="text-xs text-gray-500">{b.hint}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Defer date */}
          {action === 'defer' && (
            <div className="form-group">
              <label className="label">Defer until *</label>
              <input
                type="date"
                value={deferUntil}
                onChange={(e) => setDeferUntil(e.target.value)}
                className="input w-48"
                autoFocus
              />
            </div>
          )}

          {/* Reason */}
          {action && (
            <div className="form-group">
              <label className="label">
                Reason {action === 'defer' ? <span className="text-xs text-gray-400 font-normal">(optional)</span> : '*'}
                {reasonMin > 0 && <span className="text-xs text-gray-400 font-normal"> (min {reasonMin} chars)</span>}
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                className="input resize-none"
                placeholder={`Explain why you are ${action === 'resolve' ? 'resolving' : action === 'defer' ? 'deferring' : 'dismissing'} these flags...`}
                autoFocus={action !== 'defer'}
              />
              {reasonMin > 0 && reason.trim().length > 0 && reason.trim().length < reasonMin && (
                <p className="text-xs text-amber-600 mt-1">{reasonMin - reason.trim().length} more character(s) needed.</p>
              )}
              {action !== 'defer' && !reason.trim() && (
                <p className="text-xs text-amber-600 mt-1">A reason is required to proceed.</p>
              )}
            </div>
          )}

          {/* Warning banner */}
          <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
            <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            <p>This action applies to all {selectedIds.length} selected flags and is recorded in the audit log.</p>
          </div>

          {/* Submit */}
          <div className="flex gap-3 pt-2">
            <button onClick={onClose} disabled={loading} className="btn-secondary flex-1">
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className={`flex-1 ${action === 'resolve' ? 'btn-success' : action === 'dismiss' ? 'btn-warning' : 'btn-primary'}`}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <LoadingSpinner size="sm" color="border-white" />
                  Processing...
                </span>
              ) : (
                `Apply to ${selectedIds.length} Flag(s)`
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
