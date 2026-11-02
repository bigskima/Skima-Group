import { router } from "expo-router";
import { BriefcaseBusiness, ChevronRight, MapPin, Package, Search } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { asString, useLogisticsQuery } from "../api/logistics";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";
import { AppField } from "../ui/AppField";
import { Card } from "../ui/Card";
import { Screen } from "../ui/Screen";
import { ScreenSkeleton } from "../ui/ScreenSkeleton";
import { SectionHeader } from "../ui/SectionHeader";
import { StatePanel } from "../ui/StatePanel";
import { StatusPill } from "../ui/StatusPill";

function record(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function place(value: unknown) { return asString(record(value), "display_name", "canonical_name", "formatted_address", "address") ?? "Location details"; }

export function ProviderOpportunitiesScreen() {
  const { palette } = useAppTheme();
  const companies = useLogisticsQuery(["provider-company"], "/runtime/logistics/company");
  const opportunities = useLogisticsQuery(["provider-opportunities"], "/runtime/logistics/opportunities", true, 20_000);
  const services = useLogisticsQuery(["provider-services"], "/runtime/logistics/company/services");
  const organizationId = asString(companies.data?.[0], "organization_id");
  const verified = asString(companies.data?.[0], "verification_status") === "verified" && asString(companies.data?.[0], "operational_status") === "active";
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const rows = useMemo(() => (opportunities.data ?? []).filter((item) => {
    if (asString(item, "organization_id") !== organizationId) return false;
    const status = asString(item, "status") ?? "";
    if (filter !== "all" && status !== filter) return false;
    const snapshot = record(item.job_snapshot);
    const query = search.trim().toLowerCase();
    return !query || [asString(snapshot, "title"), asString(snapshot, "category_key"), place(snapshot.pickup), place(snapshot.destination)].some((part) => part?.toLowerCase().includes(query));
  }), [opportunities.data, organizationId, filter, search]);
  const pending = companies.isPending || opportunities.isPending || services.isPending;
  const refresh = () => Promise.all([companies.refetch(), opportunities.refetch(), services.refetch()]);

  return (
    <Screen eyebrow="MATCHED REQUESTS" title="Opportunities" subtitle="Only requests matched to your company’s services and operating areas."
      refreshControl={<RefreshControl refreshing={opportunities.isRefetching || companies.isRefetching} onRefresh={() => void refresh()} tintColor={palette.brand} />}>
      {pending ? <ScreenSkeleton cards={3} /> : !companies.data?.length ? (
        <StatePanel title="Company registration required" description="Register your company before viewing logistics opportunities." retry={() => router.push("/provider/register" as never)} />
      ) : !verified ? (
        <Card variant="warning" padding="lg"><Text style={[styles.noticeTitle, { color: palette.ink }]}>Your company is not active yet</Text><Text style={[styles.noticeBody, { color: palette.muted }]}>Your opportunity inbox opens after SKIMA verifies your company and activates its services.</Text></Card>
      ) : opportunities.error ? (
        <StatePanel title="Opportunities could not load" description="Try refreshing your company inbox." retry={() => void refresh()} />
      ) : (
        <View style={styles.content}>
          <AppField label="Search requests" value={search} onChangeText={setSearch} placeholder="Search service, pickup or destination" leading={<Search color={palette.muted} size={16} />} />
          <View style={styles.filters}>
            {["all", "matched", "offered", "selected"].map((key) => {
              const chosen = filter === key;
              return <Pressable key={key} onPress={() => setFilter(key)} style={[styles.filter, { backgroundColor: chosen ? palette.brand : palette.surface, borderColor: chosen ? palette.brand : palette.border }]}><Text style={[styles.filterText, { color: chosen ? "#FFFFFF" : palette.muted }]}>{key === "all" ? "All" : key[0].toUpperCase()+key.slice(1)}</Text></Pressable>;
            })}
          </View>
          <SectionHeader title="Requests in your area" description={`${rows.length} matched ${rows.length === 1 ? "request" : "requests"}`} />
          {rows.length === 0 ? <Card variant="subtle" padding="lg"><View style={styles.empty}><BriefcaseBusiness color={palette.muted} size={25} /><Text style={[styles.noticeTitle, { color: palette.ink }]}>No matching opportunities</Text><Text style={[styles.noticeBody, { color: palette.muted }]}>New requests will appear when a customer’s service, pickup, destination and cargo requirements match your company.</Text></View></Card> : (
            <View style={styles.list}>
              {rows.map((item) => {
                const snapshot = record(item.job_snapshot);
                return <Pressable key={String(item.id)} onPress={() => router.push({ pathname: "/provider/jobs/[id]", params: { id: String(item.id) } } as never)} style={({ pressed }) => [styles.card, { backgroundColor: palette.surface, borderColor: palette.border, opacity: pressed ? 0.88 : 1 }]}>
                  <View style={styles.cardHead}>
                    <View style={[styles.icon, { backgroundColor: palette.brandSoft }]}><Package color={palette.brand} size={18} /></View>
                    <View style={styles.cardCopy}>
                      <Text style={[styles.cardTitle, { color: palette.ink }]} numberOfLines={1}>{asString(snapshot, "title") ?? "Logistics request"}</Text>
                      <Text style={[styles.cardMeta, { color: palette.muted }]}>{asString(snapshot, "category_key")?.replace(/[._]/g, " ") ?? "Customer request"}</Text>
                    </View>
                    <StatusPill status={asString(item, "status") ?? "matched"} />
                  </View>
                  <View style={[styles.route, { backgroundColor: palette.surfaceSubtle }]}>
                    <View style={styles.routeLine}><MapPin color={palette.brand} size={13} /><Text style={[styles.routeText, { color: palette.ink }]} numberOfLines={1}>{place(snapshot.pickup)}</Text></View>
                    <View style={styles.routeLine}><MapPin color={palette.success} size={13} /><Text style={[styles.routeText, { color: palette.ink }]} numberOfLines={1}>{place(snapshot.destination)}</Text></View>
                  </View>
                  <View style={styles.footer}><Text style={[styles.cardMeta, { color: palette.muted }]}>Matched to your coverage</Text><View style={styles.view}><Text style={[styles.viewText, { color: palette.brand }]}>Review request</Text><ChevronRight color={palette.brand} size={15} /></View></View>
                </Pressable>;
              })}
            </View>
          )}
        </View>
      )}
    </Screen>
  );
}
const styles = StyleSheet.create({
  content: { gap: spacing.md },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  filter: { minHeight: 35, justifyContent: "center", borderRadius: radii.pill, borderWidth: 1, paddingHorizontal: 13 },
  filterText: { ...typography.caption, fontSize: 10, fontWeight: "900" },
  list: { gap: 9 },
  card: { gap: 11, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: 13 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 9 },
  icon: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  cardCopy: { flex: 1, minWidth: 0, gap: 2 },
  cardTitle: { ...typography.bodyStrong, fontSize: 12 },
  cardMeta: { ...typography.caption, fontSize: 9, textTransform: "capitalize" },
  route: { borderRadius: radii.lg, padding: 10, gap: 8 },
  routeLine: { flexDirection: "row", alignItems: "center", gap: 7 },
  routeText: { flex: 1, ...typography.caption, fontSize: 10 },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  view: { flexDirection: "row", alignItems: "center", gap: 3 },
  viewText: { ...typography.caption, fontSize: 10, fontWeight: "900" },
  empty: { alignItems: "flex-start", gap: 9 },
  noticeTitle: { ...typography.bodyStrong, fontSize: 14 },
  noticeBody: { ...typography.caption, lineHeight: 18 },
});
