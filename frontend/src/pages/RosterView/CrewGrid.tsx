import React, { useState } from 'react';
import type { ShiftSlot, Staff } from '../../types';

interface CrewGridProps {
  slots: ShiftSlot[];
  date: string;
  isReadOnly: boolean;
  isWeekendOrHoliday: boolean;
  onStaffClick: (staff: Staff) => void;
  exceptionsPanel?: React.ReactNode;
}

const jobTypeBadge: Record<string, string> = {
  MTS: 'bg-blue-100 text-blue-700 border border-blue-200',
  EAS: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
};

const statusBadge: Record<string, string> = {
  scheduled: 'badge-blue',
  active: 'badge-green',
  completed: 'badge-gray',
  cancelled: 'badge-red',
  unfilled: 'badge-yellow',
};

const roleBadge: Record<string, string> = {
  driver: 'bg-sky-100 text-sky-700',
  medic: 'bg-green-100 text-green-700',
  emt: 'bg-violet-100 text-violet-700',
  paramedic: 'bg-orange-100 text-orange-700',
};

function calcHours(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let diff = (eh * 60 + em) - (sh * 60 + sm);
  if (diff < 0) diff += 24 * 60;
  return parseFloat((diff / 60).toFixed(1));
}

export const CrewGrid: React.FC<CrewGridProps> = ({
  slots,
  date,
  isReadOnly,
  isWeekendOrHoliday,
  onStaffClick,
  exceptionsPanel,
}) => {
  const [expandedSlot, setExpandedSlot] = useState<string | null>(null);

  const displaySlots = isWeekendOrHoliday ? slots.slice(0, 2) : slots;

  return (
    <div className="flex gap-4">
      {/* Main grid */}
      <div className="flex-1 overflow-hidden">
        {isWeekendOrHoliday && (
          <div className="mb-3 px-4 py-2 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2 text-sm text-amber-700">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            Weekend / Public Holiday — Reduced to 2 ambulances
          </div>
        )}

        {isReadOnly && (
          <div className="mb-3 px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg flex items-center gap-2 text-sm text-gray-600">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            Historical date — read-only view
          </div>
        )}

        {displaySlots.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p className="text-sm font-medium">No roster found for {date}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {displaySlots.map((slot) => {
              const isExpanded = expandedSlot === slot.id;
              const hours = slot.shift_start && slot.shift_end
                ? calcHours(slot.shift_start, slot.shift_end)
                : null;
              const assignments = slot.assignments || [];
              const hasConsecutiveWarning = assignments.some((a) =>
                (a.staff as Staff & { consecutive_days?: number })?.consecutive_days !== undefined &&
                ((a.staff as Staff & { consecutive_days?: number })?.consecutive_days ?? 0) >= 7
              );

              return (
                <div
                  key={slot.id}
                  className={`card overflow-hidden transition-shadow ${
                    isExpanded ? 'shadow-card-hover ring-1 ring-blue-200' : ''
                  }`}
                >
                  {/* Slot header row */}
                  <div
                    className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
                    onClick={() => setExpandedSlot(isExpanded ? null : slot.id)}
                  >
                    {/* Ambulance info */}
                    <div className="flex-shrink-0 w-24 text-center">
                      <p className="text-sm font-bold text-gray-900">
                        {slot.ambulance?.call_sign || `AMB-${slot.id.slice(-4)}`}
                      </p>
                      <p className="text-xs text-gray-400">{slot.ambulance?.vehicle_number}</p>
                    </div>

                    {/* Job type */}
                    <span className={`badge text-xs font-semibold ${jobTypeBadge[slot.job_type] || 'badge-gray'}`}>
                      {slot.job_type}
                    </span>

                    {/* Shift time */}
                    <div className="flex-shrink-0 text-sm text-gray-700">
                      <span className="font-medium">{slot.shift_start?.slice(0, 5)}</span>
                      <span className="text-gray-400 mx-1">—</span>
                      <span className="font-medium">{slot.shift_end?.slice(0, 5)}</span>
                      {hours && (
                        <span className="text-xs text-gray-400 ml-1">({hours}h)</span>
                      )}
                    </div>

                    {/* Required role */}
                    <span className={`badge capitalize text-xs ${roleBadge[slot.required_role] || 'badge-gray'}`}>
                      {slot.required_role}
                    </span>

                    {/* Crew names */}
                    <div className="flex-1 flex items-center gap-2 flex-wrap">
                      {assignments.length === 0 ? (
                        <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                          Unfilled
                        </span>
                      ) : (
                        assignments.map((a) => (
                          <button
                            key={a.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (a.staff) onStaffClick(a.staff);
                            }}
                            className="flex items-center gap-1.5 px-2 py-1 bg-white border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-colors text-xs"
                          >
                            <span className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center text-blue-700 font-bold text-[10px]">
                              {a.staff?.name?.charAt(0) || '?'}
                            </span>
                            <span className="font-medium text-gray-800">{a.staff?.name || 'Unknown'}</span>
                            {(a.staff as Staff & { consecutive_days?: number })?.consecutive_days !== undefined &&
                              ((a.staff as Staff & { consecutive_days?: number })?.consecutive_days ?? 0) >= 7 && (
                              <span className="text-red-500" title="7th consecutive day!">⚠️</span>
                            )}
                          </button>
                        ))
                      )}
                    </div>

                    {/* Status */}
                    <span className={`badge capitalize ${statusBadge[slot.status] || 'badge-gray'}`}>
                      {slot.status}
                    </span>

                    {/* Consecutive day warning */}
                    {hasConsecutiveWarning && (
                      <span className="badge-red badge text-xs font-semibold animate-pulse">
                        7-day alert
                      </span>
                    )}

                    {/* Expand chevron */}
                    <svg
                      className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="border-t border-gray-100 bg-gray-50 px-4 py-3">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                        <div>
                          <p className="text-xs text-gray-500 mb-1">Slot ID</p>
                          <p className="font-mono text-xs text-gray-700">{slot.id}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500 mb-1">Date</p>
                          <p className="font-medium text-gray-800">{slot.shift_date}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500 mb-1">Assigned Staff</p>
                          <p className="font-medium text-gray-800">{assignments.length} / {assignments.length || 1}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500 mb-1">Job Type</p>
                          <p className="font-medium text-gray-800">{slot.job_type}</p>
                        </div>
                      </div>

                      {assignments.length > 0 && (
                        <div className="mt-3 space-y-2">
                          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Staff Details</p>
                          {assignments.map((a) => (
                            <div
                              key={a.id}
                              className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-gray-100"
                            >
                              <div className="flex items-center gap-2">
                                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-700 font-bold text-xs">
                                  {a.staff?.name?.charAt(0) || '?'}
                                </div>
                                <div>
                                  <p
                                    className="text-sm font-medium text-blue-600 hover:underline cursor-pointer"
                                    onClick={() => a.staff && onStaffClick(a.staff)}
                                  >
                                    {a.staff?.name}
                                  </p>
                                  <p className="text-xs text-gray-500 capitalize">{a.staff?.role}</p>
                                </div>
                              </div>
                              <div className="text-right">
                                <span className={`badge capitalize text-xs ${
                                  a.status === 'confirmed' ? 'badge-green' :
                                  a.status === 'dropped' ? 'badge-red' :
                                  a.status === 'swapped' ? 'badge-yellow' : 'badge-blue'
                                }`}>
                                  {a.status}
                                </span>
                                {a.swap_reason && (
                                  <p className="text-xs text-gray-400 mt-0.5">{a.swap_reason}</p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Exceptions sidebar */}
      {exceptionsPanel && (
        <div className="w-72 flex-shrink-0">
          {exceptionsPanel}
        </div>
      )}
    </div>
  );
};
