import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { domainQueries } from "../api/domains";
import { useGatewayMutation } from "../api/gateway";
import { ActionResponseSchema, firstString, recordId } from "../api/records";
import {
  isDriverTracking,
  startDriverTracking,
  stopDriverTracking,
} from "../device/driverTracking";
import { readOperationalLocation } from "../device/location";
import { useSession } from "../session/SessionProvider";
import { colors, radii, spacing } from "../theme/tokens";
import { idempotencyKey } from "../utilities/idempotency";
import { Screen } from "./Screen";
type OnlineStatus = "online" | "busy" | "offline";
export function DriverAvailabilityScreen() {
  const session = useSession();
  const drivers = domainQueries.drivers();
  const locations = domainQueries.driverLocations();
  const driver = drivers.data?.find(
    (item) =>
      firstString(item, ["user_id", "userId"]) === session.context?.user.id,
  );
  const driverId = driver ? recordId(driver) : null;
  const latest = locations.data?.find(
    (item) =>
      firstString(item, ["driver_profile_id", "driverProfileId"]) === driverId,
  );
  const [status, setStatus] = useState<OnlineStatus>(
    (firstString(latest, ["online_status", "onlineStatus"]) as OnlineStatus) ||
      "online",
  );
  const [tracking, setTracking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const hydratedLocationId = useRef<string | null>(null);
  const mutation = useGatewayMutation({
    path: "/lpg/driver-locations",
    schema: ActionResponseSchema,
    invalidate: [["driver-locations"], ["drivers"]],
  });
  useEffect(() => {
    void isDriverTracking().then(setTracking);
  }, []);
  useEffect(() => {
    const latestId = latest ? recordId(latest) : null;
    if (!latestId || hydratedLocationId.current === latestId) return;
    const backendStatus = firstString(latest, [
      "online_status",
      "onlineStatus",
    ]);
    if (
      backendStatus === "online" ||
      backendStatus === "busy" ||
      backendStatus === "offline"
    ) {
      setStatus(backendStatus);
    }
    hydratedLocationId.current = latestId;
  }, [latest]);
  const submit = async () => {
    if (!driverId || !session.session?.access_token) {
      setNotice("An approved driver profile and active session are required.");
      return;
    }
    try {
      const point = await readOperationalLocation();
      await mutation.mutateAsync({
        ...point,
        driverProfileId: driverId,
        onlineStatus: status,
        purpose: "driver-availability",
        source: "skima.lpg.mobile",
        idempotencyKey: idempotencyKey("driver-availability", driverId),
      });
      if (status === "offline") {
        await stopDriverTracking();
        setTracking(false);
        setNotice("You are offline. Background dispatch tracking is stopped.");
      } else {
        await startDriverTracking({
          driverProfileId: driverId,
          onlineStatus: status,
          accessToken: session.session.access_token,
          refreshToken: session.session.refresh_token,
        });
        setTracking(true);
        setNotice(
          "Availability updated. Authorised background dispatch tracking is active.",
        );
      }
    } catch (cause) {
      setNotice(
        cause instanceof Error
          ? cause.message
          : "Availability could not be updated.",
      );
    }
  };
  return (
    <Screen
      eyebrow="Dispatch presence"
      title="Availability"
      action={
        <Pressable onPress={() => router.back()}>
          <Text style={styles.back}>Back</Text>
        </Pressable>
      }
    >
      <View style={styles.statuses}>
        {(["online", "busy", "offline"] as const).map((value) => (
          <Pressable
            key={value}
            onPress={() => setStatus(value)}
            style={[styles.choice, status === value && styles.active]}
          >
            <Text
              style={[styles.choiceText, status === value && styles.activeText]}
            >
              {value}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>Background dispatch tracking</Text>
        <Text
          style={[
            styles.value,
            { color: tracking ? colors.success : colors.muted },
          ]}
        >
          {tracking ? "Active" : "Stopped"}
        </Text>
        <Text style={styles.label}>Last updated</Text>
        <Text style={styles.value}>
          {firstString(latest, ["recorded_at", "recordedAt"])
            ? new Date(
                firstString(latest, ["recorded_at", "recordedAt"])!,
              ).toLocaleString()
            : "No location recorded"}
        </Text>
      </View>
      <Pressable
        disabled={mutation.isPending}
        onPress={() => void submit()}
        style={styles.primary}
      >
        {mutation.isPending ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text style={styles.primaryText}>Update availability</Text>
        )}
      </Pressable>
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <Text style={styles.note}>
        When online or busy, location is shared only for authorised dispatch and
        active fulfilment. Selecting offline stops the background service and
        removes its secure credentials.
      </Text>
    </Screen>
  );
}
const styles = StyleSheet.create({
  back: { color: colors.brand, fontWeight: "800" },
  statuses: { flexDirection: "row", gap: spacing.sm },
  choice: {
    flex: 1,
    alignItems: "center",
    padding: 14,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  active: { borderColor: colors.brand, backgroundColor: "#FFF0F1" },
  choiceText: {
    color: colors.muted,
    textTransform: "capitalize",
    fontWeight: "800",
  },
  activeText: { color: colors.brand },
  card: {
    padding: spacing.lg,
    gap: 5,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  label: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    marginTop: 6,
  },
  value: { color: colors.ink, fontSize: 17, fontWeight: "800" },
  primary: {
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand,
    borderRadius: radii.md,
  },
  primaryText: { color: "white", fontWeight: "900" },
  notice: { color: colors.success, fontWeight: "700" },
  note: { color: colors.muted, lineHeight: 20 },
});
