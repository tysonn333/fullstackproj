import React, { useState } from 'react';
import { availabilityApi } from '../../api/availability';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { useToast } from '../../components/Toast';
import type { LeaveRequest, LeaveType, Staff } from '../../types';

interface LeaveRequestFormProps {
  staffList: Staff[];
  onCreated: (req: LeaveRequest) => void;
  onCancel?: () => void;
}

interface FormData {
  staff_id: string;
  leave_type: LeaveType | '';
  start_date: string;
  end_date: string;
  reason: string;
}

const INITIAL_FORM: FormData = {
  staff_id: '',
  leave_type: '',
  start_date: '',
  end_date: '',
  reason: '',
};

const LEAVE_TYPE_OPTIONS: { value: LeaveType; label: string; desc: string }[] = [
  { value: 'full_day', label: 'Full Day', desc: 'Full day absence' },
  { value: 'half_am', label: 'Half Day (AM)', desc: 'Morning shift off' },
  { value: 'half_pm', label: 'Half Day (PM)', desc: 'Afternoon shift off' },
];

export const LeaveRequestForm: React.FC<LeaveRequestFormProps> = ({
  staffList,
  onCreated,
  onCancel,
}) => {
  const [form, setForm] = useState<FormData>(INITIAL_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({});
  const [loading, setLoading] = useState(false);
  const { success, error: toastError } = useToast();

  const validate = (): boolean => {
    const errs: Partial<Record<keyof FormData, string>> = {};
    if (!form.staff_id) errs.staff_id = 'Select a staff member';
    if (!form.leave_type) errs.leave_type = 'Select leave type';
    if (!form.start_date) errs.start_date = 'Start date is required';
    if (!form.end_date) errs.end_date = 'End date is required';
    if (form.start_date && form.end_date && form.end_date < form.start_date) {
      errs.end_date = 'End date must be on or after start date';
    }
    if (!form.reason.trim()) errs.reason = 'Reason is required';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    try {
      const req = await availabilityApi.createLeaveRequest({
        staff_id: form.staff_id,
        leave_type: form.leave_type as LeaveType,
        start_date: form.start_date,
        end_date: form.end_date,
        reason: form.reason.trim(),
      });
      success('Leave request submitted', 'The request is pending admin approval.');
      onCreated(req);
      setForm(INITIAL_FORM);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to submit leave request';
      toastError('Submission failed', msg);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (field: keyof FormData) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {/* Staff Member */}
      <div className="form-group">
        <label className="label">Staff Member *</label>
        <select
          value={form.staff_id}
          onChange={handleChange('staff_id')}
          className={`input ${errors.staff_id ? 'input-error' : ''}`}
        >
          <option value="">Select staff member...</option>
          {staffList.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} — {s.role}
            </option>
          ))}
        </select>
        {errors.staff_id && <p className="text-xs text-red-600 mt-1">{errors.staff_id}</p>}
      </div>

      {/* Leave Type */}
      <div className="form-group">
        <label className="label">Leave Type *</label>
        <div className="grid grid-cols-3 gap-2">
          {LEAVE_TYPE_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`
                flex flex-col items-center text-center p-3 rounded-xl border-2 cursor-pointer transition-all
                ${form.leave_type === opt.value
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-200 hover:border-gray-300 text-gray-600'
                }
              `}
            >
              <input
                type="radio"
                name="leave_type"
                value={opt.value}
                checked={form.leave_type === opt.value}
                onChange={handleChange('leave_type')}
                className="sr-only"
              />
              <span className="text-sm font-semibold">{opt.label}</span>
              <span className="text-xs mt-0.5 opacity-70">{opt.desc}</span>
            </label>
          ))}
        </div>
        {errors.leave_type && <p className="text-xs text-red-600 mt-1">{errors.leave_type}</p>}
      </div>

      {/* Date range */}
      <div className="grid grid-cols-2 gap-3">
        <div className="form-group">
          <label className="label">Start Date *</label>
          <input
            type="date"
            value={form.start_date}
            onChange={handleChange('start_date')}
            min={new Date().toISOString().split('T')[0]}
            className={`input ${errors.start_date ? 'input-error' : ''}`}
          />
          {errors.start_date && <p className="text-xs text-red-600 mt-1">{errors.start_date}</p>}
        </div>
        <div className="form-group">
          <label className="label">End Date *</label>
          <input
            type="date"
            value={form.end_date}
            onChange={handleChange('end_date')}
            min={form.start_date || new Date().toISOString().split('T')[0]}
            className={`input ${errors.end_date ? 'input-error' : ''}`}
          />
          {errors.end_date && <p className="text-xs text-red-600 mt-1">{errors.end_date}</p>}
        </div>
      </div>

      {/* Reason */}
      <div className="form-group">
        <label className="label">Reason *</label>
        <textarea
          value={form.reason}
          onChange={handleChange('reason')}
          rows={3}
          className={`input resize-none ${errors.reason ? 'input-error' : ''}`}
          placeholder="Briefly describe the reason for this leave request..."
        />
        {errors.reason && <p className="text-xs text-red-600 mt-1">{errors.reason}</p>}
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-1">
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={loading} className="btn-secondary flex-1">
            Cancel
          </button>
        )}
        <button type="submit" disabled={loading} className="btn-primary flex-1">
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <LoadingSpinner size="sm" color="border-white" />
              Submitting...
            </span>
          ) : (
            'Submit Leave Request'
          )}
        </button>
      </div>
    </form>
  );
};
