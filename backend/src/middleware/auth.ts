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

    // Fetch the profile to get role + linked staff record.
    //
    // This must work across schema variants without a migration having run:
    // a database created from the older `admin`/`ops_director` schema has no
    // `profiles.staff_id` column, and selecting it would error. So we select
    // `role, staff_id` first and, if that fails, fall back to `role` only and
    // remember the column is absent. Crucially, we NEVER downgrade the role of
    // an existing profile row — an earlier version clobbered admins to
    // 'employee' when the staff_id select errored, which is exactly why
    // admin@efar.sg showed up as an employee.
    let profile: { role?: string | null; staff_id?: number | null } | null = null;
    let hasStaffIdColumn = true;

    const primary = await supabaseAdmin
      .from('profiles')
      .select('role, staff_id')
      .eq('id', data.user.id)
      .maybeSingle();

    if (primary.error) {
      hasStaffIdColumn = false;
      const roleOnly = await supabaseAdmin
        .from('profiles')
        .select('role')
        .eq('id', data.user.id)
        .maybeSingle();
      profile = roleOnly.data ?? null;
    } else {
      profile = primary.data;
    }

    // Self-heal only a GENUINELY missing profile row (a brand-new login). If the
    // insert fails (row already exists, or an older role CHECK rejects
    // 'employee'), re-read the stored role rather than assuming 'employee'.
    if (!profile) {
      const emailPrefix = data.user.email ? data.user.email.split('@')[0] : 'user';
      const inserted = await supabaseAdmin
        .from('profiles')
        .insert({ id: data.user.id, name: emailPrefix, role: 'employee' })
        .select('role')
        .maybeSingle();
      if (inserted.data) {
        profile = inserted.data;
      } else {
        const reread = await supabaseAdmin
          .from('profiles')
          .select('role')
          .eq('id', data.user.id)
          .maybeSingle();
        profile = reread.data ?? { role: 'employee' };
      }
    }

    // Normalise the role: the legacy full-access role 'ops_director' maps to
    // 'admin'; only 'admin'/'ops_director' grant admin, everything else is an
    // employee. This keeps least-privilege while honouring an existing admin.
    const rawRole = profile?.role ?? 'employee';
    const role = rawRole === 'admin' || rawRole === 'ops_director' ? 'admin' : 'employee';

    let staffId: number | null = profile?.staff_id ?? null;

    // Link the login to a staff record by matching email, and PERSIST it so
    // ensureSelfOrAdmin (and subsequent requests) recognise the ownership.
    // Skip entirely when the staff_id column doesn't exist yet.
    if (hasStaffIdColumn && staffId == null && data.user.email) {
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
