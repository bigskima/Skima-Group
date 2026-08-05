import {
  getFirstRecordNumber,
  getFirstRecordString,
  type PlatformRecord,
} from "@lpg/shared/api/records";

export interface TrackingCoordinate {
  readonly accuracyMeters: number | null;
  readonly headingDegrees: number | null;
  readonly latitude: number;
  readonly longitude: number;
  readonly recordedAt: string | null;
  readonly speedMetersPerSecond: number | null;
}

export interface TrackingSummary {
  readonly distanceMeters: number | null;
  readonly isFresh: boolean;
  readonly latest: TrackingCoordinate | null;
  readonly points: readonly TrackingCoordinate[];
  readonly staleMinutes: number | null;
}

const FRESH_TRACKING_WINDOW_MS = 5 * 60 * 1000;
const EARTH_RADIUS_METERS = 6_371_000;

export function buildTrackingSummary(
  records: readonly PlatformRecord[],
  nowMs = Date.now(),
): TrackingSummary {
  const points = records
    .map(toTrackingCoordinate)
    .filter((point): point is TrackingCoordinate => Boolean(point))
    .sort((left, right) => timestampMs(right.recordedAt) - timestampMs(left.recordedAt));
  const latest = points[0] ?? null;
  const latestMs = timestampMs(latest?.recordedAt);
  const ageMs = latestMs > 0 ? Math.max(0, nowMs - latestMs) : null;

  return {
    distanceMeters: distanceForPoints(points),
    isFresh: ageMs !== null && ageMs <= FRESH_TRACKING_WINDOW_MS,
    latest,
    points,
    staleMinutes: ageMs === null ? null : Math.floor(ageMs / 60_000),
  };
}

export function toTrackingCoordinate(record: PlatformRecord): TrackingCoordinate | null {
  const latitude = getFirstRecordNumber(record, ["latitude", "lat"]);
  const longitude = getFirstRecordNumber(record, ["longitude", "lng", "lon"]);

  if (latitude === null || longitude === null) return null;

  return {
    accuracyMeters: getFirstRecordNumber(record, ["accuracy_meters", "accuracyMeters", "accuracy"]),
    headingDegrees: getFirstRecordNumber(record, ["heading_degrees", "headingDegrees", "heading"]),
    latitude,
    longitude,
    recordedAt: getFirstRecordString(record, ["recorded_at", "recordedAt", "created_at", "createdAt"]),
    speedMetersPerSecond: getFirstRecordNumber(record, [
      "speed_meters_per_second",
      "speedMetersPerSecond",
      "speed",
    ]),
  };
}

export function formatTrackingDistance(meters: number | null): string {
  if (meters === null) return "Waiting for route";
  if (meters >= 1000) return `${(meters / 1000).toFixed(meters >= 10_000 ? 0 : 1)} km`;
  return `${Math.round(meters)} m`;
}

export function formatTrackingSpeed(speedMetersPerSecond: number | null): string {
  if (speedMetersPerSecond === null) return "Unavailable";
  return `${Math.round(speedMetersPerSecond * 3.6)} km/h`;
}

export function mapsDirectionsUrl(point: TrackingCoordinate | null): string | null {
  if (!point) return null;
  const destination = `${point.latitude.toFixed(6)},${point.longitude.toFixed(6)}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

function distanceForPoints(points: readonly TrackingCoordinate[]): number | null {
  if (points.length < 2) return null;

  return points.slice(1).reduce((total, point, index) => {
    const previous = points[index];
    return previous ? total + haversineMeters(previous, point) : total;
  }, 0);
}

function haversineMeters(from: TrackingCoordinate, to: TrackingCoordinate): number {
  const fromLat = degreesToRadians(from.latitude);
  const toLat = degreesToRadians(to.latitude);
  const deltaLat = degreesToRadians(to.latitude - from.latitude);
  const deltaLon = degreesToRadians(to.longitude - from.longitude);
  const halfChord = Math.sin(deltaLat / 2) ** 2 +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(halfChord), Math.sqrt(1 - halfChord));
}

function degreesToRadians(value: number): number {
  return value * Math.PI / 180;
}

function timestampMs(value: string | null | undefined): number {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}
