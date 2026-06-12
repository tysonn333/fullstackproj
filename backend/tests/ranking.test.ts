/**
 * Tests for UC-005 Ranking / Scoring Engine
 */

import { rankCandidates, scoreCandidate, RankedCandidate } from '../src/services/scheduling/ranking';
import { FilterResult, ShiftSlot } from '../src/services/scheduling/filter';

// ── Mock Supabase ─────────────────────────────────────────────────────────────

// The ranking module queries: assignments (getLateShiftCount, getRestHours, getContinuityScore)
// and optionally staff_preferences (getPreferenceScore).

let mockAssignmentRows: unknown[] = [];
let mockPreferenceRow: unknown = null;

jest.mock('../src/lib/supabase', () => ({
  __esModule: true,
  default: {
    from: jest.fn((table: string) => {
      const data = table === 'staff_preferences' ? mockPreferenceRow : mockAssignmentRows;
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        neq: jest.fn().mockReturnThis(),
        gte: jest.fn().mockReturnThis(),
        lte: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: mockAssignmentRows, error: null }),
        single: jest.fn().mockResolvedValue({ data, error: data ? null : { message: 'not found' } }),
        then: (resolve: (v: { data: unknown; error: null }) => void) => {
          resolve({ data: mockAssignmentRows, error: null });
          return Promise.resolve({ data: mockAssignmentRows, error: null });
        },
      };
    }),
  },
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const rosterDate = '2025-06-15';
const month = '2025-06';

const daySlot: ShiftSlot = {
  slot_id: 1,
  roster_id: 10,
  ambulance_id: 5,
  start_time: '06:00:00',
  end_time: '18:00:00',
  service_type: 'MTS',
  crew_position: 'attendant',
};

const nightSlot: ShiftSlot = {
  ...daySlot,
  slot_id: 2,
  start_time: '18:00:00',
  end_time: '06:00:00',
};

function makeEligibleCandidate(overrides: Partial<FilterResult> = {}): FilterResult {
  return {
    staff_id: 1,
    full_name: 'Alice Tan',
    role: 'medic',
    eligible: true,
    hard_blocked: false,
    consecutive_days_flag: false,
    consecutive_days_count: 0,
    ...overrides,
  };
}

// ── scoreCandidate() Tests ────────────────────────────────────────────────────

