import { router } from "expo-router";
import { CheckCircle2, CircleOff, LocateFixed, Radio, ShieldCheck, Timer } from "lucide-react-native";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { domainQueries } from "../api/domains";
import { useGatewayMutation } from "../api/gateway";
import { ActionResponseSchema, firstString, recordId } from "../api/records";
import { isDriverTracking, startDriverTracking, stopDriverTracking } from "../device/driverTracking";
import { readOperationalLocation } from "../device/location";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { idempotencyKey } from "../utilities/idempotency";
import { AppButton } from "./AppButton";
import { Screen } from "./Screen";
import { StatusPill } from "./StatusPill";

type OnlineStatus = "online" | "busy" | "offline";

export function DriverAvailabilityScreen() {
  const session = useSession();
  const { palette } = useAppTheme();
  const drivers = domainQueries.drivers();
  const locations = domainQueries.driverLocations();
  const driver = drivers.data?.find(
    (item) => firstString(item, ["user_id", "userId"]) === session.context?.user.id,
  );
  const driverId = driver ? recordId(driver) : null;
  const latest = locations.data?.find(
    (item) => firstString(item, ["driver_profile_id", "driverProfileId"]) === driverId,
  );
  const [status, setStatus] = useState<OnlineStatus>(
    (firstString(latest, ["online_status", "onlineStatus"]) as OnlineStatus) || "online",
  );
  const [tracking, setTracking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeSuccess, setNoticeSuccess] = useState(false);
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
    const backendStatus = firstString(latest, ["online_status", "onlineStatus"]);
    if (backendStatus === "online" || backendStatus === "busy" || backendStatus === "offline") {
      setStatus(backendStatus);
    }
    hydratedLocationId.current = latestId;
  }, [latest]);

  const submit = async () => {
    setNotice(null);
    if (!driverId || !session.session?.access_token) {
      setNoticeSuccess(false);
      setNotice("An approved driver profile and active session are required before availability can be updated.");
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
        setNoticeSuccess(true);
        setNotice("You are now offline. Location sharing for jobs has stopped.");
      } else {
        await startDriverTracking({
          driverProfileId: driverId,
          onlineStatus: status,
          accessToken: session.session.access_token,
          refreshToken: session.session.refresh_token,
        });
        setTracking(true);
        setNoticeSuccess(true);
        setNotice(
          status === "online"
            ? "You are online and ready for eligible assignments."
            : "You are marked busy. Active fulfilment tracking remains available.",
        );
      }
    } catch (cause) {
      setNoticeSuccess(false);
      setNotice(friendlyError(cause, "Availability could not be updated. Check location access and try again."));
    }
  };

  const lastUpdated = firstString(latest, ["recorded_at", "recordedAt"]);

  return (
    <Screen
      eyebrow="Driver availability"
      title="Availability"
      subtitle="Choose whether you are ready to receive jobs in your approved service areas."
      action={<AppButton label="Back" variant="ghost" size="sm" onPress={() => router.back()} />}
    >
      <View style={[styles.hero, shadows.raised, { backgroundColor: status === "offline" ? palette.ink : palette.brand }]}>
        <View style={styles.heroTop}>
          <View style={styles.heroCopy}>
            <Text style={styles.heroEyebrow}>CURRENT AVAILABILITY</Text>
            <Text style={styles.heroTitle}>{status === "online" ? "Ready for jobs" : status === "busy" ? "Busy with work" : "Offline"}</Text>
          </View>
          <View style={styles.heroIcon}>
            {status === "online" ? <Radio color="#FFFFFF" size={26} /> : status === "busy" ? <Timer color="#FFFFFF" size={26} /> : <CircleOff color="#FFFFFF" size={26} />}
          </View>
        </View>
        <Text style={styles.heroBody}>{statusDescription(status)}</Text>
      </View>

      <View style={styles.statusGrid}>
        <AvailabilityChoice
          value="online"
          selected={status === "online"}
          icon={<Radio color={status === "online" ? "#FFFFFF" : palette.success} size={21} />}
          title="Online"
          description="Ready for new jobs"
          onPress={() => setStatus("online")}
        />
        <AvailabilityChoice
          value="busy"
          selected={status === "busy"}
          icon={<Timer color={status === "busy" ? "#FFFFFF" : palette.warning} size={21} />}
          title="Busy"
          description="I am completing a job"
          onPress={() => setStatus("busy")}
        />
        <AvailabilityChoice
          value="offline"
          selected={status === "offline"}
          icon={<CircleOff color={status === "offline" ? "#FFFFFF" : palette.mutedStrong} size={21} />}
          title="Offline"
          description="Do not send new jobs"
          onPress={() => setStatus("offline")}
        />
      </View>

      <View style={[styles.trackingCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <View style={styles.trackingHead}>
          <View style={[styles.trackingIcon, { backgroundColor: tracking ? palette.successSoft : palette.surfaceSubtle }]}>
            <LocateFixed color={tracking ? palette.success : palette.mutedStrong} size={22} />
          </View>
          <View style={styles.trackingCopy}>
            <Text style={[styles.trackingTitle, { color: palette.ink }]}>Location sharing for jobs</Text>
            <Text style={[styles.trackingBody, { color: palette.muted }]}>Used only to find suitable nearby jobs and track active deliveries.</Text>
          </View>
          <StatusPill label={tracking ? "Active" : "Stopped"} tone={tracking ? "success" : "neutral"} />
        </View>
        <View style={[styles.divider, { backgroundColor: palette.border }]} />
        <View style={styles.metaRow}>
          <Text style={[styles.metaLabel, { color: palette.muted }]}>Last location update</Text>
          <Text style={[styles.metaValue, { color: palette.ink }]}>{formatDate(lastUpdated)}</Text>
        </View>
      </View>

      <AppButton
        label={status === "offline" ? "Go offline" : status === "busy" ? "Set busy" : "Go online"}
        fullWidth
        size="lg"
        loading={mutation.isPending}
        onPress={() => void submit()}
      />

      {notice ? (
        <View style={[styles.notice, { backgroundColor: noticeSuccess ? palette.successSoft : palette.dangerSoft }]}>
          <Text style={[styles.noticeText, { color: noticeSuccess ? palette.success : palette.danger }]}>{notice}</Text>
        </View>
      ) : null}

      <View style={[styles.policy, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
        <ShieldCheck color={palette.mutedStrong} size={18} />
        <Text style={[styles.policyText, { color: palette.muted }]}>Going offline stops background location sharing for new jobs. Your location is never shown publicly.</Text>
      </View>
    </Screen>
  );
}

function AvailabilityChoice({
  value,
  selected,
  icon,
  title,
  description,
  onPress,
}: {
  value: OnlineStatus;
  selected: boolean;
  icon: ReactNode;
  title: string;
  description: string;
  onPress(): void;
}) {
  const { palette } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Set availability ${value}`}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.statusChoice,
        {
          backgroundColor: selected ? palette.brand : palette.surface,
          borderColor: selected ? palette.brand : palette.border,
          opacity: pressed ? 0.82 : 1,
        },
      ]}
    >
      <View style={[styles.statusIcon, { backgroundColor: selected ? "rgba(255,255,255,.14)" : palette.surfaceSubtle }]}>{icon}</View>
      <View style={styles.statusCopy}>
        <Text style={[styles.statusTitle, { color: selected ? "#FFFFFF" : palette.ink }]}>{title}</Text>
        <Text style={[styles.statusDescription, { color: selected ? "rgba(255,255,255,.78)" : palette.muted }]}>{description}</Text>
      </View>
      {selected ? <CheckCircle2 color="#FFFFFF" size={20} /> : null}
    </Pressable>
  );
}

function statusDescription(status: OnlineStatus) {
  if (status === "online") return "You can receive new job offers that match your approved areas and vehicle.";
  if (status === "busy") return "You are completing an active job and will not receive another offer until you are available.";
  return "New dispatch should not be assigned while you are offline, and background tracking is stopped.";
}

function formatDate(value: string | null) {
  if (!value) return "No location recorded yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

const styles = StyleSheet.create({
  hero: { gap: spacing.md, padding: spacing.lg, borderRadius: radii.xl },
  heroTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md },
  heroCopy: { flex: 1, gap: 3 },
  heroEyebrow: { color: "rgba(255,255,255,.72)", ...typography.eyebrow, fontSize: 9 },
  heroTitle: { color: "#FFFFFF", ...typography.title, fontSize: 27 },
  heroIcon: { width: 50, height: 50, borderRadius: 17, backgroundColor: "rgba(255,255,255,.14)", alignItems: "center", justifyContent: "center" },
  heroBody: { color: "rgba(255,255,255,.84)", ...typography.caption, lineHeight: 18 },
  statusGrid: { gap: spacing.sm },
  statusChoice: { minHeight: 74, flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  statusIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  statusCopy: { flex: 1, gap: 2 },
  statusTitle: { ...typography.bodyStrong, fontSize: 14 },
  statusDescription: { ...typography.caption, lineHeight: 17 },
  trackingCard: { gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.lg },
  trackingHead: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  trackingIcon: { width: 46, height: 46, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  trackingCopy: { flex: 1, gap: 2 },
  trackingTitle: { ...typography.bodyStrong, fontSize: 14 },
  trackingBody: { ...typography.caption, lineHeight: 17 },
  divider: { height: StyleSheet.hairlineWidth },
  metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  metaLabel: { ...typography.caption },
  metaValue: { ...typography.caption, fontWeight: "800", flex: 1, textAlign: "right" },
  notice: { padding: spacing.md, borderRadius: radii.md },
  noticeText: { ...typography.caption, fontWeight: "800", textAlign: "center" },
  policy: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm + 2, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  policyText: { flex: 1, ...typography.caption, lineHeight: 18 },
});