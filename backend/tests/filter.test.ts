/**
 * Tests for UC-004 Filter Pipeline
 *
 * Since the filter pipeline queries Supabase, we mock the supabase client
 * and test the business logic in isolation.
 */

import {
  isCertEligible,
  timeToMinutes,
  filterCandidates,
  ShiftSlot,
  StaffCandidate,
} from '../src/services/scheduling/filter';

// ── Mock Supabase ────────────────────────────────────────────────────────────

// We need to mock the supabase module before any imports use it.
// The filter module queries: leave_requests, availability, assignments (two times)
// We build a flexible mock that can be configured per test.

type QueryBuilder = {
  select: jest.Mock;
  eq: jest.Mock;
  in: jest.Mock;
  neq: jest.Mock;
  lte: jest.Mock;
  gte: jest.Mock;
  single: jest.Mock;
  order: jest.Mock;
  limit: jest.Mock;
  _resolve: (v: { data: unknown; error: null }) => void;
};

function makeQueryBuilder(returnData: unknown = [], returnError: unknown = null): QueryBuilder {
  const builder: QueryBuilder = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    neq: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue({ data: returnData, error: returnError }),
    single: jest.fn().mockResolvedValue({ data: returnData, error: returnError }),
    _resolve: jest.fn(),
  };
  // Make the builder itself thenable so `await query` works
  (builder as unknown as Record<string, unknown>).then = (
    onfulfilled?: ((value: { data: unknown; error: unknown }) => unknown) | null
  ) => {
    const result = { data: returnData, error: returnError };
    if (onfulfilled) onfulfilled(result);
    return Promise.resolve(result);
  };
  return builder;
}

// Global mock state for tests
let mockLeaveData: unknown[] = [];
let mockAvailData: unknown = null;
let mockAssignData: unknown[] = [];
let mockAssignCallCount = 0;

