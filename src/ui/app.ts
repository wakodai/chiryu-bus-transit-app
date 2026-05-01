import { WALK_M_PER_MIN } from '../data/foot-transfers.js';
import { buildIndex, type GtfsIndex } from '../data/indexer.js';
import { loadGtfs } from '../data/loader.js';
import { MapView } from '../map/view.js';
import { activeServiceIds } from '../routing/calendar.js';
import { type NearStop, nearestStops } from '../routing/nearest.js';
import { findRoutes, type RouteCandidate } from '../routing/raptor.js';
import { selectTopCandidates, type SortKey } from '../routing/select.js';
import type { ShapePoint } from '../types.js';
import { formatMin, parseGtfsTime } from '../util/time.js';
import { ResultPanel } from './result.js';
// Cast a wide net by default so the routing layer is free to pick the most
// time-efficient stop, not just the geometrically nearest one. The walk-time
// penalty in RAPTOR keeps clearly-distant stops from winning unfairly.
const SEARCH_RADIUS_M = 700;
const SEARCH_RADIUS_FALLBACK_M = 1200;
const NEAREST_LIMIT = 30;

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
  const shiftBackBtn = document.getElementById('shift-back-btn') as HTMLButtonElement;
  const shiftFwdBtn = document.getElementById('shift-fwd-btn') as HTMLButtonElement;
  const nowBtn = document.getElementById('now-btn') as HTMLButtonElement;
  const showNetworkInput = document.getElementById('show-network') as HTMLInputElement;
  const instruction = document.getElementById('instruction') as HTMLElement;
  const resultContainer = document.getElementById('result-panel') as HTMLElement;

  function setDateTimeToNow() {
    const n = new Date();
    dateInput.value = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
    timeInput.value = `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
  }
  setDateTimeToNow();
  nowBtn.addEventListener('click', () => {
    setDateTimeToNow();
    if (origin && dest) runSearch(origin, dest);
  });

  let origin: Pin | null = null;
  let dest: Pin | null = null;
  let lastFront: RouteCandidate[] = [];
  let lastDepartureMin = 0;

  const result = new ResultPanel({
    container: resultContainer,
    onSelect: (_i, c) => {
      if (!origin || !dest) return;
      map.drawRoute({
        legs: c.legs,
        idx,
        shapesByShapeId,
        origin: { lat: origin.lat, lon: origin.lon },
        destination: { lat: dest.lat, lon: dest.lon },
      });
    },
    onStopClick: (stopId) => map.highlightStop(stopId),
  });

  // Initial network overlay so users can see where the service runs.
  const map = new MapView('map', (_e) => placePin(_e));
  map.setNetworkOverlay(idx, shapesByShapeId, showNetworkInput.checked);
  showNetworkInput.addEventListener('change', () => {
    map.setNetworkOverlay(idx, shapesByShapeId, showNetworkInput.checked);
  });

  function placePin(e: { lat: number; lon: number }) {
    const near = pickNearest(idx, e.lat, e.lon);
    if (!origin) {
      origin = { lat: e.lat, lon: e.lon, near };
      map.setOrigin(e.lat, e.lon);
      instruction.textContent = '到着地を地図上でクリックしてください';
    } else if (!dest) {
      dest = { lat: e.lat, lon: e.lon, near };
      map.setDestination(e.lat, e.lon);
      instruction.textContent = '出発時刻を確認して「検索」を押してください';
      swapBtn.disabled = false;
      searchBtn.disabled = false;
      shiftBackBtn.disabled = false;
      shiftFwdBtn.disabled = false;
    } else {
      // Replace destination on subsequent clicks
      dest = { lat: e.lat, lon: e.lon, near };
      map.setDestination(e.lat, e.lon);
      map.clearRoute();
      result.clear();
    }
  }

  resetBtn.addEventListener('click', () => {
    origin = null;
    dest = null;
    map.clearPins();
    map.clearRoute();
    result.clear();
    swapBtn.disabled = true;
    searchBtn.disabled = true;
    shiftBackBtn.disabled = true;
    shiftFwdBtn.disabled = true;
    instruction.textContent = '出発地を地図上でクリックしてください';
  });

  swapBtn.addEventListener('click', () => {
    if (!origin || !dest) return;
    [origin, dest] = [dest, origin];
    map.swapPins();
    map.clearRoute();
    result.clear();
  });

  searchBtn.addEventListener('click', () => {
    if (!origin || !dest) return;
    runSearch(origin, dest);
  });

  function shiftAndSearch(deltaMin: number) {
    if (!origin || !dest) return;
    const cur = parseGtfsTime(`${timeInput.value}:00`);
    const wrapped = ((cur + deltaMin) % (24 * 60) + 24 * 60) % (24 * 60);
    timeInput.value = formatMin(wrapped);
    runSearch(origin, dest);
  }

  shiftBackBtn.addEventListener('click', () => shiftAndSearch(-15));
  shiftFwdBtn.addEventListener('click', () => shiftAndSearch(15));

  function currentSort(): SortKey {
    const checked = document.querySelector(
      'input[name="sort"]:checked',
    ) as HTMLInputElement | null;
    return (checked?.value as SortKey) ?? 'earliest';
  }
  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="sort"]')) {
    radio.addEventListener('change', () => {
      if (lastFront.length > 0) {
        result.render(selectTopCandidates(lastFront, currentSort()), idx, lastDepartureMin);
      }
    });
  }

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
      lastFront = [];
      lastDepartureMin = departureMin;
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
      transfers: idx.footTransfers,
      maxTransfers: 2,
      transferBufferMin: 1,
    });
    lastFront = front;
    lastDepartureMin = departureMin;
    result.render(selectTopCandidates(front, currentSort()), idx, departureMin);
  }

  // Test/debug hook (no-op in production); helps E2E tests drive the app at lat/lon precision.
  if (typeof window !== 'undefined' && location.hostname === 'localhost') {
    (window as unknown as Record<string, unknown>).__chiryu = {
      simulateClick: (lat: number, lon: number) => {
        const near = pickNearest(idx, lat, lon);
        if (!origin) {
          origin = { lat, lon, near };
          map.setOrigin(lat, lon);
        } else if (!dest) {
          dest = { lat, lon, near };
          map.setDestination(lat, lon);
          swapBtn.disabled = false;
          searchBtn.disabled = false;
          shiftBackBtn.disabled = false;
          shiftFwdBtn.disabled = false;
        } else {
          dest = { lat, lon, near };
          map.setDestination(lat, lon);
        }
      },
      runSearch: () => {
        if (origin && dest) runSearch(origin, dest);
      },
    };
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
