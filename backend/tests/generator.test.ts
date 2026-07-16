/**
 * Tests for the UC-002 generator's pure demand helpers.
 * (The full generation loop is exercised against a live database; these cover
 * the job-demand math and the weekend/public-holiday rule.)
 */

// The generator imports the Supabase client at module load — stub it so these
// pure-function tests never need env vars or a network.
jest.mock('../src/lib/supabase', () => ({
  __esModule: true,
  default: { from: jest.fn() },
}));

import {
  peakConcurrentJobs,
  isWeekendOrPublicHoliday,
  coverageGapMessage,
} from '../src/services/scheduling/generator';
import { ShiftSlot } from '../src/services/scheduling/filter';

describe('peakConcurrentJobs()', () => {
  it('returns 0 for no jobs', () => {
    expect(peakConcurrentJobs([])).toBe(0);
  });

  it('returns 1 for a single job', () => {
    expect(peakConcurrentJobs([{ pickup_time: '09:00:00' }])).toBe(1);
  });

  it('counts two simultaneous jobs as peak 2 (spec: two 06:30 jobs → 2 crews)', () => {
    expect(
      peakConcurrentJobs([{ pickup_time: '06:30:00' }, { pickup_time: '06:30:00' }])
    ).toBe(2);
  });

  it('counts overlapping (but not simultaneous) jobs within the job window', () => {
    // 2h window: 09:00–11:00 overlaps 10:00–12:00
    expect(
      peakConcurrentJobs([{ pickup_time: '09:00:00' }, { pickup_time: '10:00:00' }])
    ).toBe(2);
  });

  it('does not stack jobs that are far apart', () => {
    expect(
      peakConcurrentJobs([{ pickup_time: '06:00:00' }, { pickup_time: '14:00:00' }])
    ).toBe(1);
  });

  it('handles a busy morning correctly', () => {
    const jobs = ['08:00', '08:30', '09:00', '13:00', '18:00'].map((t) => ({
      pickup_time: `${t}:00`,
    }));
    // 08:00–10:00, 08:30–10:30, 09:00–11:00 all overlap at 09:00–10:00 → 3
    expect(peakConcurrentJobs(jobs)).toBe(3);
  });
});

describe('isWeekendOrPublicHoliday()', () => {
  it('detects Saturdays and Sundays', () => {
    expect(isWeekendOrPublicHoliday('2026-07-11')).toBe(true); // Saturday
    expect(isWeekendOrPublicHoliday('2026-07-12')).toBe(true); // Sunday
  });

  it('detects a Singapore public holiday on a weekday', () => {
    expect(isWeekendOrPublicHoliday('2026-08-10')).toBe(true); // National Day (observed), Monday
    expect(isWeekendOrPublicHoliday('2026-12-25')).toBe(true); // Christmas, Friday
  });

  it('treats an ordinary weekday as a workday', () => {
    expect(isWeekendOrPublicHoliday('2026-07-13')).toBe(false); // Monday
    expect(isWeekendOrPublicHoliday('2026-07-15')).toBe(false); // Wednesday
  });
});

describe('coverageGapMessage() — management deployment (UC-004 A2 / UC-002 A6)', () => {
  const slot: ShiftSlot = {
    slot_id: 7,
    roster_id: 1,
    ambulance_id: 2,
    start_time: '06:00:00',
    end_time: '18:00:00',
    service_type: 'EAS',
    crew_position: 'driver',
  };

  it('is a plain coverage-gap message when no management staff qualify', () => {
    const msg = coverageGapMessage('driver', slot, []);
    expect(msg).toBe('No eligible driver for EAS slot 7 (06:00:00–18:00:00)');
    expect(msg).not.toContain('MANAGEMENT');
  });

  it('names qualified management staff for manual deployment', () => {
    const msg = coverageGapMessage('driver', slot, [{ full_name: 'Adrian Chia (Ops Manager)' }]);
    expect(msg).toContain('MANAGEMENT DEPLOYMENT REQUIRED');
    expect(msg).toContain('Adrian Chia (Ops Manager)');
    expect(msg).toContain('passes all filters');
  });

  it('pluralises correctly for multiple management candidates', () => {
    const msg = coverageGapMessage('attendant', slot, [
      { full_name: 'Adrian Chia' },
      { full_name: 'Dr. Elaine Foo' },
    ]);
    expect(msg).toContain('Adrian Chia, Dr. Elaine Foo');
    expect(msg).toContain('pass all filters');
  });
});
