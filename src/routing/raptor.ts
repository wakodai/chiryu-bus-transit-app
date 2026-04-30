import type { GtfsIndex } from '../data/indexer.js';
import type { Transfer } from '../types.js';

export interface AccessStop {
  stop_id: string;
  walkMin: number;
}

export interface RouteLeg {
  kind: 'ride' | 'walk';
  fromStopId: string;
  toStopId: string;
  fromMin: number;
  toMin: number;
  trip_id?: string;
  route_id?: string;
  intermediateStopIds?: string[];
}

export interface RouteCandidate {
  arrivalMin: number;
  transfers: number;
  legs: RouteLeg[];
  /** Walking minutes from user-clicked origin to the chosen boarding stop. */
  originWalkMin: number;
  /** Walking minutes from the chosen alighting stop to user-clicked destination. */
  destWalkMin: number;
}

export interface FindRoutesParams {
  originStops: AccessStop[];
  destStops: AccessStop[];
  departureMin: number;
  activeServices: Set<string>;
  transfers: Transfer[];
  maxTransfers: number;
}

interface Label {
  arrival: number;
  transfers: number;
  prev: { fromLabel: Label; viaLeg: RouteLeg } | null;
}

function dominates(a: Label, b: Label): boolean {
  return (
    a.arrival <= b.arrival &&
    a.transfers <= b.transfers &&
    (a.arrival < b.arrival || a.transfers < b.transfers)
  );
}

function pushLabel(map: Map<string, Label[]>, stopId: string, label: Label): boolean {
  const cur = map.get(stopId) ?? [];
  for (const c of cur) {
    if (dominates(c, label)) return false;
    if (c.arrival === label.arrival && c.transfers === label.transfers) return false;
  }
  const kept = cur.filter((c) => !dominates(label, c));
  kept.push(label);
  map.set(stopId, kept);
  return true;
}

export function findRoutes(idx: GtfsIndex, p: FindRoutesParams): RouteCandidate[] {
  const labels = new Map<string, Label[]>();
  let frontier = new Map<string, Label>();

  for (const o of p.originStops) {
    const arr = p.departureMin + o.walkMin;
    const label: Label = { arrival: arr, transfers: -1, prev: null };
    if (pushLabel(labels, o.stop_id, label)) {
      frontier.set(o.stop_id, label);
    }
  }

  const transferAdj = new Map<string, { to: string; minMin: number }[]>();
  for (const t of p.transfers) {
    if (t.from_stop_id === t.to_stop_id) continue;
    let arr = transferAdj.get(t.from_stop_id);
    if (!arr) {
      arr = [];
      transferAdj.set(t.from_stop_id, arr);
    }
    arr.push({ to: t.to_stop_id, minMin: Math.ceil(t.min_transfer_time / 60) });
  }

  for (let round = 0; round <= p.maxTransfers; round++) {
    const next = new Map<string, Label>();

    for (const [stopId, label] of frontier) {
      const deps = idx.departuresByStop.get(stopId) ?? [];
      for (const dep of deps) {
        if (dep.departure_min < label.arrival) continue;
        const trip = idx.tripById.get(dep.trip_id);
        if (!trip || !p.activeServices.has(trip.service_id)) continue;
        const sts = idx.stopTimesByTrip.get(dep.trip_id);
        if (!sts) continue;
        const intermediate: string[] = [];
        for (const st of sts) {
          if (st.stop_sequence <= dep.stop_sequence) continue;
          const newLabel: Label = {
            arrival: st.arrival_min,
            transfers: label.transfers + 1,
            prev: {
              fromLabel: label,
              viaLeg: {
                kind: 'ride',
                fromStopId: stopId,
                toStopId: st.stop_id,
                fromMin: dep.departure_min,
                toMin: st.arrival_min,
                trip_id: dep.trip_id,
                route_id: trip.route_id,
                intermediateStopIds: [...intermediate],
              },
            },
          };
          if (pushLabel(labels, st.stop_id, newLabel)) {
            const prev = next.get(st.stop_id);
            if (!prev || newLabel.arrival < prev.arrival) next.set(st.stop_id, newLabel);
          }
          intermediate.push(st.stop_id);
        }
      }
    }

    const afterFoot = new Map<string, Label>(next);
    for (const [stopId, label] of next) {
      const adj = transferAdj.get(stopId) ?? [];
      for (const e of adj) {
        const newLabel: Label = {
          arrival: label.arrival + e.minMin,
          transfers: label.transfers,
          prev: {
            fromLabel: label,
            viaLeg: {
              kind: 'walk',
              fromStopId: stopId,
              toStopId: e.to,
              fromMin: label.arrival,
              toMin: label.arrival + e.minMin,
            },
          },
        };
        if (pushLabel(labels, e.to, newLabel)) {
          const prev = afterFoot.get(e.to);
          if (!prev || newLabel.arrival < prev.arrival) afterFoot.set(e.to, newLabel);
        }
      }
    }

    frontier = afterFoot;
    if (frontier.size === 0) break;
  }

  const originWalkByStop = new Map(p.originStops.map((o) => [o.stop_id, o.walkMin]));

  const candidates: RouteCandidate[] = [];
  for (const d of p.destStops) {
    const arr = labels.get(d.stop_id);
    if (!arr) continue;
    for (const lbl of arr) {
      if (lbl.transfers < 0) continue;
      const arrivalAtUserDest = lbl.arrival + d.walkMin;
      const legs = reconstruct(lbl, d);
      const rideLegs = legs.filter((l) => l.kind === 'ride');
      const firstBoard = rideLegs[0]?.fromStopId;
      const originWalkMin = firstBoard ? originWalkByStop.get(firstBoard) ?? 0 : 0;
      candidates.push({
        arrivalMin: arrivalAtUserDest,
        transfers: lbl.transfers,
        legs,
        originWalkMin,
        destWalkMin: d.walkMin,
      });
    }
  }

  const pareto: RouteCandidate[] = [];
  for (const c of candidates) {
    if (
      pareto.some(
        (x) =>
          x.arrivalMin <= c.arrivalMin &&
          x.transfers <= c.transfers &&
          (x.arrivalMin < c.arrivalMin || x.transfers < c.transfers),
      )
    )
      continue;
    for (let i = pareto.length - 1; i >= 0; i--) {
      const x = pareto[i];
      if (
        c.arrivalMin <= x.arrivalMin &&
        c.transfers <= x.transfers &&
        (c.arrivalMin < x.arrivalMin || c.transfers < x.transfers)
      ) {
        pareto.splice(i, 1);
      }
    }
    pareto.push(c);
  }
  return pareto;
}

function reconstruct(finalLabel: Label, _destAccess: AccessStop): RouteLeg[] {
  const legs: RouteLeg[] = [];
  let cur: Label | null = finalLabel;
  while (cur && cur.prev) {
    legs.unshift(cur.prev.viaLeg);
    cur = cur.prev.fromLabel;
  }
  return legs;
}
