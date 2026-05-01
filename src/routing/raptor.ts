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
  /**
   * 0-based index of the boarding stop within `idx.stopTimesByTrip[trip_id]`.
   * Disambiguates trips that revisit the same stop_id (e.g. the 5コース loop
   * where 500_01 and 600_01 each appear twice). Only set for `kind === 'ride'`.
   */
  fromSeqIdx?: number;
  /** 0-based index of the alighting stop within stopTimesByTrip[trip_id]. */
  toSeqIdx?: number;
}

export interface RouteCandidate {
  arrivalMin: number;
  transfers: number;
  legs: RouteLeg[];
  /** Walking minutes from user-clicked origin to the chosen boarding stop. */
  originWalkMin: number;
  /** Walking minutes from the chosen alighting stop to user-clicked destination. */
  destWalkMin: number;
  /** Sum of all walking minutes (origin walk + transfer walks + dest walk). */
  walkTotalMin: number;
}

export interface FindRoutesParams {
  originStops: AccessStop[];
  destStops: AccessStop[];
  departureMin: number;
  activeServices: Set<string>;
  transfers: Transfer[];
  maxTransfers: number;
  /**
   * 乗換時に加算する分数。前レグが ride（label.transfers >= 0）の状態から
   * 次の bus に乗車する判定で `dep.departure_min >= label.arrival + transferBufferMin`
   * を要求する。出発地からの初回乗車（seed: transfers === -1）には適用しない。
   */
  transferBufferMin: number;
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

  // Seed the frontier with origin walk-access labels but DO NOT register them in
  // the main `labels` map. Walk-access labels carry transfers=-1 as a marker
  // that no ride has been taken yet; if they entered `labels`, their -1
  // would dominate any ride-completed label at the same stop (e.g., when the
  // user's destination cluster shares stops with the origin cluster), silently
  // wiping out the actual bus route.
  for (const o of p.originStops) {
    const arr = p.departureMin + o.walkMin;
    const seed: Label = { arrival: arr, transfers: -1, prev: null };
    const cur = frontier.get(o.stop_id);
    if (!cur || arr < cur.arrival) frontier.set(o.stop_id, seed);
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
      // 出発地からの初回乗車（seed: transfers === -1）にはバッファを適用しない。
      // 既に ride 完了している label からの再乗車にのみ +transferBufferMin を要求する。
      const minBoardMin =
        label.transfers >= 0 ? label.arrival + p.transferBufferMin : label.arrival;
      for (const dep of deps) {
        if (dep.departure_min < minBoardMin) continue;
        const trip = idx.tripById.get(dep.trip_id);
        if (!trip || !p.activeServices.has(trip.service_id)) continue;
        const sts = idx.stopTimesByTrip.get(dep.trip_id);
        if (!sts) continue;
        const depIdx = sts.findIndex((s) => s.stop_sequence === dep.stop_sequence);
        if (depIdx < 0) continue;
        const intermediate: string[] = [];
        for (let i = depIdx + 1; i < sts.length; i++) {
          const st = sts[i];
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
                fromSeqIdx: depIdx,
                toSeqIdx: i,
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
      const transferWalkMin = legs
        .filter((l) => l.kind === 'walk')
        .reduce((sum, l) => sum + (l.toMin - l.fromMin), 0);
      const walkTotalMin = originWalkMin + d.walkMin + transferWalkMin;
      candidates.push({
        arrivalMin: arrivalAtUserDest,
        transfers: lbl.transfers,
        legs,
        originWalkMin,
        destWalkMin: d.walkMin,
        walkTotalMin,
      });
    }
  }

  // Pareto over (arrivalMin, walkTotalMin) so both "fastest total trip" and
  // "least walking" perspectives are represented in the survivor set. Tie-break
  // by transfers so we never keep a strictly-worse-on-transfers candidate at
  // the same (arrival, walk).
  const pareto: RouteCandidate[] = [];
  const dom = (a: RouteCandidate, b: RouteCandidate) =>
    a.arrivalMin <= b.arrivalMin &&
    a.walkTotalMin <= b.walkTotalMin &&
    a.transfers <= b.transfers &&
    (a.arrivalMin < b.arrivalMin ||
      a.walkTotalMin < b.walkTotalMin ||
      a.transfers < b.transfers);
  for (const c of candidates) {
    if (pareto.some((x) => dom(x, c))) continue;
    for (let i = pareto.length - 1; i >= 0; i--) {
      if (dom(c, pareto[i])) pareto.splice(i, 1);
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
