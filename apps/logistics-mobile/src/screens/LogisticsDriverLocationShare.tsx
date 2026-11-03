import * as Location from "expo-location";
import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { z } from "zod";
import { createClientIdempotencyKey } from "@skima/frontend-core";
import { MapPin, Navigation, PauseCircle, PlayCircle } from "lucide-react-native";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";
import { AppButton } from "../ui/AppButton";
import { Card } from "../ui/Card";

export function LogisticsDriverLocationShare({ bookingId }: { bookingId: string }) {
  const { palette } = useAppTheme();
  const { api } = useSession();
  const subscription = useRef<Location.LocationSubscription | null>(null);
  const focused = useRef(false);
  const sharingEnabled = useRef(false);
  const [sharing, setSharing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSentAt, setLastSentAt] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    return () => {
      focused.current = false;
      sharingEnabled.current = false;
      subscription.current?.remove();
      subscription.current = null;
      setSharing(false);
    };
  }, []));

  async function sendPoint(position: Location.LocationObject) {
    if (!focused.current || !sharingEnabled.current) return;
    const latitude = position.coords.latitude;
    const longitude = position.coords.longitude;
    const keyIdentity = bookingId + ":" + Math.round(position.timestamp) + ":" +
      latitude.toFixed(6) + ":" + longitude.toFixed(6);
    await api.post("/runtime/logistics/driver/location", {
      bookingId,
      latitude,
      longitude,
      accuracyMeters: position.coords.accuracy,
      speedMetersPerSecond: position.coords.speed,
      headingDegrees: position.coords.heading,
      recordedAt: new Date(position.timestamp).toISOString(),
      idempotencyKey: createClientIdempotencyKey("logistics.driver.location", keyIdentity),
    }, z.object({
      booking_id: z.string().uuid(),
      tracking_session_id: z.string().uuid(),
      tracking_point_id: z.string().uuid(),
      recorded_at: z.string(),
    }).passthrough());
    if (focused.current && sharingEnabled.current) {
      setLastSentAt(new Date(position.timestamp).toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit", second: "2-digit" }));
    }
  }

  async function stopSharing() {
    sharingEnabled.current = false;
    subscription.current?.remove();
    subscription.current = null;
    setSharing(false);
  }

  async function startSharing() {
    setError(null);
    setStarting(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        throw new Error("Location permission is required to share your route during this active delivery.");
      }
      const firstPosition = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      if (!focused.current) return;
      sharingEnabled.current = true;
      await sendPoint(firstPosition);
      if (!focused.current) return;

      const watcher = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 15_000,
          distanceInterval: 25,
        },
        (position) => {
          if (!focused.current || !sharingEnabled.current) return;
          void sendPoint(position).catch((cause) => {
            if (focused.current && sharingEnabled.current) {
              setError(cause instanceof Error ? cause.message : "The location update could not be sent.");
            }
          });
        },
      );
      if (!focused.current) {
        watcher.remove();
        return;
      }
      subscription.current = watcher;
      setSharing(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Location sharing could not start.");
      Alert.alert("Location sharing unavailable", cause instanceof Error ? cause.message : "Check the app's location permission and try again.");
      await stopSharing();
    } finally {
      setStarting(false);
    }
  }

  return (
    <Card variant="subtle" padding="md">
      <View style={styles.heading}>
        <View style={[styles.icon, { backgroundColor: palette.brandSoft }]}>
          <MapPin color={palette.brand} size={17} />
        </View>
        <View style={styles.copy}>
          <Text style={[styles.title, { color: palette.ink }]}>Share delivery location</Text>
          <Text style={[styles.description, { color: palette.muted }]}>
            Location is shared with the customer and your provider company while this screen stays open.
          </Text>
        </View>
        {sharing ? <Navigation color={palette.success} size={18} /> : <MapPin color={palette.muted} size={18} />}
      </View>
      {lastSentAt ? <Text style={[styles.lastSent, { color: palette.muted }]}>Last location update: {lastSentAt}</Text> : null}
      {error ? <Text style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}
      <AppButton
        label={sharing ? "Stop sharing location" : "Start sharing location"}
        fullWidth
        variant={sharing ? "secondary" : "primary"}
        loading={starting}
        disabled={starting}
        icon={sharing ? <PauseCircle color={palette.ink} size={16} /> : <PlayCircle color="#FFFFFF" size={16} />}
        onPress={() => { void (sharing ? stopSharing() : startSharing()); }}
      />
      <Text style={[styles.footnote, { color: palette.muted }]}>Foreground sharing only. Location stops when you stop sharing or leave this screen.</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  heading: { flexDirection: "row", alignItems: "center", gap: 9 },
  icon: { width: 34, height: 34, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  title: { ...typography.bodyStrong, fontSize: 11 },
  description: { ...typography.caption, fontSize: 9, lineHeight: 15 },
  lastSent: { ...typography.caption, fontSize: 9 },
  error: { ...typography.caption, fontSize: 9, lineHeight: 15 },
  footnote: { ...typography.caption, fontSize: 8, lineHeight: 14 },
});
