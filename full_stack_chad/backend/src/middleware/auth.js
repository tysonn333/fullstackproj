import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

export function authMiddleware(config) {
  const supabase = config.supabaseConfigured
    ? createClient(config.supabaseUrl, config.supabaseAnonKey, { auth: { persistSession: false } })
    : null;

  return async (req, res, next) => {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'Authentication required' });

    try {
      if (supabase) {
        const { data, error } = await supabase.auth.getUser(token);
        if (error || !data.user) throw error ?? new Error('Invalid session');
        req.user = {
          id: data.user.id,
          email: data.user.email,
          role: data.user.user_metadata?.role ?? 'admin',
        };
      } else {
        req.user = jwt.verify(token, config.jwtSecret);
      }
      next();
    } catch {
      res.status(401).json({ error: 'Invalid or expired session' });
    }
  };
}

export function adminOnly(req, res, next) {
  if (!['admin', 'operations'].includes(req.user?.role)) {
    return res.status(403).json({ error: 'Scheduling access is required' });
  }
  next();
}
