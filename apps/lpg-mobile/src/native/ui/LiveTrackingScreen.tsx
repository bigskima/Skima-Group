import { router, useLocalSearchParams } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  useJobDetails,
  useTrackingPoints,
  useTrackingSessions,
} from "../api/domains";
import { firstNumber, firstString, nestedRecord, type PlatformRecord } from "../api/records";
import { OperationalMap, type MapPoint } from "../maps/OperationalMap";
import { colors, radii, spacing } from "../theme/tokens";
import { Card } from "./Card";
import { Screen } from "./Screen";
import { ScreenSkeleton } from "./ScreenSkeleton";
import { useAppTheme } from "../theme/ThemeProvider";
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
  const sessionId = session
    ? firstString(session, ["id", "tracking_session_id"])
    : null;
  const points = useTrackingPoints(sessionId);
  const driverPath = [...(points.data ?? [])].reverse()
    .map(toPoint)
    .filter((point): point is MapPoint => Boolean(point));
  const delivery = nestedRecord(details.data, "deliveryLocation") ?? nestedRecord(details.data, "delivery_location");
  const destinationLabel = firstString(delivery, ["formattedAddress", "formatted_address", "label"]) ?? "Your delivery address";
  const destination = delivery ? locationPoint(delivery, destinationLabel, "destination") : null;
  const mapped = [...driverPath, ...(destination ? [destination] : [])];
  const latest = points.data?.[0];
  const recorded = firstString(latest, [
    "recorded_at",
    "recordedAt",
    "created_at",
  ]);
  const stale = recorded
    ? Date.now() - new Date(recorded).getTime() > 120000
    : true;
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
      eyebrow="Live fulfilment"
      title="Track your order"
      action={
        <Pressable onPress={() => router.back()}>
          <Text style={styles.back}>Back</Text>
        </Pressable>
      }
    >
      {sessions.isPending ||
      details.isPending ||
      (Boolean(sessionId) && points.isPending) ? (
        <ScreenSkeleton cards={2} />
      ) : sessions.error || points.error || details.error ? (
        <Card>
          <Text style={styles.error}>We couldn’t refresh the live map. Check your connection and try again.</Text>
          <Pressable
            onPress={() =>
              void Promise.all([
                sessions.refetch(),
                sessionId ? points.refetch() : Promise.resolve(),
                details.refetch(),
              ])
            }
          >
            <Text style={styles.back}>Retry live tracking</Text>
          </Pressable>
        </Card>
      ) : (
        <>
          <View style={styles.mapShell}>
            <OperationalMap points={mapped} connectPoints height={500} />
            <View style={[styles.liveOverlay, { backgroundColor: palette.surface }]}><View style={[styles.pulse, { backgroundColor: !stale && driverPath.length ? colors.success : colors.accent }]} /><Text style={[styles.overlayText, { color: palette.ink }]}>{!stale && driverPath.length ? "Live driver movement" : "Waiting for driver signal"}</Text></View>
          </View>
          <Card>
            <View style={styles.row}>
              <View>
                <Text style={styles.label}>Location status</Text>
                <Text style={styles.value}>
                  {driverPath.length
                    ? stale
                      ? "Last location is stale"
                      : "Location recently updated"
                    : "Location unavailable"}
                </Text>
              </View>
              <View
                style={[
                  styles.pill,
                  {
                    backgroundColor:
                      driverPath.length && !stale ? "#DDF3E5" : "#FFF0D8",
                  },
                ]}
              >
                <Text
                  style={{
                    color: driverPath.length && !stale ? colors.success : "#9A5B00",
                    fontWeight: "800",
                  }}
                >
                  {driverPath.length && !stale ? "LIVE" : "WAITING"}
                </Text>
              </View>
            </View>
            <Text style={styles.body}>
              {recorded
                ? `Last location update: ${new Date(recorded).toLocaleString()}`
                : "The driver’s live location will appear after the journey starts."}
            </Text>
            <View style={styles.estimates}>
              <View style={styles.estimate}>
                <Text style={styles.label}>Route distance</Text>
                <Text style={styles.value}>
                  {distance === null
                    ? "Unavailable"
                    : `${(distance / 1000).toFixed(1)} km`}
                </Text>
              </View>
              <View style={styles.estimate}>
                <Text style={styles.label}>Estimated arrival</Text>
                <Text style={styles.value}>
                  {duration === null
                    ? "Unavailable"
                    : `${Math.ceil(duration / 60)} min`}
                </Text>
              </View>
            </View>
          </Card>
        </>
      )}
    </Screen>
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
const styles = StyleSheet.create({
  back: { color: colors.brand, fontWeight: "800" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  label: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  value: { color: colors.ink, fontSize: 18, fontWeight: "900", marginTop: 4 },
  body: { color: colors.muted, lineHeight: 21 },
  pill: { borderRadius: radii.pill, paddingHorizontal: 11, paddingVertical: 7 },
  estimates: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  estimate: {
    flex: 1,
    minWidth: 140,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: "#F3F6F4",
  },
  error: { color: colors.danger, lineHeight: 20 },
  mapShell: { position: "relative" },
  liveOverlay: { position: "absolute", left: spacing.md, top: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: 12, paddingVertical: 9, borderRadius: radii.pill, shadowColor: "#000", shadowOpacity: .14, shadowRadius: 10, elevation: 4 },
  pulse: { width: 9, height: 9, borderRadius: 5 },
  overlayText: { fontSize: 12, fontWeight: "900" },
});
