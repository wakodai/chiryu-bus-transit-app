import { describe, expect, it } from 'vitest';
import type { DepartureEntry, GtfsIndex } from '../src/data/indexer.js';
import { findRoutes } from '../src/routing/raptor.js';
import type { Stop, StopTime, Transfer, Trip } from '../src/types.js';

const stops: Stop[] = [
  { stop_id: 'A', stop_name: 'A', stop_lat: 0, stop_lon: 0 },
  { stop_id: 'B', stop_name: 'B', stop_lat: 0, stop_lon: 0 },
  { stop_id: 'C', stop_name: 'C', stop_lat: 0, stop_lon: 0 },
  { stop_id: 'X', stop_name: 'X', stop_lat: 0, stop_lon: 0 },
];

const trips: Trip[] = [
  { route_id: 'R1', service_id: 'serviceA', trip_id: 'T1', trip_headsign: 'C', direction_id: '0', shape_id: 'S1' },
  { route_id: 'R2', service_id: 'serviceA', trip_id: 'T2', trip_headsign: 'X', direction_id: '0', shape_id: 'S2' },
  { route_id: 'R3', service_id: 'serviceA', trip_id: 'T3', trip_headsign: 'X', direction_id: '0', shape_id: 'S3' },
];

const stopTimes: StopTime[] = [
  { trip_id: 'T1', stop_id: 'A', stop_sequence: 1, arrival_min: 480, departure_min: 480 },
  { trip_id: 'T1', stop_id: 'B', stop_sequence: 2, arrival_min: 490, departure_min: 490 },
  { trip_id: 'T1', stop_id: 'C', stop_sequence: 3, arrival_min: 505, departure_min: 505 },
  { trip_id: 'T2', stop_id: 'B', stop_sequence: 1, arrival_min: 495, departure_min: 495 },
  { trip_id: 'T2', stop_id: 'X', stop_sequence: 2, arrival_min: 510, departure_min: 510 },
  { trip_id: 'T3', stop_id: 'A', stop_sequence: 1, arrival_min: 480, departure_min: 480 },
  { trip_id: 'T3', stop_id: 'X', stop_sequence: 2, arrival_min: 520, departure_min: 520 },
];

const transfers: Transfer[] = [
  { from_stop_id: 'B', to_stop_id: 'B', transfer_type: 0, min_transfer_time: 0 },
];

function buildFixture(): GtfsIndex {
  const stopById = new Map(stops.map((s) => [s.stop_id, s]));
  const tripById = new Map(trips.map((t) => [t.trip_id, t]));

  const stopTimesByTrip = new Map<string, StopTime[]>();
  for (const st of stopTimes) {
    let a = stopTimesByTrip.get(st.trip_id);
    if (!a) {
      a = [];
      stopTimesByTrip.set(st.trip_id, a);
    }
    a.push(st);
  }
  for (const a of stopTimesByTrip.values()) a.sort((x, y) => x.stop_sequence - y.stop_sequence);

  const departuresByStop = new Map<string, DepartureEntry[]>();
  for (const [tripId, sts] of stopTimesByTrip) {
    for (const st of sts) {
      if (st.stop_sequence === sts[sts.length - 1].stop_sequence) continue;
      let a = departuresByStop.get(st.stop_id);
      if (!a) {
        a = [];
        departuresByStop.set(st.stop_id, a);
      }
      a.push({ trip_id: tripId, stop_sequence: st.stop_sequence, departure_min: st.departure_min });
    }
  }
  for (const a of departuresByStop.values()) a.sort((x, y) => x.departure_min - y.departure_min);

  return {
    stopTree: { search: () => [] } as never,
    stopById,
    tripById,
    routeById: new Map(),
    departuresByStop,
    stopTimesByTrip,
  };
}

describe('findRoutes (RAPTOR)', () => {
  it('returns both a direct and a 1-transfer path on the Pareto front', () => {
    const idx = buildFixture();
    const front = findRoutes(idx, {
      originStops: [{ stop_id: 'A', walkMin: 0 }],
      destStops: [{ stop_id: 'X', walkMin: 0 }],
      departureMin: 480,
      activeServices: new Set(['serviceA']),
      transfers,
      maxTransfers: 2,
    });
    const sorted = [...front].sort((a, b) => a.arrivalMin - b.arrivalMin);
    expect(sorted.length).toBe(2);
    expect(sorted[0]).toMatchObject({ arrivalMin: 510, transfers: 1 });
    expect(sorted[1]).toMatchObject({ arrivalMin: 520, transfers: 0 });
  });

  it('returns empty when destination is unreachable in time', () => {
    const idx = buildFixture();
    const front = findRoutes(idx, {
      originStops: [{ stop_id: 'A', walkMin: 0 }],
      destStops: [{ stop_id: 'C', walkMin: 0 }],
      departureMin: 510,
      activeServices: new Set(['serviceA']),
      transfers,
      maxTransfers: 2,
    });
    expect(front).toEqual([]);
  });
});
