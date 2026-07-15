import React, { useState, useEffect } from 'react';
import { staffApi } from '../../api/staff';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { useToast } from '../../components/Toast';
import type { Staff, StaffRole, EmploymentType, StaffStatus } from '../../types';

interface StaffFormProps {
  staff?: Staff | null;
  onSave: (staff: Staff, credentials?: { email: string; password: string }) => void;
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
  create_account: boolean;
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
  create_account: false,
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
  const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null);
  const { success, error: toastError } = useToast();

  const isEditing = !!staff;

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
        create_account: false,
      });
    } else {
      setForm(INITIAL_FORM);
    }
    setErrors({});
    setCredentials(null);
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
    setCredentials(null);
    try {
      const payload = {
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim().toLowerCase(),
        role: form.role as StaffRole,
        employment_type: form.employment_type as EmploymentType,
        home_postal: form.home_postal.trim(),
        status: form.status,
        create_account: !isEditing && form.create_account,
      };

      let savedStaff: Staff;
      let creds: { email: string; password: string } | undefined;

      if (isEditing && staff) {
        savedStaff = await staffApi.update(staff.id, payload);
        success('Staff updated', `${savedStaff.name}'s profile has been updated.`);
      } else {
        const result = await staffApi.create(payload);
        savedStaff = result.staff;
        creds = result.account;
        setCredentials(creds ?? null);
        if (creds) {
          success('Account created', `Login credentials have been generated for ${savedStaff.name}.`);
        } else {
          success('Staff created', `${savedStaff.name} has been added to the system.`);
        }
      }
      onSave(savedStaff, creds);
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
    const value = e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value;
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field as keyof FormErrors]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      {credentials && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm">
          <p className="font-semibold text-green-800 mb-1">Account Created</p>
          <p className="text-green-700">Email: <span className="font-mono">{credentials.email}</span></p>
          <p className="text-green-700">Password: <span className="font-mono">{credentials.password}</span></p>
          <p className="text-xs text-green-600 mt-1">Please share these credentials with the staff member.</p>
        </div>
      )}

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

      {/* Create account checkbox (only for new staff) */}
      {!isEditing && (
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="create_account"
            checked={form.create_account}
            onChange={handleChange('create_account')}
            className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
          />
          <label htmlFor="create_account" className="text-sm text-gray-700">
            Create login account (password will be auto-generated)
          </label>
        </div>
      )}

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
