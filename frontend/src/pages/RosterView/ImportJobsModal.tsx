import React, { useState } from 'react';
import { jobsApi } from '../../api/jobs';
import { useToast } from '../../components/Toast';

interface ImportJobsModalProps {
  date: string;
  onClose: () => void;
  onImported: (count: number) => void;
}

const SAMPLE = `job_date,pickup_time,service_type,pickup_loc,dropoff_loc
2026-07-13,08:30,MTS,Tan Tock Seng Hospital,Singapore General Hospital
2026-07-13,09:00,EAS,Bedok North Ave 2,Changi General Hospital`;

/**
 * UC-002 job feed — paste the call-centre CSV export and import it as jobs.
 * Generation for the date can then run against real demand.
 */
export const ImportJobsModal: React.FC<ImportJobsModalProps> = ({ date, onClose, onImported }) => {
  const [raw, setRaw] = useState('');
  const [importing, setImporting] = useState(false);
  const { success, error: toastError } = useToast();

  const handleImport = async () => {
    if (!raw.trim()) {
      toastError('Nothing to import', 'Paste the call-centre CSV export first.');
      return;
    }
    setImporting(true);
    try {
      const { imported } = await jobsApi.importRaw(raw);
      success('Jobs imported', `${imported} job(s) added to the feed.`);
      onImported(imported);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Import failed';
      toastError('Import failed', msg);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-gray-900">Import Call-Centre Job List</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              UC-002 input feed — jobs drive how many ambulances are rostered for {date}
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-3">
          <p className="text-sm text-gray-600">
            Paste the CSV export from the call-centre system. Header aliases (date/time/type/from/to)
            and common date/time formats are handled automatically.
          </p>
          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            rows={8}
            className="input font-mono text-xs resize-y"
            placeholder={SAMPLE}
          />
          <div className="flex justify-end gap-3">
            <button onClick={onClose} disabled={importing} className="btn-secondary">Cancel</button>
            <button onClick={handleImport} disabled={importing} className="btn-primary">
              {importing ? 'Importing…' : 'Import Jobs'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
