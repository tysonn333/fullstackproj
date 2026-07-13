import React, { useState } from 'react';
import type { Assignment, ShiftSlot, Staff } from '../../types';

interface TimelineGridProps {
  slots: ShiftSlot[];
  isReadOnly: boolean;
  isWeekendOrHoliday: boolean;
  onStaffClick: (staff: Staff) => void;
  exceptionsPanel?: React.ReactNode;
}

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

function isOvernight(start: string, end: string): boolean {
  return toMinutes(end) <= toMinutes(start);
}

// Position of a shift band on the 0–24h axis, as percentages. Overnight bands
// wrap into two segments so they read correctly across midnight.
function barSegments(start: string, end: string): Array<{ left: number; width: number }> {
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

function firstStaff(slot?: ShiftSlot): { assignment?: Assignment; staff?: Staff } {
  const a = slot?.assignments?.[0];
  return { assignment: a, staff: a?.staff };
}

// A crew member's actual hours: their own override when set, else the slot band.
function effectiveTiming(slot?: ShiftSlot): { start?: string; end?: string; override: boolean } {
  const a = slot?.assignments?.[0];
  if (a?.shift_start && a?.shift_end) {
    return { start: a.shift_start, end: a.shift_end, override: true };
  }
  return { start: slot?.shift_start, end: slot?.shift_end, override: false };
}

// One horizontal bar: a single ambulance + service line running a shift band,
// crewed by a driver slot and a medic (attendant) slot.
interface ShiftBar {
  key: string;
  jobType: string;
  start: string;
  end: string;
  driverSlot?: ShiftSlot;
  medicSlot?: ShiftSlot;
}

interface AmbulanceRow {
  ambulanceKey: string;
  callSign: string;
  vehicleNumber?: string;
  bars: ShiftBar[];
}

function buildRows(slots: ShiftSlot[]): AmbulanceRow[] {
  const rowMap = new Map<string, AmbulanceRow>();

  for (const slot of slots) {
    if (!slot.shift_start || !slot.shift_end) continue;
    const ambulanceKey = slot.ambulance?.call_sign || slot.ambulance_id || slot.id;

    let row = rowMap.get(ambulanceKey);
    if (!row) {
      row = {
        ambulanceKey,
        callSign: slot.ambulance?.call_sign || `AMB-${slot.id.slice(-4)}`,
        vehicleNumber: slot.ambulance?.vehicle_number,
        bars: [],
      };
      rowMap.set(ambulanceKey, row);
    }

    // Group the driver + attendant slots that share a service line and band
    // into a single bar.
    const barKey = `${ambulanceKey}|${slot.job_type}|${slot.shift_start}|${slot.shift_end}`;
    let bar = row.bars.find((b) => b.key === barKey);
    if (!bar) {
      bar = {
        key: barKey,
        jobType: slot.job_type,
        start: slot.shift_start,
        end: slot.shift_end,
      };
      row.bars.push(bar);
    }
    if (slot.required_role === 'driver') bar.driverSlot = slot;
    else bar.medicSlot = slot;
  }

  // Sort ambulances by call sign, and bars within each by start time.
  const rows = Array.from(rowMap.values());
  rows.sort((a, b) => a.callSign.localeCompare(b.callSign));
  for (const row of rows) {
    row.bars.sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  }
  return rows;
}

const jobBarColor: Record<string, string> = {
  MTS: 'bg-blue-500 hover:bg-blue-600 ring-blue-300',
  EAS: 'bg-emerald-500 hover:bg-emerald-600 ring-emerald-300',
};

const jobTypeBadge: Record<string, string> = {
  MTS: 'bg-blue-100 text-blue-700 border border-blue-200',
  EAS: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
};

// Hourly gridlines behind every track.
const GRID_BG =
  'repeating-linear-gradient(to right, rgb(241 245 249) 0, rgb(241 245 249) 1px, transparent 1px, transparent calc(100% / 24))';

const AXIS_HOURS = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24];

