import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { api } from '../api/client.js';

const AuthContext = createContext(null);
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('efar_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [loading, setLoading] = useState(Boolean(supabase));

  useEffect(() => {
    if (!supabase) return undefined;

    supabase.auth.getSession().then(({ data }) => {
      const session = data.session;
      if (session) {
        localStorage.setItem('efar_token', session.access_token);
        const profile = {
          id: session.user.id,
          email: session.user.email,
          name: session.user.user_metadata?.name || session.user.email,
          role: session.user.user_metadata?.role || 'admin',
        };
        localStorage.setItem('efar_user', JSON.stringify(profile));
        setUser(profile);
      }
      setLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        localStorage.setItem('efar_token', session.access_token);
      } else {
        localStorage.removeItem('efar_token');
        localStorage.removeItem('efar_user');
        setUser(null);
      }
    });

    return () => data.subscription.unsubscribe();
  }, []);

  const login = async (email, password) => {
    if (supabase) {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      const profile = {
        id: data.user.id,
        email: data.user.email,
        name: data.user.user_metadata?.name || data.user.email,
        role: data.user.user_metadata?.role || 'admin',
      };
      localStorage.setItem('efar_token', data.session.access_token);
      localStorage.setItem('efar_user', JSON.stringify(profile));
      setUser(profile);
      return;
    }

    const result = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    localStorage.setItem('efar_token', result.token);
    localStorage.setItem('efar_user', JSON.stringify(result.user));
    setUser(result.user);
  };

  const logout = async () => {
    if (supabase) await supabase.auth.signOut();
    localStorage.removeItem('efar_token');
    localStorage.removeItem('efar_user');
    setUser(null);
  };

  const value = useMemo(() => ({ user, loading, login, logout }), [user, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
