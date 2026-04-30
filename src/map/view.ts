import L, { type LatLngExpression, type Map as LeafletMap, type Marker, type Polyline } from 'leaflet';
import type { GtfsIndex } from '../data/indexer.js';
import type { RouteLeg } from '../routing/raptor.js';
import type { ShapePoint, Stop } from '../types.js';
import { haversine } from '../util/distance.js';

const CHIRYU_CENTER: LatLngExpression = [35.0102, 137.0494];

export interface PinClickEvent {
  lat: number;
  lon: number;
}

export interface DrawRouteOptions {
  legs: RouteLeg[];
  idx: GtfsIndex;
  shapesByShapeId: Map<string, ShapePoint[]>;
  origin: { lat: number; lon: number };
  destination: { lat: number; lon: number };
}

function projectStopOnShape(
  shape: ShapePoint[],
  lat: number,
  lon: number,
  startIdx = 0,
): number {
  let bestIdx = startIdx;
  let bestDist = Infinity;
  for (let i = startIdx; i < shape.length; i++) {
    const d = haversine(lat, lon, shape[i].shape_pt_lat, shape[i].shape_pt_lon);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function makeStopIcon(label: string, bg: string, big = false): L.DivIcon {
  const size = big ? 28 : 22;
  return L.divIcon({
    className: 'stop-pin',
    html: `<span style="background:${bg};color:#fff;border-radius:50%;width:${size}px;height:${size}px;display:inline-flex;align-items:center;justify-content:center;font-size:${big ? 13 : 12}px;font-weight:bold;border:2px solid #fff;box-shadow:0 0 4px rgba(0,0,0,0.4);">${label}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export class MapView {
  private map: LeafletMap;
  private originPin: Marker | null = null;
  private destPin: Marker | null = null;
  private routeLayers: (Polyline | Marker)[] = [];

  constructor(elementId: string, onClick: (e: PinClickEvent) => void) {
    this.map = L.map(elementId).setView(CHIRYU_CENTER, 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(this.map);
    this.map.on('click', (e) => onClick({ lat: e.latlng.lat, lon: e.latlng.lng }));
  }

  setOrigin(lat: number, lon: number) {
    if (this.originPin) this.map.removeLayer(this.originPin);
    this.originPin = L.marker([lat, lon], {
      icon: makeStopIcon('出', '#388e3c', true),
      title: '出発地',
    }).addTo(this.map);
  }

  setDestination(lat: number, lon: number) {
    if (this.destPin) this.map.removeLayer(this.destPin);
    this.destPin = L.marker([lat, lon], {
      icon: makeStopIcon('着', '#d32f2f', true),
      title: '到着地',
    }).addTo(this.map);
  }

  clearPins() {
    if (this.originPin) {
      this.map.removeLayer(this.originPin);
      this.originPin = null;
    }
    if (this.destPin) {
      this.map.removeLayer(this.destPin);
      this.destPin = null;
    }
  }

  swapPins() {
    if (!this.originPin || !this.destPin) return;
    const o = this.originPin.getLatLng();
    const d = this.destPin.getLatLng();
    this.setOrigin(d.lat, d.lng);
    this.setDestination(o.lat, o.lng);
  }

  drawRoute(opts: DrawRouteOptions) {
    for (const l of this.routeLayers) this.map.removeLayer(l);
    this.routeLayers = [];

    const { legs, idx, shapesByShapeId, origin, destination } = opts;
    const rideLegs = legs.filter((l) => l.kind === 'ride');
    if (rideLegs.length === 0) return;

    const firstBoard = idx.stopById.get(rideLegs[0].fromStopId);
    const lastAlight = idx.stopById.get(rideLegs[rideLegs.length - 1].toStopId);

    // Walking line: origin pin → boarding stop
    if (firstBoard) {
      const walkOrigin = L.polyline(
        [
          [origin.lat, origin.lon],
          [firstBoard.stop_lat, firstBoard.stop_lon],
        ],
        { color: '#666', weight: 3, opacity: 0.7, dashArray: '4 6' },
      ).addTo(this.map);
      this.routeLayers.push(walkOrigin);
    }

    // Per-leg polylines (route_color, sliced to boarding–alighting segment of shape)
    rideLegs.forEach((leg, legIdx) => {
      if (!leg.trip_id) return;
      const trip = idx.tripById.get(leg.trip_id);
      const shape = trip ? shapesByShapeId.get(trip.shape_id) : undefined;
      const fromStop = idx.stopById.get(leg.fromStopId);
      const toStop = idx.stopById.get(leg.toStopId);
      let coords: LatLngExpression[];
      if (shape && shape.length && fromStop && toStop) {
        const startI = projectStopOnShape(shape, fromStop.stop_lat, fromStop.stop_lon);
        const endI = projectStopOnShape(shape, toStop.stop_lat, toStop.stop_lon, startI);
        coords = shape
          .slice(startI, endI + 1)
          .map((p) => [p.shape_pt_lat, p.shape_pt_lon] as LatLngExpression);
      } else {
        const allStops = idx.stopTimesByTrip.get(leg.trip_id) ?? [];
        const fromIdx = allStops.findIndex((st) => st.stop_id === leg.fromStopId);
        const toIdx = allStops.findIndex((st) => st.stop_id === leg.toStopId);
        coords = allStops
          .slice(fromIdx, toIdx + 1)
          .map((st) => idx.stopById.get(st.stop_id))
          .filter((s): s is Stop => !!s)
          .map((s) => [s.stop_lat, s.stop_lon] as LatLngExpression);
      }
      const route = leg.route_id ? idx.routeById.get(leg.route_id) : undefined;
      const color = `#${route?.route_color ?? '1976d2'}`;
      const poly = L.polyline(coords, { color, weight: 6, opacity: 0.9 }).addTo(this.map);
      this.routeLayers.push(poly);

      // Transfer point: end of this leg if not last
      if (legIdx < rideLegs.length - 1 && toStop) {
        const m = L.marker([toStop.stop_lat, toStop.stop_lon], {
          icon: makeStopIcon('乗', '#1976d2'),
          title: `乗継: ${toStop.stop_name}`,
        })
          .addTo(this.map)
          .bindTooltip(`乗継: ${toStop.stop_name}`);
        this.routeLayers.push(m);
      }
    });

    // Boarding & alighting stop markers
    if (firstBoard) {
      const m = L.marker([firstBoard.stop_lat, firstBoard.stop_lon], {
        icon: makeStopIcon('乗', '#388e3c', true),
        title: `出発: ${firstBoard.stop_name}`,
      })
        .addTo(this.map)
        .bindTooltip(`出発: ${firstBoard.stop_name}`, { permanent: true, direction: 'top' });
      this.routeLayers.push(m);
    }
    if (lastAlight) {
      const m = L.marker([lastAlight.stop_lat, lastAlight.stop_lon], {
        icon: makeStopIcon('降', '#d32f2f', true),
        title: `到着: ${lastAlight.stop_name}`,
      })
        .addTo(this.map)
        .bindTooltip(`到着: ${lastAlight.stop_name}`, { permanent: true, direction: 'top' });
      this.routeLayers.push(m);
    }

    // Walking line: alighting stop → destination pin
    if (lastAlight) {
      const walkDest = L.polyline(
        [
          [lastAlight.stop_lat, lastAlight.stop_lon],
          [destination.lat, destination.lon],
        ],
        { color: '#666', weight: 3, opacity: 0.7, dashArray: '4 6' },
      ).addTo(this.map);
      this.routeLayers.push(walkDest);
    }

    // Fit bounds
    const all: L.Layer[] = [...this.routeLayers];
    if (this.originPin) all.push(this.originPin);
    if (this.destPin) all.push(this.destPin);
    const group = L.featureGroup(all);
    this.map.fitBounds(group.getBounds(), { padding: [40, 40] });
  }

  clearRoute() {
    for (const l of this.routeLayers) this.map.removeLayer(l);
    this.routeLayers = [];
  }
}
