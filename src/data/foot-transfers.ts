import type { Stop, Transfer } from '../types.js';
import { haversine } from '../util/distance.js';

/** 徒歩速度（m/分）。出発地・目的地の徒歩アクセスと徒歩乗換で共通利用する。 */
export const WALK_M_PER_MIN = 80;

/** 徒歩乗換として採用する最大距離（m）。約 5 分歩行に相当。 */
export const FOOT_TRANSFER_MAX_M = 350;

/**
 * 全停留所ペアから距離 ≤ maxWalkMeters のものを抽出し、双方向の Transfer
 * エッジとして返す。自己ループは含めない。
 *
 * 知立 GTFS-JP の transfers.txt は自己ループのみで実質空のため、これが
 * RAPTOR に渡す唯一の徒歩乗換ソースとなる。
 */
export function synthesizeFootTransfers(
  stops: Stop[],
  maxWalkMeters: number,
  walkMperMin: number,
): Transfer[] {
  const out: Transfer[] = [];
  for (let i = 0; i < stops.length; i++) {
    const a = stops[i];
    for (let j = i + 1; j < stops.length; j++) {
      const b = stops[j];
      const d = haversine(a.stop_lat, a.stop_lon, b.stop_lat, b.stop_lon);
      if (d > maxWalkMeters) continue;
      const minSec = Math.ceil(d / walkMperMin) * 60;
      out.push({
        from_stop_id: a.stop_id,
        to_stop_id: b.stop_id,
        transfer_type: 2,
        min_transfer_time: minSec,
      });
      out.push({
        from_stop_id: b.stop_id,
        to_stop_id: a.stop_id,
        transfer_type: 2,
        min_transfer_time: minSec,
      });
    }
  }
  return out;
}
