import type { RouteCandidate } from './raptor.js';

export function selectTopCandidates(front: RouteCandidate[]): RouteCandidate[] {
  if (front.length === 0) return [];
  const byArrival = [...front].sort(
    (a, b) => a.arrivalMin - b.arrivalMin || a.transfers - b.transfers,
  );
  const earliest = byArrival[0];
  const byTransfers = [...front].sort(
    (a, b) => a.transfers - b.transfers || a.arrivalMin - b.arrivalMin,
  );
  const fewest = byTransfers[0];
  const direct = front.find((c) => c.transfers === 0);

  const seen = new Set<string>();
  const key = (c: RouteCandidate) => `${c.arrivalMin}:${c.transfers}`;
  const out: RouteCandidate[] = [];
  for (const c of [earliest, fewest, direct]) {
    if (!c) continue;
    const k = key(c);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}
