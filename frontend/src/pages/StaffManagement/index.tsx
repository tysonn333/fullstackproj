import React, { useState, useEffect, useCallback } from 'react';
import { differenceInDays } from 'date-fns';
import { staffApi } from '../../api/staff';
import { StaffForm } from './StaffForm';
import { CertificationsPanel } from './CertificationsPanel';
import { PageLoader } from '../../components/LoadingSpinner';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import type { Staff, StaffFilters, StaffRole, StaffStatus } from '../../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const roleColors: Record<StaffRole, string> = {
  driver: 'badge-blue',
  medic: 'badge-green',
  emt: 'bg-purple-100 text-purple-700',
  paramedic: 'bg-orange-100 text-orange-700',
};

const statusColors: Record<StaffStatus, string> = {
  active: 'badge-green',
  inactive: 'badge-gray',
  on_leave: 'badge-yellow',
};

function hasCertWarning(staff: Staff): boolean {
  if (!staff.certifications) return false;
  return staff.certifications.some((c) => {
    const days = differenceInDays(new Date(c.expires_at), new Date());
    return days <= 30;
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

type DrawerMode = 'create' | 'edit' | 'certs' | null;

export const StaffManagement: React.FC = () => {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<StaffFilters>({ search: '', role: '', status: '', employment_type: '' });
  const [selectedStaff, setSelectedStaff] = useState<Staff | null>(null);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>(null);

  const { success, error: toastError } = useToast();
  const { confirm } = useConfirm();

  const loadStaff = useCallback(async () => {
    setLoading(true);
    try {
      const result = await staffApi.list(filters);
      setStaff(result.data);
      setTotal(result.total);
    } catch {
      toastError('Failed to load staff');
    } finally {
      setLoading(false);
    }
  }, [filters, toastError]);

  useEffect(() => {
    const timer = setTimeout(loadStaff, 300);
    return () => clearTimeout(timer);
  }, [loadStaff]);

  const handleCreate = () => {
    setSelectedStaff(null);
    setDrawerMode('create');
  };

  const handleEdit = (s: Staff) => {
    setSelectedStaff(s);
    setDrawerMode('edit');
  };

  const handleCerts = (s: Staff) => {
    setSelectedStaff(s);
    setDrawerMode('certs');
  };

  const handleSave = (savedStaff: Staff) => {
    setStaff((prev) => {
      const exists = prev.find((s) => s.id === savedStaff.id);
      if (exists) return prev.map((s) => (s.id === savedStaff.id ? savedStaff : s));
      return [savedStaff, ...prev];
    });
    setDrawerMode(null);
  };

  const handleDeactivate = (s: Staff) => {
    confirm({
      title: 'Deactivate Staff Member',
      message: `Are you sure you want to deactivate ${s.name}? They will no longer be schedulable.`,
      confirmLabel: 'Deactivate',
      variant: 'warning',
      onConfirm: async () => {
        const updated = await staffApi.deactivate(s.id);
        setStaff((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
        success('Staff deactivated', `${s.name} has been deactivated.`);
        if (selectedStaff?.id === s.id) setDrawerMode(null);
      },
    });
  };

  const filterChange = (key: keyof StaffFilters) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    setFilters((prev) => ({ ...prev, [key]: e.target.value }));
  };

  const isDrawerOpen = drawerMode !== null;

  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Staff Management</h1>
          <p className="text-gray-500 text-sm mt-0.5">UC-007 — Manage staff profiles and certifications</p>
        </div>
        <button onClick={handleCreate} className="btn-primary">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Staff Member
        </button>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Total Staff', value: total, color: 'text-gray-900' },
          { label: 'Active', value: staff.filter(s => s.status === 'active').length, color: 'text-green-600' },
          { label: 'On Leave', value: staff.filter(s => s.status === 'on_leave').length, color: 'text-amber-600' },
          { label: 'Cert Warnings', value: staff.filter(hasCertWarning).length, color: 'text-red-600' },
        ].map((stat) => (
          <div key={stat.label} className="card px-4 py-3">
            <p className="text-xs text-gray-500">{stat.label}</p>
            <p className={`text-2xl font-bold mt-0.5 ${stat.color}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="card mb-4">
        <div className="flex flex-wrap gap-3 p-4">
          {/* Search */}
          <div className="flex-1 min-w-[200px] relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={filters.search}
              onChange={filterChange('search')}
              className="input pl-9 text-sm"
              placeholder="Search by name, email, phone..."
            />
          </div>

          {/* Role filter */}
          <select
            value={filters.role}
            onChange={filterChange('role')}
            className="input text-sm w-40"
          >
            <option value="">All Roles</option>
            <option value="driver">Driver</option>
            <option value="medic">Medic</option>
            <option value="emt">EMT</option>
            <option value="paramedic">Paramedic</option>
          </select>

          {/* Status filter */}
          <select
            value={filters.status}
            onChange={filterChange('status')}
            className="input text-sm w-40"
          >
            <option value="">All Statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="on_leave">On Leave</option>
          </select>

          {/* Employment filter */}
          <select
            value={filters.employment_type}
            onChange={filterChange('employment_type')}
            className="input text-sm w-44"
          >
            <option value="">All Employment</option>
            <option value="full_time">Full Time</option>
            <option value="part_time">Part Time</option>
          </select>

          {/* Clear */}
          {(filters.search || filters.role || filters.status || filters.employment_type) && (
            <button
              onClick={() => setFilters({ search: '', role: '', status: '', employment_type: '' })}
              className="btn-secondary btn-sm"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Table + Drawer */}
      <div className={`flex gap-4 ${isDrawerOpen ? 'items-start' : ''}`}>
        {/* Table */}
        <div className="flex-1 table-container">
          {loading ? (
            <PageLoader label="Loading staff..." />
          ) : staff.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-xl">
              <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <p className="text-gray-500 font-medium">No staff found</p>
              <p className="text-gray-400 text-sm mt-1">Try adjusting your search or filters</p>
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Staff Member</th>
                  <th>Role</th>
                  <th>Type</th>
                  <th>Contact</th>
                  <th>Postal</th>
                  <th>Status</th>
                  <th>Certs</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((s) => {
                  const certWarn = hasCertWarning(s);
                  return (
                    <tr key={s.id} className={selectedStaff?.id === s.id ? 'bg-blue-50/50' : ''}>
                      {/* Name */}
                      <td>
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-700 font-bold text-xs flex-shrink-0">
                            {s.name.charAt(0)}
                          </div>
                          <div>
                            <p className="font-medium text-gray-900">{s.name}</p>
                            <p className="text-xs text-gray-400">{s.email}</p>
                          </div>
                        </div>
                      </td>

                      {/* Role */}
                      <td>
                        <span className={`badge capitalize ${roleColors[s.role]}`}>{s.role}</span>
                      </td>

                      {/* Employment type */}
                      <td>
                        <span className="badge-gray badge capitalize">{s.employment_type.replace('_', ' ')}</span>
                      </td>

                      {/* Contact */}
                      <td className="text-gray-600 text-xs">{s.phone}</td>

                      {/* Postal */}
                      <td className="font-mono text-xs text-gray-600">{s.home_postal}</td>

                      {/* Status */}
                      <td>
                        <span className={`badge capitalize ${statusColors[s.status]}`}>
                          {s.status.replace('_', ' ')}
                        </span>
                      </td>

                      {/* Certs warning */}
                      <td>
                        {certWarn ? (
                          <span className="badge-red badge text-xs flex items-center gap-1">
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                            </svg>
                            Expiring
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">
                            {s.certifications?.length || 0} certs
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td>
                        <div className="flex items-center gap-1 justify-end">
                          <button
                            onClick={() => handleCerts(s)}
                            className="btn-secondary btn-sm text-xs"
                            title="Manage certifications"
                          >
                            Certs
                          </button>
                          <button
                            onClick={() => handleEdit(s)}
                            className="btn-secondary btn-sm"
                            title="Edit staff member"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          {s.status === 'active' && (
                            <button
                              onClick={() => handleDeactivate(s)}
                              className="btn-secondary btn-sm text-red-600 hover:bg-red-50 hover:border-red-200"
                              title="Deactivate"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                  d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Slide-in Drawer */}
        {isDrawerOpen && (
          <div className="w-96 flex-shrink-0">
            <div className="card">
              <div className="card-header">
                <h3 className="section-title">
                  {drawerMode === 'create' && 'Add Staff Member'}
                  {drawerMode === 'edit' && `Edit: ${selectedStaff?.name}`}
                  {drawerMode === 'certs' && `Certifications: ${selectedStaff?.name}`}
                </h3>
                <button
                  onClick={() => setDrawerMode(null)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="card-body">
                {(drawerMode === 'create' || drawerMode === 'edit') && (
                  <StaffForm
                    staff={drawerMode === 'edit' ? selectedStaff : null}
                    onSave={handleSave}
                    onCancel={() => setDrawerMode(null)}
                  />
                )}
                {drawerMode === 'certs' && selectedStaff && (
                  <CertificationsPanel
                    staffId={selectedStaff.id}
                    staffName={selectedStaff.name}
                  />
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
