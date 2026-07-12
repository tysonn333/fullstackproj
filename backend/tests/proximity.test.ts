/**
 * Tests for the UC-005 proximity utility (Singapore postal-district distance).
 */

import {
  postalDistrict,
  distanceKm,
  proximityScore,
  isProximityCompatible,
  PAIR_RADIUS_KM,
} from '../src/services/scheduling/proximity';

describe('postalDistrict()', () => {
  it('maps the first two digits to the correct postal district', () => {
    expect(postalDistrict('018989')).toBe(1); // sector 01 → district 1
    expect(postalDistrict('310450')).toBe(12); // sector 31 → district 12
    expect(postalDistrict('640210')).toBe(22); // sector 64 → district 22 (Jurong)
    expect(postalDistrict('509000')).toBe(17); // sector 50 → district 17 (Changi)
  });

  it('returns null for missing or unrecognisable codes', () => {
    expect(postalDistrict(null)).toBeNull();
    expect(postalDistrict(undefined)).toBeNull();
    expect(postalDistrict('')).toBeNull();
    expect(postalDistrict('9')).toBeNull();
  });

  it('ignores non-digit characters', () => {
    expect(postalDistrict('S31 0450')).toBe(12);
  });
});

describe('distanceKm()', () => {
  it('is 0 for two codes in the same district', () => {
    expect(distanceKm('640210', '640455')).toBe(0);
  });

  it('is symmetric', () => {
    const a = distanceKm('018989', '509000');
    const b = distanceKm('509000', '018989');
    expect(a).toBeCloseTo(b, 6);
  });

  it('reports a large distance between the west (Jurong) and far east (Changi)', () => {
    expect(distanceKm('640210', '509000')).toBeGreaterThan(PAIR_RADIUS_KM);
  });
});

describe('proximityScore()', () => {
  it('gives a full score to a home in the station district', () => {
    expect(proximityScore('169608', '169608')).toBe(1);
  });

  it('decreases as the home gets farther from the station', () => {
    const near = proximityScore('169608', '169608');
    const far = proximityScore('730000', '169608');
    expect(near).toBeGreaterThan(far);
  });

  it('returns a neutral 0.5 for an unknown postal code', () => {
    expect(proximityScore(null)).toBe(0.5);
    expect(proximityScore('')).toBe(0.5);
  });

  it('never returns a value outside 0–1', () => {
    const s = proximityScore('730000', '169608');
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });
});

describe('isProximityCompatible()', () => {
  it('returns true for two homes in the same district', () => {
    expect(isProximityCompatible('640210', '640455')).toBe(true);
  });

  it('returns false for homes on opposite ends of the island', () => {
    expect(isProximityCompatible('640210', '509000')).toBe(false);
  });

  it('treats unknown postal codes as compatible', () => {
    expect(isProximityCompatible(null, '640210')).toBe(true);
    expect(isProximityCompatible('640210', undefined)).toBe(true);
  });
});
