/**
 * Tests for the call-centre job feed parser (UC-002 input — Justin).
 */

import { parseCallCentreJobs, validateJob } from '../src/integrations/callcentre';

describe('parseCallCentreJobs()', () => {
  it('parses a well-formed CSV', () => {
    const csv = [
      'job_date,pickup_time,service_type,pickup_loc,dropoff_loc',
      '2026-07-15,09:30,MTS,Tan Tock Seng Hospital,Singapore General Hospital',
      '2026-07-15,10:00,EAS,Bedok North,Changi General Hospital',
    ].join('\n');

    const jobs = parseCallCentreJobs(csv);
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      job_date: '2026-07-15',
      pickup_time: '09:30',
      service_type: 'MTS',
      source: 'call_centre',
    });
  });

  it('handles alternative header names', () => {
    const csv = [
      'Date,Time,Type,From,To',
      '15/07/2026,930,eas,Yishun,KTPH',
    ].join('\n');

    const jobs = parseCallCentreJobs(csv);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].job_date).toBe('2026-07-15');
    expect(jobs[0].pickup_time).toBe('09:30');
    expect(jobs[0].service_type).toBe('EAS');
  });

  it('respects quoted fields containing commas', () => {
    const csv = [
      'job_date,pickup_time,service_type,pickup_loc,dropoff_loc',
      '2026-07-15,09:30,MTS,"Blk 123, Ang Mo Kio Ave 3",SGH',
    ].join('\n');

    const jobs = parseCallCentreJobs(csv);
    expect(jobs[0].pickup_loc).toBe('Blk 123, Ang Mo Kio Ave 3');
  });

  it('skips rows missing required fields', () => {
    const csv = [
      'job_date,pickup_time,service_type,pickup_loc,dropoff_loc',
      '2026-07-15,,MTS,A,B',
      '2026-07-15,09:30,MTS,A,B',
    ].join('\n');

    const jobs = parseCallCentreJobs(csv);
    expect(jobs).toHaveLength(1);
  });

  it('returns empty for header-only or empty input', () => {
    expect(parseCallCentreJobs('')).toHaveLength(0);
    expect(parseCallCentreJobs('job_date,pickup_time,service_type')).toHaveLength(0);
  });
});

describe('validateJob()', () => {
  it('accepts a valid job', () => {
    const { valid, errors } = validateJob({
      job_date: '2026-07-15',
      pickup_time: '09:30',
      service_type: 'MTS',
      pickup_loc: 'A',
      dropoff_loc: 'B',
      source: 'call_centre',
    });
    expect(valid).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it('rejects an invalid service type and bad formats', () => {
    const { valid, errors } = validateJob({
      job_date: '15-07-2026',
      pickup_time: '9am',
      service_type: 'TAXI',
      pickup_loc: '',
      dropoff_loc: '',
      source: 'call_centre',
    });
    expect(valid).toBe(false);
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});
