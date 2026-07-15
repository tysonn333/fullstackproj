import { Router, Request, Response, NextFunction } from 'express';
import supabaseAdmin from '../lib/supabase';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { logAudit } from '../services/audit.service';

const router = Router();

/**
 * POST /api/v1/auth/login
 * Body: { email, password }
 * Returns: { access_token, refresh_token, user }
 */
router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'email and password are required' });
      return;
    }

    const { data, error } = await supabaseAdmin.auth.signInWithPassword({ email, password });

    if (error || !data.session) {
      res.status(401).json({ error: error?.message ?? 'Invalid credentials' });
      return;
    }

    // Fetch profile
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('name, role, staff_id')
      .eq('id', data.user.id)
      .single();

    await logAudit({
      entity_type: 'auth',
      entity_id: data.user.id,
      action: 'login',
      actor_id: data.user.id,
      details: { email },
    });

    res.json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at,
      user: {
        id: data.user.id,
        email: data.user.email,
        name: profile?.name,
        role: profile?.role ?? 'employee',
        staff_id: profile?.staff_id ?? null,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/auth/me
 * Returns the current user's profile, role, and linked staff record.
 * The authenticate middleware already self-heals the profile row and links the
 * staff record by email (persisting req.user.staffId), so this route simply
 * trusts req.user and reads the display name + staff row.
 */
router.get('/me', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('name, role')
      .eq('id', req.user!.id)
      .maybeSingle();

    const staffId = req.user!.staffId ?? null;

    let staff = null;
    if (staffId != null) {
      const { data } = await supabaseAdmin
        .from('staff')
        .select('*')
        .eq('staff_id', staffId)
        .single();
      staff = data;
    }

    res.json({
      id: req.user!.id,
      email: req.user!.email,
      name: profile?.name ?? null,
      role: req.user!.role ?? 'employee',
      staff_id: staffId,
      staff,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/auth/logout
 * Requires Authorization header.
 */
router.post('/logout', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { error } = await supabaseAdmin.auth.admin.signOut(req.accessToken!);

    if (error) {
      // Non-fatal — token may already be expired
      console.warn('[AUTH] Logout warning:', error.message);
    }

    await logAudit({
      entity_type: 'auth',
      entity_id: req.user!.id,
      action: 'logout',
      actor_id: req.user!.id,
    });

    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
});

export default router;
