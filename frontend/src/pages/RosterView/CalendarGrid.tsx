import React, { useState } from 'react';
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addDays,
  addMonths,
  subMonths,
  isSameDay,
  isSameMonth,
  isToday,
  parseISO,
} from 'date-fns';

interface CalendarGridProps {
  selectedDate: string;
  onDateSelect: (date: string) => void;
  onMonthChange?: (year: number, month: number) => void;
  rosterDates: Set<string>;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const CalendarGrid: React.FC<CalendarGridProps> = ({
  selectedDate,
  onDateSelect,
  onMonthChange,
  rosterDates,
}) => {
  const [currentMonth, setCurrentMonth] = useState(() =>
    startOfMonth(parseISO(selectedDate))
  );

  const notifyMonth = React.useCallback((m: Date) => {
    onMonthChange?.(m.getFullYear(), m.getMonth() + 1);
  }, [onMonthChange]);

  React.useEffect(() => {
    notifyMonth(currentMonth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = parseISO(selectedDate);
  const today = new Date();

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calStart = startOfWeek(monthStart);
  const calEnd = endOfWeek(monthEnd);

  const days: Date[] = [];
  let day = calStart;
  while (day <= calEnd) {
    days.push(day);
    day = addDays(day, 1);
  }
  const prevMonth = () => {
    const m = subMonths(currentMonth, 1);
    setCurrentMonth(m);
    notifyMonth(m);
  };
  const nextMonth = () => {
    const m = addMonths(currentMonth, 1);
    setCurrentMonth(m);
    notifyMonth(m);
  };

  return (
    <div className="card p-4">
      {/* Month/Year header with nav */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={prevMonth}
          className="btn-secondary btn-sm p-1"
          aria-label="Previous month"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h3 className="text-sm font-bold text-gray-900">
          {format(currentMonth, 'MMMM yyyy')}
        </h3>
        <button
          onClick={nextMonth}
          className="btn-secondary btn-sm p-1"
          aria-label="Next month"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 gap-0 mb-1">
        {WEEKDAYS.map((wd) => (
          <div
            key={wd}
            className="text-center text-[10px] font-semibold text-gray-500 uppercase tracking-wide py-1"
          >
            {wd}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-0">
        {days.map((d) => {
          const dateStr = format(d, 'yyyy-MM-dd');
          const isSelected = isSameDay(d, selected);
          const isCurrentMonth = isSameMonth(d, currentMonth);
          const todayMatch = isToday(d);
          const hasRoster = rosterDates.has(dateStr);

          return (
            <button
              key={dateStr}
              onClick={() => onDateSelect(dateStr)}
              className={`
                text-center text-xs py-1.5 rounded transition-colors
                ${!isCurrentMonth ? 'text-gray-300' : 'text-gray-700'}
                ${isSelected
                  ? 'bg-blue-600 text-white font-bold shadow-sm'
                  : todayMatch
                    ? 'bg-blue-50 text-blue-700 font-semibold'
                    : hasRoster
                      ? 'bg-blue-100'
                      : 'hover:bg-gray-100'
                }
              `}
            >
              {format(d, 'd')}
            </button>
          );
        })}
      </div>

      {/* Quick today button */}
      <button
        onClick={() => onDateSelect(format(today, 'yyyy-MM-dd'))}
        className="btn-secondary btn-sm w-full mt-2 text-xs"
      >
        Today
      </button>
    </div>
  );
};
