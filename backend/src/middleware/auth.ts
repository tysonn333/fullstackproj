import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../lib/supabase';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email?: string;
    role?: string;
  };
  accessToken?: string;
}

export async function authenticate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.substring(7);

  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !data.user) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    // Fetch profile to get role
    const { data: profile, error: profileQueryError } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', data.user.id)
      .maybeSingle();

    if (profileQueryError) {
      console.error(`[AUTH] Profile query error for ${data.user.email}:`, profileQueryError.message);
      res.status(500).json({ error: 'Database error' });
      return;
    }

    const role = profile?.role ?? '';
    if (!role) {
      console.warn(`[AUTH] No profile found for ${data.user.email} (id=${data.user.id})`);
      res.status(403).json({ error: 'No profile found — contact an administrator' });
      return;
    }

    req.user = {
      id: data.user.id,
      email: data.user.email,
      role,
    };
    req.accessToken = token;

    next();
  } catch (err) {
    res.status(401).json({ error: 'Token verification failed' });
  }
}

export function requireRole(...roles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthenticated' });
      return;
    }
    if (!roles.includes(req.user.role ?? '')) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}
