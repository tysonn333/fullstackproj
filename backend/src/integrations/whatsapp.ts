/**
 * WhatsApp Integration
 *
 * Parses incoming WhatsApp messages to extract availability intent.
 *
 * Supported message patterns (case-insensitive):
 *   "available [date]"
 *   "not available [date]" / "unavailable [date]"
 *   "am [date]" / "available am [date]"
 *   "pm [date]" / "available pm [date]"
 *   "mc [date]" / "on mc [date]"
 *   "leave [date]"
 */

export interface ParsedAvailability {
  is_available: boolean;
  half_day?: 'am' | 'pm' | null;
  date?: string; // YYYY-MM-DD, if parseable from message
}

const DATE_REGEX = /(\d{4}-\d{2}-\d{2}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{1,2}\s+\w+\s+\d{4})/i;

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

  // "15 Jan 2025" or "15 January 2025"
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

/**
 * Parses a WhatsApp message body to extract availability information.
 * Returns null if the message cannot be interpreted as an availability update.
 */
export function parseWhatsAppMessage(message: string): ParsedAvailability | null {
  if (!message || typeof message !== 'string') return null;

  const text = message.trim().toLowerCase();

  // Extract date if present
  const dateMatch = message.match(DATE_REGEX);
  const date = dateMatch ? parseDate(dateMatch[0]) : undefined;

  // MC / on MC → unavailable full day
  if (/\bmc\b|on mc|medical certificate/.test(text)) {
    return { is_available: false, half_day: null, date };
  }

  // Leave → unavailable full day
  if (/\bleave\b/.test(text) && !/not on leave|no leave/.test(text)) {
    return { is_available: false, half_day: null, date };
  }

  // Not available / unavailable
  if (/not available|unavailable|cannot work|can't work|cant work/.test(text)) {
    // Check for half-day qualifier
    if (/\bam\b/.test(text)) return { is_available: false, half_day: 'am', date };
    if (/\bpm\b/.test(text)) return { is_available: false, half_day: 'pm', date };
    return { is_available: false, half_day: null, date };
  }

  // Available AM / PM only
  if (/available\s+am\b|am\s+only|morning only/.test(text)) {
    return { is_available: true, half_day: 'am', date };
  }
  if (/available\s+pm\b|pm\s+only|afternoon only/.test(text)) {
    return { is_available: true, half_day: 'pm', date };
  }

  // Just "am" or "pm" (common shorthand)
  if (/^am\b/.test(text) && !/^amp/.test(text)) {
    return { is_available: true, half_day: 'am', date };
  }
  if (/^pm\b/.test(text)) {
    return { is_available: true, half_day: 'pm', date };
  }

  // Available (full day)
  if (/\bavailable\b|can work|free/.test(text)) {
    return { is_available: true, half_day: null, date };
  }

  return null;
}

/**
 * Formats a response message to send back via WhatsApp.
 */
export function formatWhatsAppResponse(
  staffName: string,
  workDate: string,
  is_available: boolean,
  half_day?: string | null
): string {
  const halfDayStr = half_day ? ` (${half_day.toUpperCase()} only)` : '';
  const availStr = is_available ? `available${halfDayStr}` : `unavailable${halfDayStr}`;
  return `Hi ${staffName}, your availability for ${workDate} has been recorded as ${availStr}. Thank you.`;
}
