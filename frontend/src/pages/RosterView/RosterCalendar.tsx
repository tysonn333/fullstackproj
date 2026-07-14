import React, { useState, useEffect, useCallback } from 'react';
import {
  format,
  parseISO,
  isWeekend,
  isSameMonth,
  isSameDay,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  addMonths,
  subMonths,
} from 'date-fns';
import { rosterApi } from '../../api/roster';
import { TimelineGrid } from './TimelineGrid';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import type { ShiftSlot, Staff } from '../../types';

interface RosterCalendarProps {
  selectedDate: string;
  onSelectDate: (date: string) => void;
  onStaffClick: (staff: Staff) => void;
  holidays: string[];
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const RosterCalendar: React.FC<RosterCalendarProps> = ({
  selectedDate,
  onSelectDate,
  onStaffClick,
  holidays,
}) => {
  const [month, setMonth] = useState<Date>(startOfMonth(parseISO(selectedDate)));
  const [rosterDays, setRosterDays] = useState<Map<string, string>>(new Map()); // date -> status
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [daySlots, setDaySlots] = useState<Record<string, ShiftSlot[]>>({});
  const [loadingDay, setLoadingDay] = useState<string | null>(null);

  const today = format(new Date(), 'yyyy-MM-dd');

  // The 6-week grid that covers the visible month.
  const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 0 });
  const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  const isHoliday = (dateStr: string) => holidays.includes(dateStr);

  // Load which days in the visible grid have a roster (for the per-day dots).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await rosterApi.listRange(
          format(gridStart, 'yyyy-MM-dd'),
          format(gridEnd, 'yyyy-MM-dd')
        );
        if (!cancelled) setRosterDays(new Map(rows.map((r) => [r.date, r.status])));
      } catch {
        if (!cancelled) setRosterDays(new Map());
      }
    })();
    return () => {
      cancelled = true;
    };
    // gridStart/gridEnd derive from month; re-run when the month changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const toggleDay = useCallback(
    async (dateStr: string) => {
      onSelectDate(dateStr);
      if (expandedDate === dateStr) {
        setExpandedDate(null);
        return;
      }
      setExpandedDate(dateStr);
      if (!daySlots[dateStr]) {
        setLoadingDay(dateStr);
        try {
          const slots = await rosterApi.getSlots(dateStr);
          setDaySlots((prev) => ({ ...prev, [dateStr]: slots }));
        } catch {
          setDaySlots((prev) => ({ ...prev, [dateStr]: [] }));
        } finally {
          setLoadingDay(null);
        }
      }
    },
    [expandedDate, daySlots, onSelectDate]
  );

  const goPrev = () => {
    setExpandedDate(null);
    setMonth((m) => subMonths(m, 1));
  };
  const goNext = () => {
    setExpandedDate(null);
    setMonth((m) => addMonths(m, 1));
  };
  const goToday = () => {
    setExpandedDate(null);
    setMonth(startOfMonth(new Date()));
  };

  const renderExpanded = (dateStr: string) => {
    const slots = daySlots[dateStr];
    const weekendOrHoliday = isWeekend(parseISO(dateStr)) || isHoliday(dateStr);
    return (
      <div className="border-t border-gray-200 bg-gray-50 px-4 py-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-gray-800">
            {format(parseISO(dateStr), 'EEEE, dd MMMM yyyy')}
          </p>
          <button
            onClick={() => setExpandedDate(null)}
            className="text-gray-400 hover:text-gray-600"
            title="Collapse"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
            </svg>
          </button>
        </div>

        {loadingDay === dateStr ? (
          <div className="py-8 flex justify-center">
            <LoadingSpinner size="md" label="Loading shifts…" />
          </div>
        ) : slots && slots.length > 0 ? (
          <TimelineGrid
            slots={slots}
            isReadOnly={dateStr < today}
            isWeekendOrHoliday={weekendOrHoliday}
            onStaffClick={onStaffClick}
          />
        ) : (
          <p className="text-sm text-gray-400 py-6 text-center">
            No roster generated for this day.
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="card p-0 overflow-hidden">
      {/* Month header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <h3 className="text-lg font-bold text-gray-900">{format(month, 'MMMM yyyy')}</h3>
        <div className="flex items-center gap-2">
          <button onClick={goToday} className="btn-secondary btn-sm">
            Today
          </button>
          <button onClick={goPrev} className="btn-secondary btn-sm" title="Previous month">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button onClick={goNext} className="btn-secondary btn-sm" title="Next month">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Weekday labels */}
      <div className="grid grid-cols-7 border-b border-gray-100 bg-gray-50">
        {WEEKDAYS.map((d) => (
          <div key={d} className="px-2 py-2 text-center text-xs font-semibold text-gray-500">
            {d}
          </div>
        ))}
      </div>

      {/* Weeks */}
      {weeks.map((week, wi) => {
        const expandedInThisWeek = expandedDate
          ? week.some((d) => format(d, 'yyyy-MM-dd') === expandedDate)
          : false;
        return (
          <React.Fragment key={wi}>
            <div className="grid grid-cols-7">
              {week.map((day) => {
                const dateStr = format(day, 'yyyy-MM-dd');
                const inMonth = isSameMonth(day, month);
                const isToday = dateStr === today;
                const isSelected = dateStr === selectedDate;
                const isExpanded = dateStr === expandedDate;
                const weekendOrHoliday = isWeekend(day) || isHoliday(dateStr);
                const status = rosterDays.get(dateStr);

                return (
                  <button
                    key={dateStr}
                    onClick={() => toggleDay(dateStr)}
                    className={`min-h-[76px] border-b border-r border-gray-100 p-2 text-left align-top transition-colors relative
                      ${inMonth ? 'bg-white' : 'bg-gray-50/60'}
                      ${weekendOrHoliday && inMonth ? 'bg-amber-50/40' : ''}
                      ${isExpanded ? 'ring-2 ring-inset ring-blue-400' : 'hover:bg-blue-50/50'}`}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-sm font-medium flex items-center justify-center w-6 h-6 rounded-full
                          ${isToday ? 'bg-blue-600 text-white' : inMonth ? 'text-gray-800' : 'text-gray-400'}
                          ${isSelected && !isToday ? 'ring-1 ring-blue-400' : ''}`}
                      >
                        {format(day, 'd')}
                      </span>
                      {isHoliday(dateStr) && inMonth && (
                        <span className="text-[9px] font-semibold text-amber-600">PH</span>
                      )}
                    </div>

                    {/* Roster indicator */}
                    {status && (
                      <div className="mt-2">
                        <span
                          className={`inline-block text-[10px] px-1.5 py-0.5 rounded-full font-medium
                            ${status === 'draft'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-emerald-100 text-emerald-700'}`}
                        >
                          {status === 'draft' ? 'Draft' : 'Published'}
                        </span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Inline expansion beneath the week that contains the open day */}
            {expandedInThisWeek && expandedDate && renderExpanded(expandedDate)}
          </React.Fragment>
        );
      })}
    </div>
  );
};
