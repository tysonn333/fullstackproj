import React, { useState, useEffect } from 'react';
import { staffApi } from '../../api/staff';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { useToast } from '../../components/Toast';
import type { Staff, StaffRole, EmploymentType, StaffStatus } from '../../types';

interface StaffFormProps {
  staff?: Staff | null;
  onSave: (staff: Staff) => void;
  onCancel: () => void;
}

interface FormData {
  name: string;
  phone: string;
  email: string;
  role: StaffRole | '';
  employment_type: EmploymentType | '';
  home_postal: string;
  status: StaffStatus;
}

interface FormErrors {
  name?: string;
  phone?: string;
  email?: string;
  role?: string;
  employment_type?: string;
  home_postal?: string;
}

const INITIAL_FORM: FormData = {
  name: '',
  phone: '',
  email: '',
  role: '',
  employment_type: '',
  home_postal: '',
  status: 'active',
};

const ROLE_OPTIONS: { value: StaffRole; label: string }[] = [
  { value: 'driver', label: 'Driver' },
  { value: 'medic', label: 'Medic' },
  { value: 'emt', label: 'EMT' },
  { value: 'paramedic', label: 'Paramedic' },
];

const EMPLOYMENT_OPTIONS: { value: EmploymentType; label: string }[] = [
  { value: 'full_time', label: 'Full Time' },
  { value: 'part_time', label: 'Part Time' },
];

const STATUS_OPTIONS: { value: StaffStatus; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'on_leave', label: 'On Leave' },
];

