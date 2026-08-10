import { router, useLocalSearchParams } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTrackingPoints, useTrackingSessions } from "../api/domains";
import { firstString, type PlatformRecord } from "../api/records";
import { OperationalMap, type MapPoint } from "../maps/OperationalMap";
import { colors, radii, spacing } from "../theme/tokens";
import { Card } from "./Card";
import { Screen } from "./Screen";
export function LiveTrackingScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const sessions = useTrackingSessions();
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
      {sessions.isPending || points.isPending ? (
        <ActivityIndicator color={colors.brand} />
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
});
