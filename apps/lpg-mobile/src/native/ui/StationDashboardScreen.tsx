import { router } from "expo-router";
import {
  Bell,
  ChevronRight,
  CircleCheck,
  Gauge,
  PackageCheck,
  Settings2,
  ShieldCheck,
  Users,
  WalletCards,
} from "lucide-react-native";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { domainQueries, useStationRuntime } from "../api/domains";
import {
  displayReference,
  displayStatus,
  displayTitle,
  firstNumber,
  firstString,
  nestedRecord,
  recordId,
  type PlatformRecord,
} from "../api/records";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { AppButton } from "./AppButton";
import { BrandMark } from "./BrandMark";
import { EmptyState } from "./EmptyState";
import { ScreenSkeleton } from "./ScreenSkeleton";
import { StatusPill } from "./StatusPill";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

export function StationDashboardScreen() {
  const session = useSession();
  const { palette } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const runtime = useStationRuntime();
  const jobs = domainQueries.stationJobs();
  const settlements = domainQueries.settlements();

  const branch = nestedRecord(runtime.data, "branch");
  const records = jobs.data ?? [];
  const activeRecords = records.filter((item) => isStationQueueState(displayStatus(item)));
  const processingRecord = activeRecords.find((item) => isStationProcessing(displayStatus(item)));
  const current = processingRecord ?? activeRecords[0];
  const currentId = current ? recordId(current) : null;
  const processingId = processingRecord ? recordId(processingRecord) : null;
  const waitingForDriver = activeRecords.filter((item) => isDriverApproaching(displayStatus(item))).length;
  const readyForStation = activeRecords.filter((item) => normalized(displayStatus(item) ?? "") === "station_verified").length;
  const processing = activeRecords.filter((item) => ["refill_started", "refill_in_progress"].includes(normalized(displayStatus(item) ?? ""))).length;
  const availableKg = firstNumber(branch, ["currentAvailableKg", "current_available_kg"]);
  const capacityKg = firstNumber(branch, ["refillCapacityKg", "refill_capacity_kg"]);
  const availability = firstString(branch, ["availabilityStatus", "availability_status"]) ?? "unavailable";
  const normalizedAvailability = normalized(availability);
  const settled = (settlements.data ?? []).reduce(
    (sum, item) => sum + (firstNumber(item, ["net_amount", "netAmount", "amount"]) ?? 0),
    0,
  );
  const currency = firstString(settlements.data?.[0], ["currency_code", "currencyCode"]) ?? "NGN";
  const settlementSummary = settlements.error ? "Temporarily unavailable" : money(settled, currency);
  const firstName = session.context?.profile?.display_name?.trim().split(/\s+/)[0];
  const loading = runtime.isPending || jobs.isPending;
  const failed = runtime.error || jobs.error;
  const refreshing = runtime.isRefetching || jobs.isRefetching || settlements.isRefetching;

  const refresh = async () => {
    await Promise.allSettled([runtime.refetch(), jobs.refetch(), settlements.refetch()]);
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: palette.canvas }}
      contentContainerStyle={[styles.page, { paddingTop: Math.max(insets.top, 12) }]}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void refresh()}
          tintColor={palette.brand}
        />
      }
    >
      <View style={[styles.frame, { maxWidth: width >= 900 ? 760 : 640 }]}>
        <View style={styles.header}>
          <View style={styles.identity}>
            <BrandMark compact />
            <View style={styles.identityCopy}>
              <Text style={[styles.context, { color: palette.muted }]}>STATION OPERATIONS</Text>
              <Text numberOfLines={1} style={[styles.greeting, { color: palette.ink }]}>
                {firstName ? `Hello, ${firstName}` : "Welcome to SKIMA"}
              </Text>
            </View>
          </View>
          <Pressable
            accessibilityLabel="Open notifications"
            onPress={() => router.push("/(station)/notifications")}
            style={[styles.notification, { backgroundColor: palette.surface, borderColor: palette.border }]}
          >
            <Bell color={palette.ink} size={19} />
          </Pressable>
        </View>

        <View style={styles.switcher}><WorkspaceSwitcher current="station" /></View>

        {loading ? (
          <View style={styles.content}><ScreenSkeleton cards={4} /></View>
        ) : failed ? (
          <View style={styles.content}>
            <EmptyState
              icon={<PackageCheck color={palette.brand} size={27} />}
              title="Station workspace could not be refreshed"
              description="We couldn't load the live branch and reception queue. Check your connection and try again."
              action={<AppButton label="Try again" variant="secondary" onPress={() => void refresh()} />}
            />
          </View>
        ) : !branch ? (
          <View style={styles.content}>
            <EmptyState
              icon={<ShieldCheck color={palette.brand} size={28} />}
              title="Station is not operationally active yet"
              description="An approved application still requires separate SKIMA activation before this branch can receive LPG operations."
            />
            <Pressable
              onPress={() => router.push("/(station)/application")}
              style={[styles.primaryLink, { backgroundColor: palette.brand }]}
            >
              <Text style={styles.primaryLinkText}>View application status</Text>
              <ChevronRight color="#FFFFFF" size={18} />
            </Pressable>
          </View>
        ) : (
          <View style={styles.content}>
            <View style={[styles.hero, shadows.raised, { backgroundColor: palette.brand }]}>
              <View style={styles.heroHead}>
                <View style={styles.heroCopy}>
                  <Text style={styles.heroEyebrow}>CURRENT BRANCH</Text>
                  <Text numberOfLines={1} style={styles.heroTitle}>
                    {firstString(branch, ["displayName", "display_name", "name"]) ?? "SKIMA station"}
                  </Text>
                  <Text numberOfLines={2} style={styles.heroBody}>
                    {firstString(branch, ["formattedAddress", "formatted_address", "address"]) ?? "Branch address unavailable"}
                  </Text>
                </View>
                <StatusPill
                  label={friendlyStatus(availability)}
                  tone={normalizedAvailability === "available" ? "success" : normalizedAvailability === "paused" ? "warning" : "neutral"}
                />
              </View>

              <View style={styles.heroMetrics}>
                <HeroMetric label="Available stock" value={availableKg === null ? "Not reported" : `${availableKg} kg`} />
                <View style={styles.heroDivider} />
                <HeroMetric label="In reception queue" value={String(activeRecords.length)} />
              </View>
            </View>

            <View style={styles.headingRow}>
              <View>
                <Text style={[styles.eyebrow, { color: palette.brand }]}>TODAY AT RECEPTION</Text>
                <Text style={[styles.heading, { color: palette.ink }]}>Verify, fill and release safely.</Text>
              </View>
            </View>

            <View style={styles.actionGrid}>
              <OperationAction
                primary
                icon={<ShieldCheck color="#FFFFFF" size={24} />}
                title="Verify arrivals"
                description="Review the matched driver and cylinder after the driver scans at reception."
                onPress={() => router.push((currentId ? `/(station)/job/${currentId}` : "/(station)/jobs") as never)}
              />
              <OperationAction
                icon={<CircleCheck color={palette.brand} size={24} />}
                title="Safety & refill"
                description="Record the safety result and actual kilograms filled only after station reception verification."
                onPress={() => router.push((processingId ? `/(station)/job/${processingId}` : "/(station)/jobs") as never)}
              />
            </View>

            <View style={styles.statusGrid}>
              <StatusMetric label="Driver approaching" value={waitingForDriver} />
              <StatusMetric label="Ready for station" value={readyForStation} />
              <StatusMetric label="Being filled" value={processing} />
            </View>

            <SectionTitle title="Reception queue" action="Open all" onPress={() => router.push("/(station)/jobs")} />
            <View style={[styles.queue, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              {activeRecords.length ? (
                activeRecords.slice(0, 5).map((record, index) => (
                  <QueueRow key={recordId(record) ?? String(index)} record={record} index={index} />
                ))
              ) : (
                <View style={styles.emptyQueue}>
                  <View style={[styles.emptyQueueIcon, { backgroundColor: palette.successSoft }]}>
                    <ShieldCheck color={palette.success} size={23} />
                  </View>
                  <View style={styles.emptyQueueCopy}>
                    <Text style={[styles.emptyQueueTitle, { color: palette.ink }]}>Reception is clear</Text>
                    <Text style={[styles.emptyQueueBody, { color: palette.muted }]}>New matched LPG arrivals will appear here automatically.</Text>
                  </View>
                </View>
              )}
            </View>

            <SectionTitle title="Operations" />
            <View style={styles.utilities}>
              <UtilityRow
                icon={<Gauge color={palette.brand} size={20} />}
                label="Inventory & capacity"
                value={capacityKg === null ? "Capacity not reported" : `${availableKg === null ? "—" : availableKg} / ${capacityKg} kg available`}
                onPress={() => router.push("/(station)/inventory")}
              />
              <UtilityRow
                icon={<WalletCards color={palette.brand} size={20} />}
                label="Settlements"
                value={settlementSummary}
                onPress={() => router.push("/(station)/settlements")}
              />
              <UtilityRow
                icon={<Users color={palette.brand} size={20} />}
                label="Staff & permissions"
                value="Manage station access"
                onPress={() => router.push("/(station)/staff")}
              />
              <UtilityRow
                icon={<Settings2 color={palette.brand} size={20} />}
                label="Settings & pricing"
                value="Availability, hours and station price"
                onPress={() => router.push("/(station)/settings")}
                last
              />
            </View>

            <View style={[styles.handoff, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
              <ShieldCheck color={palette.mutedStrong} size={19} />
              <Text style={[styles.handoffText, { color: palette.muted }]}>The assigned driver scans the SKIMA cylinder at station reception. Station staff verify the matched job in this workspace; they do not need a separate cylinder-scanning action.</Text>
            </View>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

function HeroMetric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.heroMetric}>
      <Text style={styles.heroMetricValue}>{value}</Text>
      <Text style={styles.heroMetricLabel}>{label}</Text>
    </View>
  );
}

function OperationAction({
  primary = false,
  icon,
  title,
  description,
  onPress,
}: {
  primary?: boolean;
  icon: React.ReactNode;
  title: string;
  description: string;
  onPress(): void;
}) {
  const { palette } = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        {
          backgroundColor: primary ? palette.brand : palette.surface,
          borderColor: primary ? palette.brand : palette.border,
          opacity: pressed ? 0.84 : 1,
        },
      ]}
    >
      <View style={[styles.actionIcon, { backgroundColor: primary ? "rgba(255,255,255,.15)" : palette.brandSoft }]}>{icon}</View>
      <View style={styles.actionCopy}>
        <Text style={[styles.actionTitle, { color: primary ? "#FFFFFF" : palette.ink }]}>{title}</Text>
        <Text style={[styles.actionBody, { color: primary ? "rgba(255,255,255,.78)" : palette.muted }]}>{description}</Text>
      </View>
      <View style={[styles.actionArrow, { backgroundColor: primary ? "#FFFFFF" : palette.surfaceSubtle }]}>
        <ChevronRight color={primary ? palette.brand : palette.ink} size={18} />
      </View>
    </Pressable>
  );
}

