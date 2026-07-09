import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { LoadingSpinner } from './LoadingSpinner';

interface ProtectedRouteProps {
  children: React.ReactNode;
  /** When true, only admins may access the route; employees are redirected. */
  requireAdmin?: boolean;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, requireAdmin }) => {
  const { isAuthenticated, isAdmin, role, loading } = useAuth();
  const location = useLocation();

  // Wait for the session (and, for admin routes, the role) to resolve.
  if (loading || (requireAdmin && role === null)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" label="Verifying session..." />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (requireAdmin && !isAdmin) {
    // Signed in but not permitted — send them to a page they can use.
    return <Navigate to="/roster" replace />;
  }

  return <>{children}</>;
};
