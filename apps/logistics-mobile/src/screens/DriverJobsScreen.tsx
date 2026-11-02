import { router } from "expo-router";
import { BriefcaseBusiness, Clock3, MapPin, Package, Truck } from "lucide-react-native";
import { useMemo } from "react";
import { Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { asNumber, asString, useLogisticsQuery, useLogisticsRecordQuery } from "../api/logistics";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";
import { Card } from "../ui/Card";
import { Screen } from "../ui/Screen";
import { ScreenSkeleton } from "../ui/ScreenSkeleton";
import { SectionHeader } from "../ui/SectionHeader";
import { StatePanel } from "../ui/StatePanel";
import { StatusPill } from "../ui/StatusPill";

function nested(record: Record<string, unknown> | null | undefined, key: string) {
  const value = record?.[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function place(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Location details";
  return asString(value as Record<string, unknown>, "display_name", "canonical_name", "formatted_address", "address") ?? "Location details";
}
function dateLabel(value: string | null) {
  if (!value) return "Recently assigned";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Recently assigned" : new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(parsed);
}
export function DriverJobsScreen() {
  const { palette } = useAppTheme();
  const profile = useLogisticsRecordQuery(["driver-profile"], "/runtime/logistics/driver/profile");
  const jobs = useLogisticsQuery(["driver-bookings"], "/runtime/logistics/driver/bookings", true, 15_000);
  const rows = useMemo(() => jobs.data ?? [], [jobs.data]);
  const refresh = () => Promise.all([profile.refetch(), jobs.refetch()]);

  return (
    <Screen eyebrow="DRIVER WORKSPACE" title="My delivery jobs" subtitle="Accept assignments, follow the hand-off steps and keep customers informed."
      refreshControl={<RefreshControl refreshing={jobs.isRefetching || profile.isRefetching} onRefresh={() => void refresh()} tintColor={palette.brand} />}>
      {profile.isPending || jobs.isPending ? <ScreenSkeleton cards={3} /> : profile.error || jobs.error ? (
        <StatePanel title="Driver workspace unavailable" description="We could not load your driver profile or assigned jobs." retry={() => void refresh()} />
      ) : asString(profile.data, "driver_profile_id") === null ? (
        <Card padding="lg">
          <View style={[styles.icon, { backgroundColor: palette.brandSoft }]}><Truck color={palette.brand} size={22} /></View>
          <Text style={[styles.title, { color: palette.ink }]}>No driver profile found</Text>
          <Text style={[styles.meta, { color: palette.muted }]}>Your company administrator must complete your driver onboarding and approval before they can assign Logistics jobs to you.</Text>
        </Card>
      ) : rows.length === 0 ? (
        <Card variant="subtle" padding="lg">
          <View style={styles.empty}>
            <View style={[styles.icon, { backgroundColor: palette.brandSoft }]}><BriefcaseBusiness color={palette.brand} size={22} /></View>
            <Text style={[styles.title, { color: palette.ink }]}>No active assignments</Text>
            <Text style={[styles.meta, { color: palette.muted }]}>When your company assigns you a delivery, it will appear here. You must accept each assignment before starting the job.</Text>
            <StatusPill status={asString(profile.data, "verification_status") ?? "pending"} />
          </View>
        </Card>
      ) : (
        <View style={styles.content}>
          <Card variant="brandSoft" padding="lg">
            <Text style={[styles.eyebrow, { color: palette.brand }]}>ASSIGNED TO YOU</Text>
            <Text style={[styles.title, { color: palette.ink }]}>{rows.length} {rows.length === 1 ? "job" : "jobs"}</Text>
            <Text style={[styles.meta, { color: palette.muted }]}>Only bookings assigned to your verified driver profile are shown.</Text>
          </Card>
          <SectionHeader title="Your assignments" description="Open a job for customer contact and required delivery steps." />
          {rows.map((item) => {
            const bookingId = asString(item, "booking_id") ?? "";
            const assignment = nested(item, "assignment");
            const vehicle = nested(assignment, "vehicle");
            const status = asString(assignment, "status") ?? asString(item, "booking_status") ?? "offered";
            return (
              <Pressable key={bookingId} accessibilityRole="button"
                onPress={() => router.push({ pathname: "/(driver)/work/[id]", params: { id: bookingId } } as never)}
                style={({ pressed }) => [styles.job, { backgroundColor: palette.surface, borderColor: palette.border, opacity: pressed ? 0.88 : 1 }]}>
                <View style={styles.jobTop}>
                  <View style={[styles.icon, { backgroundColor: palette.brandSoft }]}><Package color={palette.brand} size={19} /></View>
                  <View style={styles.jobCopy}>
                    <Text style={[styles.title, { color: palette.ink }]} numberOfLines={2}>{asString(item, "title") ?? "Logistics delivery"}</Text>
                    <Text style={[styles.meta, { color: palette.muted }]}>{bookingId.slice(0, 8).toUpperCase()} · {asString(item, "currency_code") ?? ""} {asNumber(item, "delivery_amount")?.toLocaleString("en-NG") ?? ""}</Text>
                  </View>
                  <StatusPill status={status} />
                </View>
                <View style={[styles.route, { backgroundColor: palette.surfaceSubtle }]}>
                  <View style={styles.routeLine}><MapPin color={palette.brand} size={13} /><Text style={[styles.routeText, { color: palette.ink }]} numberOfLines={1}>{place(item.pickup_location)}</Text></View>
                  <View style={styles.routeLine}><MapPin color={palette.success} size={13} /><Text style={[styles.routeText, { color: palette.ink }]} numberOfLines={1}>{place(item.destination_location)}</Text></View>
                </View>
                <View style={styles.footer}>
                  <View style={styles.footerMeta}><Clock3 color={palette.muted} size={13} /><Text style={[styles.meta, { color: palette.muted }]}>{dateLabel(asString(assignment, "offered_at"))}</Text></View>
                  <Text style={[styles.vehicle, { color: palette.muted }]}>{[asString(vehicle, "vehicle_type"), asString(vehicle, "registration_number")].filter(Boolean).join(" · ")}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </Screen>
  );
}
const styles = StyleSheet.create({
  content: { gap: spacing.md },
  empty: { alignItems: "flex-start", gap: 10 },
  icon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  eyebrow: { ...typography.eyebrow, fontSize: 8 },
  title: { ...typography.bodyStrong, fontSize: 13 },
  meta: { ...typography.caption, fontSize: 10, lineHeight: 17 },
  job: { borderWidth: 1, borderRadius: radii.xl, padding: 13, gap: 10 },
  jobTop: { flexDirection: "row", alignItems: "center", gap: 9 },
  jobCopy: { flex: 1, minWidth: 0, gap: 2 },
  route: { borderRadius: radii.md, padding: 10, gap: 7 },
  routeLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  routeText: { ...typography.caption, fontSize: 10, flex: 1 },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 9 },
  footerMeta: { flexDirection: "row", alignItems: "center", gap: 6 },
  vehicle: { ...typography.caption, fontSize: 9, textAlign: "right", flexShrink: 1 },
});
