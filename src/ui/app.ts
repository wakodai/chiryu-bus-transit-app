import { buildIndex, type GtfsIndex } from '../data/indexer.js';
import { loadGtfs } from '../data/loader.js';
import { MapView } from '../map/view.js';
import { activeServiceIds } from '../routing/calendar.js';
import { type NearStop, nearestStops } from '../routing/nearest.js';
import { findRoutes } from '../routing/raptor.js';
import { selectTopCandidates } from '../routing/select.js';
import type { ShapePoint } from '../types.js';
import { parseGtfsTime } from '../util/time.js';
import { ResultPanel } from './result.js';

const WALK_M_PER_MIN = 80;
const SEARCH_RADIUS_M = 500;
const SEARCH_RADIUS_FALLBACK_M = 1000;
const NEAREST_LIMIT = 3;

type Pin = { lat: number; lon: number; near: NearStop[] };

export async function bootstrap() {
  const data = await loadGtfs();
  const idx = buildIndex(data);
  const shapesByShapeId = groupShapes(data.shapes);

  const dateInput = document.getElementById('search-date') as HTMLInputElement;
  const timeInput = document.getElementById('search-time') as HTMLInputElement;
  const resetBtn = document.getElementById('reset-btn') as HTMLButtonElement;
  const swapBtn = document.getElementById('swap-btn') as HTMLButtonElement;
  const searchBtn = document.getElementById('search-btn') as HTMLButtonElement;
  const instruction = document.getElementById('instruction') as HTMLElement;
  const resultContainer = document.getElementById('result-panel') as HTMLElement;

  const now = new Date();
  dateInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  timeInput.value = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  let origin: Pin | null = null;
  let dest: Pin | null = null;

  const result = new ResultPanel({
    container: resultContainer,
    onSelect: (_i, c) => map.drawRoute(c.legs, idx, shapesByShapeId),
  });

  const map = new MapView('map', (e) => {
    const near = pickNearest(idx, e.lat, e.lon);
    if (!origin) {
      origin = { lat: e.lat, lon: e.lon, near };
      map.setOrigin(e.lat, e.lon);
      map.highlightCandidateStops(near.map((n) => n.stop));
      instruction.textContent = '到着地を地図上でクリックしてください';
    } else if (!dest) {
      dest = { lat: e.lat, lon: e.lon, near };
      map.setDestination(e.lat, e.lon);
      const union = [...origin.near, ...dest.near].map((n) => n.stop);
      map.highlightCandidateStops(union);
      instruction.textContent = '出発時刻を確認して「検索」を押してください';
      swapBtn.disabled = false;
      searchBtn.disabled = false;
    } else {
      dest = { lat: e.lat, lon: e.lon, near };
      map.setDestination(e.lat, e.lon);
      const union = [...origin.near, ...dest.near].map((n) => n.stop);
      map.highlightCandidateStops(union);
    }
  });

  resetBtn.addEventListener('click', () => {
    origin = null;
    dest = null;
    map.clearPins();
    map.clearCandidates();
    map.clearRoute();
    result.clear();
    swapBtn.disabled = true;
    searchBtn.disabled = true;
    instruction.textContent = '出発地を地図上でクリックしてください';
  });

  swapBtn.addEventListener('click', () => {
    if (!origin || !dest) return;
    [origin, dest] = [dest, origin];
    map.swapPins();
    const union = [...origin.near, ...dest.near].map((n) => n.stop);
    map.highlightCandidateStops(union);
  });

  searchBtn.addEventListener('click', () => {
    if (!origin || !dest) return;
    runSearch(origin, dest);
  });

  function pickNearest(idx2: GtfsIndex, lat: number, lon: number): NearStop[] {
    let near = nearestStops(idx2, lat, lon, SEARCH_RADIUS_M, NEAREST_LIMIT);
    if (near.length === 0) {
      near = nearestStops(idx2, lat, lon, SEARCH_RADIUS_FALLBACK_M, NEAREST_LIMIT);
    }
    return near;
  }

  function runSearch(o: Pin, d: Pin) {
    if (o.near.length === 0 || d.near.length === 0) {
      result.render([], idx, 0);
      return;
    }
    const [yyyy, mm, dd] = dateInput.value.split('-').map(Number);
    const date = new Date(yyyy, mm - 1, dd);
    const departureMin = parseGtfsTime(`${timeInput.value}:00`);
    const services = activeServiceIds(date, data.calendar, data.calendarDates);
    if (services.size === 0) {
      result.render([], idx, departureMin);
      return;
    }
    const front = findRoutes(idx, {
      originStops: o.near.map((n) => ({
        stop_id: n.stop.stop_id,
        walkMin: Math.ceil(n.distance / WALK_M_PER_MIN),
      })),
      destStops: d.near.map((n) => ({
        stop_id: n.stop.stop_id,
        walkMin: Math.ceil(n.distance / WALK_M_PER_MIN),
      })),
      departureMin,
      activeServices: services,
      transfers: data.transfers,
      maxTransfers: 2,
    });
    const top = selectTopCandidates(front);
    result.render(top, idx, departureMin);
  }
}

function groupShapes(shapes: ShapePoint[]): Map<string, ShapePoint[]> {
  const m = new Map<string, ShapePoint[]>();
  for (const s of shapes) {
    let arr = m.get(s.shape_id);
    if (!arr) {
      arr = [];
      m.set(s.shape_id, arr);
    }
    arr.push(s);
  }
  for (const arr of m.values()) arr.sort((a, b) => a.shape_pt_sequence - b.shape_pt_sequence);
  return m;
}
