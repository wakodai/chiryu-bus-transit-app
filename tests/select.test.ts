import { describe, expect, it } from 'vitest';
import type { RouteCandidate } from '../src/routing/raptor.js';
import { selectTopCandidates } from '../src/routing/select.js';

const mk = (arr: number, tr: number): RouteCandidate => ({
  arrivalMin: arr,
  transfers: tr,
  legs: [],
  originWalkMin: 0,
  destWalkMin: 0,
});

describe('selectTopCandidates', () => {
  it('puts earliest first and includes a direct option when available', () => {
    const front = [mk(510, 1), mk(520, 0), mk(530, 2)];
    const out = selectTopCandidates(front);
    expect(out[0]).toMatchObject({ arrivalMin: 510, transfers: 1 });
    expect(out.some((c) => c.transfers === 0)).toBe(true);
    expect(out.length).toBeLessThanOrEqual(3);
  });

  it('deduplicates when earliest is also direct (fewest transfers)', () => {
    const front = [mk(510, 0), mk(520, 1)];
    const out = selectTopCandidates(front);
    expect(out.length).toBe(1);
    expect(out[0]).toMatchObject({ arrivalMin: 510, transfers: 0 });
  });

  it('returns empty array on empty input', () => {
    expect(selectTopCandidates([])).toEqual([]);
  });

  it('handles single Pareto point', () => {
    const front = [mk(600, 1)];
    const out = selectTopCandidates(front);
    expect(out).toEqual([{ arrivalMin: 600, transfers: 1, legs: [], originWalkMin: 0, destWalkMin: 0 }]);
  });
});
