import { router } from "expo-router";
import { ArrowRight, BriefcaseBusiness, Building2, CheckCircle2, Clock3, MapPin, Package, Plus, ShieldCheck, Truck } from "lucide-react-native";
import { useMemo } from "react";
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

export function ProviderHomeScreen() {
  const { palette } = useAppTheme();
  const companies = useLogisticsQuery(["provider-company"], "/runtime/logistics/company", true, 30_000);
  const services = useLogisticsQuery(["provider-services"], "/runtime/logistics/company/services");
  const opportunities = useLogisticsQuery(["provider-opportunities"], "/runtime/logistics/opportunities", true, 25_000);
  const bookings = useLogisticsQuery(["provider-bookings"], "/runtime/logistics/bookings", true, 30_000);
  const company = companies.data?.[0] ?? null;
  const organizationId = asString(company, "organization_id");
  const companyServices = useMemo(
    () => (services.data ?? []).filter((item) => asString(item, "organization_id") === organizationId),
    [services.data, organizationId],
  );
  const companyOpportunities = useMemo(
    () => (opportunities.data ?? []).filter((item) => asString(item, "organization_id") === organizationId),
    [opportunities.data, organizationId],
  );
  const openOpportunities = companyOpportunities.filter((item) => ["matched", "viewed", "offered"].includes(asString(item, "status") ?? ""));
  const companyBookings = (bookings.data ?? []).filter((item) => asString(item, "provider_organization_id") === organizationId);
  const verified = asString(company, "verification_status") === "verified" && asString(company, "operational_status") === "active";
  const refresh = () => Promise.all([companies.refetch(), services.refetch(), opportunities.refetch(), bookings.refetch()]);
  const pending = companies.isPending || services.isPending || opportunities.isPending;

  return (
    <Screen eyebrow="COMPANY WORKSPACE" title={company ? asString(company, "public_name") ?? "Your company" : "Your company workspace"}
      subtitle={company ? "Manage your services and respond to opportunities matched to your company." : "Register your logistics company to create a dedicated business workspace."}
      action={company ? <StatusPill status={asString(company, "operational_status") ?? "onboarding"} /> : undefined}
      refreshControl={<RefreshControl refreshing={companies.isRefetching || services.isRefetching || opportunities.isRefetching || bookings.isRefetching} onRefresh={() => void refresh()} tintColor={palette.brand} />}>
      {companies.isPending ? <ScreenSkeleton cards={3} /> : companies.error ? (
        <StatePanel title="Company workspace unavailable" description="We couldn't load your company profile. Check your connection and try again." retry={() => void refresh()} />
      ) : !company ? (
        <Card padding="lg">
          <View style={styles.registerEmpty}>
            <View style={[styles.heroIcon, { backgroundColor: palette.brandSoft }]}><Building2 color={palette.brand} size={25} /></View>
            <Text style={[styles.emptyTitle, { color: palette.ink }]}>Build your company presence</Text>
            <Text style={[styles.description, { color: palette.muted }]}>Create an independent company workspace, list your logistics services and define where you operate.</Text>
            <AppButton label="Register your company" fullWidth onPress={() => router.push("/provider/register" as never)} />
          </View>
        </Card>
      ) : (
        <View style={styles.content}>
          <Card variant={verified ? "success" : "warning"} padding="lg">
            <View style={styles.statusHeader}>
              <View style={[styles.statusIcon, { backgroundColor: palette.surface }]}>{verified ? <CheckCircle2 color={palette.success} size={21} /> : <Clock3 color={palette.warning} size={21} />}</View>
              <View style={styles.statusCopy}>
                <Text style={[styles.statusTitle, { color: palette.ink }]}>{verified ? "Your company is active" : "Verification in progress"}</Text>
                <Text style={[styles.description, { color: palette.muted }]}>{verified
                  ? "Your company can receive and quote on customer opportunities that match its coverage."
                  : "You can prepare services and coverage while SKIMA reviews your company. Matching starts after verification and activation."}</Text>
              </View>
            </View>
            <View style={styles.pills}><StatusPill status={asString(company, "verification_status") ?? "pending"} /><StatusPill status={asString(company, "operational_status") ?? "onboarding"} /></View>
          </Card>

          <View style={styles.stats}>
            <Metric value={String(openOpportunities.length)} label="Open opportunities" />
            <Metric value={String(companyServices.length)} label="Listed services" />
            <Metric value={String(companyBookings.length)} label="Bookings" />
          </View>

          <View style={styles.quickActions}>
            <QuickAction icon={<Plus color={palette.brand} size={19} />} title="Add a service" description="Configure a logistics service" onPress={() => router.push("/provider/services" as never)} />
            <QuickAction icon={<MapPin color={palette.brand} size={19} />} title="Set coverage" description="Choose your service areas" onPress={() => router.push("/provider/services" as never)} />
          </View>

          <View style={styles.section}>
            <SectionHeader title="Matched opportunities" description="Customer requests that meet your company’s eligibility." action={
              <Pressable onPress={() => router.push("/provider/opportunities" as never)}><Text style={[styles.link, { color: palette.brand }]}>See all</Text></Pressable>
            } />
            {pending ? <ScreenSkeleton cards={2} /> : !verified ? (
              <StatePanel title="Verification required" description="Your opportunity inbox will open automatically when SKIMA verifies and activates your company." icon={<ShieldCheck color={palette.brand} size={24} />} />
            ) : openOpportunities.length === 0 ? (
              <Card variant="subtle" padding="lg"><View style={styles.noOpp}><BriefcaseBusiness color={palette.muted} size={25} /><Text style={[styles.emptyTitle, { color: palette.ink }]}>No matched opportunities yet</Text><Text style={[styles.description, { color: palette.muted }]}>Keep your service areas and availability up to date. New requests that match your coverage will appear here.</Text></View></Card>
            ) : (
              <View style={styles.previewList}>
                {openOpportunities.slice(0, 3).map((opportunity) => {
                  const snapshot = opportunity.job_snapshot && typeof opportunity.job_snapshot === "object" ? opportunity.job_snapshot as Record<string, unknown> : {};
                  return <Pressable key={String(opportunity.id)} onPress={() => router.push({ pathname: "/provider/jobs/[id]", params: { id: String(opportunity.id) } } as never)}
                    style={[styles.preview, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                    <View style={[styles.previewIcon, { backgroundColor: palette.brandSoft }]}><Package color={palette.brand} size={18} /></View>
                    <View style={styles.previewCopy}>
                      <Text style={[styles.previewTitle, { color: palette.ink }]} numberOfLines={1}>{asString(snapshot, "title") ?? "Logistics opportunity"}</Text>
                      <Text style={[styles.previewMeta, { color: palette.muted }]}>{asString(snapshot, "category_key")?.replace(/[._]/g, " ") ?? "New customer request"}</Text>
                    </View>
                    <ArrowRight color={palette.muted} size={17} />
                  </Pressable>;
                })}
              </View>
            )}
          </View>

          <Card padding="lg">
            <View style={styles.trustLine}><Truck color={palette.brand} size={19} /><Text style={[styles.trustTitle, { color: palette.ink }]}>Your company, your operations</Text></View>
            <Text style={[styles.description, { color: palette.muted }]}>Customer contacts are shared only with matched companies. Viewing an opportunity is free. Each quote and booking is tied to your organisation.</Text>
          </Card>
        </View>
      )}
    </Screen>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  const { palette } = useAppTheme();
  return <View style={[styles.metric, { backgroundColor: palette.surface, borderColor: palette.border }]}><Text style={[styles.metricValue, { color: palette.ink }]}>{value}</Text><Text style={[styles.metricLabel, { color: palette.muted }]}>{label}</Text></View>;
}
function QuickAction({ icon, title, description, onPress }: { icon: React.ReactNode; title: string; description: string; onPress(): void }) {
  const { palette } = useAppTheme();
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.quick, { backgroundColor: palette.surface, borderColor: palette.border, opacity: pressed ? 0.8 : 1 }]}><View style={[styles.quickIcon, { backgroundColor: palette.brandSoft }]}>{icon}</View><View style={{ flex: 1, gap: 3 }}><Text style={[styles.quickTitle, { color: palette.ink }]}>{title}</Text><Text style={[styles.quickDescription, { color: palette.muted }]}>{description}</Text></View><ArrowRight color={palette.muted} size={16} /></Pressable>;
}
const styles = StyleSheet.create({
  content: { gap: spacing.lg },
  registerEmpty: { alignItems: "flex-start", gap: 12 },
  heroIcon: { width: 56, height: 56, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  emptyTitle: { ...typography.bodyStrong, fontSize: 15 },
  description: { ...typography.caption, fontSize: 10, lineHeight: 17 },
  statusHeader: { flexDirection: "row", alignItems: "flex-start", gap: 11 },
  statusIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  statusCopy: { flex: 1, gap: 4 },
  statusTitle: { ...typography.bodyStrong, fontSize: 14 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  stats: { flexDirection: "row", gap: 8 },
  metric: { flex: 1, minWidth: 0, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: 12, gap: 3 },
  metricValue: { ...typography.heading, fontSize: 21 },
  metricLabel: { ...typography.caption, fontSize: 9, lineHeight: 13 },
  quickActions: { gap: 8 },
  quick: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 66, padding: 11, borderRadius: radii.lg, borderWidth: StyleSheet.hairlineWidth },
  quickIcon: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  quickTitle: { ...typography.bodyStrong, fontSize: 12 },
  quickDescription: { ...typography.caption, fontSize: 9 },
  section: { gap: 12 },
  link: { ...typography.caption, fontSize: 11, fontWeight: "900" },
  noOpp: { alignItems: "flex-start", gap: 9 },
  previewList: { gap: 8 },
  preview: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: 12 },
  previewIcon: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  previewCopy: { flex: 1, gap: 2 },
  previewTitle: { ...typography.bodyStrong, fontSize: 12 },
  previewMeta: { ...typography.caption, fontSize: 9, textTransform: "capitalize" },
  trustLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  trustTitle: { ...typography.bodyStrong, fontSize: 13 },
});
