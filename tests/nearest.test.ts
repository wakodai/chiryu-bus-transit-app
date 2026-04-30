import RBush from 'rbush';
import { describe, expect, it } from 'vitest';
import type { GtfsIndex, StopBoxItem } from '../src/data/indexer.js';
import { nearestStops } from '../src/routing/nearest.js';
import type { Stop } from '../src/types.js';

function fakeIndex(stops: Stop[]): GtfsIndex {
  const stopTree = new RBush<StopBoxItem>();
  stopTree.load(
    stops.map((s) => ({
      minX: s.stop_lon,
      minY: s.stop_lat,
      maxX: s.stop_lon,
      maxY: s.stop_lat,
      stop: s,
    })),
  );
  return {
    stopTree,
    stopById: new Map(stops.map((s) => [s.stop_id, s])),
    tripById: new Map(),
    routeById: new Map(),
    departuresByStop: new Map(),
    stopTimesByTrip: new Map(),
  };
}

const stops: Stop[] = [
  { stop_id: 'A', stop_name: 'A', stop_lat: 35.01, stop_lon: 137.04 },
  { stop_id: 'B', stop_name: 'B', stop_lat: 35.015, stop_lon: 137.041 },
  { stop_id: 'C', stop_name: 'C', stop_lat: 35.02, stop_lon: 137.05 },
];

describe('nearestStops', () => {
  it('returns stops within radius sorted by distance', () => {
    const idx = fakeIndex(stops);
    const result = nearestStops(idx, 35.01, 137.04, 1000, 5);
    expect(result.map((r) => r.stop.stop_id)).toEqual(['A', 'B']);
    expect(result[0].distance).toBeCloseTo(0, 0);
    expect(result[1].distance).toBeGreaterThan(400);
    expect(result[1].distance).toBeLessThan(700);
  });

  it('respects the limit', () => {
    const idx = fakeIndex(stops);
    const result = nearestStops(idx, 35.01, 137.04, 5000, 1);
    expect(result.length).toBe(1);
    expect(result[0].stop.stop_id).toBe('A');
  });

  it('returns empty when no stop is within radius', () => {
    const idx = fakeIndex(stops);
    const result = nearestStops(idx, 36.0, 138.0, 500, 5);
    expect(result).toEqual([]);
  });
});
