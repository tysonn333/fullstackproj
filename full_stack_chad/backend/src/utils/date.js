export function currentMonthRange(month) {
  const match = /^\d{4}-\d{2}$/.test(month ?? '') ? month : new Date().toISOString().slice(0, 7);
  const [year, monthNumber] = match.split('-').map(Number);
  const start = `${match}-01`;
  const endDate = new Date(Date.UTC(year, monthNumber, 0));
  const end = endDate.toISOString().slice(0, 10);
  return { start, end };
}

export function nowIso() {
  return new Date().toISOString();
}

export function dateInCurrentMonth(dayOffset = 0) {
  const date = new Date();
  date.setDate(Math.min(24, Math.max(2, date.getDate() + dayOffset)));
  return date.toISOString().slice(0, 10);
}
