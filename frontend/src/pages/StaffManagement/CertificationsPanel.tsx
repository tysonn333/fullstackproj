import React, { useState, useEffect, useCallback } from 'react';
import { format, differenceInDays } from 'date-fns';
import { staffApi } from '../../api/staff';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import type { Certification } from '../../types';

interface CertificationsPanelProps {
  staffId: string;
  staffName: string;
}

interface CertForm {
  cert_name: string;
  cert_number: string;
  issued_at: string;
  expires_at: string;
}

const INITIAL_FORM: CertForm = {
  cert_name: '',
  cert_number: '',
  issued_at: '',
  expires_at: '',
};

const getCertStatus = (expiresAt: string) => {
  const expiry = new Date(expiresAt);
  // Certs can have no expiry date recorded — don't crash on Invalid Date
  if (!expiresAt || isNaN(expiry.getTime())) {
    return { label: 'No expiry', class: 'badge-gray', days: Infinity };
  }
  const days = differenceInDays(expiry, new Date());
  if (days < 0) return { label: 'Expired', class: 'badge-red', days };
  if (days <= 30) return { label: `${days}d left`, class: 'badge-red', days };
  if (days <= 90) return { label: `${days}d left`, class: 'badge-yellow', days };
  return { label: format(expiry, 'dd MMM yyyy'), class: 'badge-green', days };
};

export const CertificationsPanel: React.FC<CertificationsPanelProps> = ({ staffId, staffName }) => {
  const [certs, setCerts] = useState<Certification[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CertForm>(INITIAL_FORM);
  const [formErrors, setFormErrors] = useState<Partial<CertForm>>({});
  const [submitting, setSubmitting] = useState(false);

  const { success, error: toastError } = useToast();
  const { confirm } = useConfirm();

  const loadCerts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await staffApi.getCertifications(staffId);
      setCerts(data);
    } catch {
      toastError('Failed to load certifications');
    } finally {
      setLoading(false);
    }
  }, [staffId, toastError]);

  useEffect(() => {
    loadCerts();
  }, [loadCerts]);

  const validateForm = (): boolean => {
    const errors: Partial<CertForm> = {};
    if (!form.cert_name.trim()) errors.cert_name = 'Certificate name is required';
    if (!form.issued_at) errors.issued_at = 'Issue date is required';
    if (!form.expires_at) errors.expires_at = 'Expiry date is required';
    if (form.issued_at && form.expires_at && form.expires_at <= form.issued_at) {
      errors.expires_at = 'Expiry must be after issue date';
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleAddCert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;
    setSubmitting(true);
    try {
      const newCert = await staffApi.addCertification(staffId, {
        cert_name: form.cert_name,
        cert_number: form.cert_number || undefined,
        issued_at: form.issued_at,
        expires_at: form.expires_at,
      });
      setCerts((prev) => [...prev, newCert]);
      setForm(INITIAL_FORM);
      setShowForm(false);
      success('Certification added', `${form.cert_name} has been added for ${staffName}.`);
    } catch {
      toastError('Failed to add certification');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemove = (cert: Certification) => {
    confirm({
      title: 'Remove Certification',
      message: `Remove "${cert.cert_name}" from ${staffName}? This cannot be undone.`,
      confirmLabel: 'Remove',
      variant: 'danger',
      onConfirm: async () => {
        await staffApi.removeCertification(staffId, cert.id);
        setCerts((prev) => prev.filter((c) => c.id !== cert.id));
        success('Certification removed');
      },
    });
  };

  const handleChange = (field: keyof CertForm) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
    if (formErrors[field]) setFormErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  if (loading) return <div className="flex justify-center py-4"><LoadingSpinner size="sm" /></div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-semibold text-gray-900 text-sm">Certifications ({certs.length})</h4>
        <button
          onClick={() => { setShowForm(!showForm); setForm(INITIAL_FORM); setFormErrors({}); }}
          className="btn-secondary btn-sm"
        >
          {showForm ? (
            <>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Cancel
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Cert
            </>
          )}
        </button>
      </div>

      {/* Add form */}
      {showForm && (
        <form onSubmit={handleAddCert} className="mb-4 p-4 bg-gray-50 rounded-xl border border-gray-200 space-y-3">
          <h5 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">New Certification</h5>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 form-group">
              <label className="label text-xs">Certificate Name *</label>
              <input
                type="text"
                value={form.cert_name}
                onChange={handleChange('cert_name')}
                className={`input text-sm ${formErrors.cert_name ? 'input-error' : ''}`}
                placeholder="e.g. Basic Cardiac Life Support"
              />
              {formErrors.cert_name && <p className="text-xs text-red-600 mt-0.5">{formErrors.cert_name}</p>}
            </div>
            <div className="form-group">
              <label className="label text-xs">Certificate No.</label>
              <input
                type="text"
                value={form.cert_number}
                onChange={handleChange('cert_number')}
                className="input text-sm"
                placeholder="Optional"
              />
            </div>
            <div className="form-group">
              <label className="label text-xs">Issue Date *</label>
              <input
                type="date"
                value={form.issued_at}
                onChange={handleChange('issued_at')}
                className={`input text-sm ${formErrors.issued_at ? 'input-error' : ''}`}
              />
              {formErrors.issued_at && <p className="text-xs text-red-600 mt-0.5">{formErrors.issued_at}</p>}
            </div>
            <div className="form-group col-span-2">
              <label className="label text-xs">Expiry Date *</label>
              <input
                type="date"
                value={form.expires_at}
                onChange={handleChange('expires_at')}
                className={`input text-sm ${formErrors.expires_at ? 'input-error' : ''}`}
              />
              {formErrors.expires_at && <p className="text-xs text-red-600 mt-0.5">{formErrors.expires_at}</p>}
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={submitting} className="btn-primary btn-sm">
              {submitting ? <LoadingSpinner size="sm" color="border-white" /> : 'Add Certification'}
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); setFormErrors({}); }}
              className="btn-secondary btn-sm"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Certs list */}
      {certs.length === 0 ? (
        <div className="text-center py-6 text-gray-400 text-sm">
          <svg className="w-8 h-8 mx-auto mb-2 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          No certifications on file
        </div>
      ) : (
        <div className="space-y-2">
          {certs.map((cert) => {
            const status = getCertStatus(cert.expires_at);
            return (
              <div key={cert.id} className="flex items-start justify-between p-3 bg-white rounded-lg border border-gray-100 hover:border-gray-200 transition-colors group">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-gray-800">{cert.cert_name}</p>
                    <span className={`badge ${status.class}`}>{status.label}</span>
                    {status.days < 0 && (
                      <span className="badge-red badge text-xs animate-pulse">!</span>
                    )}
                  </div>
                  {cert.cert_number && (
                    <p className="text-xs text-gray-500 mt-0.5">#{cert.cert_number}</p>
                  )}
                  {cert.issued_at && !isNaN(new Date(cert.issued_at).getTime()) && (
                    <p className="text-xs text-gray-400 mt-0.5">
                      Issued: {format(new Date(cert.issued_at), 'dd MMM yyyy')}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => handleRemove(cert)}
                  className="ml-2 p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                  title="Remove certification"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
