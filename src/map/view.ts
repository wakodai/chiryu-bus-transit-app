import L, { type LatLngExpression, type Map as LeafletMap, type Marker, type Polyline } from 'leaflet';
import type { GtfsIndex } from '../data/indexer.js';
import type { RouteLeg } from '../routing/raptor.js';
import type { ShapePoint, Stop } from '../types.js';

const CHIRYU_CENTER: LatLngExpression = [35.0102, 137.0494];

export interface PinClickEvent {
  lat: number;
  lon: number;
}

export class MapView {
  private map: LeafletMap;
  private originPin: Marker | null = null;
  private destPin: Marker | null = null;
  private candidateMarkers: Marker[] = [];
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
    this.originPin = L.marker([lat, lon], { title: '出発地' }).addTo(this.map).bindPopup('出発地');
  }

  setDestination(lat: number, lon: number) {
    if (this.destPin) this.map.removeLayer(this.destPin);
    this.destPin = L.marker([lat, lon], { title: '到着地' }).addTo(this.map).bindPopup('到着地');
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

  highlightCandidateStops(stops: Stop[]) {
    for (const m of this.candidateMarkers) this.map.removeLayer(m);
    this.candidateMarkers = stops.map((s) =>
      L.circleMarker([s.stop_lat, s.stop_lon], {
        radius: 6,
        color: '#1976d2',
        fillColor: '#90caf9',
        fillOpacity: 0.8,
        weight: 2,
      })
        .addTo(this.map)
        .bindTooltip(s.stop_name) as unknown as Marker,
    );
  }

  clearCandidates() {
    for (const m of this.candidateMarkers) this.map.removeLayer(m);
    this.candidateMarkers = [];
  }

  drawRoute(legs: RouteLeg[], idx: GtfsIndex, shapesByShapeId: Map<string, ShapePoint[]>) {
    for (const l of this.routeLayers) this.map.removeLayer(l);
    this.routeLayers = [];

    let stepNum = 1;
    for (const leg of legs) {
      if (leg.kind === 'ride' && leg.trip_id) {
        const trip = idx.tripById.get(leg.trip_id);
        const shape = trip ? shapesByShapeId.get(trip.shape_id) : undefined;
        const allStops = idx.stopTimesByTrip.get(leg.trip_id) ?? [];
        const fromIdx = allStops.findIndex((st) => st.stop_id === leg.fromStopId);
        const toIdx = allStops.findIndex((st) => st.stop_id === leg.toStopId);
        let coords: LatLngExpression[];
        if (shape && shape.length) {
          coords = shape.map((p) => [p.shape_pt_lat, p.shape_pt_lon] as LatLngExpression);
        } else {
          coords = allStops
            .slice(fromIdx, toIdx + 1)
            .map((st) => idx.stopById.get(st.stop_id))
            .filter((s): s is Stop => !!s)
            .map((s) => [s.stop_lat, s.stop_lon] as LatLngExpression);
        }
        const route = leg.route_id ? idx.routeById.get(leg.route_id) : undefined;
        const color = `#${route?.route_color ?? '1976d2'}`;
        const poly = L.polyline(coords, { color, weight: 5, opacity: 0.85 }).addTo(this.map);
        this.routeLayers.push(poly);

        for (const stopId of [leg.fromStopId, leg.toStopId]) {
          const s = idx.stopById.get(stopId);
          if (!s) continue;
          const m = L.marker([s.stop_lat, s.stop_lon], {
            icon: L.divIcon({
              className: 'numbered-pin',
              html: `<span style="background:#1976d2;color:#fff;border-radius:50%;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;font-size:12px;border:2px solid #fff;">${stepNum}</span>`,
              iconSize: [22, 22],
              iconAnchor: [11, 11],
            }),
          })
            .addTo(this.map)
            .bindTooltip(s.stop_name);
          this.routeLayers.push(m);
          stepNum++;
        }
      }
    }

    if (this.routeLayers.length) {
      const group = L.featureGroup(this.routeLayers as L.Layer[]);
      this.map.fitBounds(group.getBounds(), { padding: [40, 40] });
    }
  }

  clearRoute() {
    for (const l of this.routeLayers) this.map.removeLayer(l);
    this.routeLayers = [];
  }
}
