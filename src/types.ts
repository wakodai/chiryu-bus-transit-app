export interface Stop {
  stop_id: string;
  stop_name: string;
  stop_lat: number;
  stop_lon: number;
}

export interface Route {
  route_id: string;
  route_long_name: string;
  route_color: string;
  route_text_color: string;
}

export interface Trip {
  route_id: string;
  service_id: string;
  trip_id: string;
  trip_headsign: string;
  direction_id: string;
  shape_id: string;
}

export interface StopTime {
  trip_id: string;
  arrival_min: number;
  departure_min: number;
  stop_id: string;
  stop_sequence: number;
}

export interface CalendarRow {
  service_id: string;
  monday: boolean;
  tuesday: boolean;
  wednesday: boolean;
  thursday: boolean;
  friday: boolean;
  saturday: boolean;
  sunday: boolean;
  start_date: string;
  end_date: string;
}

export interface CalendarDate {
  service_id: string;
  date: string;
  exception_type: 1 | 2;
}

export interface Transfer {
  from_stop_id: string;
  to_stop_id: string;
  transfer_type: number;
  min_transfer_time: number;
}

export interface ShapePoint {
  shape_id: string;
  shape_pt_lat: number;
  shape_pt_lon: number;
  shape_pt_sequence: number;
}

export interface FeedInfo {
  feed_publisher_name: string;
  feed_publisher_url: string;
  feed_lang: string;
  feed_start_date: string;
  feed_end_date: string;
  feed_version: string;
}

export interface GtfsData {
  stops: Stop[];
  routes: Route[];
  trips: Trip[];
  stopTimes: StopTime[];
  calendar: CalendarRow[];
  calendarDates: CalendarDate[];
  transfers: Transfer[];
  shapes: ShapePoint[];
  feedInfo: FeedInfo;
}
