import { createClient } from '@supabase/supabase-js';

const requireData = (result) => {
  if (result.error) throw result.error;
  return result.data;
};

export class SupabaseRepository {
  constructor(config) {
    this.client = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { persistSession: false },
    });
  }

  async init() {}

  async findUserByEmail() {
    return null;
  }

  async listStaff() {
    return requireData(await this.client
      .from('staff_members')
      .select('*')
      .eq('active', true)
      .eq('employment_type', 'part_time')
      .order('name'));
  }

  async getStaff(id) {
    const data = requireData(await this.client.from('staff_members').select('*').eq('id', id).maybeSingle());
    return data ?? null;
  }

  async listAvailability({ start, end, staffId }) {
    let query = this.client
      .from('part_timer_availability')
      .select('*, staff:staff_members(*)')
      .is('deleted_at', null)
      .gte('available_date', start)
      .lte('available_date', end)
      .order('available_date');
    if (staffId) query = query.eq('staff_id', staffId);
    return requireData(await query);
  }

  async getAvailability(id) {
    return requireData(await this.client
      .from('part_timer_availability')
      .select('*, staff:staff_members(*)')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle());
  }

  async createAvailability(input) {
    const data = requireData(await this.client.from('part_timer_availability').insert(input).select('id').single());
    return this.getAvailability(data.id);
  }

  async updateAvailability(id, changes) {
    const data = requireData(await this.client
      .from('part_timer_availability')
      .update(changes)
      .eq('id', id)
      .is('deleted_at', null)
      .select('id')
      .maybeSingle());
    return data ? this.getAvailability(data.id) : null;
  }

  async deleteAvailability(id) {
    const data = requireData(await this.client
      .from('part_timer_availability')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .is('deleted_at', null)
      .select('id')
      .maybeSingle());
    return Boolean(data);
  }

  async findAvailabilityOverlap({ staffId, availableDate, startTime, endTime, excludeId }) {
    let query = this.client
      .from('part_timer_availability')
      .select('*')
      .eq('staff_id', staffId)
      .eq('available_date', availableDate)
      .is('deleted_at', null)
      .lt('start_time', endTime)
      .gt('end_time', startTime);
    if (excludeId) query = query.neq('id', excludeId);
    const data = requireData(await query.limit(1));
    return data[0] ?? null;
  }

  async listExceptions(filters = {}) {
    let query = this.client
      .from('scheduling_exceptions')
      .select('*, staff:staff_members(*)')
      .order('shift_date')
      .order('shift_start');
    if (filters.status && filters.status !== 'all') query = query.eq('status', filters.status);
    if (filters.severity && filters.severity !== 'all') query = query.eq('severity', filters.severity);
    if (filters.type && filters.type !== 'all') query = query.eq('type', filters.type);
    if (filters.from) query = query.gte('shift_date', filters.from);
    if (filters.to) query = query.lte('shift_date', filters.to);
    const data = requireData(await query);
    const priorities = { critical: 0, warning: 1, informational: 2 };
    return data.sort((a, b) => priorities[a.severity] - priorities[b.severity]);
  }

  async getException(id) {
    return requireData(await this.client
      .from('scheduling_exceptions')
      .select('*, staff:staff_members(*)')
      .eq('id', id)
      .maybeSingle());
  }

  async createException(input) {
    const data = requireData(await this.client.from('scheduling_exceptions').insert(input).select('id').single());
    return this.getException(data.id);
  }

  async updateException(id, changes) {
    const data = requireData(await this.client
      .from('scheduling_exceptions')
      .update(changes)
      .eq('id', id)
      .select('id')
      .maybeSingle());
    return data ? this.getException(data.id) : null;
  }

  async createAudit(input) {
    return requireData(await this.client.from('exception_audit_log').insert(input).select('*').single());
  }

  async listAudit(exceptionId) {
    return requireData(await this.client
      .from('exception_audit_log')
      .select('*')
      .eq('exception_id', exceptionId)
      .order('created_at', { ascending: false }));
  }
}
