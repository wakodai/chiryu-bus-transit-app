import { describe, expect, it } from 'vitest';
import type { Stop } from '../src/types.js';
import {
  FOOT_TRANSFER_MAX_M,
  WALK_M_PER_MIN,
  synthesizeFootTransfers,
} from '../src/data/foot-transfers.js';

// 緯度 35° 付近で 100m に相当する経度差は約 0.001097°。
const ONE_HUNDRED_M_LON = 0.001097;

const stops: Stop[] = [
  { stop_id: 'A', stop_name: 'A', stop_lat: 35, stop_lon: 0 },
  // B: A から東に約 100m（threshold 350m 内）
  { stop_id: 'B', stop_name: 'B', stop_lat: 35, stop_lon: ONE_HUNDRED_M_LON },
  // C: A から東に約 1000m（threshold 外）
  { stop_id: 'C', stop_name: 'C', stop_lat: 35, stop_lon: ONE_HUNDRED_M_LON * 10 },
];

describe('synthesizeFootTransfers', () => {
  it('emits both directions for stop pairs within the threshold', () => {
    const out = synthesizeFootTransfers(stops, 350, 80);
    const ab = out.find((t) => t.from_stop_id === 'A' && t.to_stop_id === 'B');
    const ba = out.find((t) => t.from_stop_id === 'B' && t.to_stop_id === 'A');
    expect(ab).toBeDefined();
    expect(ba).toBeDefined();
    expect(ab!.min_transfer_time).toBe(ba!.min_transfer_time);
  });

  it('omits pairs over the threshold', () => {
    const out = synthesizeFootTransfers(stops, 350, 80);
    expect(out.find((t) => t.to_stop_id === 'C' || t.from_stop_id === 'C')).toBeUndefined();
  });

  it('emits no self-loops', () => {
    const out = synthesizeFootTransfers(stops, 350, 80);
    expect(out.every((t) => t.from_stop_id !== t.to_stop_id)).toBe(true);
  });

  it('encodes min_transfer_time as ceil(distance/walkMperMin)*60 seconds', () => {
    const out = synthesizeFootTransfers(stops, 350, 80);
    const ab = out.find((t) => t.from_stop_id === 'A' && t.to_stop_id === 'B')!;
    // 100m / 80 m/min = 1.25 min → ceil = 2 min → 120 秒
    expect(ab.min_transfer_time).toBe(120);
  });

  it('exposes the threshold and walk speed constants', () => {
    expect(FOOT_TRANSFER_MAX_M).toBe(350);
    expect(WALK_M_PER_MIN).toBe(80);
  });
});
