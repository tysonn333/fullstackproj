import React, { createContext, useContext, useState, useCallback } from 'react';
import type { ConfirmDialogState } from '../types';

// ─── Context ──────────────────────────────────────────────────────────────────

interface ConfirmDialogContextValue {
  confirm: (options: Omit<ConfirmDialogState, 'open'>) => void;
}

const ConfirmDialogContext = createContext<ConfirmDialogContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export const ConfirmDialogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<ConfirmDialogState>({
    open: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });
  const [loading, setLoading] = useState(false);

  const confirm = useCallback((options: Omit<ConfirmDialogState, 'open'>) => {
    setState({ ...options, open: true });
  }, []);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await state.onConfirm();
    } finally {
      setLoading(false);
      setState((prev) => ({ ...prev, open: false }));
    }
  };

  const handleCancel = () => {
    if (!loading) setState((prev) => ({ ...prev, open: false }));
  };

  const variantStyles = {
    danger: {
      icon: '🚨',
      confirmClass: 'btn-danger',
      iconBg: 'bg-red-100',
      iconColor: 'text-red-600',
    },
    warning: {
      icon: '⚠️',
      confirmClass: 'btn-warning',
      iconBg: 'bg-amber-100',
      iconColor: 'text-amber-600',
    },
    info: {
      icon: 'ℹ️',
      confirmClass: 'btn-primary',
      iconBg: 'bg-blue-100',
      iconColor: 'text-blue-600',
    },
  };

  const variant = state.variant ?? 'danger';
  const styles = variantStyles[variant];

  return (
    <ConfirmDialogContext.Provider value={{ confirm }}>
      {children}

      {state.open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-title"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={handleCancel}
          />

          {/* Dialog */}
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 animate-[fadeIn_0.15s_ease-out]">
            {/* Icon + Title */}
            <div className="flex items-start gap-4 mb-4">
              <div className={`flex-shrink-0 w-12 h-12 rounded-full ${styles.iconBg} flex items-center justify-center text-2xl`}>
                {styles.icon}
              </div>
              <div>
                <h3 id="confirm-title" className="text-lg font-semibold text-gray-900">
                  {state.title}
                </h3>
                <p className="text-sm text-gray-600 mt-1">{state.message}</p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 justify-end mt-6">
              <button
                className="btn-secondary"
                onClick={handleCancel}
                disabled={loading}
              >
                {state.cancelLabel || 'Cancel'}
              </button>
              <button
                className={styles.confirmClass}
                onClick={handleConfirm}
                disabled={loading}
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Processing...
                  </span>
                ) : (
                  state.confirmLabel || 'Confirm'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmDialogContext.Provider>
  );
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export const useConfirm = (): ConfirmDialogContextValue => {
  const ctx = useContext(ConfirmDialogContext);
  if (!ctx) throw new Error('useConfirm must be used within ConfirmDialogProvider');
  return ctx;
};
