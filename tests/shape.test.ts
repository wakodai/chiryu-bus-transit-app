import { describe, expect, it } from 'vitest';
import type { ShapePoint, Stop } from '../src/types.js';
import {
  nearestShapeIndex,
  projectStopOnShapeBySeq,
  rideLegShapeCoords,
} from '../src/util/shape.js';

/**
 * Build a synthetic loop shape that passes near `loopStop` twice — once on the
 * outbound half of the trip (low indices) and once on the return half (high
 * indices) — and verify the boarding/alighting projection stays on the right
 * pass.
 *
 * This mirrors the live-data 5コース loop where 新田 (610_02) is visited at
 * stop_sequence 6 and the same lat/lon area is revisited at stop_sequence 24
 * via the 610_01 platform. The previous global-nearest projection collapsed
 * the route polyline to a single point in this case; the windowed projection
 * keeps it on the seq-6 pass.
 */
function buildLoopFixture() {
  const totalStops = 28;
  const shapeLen = 355;
  const shape: ShapePoint[] = [];
  // Two near-duplicate points at indices 30 (outbound 新田) and 304 (return).
  // Surround them with placeholder coordinates so the rest of the shape is far
  // from the boarding location.
  for (let i = 0; i < shapeLen; i++) {
    if (i === 30) {
      shape.push({ shape_id: 'L', shape_pt_lat: 35.0, shape_pt_lon: 137.05, shape_pt_sequence: i });
    } else if (i === 304) {
      // Slightly closer to (35.0001, 137.0501) so a global nearest-search
      // would pick this index for boarding lat/lon (35.0001, 137.0501).
      shape.push({ shape_id: 'L', shape_pt_lat: 35.0001, shape_pt_lon: 137.0501, shape_pt_sequence: i });
    } else if (i === 152) {
      // Alighting target at the midpoint.
      shape.push({ shape_id: 'L', shape_pt_lat: 35.01, shape_pt_lon: 137.07, shape_pt_sequence: i });
    } else {
      // Far-away filler.
      shape.push({ shape_id: 'L', shape_pt_lat: 36.0, shape_pt_lon: 138.0, shape_pt_sequence: i });
    }
  }
  return { shape, totalStops };
}

describe('shape projection', () => {
  it('nearestShapeIndex returns the closest index in the window', () => {
    const shape: ShapePoint[] = [
      { shape_id: 'X', shape_pt_lat: 0, shape_pt_lon: 0, shape_pt_sequence: 0 },
      { shape_id: 'X', shape_pt_lat: 1, shape_pt_lon: 0, shape_pt_sequence: 1 },
      { shape_id: 'X', shape_pt_lat: 2, shape_pt_lon: 0, shape_pt_sequence: 2 },
    ];
    expect(nearestShapeIndex(shape, 0.4, 0, 0, 2)).toBe(0);
    expect(nearestShapeIndex(shape, 1.6, 0, 0, 2)).toBe(2);
    // Window restricts the search.
    expect(nearestShapeIndex(shape, 0, 0, 1, 2)).toBe(1);
  });

  it('projectStopOnShapeBySeq picks the right loop pass for an early seq', () => {
    const { shape, totalStops } = buildLoopFixture();
    // Boarding lat/lon are very slightly closer to index 304 globally,
    // which is the bug trigger.
    const idx = projectStopOnShapeBySeq(shape, 35.0001, 137.0501, 5, totalStops);
    expect(idx).toBe(30);
  });

  it('projectStopOnShapeBySeq picks the right pass for a late seq', () => {
    const { shape, totalStops } = buildLoopFixture();
    const idx = projectStopOnShapeBySeq(shape, 35.0001, 137.0501, 23, totalStops);
    expect(idx).toBe(304);
  });

  it('rideLegShapeCoords returns >=2 points for a normal in-window leg', () => {
    const { shape, totalStops } = buildLoopFixture();
    const fromStop: Stop = { stop_id: 'B', stop_name: 'B', stop_lat: 35.0001, stop_lon: 137.0501 };
    const toStop: Stop = { stop_id: 'A', stop_name: 'A', stop_lat: 35.01, stop_lon: 137.07 };
    const coords = rideLegShapeCoords({
      shape,
      fromStop,
      toStop,
      fromSeqIdx: 5,
      toSeqIdx: 13,
      totalStops,
      tripStops: [fromStop, toStop],
    });
    // Outbound 新田 (idx 30) → 昭和５丁目-equivalent (idx 152) → 122 inclusive points.
    expect(coords.length).toBe(152 - 30 + 1);
    expect(coords[0]).toEqual([35.0, 137.05]);
    expect(coords.at(-1)).toEqual([35.01, 137.07]);
  });

  it('rideLegShapeCoords falls back to stop polyline when shape is missing', () => {
    const fromStop: Stop = { stop_id: 'B', stop_name: 'B', stop_lat: 35.0, stop_lon: 137.05 };
    const midStop: Stop = { stop_id: 'M', stop_name: 'M', stop_lat: 35.005, stop_lon: 137.06 };
    const toStop: Stop = { stop_id: 'A', stop_name: 'A', stop_lat: 35.01, stop_lon: 137.07 };
    const coords = rideLegShapeCoords({
      shape: undefined,
      fromStop,
      toStop,
      fromSeqIdx: 0,
      toSeqIdx: 2,
      totalStops: 3,
      tripStops: [fromStop, midStop, toStop],
    });
    expect(coords).toEqual([
      [35.0, 137.05],
      [35.005, 137.06],
      [35.01, 137.07],
    ]);
  });
});
