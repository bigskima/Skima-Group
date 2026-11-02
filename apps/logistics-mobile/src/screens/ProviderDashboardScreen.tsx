import { router } from "expo-router";
import { ArrowRight, Bell, BriefcaseBusiness, Building2, CheckCircle2, ClipboardList, ShieldCheck, Truck } from "lucide-react-native";
import { useMemo, type ReactNode } from "react";
import { Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { asString, useLogisticsQuery } from "../api/logistics";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";
import { AppButton } from "../ui/AppButton";
import { BrandMark } from "../ui/BrandMark";
import { Card } from "../ui/Card";
import { Screen } from "../ui/Screen";
import { ScreenSkeleton } from "../ui/ScreenSkeleton";
import { SectionHeader } from "../ui/SectionHeader";
import { StatePanel } from "../ui/StatePanel";
import { StatusPill } from "../ui/StatusPill";

export function ProviderDashboardScreen() {
  const { palette } = useAppTheme();
  const { context, session } = useSession();
  const companies = useLogisticsQuery(["company"], "/runtime/logistics/company", true, 45_000);
  const company = companies.data?.[0] ?? null;
  const organizationId = asString(company, "organization_id");
  const opportunities = useLogisticsQuery(
    ["opportunities", organizationId ?? "none"],
    `/runtime/logistics/opportunities?organizationId=${encodeURIComponent(organizationId ?? "")}`,
    Boolean(organizationId), 30_000,
  );
  const jobs = useLogisticsQuery(
    ["provider-bookings", organizationId ?? "none"],
    `/runtime/logistics/bookings?providerOrganizationId=${encodeURIComponent(organizationId ?? "")}`,
    Boolean(organizationId), 30_000,
  );
  const openOpportunities = useMemo(
    () => (opportunities.data ?? []).filter((item) => ["matched", "viewed", "offered"].includes((asString(item, "status") ?? "").toLowerCase())),
    [opportunities.data],
  );
  const activeBookings = useMemo(
    () => (jobs.data ?? []).filter((item) => !["settled", "completed", "completed_offline", "cancelled", "refunded"].includes((asString(item, "status") ?? "").toLowerCase())),
    [jobs.data],
  );
  const ownerName = context?.profile?.display_name?.split(/\s+/)[0] ?? session?.user.email?.split("@")[0] ?? "there";
  const refresh = () => Promise.all([companies.refetch(), opportunities.refetch(), jobs.refetch()]);
  return (
    <Screen eyebrow="PROVIDER WORKSPACE" title={`Welcome, ${ownerName}`} subtitle="Run your logistics company and respond to qualified customer requests."
      action={<Pressable accessibilityRole="button" accessibilityLabel="Open company settings" onPress={() => router.push("/(provider)/services" as never)}
        style={[styles.avatar, { backgroundColor: palette.brandSoft, borderColor: palette.border }]}><Building2 color={palette.brand} size={19} /></Pressable>}
      refreshControl={<RefreshControl refreshing={companies.isRefetching || opportunities.isRefetching || jobs.isRefetching} onRefresh={() => void refresh()} tintColor={palette.brand} />}>
      <View style={styles.brandRow}><BrandMark /><View style={[styles.trustBadge, { backgroundColor: palette.successSoft }]}><ShieldCheck color={palette.success} size={13} /><Text style={[styles.trustText, { color: palette.success }]}>Company portal</Text></View></View>
      {companies.isPending ? <ScreenSkeleton cards={2} /> : companies.error ? (
        <StatePanel title="Company profile unavailable" description="We could not load your company workspace." retry={() => void companies.refetch()} />
      ) : !company ? (
        <Card padding="lg">
          <View style={[styles.setupIcon, { backgroundColor: palette.brandSoft }]}><Building2 color={palette.brand} size={25} /></View>
          <Text style={[styles.setupTitle, { color: palette.ink }]}>Set up your logistics company</Text>
          <Text style={[styles.setupBody, { color: palette.muted }]}>Register your organisation, configure the services you provide and define the areas your team can cover.</Text>
          <AppButton label="Set up company" fullWidth onPress={() => router.push("/(provider)/services" as never)} trailingIcon={<ArrowRight color="#FFFFFF" size={16} />} />
        </Card>
      ) : (
        <>
          <Card variant="brandSoft" padding="lg">
            <View style={styles.companyHead}>
              <View style={[styles.companyMark, { backgroundColor: palette.surface }]}><Building2 color={palette.brand} size={22} /></View>
              <View style={styles.companyCopy}>
                <Text style={[styles.companyEyebrow, { color: palette.brand }]}>YOUR COMPANY</Text>
                <Text style={[styles.companyName, { color: palette.ink }]}>{asString(company, "public_name") ?? asString(company, "organization_name") ?? "Logistics provider"}</Text>
                <Text style={[styles.companySub, { color: palette.muted }]}>{asString(company, "verification_status") === "verified" ? "Verified provider" : "Verification in progress"}</Text>
              </View>
              <StatusPill status={asString(company, "operational_status") ?? "onboarding"} />
            </View>
            {asString(company, "verification_status") !== "verified" ? (
              <View style={[styles.notice, { backgroundColor: palette.warningSoft }]}><ShieldCheck color={palette.warning} size={15} /><Text style={[styles.noticeText, { color: palette.ink }]}>Your company must be verified before its services can receive live customer matches.</Text></View>
            ) : null}
          </Card>

          <View style={styles.stats}>
            <Stat value={String(openOpportunities.length)} label="Open opportunities" icon={<BriefcaseBusiness color={palette.brand} size={17} />} />
            <Stat value={String(activeBookings.length)} label="Active bookings" icon={<Truck color={palette.success} size={17} />} />
          </View>

          <View style={styles.section}>
            <SectionHeader title="Company activity" description="New opportunities and confirmed work for your organisation." action={<Pressable onPress={() => router.push("/(provider)/opportunities" as never)}><Text style={[styles.seeAll, { color: palette.brand }]}>See all</Text></Pressable>} />
            {opportunities.isPending || jobs.isPending ? <ScreenSkeleton cards={2} /> : opportunities.error || jobs.error ? (
              <StatePanel title="Activity could not load" description="Refresh to check the latest company activity." retry={() => void refresh()} />
            ) : openOpportunities.length === 0 && activeBookings.length === 0 ? (
              <Card variant="subtle" padding="lg">
                <View style={styles.empty}>
                  <View style={[styles.emptyIcon, { backgroundColor: palette.brandSoft }]}><BriefcaseBusiness color={palette.brand} size={22} /></View>
                  <Text style={[styles.emptyTitle, { color: palette.ink }]}>Your next job is out there</Text>
                  <Text style={[styles.emptyBody, { color: palette.muted }]}>When a customer posts a request that matches your services and coverage, it will appear in Opportunities.</Text>
                  <AppButton label="Review services & coverage" fullWidth variant="secondary" onPress={() => router.push("/(provider)/services" as never)} />
                </View>
              </Card>
            ) : (
              <View style={styles.activityList}>
                {openOpportunities.slice(0, 3).map((item) => {
                  const snapshot = nested(item, "job_snapshot");
                  return <Pressable key={String(item.id)} onPress={() => router.push("/(provider)/opportunities" as never)} style={[styles.activity, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                    <View style={[styles.activityIcon, { backgroundColor: palette.brandSoft }]}><BriefcaseBusiness color={palette.brand} size={18} /></View>
                    <View style={styles.activityCopy}><Text style={[styles.activityTitle, { color: palette.ink }]} numberOfLines={1}>{asString(snapshot, "title") ?? "New logistics opportunity"}</Text><Text style={[styles.activityMeta, { color: palette.muted }]} numberOfLines={1}>{asString(snapshot, "service_key")?.replace(/[._]/g, " ") ?? "Matched request"}</Text></View>
                    <StatusPill status={asString(item, "status") ?? "matched"} />
                  </Pressable>;
                })}
              </View>
            )}
          </View>
          <View style={styles.quickRow}>
            <AppButton label="Open opportunities" fullWidth onPress={() => router.push("/(provider)/opportunities" as never)} trailingIcon={<ArrowRight color="#FFFFFF" size={15} />} />
            <AppButton label="Company settings" fullWidth variant="secondary" onPress={() => router.push("/(provider)/services" as never)} />
          </View>
        </>
      )}
    </Screen>
  );
}
function nested(record: Record<string, unknown> | null | undefined, key: string) {
  const value = record?.[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function Stat({ value, label, icon }: { value: string; label: string; icon: ReactNode }) {
  const { palette } = useAppTheme();
  return <View style={[styles.stat, { backgroundColor: palette.surface, borderColor: palette.border }]}><View style={[styles.statIcon, { backgroundColor: palette.brandSofter }]}>{icon}</View><Text style={[styles.statValue, { color: palette.ink }]}>{value}</Text><Text style={[styles.statLabel, { color: palette.muted }]}>{label}</Text></View>;
}
const styles = StyleSheet.create({
  brandRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: -7 },
  trustBadge: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 7 },
  trustText: { ...typography.caption, fontSize: 9, fontWeight: "900" },
  avatar: { width: 42, height: 42, borderRadius: 15, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth },
  setupIcon: { width: 54, height: 54, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  setupTitle: { ...typography.heading, fontSize: 19 },
  setupBody: { ...typography.caption, fontSize: 11, lineHeight: 18 },
  companyHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  companyMark: { width: 45, height: 45, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  companyCopy: { flex: 1, gap: 3 },
  companyEyebrow: { ...typography.eyebrow, fontSize: 8 },
  companyName: { ...typography.bodyStrong, fontSize: 14 },
  companySub: { ...typography.caption, fontSize: 9 },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 11, borderRadius: radii.md },
  noticeText: { flex: 1, ...typography.caption, fontSize: 10, lineHeight: 16 },
  stats: { flexDirection: "row", gap: 10 },
  stat: { flex: 1, minWidth: 0, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: 13, gap: 3 },
  statIcon: { width: 32, height: 32, borderRadius: 11, alignItems: "center", justifyContent: "center", marginBottom: 3 },
  statValue: { ...typography.heading, fontSize: 23 },
  statLabel: { ...typography.caption, fontSize: 9 },
  section: { gap: 12 },
  seeAll: { ...typography.caption, fontSize: 10, fontWeight: "900" },
  activityList: { gap: 8 },
  activity: { flexDirection: "row", alignItems: "center", gap: 9, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: 11 },
  activityIcon: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  activityCopy: { flex: 1, gap: 2, minWidth: 0 },
  activityTitle: { ...typography.bodyStrong, fontSize: 11 },
  activityMeta: { ...typography.caption, fontSize: 9, textTransform: "capitalize" },
  empty: { alignItems: "flex-start", gap: 10 },
  emptyIcon: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  emptyTitle: { ...typography.bodyStrong, fontSize: 14 },
  emptyBody: { ...typography.caption, fontSize: 10, lineHeight: 17 },
  quickRow: { gap: 8 },
});
