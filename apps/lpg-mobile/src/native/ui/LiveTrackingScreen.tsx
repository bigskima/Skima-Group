import { router, useLocalSearchParams } from "expo-router";
import { Clock3, MapPin, Navigation, Route, Signal, SignalZero } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";
import {
  useJobDetails,
  useTrackingPoints,
  useTrackingSessions,
} from "../api/domains";
import { firstNumber, firstString, nestedRecord, type PlatformRecord } from "../api/records";
import { OperationalMap, type MapPoint } from "../maps/OperationalMap";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { AppButton } from "./AppButton";
import { Card } from "./Card";
import { Screen } from "./Screen";
import { ScreenSkeleton } from "./ScreenSkeleton";
import { StatusPill } from "./StatusPill";

export function LiveTrackingScreen() {
  const { palette } = useAppTheme();
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
  const driverPath = [...(points.data ?? [])]
    .reverse()
    .map(toPoint)
    .filter((point): point is MapPoint => Boolean(point));
  const delivery =
    nestedRecord(details.data, "deliveryLocation") ??
    nestedRecord(details.data, "delivery_location");
  const destinationLabel =
    firstString(delivery, ["formattedAddress", "formatted_address", "label"]) ??
    "Your delivery address";
  const destination = delivery ? locationPoint(delivery, destinationLabel, "destination") : null;
  const mapped = [...driverPath, ...(destination ? [destination] : [])];
  const latest = points.data?.[0];
  const recorded = firstString(latest, ["recorded_at", "recordedAt", "created_at"]);
  const stale = recorded ? Date.now() - new Date(recorded).getTime() > 120000 : true;
  const live = Boolean(driverPath.length && !stale);
  const distance = firstNumber(details.data, [
    "routeDistanceMeters",
    "route_distance_meters",
    "distanceMeters",
  ]);
  const duration = firstNumber(details.data, [
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
            <OperationalMap points={mapped} connectPoints height={500} />
            <View style={[styles.liveOverlay, { backgroundColor: palette.surface }]}>
              {live ? <Signal color={palette.success} size={16} /> : <Clock3 color={palette.warning} size={16} />}
              <Text style={[styles.overlayText, { color: palette.ink }]}>{live ? "Driver location is live" : "Waiting for a fresh signal"}</Text>
            </View>
          </View>

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
                ? `Last location update: ${formatTime(recorded)}`
                : "The map will update automatically after the assigned driver starts location sharing for this journey."}
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

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

const styles = StyleSheet.create({
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