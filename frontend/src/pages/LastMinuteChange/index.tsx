import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { format, addDays } from 'date-fns';
import { rosterApi } from '../../api/roster';
import { staffApi } from '../../api/staff';
import { CandidateList } from './CandidateList';
import { PageLoader } from '../../components/LoadingSpinner';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import type { ShiftSlot, Staff } from '../../types';

type Step = 'select-slot' | 'select-candidate' | 'confirm' | 'done';

interface Candidate {
  staff: Staff;
  current_load: number;
  rest_hours: number;
  active_flags: number;
  score: number;
  reason: string;
}

const jobTypeBadge: Record<string, string> = {
  MTS: 'badge-blue',
  EAS: 'bg-emerald-100 text-emerald-700',
};

const statusBadge: Record<string, string> = {
  scheduled: 'badge-blue',
  active: 'badge-green',
  completed: 'badge-gray',
  cancelled: 'badge-red',
  unfilled: 'badge-yellow',
};

function calcHours(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let diff = (eh * 60 + em) - (sh * 60 + sm);
  if (diff < 0) diff += 24 * 60;
  return parseFloat((diff / 60).toFixed(1));
}

export const LastMinuteChange: React.FC = () => {
  // Deep-link support: a "Find Replacement" flag button lands here with ?date=.
  const [searchParams] = useSearchParams();
  const dateParam = searchParams.get('date');
  const initialDate =
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : format(new Date(), 'yyyy-MM-dd');
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [slots, setSlots] = useState<ShiftSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(true);
  const [selectedSlot, setSelectedSlot] = useState<ShiftSlot | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('select-slot');
  const [swapReason, setSwapReason] = useState('');
  const [swapping, setSwapping] = useState(false);

  const { success, error: toastError } = useToast();
  const { confirm } = useConfirm();

  const loadSlots = useCallback(async (date: string) => {
    setLoadingSlots(true);
    setSlots([]);
    setSelectedSlot(null);
    setStep('select-slot');
    try {
      const data = await rosterApi.getSlots(date);
      setSlots(data);
    } catch {
      toastError('Failed to load roster for this date');
    } finally {
      setLoadingSlots(false);
    }
  }, [toastError]);

  useEffect(() => {
    loadSlots(selectedDate);
  }, [selectedDate, loadSlots]);

  const handleFlagDrop = async () => {
    if (!selectedSlot) return;
    const assignments = selectedSlot.assignments || [];
    if (assignments.length === 0) {
      toastError('No staff to drop', 'This slot has no assigned staff.');
      return;
    }
    // If multiple staff, need to select one; for simplicity use the first
    const staffToDrop = assignments[0];

    confirm({
      title: 'Mark Staff as Unavailable',
      message: `Mark ${staffToDrop.staff?.name || 'staff'} as dropped for this slot? This will trigger a replacement search.`,
      confirmLabel: 'Mark Dropped',
      variant: 'warning',
      onConfirm: async () => {
        try {
          await rosterApi.flagDropped(staffToDrop.id, selectedSlot.id);
        } catch (err) {
          const backendError = axios.isAxiosError(err)
            ? (err.response?.data as { error?: string } | undefined)?.error
            : undefined;
          toastError('Could not mark staff as dropped', backendError);
          return;
        }
        success('Staff marked as dropped', 'Finding replacement candidates...');
        setStep('select-candidate');
        setLoadingCandidates(true);
        try {
          const data = await rosterApi.getReplacementCandidates(selectedSlot.id);
          setCandidates(data);
        } catch {
          toastError('Could not load candidates');
        } finally {
          setLoadingCandidates(false);
        }
      },
    });
  };

  // UC-006 A3 — staff absent for the ENTIRE day: batch-cancel all their
  // assignments for the date; each affected slot becomes a flagged
  // replacement event in the exceptions panel.
  const handleAbsentAllDay = () => {
    if (!selectedSlot) return;
    const assignments = selectedSlot.assignments || [];
    const staffToDrop = assignments[0];
    if (!staffToDrop?.staff) {
      toastError('No staff to mark absent', 'This slot has no assigned staff.');
      return;
    }
    const staff = staffToDrop.staff;

    confirm({
      title: 'Absent for the entire day?',
      message:
        `Mark ${staff.name} as unavailable for ALL of ${selectedDate}? Every shift they are ` +
        'assigned to that day will be dropped and flagged for replacement in the exceptions panel.',
      confirmLabel: 'Mark Absent All Day',
      variant: 'danger',
      onConfirm: async () => {
        try {
          const result = await staffApi.markUnavailable(staff.id, selectedDate, 'full-day absence (UC-006)');
          success(
            'Staff marked absent for the day',
            `${result.assignments_cancelled} assignment(s) dropped · ${result.flags_raised} flag(s) raised. ` +
              'Handle each replacement below or from the Exceptions panel.'
          );
          handleReset();
        } catch (err) {
          const backendError = axios.isAxiosError(err)
            ? (err.response?.data as { error?: string } | undefined)?.error
            : undefined;
          toastError('Could not mark staff absent', backendError);
        }
      },
    });
  };

  const handleConfirmSwap = async () => {
    if (!selectedSlot || !selectedCandidateId) return;
    setSwapping(true);
    try {
      await rosterApi.confirmSwap(selectedSlot.id, selectedCandidateId, swapReason);
      const candidate = candidates.find((c) => c.staff.id === selectedCandidateId);
      success(
        'Swap confirmed!',
        `${candidate?.staff.name || 'Staff'} has been assigned to replace the dropped slot.`
      );
      setStep('done');
    } catch (err) {
      const backendError = axios.isAxiosError(err)
        ? (err.response?.data as { error?: string } | undefined)?.error
        : undefined;
      toastError('Swap failed', backendError ?? 'Could not confirm the swap. Please try again.');
    } finally {
      setSwapping(false);
    }
  };

  const handleReset = () => {
    setSelectedSlot(null);
    setSelectedCandidateId(null);
    setCandidates([]);
    setSwapReason('');
    setStep('select-slot');
    loadSlots(selectedDate);
  };

  const selectedCandidate = candidates.find((c) => c.staff.id === selectedCandidateId);

  const today = format(new Date(), 'yyyy-MM-dd');
  const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd');

  return (
    <div className="max-w-screen-xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Last-Minute Changes</h1>
          <p className="text-gray-500 text-sm mt-0.5">UC-006 — Emergency slot replacement management</p>
        </div>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-6">
        {[
          { id: 'select-slot', label: '1. Select Slot' },
          { id: 'select-candidate', label: '2. Pick Replacement' },
          { id: 'confirm', label: '3. Confirm Swap' },
          { id: 'done', label: '4. Done' },
        ].map((s, idx, arr) => {
          const steps: Step[] = ['select-slot', 'select-candidate', 'confirm', 'done'];
          const currentIdx = steps.indexOf(step);
          const sIdx = steps.indexOf(s.id as Step);
          const isActive = s.id === step;
          const isDone = sIdx < currentIdx;

          return (
            <React.Fragment key={s.id}>
              <div className={`
                flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors
                ${isActive ? 'bg-blue-600 text-white' : isDone ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}
              `}>
                {isDone ? (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <span>{idx + 1}</span>
                )}
                {s.label.replace(/^\d\.\s/, '')}
              </div>
              {idx < arr.length - 1 && (
                <div className={`flex-1 h-px ${sIdx < currentIdx ? 'bg-green-300' : 'bg-gray-200'}`} />
              )}
            </React.Fragment>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-5">
        {/* Left panel */}
        <div className="space-y-4">
          {/* Date selector */}
          <div className="card">
            <div className="flex items-center gap-4 px-5 py-4">
              <div>
                <p className="label mb-1">Select Date</p>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={selectedDate}
                    min={today}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="input text-sm w-44"
                    disabled={step !== 'select-slot'}
                  />
                  <button onClick={() => setSelectedDate(today)} className={`btn-secondary btn-sm text-xs ${selectedDate === today ? 'btn-primary text-white' : ''}`}>
                    Today
                  </button>
                  <button onClick={() => setSelectedDate(tomorrow)} className={`btn-secondary btn-sm text-xs ${selectedDate === tomorrow ? 'btn-primary text-white' : ''}`}>
                    Tomorrow
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Slot selection */}
          {(step === 'select-slot' || step === 'select-candidate') && (
            <div className="card">
              <div className="card-header">
                <h3 className="section-title">
                  {step === 'select-slot' ? 'Published Roster — Select a Slot' : 'Selected Slot'}
                </h3>
                {step === 'select-candidate' && (
                  <button onClick={handleReset} className="btn-secondary btn-sm text-xs">
                    Change Slot
                  </button>
                )}
              </div>
              <div className="p-4">
                {loadingSlots ? (
                  <PageLoader label="Loading roster..." />
                ) : slots.length === 0 ? (
                  <div className="text-center py-8 text-gray-400">
                    <p className="text-sm">No published roster for this date.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {(step === 'select-candidate' ? [selectedSlot!] : slots).filter(Boolean).map((slot) => {
                      const isSelected = selectedSlot?.id === slot.id;
                      const assignments = slot.assignments || [];
                      const hours = slot.shift_start && slot.shift_end
                        ? calcHours(slot.shift_start, slot.shift_end) : null;

                      return (
                        <div
                          key={slot.id}
                          onClick={() => step === 'select-slot' && setSelectedSlot(isSelected ? null : slot)}
                          className={`
                            p-4 rounded-xl border-2 transition-all
                            ${step === 'select-slot' ? 'cursor-pointer' : ''}
                            ${isSelected
                              ? 'border-blue-500 bg-blue-50'
                              : 'border-gray-200 hover:border-gray-300'
                            }
                          `}
                        >
                          <div className="flex items-center gap-3 flex-wrap">
                            <div>
                              <p className="font-bold text-gray-900 text-sm">
                                {slot.ambulance?.call_sign || `AMB-${slot.id.slice(-4)}`}
                              </p>
                              <p className="text-xs text-gray-400">{slot.ambulance?.vehicle_number}</p>
                            </div>
                            <span className={`badge text-xs ${jobTypeBadge[slot.job_type] || 'badge-gray'}`}>
                              {slot.job_type}
                            </span>
                            <span className="text-sm text-gray-700 font-medium">
                              {slot.shift_start?.slice(0, 5)} — {slot.shift_end?.slice(0, 5)}
                              {hours && <span className="text-xs text-gray-400 ml-1">({hours}h)</span>}
                            </span>
                            <span className={`badge capitalize text-xs ${statusBadge[slot.status] || 'badge-gray'}`}>
                              {slot.status}
                            </span>
                          </div>

                          {/* Assigned staff */}
                          <div className="mt-2 flex flex-wrap gap-2">
                            {assignments.length === 0 ? (
                              <span className="text-xs text-amber-600">No staff assigned</span>
                            ) : (
                              assignments.map((a) => (
                                <div key={a.id} className="flex items-center gap-1.5 text-xs bg-white border border-gray-100 px-2 py-1 rounded-lg">
                                  <span className="w-5 h-5 bg-blue-100 rounded-full flex items-center justify-center text-blue-700 font-bold text-[9px]">
                                    {a.staff?.name?.charAt(0)}
                                  </span>
                                  <span className="font-medium">{a.staff?.name}</span>
                                  <span className={`badge capitalize text-[10px] ${
                                    a.status === 'dropped' ? 'badge-red' :
                                    a.status === 'confirmed' ? 'badge-green' : 'badge-blue'
                                  }`}>{a.status}</span>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Drop buttons */}
              {step === 'select-slot' && selectedSlot && (
                <div className="px-4 pb-4 space-y-2">
                  <button
                    onClick={handleFlagDrop}
                    className="btn-danger w-full"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                    </svg>
                    Mark Staff as Unavailable & Find Replacement
                  </button>
                  <button
                    onClick={handleAbsentAllDay}
                    className="btn-secondary w-full text-red-700 border-red-200 hover:bg-red-50"
                    title="UC-006 A3 — batch-drop every shift this staff member has today"
                  >
                    Staff Absent All Day (drop every shift &amp; flag for replacement)
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Done state */}
          {step === 'done' && (
            <div className="card p-8 text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Swap Confirmed!</h3>
              <p className="text-gray-600 mb-2">
                <strong className="text-blue-700">{selectedCandidate?.staff.name}</strong> has been assigned to cover the shift.
              </p>
              <p className="text-sm text-gray-500 mb-6">
                Slot: {selectedSlot?.ambulance?.call_sign} · {selectedSlot?.shift_start?.slice(0, 5)} — {selectedSlot?.shift_end?.slice(0, 5)}
              </p>
              <button onClick={handleReset} className="btn-primary">
                Handle Another Change
              </button>
            </div>
          )}
        </div>

        {/* Right panel: Candidates */}
        {(step === 'select-candidate' || step === 'confirm') && (
          <div className="space-y-4">
            <div className="card">
              <div className="card-header">
                <h3 className="section-title">Replacement Candidates</h3>
                <span className="badge-blue badge">{candidates.length} found</span>
              </div>
              <div className="p-4">
                <CandidateList
                  candidates={candidates}
                  loading={loadingCandidates}
                  selectedId={selectedCandidateId}
                  onSelect={(id) => {
                    setSelectedCandidateId(id);
                    setStep('confirm');
                  }}
                />
              </div>
            </div>

            {/* Confirm swap panel */}
            {step === 'confirm' && selectedCandidateId && selectedCandidate && (
              <div className="card">
                <div className="card-header">
                  <h3 className="section-title text-sm">Confirm Swap</h3>
                </div>
                <div className="p-4 space-y-4">
                  {/* Summary */}
                  <div className="bg-blue-50 rounded-xl p-4">
                    <p className="text-xs font-semibold text-blue-800 uppercase tracking-wide mb-2">Swap Summary</p>
                    <div className="space-y-1.5 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Slot</span>
                        <span className="font-medium">{selectedSlot?.ambulance?.call_sign} · {selectedSlot?.job_type}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Shift</span>
                        <span className="font-medium">{selectedSlot?.shift_start?.slice(0, 5)} — {selectedSlot?.shift_end?.slice(0, 5)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">New Staff</span>
                        <span className="font-medium text-green-700">{selectedCandidate.staff.name}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Score</span>
                        <span className="font-medium">{selectedCandidate.score}/100</span>
                      </div>
                    </div>
                  </div>

                  {/* Swap reason */}
                  <div className="form-group">
                    <label className="label text-xs">Reason for change</label>
                    <textarea
                      value={swapReason}
                      onChange={(e) => setSwapReason(e.target.value)}
                      rows={2}
                      className="input text-sm resize-none"
                      placeholder="Last-minute unavailability, medical emergency, etc."
                    />
                  </div>

                  {/* Warnings */}
                  {selectedCandidate.rest_hours < 8 && (
                    <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                      <span>⚠️</span>
                      <p>This staff member has less than 8 hours of rest ({selectedCandidate.rest_hours}h). Consider checking rest compliance.</p>
                    </div>
                  )}
                  {selectedCandidate.active_flags > 0 && (
                    <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
                      <span>🚨</span>
                      <p>This staff member has {selectedCandidate.active_flags} active flag(s). Review before confirming.</p>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={() => { setStep('select-candidate'); setSelectedCandidateId(null); }}
                      className="btn-secondary flex-1"
                      disabled={swapping}
                    >
                      Back
                    </button>
                    <button
                      onClick={handleConfirmSwap}
                      disabled={swapping}
                      className="btn-success flex-1"
                    >
                      {swapping ? (
                        <span className="flex items-center justify-center gap-2">
                          <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          Confirming...
                        </span>
                      ) : (
                        'Confirm Swap'
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
