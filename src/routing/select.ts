import type { RouteCandidate } from './raptor.js';

export type SortKey = 'earliest' | 'leastWalk';

const key = (c: RouteCandidate) => `${c.arrivalMin}:${c.transfers}:${c.walkTotalMin}`;

export function selectTopCandidates(
  front: RouteCandidate[],
  sort: SortKey = 'earliest',
): RouteCandidate[] {
  if (front.length === 0) return [];

  const compareEarliest = (a: RouteCandidate, b: RouteCandidate) =>
    a.arrivalMin - b.arrivalMin || a.walkTotalMin - b.walkTotalMin || a.transfers - b.transfers;
  const compareLeastWalk = (a: RouteCandidate, b: RouteCandidate) =>
    a.walkTotalMin - b.walkTotalMin || a.arrivalMin - b.arrivalMin || a.transfers - b.transfers;

  const primary = sort === 'earliest' ? compareEarliest : compareLeastWalk;
  // Pick a few "interesting" picks then dedupe.
  const byPrimary = [...front].sort(primary);
  const byArrival = [...front].sort(compareEarliest);
  const byWalk = [...front].sort(compareLeastWalk);
  const direct = front
    .filter((c) => c.transfers === 0)
    .sort(primary)[0];

  const seen = new Set<string>();
  const out: RouteCandidate[] = [];
  for (const c of [byPrimary[0], byArrival[0], byWalk[0], direct]) {
    if (!c) continue;
    const k = key(c);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
    if (out.length >= 3) break;
  }
  return out;
}
