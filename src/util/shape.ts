import type { ShapePoint, Stop } from '../types.js';
import { haversine } from './distance.js';

/**
 * Find the shape index in [lo, hi] whose lat/lon is closest to (lat, lon).
 * Pure utility; callers are responsible for choosing the search window.
 */
export function nearestShapeIndex(
  shape: ShapePoint[],
  lat: number,
  lon: number,
  lo: number,
  hi: number,
): number {
  let bestIdx = lo;
  let bestDist = Infinity;
  for (let i = lo; i <= hi; i++) {
    const d = haversine(lat, lon, shape[i].shape_pt_lat, shape[i].shape_pt_lon);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Project a stop onto the trip's shape, restricting the search to a window
 * around the position estimated from `tripSeqIdx / (totalStops - 1)`.
 *
 * Why the window matters: on a loop route (e.g. shape 501003 in this dataset)
 * the bus visits the same area twice, so a global nearest-neighbor search can
 * pick the wrong pass — boarding 新田 (seq 6) was projecting onto the seq-24
 * pass at shape index 304, then the alighting search clipped to startIdx=304
 * had no nearby points and returned 304 too, collapsing the polyline to a
 * single point and silently dropping the route line. Anchoring the search to
 * the sequence-proportional position keeps each pass on the right half.
 */
export function projectStopOnShapeBySeq(
  shape: ShapePoint[],
  lat: number,
  lon: number,
  tripSeqIdx: number,
  totalStops: number,
  windowFraction = 0.15,
): number {
  if (shape.length === 0) return 0;
  if (totalStops <= 1) return nearestShapeIndex(shape, lat, lon, 0, shape.length - 1);
  const estimate = Math.round((tripSeqIdx * (shape.length - 1)) / (totalStops - 1));
  const w = Math.max(5, Math.round(shape.length * windowFraction));
  const lo = Math.max(0, estimate - w);
  const hi = Math.min(shape.length - 1, estimate + w);
  return nearestShapeIndex(shape, lat, lon, lo, hi);
}

/**
 * Build the polyline coordinates for a single ride leg by slicing the trip's
 * shape between the boarding and alighting stops. Falls back to a stop-by-stop
 * polyline if shape data is missing or the projection produces a degenerate
 * (start >= end) slice.
 */
export function rideLegShapeCoords(args: {
  shape: ShapePoint[] | undefined;
  fromStop: Stop | undefined;
  toStop: Stop | undefined;
  fromSeqIdx: number;
  toSeqIdx: number;
  totalStops: number;
  /** Stops along the trip in stop_sequence order; used for the fallback. */
  tripStops: Stop[];
}): [number, number][] {
  const { shape, fromStop, toStop, fromSeqIdx, toSeqIdx, totalStops, tripStops } = args;
  if (
    shape &&
    shape.length >= 2 &&
    fromStop &&
    toStop &&
    fromSeqIdx >= 0 &&
    toSeqIdx > fromSeqIdx
  ) {
    const startI = projectStopOnShapeBySeq(
      shape,
      fromStop.stop_lat,
      fromStop.stop_lon,
      fromSeqIdx,
      totalStops,
    );
    const endI = projectStopOnShapeBySeq(
      shape,
      toStop.stop_lat,
      toStop.stop_lon,
      toSeqIdx,
      totalStops,
    );
    if (endI > startI) {
      return shape.slice(startI, endI + 1).map((p) => [p.shape_pt_lat, p.shape_pt_lon]);
    }
  }
  // Fallback: straight lines between this leg's stops in trip order.
  if (fromSeqIdx >= 0 && toSeqIdx > fromSeqIdx) {
    return tripStops
      .slice(fromSeqIdx, toSeqIdx + 1)
      .map((s) => [s.stop_lat, s.stop_lon] as [number, number]);
  }
  return [];
}
