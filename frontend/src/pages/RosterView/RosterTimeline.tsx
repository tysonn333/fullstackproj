import React from 'react';
import type { ShiftSlot, Staff } from '../../types';

interface RosterTimelineProps {
  slots: ShiftSlot[];
  onStaffClick: (staff: Staff) => void;
}

const jobTypeBar: Record<string, string> = {
  // MTS = informational data → sky (kept distinct from brand/critical red).
  MTS: 'bg-sky-500/85 border-sky-600',
  EAS: 'bg-emerald-500/85 border-emerald-600',
};

function toMinutes(t?: string): number {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Absolute [start, end] of a slot in "minutes since the axis origin", handling
 * overnight shifts (end <= start rolls the end past midnight). The axis origin
 * is the earliest start across all slots, so shifts with irregular start/end
 * times line up against a shared, gap-accurate time ruler.
 */
function slotSpan(slot: ShiftSlot, origin: number): { start: number; end: number } {
  let start = toMinutes(slot.shift_start);
  let end = toMinutes(slot.shift_end);
  if (end <= start) end += 24 * 60; // overnight
  // Shift everything so the earliest start sits at 0, keeping overnight slots
  // that begin before the origin (rare) on a positive axis.
  if (start < origin) {
    start += 24 * 60;
    end += 24 * 60;
  }
  return { start: start - origin, end: end - origin };
}

export const RosterTimeline: React.FC<RosterTimelineProps> = ({ slots, onStaffClick }) => {
  if (slots.length === 0) {
    return (
      <div className="card p-16 text-center text-gray-400 text-sm">No roster to display on the timeline.</div>
    );
  }

  // Axis origin = earliest start; axis end = latest (overnight-adjusted) end.
  const rawStarts = slots.map((s) => toMinutes(s.shift_start));
  const origin = Math.min(...rawStarts);
  const spans = slots.map((s) => slotSpan(s, origin));
  const axisEnd = Math.max(...spans.map((sp) => sp.end), 60);
  const totalMinutes = axisEnd; // origin is 0

  // Group slots by ambulance so each vehicle is one timeline row.
  const groups = new Map<string, { label: string; sub: string; slots: ShiftSlot[] }>();
  slots.forEach((slot) => {
    const key = slot.ambulance?.call_sign || slot.ambulance_id || slot.id;
    const g = groups.get(key) ?? {
      label: slot.ambulance?.call_sign || `AMB ${slot.ambulance_id || ''}`.trim(),
      sub: slot.ambulance?.vehicle_number || '',
      slots: [],
    };
    g.slots.push(slot);
    groups.set(key, g);
  });

  // Hour ruler ticks across the axis.
  const originHour = Math.floor(origin / 60);
  const hourCount = Math.ceil(totalMinutes / 60);
  const ticks = Array.from({ length: hourCount + 1 }, (_, i) => {
    const hour = (originHour + i) % 24;
    const posPct = ((i * 60) / totalMinutes) * 100;
    return { label: `${String(hour).padStart(2, '0')}:00`, posPct };
  });

  const pct = (min: number) => `${(min / totalMinutes) * 100}%`;

  return (
    <div className="card overflow-hidden">
      <div className="card-header">
        <h3 className="text-sm font-semibold text-gray-800">Shift Timeline</h3>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-sky-500/85" /> MTS</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-500/85" /> EAS</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded border border-dashed border-amber-400 bg-amber-50" /> Unfilled</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[720px] p-4">
          {/* Hour ruler */}
          <div className="flex">
            <div className="w-28 flex-shrink-0" />
            <div className="relative flex-1 h-6 border-b border-gray-200">
              {ticks.map((t, i) => (
                <div
                  key={i}
                  className="absolute top-0 h-6 flex flex-col items-start"
                  style={{ left: `${t.posPct}%` }}
                >
                  <span className="text-[10px] text-gray-400 -translate-x-1/2 whitespace-nowrap">{t.label}</span>
                  <span className="w-px h-2 bg-gray-200 mt-auto" />
                </div>
              ))}
            </div>
          </div>

          {/* Ambulance rows */}
          <div className="divide-y divide-gray-50">
            {[...groups.values()].map((group) => (
              <div key={group.label} className="flex items-stretch py-2">
                {/* Row label */}
                <div className="w-28 flex-shrink-0 pr-3 flex flex-col justify-center">
                  <p className="text-sm font-bold text-gray-900 leading-tight">{group.label}</p>
                  {group.sub && <p className="text-[10px] text-gray-400">{group.sub}</p>}
                </div>

                {/* Track with vertical gridlines + positioned shift bars */}
                <div className="relative flex-1 min-h-[3.25rem]">
                  {ticks.map((t, i) => (
                    <div
                      key={i}
                      className="absolute top-0 bottom-0 w-px bg-gray-100"
                      style={{ left: `${t.posPct}%` }}
                    />
                  ))}

                  {group.slots
                    .slice()
                    .sort((a, b) => toMinutes(a.shift_start) - toMinutes(b.shift_start) || a.required_role.localeCompare(b.required_role))
                    .map((slot, idx) => {
                      const span = slotSpan(slot, origin);
                      const assignments = slot.assignments || [];
                      const unfilled = assignments.length === 0;
                      const hasConsecutive = assignments.some(
                        (a) =>
                          ((a.staff as Staff & { consecutive_days?: number })?.consecutive_days ?? 0) >= 7
                      );
                      // Stack driver/attendant bars vertically inside the row.
                      const laneTop = idx % 2 === 0 ? '0.15rem' : '1.7rem';
                      return (
                        <div
                          key={slot.id}
                          className={`absolute h-6 rounded-md border px-1.5 flex items-center gap-1 overflow-hidden text-[10px] text-white shadow-sm ${
                            unfilled
                              ? 'bg-amber-50 border-dashed border-amber-400 text-amber-700'
                              : jobTypeBar[slot.job_type] || 'bg-gray-400 border-gray-500'
                          } ${hasConsecutive ? 'ring-2 ring-red-400' : ''}`}
                          style={{ left: pct(span.start), width: `calc(${pct(span.end - span.start)} - 2px)`, top: laneTop }}
                          title={`${slot.required_role} · ${slot.job_type} · ${slot.shift_start?.slice(0, 5)}–${slot.shift_end?.slice(0, 5)}${
                            unfilled ? ' · UNFILLED' : ''
                          }`}
                        >
                          <span className="font-semibold capitalize opacity-90 flex-shrink-0">
                            {slot.required_role === 'driver' ? '🚑' : '＋'}
                          </span>
                          {unfilled ? (
                            <span className="font-medium truncate">Unfilled {slot.required_role}</span>
                          ) : (
                            assignments.map((a) => (
                              <button
                                key={a.id}
                                onClick={() => a.staff && onStaffClick(a.staff)}
                                className="font-medium truncate hover:underline"
                              >
                                {a.staff?.name || 'Unknown'}
                              </button>
                            ))
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
    </div>
  );
};
