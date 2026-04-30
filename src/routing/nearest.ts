import type { GtfsIndex } from '../data/indexer.js';
import type { Stop } from '../types.js';
import { haversine } from '../util/distance.js';

export interface NearStop {
  stop: Stop;
  distance: number;
}

const DEG_PER_METER_LAT = 1 / 111000;
const DEG_PER_METER_LON = 1 / (111000 * Math.cos((35 * Math.PI) / 180));

export function nearestStops(
  idx: GtfsIndex,
  lat: number,
  lon: number,
  radiusM: number,
  limit: number,
): NearStop[] {
  const dLat = radiusM * DEG_PER_METER_LAT;
  const dLon = radiusM * DEG_PER_METER_LON;
  const candidates = idx.stopTree.search({
    minX: lon - dLon,
    minY: lat - dLat,
    maxX: lon + dLon,
    maxY: lat + dLat,
  });

  const within: NearStop[] = [];
  for (const c of candidates) {
    const d = haversine(lat, lon, c.stop.stop_lat, c.stop.stop_lon);
    if (d <= radiusM) within.push({ stop: c.stop, distance: d });
  }
  within.sort((a, b) => a.distance - b.distance);
  return within.slice(0, limit);
}
