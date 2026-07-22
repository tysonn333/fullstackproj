const csvValue = (value) => {
  const text = value == null ? '' : String(value);
  return `"${text.replaceAll('"', '""')}"`;
};

export function exceptionsToCsv(items) {
  const headers = [
    'ID',
    'Type',
    'Severity',
    'Status',
    'Shift Date',
    'Start',
    'End',
    'Staff',
    'Summary',
    'Recommendation',
    'Resolution Note',
  ];

  const rows = items.map((item) => [
    item.id,
    item.type,
    item.severity,
    item.status,
    item.shift_date,
    item.shift_start,
    item.shift_end,
    item.staff?.name ?? '',
    item.summary,
    item.recommendation,
    item.resolution_note,
  ]);

  return [headers, ...rows].map((row) => row.map(csvValue).join(',')).join('\n');
}
