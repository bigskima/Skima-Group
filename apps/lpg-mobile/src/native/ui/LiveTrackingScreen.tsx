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
import { firstNumber, firstString, type PlatformRecord } from "../api/records";
import { OperationalMap, type MapPoint } from "../maps/OperationalMap";
import { colors, radii, spacing } from "../theme/tokens";
import { Card } from "./Card";
import { Screen } from "./Screen";
export function LiveTrackingScreen() {
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
  const mapped = (points.data ?? [])
    .map(toPoint)
    .filter((point): point is MapPoint => Boolean(point));
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
        <ActivityIndicator color={colors.brand} />
      ) : sessions.error || points.error || details.error ? (
        <Card>
          <Text style={styles.error}>
            {(sessions.error ?? points.error ?? details.error)?.message}
          </Text>
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
          <OperationalMap points={mapped} connectPoints />
          <Card>
            <View style={styles.row}>
              <View>
                <Text style={styles.label}>Location status</Text>
                <Text style={styles.value}>
                  {mapped.length
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
                      mapped.length && !stale ? "#DDF3E5" : "#FFF0D8",
                  },
                ]}
              >
                <Text
                  style={{
                    color: mapped.length && !stale ? colors.success : "#9A5B00",
                    fontWeight: "800",
                  }}
                >
                  {mapped.length && !stale ? "LIVE" : "WAITING"}
                </Text>
              </View>
            </View>
            <Text style={styles.body}>
              {recorded
                ? `Last backend update: ${new Date(recorded).toLocaleString()}`
                : "No authorised tracking update has been returned."}
            </Text>
            <View style={styles.estimates}>
              <View style={styles.estimate}>
                <Text style={styles.label}>Backend distance</Text>
                <Text style={styles.value}>
                  {distance === null
                    ? "Unavailable"
                    : `${(distance / 1000).toFixed(1)} km`}
                </Text>
              </View>
              <View style={styles.estimate}>
                <Text style={styles.label}>Backend ETA</Text>
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
    ? { latitude, longitude, label: "Verified tracking update" }
    : null;
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
});
