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
    footTransfers: [],
  };
}

function buildFixtureFrom(stopList: Stop[], tripList: Trip[], stList: StopTime[]): GtfsIndex {
  const stopById = new Map(stopList.map((s) => [s.stop_id, s]));
  const tripById = new Map(tripList.map((t) => [t.trip_id, t]));

  const stopTimesByTrip = new Map<string, StopTime[]>();
  for (const st of stList) {
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
    footTransfers: [],
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
      transferBufferMin: 1,
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
      transferBufferMin: 1,
    });
    expect(front).toEqual([]);
  });

  // Regression: when the user-clicked origin and destination clusters share a
  // stop, the walk-only access label at that shared stop must NOT dominate
  // ride-completed labels. Otherwise the bus route is silently dropped.
  it('finds a ride-based path even when origin and dest clusters overlap', () => {
    const idx = buildFixture();
    const front = findRoutes(idx, {
      // Both clusters list every fixture stop, with the destination cluster
      // putting walk-cost on stops other than X.
      originStops: [
        { stop_id: 'A', walkMin: 0 },
        { stop_id: 'B', walkMin: 5 },
        { stop_id: 'C', walkMin: 8 },
        { stop_id: 'X', walkMin: 12 },
      ],
      destStops: [
        { stop_id: 'X', walkMin: 0 },
        { stop_id: 'B', walkMin: 4 },
        { stop_id: 'C', walkMin: 7 },
      ],
      departureMin: 480,
      activeServices: new Set(['serviceA']),
      transfers,
      maxTransfers: 2,
      transferBufferMin: 1,
    });
    expect(front.length).toBeGreaterThan(0);
    expect(front.some((c) => c.legs.some((l) => l.kind === 'ride'))).toBe(true);
  });

  it('+1 min transfer buffer prevents same-stop same-minute reboard', () => {
    const stops2: Stop[] = [
      { stop_id: 'P', stop_name: 'P', stop_lat: 0, stop_lon: 0 },
      { stop_id: 'Q', stop_name: 'Q', stop_lat: 0, stop_lon: 0 },
      { stop_id: 'R', stop_name: 'R', stop_lat: 0, stop_lon: 0 },
    ];
    const trips2: Trip[] = [
      { route_id: 'R1', service_id: 'sv', trip_id: 'T1', trip_headsign: '', direction_id: '0', shape_id: 'S' },
      { route_id: 'R2', service_id: 'sv', trip_id: 'T2', trip_headsign: '', direction_id: '0', shape_id: 'S' },
      { route_id: 'R3', service_id: 'sv', trip_id: 'T3', trip_headsign: '', direction_id: '0', shape_id: 'S' },
    ];
    const sts2: StopTime[] = [
      { trip_id: 'T1', stop_id: 'P', stop_sequence: 1, arrival_min: 750, departure_min: 750 },
      { trip_id: 'T1', stop_id: 'Q', stop_sequence: 2, arrival_min: 760, departure_min: 760 },
      { trip_id: 'T2', stop_id: 'Q', stop_sequence: 1, arrival_min: 760, departure_min: 760 },
      { trip_id: 'T2', stop_id: 'R', stop_sequence: 2, arrival_min: 770, departure_min: 770 },
      { trip_id: 'T3', stop_id: 'Q', stop_sequence: 1, arrival_min: 761, departure_min: 761 },
      { trip_id: 'T3', stop_id: 'R', stop_sequence: 2, arrival_min: 771, departure_min: 771 },
    ];
    const idx = buildFixtureFrom(stops2, trips2, sts2);
    const front = findRoutes(idx, {
      originStops: [{ stop_id: 'P', walkMin: 0 }],
      destStops: [{ stop_id: 'R', walkMin: 0 }],
      departureMin: 750,
      activeServices: new Set(['sv']),
      transfers: [],
      maxTransfers: 2,
      transferBufferMin: 1,
    });
    expect(front.length).toBeGreaterThan(0);
    // T2 (Q 760 発) は Q 760 着 + 1 分バッファで弾かれ、T3 (Q 761 発) で R 771 着になる
    expect(front.every((c) => c.arrivalMin === 771)).toBe(true);
  });

  it('+1 min transfer buffer applies after a foot-transfer walk leg', () => {
    const stops2: Stop[] = [
      { stop_id: 'P', stop_name: 'P', stop_lat: 0, stop_lon: 0 },
      { stop_id: 'Q', stop_name: 'Q', stop_lat: 0, stop_lon: 0 },
      { stop_id: 'R', stop_name: 'R', stop_lat: 0, stop_lon: 0 },
      { stop_id: 'S', stop_name: 'S', stop_lat: 0, stop_lon: 0 },
    ];
    const trips2: Trip[] = [
      { route_id: 'R1', service_id: 'sv', trip_id: 'T1', trip_headsign: '', direction_id: '0', shape_id: 'S' },
      { route_id: 'R2', service_id: 'sv', trip_id: 'T2', trip_headsign: '', direction_id: '0', shape_id: 'S' },
      { route_id: 'R3', service_id: 'sv', trip_id: 'T3', trip_headsign: '', direction_id: '0', shape_id: 'S' },
    ];
    const sts2: StopTime[] = [
      { trip_id: 'T1', stop_id: 'P', stop_sequence: 1, arrival_min: 750, departure_min: 750 },
      { trip_id: 'T1', stop_id: 'Q', stop_sequence: 2, arrival_min: 760, departure_min: 760 },
      { trip_id: 'T2', stop_id: 'R', stop_sequence: 1, arrival_min: 761, departure_min: 761 },
      { trip_id: 'T2', stop_id: 'S', stop_sequence: 2, arrival_min: 770, departure_min: 770 },
      { trip_id: 'T3', stop_id: 'R', stop_sequence: 1, arrival_min: 762, departure_min: 762 },
      { trip_id: 'T3', stop_id: 'S', stop_sequence: 2, arrival_min: 771, departure_min: 771 },
    ];
    const idx = buildFixtureFrom(stops2, trips2, sts2);
    const transfers2: Transfer[] = [
      { from_stop_id: 'Q', to_stop_id: 'R', transfer_type: 2, min_transfer_time: 60 },
      { from_stop_id: 'R', to_stop_id: 'Q', transfer_type: 2, min_transfer_time: 60 },
    ];
    const front = findRoutes(idx, {
      originStops: [{ stop_id: 'P', walkMin: 0 }],
      destStops: [{ stop_id: 'S', walkMin: 0 }],
      departureMin: 750,
      activeServices: new Set(['sv']),
      transfers: transfers2,
      maxTransfers: 2,
      transferBufferMin: 1,
    });
    expect(front.length).toBeGreaterThan(0);
    // 徒歩 1 分 + バッファ 1 分 = R 着 761、乗車可能は 762 以降
    expect(front.every((c) => c.arrivalMin === 771)).toBe(true);
  });

  it('uses a foot-transfer edge to reach an otherwise unreachable destination', () => {
    const stops2: Stop[] = [
      { stop_id: 'P', stop_name: 'P', stop_lat: 0, stop_lon: 0 },
      { stop_id: 'Q', stop_name: 'Q', stop_lat: 0, stop_lon: 0 },
      { stop_id: 'R', stop_name: 'R', stop_lat: 0, stop_lon: 0 },
      { stop_id: 'S', stop_name: 'S', stop_lat: 0, stop_lon: 0 },
    ];
    const trips2: Trip[] = [
      { route_id: 'R1', service_id: 'sv', trip_id: 'TA', trip_headsign: '', direction_id: '0', shape_id: 'S' },
      { route_id: 'R2', service_id: 'sv', trip_id: 'TB', trip_headsign: '', direction_id: '0', shape_id: 'S' },
    ];
    const sts2: StopTime[] = [
      { trip_id: 'TA', stop_id: 'P', stop_sequence: 1, arrival_min: 750, departure_min: 750 },
      { trip_id: 'TA', stop_id: 'Q', stop_sequence: 2, arrival_min: 760, departure_min: 760 },
      { trip_id: 'TB', stop_id: 'R', stop_sequence: 1, arrival_min: 765, departure_min: 765 },
      { trip_id: 'TB', stop_id: 'S', stop_sequence: 2, arrival_min: 775, departure_min: 775 },
    ];
    const idx = buildFixtureFrom(stops2, trips2, sts2);
    const transfers2: Transfer[] = [
      { from_stop_id: 'Q', to_stop_id: 'R', transfer_type: 2, min_transfer_time: 120 },
      { from_stop_id: 'R', to_stop_id: 'Q', transfer_type: 2, min_transfer_time: 120 },
    ];
    const front = findRoutes(idx, {
      originStops: [{ stop_id: 'P', walkMin: 0 }],
      destStops: [{ stop_id: 'S', walkMin: 0 }],
      departureMin: 750,
      activeServices: new Set(['sv']),
      transfers: transfers2,
      maxTransfers: 2,
      transferBufferMin: 1,
    });
    expect(front.length).toBeGreaterThan(0);
    expect(front[0].arrivalMin).toBe(775);
    const legKinds = front[0].legs.map((l) => l.kind);
    expect(legKinds).toEqual(['ride', 'walk', 'ride']);
  });
});
