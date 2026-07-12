import React from 'react';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import type { Staff } from '../../types';

interface Candidate {
  staff: Staff;
  current_load: number;
  rest_hours: number;
  active_flags: number;
  score: number;
  reason: string;
  proximity_km?: number;
}

interface CandidateListProps {
  candidates: Candidate[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (staffId: string) => void;
}

const roleColors: Record<string, string> = {
  driver: 'bg-blue-100 text-blue-700',
  medic: 'bg-green-100 text-green-700',
  emt: 'bg-purple-100 text-purple-700',
  paramedic: 'bg-orange-100 text-orange-700',
};

const getScoreColor = (score: number) => {
  if (score >= 80) return 'text-green-600 bg-green-50';
  if (score >= 60) return 'text-amber-600 bg-amber-50';
  return 'text-red-600 bg-red-50';
};

export const CandidateList: React.FC<CandidateListProps> = ({
  candidates,
  loading,
  selectedId,
  onSelect,
}) => {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <LoadingSpinner size="md" label="Finding replacement candidates..." />
      </div>
    );
  }

  if (candidates.length === 0) {
    return (
      <div className="text-center py-8">
        <svg className="w-10 h-10 mx-auto mb-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        </svg>
        <p className="text-sm font-medium text-gray-600">No replacement candidates found</p>
        <p className="text-xs text-gray-400 mt-1">All available staff may be scheduled or unavailable</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {candidates.map((candidate, index) => {
        const isSelected = selectedId === candidate.staff.id;
        const scoreColor = getScoreColor(candidate.score);
        const hasFlags = candidate.active_flags > 0;
        const lowRest = candidate.rest_hours < 8;

        return (
          <button
            key={candidate.staff.id}
            onClick={() => onSelect(candidate.staff.id)}
            className={`
              w-full text-left p-4 rounded-xl border-2 transition-all
              ${isSelected
                ? 'border-blue-500 bg-blue-50 shadow-sm'
                : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
              }
            `}
          >
            <div className="flex items-start gap-3">
              {/* Rank badge */}
              <div className={`
                flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white
                ${index === 0 ? 'bg-green-500' : index === 1 ? 'bg-blue-500' : index === 2 ? 'bg-purple-500' : 'bg-gray-400'}
              `}>
                {index + 1}
              </div>

              {/* Staff info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-gray-900">{candidate.staff.name}</p>
                  <span className={`badge capitalize text-xs ${roleColors[candidate.staff.role] || 'badge-gray'}`}>
                    {candidate.staff.role}
                  </span>
                  {candidate.staff.employment_type === 'part_time' && (
                    <span className="badge-gray badge text-xs">PT</span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-0.5">{candidate.reason}</p>

                {/* Metrics */}
                <div className="flex items-center gap-3 mt-2 flex-wrap">
                  <div className="flex items-center gap-1 text-xs">
                    <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                    <span className="text-gray-600">{candidate.current_load} shifts</span>
                  </div>
                  <div className={`flex items-center gap-1 text-xs ${lowRest ? 'text-red-600' : 'text-gray-600'}`}>
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>{candidate.rest_hours}h rest</span>
                    {lowRest && <span className="font-bold">⚠</span>}
                  </div>
                  {candidate.proximity_km != null && (
                    <div className="flex items-center gap-1 text-xs text-gray-600" title="Approx. distance from the station (UC-005 proximity)">
                      <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      <span>{candidate.proximity_km}km from base</span>
                    </div>
                  )}
                  {hasFlags && (
                    <div className="flex items-center gap-1 text-xs text-amber-600">
                      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                      <span>{candidate.active_flags} flag(s)</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Score */}
              <div className={`flex-shrink-0 px-2.5 py-1.5 rounded-xl text-center ${scoreColor}`}>
                <p className="text-lg font-bold leading-none">{candidate.score}</p>
                <p className="text-[10px] font-medium mt-0.5">score</p>
              </div>

              {/* Selection indicator */}
              {isSelected && (
                <div className="flex-shrink-0 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center">
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
};
