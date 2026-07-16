import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ToastProvider } from './components/Toast';
import { ConfirmDialogProvider } from './components/ConfirmDialog';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Navbar } from './components/Navbar';
import { Login } from './pages/Login';
import { RosterView } from './pages/RosterView';
import { StaffManagement } from './pages/StaffManagement';
import { AvailabilityLeave } from './pages/AvailabilityLeave';
import { WeeklyAvailability } from './pages/WeeklyAvailability';
import { ExceptionsPanel } from './pages/ExceptionsPanel';
import { LastMinuteChange } from './pages/LastMinuteChange';

// ─── Error Boundary ───────────────────────────────────────────────────────────

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
          <div className="card max-w-md w-full p-8 text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Something went wrong</h2>
            <p className="text-gray-500 text-sm mb-2">
              {this.state.error?.message || 'An unexpected error occurred.'}
            </p>
            <p className="text-gray-400 text-xs mb-6">
              Please refresh the page or contact support if the issue persists.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="btn-primary"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// ─── Layout Wrapper ───────────────────────────────────────────────────────────

const AppLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="min-h-screen bg-gray-50">
    <Navbar />
    <main className="pb-8">
      {children}
    </main>
  </div>
);

// ─── App ──────────────────────────────────────────────────────────────────────

const App: React.FC = () => {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <ToastProvider>
          <ConfirmDialogProvider>
            <Routes>
              {/* Public route */}
              <Route path="/login" element={<Login />} />

              {/* Protected routes */}
              <Route
                path="/roster"
                element={
                  <ProtectedRoute>
                    <AppLayout>
                      <RosterView />
                    </AppLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/staff"
                element={
                  <ProtectedRoute requireAdmin>
                    <AppLayout>
                      <StaffManagement />
                    </AppLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/availability"
                element={
                  <ProtectedRoute>
                    <AppLayout>
                      <AvailabilityLeave />
                    </AppLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/availability/weekly"
                element={
                  <ProtectedRoute>
                    <AppLayout>
                      <WeeklyAvailability />
                    </AppLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/exceptions"
                element={
                  <ProtectedRoute requireAdmin>
                    <AppLayout>
                      <ExceptionsPanel />
                    </AppLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/last-minute"
                element={
                  <ProtectedRoute requireAdmin>
                    <AppLayout>
                      <LastMinuteChange />
                    </AppLayout>
                  </ProtectedRoute>
                }
              />

              {/* Default redirect */}
              <Route path="/" element={<Navigate to="/roster" replace />} />
              <Route path="*" element={<Navigate to="/roster" replace />} />
            </Routes>
          </ConfirmDialogProvider>
        </ToastProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
};

export default App;
