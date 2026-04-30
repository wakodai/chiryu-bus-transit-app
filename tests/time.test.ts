import { describe, expect, it } from 'vitest';
import { formatMin, parseGtfsTime, todayYmd } from '../src/util/time.js';

describe('parseGtfsTime', () => {
  it('parses HH:MM:SS to minutes since midnight', () => {
    expect(parseGtfsTime('00:00:00')).toBe(0);
    expect(parseGtfsTime('06:30:00')).toBe(390);
    expect(parseGtfsTime('19:15:00')).toBe(1155);
  });
  it('handles times past 24:00:00', () => {
    expect(parseGtfsTime('25:30:00')).toBe(25 * 60 + 30);
  });
});

describe('formatMin', () => {
  it('formats minutes as HH:MM', () => {
    expect(formatMin(390)).toBe('06:30');
    expect(formatMin(1155)).toBe('19:15');
    expect(formatMin(0)).toBe('00:00');
  });
});

describe('todayYmd', () => {
  it('formats Date as YYYYMMDD', () => {
    expect(todayYmd(new Date(2026, 4, 1))).toBe('20260501');
    expect(todayYmd(new Date(2026, 0, 9))).toBe('20260109');
  });
});
