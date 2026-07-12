import supabaseAdmin from '../lib/supabase';

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'approve'
  | 'reject'
  | 'publish'
  | 'generate'
  | 'assign'
  | 'reassign'
  | 'resolve'
  | 'dismiss'
  | 'import'
  | 'mark_unavailable'
  | 'login'
  | 'logout';

export interface AuditEntry {
  entity_type: string;
  entity_id: number | string;
  action: AuditAction;
  actor_id: string;
  details?: Record<string, unknown>;
}

export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from('audit_log').insert({
      entity_type: entry.entity_type,
      entity_id: typeof entry.entity_id === 'string' ? null : entry.entity_id,
      action: entry.action,
      actor_id: entry.actor_id,
      details: entry.details ?? {},
      created_at: new Date().toISOString(),
    });

    if (error) {
      console.error('[AUDIT] Failed to write audit log:', error.message);
    }
  } catch (err) {
    console.error('[AUDIT] Unexpected error writing audit log:', err);
  }
}
