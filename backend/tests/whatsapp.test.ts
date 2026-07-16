/**
 * Tests for the WhatsApp availability parser (UC-003 part-timer flow — Chad).
 */

import {
  parseWhatsAppMessage,
  formatWhatsAppResponse,
  extractTimeWindow,
  WHATSAPP_HELP_MESSAGE,
} from '../src/integrations/whatsapp';

// Fixed reference date so "today"/"tomorrow" are deterministic.
const REF = '2026-07-16';

describe('parseWhatsAppMessage() — basics', () => {
  it('parses a full-day availability message with an ISO date', () => {
    const result = parseWhatsAppMessage('Available 2026-07-15');
    expect(result).toMatchObject({ is_available: true, half_day: null, date: '2026-07-15' });
    expect(result?.dates).toEqual(['2026-07-15']);
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
    expect(result).toMatchObject({ is_available: true, half_day: 'am', date: '2026-07-15' });
  });

  it('parses PM-only availability', () => {
    const result = parseWhatsAppMessage('pm only 2026-07-15');
    expect(result).toMatchObject({ is_available: true, half_day: 'pm', date: '2026-07-15' });
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

describe('parseWhatsAppMessage() — relative dates', () => {
  it('resolves "today" against the reference date', () => {
    const result = parseWhatsAppMessage('available today', REF);
    expect(result?.date).toBe(REF);
  });

  it('resolves "tomorrow" against the reference date', () => {
    const result = parseWhatsAppMessage('available tomorrow', REF);
    expect(result?.date).toBe('2026-07-17');
  });

  it('resolves the "tmr" shorthand', () => {
    const result = parseWhatsAppMessage('free tmr', REF);
    expect(result?.date).toBe('2026-07-17');
    expect(result?.is_available).toBe(true);
  });

  it('resolves "tonight" to the reference date', () => {
    const result = parseWhatsAppMessage('not free tonight — family dinner', REF);
    expect(result?.is_available).toBe(false);
    expect(result?.date).toBe(REF);
  });

  it('rolls "tomorrow" across a month boundary', () => {
    const result = parseWhatsAppMessage('available tomorrow', '2026-07-31');
    expect(result?.date).toBe('2026-08-01');
  });
});

describe('parseWhatsAppMessage() — date ranges & multi-day', () => {
  it('expands "X to Y" into every day in the range', () => {
    const result = parseWhatsAppMessage('available 2026-07-20 to 2026-07-22', REF);
    expect(result?.dates).toEqual(['2026-07-20', '2026-07-21', '2026-07-22']);
    expect(result?.date).toBe('2026-07-20');
  });

  it('expands a DD/MM/YYYY range', () => {
    const result = parseWhatsAppMessage('available 20/07/2026 - 22/07/2026', REF);
    expect(result?.dates).toEqual(['2026-07-20', '2026-07-21', '2026-07-22']);
  });

  it('treats "today and tomorrow" as two separate days', () => {
    const result = parseWhatsAppMessage('available today and tomorrow', REF);
    expect(result?.dates).toEqual(['2026-07-16', '2026-07-17']);
  });

  it('keeps two dates NOT joined by a range word as a list, not a range', () => {
    const result = parseWhatsAppMessage('available 2026-07-20 and 2026-07-25', REF);
    expect(result?.dates).toEqual(['2026-07-20', '2026-07-25']);
  });

  it('caps a runaway range instead of expanding years of days', () => {
    const result = parseWhatsAppMessage('available 2026-01-01 to 2030-01-01', REF);
    expect(result?.dates?.length).toBeLessThanOrEqual(31);
  });

  it('applies unavailability to the whole range', () => {
    const result = parseWhatsAppMessage('not available 2026-07-20 to 2026-07-21, overseas', REF);
    expect(result?.is_available).toBe(false);
    expect(result?.dates).toEqual(['2026-07-20', '2026-07-21']);
  });
});

describe('parseWhatsAppMessage() — time windows', () => {
  it('parses "1pm-7pm" into a 13:00–19:00 window', () => {
    const result = parseWhatsAppMessage('available 1pm-7pm tomorrow', REF);
    expect(result?.is_available).toBe(true);
    expect(result?.start_time).toBe('13:00');
    expect(result?.end_time).toBe('19:00');
    expect(result?.half_day).toBeNull();
    expect(result?.date).toBe('2026-07-17');
  });

  it('parses "1-7pm" — the start hour inherits the end meridiem', () => {
    const result = parseWhatsAppMessage('free 1-7pm tmr', REF);
    expect(result?.start_time).toBe('13:00');
    expect(result?.end_time).toBe('19:00');
  });

  it('parses a 24-hour window "13:00-19:00"', () => {
    const result = parseWhatsAppMessage('available 13:00-19:00 2026-07-20', REF);
    expect(result?.start_time).toBe('13:00');
    expect(result?.end_time).toBe('19:00');
    expect(result?.date).toBe('2026-07-20');
  });

  it('parses "from 8pm onwards" as 20:00 to end of day', () => {
    const result = parseWhatsAppMessage('free from 8pm onwards tomorrow', REF);
    expect(result?.start_time).toBe('20:00');
    expect(result?.end_time).toBe('23:59');
  });

  it('parses "until 3pm" as start-of-day to 15:00', () => {
    const result = parseWhatsAppMessage('available until 3pm today', REF);
    expect(result?.start_time).toBe('00:00');
    expect(result?.end_time).toBe('15:00');
  });

  it('parses minutes, e.g. "9.30am to 2pm"', () => {
    const result = parseWhatsAppMessage('can work 9.30am to 2pm tmr', REF);
    expect(result?.start_time).toBe('09:30');
    expect(result?.end_time).toBe('14:00');
  });

  it('never misreads a date range as a time window', () => {
    const result = parseWhatsAppMessage('available 20/07/2026 to 22/07/2026', REF);
    expect(result?.start_time).toBeUndefined();
    expect(result?.dates).toHaveLength(3);
  });

  it('handles 12am/12pm correctly', () => {
    const result = parseWhatsAppMessage('free 12pm-11pm today', REF);
    expect(result?.start_time).toBe('12:00');
    expect(result?.end_time).toBe('23:00');
  });
});

describe('extractTimeWindow()', () => {
  it('rejects an inverted window', () => {
    expect(extractTimeWindow('7pm-1pm')).toBeNull();
  });

  it('rejects invalid hours', () => {
    expect(extractTimeWindow('26:00-27:00')).toBeNull();
  });

  it('returns null when no time is present', () => {
    expect(extractTimeWindow('available all day')).toBeNull();
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

  it('mentions the time window when one was given', () => {
    const msg = formatWhatsAppResponse('Siti', '2026-07-15', true, null, {
      start: '13:00',
      end: '19:00',
    });
    expect(msg).toContain('from 13:00 to 19:00');
  });

  it('summarises a multi-day range', () => {
    const msg = formatWhatsAppResponse(
      'Siti',
      ['2026-07-20', '2026-07-21', '2026-07-22'],
      true,
      null
    );
    expect(msg).toContain('2026-07-20 to 2026-07-22');
    expect(msg).toContain('3 days');
  });

  it('lists exactly two days with "and"', () => {
    const msg = formatWhatsAppResponse('Siti', ['2026-07-20', '2026-07-25'], false, null);
    expect(msg).toContain('2026-07-20 and 2026-07-25');
    expect(msg).toContain('unavailable');
  });
});

describe('WHATSAPP_HELP_MESSAGE', () => {
  it('teaches the supported formats', () => {
    expect(WHATSAPP_HELP_MESSAGE).toContain('available tomorrow');
    expect(WHATSAPP_HELP_MESSAGE).toContain('1pm-7pm');
    expect(WHATSAPP_HELP_MESSAGE).toContain('on mc');
  });
});
