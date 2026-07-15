import React, { useState } from 'react';
import type { ShiftSlot, Staff } from '../../types';

interface CrewGridProps {
  slots: ShiftSlot[];
  date: string;
  isReadOnly: boolean;
  isWeekendOrHoliday: boolean;
  onStaffClick: (staff: Staff) => void;
  onSlotSwap?: (slotId: string, role: 'driver' | 'attendant') => void;
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

// Fixed 6-hour blocks covering the full 24h day — replaces the old
// dynamically-derived columns. Every roster day is shown against these
// same 4 columns regardless of what slots actually exist.
const SHIFT_BLOCKS = [
  { label: '00:00–06:00', start: '00:00' },
  { label: '06:00–12:00', start: '06:00' },
  { label: '12:00–18:00', start: '12:00' },
  { label: '18:00–24:00', start: '18:00' },
] as const;

function calcHours(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let diff = (eh * 60 + em) - (sh * 60 + sm);
  if (diff < 0) diff += 24 * 60;
  return parseFloat((diff / 60).toFixed(1));
}

function ambKey(slot: ShiftSlot): string {
  return slot.ambulance?.call_sign || `AMB-${slot.id.slice(-4)}`;
}

function timeKey(slot: ShiftSlot): string {
  return `${slot.shift_start?.slice(0, 5)}–${slot.shift_end?.slice(0, 5)}`;
}

// Which of the 4 fixed blocks a slot starts in.
function blockIndexForSlot(slot: ShiftSlot): number {
  const start = slot.shift_start?.slice(0, 5) || '00:00';
  const idx = SHIFT_BLOCKS.findIndex((b) => b.start === start);
  return idx === -1 ? 0 : idx;
}

// True if the shift crosses midnight (end time <= start time).
function isOvernightShift(slot: ShiftSlot): boolean {
  return slot.shift_end != null && slot.shift_start != null && slot.shift_end <= slot.shift_start;
}

// How many 6-hour blocks a slot occupies — 1 for a 6h shift, 2 for a 12h shift.
function blockSpanForSlot(slot: ShiftSlot): number {
  if (!slot.shift_start || !slot.shift_end) return 1;
  const hours = calcHours(slot.shift_start, slot.shift_end);
  return hours > 6 ? 2 : 1;
}

// Returns all slots that should appear in the given block index.
// For block 0, also includes overnight slots that started at block 3 (18:00) and wrap around.
function slotsForBlock(slots: ShiftSlot[], blockIdx: number): ShiftSlot[] {
  const startingHere = slots.filter((s) => blockIndexForSlot(s) === blockIdx);
  // Overnight shifts starting at block 3 also cover block 0 (00:00-06:00)
  if (blockIdx === 0) {
    const overnightFromBlock3 = slots.filter(
      (s) => blockIndexForSlot(s) === 3 && isOvernightShift(s)
    );
    return [...startingHere, ...overnightFromBlock3];
  }
  return startingHere;
}

export const CrewGrid: React.FC<CrewGridProps> = ({
  slots,
  date,
  isReadOnly,
  isWeekendOrHoliday,
  onStaffClick,
  onSlotSwap,
  exceptionsPanel,
}) => {
  const [expandedSlot, setExpandedSlot] = useState<string | null>(null);

  // Show everything the roster actually contains — hiding slots client-side
  // would contradict the stats bar and mask unfilled shifts. Any weekend/PH
  // ambulance reduction happens at generation time on the backend.
  const displaySlots = slots;

  // Rows: one per ambulance that appears in this day's slots
  const ambulanceRows = Array.from(
    new Map(displaySlots.map((s) => [ambKey(s), s])).values()
  );

  const expandedSlotData = displaySlots.find((s) => s.id === expandedSlot) || null;
  const hasAssignment = expandedSlotData && Array.isArray(expandedSlotData.assignments) && expandedSlotData.assignments.length > 0;

  // Pick the job type / status from whichever slot in this block has data
  function blockJobType(slotsAtBlock: ShiftSlot[]): string {
    return slotsAtBlock.find((s) => s.job_type)?.job_type || 'MTS';
  }
  function blockStatus(slotsAtBlock: ShiftSlot[]): string {
    return slotsAtBlock.find((s) => s.status)?.status || 'unfilled';
  }
  function blockServiceLabel(slotsAtBlock: ShiftSlot[]): string {
    const types = [...new Set(slotsAtBlock.map((s) => s.job_type).filter(Boolean))];
    return types.join('/') || 'MTS';
  }

  const renderCell = (rowKey: string, driverSlot: ShiftSlot | null, attendantSlot: ShiftSlot | null, span: number, colIndex: number, cellKey: string) => {
    const slotsHere = [driverSlot, attendantSlot].filter(Boolean) as ShiftSlot[];
    const isEmpty = slotsHere.length === 0;

    // grid-column: ambulance-col (1) + block-start + 1
    const colStart = colIndex + 2;

    if (isEmpty) {
      return (
        <div
          key={cellKey}
          style={{ gridColumn: `${colStart} / span ${span}` }}
          className="border-b border-gray-100 px-2 py-3 bg-gray-25"
        />
      );
    }

    const firstSlot = slotsHere[0];
    const isExpanded = expandedSlot && slotsHere.some((s) => s.id === expandedSlot);

    const driverAssignment = driverSlot ? (Array.isArray(driverSlot.assignments) ? driverSlot.assignments[0] : undefined) : undefined;
    const attendantAssignment = attendantSlot ? (Array.isArray(attendantSlot.assignments) ? attendantSlot.assignments[0] : undefined) : undefined;

    const isTwelveHour = span === 2;
    const driverPtViolation = isTwelveHour && driverAssignment?.staff?.employment_type === 'part_time';
    const attendantPtViolation = isTwelveHour && attendantAssignment?.staff?.employment_type === 'part_time';
    const hasViolation = driverPtViolation || attendantPtViolation;

    const serviceLabel = blockServiceLabel(slotsHere);

    return (
      <div
        key={cellKey}
        style={{ gridColumn: `${colStart} / span ${span}` }}
        onClick={() => setExpandedSlot(firstSlot.id)}
        className={`relative border-b border-gray-100 px-1.5 py-3 cursor-pointer transition-colors hover:bg-blue-50 min-w-0 ${
          isExpanded ? 'bg-blue-50 ring-2 ring-inset ring-blue-300' : ''
        } ${hasViolation ? 'bg-red-50/40' : ''}`}
      >
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <span className={`badge text-[10px] max-w-[60%] ${jobTypeBadge[firstSlot.job_type] || 'badge-gray'}`}>
              <span className="block truncate">{serviceLabel}</span>
            </span>
            <div className="flex items-center gap-1 flex-shrink-0">
              {isTwelveHour && (
                <span className="badge-gray badge text-[10px]">12h</span>
              )}
              <span className={`badge capitalize text-[10px] ${statusBadge[firstSlot.status] || 'badge-gray'}`}>
                {firstSlot.status}
              </span>
            </div>
          </div>

          {/* Split cell: driver | attendant */}
          <div className="grid grid-cols-2 gap-1">
            <div
              onClick={(e) => {
                e.stopPropagation();
                if (driverSlot && onSlotSwap && !isReadOnly) {
                  onSlotSwap(driverSlot.id, 'driver');
                } else if (driverAssignment?.staff) {
                  onStaffClick(driverAssignment.staff);
                }
              }}
              className={`rounded px-1.5 py-1 text-center overflow-hidden ${
                onSlotSwap && driverSlot && !isReadOnly ? 'cursor-pointer hover:ring-2 hover:ring-blue-300' : driverAssignment?.staff ? 'cursor-pointer hover:ring-2 hover:ring-blue-200' : ''
              } ${
                driverPtViolation
                  ? 'bg-red-50 border border-red-200'
                  : 'bg-white border border-gray-100'
              }`}
            >
              <p className="text-[9px] text-gray-400 uppercase tracking-wide">Driver</p>
              <p className="text-xs font-medium text-gray-800 truncate" title={driverAssignment?.staff?.name || ''}>
                {driverAssignment?.staff?.name || '—'}
              </p>
              {driverAssignment?.staff?.employment_type === 'part_time' && (
                <span className="text-[9px] text-red-400 font-medium">PT</span>
              )}
            </div>
            <div
              onClick={(e) => {
                e.stopPropagation();
                if (attendantSlot && onSlotSwap && !isReadOnly) {
                  onSlotSwap(attendantSlot.id, 'attendant');
                } else if (attendantAssignment?.staff) {
                  onStaffClick(attendantAssignment.staff);
                }
              }}
              className={`rounded px-1.5 py-1 text-center overflow-hidden ${
                onSlotSwap && attendantSlot && !isReadOnly ? 'cursor-pointer hover:ring-2 hover:ring-blue-300' : attendantAssignment?.staff ? 'cursor-pointer hover:ring-2 hover:ring-blue-200' : ''
              } ${
                attendantPtViolation
                  ? 'bg-red-50 border border-red-200'
                  : 'bg-white border border-gray-100'
              }`}
            >
              <p className="text-[9px] text-gray-400 uppercase tracking-wide">Attendant</p>
              <p className="text-xs font-medium text-gray-800 truncate" title={attendantAssignment?.staff?.name || ''}>
                {attendantAssignment?.staff?.name || '—'}
              </p>
              {attendantAssignment?.staff?.employment_type === 'part_time' && (
                <span className="text-[9px] text-red-400 font-medium">PT</span>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

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
          <div className="card overflow-x-auto min-w-0">
            <div
              className="grid"
              style={{ gridTemplateColumns: `120px repeat(${SHIFT_BLOCKS.length}, 1fr)` }}
            >
              {/* Top-left corner cell: date */}
              <div className="flex flex-col items-center justify-center border-b border-r border-gray-100 bg-gray-50 px-2 py-3">
                <p className="text-[10px] text-gray-400 uppercase tracking-wide">Date</p>
                <p className="text-sm font-bold text-gray-900">{date}</p>
              </div>

              {/* Header row: 4 fixed 6-hour blocks */}
              {SHIFT_BLOCKS.map((b) => (
                <div
                  key={`col-${b.label}`}
                  className="flex items-center justify-center border-b border-gray-100 bg-gray-50 px-2 py-3"
                >
                  <span className="text-xs font-semibold text-gray-700">{b.label}</span>
                </div>
              ))}

              {/* Rows: one per ambulance */}
              {ambulanceRows.map((rowSlot) => {
                const rowKey = ambKey(rowSlot);
                const rowSlots = displaySlots.filter((s) => ambKey(s) === rowKey);

                // Walk the 4 blocks left to right. At each block, find the
                // driver slot and attendant slot (both may exist for the same
                // time range), combine them in one cell, then skip the span.
                const cells: React.ReactNode[] = [];
                let blockIdx = 0;
                while (blockIdx < SHIFT_BLOCKS.length) {
                  const slotsAtBlock = slotsForBlock(rowSlots, blockIdx);
                  if (slotsAtBlock.length > 0) {
                    const driverS = slotsAtBlock.find((s) => s.required_role === 'driver') || null;
                    const attendantS = slotsAtBlock.find((s) => s.required_role !== 'driver') || null;
                    // For an overnight shift wrapping into block 0, only span 1
                    const span = blockIdx === 0 && slotsAtBlock.some(isOvernightShift)
                      ? 1
                      : Math.min(blockSpanForSlot(slotsAtBlock[0]), SHIFT_BLOCKS.length - blockIdx);
                    cells.push(renderCell(rowKey, driverS, attendantS, span, blockIdx, `${rowKey}-${blockIdx}`));
                    blockIdx += span;
                  } else {
                    cells.push(renderCell(rowKey, null, null, 1, blockIdx, `${rowKey}-${blockIdx}`));
                    blockIdx += 1;
                  }
                }

                return (
                  <React.Fragment key={rowKey}>
                    {/* Row header: ambulance */}
                    <div style={{ gridColumn: 1 }} className="flex flex-col items-center justify-center border-r border-b border-gray-100 bg-gray-50 px-2 py-3">
                      <p className="text-sm font-bold text-gray-900 truncate w-full text-center">{rowKey}</p>
                      <p className="text-xs text-gray-400 truncate w-full text-center">{rowSlot.ambulance?.vehicle_number}</p>
                    </div>
                    {cells}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        )}

        {/* Expanded detail — same content/behavior as the previous accordion expand,
            now shown below the grid since a grid cell has no room to expand in place. */}
        {expandedSlotData && (
          <div className="card mt-3 border-t-2 border-blue-200 bg-gray-50 px-4 py-3">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-gray-800">
                {ambKey(expandedSlotData)} · {timeKey(expandedSlotData)}
              </p>
              <button
                onClick={() => setExpandedSlot(null)}
                className="text-gray-400 hover:text-gray-600"
                aria-label="Close details"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mb-3">
              <div>
                <p className="text-xs text-gray-500 mb-1">Slot ID</p>
                <p className="font-mono text-xs text-gray-700">{expandedSlotData.id}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Date</p>
                <p className="font-medium text-gray-800">{expandedSlotData.shift_date}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Job Type</p>
                <p className="font-medium text-gray-800">{expandedSlotData.job_type}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Hours</p>
                <p className="font-medium text-gray-800">
                  {expandedSlotData.shift_start && expandedSlotData.shift_end
                    ? `${calcHours(expandedSlotData.shift_start, expandedSlotData.shift_end)}h`
                    : '—'}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Staff</p>
                {!isReadOnly && onSlotSwap && (
                  <button
                    onClick={() => onSlotSwap(expandedSlotData.id, expandedSlotData.required_role === 'driver' ? 'driver' : 'attendant')}
                    className="btn-secondary btn-sm text-xs"
                  >
                    <svg className="w-3 h-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                    </svg>
                    {hasAssignment ? 'Swap Staff' : 'Assign Staff'}
                  </button>
                )}
              </div>
              {hasAssignment ? (
                (expandedSlotData.assignments ?? []).map((a) => {
                  const violates =
                    blockSpanForSlot(expandedSlotData) === 2 && a.staff?.employment_type === 'part_time';
                  return (
                    <div
                      key={a.id}
                      className={`flex items-center justify-between bg-white rounded-lg px-3 py-2 border ${
                        violates ? 'border-red-300' : 'border-gray-100'
                      }`}
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
                          <p className="text-xs text-gray-500 capitalize">
                            {a.staff?.role}
                            {a.staff?.employment_type === 'part_time' ? ' · Part-time' : ''}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        {violates && (
                          <span className="text-[10px] text-red-500 font-medium mb-1 block">
                            Part-timer on 12h shift
                          </span>
                        )}
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
                  );
                })
              ) : !isReadOnly && onSlotSwap ? (
                <div className="bg-white rounded-lg border border-dashed border-gray-200 px-3 py-4 text-center">
                  <p className="text-sm text-gray-400 mb-2">No staff assigned</p>
                  <button
                    onClick={() => onSlotSwap(expandedSlotData.id, expandedSlotData.required_role === 'driver' ? 'driver' : 'attendant')}
                    className="btn-primary btn-sm"
                  >
                    Assign Staff
                  </button>
                </div>
              ) : (
                <div className="bg-white rounded-lg border border-dashed border-gray-200 px-3 py-4 text-center">
                  <p className="text-sm text-gray-400">No staff assigned</p>
                </div>
              )}
            </div>
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
