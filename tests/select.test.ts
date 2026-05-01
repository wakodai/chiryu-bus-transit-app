import { describe, expect, it } from 'vitest';
import type { RouteCandidate } from '../src/routing/raptor.js';
import { selectTopCandidates } from '../src/routing/select.js';

const mk = (arr: number, tr: number, walk = 0): RouteCandidate => ({
  arrivalMin: arr,
  transfers: tr,
  legs: [],
  originWalkMin: 0,
  destWalkMin: 0,
  walkTotalMin: walk,
});

describe('selectTopCandidates', () => {
  it('puts earliest first and includes a direct option when available', () => {
    const front = [mk(510, 1, 6), mk(520, 0, 8), mk(530, 2, 4)];
    const out = selectTopCandidates(front, 'earliest');
    expect(out[0]).toMatchObject({ arrivalMin: 510, transfers: 1 });
    expect(out.some((c) => c.transfers === 0)).toBe(true);
    expect(out.length).toBeLessThanOrEqual(3);
  });

  it('deduplicates when earliest is also direct (fewest transfers)', () => {
    const front = [mk(510, 0, 5), mk(520, 1, 9)];
    const out = selectTopCandidates(front, 'earliest');
    expect(out.length).toBeLessThanOrEqual(2);
    expect(out[0]).toMatchObject({ arrivalMin: 510, transfers: 0 });
  });

  it('returns empty array on empty input', () => {
    expect(selectTopCandidates([], 'earliest')).toEqual([]);
  });

  it('returns the least-walk candidate first when sorting by least walk', () => {
    const front = [mk(510, 1, 12), mk(520, 0, 3), mk(530, 2, 7)];
    const out = selectTopCandidates(front, 'leastWalk');
    expect(out[0]).toMatchObject({ walkTotalMin: 3 });
    // earliest entry should still appear among the picks for context
    expect(out.some((c) => c.arrivalMin === 510)).toBe(true);
  });

  it('handles single Pareto point', () => {
    const front = [mk(600, 1, 4)];
    const out = selectTopCandidates(front, 'earliest');
    expect(out).toEqual([
      { arrivalMin: 600, transfers: 1, legs: [], originWalkMin: 0, destWalkMin: 0, walkTotalMin: 4 },
    ]);
  });
});
