import React from 'react';

/**
 * Dual-handle time-range slider on a 00:00–23:59 scale.
 *
 * Values are minutes from midnight in STEP-minute increments; 1440 renders and
 * submits as 23:59, i.e. "until the end of the day". Implemented as two native
 * range inputs stacked on the same track — the inputs are invisible except for
 * their thumbs (the two draggable dots), so each dot stays keyboard- and
 * touch-accessible for free.
 */

export const DAY_START_MIN = 0;
export const DAY_END_MIN = 1440;
export const STEP_MIN = 15;

/** 810 → "13:30"; 1440 → "23:59" (end-of-day). */
export function minutesToHHMM(min: number): string {
  if (min >= DAY_END_MIN) return '23:59';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 810 → "1:30 PM"; 1440 → "11:59 PM". */
export function minutesToLabel(min: number): string {
  if (min >= DAY_END_MIN) return '11:59 PM';
  const h = Math.floor(min / 60);
  const m = min % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

interface TimeRangeSliderProps {
  /** Window start, minutes from midnight (multiple of STEP_MIN). */
  startMin: number;
  /** Window end, minutes from midnight; 1440 = end of day (23:59). */
  endMin: number;
  onChange: (startMin: number, endMin: number) => void;
  disabled?: boolean;
}

export const TimeRangeSlider: React.FC<TimeRangeSliderProps> = ({
  startMin,
  endMin,
  onChange,
  disabled,
}) => {
  const pct = (v: number) => (v / DAY_END_MIN) * 100;

  const handleStart = (value: number) => {
    onChange(Math.min(value, endMin - STEP_MIN), endMin);
  };
  const handleEnd = (value: number) => {
    onChange(startMin, Math.max(value, startMin + STEP_MIN));
  };

  // When both dots sit at the far right the end input would cover the start
  // dot — lift the start input on top there so it can still be dragged back.
  const startOnTop = startMin > DAY_END_MIN - 8 * STEP_MIN;

  return (
    <div className={disabled ? 'opacity-50 pointer-events-none' : ''}>
      <div className="relative h-6">
        {/* Track */}
        <div className="absolute top-1/2 -translate-y-1/2 w-full h-2 rounded-full bg-gray-200" />
        {/* Selected window */}
        <div
          className="absolute top-1/2 -translate-y-1/2 h-2 rounded-full bg-green-500"
          style={{ left: `${pct(startMin)}%`, width: `${pct(endMin) - pct(startMin)}%` }}
        />
        <input
          type="range"
          min={DAY_START_MIN}
          max={DAY_END_MIN}
          step={STEP_MIN}
          value={startMin}
          onChange={(e) => handleStart(Number(e.target.value))}
          disabled={disabled}
          aria-label="Available from"
          aria-valuetext={minutesToLabel(startMin)}
          className={`time-range-thumb absolute inset-0 w-full ${startOnTop ? 'z-30' : 'z-10'}`}
        />
        <input
          type="range"
          min={DAY_START_MIN}
          max={DAY_END_MIN}
          step={STEP_MIN}
          value={endMin}
          onChange={(e) => handleEnd(Number(e.target.value))}
          disabled={disabled}
          aria-label="Available until"
          aria-valuetext={minutesToLabel(endMin)}
          className="time-range-thumb absolute inset-0 w-full z-20"
        />
      </div>
      {/* Hour ticks */}
      <div className="flex justify-between text-[10px] text-gray-400 mt-1 font-mono">
        <span>00:00</span>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>23:59</span>
      </div>
    </div>
  );
};