jest.mock('../src/lib/supabase', () => ({
  __esModule: true,
  default: {
    from: jest.fn((table: string) => {
      if (table === 'leave_requests') {
        return makeQueryBuilder(mockLeaveData);
      }
      if (table === 'availability') {
        return makeQueryBuilder(mockAvailData);
      }
      if (table === 'assignments') {
        mockAssignCallCount++;
        return makeQueryBuilder(mockAssignData);
      }
      if (table === 'staff') {
        return makeQueryBuilder([]);
      }
      return makeQueryBuilder([]);
    }),
  },
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const baseSlot: ShiftSlot = {
  slot_id: 1,
  roster_id: 10,
  ambulance_id: 5,
  start_time: '06:00:00',
  end_time: '18:00:00',
  service_type: 'MTS',
  crew_position: 'attendant',
};

const easSlot: ShiftSlot = {
  ...baseSlot,
  slot_id: 2,
  service_type: 'EAS',
};

const nightSlot: ShiftSlot = {
  ...baseSlot,
  slot_id: 3,
  start_time: '18:00:00',
  end_time: '06:00:00',
  service_type: 'MTS',
};

function makeCandidate(overrides: Partial<StaffCandidate> = {}): StaffCandidate {
  return {
    staff_id: 1,
    full_name: 'John Doe',
    role: 'medic',
    employment_type: 'full_time',
    status: 'active',
    ...overrides,
  };
}

// ── Unit Tests ────────────────────────────────────────────────────────────────

describe('timeToMinutes()', () => {
  it('converts midnight to 0', () => {
    expect(timeToMinutes('00:00')).toBe(0);
    expect(timeToMinutes('00:00:00')).toBe(0);
  });

  it('converts 06:00 to 360', () => {
    expect(timeToMinutes('06:00')).toBe(360);
    expect(timeToMinutes('06:00:00')).toBe(360);
  });

  it('converts 18:00 to 1080', () => {
    expect(timeToMinutes('18:00')).toBe(1080);
  });

  it('converts 12:30 to 750', () => {
    expect(timeToMinutes('12:30')).toBe(750);
  });

  it('converts 23:59 to 1439', () => {
    expect(timeToMinutes('23:59')).toBe(1439);
  });
});

describe('isCertEligible()', () => {
  describe('driver', () => {
    it('is eligible for MTS', () => expect(isCertEligible('driver', 'MTS')).toBe(true));
    it('is eligible for EAS', () => expect(isCertEligible('driver', 'EAS')).toBe(true));
  });

  describe('medic', () => {
    it('is eligible for MTS', () => expect(isCertEligible('medic', 'MTS')).toBe(true));
    it('is NOT eligible for EAS', () => expect(isCertEligible('medic', 'EAS')).toBe(false));
  });

  describe('emt', () => {
    it('is eligible for MTS', () => expect(isCertEligible('emt', 'MTS')).toBe(true));
    it('is NOT eligible for EAS', () => expect(isCertEligible('emt', 'EAS')).toBe(false));
  });

  describe('paramedic', () => {
    it('is eligible for MTS', () => expect(isCertEligible('paramedic', 'MTS')).toBe(true));
    it('is eligible for EAS', () => expect(isCertEligible('paramedic', 'EAS')).toBe(true));
  });
});

describe('filterCandidates() — Step 1: Availability / Leave', () => {
  const rosterDate = '2025-06-15';

  beforeEach(() => {
    mockLeaveData = [];
    mockAvailData = null;
    mockAssignData = [];
    mockAssignCallCount = 0;
  });

  it('blocks a staff member with an approved full-day leave on the roster date', async () => {
    mockLeaveData = [
      { start_date: '2025-06-15', end_date: '2025-06-15', leave_type: 'full_day' },
    ];

    const results = await filterCandidates(baseSlot, rosterDate, [makeCandidate()]);

    expect(results).toHaveLength(1);
    expect(results[0].eligible).toBe(false);
    expect(results[0].hard_blocked).toBe(true);
    expect(results[0].block_reason).toContain('leave');
  });

  it('blocks a staff member with half_am leave for an AM shift', async () => {
    mockLeaveData = [
      { start_date: '2025-06-15', end_date: '2025-06-15', leave_type: 'half_am' },
    ];

    // AM slot: 06:00–12:00
    const amSlot: ShiftSlot = { ...baseSlot, start_time: '06:00:00', end_time: '12:00:00' };
    const results = await filterCandidates(amSlot, rosterDate, [makeCandidate()]);

    expect(results[0].eligible).toBe(false);
    expect(results[0].hard_blocked).toBe(true);
  });

  it('does NOT block a staff member with half_am leave for a PM-only shift', async () => {
    mockLeaveData = [
      { start_date: '2025-06-15', end_date: '2025-06-15', leave_type: 'half_am' },
    ];

    // PM slot: 14:00–18:00 (840–1080 min) — no AM overlap
    const pmSlot: ShiftSlot = { ...baseSlot, start_time: '14:00:00', end_time: '18:00:00' };
    const results = await filterCandidates(pmSlot, rosterDate, [makeCandidate()]);

    expect(results[0].eligible).toBe(true);
  });

  it('blocks a staff member marked is_available=false in availability table', async () => {
    mockLeaveData = [];
    mockAvailData = { is_available: false, half_day: null };

    const results = await filterCandidates(baseSlot, rosterDate, [makeCandidate()]);

    expect(results[0].eligible).toBe(false);
    expect(results[0].hard_blocked).toBe(true);
  });

  it('blocks a staff member with half_day=am availability for a PM slot', async () => {
    mockLeaveData = [];
    mockAvailData = { is_available: true, half_day: 'am' }; // only AM available

    // PM slot: 14:00–18:00
    const pmSlot: ShiftSlot = { ...baseSlot, start_time: '14:00:00', end_time: '18:00:00' };
    const results = await filterCandidates(pmSlot, rosterDate, [makeCandidate()]);

    expect(results[0].eligible).toBe(false);
  });

  it('does NOT block a staff member available full day (no leave, availability=true)', async () => {
    mockLeaveData = [];
    mockAvailData = { is_available: true, half_day: null };

    const results = await filterCandidates(baseSlot, rosterDate, [makeCandidate()]);

    expect(results[0].eligible).toBe(true);
  });
});

describe('filterCandidates() — Step 2: Rest Hours (< 12h hard block)', () => {
  const rosterDate = '2025-06-15';

  beforeEach(() => {
    mockLeaveData = [];
    mockAvailData = null;
    mockAssignCallCount = 0;
  });

  it('blocks staff with only 8h rest since last shift end', async () => {
    // Last shift ended at 22:00 on 2025-06-14; new slot starts at 06:00 on 2025-06-15 = 8h rest
    mockAssignData = [
      {
        shift_slots: {
          roster_id: 9,
          end_time: '22:00:00',
          start_time: '10:00:00',
          rosters: { roster_date: '2025-06-14' },
        },
      },
    ];

    const results = await filterCandidates(baseSlot, rosterDate, [makeCandidate()]);
    expect(results[0].eligible).toBe(false);
    expect(results[0].block_reason).toContain('rest');
  });

  it('allows staff with 14h rest since last shift end', async () => {
    // Last shift ended at 16:00 on 2025-06-14; new slot starts at 06:00 on 2025-06-15 = 14h rest
    mockAssignData = [
      {
        shift_slots: {
          roster_id: 9,
          end_time: '16:00:00',
          start_time: '04:00:00',
          rosters: { roster_date: '2025-06-14' },
        },
      },
    ];

    const results = await filterCandidates(baseSlot, rosterDate, [makeCandidate()]);
    expect(results[0].eligible).toBe(true);
  });

  it('allows staff with no prior assignments (maximally rested)', async () => {
    mockAssignData = [];

    const results = await filterCandidates(baseSlot, rosterDate, [makeCandidate()]);
    expect(results[0].eligible).toBe(true);
  });
});

describe('filterCandidates() — Step 3: Daily Hours (> 12h hard block)', () => {
  const rosterDate = '2025-06-15';

  beforeEach(() => {
    mockLeaveData = [];
    mockAvailData = null;
  });

  it('blocks staff already scheduled for 12h on the same day', async () => {
    // Already assigned 06:00–18:00 (720 min = 12h) on the same date
    mockAssignData = [
      {
        slot_id: 99,
        shift_slots: {
          start_time: '06:00:00',
          end_time: '18:00:00',
          rosters: { roster_date: '2025-06-15' },
        },
      },
    ];

    // New slot 06:00–18:00 would make 24h total
    const results = await filterCandidates(baseSlot, rosterDate, [makeCandidate()]);
    expect(results[0].eligible).toBe(false);
    expect(results[0].block_reason).toContain('12h');
  });

  it('allows staff with 6h already scheduled (adding 6h = 12h total, within limit)', async () => {
    // Already assigned 06:00–12:00 (360 min = 6h)
    mockAssignData = [
      {
        slot_id: 99,
        shift_slots: {
          start_time: '06:00:00',
          end_time: '12:00:00',
          rosters: { roster_date: '2025-06-15' },
        },
      },
    ];

    // New slot 12:00–18:00 (6h) → total 12h exactly
    const sixHourSlot: ShiftSlot = { ...baseSlot, start_time: '12:00:00', end_time: '18:00:00' };
    const results = await filterCandidates(sixHourSlot, rosterDate, [makeCandidate()]);
    expect(results[0].eligible).toBe(true);
  });
});

describe('filterCandidates() — Step 4: Consecutive Days (SOFT flag only)', () => {
  const rosterDate = '2025-06-15';

  beforeEach(() => {
    mockLeaveData = [];
    mockAvailData = null;
  });

  it('flags but does NOT eliminate staff with 6 consecutive prior working days', async () => {
    // Staff worked 2025-06-09 through 2025-06-14 (6 consecutive days)
    mockAssignData = [
      { shift_slots: { start_time: '06:00', end_time: '18:00', rosters: { roster_date: '2025-06-09' } } },
      { shift_slots: { start_time: '06:00', end_time: '18:00', rosters: { roster_date: '2025-06-10' } } },
      { shift_slots: { start_time: '06:00', end_time: '18:00', rosters: { roster_date: '2025-06-11' } } },
      { shift_slots: { start_time: '06:00', end_time: '18:00', rosters: { roster_date: '2025-06-12' } } },
      { shift_slots: { start_time: '06:00', end_time: '18:00', rosters: { roster_date: '2025-06-13' } } },
      { shift_slots: { start_time: '06:00', end_time: '18:00', rosters: { roster_date: '2025-06-14' } } },
    ];

    const results = await filterCandidates(baseSlot, rosterDate, [makeCandidate()]);

    // MUST still be eligible (not hard blocked)
    expect(results[0].eligible).toBe(true);
    expect(results[0].hard_blocked).toBe(false);
    // BUT the consecutive flag must be raised
    expect(results[0].consecutive_days_flag).toBe(true);
    expect(results[0].consecutive_days_count).toBe(6);
  });

  it('does NOT flag staff with only 3 consecutive prior working days', async () => {
    mockAssignData = [
      { shift_slots: { start_time: '06:00', end_time: '18:00', rosters: { roster_date: '2025-06-12' } } },
      { shift_slots: { start_time: '06:00', end_time: '18:00', rosters: { roster_date: '2025-06-13' } } },
      { shift_slots: { start_time: '06:00', end_time: '18:00', rosters: { roster_date: '2025-06-14' } } },
    ];

    const results = await filterCandidates(baseSlot, rosterDate, [makeCandidate()]);
    expect(results[0].eligible).toBe(true);
    expect(results[0].consecutive_days_flag).toBe(false);
  });
});

describe('filterCandidates() — Step 5: Certification Match', () => {
  const rosterDate = '2025-06-15';

  beforeEach(() => {
    mockLeaveData = [];
    mockAvailData = null;
    mockAssignData = [];
  });

  it('blocks a medic from an EAS slot', async () => {
    const results = await filterCandidates(easSlot, rosterDate, [makeCandidate({ role: 'medic' })]);
    expect(results[0].eligible).toBe(false);
    expect(results[0].block_reason).toContain('EAS');
  });

  it('blocks an EMT from an EAS slot', async () => {
    const results = await filterCandidates(easSlot, rosterDate, [makeCandidate({ role: 'emt' })]);
    expect(results[0].eligible).toBe(false);
    expect(results[0].block_reason).toContain('EAS');
  });

  it('allows a paramedic on an EAS slot', async () => {
    const results = await filterCandidates(easSlot, rosterDate, [makeCandidate({ role: 'paramedic' })]);
    expect(results[0].eligible).toBe(true);
  });

  it('allows a driver on an EAS slot', async () => {
    const results = await filterCandidates(easSlot, rosterDate, [makeCandidate({ role: 'driver' })]);
    expect(results[0].eligible).toBe(true);
  });

  it('allows a medic on an MTS slot', async () => {
    const results = await filterCandidates(baseSlot, rosterDate, [makeCandidate({ role: 'medic' })]);
    expect(results[0].eligible).toBe(true);
  });

  it('allows an EMT on an MTS slot', async () => {
    const results = await filterCandidates(baseSlot, rosterDate, [makeCandidate({ role: 'emt' })]);
    expect(results[0].eligible).toBe(true);
  });

  it('allows a paramedic on an MTS slot', async () => {
    const results = await filterCandidates(baseSlot, rosterDate, [makeCandidate({ role: 'paramedic' })]);
    expect(results[0].eligible).toBe(true);
  });
});

describe('filterCandidates() — Inactive staff', () => {
  const rosterDate = '2025-06-15';

  beforeEach(() => {
    mockLeaveData = [];
    mockAvailData = null;
    mockAssignData = [];
  });

  it('immediately blocks inactive staff without running other checks', async () => {
    const results = await filterCandidates(baseSlot, rosterDate, [
      makeCandidate({ status: 'inactive' }),
    ]);

    expect(results[0].eligible).toBe(false);
    expect(results[0].hard_blocked).toBe(true);
    expect(results[0].block_reason).toContain('inactive');
  });
});

describe('filterCandidates() — Multiple candidates', () => {
  const rosterDate = '2025-06-15';

  beforeEach(() => {
    mockLeaveData = [];
    mockAvailData = null;
    mockAssignData = [];
  });

  it('returns correct mix of eligible and blocked across a list of candidates', async () => {
    const candidates: StaffCandidate[] = [
      makeCandidate({ staff_id: 1, role: 'medic' }),       // MTS eligible
      makeCandidate({ staff_id: 2, role: 'emt' }),         // MTS eligible
      makeCandidate({ staff_id: 3, role: 'paramedic' }),   // MTS eligible
      makeCandidate({ staff_id: 4, role: 'driver' }),      // MTS eligible
    ];

    const results = await filterCandidates(baseSlot, rosterDate, candidates);

    expect(results).toHaveLength(4);
    const eligible = results.filter((r) => r.eligible);
    expect(eligible).toHaveLength(4);
  });

  it('blocks non-EAS-eligible roles for an EAS slot', async () => {
    const candidates: StaffCandidate[] = [
      makeCandidate({ staff_id: 1, role: 'medic' }),       // blocked
      makeCandidate({ staff_id: 2, role: 'emt' }),         // blocked
      makeCandidate({ staff_id: 3, role: 'paramedic' }),   // eligible
      makeCandidate({ staff_id: 4, role: 'driver' }),      // eligible
    ];

    const results = await filterCandidates(easSlot, rosterDate, candidates);

    const eligible = results.filter((r) => r.eligible);
    const blocked = results.filter((r) => !r.eligible);

    expect(eligible).toHaveLength(2);
    expect(blocked).toHaveLength(2);
    expect(eligible.map((e) => e.role).sort()).toEqual(['driver', 'paramedic']);
  });
});