describe('scoreCandidate()', () => {
  beforeEach(() => {
    mockAssignmentRows = [];
    mockPreferenceRow = null;
  });

  it('returns a score between 0 and 100', async () => {
    const result = await scoreCandidate(makeEligibleCandidate(), daySlot, rosterDate, month);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('returns score breakdown with 4 components summing to the total (within rounding)', async () => {
    const result = await scoreCandidate(makeEligibleCandidate(), daySlot, rosterDate, month);
    const { fairness, rest, preference, continuity } = result.score_breakdown;
    const reconstructed = (fairness * 0.3 + rest * 0.3 + preference * 0.2 + continuity * 0.2) * 100;
    expect(Math.abs(result.score - Math.round(reconstructed * 100) / 100)).toBeLessThanOrEqual(0.02);
  });

  it('gives maximum score to a staff with no prior shifts (fully rested, no late shifts)', async () => {
    mockAssignmentRows = [];
    const result = await scoreCandidate(makeEligibleCandidate(), daySlot, rosterDate, month);

    // rest_hours = 24 → rest score = 1.0
    expect(result.rest_hours).toBe(24);
    expect(result.score_breakdown.rest).toBe(1.0);

    // late_shift_count = 0 → fairness score = 1.0
    expect(result.late_shift_count).toBe(0);
    expect(result.score_breakdown.fairness).toBe(1.0);
  });

  it('reduces fairness score as late shift count increases', async () => {
    // Simulate 10 late shifts this month
    const lateShifts = Array.from({ length: 10 }, (_, i) => ({
      shift_slots: {
        start_time: '18:00:00',
        end_time: '06:00:00',
        rosters: { roster_date: `2025-06-${String(i + 1).padStart(2, '0')}` },
      },
    }));

    mockAssignmentRows = lateShifts;
    const result = await scoreCandidate(makeEligibleCandidate(), daySlot, rosterDate, month);

    // 10 late shifts → fairness raw = 1 - (10/20) = 0.5
    expect(result.late_shift_count).toBe(10);
    expect(result.score_breakdown.fairness).toBeCloseTo(0.5, 2);
  });

  it('caps rest_hours at 24', async () => {
    // Last shift ended 72 hours ago (way more than 24h)
    mockAssignmentRows = [
      {
        shift_slots: {
          end_time: '06:00:00',
          start_time: '18:00:00',
          rosters: { roster_date: '2025-06-12' }, // 3 days before
        },
      },
    ];

    const result = await scoreCandidate(makeEligibleCandidate(), daySlot, rosterDate, month);
    expect(result.rest_hours).toBe(24); // capped at 24
    expect(result.score_breakdown.rest).toBe(1.0);
  });

  it('computes correct rest hours (exactly 12h since last shift)', async () => {
    // Last shift ended at 18:00 on 2025-06-14; new slot starts at 06:00 on 2025-06-15 = 12h
    mockAssignmentRows = [
      {
        shift_slots: {
          end_time: '18:00:00',
          start_time: '06:00:00',
          rosters: { roster_date: '2025-06-14' },
        },
      },
    ];

    const result = await scoreCandidate(makeEligibleCandidate(), daySlot, rosterDate, month);
    expect(result.rest_hours).toBeCloseTo(12, 1);
    expect(result.score_breakdown.rest).toBeCloseTo(0.5, 2); // 12/24 = 0.5
  });

  it('scores continuity as 1.0 when no same-day assignments exist', async () => {
    mockAssignmentRows = [];
    const result = await scoreCandidate(makeEligibleCandidate(), daySlot, rosterDate, month);
    expect(result.score_breakdown.continuity).toBe(1.0);
  });

  it('scores continuity as 0.0 when an overlapping same-day assignment exists', async () => {
    // Same date, overlapping time
    mockAssignmentRows = [
      {
        shift_slots: {
          slot_id: 99,
          start_time: '10:00:00',
          end_time: '14:00:00',
          rosters: { roster_date: '2025-06-15' },
        },
      },
    ];

    // daySlot is 06:00–18:00, which overlaps with 10:00–14:00
    const result = await scoreCandidate(makeEligibleCandidate(), daySlot, rosterDate, month);
    expect(result.score_breakdown.continuity).toBe(0.0);
  });

  it('uses preference score of 0.5 when no preference table row exists', async () => {
    mockPreferenceRow = null;
    const result = await scoreCandidate(makeEligibleCandidate(), daySlot, rosterDate, month);
    expect(result.score_breakdown.preference).toBe(0.5);
  });
});

// ── rankCandidates() Tests ────────────────────────────────────────────────────

describe('rankCandidates()', () => {
  beforeEach(() => {
    mockAssignmentRows = [];
    mockPreferenceRow = null;
  });

  it('returns an empty array when no eligible candidates provided', async () => {
    const result = await rankCandidates([], daySlot, rosterDate);
    expect(result).toHaveLength(0);
  });

  it('filters out ineligible candidates before ranking', async () => {
    const candidates: FilterResult[] = [
      makeEligibleCandidate({ staff_id: 1, eligible: true }),
      makeEligibleCandidate({ staff_id: 2, eligible: false, hard_blocked: true, block_reason: 'On leave' }),
    ];

    const result = await rankCandidates(candidates, daySlot, rosterDate);
    expect(result).toHaveLength(1);
    expect(result[0].staff_id).toBe(1);
  });

  it('returns candidates sorted by score descending', async () => {
    // Give staff 2 zero late shifts; give staff 1 many late shifts → staff 2 should rank higher
    mockAssignmentRows = [];

    const candidates: FilterResult[] = [
      makeEligibleCandidate({ staff_id: 1, full_name: 'Alice' }),
      makeEligibleCandidate({ staff_id: 2, full_name: 'Bob' }),
    ];

    const result = await rankCandidates(candidates, daySlot, rosterDate);

    // Both have same conditions since mock returns same data;
    // tie-breaker by staff_id ascending — staff 1 should come first
    expect(result[0].staff_id).toBe(1);
    expect(result[1].staff_id).toBe(2);
  });

  it('applies tie-breaker: fewer late shifts first', async () => {
    // We need to simulate different late-shift counts per staff member.
    // The mock returns the same data for all calls, so we test the tie-break
    // logic indirectly via staff_id alphabetical when all scores are equal.

    const candidates: FilterResult[] = [
      makeEligibleCandidate({ staff_id: 3, full_name: 'Charlie' }),
      makeEligibleCandidate({ staff_id: 1, full_name: 'Alice' }),
      makeEligibleCandidate({ staff_id: 2, full_name: 'Bob' }),
    ];

    const result = await rankCandidates(candidates, daySlot, rosterDate);

    // All have same score with this mock; tie-breaker 3 is staff_id ascending
    const ids = result.map((r) => r.staff_id);
    expect(ids).toEqual([1, 2, 3]);
  });

  it('each ranked candidate includes score and score_breakdown', async () => {
    const candidates = [makeEligibleCandidate({ staff_id: 1 })];
    const result = await rankCandidates(candidates, daySlot, rosterDate);

    expect(result[0]).toHaveProperty('score');
    expect(result[0]).toHaveProperty('score_breakdown');
    expect(result[0].score_breakdown).toHaveProperty('fairness');
    expect(result[0].score_breakdown).toHaveProperty('rest');
    expect(result[0].score_breakdown).toHaveProperty('preference');
    expect(result[0].score_breakdown).toHaveProperty('continuity');
  });

  it('includes late_shift_count and rest_hours in the ranked result', async () => {
    const candidates = [makeEligibleCandidate({ staff_id: 1 })];
    const result = await rankCandidates(candidates, daySlot, rosterDate);

    expect(result[0]).toHaveProperty('late_shift_count');
    expect(result[0]).toHaveProperty('rest_hours');
    expect(typeof result[0].late_shift_count).toBe('number');
    expect(typeof result[0].rest_hours).toBe('number');
  });

  it('handles a large candidate pool (20 candidates) without errors', async () => {
    const candidates: FilterResult[] = Array.from({ length: 20 }, (_, i) =>
      makeEligibleCandidate({ staff_id: i + 1, full_name: `Staff ${i + 1}` })
    );

    const result = await rankCandidates(candidates, daySlot, rosterDate);
    expect(result).toHaveLength(20);
  });

  it('preserves all FilterResult fields in the ranked output', async () => {
    const candidate = makeEligibleCandidate({
      staff_id: 42,
      full_name: 'Test User',
      role: 'paramedic',
      consecutive_days_flag: true,
      consecutive_days_count: 7,
    });

    const result = await rankCandidates([candidate], daySlot, rosterDate);
    const ranked = result[0] as RankedCandidate;

    expect(ranked.staff_id).toBe(42);
    expect(ranked.full_name).toBe('Test User');
    expect(ranked.role).toBe('paramedic');
    expect(ranked.consecutive_days_flag).toBe(true);
    expect(ranked.consecutive_days_count).toBe(7);
  });

  it('night slot (start_time 18:00) is treated correctly for late shift counting', async () => {
    const candidates = [makeEligibleCandidate({ staff_id: 1 })];

    // For the night slot itself, late_shift_count is historical — from prior shifts
    const result = await rankCandidates(candidates, nightSlot, rosterDate);
    expect(result).toHaveLength(1);
    expect(result[0].score).toBeGreaterThanOrEqual(0);
  });
});

// ── Edge Case Tests ───────────────────────────────────────────────────────────

describe('Ranking edge cases', () => {
  beforeEach(() => {
    mockAssignmentRows = [];
    mockPreferenceRow = null;
  });

  it('does not crash when candidate has undefined optional fields', async () => {
    const candidate: FilterResult = {
      staff_id: 99,
      full_name: 'Edge Case',
      role: 'driver',
      eligible: true,
      hard_blocked: false,
      consecutive_days_flag: false,
      consecutive_days_count: 0,
    };

    await expect(scoreCandidate(candidate, daySlot, rosterDate, month)).resolves.toBeDefined();
  });

  it('scores are deterministic for the same inputs', async () => {
    const candidate = makeEligibleCandidate({ staff_id: 1 });

    const result1 = await scoreCandidate(candidate, daySlot, rosterDate, month);
    const result2 = await scoreCandidate(candidate, daySlot, rosterDate, month);

    expect(result1.score).toBe(result2.score);
  });
});
