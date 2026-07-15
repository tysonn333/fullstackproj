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
      .select('name, role')
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
        role: profile?.role,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/auth/profile
 * Returns the authenticated user's profile (name, role) and linked staff record.
 */
router.get('/profile', authenticate, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('name, role')
      .eq('id', req.user!.id)
      .single();

    if (error || !profile) {
      res.status(404).json({ error: 'Profile not found' });
      return;
    }

    // If staff role, fetch linked staff record
    let staffRecord = null;
    if (profile.role === 'staff') {
      // Try profile_id first, fall back to email match
      let staff = null;

      try {
        const { data } = await supabaseAdmin
          .from('staff')
          .select('staff_id, full_name, role, email, phone, employment_type, home_postal, status')
          .eq('profile_id', req.user!.id)
          .maybeSingle();
        staff = data;
      } catch {
        // profile_id column may not exist — fall through to email lookup
      }

      if (!staff && req.user?.email) {
        const { data } = await supabaseAdmin
          .from('staff')
          .select('staff_id, full_name, role, email, phone, employment_type, home_postal, status')
          .eq('email', req.user.email)
          .maybeSingle();
        staff = data;
      }

      if (staff) {
        staffRecord = {
          staff_id: staff.staff_id,
          full_name: staff.full_name,
          role: staff.role,
          email: staff.email,
          phone: staff.phone,
          employment_type: staff.employment_type,
          home_postal: staff.home_postal,
          status: staff.status
        };
      }
    }

    res.json({
      id: req.user!.id,
      email: req.user!.email,
      name: profile.name,
      role: profile.role,
      staff: staffRecord,
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
