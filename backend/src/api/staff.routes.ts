import { Router, Response, NextFunction } from 'express';
import supabaseAdmin from '../lib/supabase';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { logAudit } from '../services/audit.service';

const router = Router();
router.use(authenticate);

/**
 * GET /api/v1/staff
 * Query params: role, status, employment_type, search (name/email)
 */
router.get('/', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    let query = supabaseAdmin
      .from('staff')
      .select('*')
      .order('full_name', { ascending: true });

    if (req.query.role) query = query.eq('role', req.query.role as string);
    if (req.query.status) query = query.eq('status', req.query.status as string);
    if (req.query.employment_type) query = query.eq('employment_type', req.query.employment_type as string);
    if (req.query.search) {
      const s = `%${req.query.search}%`;
      query = query.or(`full_name.ilike.${s},email.ilike.${s}`);
    }

    const { data, error } = await query;
    if (error) throw error;

    res.json({ data });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/staff
 */
router.post('/', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { full_name, phone, email, role, employment_type, home_postal } = req.body;

    if (!full_name || !role || !employment_type) {
      res.status(400).json({ error: 'full_name, role, and employment_type are required' });
      return;
    }

    const validRoles = ['driver', 'medic', 'emt', 'paramedic'];
    if (!validRoles.includes(role)) {
      res.status(400).json({ error: `role must be one of: ${validRoles.join(', ')}` });
      return;
    }

    const validEmpTypes = ['full_time', 'part_time'];
    if (!validEmpTypes.includes(employment_type)) {
      res.status(400).json({ error: `employment_type must be one of: ${validEmpTypes.join(', ')}` });
      return;
    }

    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from('staff')
      .insert({ full_name, phone, email, role, employment_type, home_postal, status: 'active', created_at: now, updated_at: now })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ error: 'A staff member with this email already exists' });
        return;
      }
      throw error;
    }

    await logAudit({
      entity_type: 'staff',
      entity_id: data.staff_id,
      action: 'create',
      actor_id: req.user!.id,
      details: { full_name, role, employment_type },
    });

    res.status(201).json({ data });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/staff/:id
 */
router.get('/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('staff')
      .select('*, staff_certifications(*)')
      .eq('staff_id', parseInt(req.params.id, 10))
      .single();

    if (error || !data) {
      res.status(404).json({ error: 'Staff member not found' });
      return;
    }

    res.json({ data });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/v1/staff/:id
 */
router.put('/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const staffId = parseInt(req.params.id, 10);
    const { full_name, phone, email, role, employment_type, home_postal, status } = req.body;

    const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (full_name !== undefined) updatePayload.full_name = full_name;
    if (phone !== undefined) updatePayload.phone = phone;
    if (email !== undefined) updatePayload.email = email;
    if (role !== undefined) updatePayload.role = role;
    if (employment_type !== undefined) updatePayload.employment_type = employment_type;
    if (home_postal !== undefined) updatePayload.home_postal = home_postal;
    if (status !== undefined) updatePayload.status = status;

    const { data, error } = await supabaseAdmin
      .from('staff')
      .update(updatePayload)
      .eq('staff_id', staffId)
      .select()
      .single();

    if (error || !data) {
      res.status(404).json({ error: 'Staff member not found' });
      return;
    }

    await logAudit({
      entity_type: 'staff',
      entity_id: staffId,
      action: 'update',
      actor_id: req.user!.id,
      details: updatePayload,
    });

    res.json({ data });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/v1/staff/:id
 * Soft delete — sets status to inactive
 */
router.delete('/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const staffId = parseInt(req.params.id, 10);

    const { data, error } = await supabaseAdmin
      .from('staff')
      .update({ status: 'inactive', updated_at: new Date().toISOString() })
      .eq('staff_id', staffId)
      .select()
      .single();

    if (error || !data) {
      res.status(404).json({ error: 'Staff member not found' });
      return;
    }

    await logAudit({
      entity_type: 'staff',
      entity_id: staffId,
      action: 'delete',
      actor_id: req.user!.id,
      details: { reason: 'soft delete — status set to inactive' },
    });

    res.json({ message: 'Staff member deactivated', data });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/staff/:id/certifications
 */
router.get('/:id/certifications', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const staffId = parseInt(req.params.id, 10);

    const { data, error } = await supabaseAdmin
      .from('staff_certifications')
      .select('*')
      .eq('staff_id', staffId)
      .order('expiry_date', { ascending: true });

    if (error) throw error;

    // Annotate each cert with expiry status
    const today = new Date().toISOString().split('T')[0];
    const annotated = (data ?? []).map((cert) => ({
      ...cert,
      is_expired: cert.expiry_date < today,
      expires_soon: cert.expiry_date >= today && cert.expiry_date <= getDatePlusDays(today, 30),
    }));

    res.json({ data: annotated });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/staff/:id/certifications
 */
router.post('/:id/certifications', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const staffId = parseInt(req.params.id, 10);
    const { cert_name, issued_date, expiry_date } = req.body;

    if (!cert_name || !issued_date || !expiry_date) {
      res.status(400).json({ error: 'cert_name, issued_date, and expiry_date are required' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('staff_certifications')
      .insert({ staff_id: staffId, cert_name, issued_date, expiry_date })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ error: `Certification '${cert_name}' already exists for this staff member` });
        return;
      }
      throw error;
    }

    await logAudit({
      entity_type: 'staff_certifications',
      entity_id: data.cert_id,
      action: 'create',
      actor_id: req.user!.id,
      details: { staff_id: staffId, cert_name, expiry_date },
    });

    res.status(201).json({ data });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/v1/staff/:id/certifications/:certId
 */
router.delete('/:id/certifications/:certId', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const staffId = parseInt(req.params.id, 10);
    const certId = parseInt(req.params.certId, 10);

    const { data, error } = await supabaseAdmin
      .from('staff_certifications')
      .delete()
      .eq('cert_id', certId)
      .eq('staff_id', staffId)
      .select()
      .single();

    if (error || !data) {
      res.status(404).json({ error: 'Certification not found' });
      return;
    }

    await logAudit({
      entity_type: 'staff_certifications',
      entity_id: certId,
      action: 'delete',
      actor_id: req.user!.id,
      details: { staff_id: staffId, cert_name: data.cert_name },
    });

    res.json({ message: 'Certification deleted' });
  } catch (err) {
    next(err);
  }
});

function getDatePlusDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

export default router;
