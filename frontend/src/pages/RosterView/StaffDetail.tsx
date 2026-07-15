import React, { useState, useEffect } from 'react';
import { format, startOfWeek, addDays, parseISO } from 'date-fns';
import { staffApi } from '../../api/staff';
import { calendarApi } from '../../api/calendar';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import type { Staff, Assignment, Certification } from '../../types';

interface StaffDetailProps {
  staff: Staff;
  onClose: () => void;
}

interface WeeklyData {
  assignments: Assignment[];
  total_hours: number;
  consecutive_days: number;
}

export const StaffDetail: React.FC<StaffDetailProps> = ({ staff, onClose }) => {
  const [weeklyData, setWeeklyData] = useState<WeeklyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [certifications, setCertifications] = useState<Certification[]>(staff.certifications ?? []);
  const [exporting, setExporting] = useState(false);

  const handleExportSchedule = async () => {
    setExporting(true);
    try {
      await calendarApi.downloadStaffSchedule(staff.id, staff.name);
    } catch {
      /* surfaced by the download failing silently; keep the modal usable */
    } finally {
      setExporting(false);
    }
  };

  const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(parseISO(weekStart), i));

  useEffect(() => {
    setLoading(true);
    staffApi
      .getWeeklySchedule(staff.id, weekStart)
      .then(setWeeklyData)
      .catch((err) => setError(err.message || 'Failed to load weekly schedule'))
      .finally(() => setLoading(false));
  }, [staff.id, weekStart]);

  // The staff object from the roster grid carries no certifications — load them.
  useEffect(() => {
    staffApi
      .getCertifications(staff.id)
      .then(setCertifications)
      .catch(() => { /* keep whatever the caller provided */ });
  }, [staff.id]);

  const roleColor: Record<string, string> = {
    // Driver → sky so it doesn't collide with paramedic red under the re-theme.
    driver: 'bg-sky-100 text-sky-700',
    medic: 'bg-green-100 text-green-700',
    emt: 'bg-purple-100 text-purple-700',
    paramedic: 'bg-red-100 text-red-700',
  };

  const getAssignmentForDay = (date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    return weeklyData?.assignments.find((a) => {
      const slotDate = a.slot?.shift_date;
      return slotDate === dateStr;
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white px-6 py-4 border-b border-gray-100 flex items-center justify-between rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-700 font-semibold">
              {staff.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">{staff.name}</h3>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={`badge ${roleColor[staff.role] || 'badge-gray'} capitalize`}>
                  {staff.role}
                </span>
                <span className="badge-gray badge capitalize">
                  {staff.employment_type.replace('_', ' ')}
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Contact info */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-gray-500 mb-1">Email</p>
              <p className="text-sm font-medium text-gray-800">{staff.email}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Phone</p>
              <p className="text-sm font-medium text-gray-800">{staff.phone}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Home Postal</p>
              <p className="text-sm font-medium text-gray-800">{staff.home_postal}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Status</p>
              <span className={`badge capitalize ${
                staff.status === 'active' ? 'badge-green' :
                staff.status === 'on_leave' ? 'badge-yellow' : 'badge-gray'
              }`}>
                {staff.status.replace('_', ' ')}
              </span>
            </div>
          </div>

          {/* Weekly Schedule */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold text-gray-900">Weekly Schedule</h4>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleExportSchedule}
                  disabled={exporting}
                  className="btn-secondary btn-sm text-xs"
                  title="Download this staff member's shifts as an .ics calendar file"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  {exporting ? 'Exporting…' : 'Add to Calendar'}
                </button>
                <span className="text-xs text-gray-500">Week of {format(parseISO(weekStart), 'MMM d, yyyy')}</span>
              </div>
            </div>

            {loading ? (
              <div className="flex justify-center py-8">
                <LoadingSpinner size="md" />
              </div>
            ) : error ? (
              <div className="bg-red-50 text-red-700 text-sm p-3 rounded-lg">{error}</div>
            ) : (
              <>
                {/* Stats */}
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-blue-50 rounded-xl p-3 text-center">
                    <p className="text-2xl font-bold text-blue-700">
                      {weeklyData?.total_hours?.toFixed(1) || '0.0'}
                    </p>
                    <p className="text-xs text-blue-600 mt-0.5">Cumulative Hours</p>
                  </div>
                  <div className={`rounded-xl p-3 text-center ${
                    (weeklyData?.consecutive_days || 0) >= 7
                      ? 'bg-red-50'
                      : (weeklyData?.consecutive_days || 0) >= 5
                      ? 'bg-amber-50'
                      : 'bg-green-50'
                  }`}>
                    <p className={`text-2xl font-bold ${
                      (weeklyData?.consecutive_days || 0) >= 7
                        ? 'text-red-700'
                        : (weeklyData?.consecutive_days || 0) >= 5
                        ? 'text-amber-700'
                        : 'text-green-700'
                    }`}>
                      {weeklyData?.consecutive_days || 0}
                    </p>
                    <p className={`text-xs mt-0.5 ${
                      (weeklyData?.consecutive_days || 0) >= 7
                        ? 'text-red-600'
                        : (weeklyData?.consecutive_days || 0) >= 5
                        ? 'text-amber-600'
                        : 'text-green-600'
                    }`}>Consecutive Days</p>
                  </div>
                </div>

                {/* 7-day grid */}
                <div className="grid grid-cols-7 gap-1">
                  {weekDays.map((day) => {
                    const assignment = getAssignmentForDay(day);
                    const isToday = format(day, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');
                    const isWeekend = day.getDay() === 0 || day.getDay() === 6;

                    return (
                      <div
                        key={day.toISOString()}
                        className={`
                          rounded-lg p-2 text-center text-xs
                          ${isToday ? 'ring-2 ring-blue-400' : ''}
                          ${assignment
                            ? assignment.status === 'dropped'
                              ? 'bg-red-100'
                              : 'bg-blue-100'
                            : isWeekend
                            ? 'bg-gray-50'
                            : 'bg-white border border-gray-100'
                          }
                        `}
                      >
                        <p className={`font-semibold mb-1 ${isToday ? 'text-blue-700' : 'text-gray-500'}`}>
                          {format(day, 'EEE')}
                        </p>
                        <p className="font-bold text-gray-800">{format(day, 'd')}</p>
                        {assignment ? (
                          <div className="mt-1 space-y-0.5">
                            <p className="text-blue-700 font-medium text-[10px]">
                              {assignment.slot?.job_type}
                            </p>
                            <p className="text-gray-500 text-[9px]">
                              {assignment.slot?.shift_start?.slice(0, 5)}
                            </p>
                          </div>
                        ) : (
                          <p className="text-gray-300 text-[10px] mt-1">Off</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* Certifications */}
          {certifications.length > 0 && (
            <div>
              <h4 className="font-semibold text-gray-900 mb-3">Certifications</h4>
              <div className="space-y-2">
                {certifications.map((cert) => {
                  const expiryDate = new Date(cert.expires_at);
                  const hasExpiry = Boolean(cert.expires_at) && !isNaN(expiryDate.getTime());
                  const now = new Date();
                  const daysToExpiry = hasExpiry
                    ? Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
                    : Infinity;
                  const isExpired = hasExpiry && daysToExpiry < 0;
                  const isExpiringSoon = hasExpiry && daysToExpiry >= 0 && daysToExpiry <= 30;

                  return (
                    <div key={cert.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div>
                        <p className="text-sm font-medium text-gray-800">{cert.cert_name}</p>
                        {cert.cert_number && (
                          <p className="text-xs text-gray-500">#{cert.cert_number}</p>
                        )}
                      </div>
                      <div className="text-right">
                        <span className={`badge ${
                          isExpired ? 'badge-red' : isExpiringSoon ? 'badge-yellow' : hasExpiry ? 'badge-green' : 'badge-gray'
                        }`}>
                          {!hasExpiry
                            ? 'No expiry'
                            : isExpired
                            ? 'Expired'
                            : isExpiringSoon
                            ? `Expires in ${daysToExpiry}d`
                            : format(expiryDate, 'dd MMM yyyy')
                          }
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
