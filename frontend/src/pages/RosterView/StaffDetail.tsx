import React from 'react';
import type { Staff } from '../../types';

interface StaffDetailProps {
  staff: Staff;
  onClose: () => void;
}

export const StaffDetail: React.FC<StaffDetailProps> = ({ staff, onClose }) => {
  const roleColor: Record<string, string> = {
    driver: 'bg-blue-100 text-blue-700',
    medic: 'bg-green-100 text-green-700',
    emt: 'bg-purple-100 text-purple-700',
    paramedic: 'bg-red-100 text-red-700',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm">
        <div className="px-6 py-5 flex items-center justify-between">
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

        <div className="px-6 pb-5 space-y-3">
          <div>
            <p className="text-xs text-gray-500 mb-1">Phone</p>
            <p className="text-sm font-medium text-gray-800">{staff.phone || '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">Email</p>
            <p className="text-sm font-medium text-gray-800">{staff.email || '—'}</p>
          </div>
        </div>
      </div>
    </div>
  );
};
