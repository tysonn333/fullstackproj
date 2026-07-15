import React, { useState, useEffect, useCallback } from 'react';
import {
  engineApi,
  SCORE_WEIGHTS,
  FILTER_LABELS,
  type EngineDecision,
  type RankedEngineCandidate,
  type EngineCandidate,
  type FilterStep,
} from '../../api/engine';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../hooks/useAuth';
import type { ShiftSlot } from '../../types';

interface EngineDecisionModalProps {
  slot: ShiftSlot;
  onClose: () => void;
  /** Called after a successful assignment so the parent can reload the roster. */
  onAssigned: () => void;
}

type Tab = 'ranked' | 'excluded';

const roleBadge: Record<string, string> = {
  driver: 'bg-sky-100 text-sky-700',
  medic: 'bg-green-100 text-green-700',
  emt: 'bg-purple-100 text-purple-700',
  paramedic: 'bg-orange-100 text-orange-700',
};

const rankCircle = (rank: number): string => {
  if (rank === 1) return 'bg-green-500';
  if (rank === 2) return 'bg-sky-500';
  if (rank === 3) return 'bg-purple-500';
  return 'bg-gray-400';
};

const scoreChipColor = (score: number): string => {
  if (score >= 70) return 'bg-green-100 text-green-700';
  if (score >= 50) return 'bg-amber-100 text-amber-700';
  return 'bg-red-100 text-red-700';
};

const barColor = (value: number): string => {
  if (value >= 0.7) return 'bg-green-500';
  if (value >= 0.4) return 'bg-amber-500';
  return 'bg-red-500';
};

function calcHours(start?: string, end?: string): number | null {
  if (!start || !end) return null;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let diff = eh * 60 + em - (sh * 60 + sm);
  if (diff < 0) diff += 24 * 60;
  return parseFloat((diff / 60).toFixed(1));
}

