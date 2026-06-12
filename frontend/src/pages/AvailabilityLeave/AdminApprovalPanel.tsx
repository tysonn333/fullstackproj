import React, { useState } from 'react';
import { format } from 'date-fns';
import { availabilityApi } from '../../api/availability';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { useToast } from '../../components/Toast';
import type { LeaveRequest } from '../../types';

interface AdminApprovalPanelProps {
  requests: LeaveRequest[];
  loading: boolean;
  onUpdate: (req: LeaveRequest) => void;
}

const leaveTypeLabels: Record<string, string> = {
  full_day: 'Full Day',
  half_am: 'Half Day (AM)',
  half_pm: 'Half Day (PM)',
};

const leaveTypeColors: Record<string, string> = {
  full_day: 'badge-blue',
  half_am: 'bg-purple-100 text-purple-700',
  half_pm: 'bg-indigo-100 text-indigo-700',
};

interface ActionState {
  [requestId: string]: {
    type: 'approve' | 'reject' | null;
    notes: string;
    loading: boolean;
  };
}

export const AdminApprovalPanel: React.FC<AdminApprovalPanelProps> = ({
  requests,
  loading,
  onUpdate,
}) => {
  const [actions, setActions] = useState<ActionState>({});
  const { success, error: toastError } = useToast();

  const startAction = (id: string, type: 'approve' | 'reject') => {
    setActions((prev) => ({
      ...prev,
      [id]: { type, notes: '', loading: false },
    }));
  };

  const cancelAction = (id: string) => {
    setActions((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const setNotes = (id: string, notes: string) => {
    setActions((prev) => ({
      ...prev,
      [id]: { ...prev[id], notes },
    }));
  };

  const execute = async (req: LeaveRequest) => {
    const action = actions[req.id];
    if (!action || action.loading) return;

    setActions((prev) => ({ ...prev, [req.id]: { ...prev[req.id], loading: true } }));
    try {
      let updated: LeaveRequest;
      if (action.type === 'approve') {
        updated = await availabilityApi.approveLeaveRequest(req.id, action.notes);
        success(
          'Leave approved',
          `${req.staff?.name || 'Staff'}'s leave from ${format(new Date(req.start_date), 'dd MMM')} has been approved.`
        );
      } else {
        updated = await availabilityApi.rejectLeaveRequest(req.id, action.notes);
        success('Leave rejected', `${req.staff?.name || 'Staff'}'s leave request has been rejected.`);
      }
      onUpdate(updated);
      cancelAction(req.id);
    } catch {
      toastError('Action failed', 'Could not process the request. Please try again.');
      setActions((prev) => ({ ...prev, [req.id]: { ...prev[req.id], loading: false } }));
    }
  };

  const pending = requests.filter((r) => r.status === 'pending');
  const processed = requests.filter((r) => r.status !== 'pending');

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <LoadingSpinner size="md" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Pending */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <h4 className="font-semibold text-gray-900">Pending Requests</h4>
          {pending.length > 0 && (
            <span className="badge-yellow badge">{pending.length}</span>
          )}
        </div>

        {pending.length === 0 ? (
          <div className="text-center py-8 bg-gray-50 rounded-xl border border-gray-100">
            <svg className="w-10 h-10 mx-auto mb-2 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm text-gray-500">No pending requests</p>
          </div>
        ) : (
          <div className="space-y-3">
            {pending.map((req) => {
              const action = actions[req.id];
              return (
                <div key={req.id} className="card overflow-hidden">
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className="w-9 h-9 bg-blue-100 rounded-full flex items-center justify-center text-blue-700 font-bold text-sm flex-shrink-0">
                          {req.staff?.name?.charAt(0) || '?'}
                        </div>
                        <div>
                          <p className="font-semibold text-gray-900 text-sm">{req.staff?.name || `Staff #${req.staff_id.slice(-6)}`}</p>
                          <div className="flex flex-wrap items-center gap-2 mt-1">
                            <span className={`badge text-xs ${leaveTypeColors[req.leave_type] || 'badge-gray'}`}>
                              {leaveTypeLabels[req.leave_type]}
                            </span>
                            <span className="text-xs text-gray-600">
                              {format(new Date(req.start_date), 'dd MMM yyyy')}
                              {req.start_date !== req.end_date && (
                                <> &mdash; {format(new Date(req.end_date), 'dd MMM yyyy')}</>
                              )}
                            </span>
                          </div>
                          {req.reason && (
                            <p className="text-xs text-gray-500 mt-1 italic">"{req.reason}"</p>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2 flex-shrink-0">
                        {!action && (
                          <>
                            <button
                              onClick={() => startAction(req.id, 'approve')}
                              className="btn-success btn-sm text-xs"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => startAction(req.id, 'reject')}
                              className="btn-danger btn-sm text-xs"
                            >
                              Reject
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Inline action form */}
                    {action && (
                      <div className="mt-3 pt-3 border-t border-gray-100">
                        <p className="text-xs font-semibold text-gray-600 mb-2">
                          {action.type === 'approve' ? '✅ Approving' : '❌ Rejecting'} — Add notes (optional)
                        </p>
                        <textarea
                          value={action.notes}
                          onChange={(e) => setNotes(req.id, e.target.value)}
                          rows={2}
                          className="input text-xs resize-none"
                          placeholder="Optional notes for the staff member..."
                        />
                        <div className="flex gap-2 mt-2">
                          <button
                            onClick={() => execute(req)}
                            disabled={action.loading}
                            className={`btn-sm ${action.type === 'approve' ? 'btn-success' : 'btn-danger'}`}
                          >
                            {action.loading ? (
                              <LoadingSpinner size="sm" color="border-white" />
                            ) : (
                              `Confirm ${action.type === 'approve' ? 'Approval' : 'Rejection'}`
                            )}
                          </button>
                          <button
                            onClick={() => cancelAction(req.id)}
                            disabled={action.loading}
                            className="btn-secondary btn-sm"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Processed */}
      {processed.length > 0 && (
        <div>
          <h4 className="font-semibold text-gray-900 mb-3">Recent Decisions</h4>
          <div className="space-y-2">
            {processed.slice(0, 10).map((req) => (
              <div key={req.id} className="flex items-center justify-between px-4 py-3 bg-gray-50 rounded-xl border border-gray-100">
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 bg-gray-200 rounded-full flex items-center justify-center text-gray-600 font-bold text-xs">
                    {req.staff?.name?.charAt(0) || '?'}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-800">{req.staff?.name}</p>
                    <p className="text-xs text-gray-500">
                      {format(new Date(req.start_date), 'dd MMM')}
                      {req.start_date !== req.end_date && ` — ${format(new Date(req.end_date), 'dd MMM')}`}
                      {' · '}{leaveTypeLabels[req.leave_type]}
                    </p>
                  </div>
                </div>
                <span className={`badge ${req.status === 'approved' ? 'badge-green' : 'badge-red'}`}>
                  {req.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
