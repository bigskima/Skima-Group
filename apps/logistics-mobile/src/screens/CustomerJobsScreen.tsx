import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { ClipboardList, Package, Plus, Route, Truck } from "lucide-react-native";
import { asString, useLogisticsQuery } from "../api/logistics";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";
import { AppButton } from "../ui/AppButton";
import { Card } from "../ui/Card";
import { Screen } from "../ui/Screen";
import { ScreenSkeleton } from "../ui/ScreenSkeleton";
import { SectionHeader } from "../ui/SectionHeader";
import { StatePanel } from "../ui/StatePanel";
import { StatusPill } from "../ui/StatusPill";

type Filter = "active" | "completed" | "all";
function locationName(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Location pending";
  const record = value as Record<string, unknown>;
  return asString(record, "display_name", "canonical_name", "formatted_address", "address") ?? "Location pending";
}
const COMPLETED = new Set(["completed", "completed_offline", "delivered", "cancelled", "expired"]);

export function CustomerJobsScreen() {
  const { palette } = useAppTheme();
  const jobs = useLogisticsQuery(["jobs"], "/runtime/logistics/jobs", true, 25_000);
  const [filter, setFilter] = useState<Filter>("active");
  const rows = useMemo(() => (jobs.data ?? []).filter((job) => {
    const status = (asString(job, "status") ?? "").toLowerCase();
    return filter === "all" ? true : filter === "completed" ? COMPLETED.has(status) : !COMPLETED.has(status);
  }), [filter, jobs.data]);
  return (
    <Screen eyebrow="YOUR ACTIVITY" title="Requests & bookings" subtitle="Track your requests and bookings from the first response to completion."
      action={<AppButton label="New request" size="sm" onPress={() => router.push("/(customer)/request" as never)} />}
      refreshControl={<RefreshControl refreshing={jobs.isRefetching} onRefresh={() => void jobs.refetch()} tintColor={palette.brand} />}>
      <View style={styles.filters}>
        {(["active", "completed", "all"] as const).map((key) => {
          const selected = filter === key;
          return <Pressable key={key} onPress={() => setFilter(key)} style={[styles.filter, { backgroundColor: selected ? palette.brand : palette.surface, borderColor: selected ? palette.brand : palette.border }]}>
            <Text style={[styles.filterText, { color: selected ? "#FFFFFF" : palette.muted }]}>{key === "active" ? "Active" : key === "completed" ? "Past" : "All"}</Text>
          </Pressable>;
        })}
      </View>
      <SectionHeader title={filter === "active" ? "In progress" : filter === "completed" ? "Past requests" : "All requests"} description={`${rows.length} ${rows.length === 1 ? "request" : "requests"}`} />
      {jobs.isPending ? <ScreenSkeleton cards={3} /> : jobs.error ? (
        <StatePanel title="Activity couldn’t load" description="Check your connection and try again. Your saved requests are not affected." icon={<ClipboardList color={palette.brand} size={24} />} retry={() => void jobs.refetch()} />
      ) : rows.length === 0 ? (
        <Card variant="subtle" padding="lg">
          <View style={styles.empty}>
            <View style={[styles.emptyIcon, { backgroundColor: palette.brandSoft }]}><Package color={palette.brand} size={24} /></View>
            <Text style={[styles.emptyTitle, { color: palette.ink }]}>{filter === "completed" ? "No past requests yet" : "No active requests"}</Text>
            <Text style={[styles.emptyBody, { color: palette.muted }]}>{filter === "completed" ? "Your completed trips will appear here." : "Create a request and find providers for your route."}</Text>
            {filter !== "completed" ? <AppButton label="Create a request" fullWidth onPress={() => router.push("/(customer)/request" as never)} /> : null}
          </View>
        </Card>
      ) : (
        <View style={styles.list}>
          {rows.map((job) => {
            const id = asString(job, "id");
            const title = asString(job, "title") ?? "Logistics request";
            return <Pressable key={id ?? title} accessibilityRole="button" onPress={() => id && router.push({ pathname: "/(customer)/jobs/[id]", params: { id } } as never)}
              style={({ pressed }) => [styles.jobCard, { backgroundColor: palette.surface, borderColor: palette.border, opacity: pressed ? 0.92 : 1 }]}>
              <View style={styles.jobHead}>
                <View style={[styles.jobIcon, { backgroundColor: palette.brandSoft }]}><Truck color={palette.brand} size={20} /></View>
                <View style={styles.jobCopy}>
                  <Text numberOfLines={1} style={[styles.jobTitle, { color: palette.ink }]}>{title}</Text>
                  <Text style={[styles.jobRef, { color: palette.muted }]}>{asString(job, "service_key")?.replace(/[._]/g, " ") ?? "Logistics service"}</Text>
                </View>
                <StatusPill status={asString(job, "status") ?? "open"} />
              </View>
              <View style={[styles.routeBox, { backgroundColor: palette.surfaceSubtle }]}>
                <View style={styles.routeLine}>
                  <View style={[styles.routeDot, { backgroundColor: palette.brand }]} />
                  <Text style={[styles.routeText, { color: palette.ink }]} numberOfLines={1}>{locationName(job.pickup_location)}</Text>
                </View>
                <View style={[styles.routeStem, { borderColor: palette.borderStrong }]} />
                <View style={styles.routeLine}>
                  <View style={[styles.routeDot, { backgroundColor: palette.success }]} />
                  <Text style={[styles.routeText, { color: palette.ink }]} numberOfLines={1}>{locationName(job.destination_location)}</Text>
                </View>
              </View>
              <View style={styles.jobFooter}>
                <Text style={[styles.jobDate, { color: palette.muted }]}>{asString(job, "created_at") ? new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", year: "numeric" }).format(new Date(String(job.created_at))) : "Recently created"}</Text>
                <View style={styles.viewDetails}><Text style={[styles.viewText, { color: palette.brand }]}>View details</Text><Route color={palette.brand} size={14} /></View>
              </View>
            </Pressable>;
          })}
        </View>
      )}
    </Screen>
  );
}
const styles = StyleSheet.create({
  filters: { flexDirection: "row", gap: 8 },
  filter: { minHeight: 38, justifyContent: "center", borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: 16 },
  filterText: { ...typography.caption, fontSize: 11, fontWeight: "900", textTransform: "capitalize" },
  list: { gap: 10 },
  jobCard: { gap: 13, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: 14 },
  jobHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  jobIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  jobCopy: { flex: 1, minWidth: 0, gap: 2 },
  jobTitle: { ...typography.bodyStrong, fontSize: 13 },
  jobRef: { ...typography.caption, fontSize: 9, textTransform: "capitalize" },
  routeBox: { borderRadius: radii.lg, padding: 11, gap: 4 },
  routeLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  routeDot: { width: 7, height: 7, borderRadius: 4 },
  routeText: { flex: 1, ...typography.caption, fontSize: 10 },
  routeStem: { height: 9, borderLeftWidth: 1, marginLeft: 3 },
  jobFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  jobDate: { ...typography.caption, fontSize: 9 },
  viewDetails: { flexDirection: "row", alignItems: "center", gap: 4 },
  viewText: { ...typography.caption, fontSize: 10, fontWeight: "900" },
  empty: { alignItems: "flex-start", gap: 11 },
  emptyIcon: { width: 52, height: 52, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  emptyTitle: { ...typography.bodyStrong, fontSize: 15 },
  emptyBody: { ...typography.caption, lineHeight: 18 },
});
