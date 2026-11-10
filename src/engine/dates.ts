const pad = (n: number) => String(n).padStart(2, '0');
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// UTC everywhere so a user's timezone can never shift a date.
export const weekday = (d: string) => new Date(d + 'T00:00:00Z').getUTCDay();
export function monthDays(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${pad(i + 1)}`);
}
