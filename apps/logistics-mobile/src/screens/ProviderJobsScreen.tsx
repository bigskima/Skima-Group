import { router } from "expo-router";
import { ClipboardList, Clock3, MapPin, Truck } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
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
function nested(record: Record<string, unknown> | null | undefined, key: string) {
  const value = record?.[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function labelPlace(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Location details";
  return asString(value as Record<string, unknown>, "display_name", "canonical_name", "formatted_address", "address") ?? "Location details";
}
const FINISHED = new Set(["settled", "completed_offline", "cancelled", "refunded"]);

export function ProviderJobsScreen() {
  const { palette } = useAppTheme();
  const companies = useLogisticsQuery(["company"], "/runtime/logistics/company");
  const organizationId = asString(companies.data?.[0], "organization_id");
  const bookings = useLogisticsQuery(
    ["provider-bookings", organizationId ?? "none"],
    `/runtime/logistics/bookings?providerOrganizationId=${encodeURIComponent(organizationId ?? "")}`,
    Boolean(organizationId), 20_000,
  );
  const [filter, setFilter] = useState<Filter>("active");
  const rows = useMemo(() => (bookings.data ?? []).filter((booking) => {
    const status = (asString(booking, "status") ?? "").toLowerCase();
    return filter === "all" ? true : filter === "completed" ? FINISHED.has(status) : !FINISHED.has(status);
  }), [bookings.data, filter]);
  const refresh = () => Promise.all([companies.refetch(), bookings.refetch()]);

  return (
    <Screen eyebrow="COMPANY WORK" title="Jobs & bookings" subtitle="Manage accepted bookings, active deliveries and hand-offs awaiting customer confirmation."
      refreshControl={<RefreshControl refreshing={bookings.isRefetching || companies.isRefetching} onRefresh={() => void refresh()} tintColor={palette.brand} />}>
      {companies.isPending || (Boolean(organizationId) && bookings.isPending) ? <ScreenSkeleton cards={3} /> : companies.error || bookings.error ? (
        <StatePanel title="Company jobs could not load" description="Refresh to reconnect to your provider workspace." retry={() => void refresh()} />
      ) : !organizationId ? (
        <StatePanel title="Register your company first" description="Your accepted bookings will appear here after company registration." />
      ) : (
        <View style={styles.content}>
          <View style={styles.filters}>
            {(["active", "completed", "all"] as const).map((key) => {
              const selected = filter === key;
              return <Pressable key={key} onPress={() => setFilter(key)} style={[styles.filter, { backgroundColor: selected ? palette.brand : palette.surface, borderColor: selected ? palette.brand : palette.border }]}>
                <Text style={[styles.filterText, { color: selected ? "#FFFFFF" : palette.muted }]}>{key === "active" ? "Active" : key === "completed" ? "Completed" : "All"}</Text>
              </Pressable>;
            })}
          </View>
          <SectionHeader title={filter === "active" ? "Current work" : filter === "completed" ? "Completed work" : "All company jobs"} description={`${rows.length} ${rows.length === 1 ? "booking" : "bookings"}`} />
          {rows.length === 0 ? (
            <Card variant="subtle" padding="lg">
              <View style={styles.empty}>
                <View style={[styles.emptyIcon, { backgroundColor: palette.brandSoft }]}><ClipboardList color={palette.brand} size={22} /></View>
                <Text style={[styles.emptyTitle, { color: palette.ink }]}>{filter === "completed" ? "No completed jobs yet" : "No active bookings"}</Text>
                <Text style={[styles.emptyBody, { color: palette.muted }]}>When a customer confirms an offer and the required payment step is complete, the booking will appear here for your team to accept.</Text>
                {filter !== "completed" ? <AppButton label="View opportunities" fullWidth onPress={() => router.push("/(provider)/opportunities" as never)} /> : null}
              </View>
            </Card>
          ) : (
            <View style={styles.list}>
              {rows.map((booking) => {
                const id = asString(booking, "id") ?? "";
                const offer = nested(booking, "offer");
                const opportunity = nested(offer, "opportunity");
                const snapshot = nested(opportunity, "job_snapshot");
                const job = nested(booking, "job");
                const title = asString(snapshot, "title") ?? asString(job, "title") ?? "Logistics booking";
                const pickup = labelPlace(snapshot?.pickup ?? job?.pickup_location);
                const destination = labelPlace(snapshot?.destination ?? job?.destination_location);
                const status = asString(booking, "status") ?? "booked";
                return (
                  <Pressable key={id} accessibilityRole="button" onPress={() => router.push({ pathname: "/(provider)/work/[id]", params: { id } } as never)}
                    style={({ pressed }) => [styles.booking, { backgroundColor: palette.surface, borderColor: palette.border, opacity: pressed ? 0.9 : 1 }]}>
                    <View style={styles.bookingTop}>
                      <View style={[styles.icon, { backgroundColor: palette.brandSoft }]}><Truck color={palette.brand} size={18} /></View>
                      <View style={styles.bookingCopy}>
                        <Text style={[styles.bookingTitle, { color: palette.ink }]} numberOfLines={1}>{title}</Text>
                        <Text style={[styles.bookingMeta, { color: palette.muted }]}>{asString(booking, "currency_code") ?? ""} · {asString(booking, "payment_mode") === "offline" ? "Offline booking" : "Online escrow"}</Text>
                      </View>
                      <StatusPill status={status} />
                    </View>
                    <View style={[styles.route, { backgroundColor: palette.surfaceSubtle }]}>
                      <View style={styles.routeLine}><MapPin color={palette.brand} size={13} /><Text style={[styles.routeText, { color: palette.ink }]} numberOfLines={1}>{pickup}</Text></View>
                      <View style={styles.routeLine}><MapPin color={palette.success} size={13} /><Text style={[styles.routeText, { color: palette.ink }]} numberOfLines={1}>{destination}</Text></View>
                    </View>
                    <View style={styles.footer}>
                      <View style={styles.footerMeta}><Clock3 color={palette.muted} size={13} /><Text style={[styles.bookingMeta, { color: palette.muted }]}>{formatDate(asString(booking, "created_at"))}</Text></View>
                      <Text style={[styles.open, { color: palette.brand }]}>Open job details →</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
      )}
    </Screen>
  );
}
function formatDate(value: string | null) {
  if (!value) return "Recently booked";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Recently booked" : new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short" }).format(parsed);
}
const styles = StyleSheet.create({
  content: { gap: spacing.md },
  filters: { flexDirection: "row", gap: 8 },
  filter: { minHeight: 36, borderRadius: radii.pill, borderWidth: 1, justifyContent: "center", paddingHorizontal: 14 },
  filterText: { ...typography.caption, fontSize: 10, fontWeight: "900" },
  list: { gap: 10 },
  booking: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: 13, gap: 11 },
  bookingTop: { flexDirection: "row", alignItems: "center", gap: 9 },
  icon: { width: 39, height: 39, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  bookingCopy: { flex: 1, minWidth: 0, gap: 2 },
  bookingTitle: { ...typography.bodyStrong, fontSize: 12 },
  bookingMeta: { ...typography.caption, fontSize: 9 },
  route: { borderRadius: radii.lg, padding: 10, gap: 7 },
  routeLine: { flexDirection: "row", alignItems: "center", gap: 7 },
  routeText: { flex: 1, ...typography.caption, fontSize: 10 },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  footerMeta: { flexDirection: "row", alignItems: "center", gap: 5 },
  open: { ...typography.caption, fontSize: 10, fontWeight: "900" },
  empty: { alignItems: "flex-start", gap: 10 },
  emptyIcon: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  emptyTitle: { ...typography.bodyStrong, fontSize: 14 },
  emptyBody: { ...typography.caption, lineHeight: 17, fontSize: 10 },
});
