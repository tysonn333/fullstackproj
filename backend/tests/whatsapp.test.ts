/**
 * Tests for the WhatsApp availability parser (UC-003 part-timer flow — Chad).
 */

import { parseWhatsAppMessage, formatWhatsAppResponse } from '../src/integrations/whatsapp';

describe('parseWhatsAppMessage()', () => {
  it('parses a full-day availability message with an ISO date', () => {
    const result = parseWhatsAppMessage('Available 2026-07-15');
    expect(result).toEqual({ is_available: true, half_day: null, date: '2026-07-15' });
  });

  it('parses a DD/MM/YYYY date', () => {
    const result = parseWhatsAppMessage('available 15/07/2026');
    expect(result?.date).toBe('2026-07-15');
  });

  it('parses a "15 Jul 2026"-style date', () => {
    const result = parseWhatsAppMessage('available 15 July 2026');
    expect(result?.date).toBe('2026-07-15');
  });

  it('parses "not available" as a full-day block', () => {
    const result = parseWhatsAppMessage('not available 2026-07-15');
    expect(result?.is_available).toBe(false);
    expect(result?.half_day).toBeNull();
  });

  it('parses MC as unavailable', () => {
    const result = parseWhatsAppMessage('on mc today 2026-07-15');
    expect(result?.is_available).toBe(false);
  });

  it('parses AM-only availability', () => {
    const result = parseWhatsAppMessage('available am 2026-07-15');
    expect(result).toEqual({ is_available: true, half_day: 'am', date: '2026-07-15' });
  });

  it('parses PM-only availability', () => {
    const result = parseWhatsAppMessage('pm only 2026-07-15');
    expect(result).toEqual({ is_available: true, half_day: 'pm', date: '2026-07-15' });
  });

  it('parses shorthand "am"', () => {
    const result = parseWhatsAppMessage('am 2026-07-15');
    expect(result?.half_day).toBe('am');
    expect(result?.is_available).toBe(true);
  });

  it('returns null for an uninterpretable message', () => {
    expect(parseWhatsAppMessage('hello how are you')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(parseWhatsAppMessage('')).toBeNull();
  });

  it('leaves date undefined when the message has no date', () => {
    const result = parseWhatsAppMessage('available');
    expect(result?.is_available).toBe(true);
    expect(result?.date).toBeUndefined();
  });
});

describe('formatWhatsAppResponse()', () => {
  it('confirms full-day availability', () => {
    const msg = formatWhatsAppResponse('Siti', '2026-07-15', true, null);
    expect(msg).toContain('Siti');
    expect(msg).toContain('2026-07-15');
    expect(msg).toContain('available');
  });

  it('mentions the half-day window', () => {
    const msg = formatWhatsAppResponse('Siti', '2026-07-15', true, 'am');
    expect(msg).toContain('AM only');
  });
});
