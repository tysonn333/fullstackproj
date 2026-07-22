import { beforeEach, describe, expect, it } from 'vitest';
import { LocalRepository } from '../../backend/src/repositories/localRepository.js';
import { ExceptionService } from '../../backend/src/services/exceptionService.js';
import { createSeedData } from '../../backend/src/config/seedData.js';

let repository;
let service;
const actor = { email: 'chad@efar.local', role: 'admin' };

beforeEach(async () => {
  repository = new LocalRepository({
    initialData: createSeedData('chad@efar.local', 'chad1234'),
    email: 'chad@efar.local',
    password: 'chad1234',
  });
  await repository.init();
  service = new ExceptionService(repository);
});

describe('ExceptionService', () => {
  it('resolves an exception and records an audit entry', async () => {
    const updated = await service.action('exception-001', {
      action: 'resolve',
      note: 'Part-timer confirmed the morning slot',
    }, actor);

    expect(updated.status).toBe('resolved');
    const audit = await service.audit('exception-001');
    expect(audit[0]).toMatchObject({ action: 'resolve', actor_email: actor.email });
  });

  it('requires a meaningful reason when dismissing', async () => {
    await expect(service.action('exception-001', {
      action: 'dismiss',
      note: 'No',
    }, actor)).rejects.toMatchObject({ status: 422 });
  });

  it('requires a review date when deferring', async () => {
    await expect(service.action('exception-001', {
      action: 'defer',
      note: 'Waiting for confirmation',
    }, actor)).rejects.toMatchObject({ status: 422 });
  });

  it('handles a bulk action and writes separate audit entries', async () => {
    const updated = await service.bulkAction(['exception-001', 'exception-002'], {
      action: 'resolve',
      note: 'Roster updated',
    }, actor);

    expect(updated).toHaveLength(2);
    expect(await service.audit('exception-001')).toHaveLength(1);
    expect(await service.audit('exception-002')).toHaveLength(1);
  });
});
