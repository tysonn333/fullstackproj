import apiClient from './client';
import type { StaffRole } from '../types';

// ─── UC-004 Filter + UC-005 Ranking transparency types ─────────────────────────
// These mirror the backend FilterResult / RankedCandidate shapes exactly so the
// Engine Decision inspector can explain WHY every candidate was ranked or removed.

export type FilterName =
  | 'availability'
  | 'rest_hours'
  | 'daily_hours'
  | 'consecutive_days'
  | 'certification';

export interface FilterStep {
  filter: FilterName;
  passed: boolean;
  /** Soft filters (consecutive_days) flag without hard-blocking. */
  soft?: boolean;
  detail: string;
}

export interface EngineCandidate {
  staff_id: number;
  full_name: string;
  role: StaffRole;
  employment_type: 'full_time' | 'part_time';
  home_postal: string | null;
  eligible: boolean;
  hard_blocked: boolean;
  block_reason?: string;
  consecutive_days_flag: boolean;
  consecutive_days_count: number;
  filter_trace: FilterStep[];
}

export interface ScoreBreakdown {
  fairness: number;
  rest: number;
  proximity: number;
  cert_fit: number;
  preference: number;
  continuity: number;
}

export interface RankedEngineCandidate extends EngineCandidate {
  score: number;
  score_breakdown: ScoreBreakdown;
  late_shift_count: number;
  rest_hours: number;
  /** null when the staff member's postal code is missing/unmappable. */
  proximity_km: number | null;
}

export interface EngineDecision {
  slot_id: number;
  roster_date: string;
  ranked: RankedEngineCandidate[];
  excluded: EngineCandidate[];
  total_considered: number;
}

// ─── Score weights (UC-005 §8.3) — drives the breakdown bars & footer note ──────
export const SCORE_WEIGHTS: { key: keyof ScoreBreakdown; label: string; weight: number }[] = [
  { key: 'fairness', label: 'Fairness', weight: 0.25 },
  { key: 'rest', label: 'Rest', weight: 0.2 },
  { key: 'proximity', label: 'Proximity', weight: 0.2 },
  { key: 'cert_fit', label: 'Cert Fit', weight: 0.15 },
  { key: 'preference', label: 'Preference', weight: 0.1 },
  { key: 'continuity', label: 'Continuity', weight: 0.1 },
];

// ─── Filter labels — the UC-004 pipeline, in strict order ───────────────────────
export const FILTER_LABELS: Record<FilterName, string> = {
  availability: 'Availability',
  rest_hours: '12h Rest',
  daily_hours: '12h Daily Cap',
  consecutive_days: 'Consecutive Days',
  certification: 'Certification',
};

// ─── Raw response shapes ────────────────────────────────────────────────────────

interface EligibleResponse {
  slot_id: number;
  roster_date: string;
  total: number;
  eligible_count: number;
  results: EngineCandidate[];
}

interface RankedResponse {
  slot_id: number;
  roster_date: string;
  ranked_candidates: RankedEngineCandidate[];
}

// ─── API ────────────────────────────────────────────────────────────────────────

export const engineApi = {
  /**
   * Fetches the full UC-004 filter + UC-005 ranking decision for a slot in one
   * call: the ranked eligible pool AND every candidate the filters removed
   * (with their filter_trace), so the inspector can show both sides.
   */
  getDecision: async (slotId: string): Promise<EngineDecision> => {
    const [eligibleRes, rankedRes] = await Promise.all([
      apiClient.get<EligibleResponse>(`/api/v1/slots/${slotId}/eligible`),
      apiClient.get<RankedResponse>(`/api/v1/slots/${slotId}/ranked`),
    ]);

    const eligible = eligibleRes.data;
    const ranked = rankedRes.data;

    return {
      slot_id: eligible.slot_id,
      roster_date: eligible.roster_date,
      ranked: ranked.ranked_candidates ?? [],
      excluded: (eligible.results ?? []).filter((r) => !r.eligible),
      total_considered: eligible.total,
    };
  },

  /** Assigns a specific staff member to a slot (admin only). */
  assign: async (slotId: string, staffId: number): Promise<void> => {
    await apiClient.post(`/api/v1/slots/${slotId}/assign`, { staff_id: staffId });
  },
};
