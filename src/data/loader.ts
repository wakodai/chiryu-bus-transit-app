import type {
  CalendarDate,
  CalendarRow,
  FeedInfo,
  GtfsData,
  Route,
  ShapePoint,
  Stop,
  StopTime,
  Transfer,
  Trip,
} from '../types.js';
import { parseGtfsTime } from '../util/time.js';

async function loadJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

const yes = (v: string) => v === '1';

export async function loadGtfs(base = `${import.meta.env.BASE_URL}gtfs`): Promise<GtfsData> {
  const [
    stopsRaw,
    routesRaw,
    tripsRaw,
    stopTimesRaw,
    calRaw,
    calDatesRaw,
    transfersRaw,
    shapesRaw,
    feedInfoRaw,
  ] = await Promise.all([
    loadJson<Record<string, string>[]>(`${base}/stops.json`),
    loadJson<Record<string, string>[]>(`${base}/routes.json`),
    loadJson<Record<string, string>[]>(`${base}/trips.json`),
    loadJson<Record<string, string>[]>(`${base}/stop_times.json`),
    loadJson<Record<string, string>[]>(`${base}/calendar.json`),
    loadJson<Record<string, string>[]>(`${base}/calendar_dates.json`),
    loadJson<Record<string, string>[]>(`${base}/transfers.json`),
    loadJson<Record<string, string>[]>(`${base}/shapes.json`),
    loadJson<Record<string, string>[]>(`${base}/feed_info.json`),
  ]);

  const stops: Stop[] = stopsRaw.map((r) => ({
    stop_id: r.stop_id,
    stop_name: r.stop_name,
    stop_lat: Number(r.stop_lat),
    stop_lon: Number(r.stop_lon),
  }));

  const routes: Route[] = routesRaw.map((r) => ({
    route_id: r.route_id,
    route_long_name: r.route_long_name,
    route_color: r.route_color || '999999',
    route_text_color: r.route_text_color || '000000',
  }));

  const trips: Trip[] = tripsRaw.map((r) => ({
    route_id: r.route_id,
    service_id: r.service_id,
    trip_id: r.trip_id,
    trip_headsign: r.trip_headsign,
    direction_id: r.direction_id,
    shape_id: r.shape_id,
  }));

  const stopTimes: StopTime[] = stopTimesRaw.map((r) => ({
    trip_id: r.trip_id,
    arrival_min: parseGtfsTime(r.arrival_time),
    departure_min: parseGtfsTime(r.departure_time),
    stop_id: r.stop_id,
    stop_sequence: Number(r.stop_sequence),
  }));

  const calendar: CalendarRow[] = calRaw.map((r) => ({
    service_id: r.service_id,
    monday: yes(r.monday),
    tuesday: yes(r.tuesday),
    wednesday: yes(r.wednesday),
    thursday: yes(r.thursday),
    friday: yes(r.friday),
    saturday: yes(r.saturday),
    sunday: yes(r.sunday),
    start_date: r.start_date,
    end_date: r.end_date,
  }));

  const calendarDates: CalendarDate[] = calDatesRaw.map((r) => ({
    service_id: r.service_id,
    date: r.date,
    exception_type: Number(r.exception_type) as 1 | 2,
  }));

  const transfers: Transfer[] = transfersRaw.map((r) => ({
    from_stop_id: r.from_stop_id,
    to_stop_id: r.to_stop_id,
    transfer_type: Number(r.transfer_type || '0'),
    min_transfer_time: Number(r.min_transfer_time || '0'),
  }));

  const shapes: ShapePoint[] = shapesRaw.map((r) => ({
    shape_id: r.shape_id,
    shape_pt_lat: Number(r.shape_pt_lat),
    shape_pt_lon: Number(r.shape_pt_lon),
    shape_pt_sequence: Number(r.shape_pt_sequence),
  }));

  const fi = feedInfoRaw[0] ?? {};
  const feedInfo: FeedInfo = {
    feed_publisher_name: fi.feed_publisher_name ?? '',
    feed_publisher_url: fi.feed_publisher_url ?? '',
    feed_lang: fi.feed_lang ?? 'ja',
    feed_start_date: fi.feed_start_date ?? '',
    feed_end_date: fi.feed_end_date ?? '',
    feed_version: fi.feed_version ?? '',
  };

  return { stops, routes, trips, stopTimes, calendar, calendarDates, transfers, shapes, feedInfo };
}
