import React, { useState } from 'react';
import type { Assignment, ShiftSlot, Staff } from '../../types';

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

const MINUTES_PER_DAY = 24 * 60;

function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function calcHours(start: string, end: string): number {
  let diff = toMinutes(end) - toMinutes(start);
  if (diff < 0) diff += MINUTES_PER_DAY;
  return parseFloat((diff / 60).toFixed(1));
}

// A shift whose end is at or before its start crosses midnight (e.g. 20:00–08:00).
function isOvernight(start: string, end: string): boolean {
  return toMinutes(end) <= toMinutes(start);
}

// With irregular timings there is no fixed "day"/"night" split, so classify each
// slot by where its band actually starts. Overnight bands are their own group.
type ShiftPeriod = 'Morning' | 'Afternoon' | 'Evening' | 'Overnight' | 'Unscheduled';

const PERIOD_ORDER: ShiftPeriod[] = ['Morning', 'Afternoon', 'Evening', 'Overnight', 'Unscheduled'];

const periodAccent: Record<ShiftPeriod, string> = {
  Morning: 'bg-amber-100 text-amber-700 border border-amber-200',
  Afternoon: 'bg-sky-100 text-sky-700 border border-sky-200',
  Evening: 'bg-violet-100 text-violet-700 border border-violet-200',
  Overnight: 'bg-indigo-100 text-indigo-700 border border-indigo-200',
  Unscheduled: 'bg-gray-100 text-gray-600 border border-gray-200',
};

// The hours a crew member actually works: their own override when set,
// otherwise the slot's shared band. `override` flags an individual irregular
// timing that differs from the rest of the crew.
function effectiveTiming(a: Assignment, slot: ShiftSlot): {
  start?: string;
  end?: string;
  override: boolean;
} {
  if (a.shift_start && a.shift_end) {
    return { start: a.shift_start, end: a.shift_end, override: true };
  }
  return { start: slot.shift_start, end: slot.shift_end, override: false };
}

function shiftPeriod(start?: string, end?: string): ShiftPeriod {
  if (!start || !end) return 'Unscheduled';
  if (isOvernight(start, end)) return 'Overnight';
  const hour = Math.floor(toMinutes(start) / 60);
  if (hour < 12) return 'Morning';
  if (hour < 17) return 'Afternoon';
  return 'Evening';
}

// Segments of a shift laid out on a 0–24h axis (as percentages). Overnight
// bands wrap into two segments so the bar reads correctly across midnight.
function timelineSegments(start: string, end: string): Array<{ left: number; width: number }> {
  const s = toMinutes(start);
  const e = toMinutes(end);
  const pct = (min: number) => (min / MINUTES_PER_DAY) * 100;
  if (isOvernight(start, end)) {
    return [
      { left: pct(s), width: pct(MINUTES_PER_DAY - s) },
      { left: 0, width: pct(e) },
    ];
  }
  return [{ left: pct(s), width: pct(e - s) }];
}

/**
 * A slim 24-hour timeline that shows where an irregular shift band sits across
 * the day, wrapping across midnight for overnight shifts.
 */
const ShiftTimeline: React.FC<{ start: string; end: string; overnight: boolean }> = ({
  start,
  end,
  overnight,
}) => (
  <div>
    <div className="relative h-2 w-full rounded-full bg-gray-100 overflow-hidden">
      {/* Midday reference tick */}
      <div className="absolute top-0 bottom-0 left-1/2 w-px bg-gray-200" />
      {timelineSegments(start, end).map((seg, i) => (
        <div
          key={i}
          className={`absolute top-0 h-full rounded-full ${overnight ? 'bg-indigo-400' : 'bg-blue-400'}`}
          style={{ left: `${seg.left}%`, width: `${seg.width}%` }}
        />
      ))}
    </div>
    <div className="flex justify-between text-[10px] text-gray-400 mt-1 px-0.5">
      <span>00</span>
      <span>06</span>
      <span>12</span>
      <span>18</span>
      <span>24</span>
    </div>
  </div>
);