const StaffChip: React.FC<{
  label: string;
  slot?: ShiftSlot;
  onStaffClick: (s: Staff) => void;
}> = ({ label, slot, onStaffClick }) => {
  const { staff } = firstStaff(slot);
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span className="opacity-80">{label}</span>
      {staff ? (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onStaffClick(staff);
          }}
          className="font-semibold underline-offset-2 hover:underline"
        >
          {staff.name}
        </button>
      ) : (
        <span className="italic opacity-90">Unfilled</span>
      )}
    </span>
  );
};

export const TimelineGrid: React.FC<TimelineGridProps> = ({
  slots,
  isReadOnly,
  isWeekendOrHoliday,
  onStaffClick,
  exceptionsPanel,
}) => {
  const [expandedBar, setExpandedBar] = useState<string | null>(null);
  const rows = buildRows(slots);

  return (
    <div className="flex gap-4">
      <div className="flex-1 min-w-0">
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

        {rows.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p className="text-sm font-medium">No shifts to display</p>
          </div>
        ) : (
          <div className="card p-0 overflow-x-auto">
            {/* Legend */}
            <div className="flex items-center gap-4 px-4 pt-3 text-xs text-gray-500">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm bg-blue-500" /> MTS
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm bg-emerald-500" /> EAS
              </span>
              <span className="text-gray-400">Click a shift bar for details</span>
            </div>

            <div className="min-w-[820px] px-4 py-3">
              {/* Time axis 00:00 → 24:00 */}
              <div className="flex items-end mb-1">
                <div className="w-28 flex-shrink-0" />
                <div className="relative flex-1 h-5">
                  {AXIS_HOURS.map((h) => (
                    <div
                      key={h}
                      className="absolute -translate-x-1/2 text-[10px] text-gray-400"
                      style={{ left: `${(h / 24) * 100}%` }}
                    >
                      {String(h).padStart(2, '0')}:00
                    </div>
                  ))}
                </div>
              </div>

              {/* Ambulance rows */}
              <div className="divide-y divide-gray-100">
                {rows.map((row) => (
                  <div key={row.ambulanceKey} className="py-2">
                    <div className="flex items-start">
                      {/* Ambulance label */}
                      <div className="w-28 flex-shrink-0 pr-2">
                        <p className="text-sm font-bold text-gray-900 leading-tight">{row.callSign}</p>
                        {row.vehicleNumber && (
                          <p className="text-[10px] text-gray-400">{row.vehicleNumber}</p>
                        )}
                      </div>

                      {/* Lanes — one per shift bar */}
                      <div className="flex-1 space-y-1.5">
                        {row.bars.map((bar) => {
                          const hours = calcHours(bar.start, bar.end);
                          const overnight = isOvernight(bar.start, bar.end);
                          const segments = barSegments(bar.start, bar.end);
                          const isExpanded = expandedBar === bar.key;
                          const color = jobBarColor[bar.jobType] || 'bg-gray-500 hover:bg-gray-600 ring-gray-300';
                          const driver = firstStaff(bar.driverSlot).staff;
                          const medic = firstStaff(bar.medicSlot).staff;
                          const unfilled = !driver || !medic;

                          return (
                            <div key={bar.key}>
                              {/* Track with hourly gridlines */}
                              <div
                                className="relative h-9 rounded"
                                style={{ backgroundImage: GRID_BG }}
                              >
                                {segments.map((seg, i) => (
                                  <button
                                    key={i}
                                    onClick={() => setExpandedBar(isExpanded ? null : bar.key)}
                                    title={`${bar.jobType} · ${bar.start.slice(0, 5)}–${bar.end.slice(0, 5)}${overnight ? ' (+1d)' : ''} · ${hours}h`}
                                    className={`absolute top-1 bottom-1 rounded px-2 flex items-center overflow-hidden text-left text-white text-[11px] transition-colors ${color} ${
                                      isExpanded ? 'ring-2' : ''
                                    }`}
                                    style={{ left: `${seg.left}%`, width: `${seg.width}%`, minWidth: '2rem' }}
                                  >
                                    {/* Only label the first (widest for a same-day shift) segment */}
                                    {i === 0 && (
                                      <span className="flex items-center gap-2 truncate">
                                        <span className="font-semibold">
                                          {bar.start.slice(0, 5)}–{bar.end.slice(0, 5)}
                                          {overnight && <span className="opacity-80"> +1d</span>}
                                        </span>
                                        <span className="truncate opacity-95">
                                          {driver?.name ? `D: ${driver.name}` : 'D: —'}
                                          {'  ·  '}
                                          {medic?.name ? `M: ${medic.name}` : 'M: —'}
                                        </span>
                                      </span>
                                    )}
                                  </button>
                                ))}
                                {unfilled && (
                                  <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-amber-400 rounded-full border border-white"
                                    title="Crew incomplete" />
                                )}
                              </div>

                              {/* Expanded detail */}
                              {isExpanded && (
                                <div className="mt-1 mb-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-3">
                                  <div className="flex flex-wrap items-center gap-2 mb-3">
                                    <span className={`badge text-xs font-semibold ${jobTypeBadge[bar.jobType] || 'badge-gray'}`}>
                                      {bar.jobType}
                                    </span>
                                    <span className="text-sm font-medium text-gray-800">
                                      {bar.start.slice(0, 5)} – {bar.end.slice(0, 5)}
                                      {overnight && <span className="text-indigo-500"> (+1d)</span>}
                                      <span className="text-gray-400"> · {hours}h</span>
                                    </span>
                                    <span className="text-xs text-gray-500">{row.callSign}</span>
                                  </div>

                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    <CrewDetail role="Driver" slot={bar.driverSlot} onStaffClick={onStaffClick} />
                                    <CrewDetail role="Medic" slot={bar.medicSlot} onStaffClick={onStaffClick} />
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {exceptionsPanel && <div className="w-72 flex-shrink-0">{exceptionsPanel}</div>}
    </div>
  );
};

const statusBadge: Record<string, string> = {
  confirmed: 'badge-green',
  dropped: 'badge-red',
  swapped: 'badge-yellow',
  assigned: 'badge-blue',
  completed: 'badge-gray',
};

const CrewDetail: React.FC<{
  role: string;
  slot?: ShiftSlot;
  onStaffClick: (s: Staff) => void;
}> = ({ role, slot, onStaffClick }) => {
  const { assignment, staff } = firstStaff(slot);
  const timing = effectiveTiming(slot);
  return (
    <div className="bg-white rounded-lg px-3 py-2 border border-gray-100">
      <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">{role}</p>
      {staff ? (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-700 font-bold text-xs flex-shrink-0">
              {staff.name.charAt(0)}
            </div>
            <div className="min-w-0">
              <button
                onClick={() => onStaffClick(staff)}
                className="text-sm font-medium text-blue-600 hover:underline truncate block"
              >
                {staff.name}
              </button>
              <p className="text-xs text-gray-500 capitalize">{staff.role}</p>
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            {timing.start && timing.end && (
              <p className="text-xs text-gray-700 font-medium">
                {timing.start.slice(0, 5)}–{timing.end.slice(0, 5)}
                {timing.override && (
                  <span className="ml-1 text-rose-600" title="Individual timing (differs from crew band)">
                    (own)
                  </span>
                )}
              </p>
            )}
            {assignment && (
              <span className={`badge capitalize text-xs mt-0.5 ${statusBadge[assignment.status] || 'badge-gray'}`}>
                {assignment.status}
              </span>
            )}
          </div>
        </div>
      ) : (
        <p className="text-sm text-amber-600 italic">Unfilled</p>
      )}
    </div>
  );
};
