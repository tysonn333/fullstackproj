/**
 * Tests for UC-005 Ranking / Scoring & Pairing Engine
 */

import {
  rankCandidates,
  scoreCandidate,
  pairCrew,
  certFitScore,
  WEIGHTS,
  RankedCandidate,
} from '../src/services/scheduling/ranking';
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

const easSlot: ShiftSlot = {
  ...daySlot,
  slot_id: 3,
  service_type: 'EAS',
  crew_position: 'driver',
};

function makeEligibleCandidate(overrides: Partial<FilterResult> = {}): FilterResult {
  return {
    staff_id: 1,
    full_name: 'Alice Tan',
    role: 'medic',
    employment_type: 'full_time',
    home_postal: '310450',
    eligible: true,
    hard_blocked: false,
    consecutive_days_flag: false,
    consecutive_days_count: 0,
    filter_trace: [],
    ...overrides,
  };
}

function makeRanked(overrides: Partial<RankedCandidate> = {}): RankedCandidate {
  return {
    ...makeEligibleCandidate(),
    score: 50,
    score_breakdown: { fairness: 1, rest: 1, proximity: 1, cert_fit: 1, preference: 0.5, continuity: 1 },
    late_shift_count: 0,
    rest_hours: 24,
    proximity_km: 5,
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

  it('returns a 6-component breakdown that reconstructs the total (within rounding)', async () => {
    const result = await scoreCandidate(makeEligibleCandidate(), daySlot, rosterDate, month);
    const b = result.score_breakdown;
    const reconstructed =
      (WEIGHTS.fairness * b.fairness +
        WEIGHTS.rest * b.rest +
        WEIGHTS.proximity * b.proximity +
        WEIGHTS.cert_fit * b.cert_fit +
        WEIGHTS.preference * b.preference +
        WEIGHTS.continuity * b.continuity) *
      100;
    // Each of the 6 breakdown components is rounded to 2 dp independently, so
    // the reconstructed total can drift by up to ~0.5 from the score computed
    // off the raw values.
    expect(Math.abs(result.score - Math.round(reconstructed * 100) / 100)).toBeLessThanOrEqual(0.5);
  });

  it('gives full fairness and rest to a staff with no prior shifts', async () => {
    mockAssignmentRows = [];
    const result = await scoreCandidate(makeEligibleCandidate(), daySlot, rosterDate, month);

    expect(result.rest_hours).toBe(24);
    expect(result.score_breakdown.rest).toBe(1.0);
    expect(result.late_shift_count).toBe(0);
    expect(result.score_breakdown.fairness).toBe(1.0);
  });

  it('reduces fairness score as late shift count increases', async () => {
    const lateShifts = Array.from({ length: 10 }, (_, i) => ({
      shift_slots: {
        start_time: '18:00:00',
        end_time: '06:00:00',
        rosters: { roster_date: `2025-06-${String(i + 1).padStart(2, '0')}` },
      },
    }));

    mockAssignmentRows = lateShifts;
    const result = await scoreCandidate(makeEligibleCandidate(), daySlot, rosterDate, month);

    expect(result.late_shift_count).toBe(10);
    expect(result.score_breakdown.fairness).toBeCloseTo(0.5, 2);
  });

  it('caps rest_hours at 24', async () => {
    mockAssignmentRows = [
      {
        shift_slots: {
          end_time: '06:00:00',
          start_time: '18:00:00',
          rosters: { roster_date: '2025-06-12' },
        },
      },
    ];

    const result = await scoreCandidate(makeEligibleCandidate(), daySlot, rosterDate, month);
    expect(result.rest_hours).toBe(24);
    expect(result.score_breakdown.rest).toBe(1.0);
  });

  it('computes correct rest hours (exactly 12h since last shift)', async () => {
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
    expect(result.score_breakdown.rest).toBeCloseTo(0.5, 2);
  });

  it('scores continuity as 1.0 when no same-day assignments exist', async () => {
    mockAssignmentRows = [];
    const result = await scoreCandidate(makeEligibleCandidate(), daySlot, rosterDate, month);
    expect(result.score_breakdown.continuity).toBe(1.0);
  });

  it('scores continuity as 0.0 when an overlapping same-day assignment exists', async () => {
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

    const result = await scoreCandidate(makeEligibleCandidate(), daySlot, rosterDate, month);
    expect(result.score_breakdown.continuity).toBe(0.0);
  });

  it('uses preference score of 0.5 when no preference table row exists', async () => {
    mockPreferenceRow = null;
    const result = await scoreCandidate(makeEligibleCandidate(), daySlot, rosterDate, month);
    expect(result.score_breakdown.preference).toBe(0.5);
  });

  it('scores proximity higher for a staff living near the station than one far away', async () => {
    const near = await scoreCandidate(
      makeEligibleCandidate({ staff_id: 1, home_postal: '169608' }), // same district as station
      daySlot,
      rosterDate,
      month
    );
    const far = await scoreCandidate(
      makeEligibleCandidate({ staff_id: 2, home_postal: '730000' }), // far NW (Woodlands, district 25)
      daySlot,
      rosterDate,
      month
    );
    expect(near.score_breakdown.proximity).toBeGreaterThan(far.score_breakdown.proximity);
  });

  it('reports proximity_km for the candidate', async () => {
    const result = await scoreCandidate(
      makeEligibleCandidate({ home_postal: '169608' }),
      daySlot,
      rosterDate,
      month
    );
    expect(typeof result.proximity_km).toBe('number');
    expect(result.proximity_km).toBeLessThan(5); // same district as station
  });

  it('assigns a neutral proximity score of 0.5 when home_postal is missing', async () => {
    const result = await scoreCandidate(
      makeEligibleCandidate({ home_postal: null }),
      daySlot,
      rosterDate,
      month
    );
    expect(result.score_breakdown.proximity).toBe(0.5);
  });
});