export const StaffForm: React.FC<StaffFormProps> = ({ staff, onSave, onCancel }) => {
  const [form, setForm] = useState<FormData>(INITIAL_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [loading, setLoading] = useState(false);
  const { success, error: toastError } = useToast();

  const isEditing = !!staff;

  // UC-007 steps 5–6: soft scheduling signals (early/late preference + buddy).
  const [prefersEarly, setPrefersEarly] = useState(false);
  const [prefersLate, setPrefersLate] = useState(false);
  const [buddyId, setBuddyId] = useState<string>('');
  const [buddyOptions, setBuddyOptions] = useState<Staff[]>([]);

  useEffect(() => {
    if (staff) {
      setForm({
        name: staff.name,
        phone: staff.phone,
        email: staff.email,
        role: staff.role,
        employment_type: staff.employment_type,
        home_postal: staff.home_postal,
        status: staff.status,
      });
    } else {
      setForm(INITIAL_FORM);
    }
    setErrors({});
  }, [staff]);

  // Load current preferences + buddy candidates when editing.
  useEffect(() => {
    if (!staff) {
      setPrefersEarly(false);
      setPrefersLate(false);
      setBuddyId('');
      return;
    }
    staffApi
      .getPreferences(staff.id)
      .then((p) => {
        setPrefersEarly(p.prefers_early);
        setPrefersLate(p.prefers_late);
        setBuddyId(p.buddy_staff_id ?? '');
      })
      .catch(() => { /* preferences are optional */ });
    staffApi
      .list({ status: 'active' })
      .then((r) => setBuddyOptions(r.data.filter((s) => s.id !== staff.id)))
      .catch(() => setBuddyOptions([]));
  }, [staff]);

  const validate = (): boolean => {
    const newErrors: FormErrors = {};
    if (!form.name.trim()) newErrors.name = 'Name is required';
    if (!form.phone.trim()) newErrors.phone = 'Phone is required';
    else if (!/^\+?[\d\s\-()]{8,15}$/.test(form.phone.trim())) newErrors.phone = 'Enter a valid phone number';
    if (!form.email.trim()) newErrors.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) newErrors.email = 'Enter a valid email address';
    if (!form.role) newErrors.role = 'Role is required';
    if (!form.employment_type) newErrors.employment_type = 'Employment type is required';
    if (!form.home_postal.trim()) newErrors.home_postal = 'Home postal code is required';
    else if (!/^\d{6}$/.test(form.home_postal.trim())) newErrors.home_postal = 'Enter a valid 6-digit postal code';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    try {
      const payload = {
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim().toLowerCase(),
        role: form.role as StaffRole,
        employment_type: form.employment_type as EmploymentType,
        home_postal: form.home_postal.trim(),
        status: form.status,
      };

      let savedStaff: Staff;
      if (isEditing && staff) {
        savedStaff = await staffApi.update(staff.id, payload);
        success('Staff updated', `${savedStaff.name}'s profile has been updated.`);
      } else {
        savedStaff = await staffApi.create(payload);
        success('Staff created', `${savedStaff.name} has been added to the system.`);
      }
      // Persist soft scheduling signals (best-effort; never blocks the save).
      try {
        await staffApi.updatePreferences(savedStaff.id, {
          prefers_early: prefersEarly,
          prefers_late: prefersLate,
          buddy_staff_id: buddyId || null,
        });
      } catch {
        toastError('Preferences not saved', 'Profile saved, but shift preferences could not be stored.');
      }
      onSave(savedStaff);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save staff member';
      toastError('Save failed', msg);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (field: keyof FormData) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
    if (errors[field as keyof FormErrors]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Full Name */}
        <div className="form-group col-span-2">
          <label className="label">Full Name *</label>
          <input
            type="text"
            value={form.name}
            onChange={handleChange('name')}
            className={`input ${errors.name ? 'input-error' : ''}`}
            placeholder="e.g. John Tan Wei Ming"
          />
          {errors.name && <p className="text-xs text-red-600 mt-1">{errors.name}</p>}
        </div>

        {/* Email */}
        <div className="form-group">
          <label className="label">Email Address *</label>
          <input
            type="email"
            value={form.email}
            onChange={handleChange('email')}
            className={`input ${errors.email ? 'input-error' : ''}`}
            placeholder="john@efar.sg"
          />
          {errors.email && <p className="text-xs text-red-600 mt-1">{errors.email}</p>}
        </div>

        {/* Phone */}
        <div className="form-group">
          <label className="label">Phone Number *</label>
          <input
            type="tel"
            value={form.phone}
            onChange={handleChange('phone')}
            className={`input ${errors.phone ? 'input-error' : ''}`}
            placeholder="+65 9123 4567"
          />
          {errors.phone && <p className="text-xs text-red-600 mt-1">{errors.phone}</p>}
        </div>

        {/* Role */}
        <div className="form-group">
          <label className="label">Role *</label>
          <select
            value={form.role}
            onChange={handleChange('role')}
            className={`input ${errors.role ? 'input-error' : ''}`}
          >
            <option value="">Select role...</option>
            {ROLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          {errors.role && <p className="text-xs text-red-600 mt-1">{errors.role}</p>}
        </div>

        {/* Employment Type */}
        <div className="form-group">
          <label className="label">Employment Type *</label>
          <select
            value={form.employment_type}
            onChange={handleChange('employment_type')}
            className={`input ${errors.employment_type ? 'input-error' : ''}`}
          >
            <option value="">Select type...</option>
            {EMPLOYMENT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          {errors.employment_type && <p className="text-xs text-red-600 mt-1">{errors.employment_type}</p>}
        </div>

        {/* Home Postal */}
        <div className="form-group">
          <label className="label">Home Postal Code *</label>
          <input
            type="text"
            value={form.home_postal}
            onChange={handleChange('home_postal')}
            className={`input ${errors.home_postal ? 'input-error' : ''}`}
            placeholder="123456"
            maxLength={6}
          />
          {errors.home_postal && <p className="text-xs text-red-600 mt-1">{errors.home_postal}</p>}
        </div>

        {/* Status (only show when editing) */}
        {isEditing && (
          <div className="form-group">
            <label className="label">Status</label>
            <select
              value={form.status}
              onChange={handleChange('status')}
              className="input"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Scheduling preferences (UC-005 soft signals) */}
      <div className="pt-3 border-t border-gray-100">
        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
          Scheduling Preferences <span className="normal-case font-normal text-gray-400">(soft signals for the ranking engine)</span>
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={prefersEarly}
                onChange={(e) => setPrefersEarly(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              Early riser (prefers shifts starting before 12:00)
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={prefersLate}
                onChange={(e) => setPrefersLate(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              Late shift preference (prefers shifts from 12:00 onwards)
            </label>
          </div>
          <div className="form-group">
            <label className="label">Preferred Working Partner (buddy)</label>
            <select
              value={buddyId}
              onChange={(e) => setBuddyId(e.target.value)}
              className="input"
              disabled={!isEditing && buddyOptions.length === 0}
            >
              <option value="">No buddy preference</option>
              {buddyOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {s.role}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1">
              Honoured only when the buddy ranks in the top 3 of the opposite crew pool.
            </p>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3 justify-end pt-2 border-t border-gray-100">
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="btn-secondary"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={loading}
          className="btn-primary"
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <LoadingSpinner size="sm" color="border-white" />
              {isEditing ? 'Updating...' : 'Creating...'}
            </span>
          ) : (
            isEditing ? 'Save Changes' : 'Create Staff'
          )}
        </button>
      </div>
    </form>
  );
};
