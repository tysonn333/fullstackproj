import React, { useState } from 'react';
import type { ShiftSlot, Staff } from '../../types';

interface DayTimelineProps {
  slots: ShiftSlot[];
  date: string;
  isReadOnly?: boolean;
  onStaffClick: (staff: Staff) => void;
}

const MINUTES_PER_DAY = 24 * 60;

function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function fmt(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function calcHours(start: string, end: string): number {
  let diff = toMinutes(end) - toMinutes(start);
  if (diff <= 0) diff += MINUTES_PER_DAY;
  return parseFloat((diff / 60).toFixed(1));
}

function isOvernight(start: string, end: string): boolean {
  return toMinutes(end) <= toMinutes(start);
}

// A shift as one or two [startMin, endMin] intervals on a 0–1440 axis.
// Overnight shifts split at midnight.
function toIntervals(start: string, end: string): Array<[number, number]> {
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (isOvernight(start, end)) {
    return [
      [s, MINUTES_PER_DAY],
      [0, e],
    ];
  }
  return [[s, e]];
}

function pct(min: number): number {
  return (min / MINUTES_PER_DAY) * 100;
}

// ── Coverage: merge every shift interval, then take the complement to find
// windows where NO ambulance is scheduled on duty. ─────────────────────────
function coverageGaps(slots: ShiftSlot[]): Array<[number, number]> {
  const intervals: Array<[number, number]> = [];
  for (const s of slots) {
    if (!s.shift_start || !s.shift_end) continue;
    intervals.push(...toIntervals(s.shift_start, s.shift_end));
  }
  if (intervals.length === 0) return [[0, MINUTES_PER_DAY]];

  intervals.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [s, e] of intervals) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) {
      last[1] = Math.max(last[1], e);
    } else {
      merged.push([s, e]);
    }
  }

  const gaps: Array<[number, number]> = [];
  let cursor = 0;
  for (const [s, e] of merged) {
    if (s > cursor) gaps.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (cursor < MINUTES_PER_DAY) gaps.push([cursor, MINUTES_PER_DAY]);
  return gaps;
}

// ── Grouping: one row per ambulance, one bar per service line + shift band. ──
interface ShiftBar {
  key: string;
  jobType: string;
  start: string;
  end: string;
  driverSlot?: ShiftSlot;
  medicSlot?: ShiftSlot;
}
interface AmbulanceRow {
  key: string;
  callSign: string;
  vehicleNumber?: string;
  bars: ShiftBar[];
}

function buildRows(slots: ShiftSlot[]): AmbulanceRow[] {
  const rowMap = new Map<string, AmbulanceRow>();
  for (const slot of slots) {
    if (!slot.shift_start || !slot.shift_end) continue;
    const key = slot.ambulance?.call_sign || slot.ambulance_id || slot.id;
    let row = rowMap.get(key);
    if (!row) {
      row = {
        key,
        callSign: slot.ambulance?.call_sign || `AMB-${slot.id.slice(-4)}`,
        vehicleNumber: slot.ambulance?.vehicle_number,
        bars: [],
      };
      rowMap.set(key, row);
    }
    const barKey = `${key}|${slot.job_type}|${slot.shift_start}|${slot.shift_end}`;
    let bar = row.bars.find((b) => b.key === barKey);
    if (!bar) {
      bar = { key: barKey, jobType: slot.job_type, start: slot.shift_start, end: slot.shift_end };
      row.bars.push(bar);
    }
    if (slot.required_role === 'driver') bar.driverSlot = slot;
    else bar.medicSlot = slot;
  }
  const rows = Array.from(rowMap.values());
  rows.sort((a, b) => a.callSign.localeCompare(b.callSign));
  for (const r of rows) r.bars.sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
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
const statusBadge: Record<string, string> = {
  confirmed: 'badge-green', dropped: 'badge-red', swapped: 'badge-yellow',
  assigned: 'badge-blue', completed: 'badge-gray',
};

const GRID_BG =
  'repeating-linear-gradient(to right, rgb(241 245 249) 0, rgb(241 245 249) 1px, transparent 1px, transparent calc(100% / 24))';
const AXIS_HOURS = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24];

function staffOf(slot?: ShiftSlot): Staff | undefined {
  return slot?.assignments?.[0]?.staff;
}
function statusOf(slot?: ShiftSlot): string | undefined {
  return slot?.assignments?.[0]?.status;
}

