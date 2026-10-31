import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Clock3, MapPin, Navigation, Route, Signal, SignalZero } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";
import {
  useJobDetails,
  useTrackingPoints,
  useTrackingSessions,
} from "../api/domains";
import { firstNumber, firstString, nestedRecord, type PlatformRecord } from "../api/records";
import { useMapsGatewayAdapter } from "../domains/maps/gateway";
import type { Coordinate } from "../domains/maps";
import { useResolvedLocationLabel } from "../domains/maps/readableLocation";
import { idempotencyKey } from "../utilities/idempotency";
import { OperationalMap, type MapPoint } from "../maps/OperationalMap";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { AppButton } from "./AppButton";
import { Card } from "./Card";
import { Screen } from "./Screen";
import { ScreenSkeleton } from "./ScreenSkeleton";
import { StatusPill } from "./StatusPill";

type RoadRouteState = {
  coordinates: Coordinate[];
  distanceMeters: number;
  durationSeconds: number;
};

export function LiveTrackingScreen() {
  const { palette } = useAppTheme();
  const mapsGateway = useMapsGatewayAdapter();
  const [roadRoute, setRoadRoute] = useState<RoadRouteState | null>(null);
  const lastRouteRequest = useRef<{
    origin: Coordinate;
    destination: Coordinate;
    requestedAt: number;
    requestKey: string;
  } | null>(null);
  const { id } = useLocalSearchParams<{ id?: string }>();
  const sessions = useTrackingSessions();
  const details = useJobDetails(id ?? null);
  const session = sessions.data?.find(
    (item) =>
      firstString(item, ["subject_type", "subjectType"]) === "lpg_order" &&
      firstString(item, ["subject_id", "subjectId"]) === id,
  );
  const sessionId = session ? firstString(session, ["id", "tracking_session_id"]) : null;
  const points = useTrackingPoints(sessionId);
  // Tracking APIs return newest-first. Convert that into chronological route geometry.
  const driverPath = [...(points.data ?? [])]
    .map((record) => ({
      point: toPoint(record),
      recordedAt: Date.parse(firstString(record, ["recorded_at", "recordedAt", "created_at"]) ?? ""),
    }))
    .filter((entry): entry is { point: MapPoint; recordedAt: number } => Boolean(entry.point))
    .sort((left, right) => {
      if (!Number.isFinite(left.recordedAt) || !Number.isFinite(right.recordedAt)) return 0;
      return left.recordedAt - right.recordedAt;
    })
    .map((entry) => entry.point);

  const delivery =
    nestedRecord(details.data, "deliveryLocation") ??
    nestedRecord(details.data, "delivery_location");
  const destinationLabel = useResolvedLocationLabel(
    delivery,
    "Your saved delivery location",
    `tracking:${id ?? "unknown"}:delivery`,
  );
  const destination = delivery ? locationPoint(delivery, destinationLabel, "destination") : null;
  // A route is geometry, not a collection of pins. Show only the latest driver
  // marker and the destination marker; the full GPS history is drawn as one line.
  const latestDriver = driverPath.at(-1) ?? null;

  // Ask the Admin-configured server-side router for the live road route.
  // Provider credentials stay in the backend; the client receives only road geometry.
  useEffect(() => {
    if (!latestDriver || !destination) {
      setRoadRoute(null);
      lastRouteRequest.current = null;
      return;
    }

    const origin = { latitude: latestDriver.latitude, longitude: latestDriver.longitude };
    const target = { latitude: destination.latitude, longitude: destination.longitude };
    const now = Date.now();
    const previous = lastRouteRequest.current;
    const movedEnough = !previous
      || coordinateDistanceMeters(previous.origin, origin) >= 150
      || coordinateDistanceMeters(previous.destination, target) >= 15;
    const refreshDue = !previous || now - previous.requestedAt >= 60_000;
    if (!movedEnough && !refreshDue) return;

    const requestKey = [
      id ?? "unknown",
      origin.latitude.toFixed(5),
      origin.longitude.toFixed(5),
      target.latitude.toFixed(5),
      target.longitude.toFixed(5),
      Math.floor(now / 60_000),
    ].join(":");
    if (previous?.requestKey === requestKey) return;

    lastRouteRequest.current = {
      origin,
      destination: target,
      requestedAt: now,
      requestKey,
    };

    let current = true;
    void mapsGateway.routeEstimate.mutateAsync({
      origin,
      destination: target,
      idempotencyKey: idempotencyKey("customer-live-road-route", requestKey),
    }).then((estimate) => {
      if (!current) return;
      const coordinates = readRouteCoordinates(estimate.routeGeometry);
      if (coordinates.length < 2) {
        setRoadRoute(null);
        return;
      }
      setRoadRoute({
        coordinates,
        distanceMeters: estimate.distanceMeters,
        durationSeconds: parseDurationSeconds(estimate.duration ?? estimate.staticDuration),
      });
    }).catch(() => {
      // Keep the last recorded GPS breadcrumb as a quiet fallback when routing is offline.
      if (current) setRoadRoute(null);
    });

    return () => {
      current = false;
    };
  }, [
    id,
    latestDriver?.latitude,
    latestDriver?.longitude,
    destination?.latitude,
    destination?.longitude,
    mapsGateway.routeEstimate.mutateAsync,
  ]);

  const mapped = [...(latestDriver ? [latestDriver] : []), ...(destination ? [destination] : [])];
  const latest = points.data?.[0];
  const recorded = firstString(latest, ["recorded_at", "recordedAt", "created_at"]);
  const recordedAt = recorded ? Date.parse(recorded) : Number.NaN;
  const stale = !Number.isFinite(recordedAt) || Date.now() - recordedAt > 120000;
  const live = Boolean(latestDriver && !stale);
  const order = nestedRecord(details.data, "order") ?? details.data;
  const orderReference = firstString(order, ["publicReference", "public_reference", "reference"]);
  const orderStatus = firstString(order, ["status"]);
  const distance = roadRoute?.distanceMeters ?? firstNumber(details.data, [
    "routeDistanceMeters",
    "route_distance_meters",
    "distanceMeters",
  ]);
  const duration = roadRoute?.durationSeconds ?? firstNumber(details.data, [
    "routeDurationSeconds",
    "route_duration_seconds",
    "durationSeconds",
  ]);

  return (
    <Screen
      eyebrow="Live delivery"
      title="Track your refill"
      subtitle="Follow your driver as your cylinder moves through pickup, refill and return."
      action={<AppButton label="Back" variant="ghost" size="sm" onPress={() => router.back()} />}
    >
      {sessions.isPending || details.isPending || (Boolean(sessionId) && points.isPending) ? (
        <ScreenSkeleton cards={2} />
      ) : sessions.error || points.error || details.error ? (
        <Card padding="lg">
          <View style={styles.errorState}>
            <View style={[styles.errorIcon, { backgroundColor: palette.dangerSoft }]}>
              <SignalZero color={palette.danger} size={24} />
            </View>
            <Text style={[styles.errorTitle, { color: palette.ink }]}>Live map could not refresh</Text>
            <Text style={[styles.errorBody, { color: palette.muted }]}>Check your connection and try again. Your order is still safe with SKIMA.</Text>
            <AppButton
              label="Retry tracking"
              fullWidth
              onPress={() =>
                void Promise.all([
                  sessions.refetch(),
                  sessionId ? points.refetch() : Promise.resolve(),
                  details.refetch(),
                ])
              }
            />
          </View>
        </Card>
      ) : (
        <>
          <View style={[styles.mapShell, shadows.raised]}>
            <OperationalMap
              points={mapped}
              routeCoordinates={roadRoute?.coordinates ?? driverPath}
              height={430}
            />
            <View style={[styles.liveOverlay, { backgroundColor: palette.surface }]}>
              {live ? <Signal color={palette.success} size={16} /> : <Clock3 color={palette.warning} size={16} />}
              <Text style={[styles.overlayText, { color: palette.ink }]}>{live ? "Driver location is live" : "Waiting for a fresh signal"}</Text>
            </View>
          </View>
          {orderReference ? (
            <View style={[styles.orderStrip, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <View style={styles.orderStripCopy}>
                <Text style={[styles.orderStripLabel, { color: palette.muted }]}>YOUR ORDER</Text>
                <Text style={[styles.orderStripReference, { color: palette.ink }]}>{orderReference}</Text>
              </View>
              <StatusPill label={formatOrderStatus(orderStatus)} tone={isTerminalStatus(orderStatus) ? "success" : "brand"} />
            </View>
          ) : null}

          <View style={[styles.summary, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <View style={styles.summaryHead}>
              <View style={styles.summaryCopy}>
                <Text style={[styles.summaryEyebrow, { color: palette.muted }]}>TRACKING STATUS</Text>
                <Text style={[styles.summaryTitle, { color: palette.ink }]}>
                  {live ? "Your driver is sharing a recent location" : driverPath.length ? "Last driver location is getting old" : "Driver tracking has not started yet"}
                </Text>
              </View>
              <StatusPill label={live ? "Live" : "Waiting"} tone={live ? "success" : "warning"} />
            </View>
            <Text style={[styles.summaryBody, { color: palette.muted }]}> 
              {recorded
                ? `Last update: ${formatTime(recorded)}${stale ? " · This signal is older than two minutes." : ""}`
                : "The map will update when your assigned driver starts sharing location for this journey."}
            </Text>
          </View>

          <View style={styles.metricGrid}>
            <MetricCard
              icon={<Route color={palette.brand} size={20} />}
              label="Route distance"
              value={distance === null ? "Unavailable" : `${(distance / 1000).toFixed(1)} km`}
            />
            <MetricCard
              icon={<Navigation color={palette.brand} size={20} />}
              label="Estimated arrival"
              value={duration === null ? "Unavailable" : `${Math.ceil(duration / 60)} min`}
            />
          </View>

          <View style={[styles.destination, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
            <View style={[styles.destinationIcon, { backgroundColor: palette.brandSoft }]}>
              <MapPin color={palette.brand} size={20} />
            </View>
            <View style={styles.destinationCopy}>
              <Text style={[styles.destinationLabel, { color: palette.muted }]}>DELIVERY DESTINATION</Text>
              <Text style={[styles.destinationValue, { color: palette.ink }]}>{destinationLabel}</Text>
            </View>
          </View>

          <Text style={[styles.privacy, { color: palette.muted }]}>Driver location is shared only while this order is active and is not publicly available.</Text>
        </>
      )}
    </Screen>
  );
}

function MetricCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  const { palette } = useAppTheme();
  return (
    <View style={[styles.metric, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <View style={[styles.metricIcon, { backgroundColor: palette.brandSoft }]}>{icon}</View>
      <Text style={[styles.metricLabel, { color: palette.muted }]}>{label}</Text>
      <Text style={[styles.metricValue, { color: palette.ink }]}>{value}</Text>
    </View>
  );
}

function readRouteCoordinates(value: unknown): Coordinate[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const geometry = value as { coordinates?: unknown; type?: unknown };
  if (geometry.type !== "LineString" || !Array.isArray(geometry.coordinates)) return [];
  return geometry.coordinates.flatMap((entry): Coordinate[] => {
    if (!Array.isArray(entry) || entry.length < 2) return [];
    const longitude = Number(entry[0]);
    const latitude = Number(entry[1]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
      || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return [];
    return [{ latitude, longitude }];
  });
}

function parseDurationSeconds(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Number(value.trim().replace(/s$/i, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 0;
}

function coordinateDistanceMeters(left: Coordinate, right: Coordinate): number {
  const radius = 6_371_000;
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latDelta = radians(right.latitude - left.latitude);
  const lonDelta = radians(right.longitude - left.longitude);
  const leftLat = radians(left.latitude);
  const rightLat = radians(right.latitude);
  const value = Math.sin(latDelta / 2) ** 2
    + Math.cos(leftLat) * Math.cos(rightLat) * Math.sin(lonDelta / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function toPoint(record: PlatformRecord): MapPoint | null {
  const latitude = Number(record.latitude ?? record.lat);
  const longitude = Number(record.longitude ?? record.lng);
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    ? { latitude, longitude, label: "Delivery driver", kind: "driver" }
    : null;
}

function locationPoint(record: PlatformRecord, label: string, kind: MapPoint["kind"]): MapPoint | null {
  const latitude = firstNumber(record, ["latitude", "lat"]);
  const longitude = firstNumber(record, ["longitude", "lng"]);
  return latitude !== null && longitude !== null ? { latitude, longitude, label, kind } : null;
}

function readableLocationLabel(record: PlatformRecord | null) {
  if (!record) return "Your saved delivery location";
  const candidates = [
    firstString(record, ["formattedAddress", "formatted_address"]),
    firstString(record, ["label"]),
    firstString(record, ["landmark"]),
  ];
  return candidates.find((value) => value && !isInternalCoordinateLabel(value)) ?? "Your saved delivery location";
}

function isInternalCoordinateLabel(value: string) {
  return /sandbox\s+location|(?:latitude|longitude)|^-?\d{1,3}\.\d+\s*[,/]\s*-?\d{1,3}\.\d+$/i.test(value.trim());
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatOrderStatus(value: string | null): string {
  if (!value) return "In progress";
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isTerminalStatus(value: string | null): boolean {
  return value === "completed" || value === "delivered";
}

const styles = StyleSheet.create({
  orderStrip: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, padding: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg },
  orderStripCopy: { flex: 1, gap: 3 },
  orderStripLabel: { ...typography.eyebrow, fontSize: 9 },
  orderStripReference: { ...typography.bodyStrong, fontSize: 15 },
  mapShell: { position: "relative", borderRadius: radii.xl, overflow: "hidden" },
  liveOverlay: {
    position: "absolute",
    left: spacing.md,
    top: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: radii.pill,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 4,
  },
  overlayText: { ...typography.caption, fontWeight: "900" },
  summary: { gap: spacing.sm, padding: spacing.lg, borderRadius: radii.xl, borderWidth: StyleSheet.hairlineWidth },
  summaryHead: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md },
  summaryCopy: { flex: 1, gap: 4 },
  summaryEyebrow: { ...typography.eyebrow, fontSize: 9 },
  summaryTitle: { ...typography.subheading, fontSize: 16 },
  summaryBody: { ...typography.body, fontSize: 13, lineHeight: 19 },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  metric: { flex: 1, minWidth: 145, gap: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  metricIcon: { width: 40, height: 40, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  metricLabel: { ...typography.caption },
  metricValue: { ...typography.heading, fontSize: 20 },
  destination: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  destinationIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  destinationCopy: { flex: 1, gap: 3 },
  destinationLabel: { ...typography.eyebrow, fontSize: 9 },
  destinationValue: { ...typography.bodyStrong, fontSize: 14 },
  privacy: { ...typography.caption, lineHeight: 18 },
  errorState: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.md },
  errorIcon: { width: 54, height: 54, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  errorTitle: { ...typography.heading, fontSize: 19, textAlign: "center" },
  errorBody: { ...typography.body, textAlign: "center", maxWidth: 430 },
});
