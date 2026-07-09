import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import apiClient from '../api/client';
import type { Session, User } from '../lib/supabase';

export type UserRole = 'admin' | 'employee';

interface AuthState {
  session: Session | null;
  user: User | null;
  role: UserRole | null;
  staffId: number | null;
  loading: boolean;
  error: string | null;
}

interface UseAuthReturn extends AuthState {
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  isAuthenticated: boolean;
  isAdmin: boolean;
}

export function useAuth(): UseAuthReturn {
  const [state, setState] = useState<AuthState>({
    session: null,
    user: null,
    role: null,
    staffId: null,
    loading: true,
    error: null,
  });

  // Fetch role + linked staff id from the backend for a given session.
  const loadProfile = useCallback(async (session: Session | null) => {
    if (!session) {
      setState((prev) => ({ ...prev, role: null, staffId: null }));
      return;
    }
    try {
      const { data } = await apiClient.get<{ role: UserRole; staff_id: number | null }>(
        '/api/v1/auth/me'
      );
      setState((prev) => ({ ...prev, role: data.role, staffId: data.staff_id }));
    } catch {
      // If the profile lookup fails, fall back to the least-privileged role so
      // the UI never assumes admin rights it can't actually use.
      setState((prev) => ({ ...prev, role: 'employee', staffId: null }));
    }
  }, []);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setState((prev) => ({
        ...prev,
        session,
        user: session?.user ?? null,
        loading: false,
      }));
      loadProfile(session);
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setState((prev) => ({
        ...prev,
        session,
        user: session?.user ?? null,
        loading: false,
      }));
      loadProfile(session);
    });

    return () => subscription.unsubscribe();
  }, [loadProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setState((prev) => ({ ...prev, loading: false, error: error.message }));
      throw error;
    }
    setState((prev) => ({ ...prev, loading: false }));
  }, []);

  const signOut = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true }));
    await supabase.auth.signOut();
    setState({ session: null, user: null, role: null, staffId: null, loading: false, error: null });
  }, []);

  return {
    ...state,
    signIn,
    signOut,
    isAuthenticated: !!state.session,
    isAdmin: state.role === 'admin',
  };
}