export const DayTimeline: React.FC<DayTimelineProps> = ({ slots, date, isReadOnly, onStaffClick }) => {
  const [expanded, setExpanded] = useState<string | null>(null);
  const rows = buildRows(slots);
  const gaps = coverageGaps(slots);
  const totalGapMinutes = gaps.reduce((sum, [s, e]) => sum + (e - s), 0);

  return (
    <div className="card p-0 overflow-hidden">
      {/* Coverage banner */}
      {totalGapMinutes > 0 ? (
        <div className="px-4 py-2.5 bg-red-50 border-b border-red-200 flex items-start gap-2 text-sm text-red-700">
          <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <div>
            <span className="font-semibold">No ambulance on duty</span> for{' '}
            {gaps.map(([s, e], i) => (
              <span key={i} className="font-medium">
                {fmt(s)}–{fmt(e === MINUTES_PER_DAY ? 0 : e)}
                {i < gaps.length - 1 ? ', ' : ''}
              </span>
            ))}
            .
          </div>
        </div>
      ) : (
        rows.length > 0 && (
          <div className="px-4 py-2.5 bg-emerald-50 border-b border-emerald-200 flex items-center gap-2 text-sm text-emerald-700">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="font-medium">Full 24-hour coverage</span> — at least one ambulance on duty at all times.
          </div>
        )
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 px-4 pt-3 text-xs text-gray-500">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-blue-500" /> MTS</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-emerald-500" /> EAS</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-red-400" /> No coverage</span>
        <span className="text-gray-400">Click a shift bar for crew details</span>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-sm font-medium">No roster for {date}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[820px] px-4 py-3">
            {/* Time axis 00:00 → 24:00 */}
            <div className="flex items-end mb-1">
              <div className="w-28 flex-shrink-0" />
              <div className="relative flex-1 h-5">
                {AXIS_HOURS.map((h) => (
                  <div key={h} className="absolute -translate-x-1/2 text-[10px] text-gray-400"
                    style={{ left: `${(h / 24) * 100}%` }}>
                    {String(h).padStart(2, '0')}:00
                  </div>
                ))}
              </div>
            </div>

            {/* Coverage strip: red where no ambulance is on duty */}
            <div className="flex items-center mb-3">
              <div className="w-28 flex-shrink-0 pr-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400 text-right">
                Coverage
              </div>
              <div className="relative flex-1 h-3 rounded bg-emerald-200 overflow-hidden" style={{ backgroundImage: GRID_BG }}>
                {gaps.map(([s, e], i) => (
                  <div key={i} className="absolute top-0 bottom-0 bg-red-400"
                    style={{ left: `${pct(s)}%`, width: `${pct(e - s)}%` }}
                    title={`No ambulance on duty ${fmt(s)}–${fmt(e === MINUTES_PER_DAY ? 0 : e)}`} />
                ))}
              </div>
            </div>

            {/* Ambulance rows */}
            <div className="divide-y divide-gray-100">
              {rows.map((row) => (
                <div key={row.key} className="py-2 flex items-start">
                  <div className="w-28 flex-shrink-0 pr-2">
                    <p className="text-sm font-bold text-gray-900 leading-tight">{row.callSign}</p>
                    {row.vehicleNumber && <p className="text-[10px] text-gray-400">{row.vehicleNumber}</p>}
                  </div>

                  <div className="flex-1 space-y-1.5">
                    {row.bars.map((bar) => {
                      const hours = calcHours(bar.start, bar.end);
                      const overnight = isOvernight(bar.start, bar.end);
                      const isOpen = expanded === bar.key;
                      const color = jobBarColor[bar.jobType] || 'bg-gray-500 hover:bg-gray-600 ring-gray-300';
                      const driver = staffOf(bar.driverSlot);
                      const medic = staffOf(bar.medicSlot);
                      const unfilled = !driver || !medic;
                      const segs = toIntervals(bar.start, bar.end);

                      return (
                        <div key={bar.key}>
                          <div className="relative h-9 rounded" style={{ backgroundImage: GRID_BG }}>
                            {segs.map(([s, e], i) => (
                              <button
                                key={i}
                                onClick={() => setExpanded(isOpen ? null : bar.key)}
                                title={`${bar.jobType} · ${bar.start.slice(0, 5)}–${bar.end.slice(0, 5)}${overnight ? ' (+1d)' : ''} · ${hours}h`}
                                className={`absolute top-1 bottom-1 rounded px-2 flex items-center overflow-hidden text-left text-white text-[11px] transition-colors ${color} ${isOpen ? 'ring-2' : ''}`}
                                style={{ left: `${pct(s)}%`, width: `${pct(e - s)}%`, minWidth: '2rem' }}
                              >
                                {i === 0 && (
                                  <span className="flex items-center gap-2 truncate">
                                    <span className="font-semibold">
                                      {bar.start.slice(0, 5)}–{bar.end.slice(0, 5)}{overnight && <span className="opacity-80"> +1d</span>}
                                    </span>
                                    <span className="truncate opacity-95">
                                      {driver?.name ? `D: ${driver.name}` : 'D: —'}{'  ·  '}{medic?.name ? `M: ${medic.name}` : 'M: —'}
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

                          {isOpen && (
                            <div className="mt-1 mb-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-3">
                              <div className="flex flex-wrap items-center gap-2 mb-3">
                                <span className={`badge text-xs font-semibold ${jobTypeBadge[bar.jobType] || 'badge-gray'}`}>{bar.jobType}</span>
                                <span className="text-sm font-medium text-gray-800">
                                  {bar.start.slice(0, 5)} – {bar.end.slice(0, 5)}
                                  {overnight && <span className="text-indigo-500"> (+1d)</span>}
                                  <span className="text-gray-400"> · {hours}h</span>
                                </span>
                                <span className="text-xs text-gray-500">{row.callSign}</span>
                                {isReadOnly && <span className="badge-gray badge text-xs">Read only</span>}
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
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const CrewDetail: React.FC<{ role: string; slot?: ShiftSlot; onStaffClick: (s: Staff) => void }> = ({
  role, slot, onStaffClick,
}) => {
  const staff = staffOf(slot);
  const status = statusOf(slot);
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
              <button onClick={() => onStaffClick(staff)} className="text-sm font-medium text-blue-600 hover:underline truncate block">
                {staff.name}
              </button>
              <p className="text-xs text-gray-500 capitalize">{staff.role}</p>
            </div>
          </div>
          {status && <span className={`badge capitalize text-xs ${statusBadge[status] || 'badge-gray'}`}>{status}</span>}
        </div>
      ) : (
        <p className="text-sm text-amber-600 italic">Unfilled</p>
      )}
    </div>
  );
};
