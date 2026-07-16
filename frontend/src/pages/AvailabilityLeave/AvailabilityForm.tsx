import React, { useState, useEffect } from 'react';
import { eachDayOfInterval, parseISO, format } from 'date-fns';
import { availabilityApi } from '../../api/availability';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import {
  TimeRangeSlider,
  DAY_START_MIN,
  DAY_END_MIN,
  minutesToHHMM,
  minutesToLabel,
} from '../../components/TimeRangeSlider';
import { useToast } from '../../components/Toast';
import type { Availability, Staff } from '../../types';

interface AvailabilityFormProps {
  staffList: Staff[];
  /** Pre-selected staff (locked for employees). */
  initialStaffId?: string;
  /** Pre-filled date (e.g. from clicking a calendar cell). */
  initialDate?: string;
  onSaved?: (records: Availability[]) => void;
}

type AvailChoice = 'available' | 'unavailable';

const CHOICES: { value: AvailChoice; label: string; desc: string; ring: string }[] = [
  { value: 'available', label: 'Available', desc: 'Set my hours below', ring: 'border-green-500 bg-green-50 text-green-700' },
  { value: 'unavailable', label: 'Unavailable', desc: 'Not working', ring: 'border-red-500 bg-red-50 text-red-700' },
];

export const AvailabilityForm: React.FC<AvailabilityFormProps> = ({
  staffList,
  initialStaffId,
  initialDate,
  onSaved,
}) => {
  const today = format(new Date(), 'yyyy-MM-dd');
  const [staffId, setStaffId] = useState(initialStaffId ?? staffList[0]?.id ?? '');
  const [startDate, setStartDate] = useState(initialDate ?? today);
  const [endDate, setEndDate] = useState(initialDate ?? today);
  const [choice, setChoice] = useState<AvailChoice>('available');
  const [windowStart, setWindowStart] = useState(DAY_START_MIN);
  const [windowEnd, setWindowEnd] = useState(DAY_END_MIN);
  const [saving, setSaving] = useState(false);
  const { success, warning, error: toastError } = useToast();

  useEffect(() => {
    if (initialStaffId) setStaffId(initialStaffId);
  }, [initialStaffId]);

  useEffect(() => {
    if (initialDate) {
      setStartDate(initialDate);
      setEndDate(initialDate);
    }
  }, [initialDate]);

  const rangeDays =
    startDate && endDate && endDate >= startDate
      ? eachDayOfInterval({ start: parseISO(startDate), end: parseISO(endDate) })
      : startDate
      ? [parseISO(startDate)]
      : [];

  const isFullDay = windowStart === DAY_START_MIN && windowEnd === DAY_END_MIN;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staffId) {
      toastError('Select a staff member');
      return;
    }
    if (endDate < startDate) {
      toastError('End date must be on or after start date');
      return;
    }

    setSaving(true);
    const is_available = choice === 'available';
    // A window narrower than the full 00:00–23:59 scale is stored as
    // start/end times; the full scale means "the whole day" (no window).
    const sendWindow = is_available && !isFullDay;
    try {
      // One upsert per day in the range (the API is a per-day upsert).
      const saved = await Promise.all(
        rangeDays.map((day) =>
          availabilityApi.upsert({
            staff_id: staffId,
            work_date: format(day, 'yyyy-MM-dd'),
            is_available,
            start_time: sendWindow ? minutesToHHMM(windowStart) : null,
            end_time: sendWindow ? minutesToHHMM(windowEnd) : null,
          })
        )
      );
      const records = saved.map((s) => s.availability);
      const totalFlags = saved.reduce((sum, s) => sum + s.flagsRaised, 0);
      if (totalFlags > 0) {
        // Reduced availability stranded existing assignments — tell the user a
        // coverage gap was created so they can arrange replacements.
        warning(
          'Saved — coverage gaps created!',
          `${records.length} day${records.length === 1 ? '' : 's'} updated, but ${totalFlags} ` +
            `assignment${totalFlags === 1 ? '' : 's'} now conflict with this availability. ` +
            `${totalFlags} flag${totalFlags === 1 ? '' : 's'} raised — resolve them in the Exceptions panel.`
        );
      } else {
        success(
          'Availability saved',
          `${records.length} day${records.length === 1 ? '' : 's'} updated for the roster engine.`
        );
      }
      onSaved?.(records);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save availability';
      toastError('Save failed', msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Staff member */}
      <div className="form-group">
        <label className="label">Staff Member *</label>
        <select
          value={staffId}
          onChange={(e) => setStaffId(e.target.value)}
          className="input"
          disabled={staffList.length <= 1}
        >
          {staffList.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} — {s.role}
            </option>
          ))}
        </select>
      </div>

      {/* Date range */}
      <div className="grid grid-cols-2 gap-3">
        <div className="form-group">
          <label className="label">From *</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              if (endDate < e.target.value) setEndDate(e.target.value);
            }}
            className="input"
          />
        </div>
        <div className="form-group">
          <label className="label">To *</label>
          <input
            type="date"
            value={endDate}
            min={startDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="input"
          />
        </div>
      </div>
      <p className="text-xs text-gray-500 -mt-2">
        Applies to <strong>{rangeDays.length}</strong> day{rangeDays.length === 1 ? '' : 's'}. Set a range to
        submit recurring availability in one go.
      </p>

      {/* Availability choice */}
      <div className="form-group">
        <label className="label">Availability *</label>
        <div className="grid grid-cols-2 gap-2">
          {CHOICES.map((c) => (
            <button
              type="button"
              key={c.value}
              onClick={() => setChoice(c.value)}
              className={`flex flex-col items-center text-center p-3 rounded-xl border-2 transition-all ${
                choice === c.value ? c.ring : 'border-gray-200 hover:border-gray-300 text-gray-600'
              }`}
            >
              <span className="text-sm font-semibold">{c.label}</span>
              <span className="text-xs mt-0.5 opacity-70">{c.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Time window — drag the two dots to the hours you can work */}
      {choice === 'available' && (
        <div className="form-group p-4 rounded-xl border border-gray-200 bg-gray-50">
          <div className="flex items-center justify-between mb-3">
            <label className="label mb-0">My hours</label>
            <span className="text-sm font-semibold text-green-700">
              {isFullDay ? 'All day' : `${minutesToLabel(windowStart)} – ${minutesToLabel(windowEnd)}`}
            </span>
          </div>
          <TimeRangeSlider
            startMin={windowStart}
            endMin={windowEnd}
            onChange={(s, e) => {
              setWindowStart(s);
              setWindowEnd(e);
            }}
          />
          <div className="flex items-center justify-between mt-2">
            <p className="text-xs text-gray-500">
              Drag the dots to set when you're free — e.g. 1:00 PM – 7:00 PM, or 8:00 PM onwards.
            </p>
            {!isFullDay && (
              <button
                type="button"
                onClick={() => {
                  setWindowStart(DAY_START_MIN);
                  setWindowEnd(DAY_END_MIN);
                }}
                className="text-xs font-medium text-blue-600 hover:text-blue-700 flex-shrink-0 ml-3"
              >
                Reset to all day
              </button>
            )}
          </div>
        </div>
      )}

      <button type="submit" disabled={saving || rangeDays.length === 0} className="btn-primary w-full">
        {saving ? (
          <span className="flex items-center justify-center gap-2">
            <LoadingSpinner size="sm" color="border-white" />
            Saving…
          </span>
        ) : (
          'Save Availability'
        )}
      </button>
    </form>
  );
};
