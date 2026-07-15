import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../lib/supabase';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email?: string;
    role?: string;
    staffId?: number | null;
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

    // Fetch profile to get role + linked staff record.
    // Default to the least-privileged role ('employee') when no profile row
    // exists, so a missing/misconfigured profile can never grant admin rights.
    let { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role, staff_id')
      .eq('id', data.user.id)
      .maybeSingle();

    // Self-heal a missing profile row. Previously the linking logic lived only
    // in GET /auth/me, but its UPDATE hit ZERO rows when the profile row didn't
    // exist at all — so the UI showed the staff member's name while every write
    // still returned 403 from ensureSelfOrAdmin (req.user.staffId stayed null).
    // Creating the row here, and doing the email→staff link in the middleware,
    // makes the link authoritative for every request.
    if (!profile) {
      const emailPrefix = data.user.email ? data.user.email.split('@')[0] : 'user';
      const { data: created } = await supabaseAdmin
        .from('profiles')
        .insert({ id: data.user.id, name: emailPrefix, role: 'employee' })
        .select('role, staff_id')
        .single();
      profile = created ?? { role: 'employee', staff_id: null };
    }

    const role = profile?.role ?? 'employee';
    let staffId: number | null = profile?.staff_id ?? null;

    // Link the login to a staff record by matching email, and PERSIST it so
    // ensureSelfOrAdmin (and subsequent requests) recognise the ownership.
    if (staffId == null && data.user.email) {
      const { data: matchingStaff } = await supabaseAdmin
        .from('staff')
        .select('staff_id')
        .eq('email', data.user.email)
        .maybeSingle();

      if (matchingStaff) {
        staffId = matchingStaff.staff_id;
        await supabaseAdmin
          .from('profiles')
          .update({ staff_id: staffId })
          .eq('id', data.user.id);
      }
    }

    req.user = {
      id: data.user.id,
      email: data.user.email,
      role,
      staffId,
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

/**
 * Gate a route to admins only. Use after `authenticate`.
 */
export const requireAdmin = requireRole('admin');

/**
 * Allow the action only if the caller is an admin or is operating on their own
 * linked staff record. Returns true when allowed; otherwise sends 403 and
 * returns false so the caller can `return` early.
 */
export function ensureSelfOrAdmin(
  req: AuthenticatedRequest,
  res: Response,
  staffId: number
): boolean {
  if (req.user?.role === 'admin') return true;
  if (req.user?.staffId != null && req.user.staffId === staffId) return true;
  res.status(403).json({
    error: 'You can only manage your own records. Ask an admin if you need broader access.',
  });
  return false;
}
