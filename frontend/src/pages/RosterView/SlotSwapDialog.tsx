import React, { useState, useEffect } from 'react';
import { rosterApi } from '../../api/roster';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import type { ShiftSlot, Staff } from '../../types';

interface SlotSwapDialogProps {
  slot: ShiftSlot;
  rosterId: string;
  role: 'driver' | 'attendant';
  onClose: () => void;
  onSwap: () => void;
}

interface SwapCandidate {
  staff: Staff;
  score: number;
  score_breakdown: {
    fairness: number;
    rest: number;
    preference: number;
    continuity: number;
  };
  rest_hours: number;
  late_shift_count: number;
  reason: string;
}

const FACTORS = [
  { key: 'fairness' as const, label: 'Fairness', weight: 30 },
  { key: 'rest' as const, label: 'Rest', weight: 30 },
  { key: 'preference' as const, label: 'Preference', weight: 20 },
  { key: 'continuity' as const, label: 'Continuity', weight: 20 },
];

export const SlotSwapDialog: React.FC<SlotSwapDialogProps> = ({
  slot,
  rosterId,
  role,
  onClose,
  onSwap,
}) => {
  const [candidates, setCandidates] = useState<SwapCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentAssignment = (slot.assignments ?? []).find(
    (a) => a.staff?.role === role
  );

  useEffect(() => {
    setLoading(true);
    rosterApi.getReplacementCandidates(slot.id)
      .then(setCandidates)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [slot.id]);

  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const minScore = sorted.length > 0 ? sorted[sorted.length - 1].score : 0;
  const maxScore = sorted.length > 0 ? sorted[0].score : 0;
  const scoreRange = maxScore - minScore || 1;

  function heatColor(score: number): string {
    const ratio = (score - minScore) / scoreRange;
    const hue = Math.round(ratio * 120);
    return `hsl(${hue}, 75%, 45%)`;
  }

  function heatBg(score: number): string {
    const ratio = (score - minScore) / scoreRange;
    const hue = Math.round(ratio * 120);
    return `hsl(${hue}, 60%, 95%)`;
  }

  function breakdownColor(val: number): string {
    const hue = Math.round(val * 120);
    return `hsl(${hue}, 65%, 40%)`;
  }

  function breakdownBarBg(val: number): string {
    const hue = Math.round(val * 120);
    return `hsl(${hue}, 55%, 88%)`;
  }

  const handleAssign = async (staffId: string) => {
    setAssigning(staffId);
    setError(null);
    try {
      await rosterApi.confirmSwap(slot.id, staffId, `Manual ${role} assignment`);
      onSwap();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Assignment failed';
      setError(msg);
    } finally {
      setAssigning(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white px-5 py-4 border-b border-gray-100 flex items-center justify-between rounded-t-2xl">
          <div>
            <h3 className="font-semibold text-gray-900 capitalize">{role}</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {slot.shift_start?.slice(0, 5)}–{slot.shift_end?.slice(0, 5)}
              {' · '}{slot.ambulance?.call_sign}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5">
          {currentAssignment?.staff && (
            <div className="mb-4">
              <p className="text-xs text-gray-500 mb-1.5">Currently assigned</p>
              <div className="flex items-center gap-2.5 bg-blue-50 rounded-lg px-3 py-2">
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-700 font-bold text-xs">
                  {currentAssignment.staff.name.charAt(0)}
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">{currentAssignment.staff.name}</p>
                  <p className="text-xs text-gray-500 capitalize">{currentAssignment.staff.employment_type.replace('_', ' ')}</p>
                </div>
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex justify-center py-8">
              <LoadingSpinner size="md" />
            </div>
          ) : error && candidates.length === 0 ? (
            <div className="bg-red-50 text-red-700 text-sm p-3 rounded-lg">{error}</div>
          ) : candidates.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <svg className="w-8 h-8 mx-auto mb-2 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm">No eligible candidates</p>
            </div>
          ) : (
            <div className="space-y-3">
              {sorted.map((c) => {
                const isCurrent = c.staff.id === currentAssignment?.staff_id;
                const isAssigning = assigning === c.staff.id;
                const color = heatColor(c.score);
                const bg = heatBg(c.score);
                const sb = c.score_breakdown;

                return (
                  <div
                    key={c.staff.id}
                    className={`rounded-xl border-l-4 transition-all ${
                      isCurrent ? 'border-blue-400 bg-blue-50/50 ring-1 ring-blue-200' : 'hover:shadow-md border-gray-200'
                    }`}
                    style={{
                      borderLeftColor: isCurrent ? undefined : color,
                      backgroundColor: isCurrent ? undefined : bg,
                    }}
                  >
                    {/* Header */}
                    <div className="px-3 pt-3 pb-2 flex items-center justify-between">
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
                          style={{ backgroundColor: color }}
                        >
                          {c.staff.name.charAt(0)}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">{c.staff.name}</p>
                          <p className="text-xs text-gray-500 capitalize">{c.staff.role}</p>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0 ml-2">
                        <p className="text-lg font-bold" style={{ color }}>{c.score.toFixed(1)}</p>
                        <p className="text-[9px] text-gray-400 uppercase tracking-wide">Score</p>
                      </div>
                    </div>

                    {/* Score breakdown bars */}
                    <div className="px-3 pb-1 space-y-1.5">
                      {FACTORS.map((f) => {
                        const val = sb[f.key];
                        return (
                          <div key={f.key} className="flex items-center gap-2">
                            <span className="text-[10px] text-gray-500 w-16 flex-shrink-0">{f.label}</span>
                            <div className="flex-1 h-3 rounded-full overflow-hidden bg-gray-100">
                              <div
                                className="h-full rounded-full transition-all"
                                style={{
                                  width: `${Math.round(val * 100)}%`,
                                  backgroundColor: breakdownColor(val),
                                }}
                              />
                            </div>
                            <span className="text-[10px] font-medium text-gray-600 w-8 text-right">
                              {Math.round(val * 100)}%
                            </span>
                            <span className="text-[9px] text-gray-400 w-5 text-right">{f.weight}%</span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Stats footer */}
                    <div className="px-3 pb-3 pt-1.5 flex items-center justify-between text-[10px] text-gray-500">
                      <span>{c.rest_hours.toFixed(1)}h rest since last shift</span>
                      <span>{c.late_shift_count} late shift(s) this month</span>
                    </div>

                    {/* Action button */}
                    <div className="px-3 pb-3">
                      <button
                        onClick={() => handleAssign(c.staff.id)}
                        disabled={isAssigning || isCurrent}
                        className={`w-full btn-sm text-xs font-semibold ${
                          isCurrent
                            ? 'btn-secondary opacity-50 cursor-not-allowed'
                            : 'text-white'
                        }`}
                        style={isCurrent ? {} : { backgroundColor: color, borderColor: color }}
                      >
                        {isAssigning ? (
                          <span className="flex items-center justify-center gap-1.5">
                            <LoadingSpinner size="sm" color="border-white" />
                            Assigning...
                          </span>
                        ) : isCurrent ? (
                          'Currently Assigned'
                        ) : (
                          'Assign to Slot'
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {error && candidates.length > 0 && (
            <p className="text-xs text-red-600 mt-3">{error}</p>
          )}
        </div>
      </div>
    </div>
  );
};