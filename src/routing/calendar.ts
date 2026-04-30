import type { CalendarDate, CalendarRow } from '../types.js';
import { todayYmd } from '../util/time.js';

const DOW_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

export function activeServiceIds(
  date: Date,
  calendar: CalendarRow[],
  calendarDates: CalendarDate[],
): Set<string> {
  const ymd = todayYmd(date);
  const dow = DOW_KEYS[date.getDay()];

  const active = new Set<string>();
  for (const row of calendar) {
    if (ymd < row.start_date || ymd > row.end_date) continue;
    if (row[dow]) active.add(row.service_id);
  }
  for (const ex of calendarDates) {
    if (ex.date !== ymd) continue;
    if (ex.exception_type === 1) active.add(ex.service_id);
    else if (ex.exception_type === 2) active.delete(ex.service_id);
  }
  return active;
}