// ── certFitScore() Tests ──────────────────────────────────────────────────────

describe('certFitScore()', () => {
  it('gives exact-fit medics/EMTs a higher MTS score than over-qualified drivers/paramedics', () => {
    expect(certFitScore('medic', 'MTS')).toBe(1.0);
    expect(certFitScore('emt', 'MTS')).toBe(1.0);
    expect(certFitScore('driver', 'MTS')).toBeLessThan(1.0);
    expect(certFitScore('paramedic', 'MTS')).toBeLessThan(1.0);
  });

  it('gives every EAS-capable role a full cert-fit score on EAS slots', () => {
    expect(certFitScore('driver', 'EAS')).toBe(1.0);
    expect(certFitScore('paramedic', 'EAS')).toBe(1.0);
  });

  it('makes an exact-fit medic outrank an over-qualified paramedic on an MTS slot (all else equal)', async () => {
    mockAssignmentRows = [];
    mockPreferenceRow = null;
    const candidates: FilterResult[] = [
      makeEligibleCandidate({ staff_id: 1, role: 'paramedic', home_postal: '310450' }),
      makeEligibleCandidate({ staff_id: 2, role: 'medic', home_postal: '310450' }),
    ];
    const ranked = await rankCandidates(candidates, daySlot, rosterDate);
    expect(ranked[0].staff_id).toBe(2); // medic (exact fit) ranks first
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

  it('breaks ties by staff_id ascending when all else is equal', async () => {
    mockAssignmentRows = [];

    const candidates: FilterResult[] = [
      makeEligibleCandidate({ staff_id: 3, full_name: 'Charlie', home_postal: '310450' }),
      makeEligibleCandidate({ staff_id: 1, full_name: 'Alice', home_postal: '310450' }),
      makeEligibleCandidate({ staff_id: 2, full_name: 'Bob', home_postal: '310450' }),
    ];

    const result = await rankCandidates(candidates, daySlot, rosterDate);
    expect(result.map((r) => r.staff_id)).toEqual([1, 2, 3]);
  });

  it('each ranked candidate includes score and a 6-component breakdown', async () => {
    const candidates = [makeEligibleCandidate({ staff_id: 1 })];
    const result = await rankCandidates(candidates, daySlot, rosterDate);

    expect(result[0]).toHaveProperty('score');
    expect(result[0].score_breakdown).toHaveProperty('fairness');
    expect(result[0].score_breakdown).toHaveProperty('rest');
    expect(result[0].score_breakdown).toHaveProperty('proximity');
    expect(result[0].score_breakdown).toHaveProperty('cert_fit');
    expect(result[0].score_breakdown).toHaveProperty('preference');
    expect(result[0].score_breakdown).toHaveProperty('continuity');
  });

  it('includes late_shift_count, rest_hours and proximity_km in the ranked result', async () => {
    const candidates = [makeEligibleCandidate({ staff_id: 1 })];
    const result = await rankCandidates(candidates, daySlot, rosterDate);

    expect(typeof result[0].late_shift_count).toBe('number');
    expect(typeof result[0].rest_hours).toBe('number');
    expect(typeof result[0].proximity_km).toBe('number');
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
    const ranked = result[0];

    expect(ranked.staff_id).toBe(42);
    expect(ranked.full_name).toBe('Test User');
    expect(ranked.role).toBe('paramedic');
    expect(ranked.consecutive_days_flag).toBe(true);
    expect(ranked.consecutive_days_count).toBe(7);
  });

  it('night slot is handled without error', async () => {
    const candidates = [makeEligibleCandidate({ staff_id: 1 })];
    const result = await rankCandidates(candidates, nightSlot, rosterDate);
    expect(result).toHaveLength(1);
    expect(result[0].score).toBeGreaterThanOrEqual(0);
  });
});

// ── pairCrew() Tests ──────────────────────────────────────────────────────────

describe('pairCrew()', () => {
  it('pairs the top-ranked driver and attendant when they are proximity compatible', () => {
    const drivers = [makeRanked({ staff_id: 10, role: 'driver', score: 90, home_postal: '310450' })];
    const attendants = [makeRanked({ staff_id: 1, role: 'medic', score: 80, home_postal: '310123' })];

    const pair = pairCrew(drivers, attendants);
    expect(pair.driver?.staff_id).toBe(10);
    expect(pair.attendant?.staff_id).toBe(1);
    expect(pair.proximity_flag).toBe(false);
    expect(pair.pair_score).toBe(170);
  });

  it('skips to the next attendant when the top pair is not proximity compatible', () => {
    const drivers = [makeRanked({ staff_id: 10, role: 'driver', score: 90, home_postal: '640210' })]; // Jurong (district 22, west)
    const attendants = [
      makeRanked({ staff_id: 1, role: 'medic', score: 80, home_postal: '509000' }), // Changi (district 17, far east) — incompatible
      makeRanked({ staff_id: 2, role: 'medic', score: 70, home_postal: '640455' }), // Jurong (same district) — compatible
    ];

    const pair = pairCrew(drivers, attendants);
    expect(pair.driver?.staff_id).toBe(10);
    expect(pair.attendant?.staff_id).toBe(2);
    expect(pair.proximity_flag).toBe(false);
  });

  it('falls back to the best-scoring pair and flags it when nothing is compatible', () => {
    const drivers = [makeRanked({ staff_id: 10, role: 'driver', score: 90, home_postal: '640210' })]; // Jurong (west)
    const attendants = [
      makeRanked({ staff_id: 1, role: 'medic', score: 80, home_postal: '509000' }), // Changi (far east)
      makeRanked({ staff_id: 2, role: 'medic', score: 60, home_postal: '508000' }), // Changi (far east)
    ];

    const pair = pairCrew(drivers, attendants);
    expect(pair.proximity_flag).toBe(true);
    expect(pair.driver?.staff_id).toBe(10);
    expect(pair.attendant?.staff_id).toBe(1); // higher combined score
  });

  it('returns a null driver and a note when the driver pool is empty', () => {
    const attendants = [makeRanked({ staff_id: 1, role: 'medic', score: 80 })];
    const pair = pairCrew([], attendants);
    expect(pair.driver).toBeNull();
    expect(pair.attendant?.staff_id).toBe(1);
    expect(pair.note).toContain('driver');
  });

  it('returns a null attendant and a note when the attendant pool is empty', () => {
    const drivers = [makeRanked({ staff_id: 10, role: 'driver', score: 90 })];
    const pair = pairCrew(drivers, []);
    expect(pair.attendant).toBeNull();
    expect(pair.driver?.staff_id).toBe(10);
    expect(pair.note).toContain('attendant');
  });

  it('returns both null when both pools are empty', () => {
    const pair = pairCrew([], []);
    expect(pair.driver).toBeNull();
    expect(pair.attendant).toBeNull();
    expect(pair.pair_score).toBe(0);
  });

  it('treats unknown postal codes as compatible', () => {
    const drivers = [makeRanked({ staff_id: 10, role: 'driver', score: 90, home_postal: null })];
    const attendants = [makeRanked({ staff_id: 1, role: 'medic', score: 80, home_postal: null })];
    const pair = pairCrew(drivers, attendants);
    expect(pair.proximity_flag).toBe(false);
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
      employment_type: 'full_time',
      home_postal: null,
      eligible: true,
      hard_blocked: false,
      consecutive_days_flag: false,
      consecutive_days_count: 0,
      filter_trace: [],
    };

    await expect(scoreCandidate(candidate, easSlot, rosterDate, month)).resolves.toBeDefined();
  });

  it('scores are deterministic for the same inputs', async () => {
    const candidate = makeEligibleCandidate({ staff_id: 1 });

    const result1 = await scoreCandidate(candidate, daySlot, rosterDate, month);
    const result2 = await scoreCandidate(candidate, daySlot, rosterDate, month);

    expect(result1.score).toBe(result2.score);
  });
});
