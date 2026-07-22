import { nowIso } from '../utils/date.js';

const actionStatus = {
  resolve: 'resolved',
  defer: 'deferred',
  dismiss: 'dismissed',
  reject: 'rejected',
  reopen: 'active',
};

export class ExceptionService {
  constructor(repository) {
    this.repository = repository;
  }

  async list(filters) {
    return this.repository.listExceptions(filters);
  }

  async action(id, input, actor) {
    const item = await this.repository.getException(id);
    if (!item) return null;

    const newStatus = actionStatus[input.action];
    if (!newStatus) {
      const error = new Error('Unsupported exception action');
      error.status = 422;
      throw error;
    }

    const note = input.note?.trim() ?? '';
    if (['dismiss', 'reject'].includes(input.action) && note.length < 10) {
      const error = new Error('A reason of at least 10 characters is required');
      error.status = 422;
      throw error;
    }
    if (input.action === 'defer' && !input.deferred_until) {
      const error = new Error('A defer date is required');
      error.status = 422;
      throw error;
    }

    const finished = ['resolved', 'dismissed', 'rejected'].includes(newStatus);
    const updated = await this.repository.updateException(id, {
      status: newStatus,
      resolution_note: note || null,
      deferred_until: newStatus === 'deferred' ? input.deferred_until : null,
      resolved_by: finished ? actor.email : null,
      resolved_at: finished ? nowIso() : null,
    });

    await this.repository.createAudit({
      exception_id: id,
      action: input.action,
      previous_status: item.status,
      new_status: newStatus,
      note: note || null,
      actor_email: actor.email,
    });

    return updated;
  }

  async bulkAction(ids, input, actor) {
    const uniqueIds = [...new Set(ids)];
    const results = [];
    for (const id of uniqueIds) {
      const updated = await this.action(id, input, actor);
      if (updated) results.push(updated);
    }
    return results;
  }

  async audit(id) {
    const item = await this.repository.getException(id);
    if (!item) return null;
    return this.repository.listAudit(id);
  }

  async notification(id, actor) {
    const item = await this.repository.getException(id);
    if (!item) return null;

    await this.repository.createAudit({
      exception_id: id,
      action: 'notification_fallback',
      previous_status: item.status,
      new_status: item.status,
      note: 'Browser notification requested',
      actor_email: actor.email,
    });

    return {
      title: `${item.severity.toUpperCase()}: Scheduling exception`,
      body: `${item.shift_date} ${item.shift_start}-${item.shift_end} - ${item.summary}`,
      tag: `exception-${item.id}`,
    };
  }
}
