import RBush from 'rbush';
import type { GtfsData, Route, Stop, StopTime, Trip } from '../types.js';

export interface StopBoxItem {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  stop: Stop;
}

export interface DepartureEntry {
  trip_id: string;
  stop_sequence: number;
  departure_min: number;
}

export interface GtfsIndex {
  stopTree: RBush<StopBoxItem>;
  stopById: Map<string, Stop>;
  tripById: Map<string, Trip>;
  routeById: Map<string, Route>;
  departuresByStop: Map<string, DepartureEntry[]>;
  stopTimesByTrip: Map<string, StopTime[]>;
}

export function buildIndex(data: GtfsData): GtfsIndex {
  const stopById = new Map(data.stops.map((s) => [s.stop_id, s]));
  const tripById = new Map(data.trips.map((t) => [t.trip_id, t]));
  const routeById = new Map(data.routes.map((r) => [r.route_id, r]));

  const stopTree = new RBush<StopBoxItem>();
  stopTree.load(
    data.stops.map((s) => ({
      minX: s.stop_lon,
      minY: s.stop_lat,
      maxX: s.stop_lon,
      maxY: s.stop_lat,
      stop: s,
    })),
  );

  const stopTimesByTrip = new Map<string, StopTime[]>();
  for (const st of data.stopTimes) {
    let arr = stopTimesByTrip.get(st.trip_id);
    if (!arr) {
      arr = [];
      stopTimesByTrip.set(st.trip_id, arr);
    }
    arr.push(st);
  }
  for (const arr of stopTimesByTrip.values()) {
    arr.sort((a, b) => a.stop_sequence - b.stop_sequence);
  }

  const departuresByStop = new Map<string, DepartureEntry[]>();
  for (const [trip_id, sts] of stopTimesByTrip) {
    for (const st of sts) {
      if (st.stop_sequence === sts[sts.length - 1].stop_sequence) continue;
      let arr = departuresByStop.get(st.stop_id);
      if (!arr) {
        arr = [];
        departuresByStop.set(st.stop_id, arr);
      }
      arr.push({ trip_id, stop_sequence: st.stop_sequence, departure_min: st.departure_min });
    }
  }
  for (const arr of departuresByStop.values()) {
    arr.sort((a, b) => a.departure_min - b.departure_min);
  }

  return { stopTree, stopById, tripById, routeById, departuresByStop, stopTimesByTrip };
}
