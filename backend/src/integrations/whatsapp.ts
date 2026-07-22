/**
 * WhatsApp Integration (UC-003 A2 — part-timer availability, Chad)
 *
 * Parses incoming WhatsApp messages to extract availability intent.
 *
 * Supported message patterns (case-insensitive):
 *   "available [date]"                       — full-day available
 *   "not available [date]" / "unavailable"   — full-day block
 *   "am [date]" / "available am [date]"      — AM half only
 *   "pm [date]" / "available pm [date]"      — PM half only
 *   "mc [date]" / "on mc [date]"             — unavailable (medical)
 *   "leave [date]"                           — unavailable
 *   "available today" / "tomorrow" / "tmr"   — relative dates
 *   "available 20/07/2026 to 22/07/2026"     — date range (expanded per day)
 *   "available 1pm-7pm tomorrow"             — time window → start/end times
 *   "free from 8pm onwards" / "until 3pm"    — open-ended windows
 *
 * Dates accepted: YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, "15 Jul 2026",
 * today / tonight / tomorrow / tmr / tmrw (resolved against a reference date).
 */

export interface ParsedAvailability {
  is_available: boolean;
  half_day?: 'am' | 'pm' | null;
  /** First covered date (kept for backward compatibility). */
  date?: string; // YYYY-MM-DD
  /** Every date the message covers — ranges and lists are expanded per day. */
  dates?: string[];
  /** Time window the sender IS available for ("1pm-7pm"), when given. */
  start_time?: string | null; // "HH:MM"
  end_time?: string | null; // "HH:MM"
}

const DATE_TOKEN =
  /(\d{4}-\d{2}-\d{2}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{1,2}\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{4})/gi;

const RELATIVE_TOKEN = /\b(today|tonight|tomorrow|tmrw|tmr)\b/gi;

// Expanding a malicious "2026-01-01 to 2030-01-01" must not create years of
// rows — ranges are capped here and again at the webhook.
const MAX_RANGE_DAYS = 31;

/**
 * Attempts to parse a date string from various formats into YYYY-MM-DD.
 */
function parseDate(raw: string): string | undefined {
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return raw;

  // DD/MM/YYYY or DD-MM-YYYY
  const dmy = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (dmy) {
    const day = dmy[1].padStart(2, '0');
    const month = dmy[2].padStart(2, '0');
    const year = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
    return `${year}-${month}-${day}`;
  }

  // "15 Jan 2026" or "15 January 2026"
  const monthNames: Record<string, string> = {
    jan: '01', january: '01', feb: '02', february: '02',
    mar: '03', march: '03', apr: '04', april: '04',
    may: '05', jun: '06', june: '06', jul: '07', july: '07',
    aug: '08', august: '08', sep: '09', september: '09',
    oct: '10', october: '10', nov: '11', november: '11',
    dec: '12', december: '12',
  };

  const textDate = raw.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (textDate) {
    const day = textDate[1].padStart(2, '0');
    const monthKey = textDate[2].toLowerCase();
    const month = monthNames[monthKey];
    const year = textDate[3];
    if (month) return `${year}-${month}-${day}`;
  }

  return undefined;
}

