/**
 * Proximity utility (UC-005 — Guan Hee)
 *
 * EFAR scores candidates partly on how close they live to the station, and
 * pairs a driver + attendant who live within an acceptable radius of each
 * other (UC-005 main flow steps 6–7).
 *
 * We do not have a geocoding service, so proximity is derived from the
 * Singapore postal system. The first two digits of a 6-digit Singapore postal
 * code identify a "postal sector"; sectors group into 28 postal districts.
 * Each district has a well-known approximate centre (lat/lng). Distance between
 * two postal codes is the great-circle distance between their district centres.
 *
 * This is deliberately dependency-free and deterministic so it is easy to unit
 * test and reason about.
 */

// EFAR operating base — used as the reference point for home→station proximity.
// (Central Singapore; overridable via STATION_POSTAL env var.)
export const STATION_POSTAL = process.env.STATION_POSTAL ?? '169608';

// Driver and attendant are considered "proximity compatible" when their homes
// are within this many kilometres of each other.
export const PAIR_RADIUS_KM = Number(process.env.PAIR_RADIUS_KM ?? 18);

// Distance (km) at or beyond which the home→station proximity score bottoms
// out at 0. Singapore is ~50 km end to end.
const MAX_SCORE_DISTANCE_KM = 25;

/**
 * Maps a Singapore postal sector (first two digits of the postal code) to its
 * postal district (1–28). Source: Singapore postal district reference.
 */
const SECTOR_TO_DISTRICT: Record<string, number> = {
  '01': 1, '02': 1, '03': 1, '04': 1, '05': 1, '06': 1,
  '07': 2, '08': 2,
  '14': 3, '15': 3, '16': 3,
  '09': 4, '10': 4,
  '11': 5, '12': 5, '13': 5,
  '17': 6,
  '18': 7, '19': 7,
  '20': 8, '21': 8,
  '22': 9, '23': 9,
  '24': 10, '25': 10, '26': 10, '27': 10,
  '28': 11, '29': 11, '30': 11,
  '31': 12, '32': 12, '33': 12,
  '34': 13, '35': 13, '36': 13, '37': 13,
  '38': 14, '39': 14, '40': 14, '41': 14,
  '42': 15, '43': 15, '44': 15, '45': 15,
  '46': 16, '47': 16, '48': 16,
  '49': 17, '50': 17, '81': 17,
  '51': 18, '52': 18,
  '53': 19, '54': 19, '55': 19, '82': 19,
  '56': 20, '57': 20,
  '58': 21, '59': 21,
  '60': 22, '61': 22, '62': 22, '63': 22, '64': 22,
  '65': 23, '66': 23, '67': 23, '68': 23,
  '69': 24, '70': 24, '71': 24,
  '72': 25, '73': 25,
  '77': 26, '78': 26,
  '75': 27, '76': 27,
  '79': 28, '80': 28,
};

/**
 * Approximate centre (latitude, longitude) of each Singapore postal district.
 */
const DISTRICT_CENTRE: Record<number, { lat: number; lng: number }> = {
  1: { lat: 1.2830, lng: 103.8510 },
  2: { lat: 1.2760, lng: 103.8450 },
  3: { lat: 1.2870, lng: 103.8300 },
  4: { lat: 1.2680, lng: 103.8250 },
  5: { lat: 1.2900, lng: 103.7850 },
  6: { lat: 1.2900, lng: 103.8500 },
  7: { lat: 1.3010, lng: 103.8570 },
  8: { lat: 1.3110, lng: 103.8580 },
  9: { lat: 1.3060, lng: 103.8380 },
  10: { lat: 1.3130, lng: 103.8090 },
  11: { lat: 1.3220, lng: 103.8370 },
  12: { lat: 1.3280, lng: 103.8560 },
  13: { lat: 1.3340, lng: 103.8850 },
  14: { lat: 1.3180, lng: 103.8950 },
  15: { lat: 1.3050, lng: 103.9050 },
  16: { lat: 1.3230, lng: 103.9350 },
  17: { lat: 1.3560, lng: 103.9820 },
  18: { lat: 1.3520, lng: 103.9430 },
  19: { lat: 1.3690, lng: 103.8750 },
  20: { lat: 1.3620, lng: 103.8390 },
  21: { lat: 1.3400, lng: 103.7770 },
  22: { lat: 1.3320, lng: 103.7420 },
  23: { lat: 1.3800, lng: 103.7620 },
  24: { lat: 1.4020, lng: 103.7060 },
  25: { lat: 1.4340, lng: 103.7860 },
  26: { lat: 1.3860, lng: 103.8250 },
  27: { lat: 1.4290, lng: 103.8350 },
  28: { lat: 1.3900, lng: 103.8720 },
};

// Fallback centre (roughly the geographic middle of Singapore) used when a
// postal code cannot be mapped to a district.
const DEFAULT_CENTRE = { lat: 1.3400, lng: 103.8300 };

/**
 * Extracts the postal district (1–28) from a Singapore postal code.
 * Returns null when the code is missing or unrecognised.
 */
export function postalDistrict(postal: string | null | undefined): number | null {
  if (!postal) return null;
  const digits = postal.replace(/\D/g, '');
  if (digits.length < 2) return null;
  const sector = digits.substring(0, 2);
  return SECTOR_TO_DISTRICT[sector] ?? null;
}

function centreFor(postal: string | null | undefined): { lat: number; lng: number } {
  const district = postalDistrict(postal);
  if (district == null) return DEFAULT_CENTRE;
  return DISTRICT_CENTRE[district] ?? DEFAULT_CENTRE;
}

/**
 * Great-circle distance in kilometres between two postal codes (via their
 * district centres). Returns 0 for two codes in the same district.
 */
export function distanceKm(postalA: string | null | undefined, postalB: string | null | undefined): number {
  const a = centreFor(postalA);
  const b = centreFor(postalB);

  const R = 6371; // Earth radius km
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Proximity score (0–1) for a staff member's home relative to the station.
 * 1.0 = same district as the station, decaying linearly to 0 at
 * MAX_SCORE_DISTANCE_KM. An unknown postal code scores a neutral 0.5.
 */
export function proximityScore(
  homePostal: string | null | undefined,
  referencePostal: string = STATION_POSTAL
): number {
  if (!homePostal || postalDistrict(homePostal) == null) return 0.5;
  const km = distanceKm(homePostal, referencePostal);
  const score = 1 - km / MAX_SCORE_DISTANCE_KM;
  return Math.max(0, Math.min(1, score));
}

/**
 * True when two crew members live within PAIR_RADIUS_KM of each other and can
 * therefore be paired without a proximity flag. Unknown postal codes are
 * treated as compatible (we cannot prove they are far apart).
 */
export function isProximityCompatible(
  postalA: string | null | undefined,
  postalB: string | null | undefined
): boolean {
  if (!postalA || !postalB) return true;
  if (postalDistrict(postalA) == null || postalDistrict(postalB) == null) return true;
  return distanceKm(postalA, postalB) <= PAIR_RADIUS_KM;
}
