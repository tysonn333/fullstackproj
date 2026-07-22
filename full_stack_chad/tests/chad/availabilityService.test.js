import { beforeEach, describe, expect, it } from 'vitest';
import { LocalRepository } from '../../backend/src/repositories/localRepository.js';
import { AvailabilityService } from '../../backend/src/services/availabilityService.js';
import { createSeedData } from '../../backend/src/config/seedData.js';

let repository;
let service;

beforeEach(async () => {
  repository = new LocalRepository({
    initialData: createSeedData('chad@efar.local', 'chad1234'),
    email: 'chad@efar.local',
    password: 'chad1234',
  });
  await repository.init();
  service = new AvailabilityService(repository);
});

describe('AvailabilityService', () => {
  it('creates a valid part-timer availability record', async () => {
    const item = await service.create({
      staff_id: 'staff-pt-001',
      available_date: '2030-01-10',
      period: 'AM',
      start_time: '06:00',
      end_time: '12:00',
      note: '',
      coverage_gap: false,
    });

    expect(item.staff.name).toBe('Alicia Lim');
    expect(item.period).toBe('AM');
  });

  it('blocks overlapping records for the same part-timer', async () => {
    await service.create({
      staff_id: 'staff-pt-001',
      available_date: '2030-01-11',
      period: 'AM',
      start_time: '06:00',
      end_time: '12:00',
      note: '',
      coverage_gap: false,
    });

    await expect(service.create({
      staff_id: 'staff-pt-001',
      available_date: '2030-01-11',
      period: 'CUSTOM',
      start_time: '10:00',
      end_time: '14:00',
      note: '',
      coverage_gap: false,
    })).rejects.toMatchObject({ status: 409 });
  });

  it('creates a coverage-gap exception for half-day coverage', async () => {
    await service.create({
      staff_id: 'staff-pt-002',
      available_date: '2030-01-12',
      period: 'PM',
      start_time: '12:00',
      end_time: '22:00',
      note: '',
      coverage_gap: true,
    });

    const exceptions = await repository.listExceptions({ status: 'all', type: 'HALF_DAY_GAP' });
    expect(exceptions.some((item) => item.shift_date === '2030-01-12' && item.shift_start === '06:00')).toBe(true);
  });

  it('soft-deletes availability records', async () => {
    const item = await service.create({
      staff_id: 'staff-pt-003',
      available_date: '2030-01-13',
      period: 'FULL_DAY',
      start_time: '06:00',
      end_time: '22:00',
      note: '',
      coverage_gap: false,
    });

    expect(await service.remove(item.id)).toBe(true);
    expect(await repository.getAvailability(item.id)).toBeNull();
  });
});