/** Adds n days to a YYYY-MM-DD string. */
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Inclusive expansion of [from, to], capped at MAX_RANGE_DAYS. */
function expandRange(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  while (cur <= to && out.length < MAX_RANGE_DAYS) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

/**
 * Extracts every date the message covers (explicit, relative, and ranges),
 * sorted and de-duplicated, plus the text with the date tokens removed so
 * time-window parsing never mistakes a date fragment for a time.
 */
function extractDates(
  message: string,
  referenceDate: string
): { dates: string[]; remainder: string } {
  const found: Array<{ date: string; index: number; length: number }> = [];

  for (const m of message.matchAll(DATE_TOKEN)) {
    const parsed = parseDate(m[0].trim());
    if (parsed && m.index !== undefined) {
      found.push({ date: parsed, index: m.index, length: m[0].length });
    }
  }

  for (const m of message.matchAll(RELATIVE_TOKEN)) {
    if (m.index === undefined) continue;
    const word = m[0].toLowerCase();
    const date =
      word === 'today' || word === 'tonight' ? referenceDate : addDays(referenceDate, 1);
    found.push({ date, index: m.index, length: m[0].length });
  }

  found.sort((a, b) => a.index - b.index);

  // Range: exactly two date tokens joined by "to"/"till"/"until"/"-"/"–".
  let dates: string[];
  if (found.length === 2) {
    const between = message
      .slice(found[0].index + found[0].length, found[1].index)
      .trim()
      .toLowerCase();
    const isRange = /^(to|till|until|through|-|–)$/.test(between);
    const [a, b] = [found[0].date, found[1].date].sort();
    dates = isRange ? expandRange(a, b) : [...new Set([a, b])];
  } else {
    dates = [...new Set(found.map((f) => f.date))].sort();
  }

  // Strip date + relative tokens so "15/07/2026" can't be misread as a time.
  let remainder = message;
  for (const f of [...found].sort((x, y) => y.index - x.index)) {
    remainder = remainder.slice(0, f.index) + ' ' + remainder.slice(f.index + f.length);
  }

  return { dates, remainder };
}

/** Converts an hour/minute/meridiem capture into minutes from midnight, or null. */
function toMinutes(hourRaw: string, minuteRaw: string | undefined, meridiem: string | undefined): number | null {
  let hour = parseInt(hourRaw, 10);
  const minute = minuteRaw ? parseInt(minuteRaw, 10) : 0;
  if (Number.isNaN(hour) || minute > 59) return null;

  if (meridiem === 'am') {
    if (hour < 1 || hour > 12) return null;
    if (hour === 12) hour = 0;
  } else if (meridiem === 'pm') {
    if (hour < 1 || hour > 12) return null;
    if (hour !== 12) hour += 12;
  } else if (hour > 23) {
    return null;
  }

  return hour * 60 + minute;
}

function minutesToHHMM(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

const TIME_RANGE_RE =
  /(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\s*(?:-|–|to|till|until)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b/i;
const TIME_RANGE_24H_RE =
  /(\d{1,2})[:.](\d{2})\s*(?:-|–|to|till|until)\s*(\d{1,2})[:.](\d{2})/;
const FROM_ONWARDS_RE = /(?:from\s+|after\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\s+onwards?\b/i;
const UNTIL_ONLY_RE = /\b(?:until|till|before)\s+(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\b/i;

/**
 * Extracts an availability time window from message text (dates already
 * stripped). Returns null when no usable window is present.
 */
export function extractTimeWindow(text: string): { start: string; end: string } | null {
  // "1pm-7pm", "1-7pm", "9.30am to 2pm"
  let m = text.match(TIME_RANGE_RE);
  if (m) {
    const endMeridiem = m[6]?.toLowerCase();
    // "1-7pm" — an unqualified start hour inherits the end's meridiem.
    const startMeridiem = (m[3] ?? m[6])?.toLowerCase();
    const start = toMinutes(m[1], m[2], startMeridiem);
    const end = toMinutes(m[4], m[5], endMeridiem);
    if (start !== null && end !== null && start < end) {
      return { start: minutesToHHMM(start), end: minutesToHHMM(end) };
    }
  }

  // "13:00-19:00" (24-hour, minutes required so plain numbers aren't times)
  m = text.match(TIME_RANGE_24H_RE);
  if (m) {
    const start = toMinutes(m[1], m[2], undefined);
    const end = toMinutes(m[3], m[4], undefined);
    if (start !== null && end !== null && start < end) {
      return { start: minutesToHHMM(start), end: minutesToHHMM(end) };
    }
  }

  // "from 8pm onwards" / "8pm onwards" → until end of day
  m = text.match(FROM_ONWARDS_RE);
  if (m) {
    const start = toMinutes(m[1], m[2], m[3]?.toLowerCase());
    if (start !== null && start > 0) {
      return { start: minutesToHHMM(start), end: '23:59' };
    }
  }

  // "until 3pm" / "before 3pm" → from start of day
  m = text.match(UNTIL_ONLY_RE);
  if (m) {
    const end = toMinutes(m[1], m[2], m[3]?.toLowerCase());
    if (end !== null && end > 0) {
      return { start: '00:00', end: minutesToHHMM(end) };
    }
  }

  return null;
}

/**
 * Parses a WhatsApp message body to extract availability information.
 * referenceDate (YYYY-MM-DD, defaults to today) anchors relative words
 * like "today" and "tomorrow".
 * Returns null if the message cannot be interpreted as an availability update.
 */
export function parseWhatsAppMessage(
  message: string,
  referenceDate?: string
): ParsedAvailability | null {
  if (!message || typeof message !== 'string') return null;

  const ref = referenceDate ?? new Date().toISOString().split('T')[0];
  const { dates, remainder } = extractDates(message, ref);
  const text = message.trim().toLowerCase();
  const timeText = remainder.toLowerCase();

  const date = dates[0];
  const datesOut = dates.length > 0 ? dates : undefined;

  // MC / on MC → unavailable full day
  if (/\bmc\b|on mc|medical certificate/.test(text)) {
    return { is_available: false, half_day: null, date, dates: datesOut };
  }

  // Leave → unavailable full day
  if (/\bleave\b/.test(text) && !/not on leave|no leave/.test(text)) {
    return { is_available: false, half_day: null, date, dates: datesOut };
  }

  // Not available / unavailable
  if (/not available|unavailable|cannot work|can't work|cant work|not free/.test(text)) {
    // Check for half-day qualifier
    if (/\bam\b/.test(timeText)) return { is_available: false, half_day: 'am', date, dates: datesOut };
    if (/\bpm\b/.test(timeText)) return { is_available: false, half_day: 'pm', date, dates: datesOut };
    return { is_available: false, half_day: null, date, dates: datesOut };
  }

  // A concrete time window beats the AM/PM shorthand ("free 1pm-7pm tmr").
  const window = extractTimeWindow(remainder);
  if (window && /\bavailable\b|can work|\bfree\b|work(ing)? ok|\bok\b|^\s*\d/.test(timeText + ' ' + text)) {
    return {
      is_available: true,
      half_day: null,
      date,
      dates: datesOut,
      start_time: window.start,
      end_time: window.end,
    };
  }

  // Available AM / PM only
  if (/available\s+am\b|am\s+only|morning only/.test(timeText)) {
    return { is_available: true, half_day: 'am', date, dates: datesOut };
  }
  if (/available\s+pm\b|pm\s+only|afternoon only|evening only/.test(timeText)) {
    return { is_available: true, half_day: 'pm', date, dates: datesOut };
  }

  // Just "am" or "pm" (common shorthand)
  if (/^am\b/.test(timeText.trim()) && !/^amp/.test(timeText.trim())) {
    return { is_available: true, half_day: 'am', date, dates: datesOut };
  }
  if (/^pm\b/.test(timeText.trim())) {
    return { is_available: true, half_day: 'pm', date, dates: datesOut };
  }

  // Available (full day)
  if (/\bavailable\b|can work|\bfree\b/.test(text)) {
    return { is_available: true, half_day: null, date, dates: datesOut };
  }

  return null;
}

/**
 * Builds a click-to-chat wa.me link for contacting a staff member (UC-003 —
 * Chad). Strips every non-digit from the phone number (wa.me wants digits only,
 * no "+", spaces or dashes) and URL-encodes the pre-filled message. Returns
 * null when the staff member has no usable contact number so the caller can
 * surface a 422 rather than a broken link.
 */
export function buildWhatsAppContactLink(phone: string | null | undefined, message: string): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

/** Reply sent when a message cannot be understood — teaches the formats. */
export const WHATSAPP_HELP_MESSAGE =
  `Sorry, I couldn't understand that. Examples I understand:\n` +
  `• "available tomorrow"\n` +
  `• "available 20/07/2026 to 22/07/2026"\n` +
  `• "free 1pm-7pm tmr" (sets your hours)\n` +
  `• "not available 21/07/2026 — overseas"\n` +
  `• "on mc today"\n` +
  `• "am only 22/07/2026"`;

/**
 * Formats a response message to send back via WhatsApp. Accepts one date or
 * the full list of dates the update covered, and mentions the time window
 * when the sender gave one.
 */
export function formatWhatsAppResponse(
  staffName: string,
  workDates: string | string[],
  is_available: boolean,
  half_day?: string | null,
  window?: { start: string; end: string } | null
): string {
  const dates = Array.isArray(workDates) ? workDates : [workDates];
  const dateStr =
    dates.length <= 1
      ? dates[0] ?? ''
      : dates.length === 2
      ? `${dates[0]} and ${dates[1]}`
      : `${dates[0]} to ${dates[dates.length - 1]} (${dates.length} days)`;

  const windowStr = window ? ` from ${window.start} to ${window.end}` : '';
  const halfDayStr = half_day ? ` (${half_day.toUpperCase()} only)` : '';
  const availStr = is_available
    ? `available${halfDayStr}${windowStr}`
    : `unavailable${halfDayStr}`;
  return `Hi ${staffName}, your availability for ${dateStr} has been recorded as ${availStr}. Thank you.`;
}
