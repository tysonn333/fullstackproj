/**
 * Call Centre Integration
 *
 * Parses job/transport requests exported from the call centre system.
 *
 * Expected CSV format (first row = headers):
 *   job_date,pickup_time,service_type,pickup_loc,dropoff_loc
 *   2025-01-15,09:30,MTS,Tan Tock Seng Hospital,Singapore General Hospital
 *
 * Also handles common alternative header names.
 */

export interface ParsedJob {
  job_date: string;
  pickup_time: string;
  service_type: string;
  pickup_loc: string;
  dropoff_loc: string;
  source: string;
}

const HEADER_ALIASES: Record<string, string> = {
  // job_date aliases
  date: 'job_date',
  'job date': 'job_date',
  'transport date': 'job_date',
  'trip date': 'job_date',
  // pickup_time aliases
  time: 'pickup_time',
  'pickup time': 'pickup_time',
  'pick up time': 'pickup_time',
  'departure time': 'pickup_time',
  // service_type aliases
  type: 'service_type',
  service: 'service_type',
  'service type': 'service_type',
  'transport type': 'service_type',
  // pickup_loc aliases
  from: 'pickup_loc',
  origin: 'pickup_loc',
  'pickup location': 'pickup_loc',
  'pick up': 'pickup_loc',
  // dropoff_loc aliases
  to: 'dropoff_loc',
  destination: 'dropoff_loc',
  'dropoff location': 'dropoff_loc',
  'drop off': 'dropoff_loc',
};

/**
 * Normalises a header string to the canonical field name.
 */
function normaliseHeader(header: string): string {
  const trimmed = header.trim().toLowerCase().replace(/[_\s]+/g, ' ');
  return HEADER_ALIASES[trimmed] ?? trimmed.replace(/\s+/g, '_');
}

/**
 * Normalises a service_type value to 'MTS' or 'EAS'.
 */
function normaliseServiceType(raw: string): string {
  const upper = raw.trim().toUpperCase();
  if (upper === 'MTS' || upper === 'MEDICAL TRANSPORT SERVICE') return 'MTS';
  if (upper === 'EAS' || upper === 'EMERGENCY AMBULANCE SERVICE') return 'EAS';
  return upper; // Return as-is; validation happens in the route
}

/**
 * Normalises a time string to HH:MM format.
 * Handles: "9:30", "09:30", "9:30:00", "930", "0930"
 */
function normaliseTime(raw: string): string {
  const trimmed = raw.trim();

  // Already HH:MM or HH:MM:SS
  const colonMatch = trimmed.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (colonMatch) {
    return `${colonMatch[1].padStart(2, '0')}:${colonMatch[2]}`;
  }

  // 4-digit HHMM
  const compactMatch = trimmed.match(/^(\d{2})(\d{2})$/);
  if (compactMatch) {
    return `${compactMatch[1]}:${compactMatch[2]}`;
  }

  // 3-digit HMM
  const threeDigit = trimmed.match(/^(\d)(\d{2})$/);
  if (threeDigit) {
    return `0${threeDigit[1]}:${threeDigit[2]}`;
  }

  return trimmed;
}

/**
 * Normalises a date string to YYYY-MM-DD.
 * Handles: "2025-01-15", "15/01/2025", "15-01-2025"
 */
function normaliseDate(raw: string): string {
  const trimmed = raw.trim();

  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  // DD/MM/YYYY or DD-MM-YYYY
  const dmy = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }

  return trimmed;
}

/**
 * Parses a CSV string of call centre jobs.
 * Returns an array of ParsedJob objects (invalid rows are skipped with a warning).
 */
export function parseCallCentreJobs(rawCsv: string): ParsedJob[] {
  if (!rawCsv || typeof rawCsv !== 'string') return [];

  const lines = rawCsv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) return []; // Need at least header + 1 data row

  // Parse CSV respecting quoted fields
  function parseCsvLine(line: string): string[] {
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    fields.push(current);
    return fields;
  }

  const headers = parseCsvLine(lines[0]).map(normaliseHeader);
  const jobs: ParsedJob[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const row: Record<string, string> = {};

    headers.forEach((header, idx) => {
      row[header] = (values[idx] ?? '').trim();
    });

    // Skip rows with all empty values (blank lines in CSV)
    if (Object.values(row).every((v) => v === '')) continue;

    // Validate required fields
    if (!row.job_date || !row.pickup_time || !row.service_type) {
      console.warn(`[CallCentre] Skipping row ${i + 1}: missing required fields`, row);
      continue;
    }

    jobs.push({
      job_date: normaliseDate(row.job_date),
      pickup_time: normaliseTime(row.pickup_time),
      service_type: normaliseServiceType(row.service_type),
      pickup_loc: row.pickup_loc ?? '',
      dropoff_loc: row.dropoff_loc ?? '',
      source: 'call_centre',
    });
  }

  return jobs;
}

/**
 * Validates a parsed job for completeness and correctness.
 */
export function validateJob(job: ParsedJob): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!job.job_date || !/^\d{4}-\d{2}-\d{2}$/.test(job.job_date)) {
    errors.push('Invalid job_date format (expected YYYY-MM-DD)');
  }

  if (!job.pickup_time || !/^\d{2}:\d{2}$/.test(job.pickup_time)) {
    errors.push('Invalid pickup_time format (expected HH:MM)');
  }

  if (!['MTS', 'EAS'].includes(job.service_type)) {
    errors.push(`Invalid service_type '${job.service_type}' (expected MTS or EAS)`);
  }

  return { valid: errors.length === 0, errors };
}
