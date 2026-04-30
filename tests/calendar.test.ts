import { describe, expect, it } from 'vitest';
import { activeServiceIds } from '../src/routing/calendar.js';
import type { CalendarDate, CalendarRow } from '../src/types.js';

const cal: CalendarRow[] = [
  {
    service_id: 'weekday',
    monday: true,
    tuesday: true,
    wednesday: true,
    thursday: true,
    friday: true,
    saturday: false,
    sunday: false,
    start_date: '20260101',
    end_date: '20261231',
  },
  {
    service_id: 'allday',
    monday: true,
    tuesday: true,
    wednesday: true,
    thursday: true,
    friday: true,
    saturday: true,
    sunday: true,
    start_date: '20260101',
    end_date: '20261231',
  },
];

const calDates: CalendarDate[] = [
  { service_id: 'allday', date: '20260109', exception_type: 2 },
  { service_id: 'special', date: '20260109', exception_type: 1 },
];

describe('activeServiceIds', () => {
  it('returns weekday services on a Friday', () => {
    const set = activeServiceIds(new Date(2026, 0, 2), cal, calDates);
    expect(set.has('weekday')).toBe(true);
    expect(set.has('allday')).toBe(true);
    expect(set.has('special')).toBe(false);
  });

  it('excludes weekday-only services on Saturday', () => {
    const set = activeServiceIds(new Date(2026, 0, 3), cal, calDates);
    expect(set.has('weekday')).toBe(false);
    expect(set.has('allday')).toBe(true);
  });

  it('honors calendar_dates exception_type=2 (remove)', () => {
    const set = activeServiceIds(new Date(2026, 0, 9), cal, calDates);
    expect(set.has('weekday')).toBe(true);
    expect(set.has('allday')).toBe(false);
  });

  it('honors calendar_dates exception_type=1 (add)', () => {
    const set = activeServiceIds(new Date(2026, 0, 9), cal, calDates);
    expect(set.has('special')).toBe(true);
  });

  it('excludes services outside their date range', () => {
    const set = activeServiceIds(new Date(2025, 11, 31), cal, calDates);
    expect(set.has('weekday')).toBe(false);
  });
});