export const CrewGrid: React.FC<CrewGridProps> = ({
  slots,
  date,
  isReadOnly,
  isWeekendOrHoliday,
  onStaffClick,
  exceptionsPanel,
}) => {
  const [expandedSlot, setExpandedSlot] = useState<string | null>(null);

  // Show everything the roster actually contains — hiding slots client-side
  // would contradict the stats bar and mask unfilled shifts. Any weekend/PH
  // ambulance reduction happens at generation time on the backend.
  const displaySlots = slots;

  // Irregular timings no longer fall into two neat day/night buckets, so group
  // the roster by the period each shift starts in and order each group by
  // start time. This keeps the grid readable when every ambulance runs its own
  // band. Slots missing a time fall into an "Unscheduled" group at the end.
  const groupedSlots = PERIOD_ORDER.map((period) => ({
    period,
    slots: displaySlots
      .filter((s) => shiftPeriod(s.shift_start, s.shift_end) === period)
      .sort((a, b) => toMinutes(a.shift_start || '00:00') - toMinutes(b.shift_start || '00:00')),
  })).filter((g) => g.slots.length > 0);

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
            Weekend / Public Holiday schedule
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
          <div className="space-y-5">
            {groupedSlots.map(({ period, slots: groupSlots }) => (
              <div key={period}>
                {/* Period divider — groups the irregular bands by start time */}
                <div className="flex items-center gap-2 mb-2 px-1">
                  <span className={`badge text-xs font-semibold ${periodAccent[period]}`}>
                    {period}
                  </span>
                  <span className="text-xs text-gray-400">
                    {groupSlots.length} shift{groupSlots.length !== 1 ? 's' : ''}
                  </span>
                  <div className="flex-1 h-px bg-gray-100" />
                </div>
                <div className="space-y-2">
                  {groupSlots.map((slot) => {
              const isExpanded = expandedSlot === slot.id;
              const hours = slot.shift_start && slot.shift_end
                ? calcHours(slot.shift_start, slot.shift_end)
                : null;
              const overnight = slot.shift_start && slot.shift_end
                ? isOvernight(slot.shift_start, slot.shift_end)
                : false;
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

                    {/* Shift time — timings are irregular per ambulance, so show
                        the exact band plus a marker when it crosses midnight. */}
                    <div className="flex-shrink-0 text-sm text-gray-700 w-40">
                      <span className="font-medium">{slot.shift_start?.slice(0, 5)}</span>
                      <span className="text-gray-400 mx-1">—</span>
                      <span className="font-medium">{slot.shift_end?.slice(0, 5)}</span>
                      {overnight && (
                        <span
                          className="text-[10px] text-indigo-500 align-super ml-0.5"
                          title="Ends the next day (overnight shift)"
                        >
                          +1
                        </span>
                      )}
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
                        assignments.map((a) => {
                          const timing = effectiveTiming(a, slot);
                          return (
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
                            {/* Individual irregular timing that differs from the crew's band */}
                            {timing.override && timing.start && timing.end && (
                              <span
                                className="px-1 rounded bg-rose-50 text-rose-600 border border-rose-200 text-[10px] font-medium"
                                title="Individual shift timing (differs from the crew band)"
                              >
                                {timing.start.slice(0, 5)}–{timing.end.slice(0, 5)}
                              </span>
                            )}
                            {(a.staff as Staff & { consecutive_days?: number })?.consecutive_days !== undefined &&
                              ((a.staff as Staff & { consecutive_days?: number })?.consecutive_days ?? 0) >= 7 && (
                              <span className="text-red-500" title="7th consecutive day!">⚠️</span>
                            )}
                          </button>
                          );
                        })
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
                          <p className="text-xs text-gray-500 mb-1">Shift Time</p>
                          <p className="font-medium text-gray-800">
                            {slot.shift_start?.slice(0, 5)} – {slot.shift_end?.slice(0, 5)}
                            {overnight && <span className="text-indigo-500"> (+1d)</span>}
                            {hours && <span className="text-gray-400"> · {hours}h</span>}
                          </p>
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

                      {/* 24h timeline showing where this irregular band sits */}
                      {slot.shift_start && slot.shift_end && (
                        <div className="mt-3">
                          <p className="text-xs text-gray-500 mb-1.5">Coverage</p>
                          <ShiftTimeline
                            start={slot.shift_start}
                            end={slot.shift_end}
                            overnight={overnight}
                          />
                        </div>
                      )}

                      {assignments.length > 0 && (
                        <div className="mt-3 space-y-2">
                          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Staff Details</p>
                          {assignments.map((a) => {
                            const timing = effectiveTiming(a, slot);
                            const timingHours = timing.start && timing.end
                              ? calcHours(timing.start, timing.end)
                              : null;
                            return (
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
                                {timing.start && timing.end && (
                                  <p className="text-xs text-gray-700 font-medium">
                                    {timing.start.slice(0, 5)}–{timing.end.slice(0, 5)}
                                    {timingHours != null && (
                                      <span className="text-gray-400"> · {timingHours}h</span>
                                    )}
                                    {timing.override && (
                                      <span className="ml-1 text-rose-600" title="Individual timing (differs from crew band)">
                                        (own timing)
                                      </span>
                                    )}
                                  </p>
                                )}
                                <span className={`badge capitalize text-xs mt-0.5 ${
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
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
                  })}
                </div>
              </div>
            ))}
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