function StatusMetric({ label, value }: { label: string; value: number }) {
  const { palette } = useAppTheme();
  return (
    <View style={[styles.statusMetric, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <Text style={[styles.statusValue, { color: palette.ink }]}>{value}</Text>
      <Text style={[styles.statusLabel, { color: palette.muted }]}>{label}</Text>
    </View>
  );
}

function QueueRow({ record, index }: { record: PlatformRecord; index: number }) {
  const { palette } = useAppTheme();
  const id = recordId(record);
  const status = displayStatus(record) ?? "pending";
  return (
    <Pressable
      disabled={!id}
      onPress={() => router.push(`/(station)/job/${id}` as never)}
      style={({ pressed }) => [
        styles.queueRow,
        index > 0 && { borderTopColor: palette.border, borderTopWidth: StyleSheet.hairlineWidth },
        { opacity: pressed ? 0.72 : 1 },
      ]}
    >
      <View style={[styles.sequence, { backgroundColor: palette.surfaceSubtle }]}>
        <Text style={[styles.sequenceText, { color: palette.ink }]}>{String(index + 1).padStart(2, "0")}</Text>
      </View>
      <View style={styles.queueCopy}>
        <Text numberOfLines={1} style={[styles.queueTitle, { color: palette.ink }]}>{displayTitle(record)}</Text>
        <Text numberOfLines={1} style={[styles.queueMeta, { color: palette.muted }]}>{displayReference(record) ?? "LPG refill"}</Text>
      </View>
      <StatusPill label={friendlyStatus(status)} tone={queueTone(status)} />
      <ChevronRight color={palette.muted} size={17} />
    </Pressable>
  );
}

function SectionTitle({ title, action, onPress }: { title: string; action?: string; onPress?: () => void }) {
  const { palette } = useAppTheme();
  return (
    <View style={styles.sectionHead}>
      <Text style={[styles.sectionTitle, { color: palette.ink }]}>{title}</Text>
      {action && onPress ? (
        <Pressable onPress={onPress} style={styles.sectionAction}>
          <Text style={[styles.sectionActionText, { color: palette.brand }]}>{action}</Text>
          <ChevronRight color={palette.brand} size={15} />
        </Pressable>
      ) : null}
    </View>
  );
}

function UtilityRow({ icon, label, value, onPress, last = false }: { icon: React.ReactNode; label: string; value: string; onPress(): void; last?: boolean }) {
  const { palette } = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.utility,
        !last && { borderBottomColor: palette.border, borderBottomWidth: StyleSheet.hairlineWidth },
        { opacity: pressed ? 0.72 : 1 },
      ]}
    >
      <View style={[styles.utilityIcon, { backgroundColor: palette.brandSoft }]}>{icon}</View>
      <View style={styles.utilityCopy}>
        <Text style={[styles.utilityLabel, { color: palette.ink }]}>{label}</Text>
        <Text numberOfLines={1} style={[styles.utilityValue, { color: palette.muted }]}>{value}</Text>
      </View>
      <ChevronRight color={palette.muted} size={18} />
    </Pressable>
  );
}

