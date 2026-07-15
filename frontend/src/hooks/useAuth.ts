import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import apiClient from '../api/client';
import type { Session, User } from '../lib/supabase';

export type ProfileRole = 'admin' | 'ops_director' | 'staff';

interface StaffRecord {
  staff_id: number;
  full_name: string;
  role: string;
  email: string | null;
  phone: string | null;
  employment_type: string;
  home_postal: string | null;
  status: string;
}

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: { name: string; role: ProfileRole; staff: StaffRecord | null } | null;
  loading: boolean;
  error: string | null;
}

interface UseAuthReturn extends AuthState {
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  isAuthenticated: boolean;
}

export function useAuth(): UseAuthReturn {
  const [state, setState] = useState<AuthState>({
    session: null,
    user: null,
    profile: null,
    loading: true,
    error: null,
  });

  const fetchProfile = useCallback(async () => {
    try {
      const { data } = await apiClient.get<{ id: string; email: string; name: string; role: ProfileRole; staff: StaffRecord | null }>(
        '/api/v1/auth/profile'
      );
      return { name: data.name, role: data.role, staff: data.staff };
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let authEventFired = false;

    // Get initial session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (cancelled || authEventFired) return;
      let profile = null;
      if (session) {
        profile = await fetchProfile();
      }
      setState({
        session,
        user: session?.user ?? null,
        profile,
        loading: false,
        error: null,
      });
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (cancelled) return;
      authEventFired = true;
      let profile = null;
      if (session) {
        profile = await fetchProfile();
      }
      setState({
        session,
        user: session?.user ?? null,
        profile,
        loading: false,
        error: null,
      });
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setState((prev) => ({ ...prev, loading: false, error: error.message }));
      throw error;
    }
    // Profile will be fetched by the onAuthStateChange listener
  }, []);

  const signOut = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true }));
    await supabase.auth.signOut();
    setState({ session: null, user: null, profile: null, loading: false, error: null });
  }, []);

  return {
    ...state,
    signIn,
    signOut,
    isAuthenticated: !!state.session,
  };
}