// ── Filter-trace chip (Excluded tab) ────────────────────────────────────────────
const FilterChip: React.FC<{ step: FilterStep; flagged: boolean }> = ({ step, flagged }) => {
  // Soft consecutive-days step reads as a warning only when it actually flagged.
  const isSoftFlag = step.soft && step.filter === 'consecutive_days' && flagged;
  const cls = !step.passed
    ? 'bg-red-50 text-red-700 border-red-200'
    : isSoftFlag
    ? 'bg-amber-50 text-amber-700 border-amber-200'
    : 'bg-green-50 text-green-700 border-green-200';
  const mark = !step.passed ? '✗' : isSoftFlag ? '⚠' : '✓';
  return (
    <span
      title={step.detail}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium ${cls}`}
    >
      <span>{mark}</span>
      {FILTER_LABELS[step.filter]}
    </span>
  );
};

// ── Ranked candidate card ────────────────────────────────────────────────────────
const RankedCard: React.FC<{
  candidate: RankedEngineCandidate;
  rank: number;
  expanded: boolean;
  onToggle: () => void;
  currentlyAssigned: boolean;
  canAssign: boolean;
  assigning: boolean;
  onAssign: () => void;
}> = ({ candidate, rank, expanded, onToggle, currentlyAssigned, canAssign, assigning, onAssign }) => {
  return (
    <div className={`card overflow-hidden transition-all ${expanded ? 'ring-1 ring-red-200 shadow-card-hover' : ''}`}>
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={onToggle}
      >
        {/* Rank circle */}
        <span className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white ${rankCircle(rank)}`}>
          {rank}
        </span>

        {/* Identity + subtitle */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-gray-900 text-sm">{candidate.full_name}</p>
            <span className={`badge capitalize text-xs ${roleBadge[candidate.role] || 'badge-gray'}`}>
              {candidate.role}
            </span>
            {candidate.employment_type === 'part_time' && (
              <span className="badge-gray badge text-xs">PT</span>
            )}
            {currentlyAssigned && (
              <span className="badge-green badge text-xs">currently assigned</span>
            )}
            {candidate.consecutive_days_flag && (
              <span className="badge-yellow badge text-xs" title="7+ consecutive working days with this shift">
                ⚠ streak
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {candidate.rest_hours}h rest · {candidate.proximity_km}km from base ·{' '}
            {candidate.late_shift_count} late shift{candidate.late_shift_count === 1 ? '' : 's'} this month
          </p>
        </div>

        {/* Score chip */}
        <div className={`flex-shrink-0 px-3 py-1.5 rounded-xl text-center ${scoreChipColor(candidate.score)}`}>
          <p className="text-lg font-bold leading-none">{candidate.score}</p>
          <p className="text-[10px] font-medium mt-0.5">score</p>
        </div>

        {/* Chevron */}
        <svg
          className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {/* Expanded: 6-component score breakdown */}
      {expanded && (
        <div className="border-t border-gray-100 bg-gray-50 px-4 py-3">
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
            Score breakdown (UC-005)
          </p>
          <div className="space-y-2">
            {SCORE_WEIGHTS.map(({ key, label, weight }) => {
              const value = candidate.score_breakdown[key];
              return (
                <div key={key} className="flex items-center gap-3">
                  <div className="w-28 flex-shrink-0 flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-700">{label}</span>
                    <span className="text-[10px] text-gray-400">{Math.round(weight * 100)}%</span>
                  </div>
                  <div className="flex-1 h-2.5 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${barColor(value)}`}
                      style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
                    />
                  </div>
                  <span className="w-10 flex-shrink-0 text-right text-xs font-mono text-gray-600">
                    {value.toFixed(2)}
                  </span>
                </div>
              );
            })}
          </div>

          {canAssign && (
            <div className="mt-3 flex justify-end">
              <button onClick={onAssign} disabled={assigning} className="btn-primary btn-sm">
                {assigning ? (
                  <span className="flex items-center gap-2">
                    <LoadingSpinner size="sm" color="border-white" />
                    Assigning…
                  </span>
                ) : (
                  `Assign ${candidate.full_name.split(' ')[0]} →`
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Excluded candidate row ───────────────────────────────────────────────────────
const ExcludedRow: React.FC<{ candidate: EngineCandidate }> = ({ candidate }) => (
  <div className="card px-4 py-3">
    <div className="flex items-center gap-2 flex-wrap">
      <p className="font-semibold text-gray-900 text-sm">{candidate.full_name}</p>
      <span className={`badge capitalize text-xs ${roleBadge[candidate.role] || 'badge-gray'}`}>
        {candidate.role}
      </span>
      {candidate.block_reason && (
        <span className="badge-red badge text-xs">{candidate.block_reason}</span>
      )}
    </div>
    <div className="mt-2 flex items-center gap-1.5 flex-wrap">
      {candidate.filter_trace.map((step, i) => (
        <FilterChip key={i} step={step} flagged={candidate.consecutive_days_flag} />
      ))}
    </div>
  </div>
);

// ── Modal ─────────────────────────────────────────────────────────────────────────
export const EngineDecisionModal: React.FC<EngineDecisionModalProps> = ({ slot, onClose, onAssigned }) => {
  const [decision, setDecision] = useState<EngineDecision | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('ranked');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [assigningId, setAssigningId] = useState<number | null>(null);

  const { success, error: toastError } = useToast();
  const { isAdmin } = useAuth();

  const isUnfilled = slot.status === 'unfilled';
  const assignedStaffIds = new Set(
    (slot.assignments || []).map((a) => a.staff?.id).filter(Boolean) as string[]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await engineApi.getDecision(slot.id);
      setDecision(data);
      // Auto-expand the top candidate on load.
      if (data.ranked.length > 0) setExpandedId(data.ranked[0].staff_id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load engine decision';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [slot.id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAssign = async (candidate: RankedEngineCandidate) => {
    setAssigningId(candidate.staff_id);
    try {
      await engineApi.assign(slot.id, candidate.staff_id);
      success('Crew assigned', `${candidate.full_name} was assigned to this slot via the engine.`);
      onAssigned();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Assignment failed';
      toastError('Assignment failed', msg);
      setAssigningId(null);
    }
  };

  const hours = calcHours(slot.shift_start, slot.shift_end);
  const rankedCount = decision?.ranked.length ?? 0;
  const excludedCount = decision?.excluded.length ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header + slot summary */}
        <div className="px-6 py-4 border-b border-gray-100 rounded-t-2xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-gray-900">
                Engine Decision — UC-004 Filter + UC-005 Ranking
              </h3>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap text-xs">
                <span className="font-semibold text-gray-800">
                  {slot.ambulance?.call_sign || `AMB-${slot.id.slice(-4)}`}
                </span>
                <span className="badge bg-sky-100 text-sky-700">{slot.job_type}</span>
                <span className="badge capitalize badge-gray">{slot.required_role}</span>
                <span className="text-gray-600">
                  {slot.shift_start?.slice(0, 5)}–{slot.shift_end?.slice(0, 5)}
                  {hours != null && <span className="text-gray-400 ml-1">({hours}h)</span>}
                </span>
                <span className="text-gray-400">· {slot.shift_date}</span>
                {isUnfilled && <span className="badge-yellow badge">Unfilled</span>}
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors flex-shrink-0"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 mt-4 -mb-px">
            <button
              onClick={() => setTab('ranked')}
              className={`px-3 py-1.5 rounded-t-lg text-sm font-medium border-b-2 transition-colors ${
                tab === 'ranked'
                  ? 'border-red-600 text-red-700'
                  : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              Eligible &amp; Ranked ({rankedCount})
            </button>
            <button
              onClick={() => setTab('excluded')}
              className={`px-3 py-1.5 rounded-t-lg text-sm font-medium border-b-2 transition-colors ${
                tab === 'excluded'
                  ? 'border-red-600 text-red-700'
                  : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              Excluded by Filters ({excludedCount})
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-2 bg-gray-50/50">
          {loading ? (
            <div className="py-12 flex justify-center">
              <LoadingSpinner size="md" label="Running filter + ranking pipeline…" />
            </div>
          ) : error ? (
            <div className="card p-6 text-center">
              <p className="text-red-600 font-medium text-sm">{error}</p>
              <button onClick={load} className="btn-secondary btn-sm mt-3">Try again</button>
            </div>
          ) : tab === 'ranked' ? (
            rankedCount === 0 ? (
              <div className="card p-8 text-center text-sm text-gray-500">
                No candidate passed all UC-004 filters for this slot. Check the
                “Excluded by Filters” tab to see why everyone was removed.
              </div>
            ) : (
              decision!.ranked.map((c, idx) => (
                <RankedCard
                  key={c.staff_id}
                  candidate={c}
                  rank={idx + 1}
                  expanded={expandedId === c.staff_id}
                  onToggle={() => setExpandedId(expandedId === c.staff_id ? null : c.staff_id)}
                  currentlyAssigned={assignedStaffIds.has(String(c.staff_id))}
                  canAssign={isUnfilled && isAdmin}
                  assigning={assigningId === c.staff_id}
                  onAssign={() => handleAssign(c)}
                />
              ))
            )
          ) : excludedCount === 0 ? (
            <div className="card p-8 text-center text-sm text-gray-500">
              No candidate was excluded — every active staff member passed the filters.
            </div>
          ) : (
            decision!.excluded.map((c) => <ExcludedRow key={c.staff_id} candidate={c} />)
          )}
        </div>

        {/* Footer note */}
        <div className="px-6 py-3 border-t border-gray-100 rounded-b-2xl bg-white">
          <p className="text-[11px] leading-relaxed text-gray-500">
            Filter order: Availability → 12h Rest → 12h Daily Cap → Consecutive Days (soft flag) →
            Certification. Score = 25% fairness + 20% rest + 20% proximity + 15% cert fit +
            10% preference + 10% continuity.
          </p>
        </div>
      </div>
    </div>
  );
};
