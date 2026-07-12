/**
 * Minimal iCalendar (RFC 5545) generator — no external dependency.
 *
 * Used by the calendar-integration endpoints to export roster shifts and a
 * staff member's schedule as a .ics file that can be imported into Google
 * Calendar, Apple Calendar, Outlook, etc.
 */

export interface CalendarEvent {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  /** Event start as a JS Date (interpreted in UTC for the stamp). */
  start: Date;
  end: Date;
}

/** Escapes text per RFC 5545 (commas, semicolons, backslashes, newlines). */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Formats a Date as an iCal UTC timestamp: YYYYMMDDTHHMMSSZ. */
export function toICSDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** Folds a content line at 75 octets as recommended by RFC 5545. */
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  let remaining = line;
  chunks.push(remaining.slice(0, 75));
  remaining = remaining.slice(75);
  while (remaining.length > 0) {
    chunks.push(' ' + remaining.slice(0, 74));
    remaining = remaining.slice(74);
  }
  return chunks.join('\r\n');
}

/**
 * Builds a complete VCALENDAR document from a list of events.
 * `stamp` is the DTSTAMP applied to every event (defaults must be supplied by
 * the caller — Date.now() is avoided so output is deterministic in tests).
 */
export function buildICS(
  calendarName: string,
  events: CalendarEvent[],
  stamp: Date
): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//EFAR//Ambulance Scheduling//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calendarName)}`,
  ];

  const dtstamp = toICSDate(stamp);

  for (const ev of events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${escapeText(ev.uid)}`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART:${toICSDate(ev.start)}`);
    lines.push(`DTEND:${toICSDate(ev.end)}`);
    lines.push(`SUMMARY:${escapeText(ev.summary)}`);
    if (ev.description) lines.push(`DESCRIPTION:${escapeText(ev.description)}`);
    if (ev.location) lines.push(`LOCATION:${escapeText(ev.location)}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

  return lines.map(foldLine).join('\r\n') + '\r\n';
}