function isDriverApproaching(value?: string | null) {
  return ["driver_accepted", "pickup_en_route", "pickup_verified", "station_en_route"].includes(normalized(value ?? ""));
}

function isStationProcessing(value?: string | null) {
  return ["station_verified", "refill_started", "refill_in_progress", "refill_confirmed", "station_settled"].includes(normalized(value ?? ""));
}

function isStationQueueState(value?: string | null) {
  return [
    "driver_accepted",
    "pickup_en_route",
    "pickup_verified",
    "station_en_route",
    "station_verified",
    "refill_started",
    "refill_in_progress",
    "refill_confirmed",
    "station_settled",
  ].includes(normalized(value ?? ""));
}

function normalized(value: string) {
  return value.toLowerCase().replace(/[\s-]+/g, "_");
}

function friendlyStatus(value: string) {
  const key = normalized(value);
  const labels: Record<string, string> = {
    available: "Available",
    paused: "Paused",
    closed: "Closed",
    unavailable: "Unavailable",
    driver_accepted: "Driver assigned",
    pickup_en_route: "Driver at pickup",
    pickup_verified: "Cylinder collected",
    station_en_route: "Driver approaching",
    station_verified: "Verified at reception",
    refill_started: "Refill started",
    refill_in_progress: "Refill in progress",
    refill_confirmed: "Refill confirmed",
    station_settled: "Ready for driver",
    return_en_route: "Returning to customer",
    delivery_verification_pending: "Customer hand-over",
    delivered: "Delivered",
    completed: "Completed",
  };
  return labels[key] ?? key.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

function queueTone(value: string): "neutral" | "brand" | "success" | "warning" | "danger" {
  const key = normalized(value);
  if (["station_settled", "completed", "delivered"].includes(key)) return "success";
  if (["station_verified", "refill_started", "refill_in_progress", "refill_confirmed"].includes(key)) return "brand";
  if (["cancelled", "disputed"].includes(key)) return "danger";
  return "warning";
}

function money(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${currency} ${value.toFixed(0)}`;
  }
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, paddingBottom: 112 },
  frame: { width: "100%", alignSelf: "center", paddingHorizontal: 18 },
  header: { minHeight: 58, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  identity: { flex: 1, flexDirection: "row", alignItems: "center", gap: 11 },
  identityCopy: { flex: 1, gap: 2 },
  context: { ...typography.eyebrow, fontSize: 8 },
  greeting: { fontSize: 18, lineHeight: 22, fontWeight: "900", letterSpacing: -0.35 },
  notification: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 21, borderWidth: StyleSheet.hairlineWidth },
  switcher: { minHeight: 8, marginTop: 9 },
  content: { gap: spacing.lg, paddingTop: 18 },
  primaryLink: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, borderRadius: radii.md, paddingHorizontal: spacing.lg },
  primaryLinkText: { color: "#FFFFFF", ...typography.bodyStrong },
  hero: { gap: spacing.lg, padding: spacing.lg, borderRadius: radii.xl },
  heroHead: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md },
  heroCopy: { flex: 1, gap: 4 },
  heroEyebrow: { color: "rgba(255,255,255,.72)", ...typography.eyebrow, fontSize: 8 },
  heroTitle: { color: "#FFFFFF", fontSize: 23, lineHeight: 28, fontWeight: "900", letterSpacing: -0.45 },
  heroBody: { color: "rgba(255,255,255,.82)", ...typography.caption, lineHeight: 18 },
  heroMetrics: { flexDirection: "row", alignItems: "center" },
  heroMetric: { flex: 1, gap: 2 },
  heroMetricValue: { color: "#FFFFFF", fontSize: 21, fontWeight: "900" },
  heroMetricLabel: { color: "rgba(255,255,255,.70)", ...typography.caption, fontSize: 10 },
  heroDivider: { width: StyleSheet.hairlineWidth, height: 36, marginHorizontal: spacing.lg, backgroundColor: "rgba(255,255,255,.22)" },
  headingRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  eyebrow: { ...typography.eyebrow, fontSize: 8 },
  heading: { maxWidth: 320, fontSize: 22, lineHeight: 27, fontWeight: "900", letterSpacing: -0.45, marginTop: 4 },
  actionGrid: { flexDirection: "row", gap: spacing.sm },
  action: { flex: 1, minHeight: 205, justifyContent: "space-between", borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.md },
  actionIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  actionCopy: { gap: 5 },
  actionTitle: { fontSize: 17, lineHeight: 21, fontWeight: "900" },
  actionBody: { ...typography.caption, fontSize: 10, lineHeight: 15 },
  actionArrow: { width: 34, height: 34, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  statusGrid: { flexDirection: "row", gap: spacing.sm },
  statusMetric: { flex: 1, minWidth: 0, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md, gap: 3 },
  statusValue: { fontSize: 20, fontWeight: "900" },
  statusLabel: { ...typography.caption, fontSize: 9, lineHeight: 13 },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { fontSize: 19, lineHeight: 24, fontWeight: "900", letterSpacing: -0.3 },
  sectionAction: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: 2 },
  sectionActionText: { ...typography.caption, fontWeight: "900" },
  queue: { overflow: "hidden", borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, paddingHorizontal: spacing.md },
  queueRow: { minHeight: 74, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  sequence: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  sequenceText: { ...typography.caption, fontWeight: "900" },
  queueCopy: { flex: 1, minWidth: 0, gap: 2 },
  queueTitle: { ...typography.bodyStrong, fontSize: 13 },
  queueMeta: { ...typography.caption, fontSize: 10 },
  emptyQueue: { minHeight: 88, flexDirection: "row", alignItems: "center", gap: spacing.md },
  emptyQueueIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  emptyQueueCopy: { flex: 1, gap: 3 },
  emptyQueueTitle: { ...typography.bodyStrong, fontSize: 14 },
  emptyQueueBody: { ...typography.caption, lineHeight: 17 },
  utilities: { borderRadius: radii.xl, overflow: "hidden" },
  utility: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: spacing.md },
  utilityIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  utilityCopy: { flex: 1, gap: 2 },
  utilityLabel: { ...typography.bodyStrong, fontSize: 13 },
  utilityValue: { ...typography.caption, fontSize: 10 },
  handoff: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm + 2, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  handoffText: { flex: 1, ...typography.caption, lineHeight: 18 },
});