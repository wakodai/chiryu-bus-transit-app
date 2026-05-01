import L, { type LatLngExpression, type Layer, type Map as LeafletMap, type Marker } from 'leaflet';
import type { GtfsIndex } from '../data/indexer.js';
import type { RouteLeg } from '../routing/raptor.js';
import type { ShapePoint, Stop } from '../types.js';
import { haversine } from '../util/distance.js';
import { rideLegShapeCoords } from '../util/shape.js';

const CHIRYU_CENTER: LatLngExpression = [35.0017, 137.0489];

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

function makeStopIcon(label: string, bg: string, big = false): L.DivIcon {
  const size = big ? 28 : 22;
  return L.divIcon({
    className: 'stop-pin',
    html: `<span style="background:${bg};color:#fff;border-radius:50%;width:${size}px;height:${size}px;display:inline-flex;align-items:center;justify-content:center;font-size:${big ? 13 : 12}px;font-weight:bold;border:2px solid #fff;box-shadow:0 0 4px rgba(0,0,0,0.4);">${label}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/** Compass bearing in degrees (0=north, 90=east) from a→b. */
function bearingDeg(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dy = bLat - aLat;
  const dx = (bLon - aLon) * Math.cos((aLat * Math.PI) / 180);
  return (Math.atan2(dx, dy) * 180) / Math.PI;
}

function makeArrowIcon(angleDeg: number, color: string): L.DivIcon {
  // Inline SVG triangle with a dark stroke so light route colors (yellow, pale
  // orange, lavender) stay legible against OSM tiles regardless of fill.
  const html = `<svg width="22" height="22" viewBox="0 0 22 22" style="transform:rotate(${angleDeg}deg)" xmlns="http://www.w3.org/2000/svg"><path d="M11 2 L19 19 L11 14 L3 19 Z" fill="${color}" stroke="#1a1a1a" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
  return L.divIcon({
    className: 'arrow-icon',
    html,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

/** Pick ~3 evenly-spaced points along the polyline by cumulative distance. */
function pickArrowPositions(
  coords: [number, number][],
): { lat: number; lon: number; angle: number }[] {
  if (coords.length < 2) return [];
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1] + haversine(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]));
  }
  const total = cum[cum.length - 1];
  if (total === 0) return [];
  const targets = [0.25, 0.55, 0.85];
  const out: { lat: number; lon: number; angle: number }[] = [];
  for (const t of targets) {
    const target = t * total;
    let i = 1;
    while (i < cum.length && cum[i] < target) i++;
    if (i >= coords.length) i = coords.length - 1;
    const [aLat, aLon] = coords[i - 1];
    const [bLat, bLon] = coords[i];
    const segLen = cum[i] - cum[i - 1];
    const f = segLen === 0 ? 0 : (target - cum[i - 1]) / segLen;
    const lat = aLat + (bLat - aLat) * f;
    const lon = aLon + (bLon - aLon) * f;
    out.push({ lat, lon, angle: bearingDeg(aLat, aLon, bLat, bLon) });
  }
  return out;
}

export class MapView {
  private map: LeafletMap;
  private originPin: Marker | null = null;
  private destPin: Marker | null = null;
  private routeLayers: Layer[] = [];
  /** Lookup of intermediate-stop circle markers by stop_id, used by highlightStop. */
  private intermediateMarkers = new Map<string, L.CircleMarker>();
  /** Transient highlight overlay; replaced on each highlightStop call. */
  private highlightLayer: L.CircleMarker | null = null;
  /** Network coverage overlay (all stops + all route shapes), togglable. */
  private networkLayer: L.LayerGroup | null = null;

  constructor(elementId: string, onClick: (e: PinClickEvent) => void) {
    this.map = L.map(elementId).setView(CHIRYU_CENTER, 14);

    const cartoAttribution =
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
    const osmAttribution =
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

    const positron = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: cartoAttribution,
      subdomains: 'abcd',
      maxZoom: 19,
    });
    const voyager = L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      { attribution: cartoAttribution, subdomains: 'abcd', maxZoom: 19 },
    );
    const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: osmAttribution,
      maxZoom: 19,
    });

    positron.addTo(this.map);
    L.control
      .layers(
        {
          Positron: positron,
          Voyager: voyager,
          OpenStreetMap: osm,
        },
        undefined,
        { position: 'topright', collapsed: true },
      )
      .addTo(this.map);

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
    this.intermediateMarkers.clear();
    if (this.highlightLayer) {
      this.map.removeLayer(this.highlightLayer);
      this.highlightLayer = null;
    }

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
      const allStops = idx.stopTimesByTrip.get(leg.trip_id) ?? [];
      // Prefer the boarding/alighting indices RAPTOR recorded so we slice the
      // correct loop pass when a trip revisits a stop_id; only fall back to
      // findIndex for legs produced before this field was added.
      const fromSeqIdx =
        leg.fromSeqIdx ?? allStops.findIndex((st) => st.stop_id === leg.fromStopId);
      const toSeqIdx =
        leg.toSeqIdx ?? allStops.findIndex((st) => st.stop_id === leg.toStopId);
      const tripStops = allStops
        .map((st) => idx.stopById.get(st.stop_id))
        .filter((s): s is Stop => !!s);
      const coords = rideLegShapeCoords({
        shape,
        fromStop,
        toStop,
        fromSeqIdx,
        toSeqIdx,
        totalStops: allStops.length,
        tripStops,
      });
      const route = leg.route_id ? idx.routeById.get(leg.route_id) : undefined;
      const color = `#${route?.route_color ?? '1976d2'}`;
      // Dark casing line underneath the colored route line so pale colors
      // (yellow #FFFF00, lavender #CC99FF, pale orange #FFC000) stay visible
      // against the OSM tile background.
      const casing = L.polyline(coords as LatLngExpression[], {
        color: '#1a1a1a',
        weight: 9,
        opacity: 0.85,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(this.map);
      this.routeLayers.push(casing);
      const poly = L.polyline(coords as LatLngExpression[], {
        color,
        weight: 6,
        opacity: 0.95,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(this.map);
      this.routeLayers.push(poly);

      // Direction arrows along the polyline
      for (const pos of pickArrowPositions(coords)) {
        const arr = L.marker([pos.lat, pos.lon], {
          icon: makeArrowIcon(pos.angle, color),
          interactive: false,
          keyboard: false,
        }).addTo(this.map);
        this.routeLayers.push(arr);
      }

      // Intermediate stop markers (stops the bus passes through without alighting)
      for (const sid of leg.intermediateStopIds ?? []) {
        const s = idx.stopById.get(sid);
        if (!s) continue;
        const cm = L.circleMarker([s.stop_lat, s.stop_lon], {
          radius: 5,
          color: '#fff',
          fillColor: color,
          fillOpacity: 1,
          weight: 2,
        })
          .addTo(this.map)
          .bindTooltip(`経由: ${s.stop_name}`);
        this.routeLayers.push(cm);
        this.intermediateMarkers.set(sid, cm);
      }

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
    const all: Layer[] = [...this.routeLayers];
    if (this.originPin) all.push(this.originPin);
    if (this.destPin) all.push(this.destPin);
    const group = L.featureGroup(all);
    this.map.fitBounds(group.getBounds(), { padding: [40, 40] });
  }

  clearRoute() {
    for (const l of this.routeLayers) this.map.removeLayer(l);
    this.routeLayers = [];
    this.intermediateMarkers.clear();
    if (this.highlightLayer) {
      this.map.removeLayer(this.highlightLayer);
      this.highlightLayer = null;
    }
  }

  /**
   * Draw a translucent network of every bus stop and every route shape so the
   * user can see where the service operates before clicking. Non-interactive
   * so map clicks pass through to the pin-placement handler.
   */
  setNetworkOverlay(
    idx: GtfsIndex,
    shapesByShapeId: Map<string, ShapePoint[]>,
    visible: boolean,
  ) {
    if (this.networkLayer) {
      this.map.removeLayer(this.networkLayer);
      this.networkLayer = null;
    }
    if (!visible) return;
    const group = L.layerGroup();
    // One polyline per unique shape, colored by its route's route_color.
    const shapeIdToColor = new Map<string, string>();
    for (const trip of idx.tripById.values()) {
      if (shapeIdToColor.has(trip.shape_id)) continue;
      const route = idx.routeById.get(trip.route_id);
      if (route) shapeIdToColor.set(trip.shape_id, `#${route.route_color}`);
    }
    for (const [shapeId, color] of shapeIdToColor) {
      const shape = shapesByShapeId.get(shapeId);
      if (!shape || shape.length < 2) continue;
      L.polyline(
        shape.map((p) => [p.shape_pt_lat, p.shape_pt_lon] as LatLngExpression),
        { color, weight: 2, opacity: 0.9, interactive: false },
      ).addTo(group);
    }
    for (const stop of idx.stopById.values()) {
      L.circleMarker([stop.stop_lat, stop.stop_lon], {
        radius: 3,
        color: '#444',
        weight: 1,
        fillColor: '#fff',
        fillOpacity: 0.9,
        opacity: 0.6,
        interactive: false,
      }).addTo(group);
    }
    group.addTo(this.map);
    // Send the network overlay to the back so selected-route lines and pins draw on top.
    group.eachLayer((l) => {
      if ('bringToBack' in l && typeof (l as L.Path).bringToBack === 'function') {
        (l as L.Path).bringToBack();
      }
    });
    this.networkLayer = group;
  }

  /** Pan to and pulse-highlight an intermediate stop by stop_id. */
  highlightStop(stopId: string) {
    const m = this.intermediateMarkers.get(stopId);
    if (!m) return;
    if (this.highlightLayer) {
      this.map.removeLayer(this.highlightLayer);
      this.highlightLayer = null;
    }
    const ll = m.getLatLng();
    this.highlightLayer = L.circleMarker(ll, {
      radius: 14,
      color: '#ff6f00',
      weight: 4,
      fillColor: '#fff59d',
      fillOpacity: 0.6,
    }).addTo(this.map);
    this.map.panTo(ll);
    m.openTooltip();
  }
}
