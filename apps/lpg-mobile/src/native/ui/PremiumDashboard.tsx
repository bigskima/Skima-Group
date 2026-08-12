import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import {
  Bell,
  Building2,
  ChevronRight,
  CircleHelp,
  MapPin,
  Navigation,
  PackageCheck,
  QrCode,
  ScanLine,
  ShieldCheck,
  Truck,
  WalletCards,
} from "lucide-react-native";
import type { ComponentType, ReactNode } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { domainQueries } from "../api/domains";
import {
  displayStatus,
  displaySubtitle,
  displayTitle,
  firstNumber,
  firstString,
  recordId,
  type PlatformRecord,
} from "../api/records";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { colors, radii, spacing } from "../theme/tokens";
import { BrandMark } from "./BrandMark";
import { PromotionBanner } from "./PromotionBanner";
import { ScreenSkeleton } from "./ScreenSkeleton";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

type Workspace = "customer" | "driver" | "station";
type IconType = ComponentType<{ color?: string; size?: number; strokeWidth?: number }>;

const roleTheme = {
  customer: { start: "#F42A3B", end: "#8F0918", tint: "#FFF0F2", label: "CUSTOMER" },
  driver: { start: "#1B5B43", end: "#10261D", tint: "#EAF7F0", label: "DRIVER" },
  station: { start: "#513225", end: "#151C18", tint: "#F8F0E8", label: "STATION" },
} as const;

export function CustomerDashboard() {
  const cylinders = domainQueries.cylinders();
  const active = domainQueries.activeOrders();
  const locations = domainQueries.locations();
  const wallets = domainQueries.wallets();
  const stations = domainQueries.stations();
  const pending = cylinders.isPending || active.isPending || locations.isPending || wallets.isPending || stations.isPending;
  const failed = cylinders.error ?? active.error ?? locations.error ?? wallets.error ?? stations.error;
  const cylinder = cylinders.data?.[0];
  const order = active.data?.[0];
  const location = locations.data?.[0];
  const balance = (wallets.data ?? []).reduce((sum, item) => sum + (firstNumber(item, ["balance", "available_balance", "availableBalance"]) ?? 0), 0);
  const currency = firstString(wallets.data?.[0], ["currency_code", "currencyCode"]) ?? "NGN";

  return (
    <DashboardShell
      workspace="customer"
      headline="Gas refill, without the runaround."
      subline="Pickup, refill and return in one clear journey."
      primary={{
        label: cylinder ? "Start refill" : "Add cylinder",
        icon: cylinder ? PackageCheck : QrCode,
        href: cylinder ? "/(customer)/orders/new" : "/(customer)/cylinder/register",
      }}
      utility={
        <Pressable onPress={() => router.push("/(customer)/locations")} style={styles.glassLine}>
          <MapPin color="white" size={16} />
          <Text numberOfLines={1} style={styles.glassText}>
            {location ? displayTitle(location) : "Set delivery location"}
          </Text>
          <ChevronRight color="rgba(255,255,255,.72)" size={16} />
        </Pressable>
      }
    >
      {pending ? <ScreenSkeleton cards={3} /> : failed ? <LoadError onRetry={() => void Promise.all([cylinders.refetch(), active.refetch(), locations.refetch(), wallets.refetch(), stations.refetch()])} /> : (
        <>
          <ActionRail actions={[
            { label: "Refill", hint: "New order", icon: PackageCheck, href: "/(customer)/orders/new" },
            { label: "My cylinders", hint: `${cylinders.data?.length ?? 0} registered`, icon: QrCode, href: "/(customer)/cylinders" },
            { label: "Track", hint: order ? "Order active" : "No active order", icon: Navigation, href: order ? `/(customer)/orders/${recordId(order)}/tracking` : "/(customer)/orders" },
            { label: "Wallet", hint: formatMoney(balance, currency), icon: WalletCards, href: "/(customer)/wallet" },
          ]} />

          {order ? <LiveOperation record={order} href={`/(customer)/orders/${recordId(order) ?? ""}`} /> : null}
          <PromotionBanner audience="customer" />

          <CompactSection title="Your cylinders" action="See all" href="/(customer)/cylinders">
            <GroupedRecords records={cylinders.data ?? []} empty="Your registered cylinders will live here." detailBase="/(customer)/cylinder" icon={PackageCheck} />
          </CompactSection>

          <CompactSection title="Nearby stations" action="Explore" href="/(customer)/stations">
            <GroupedRecords records={stations.data ?? []} empty="No stations are available around this location yet." detailBase="/(customer)/station" icon={Building2} />
          </CompactSection>

          <FinanceBar label="Available in wallet" value={formatMoney(balance, currency)} href="/(customer)/wallet" />
        </>
      )}
    </DashboardShell>
  );
}

export function DriverDashboard() {
  const jobs = domainQueries.driverJobs();
  const commissions = domainQueries.commissions();
  const vehicles = domainQueries.vehicles();
  const pending = jobs.isPending || commissions.isPending || vehicles.isPending;
  const failed = jobs.error ?? commissions.error ?? vehicles.error;
  const active = jobs.data?.[0];
  const earnings = (commissions.data ?? []).reduce((sum, item) => sum + (firstNumber(item, ["amount", "commission_amount", "net_amount"]) ?? 0), 0);
  const currency = firstString(commissions.data?.[0], ["currency_code", "currencyCode"]) ?? "NGN";

  return (
    <DashboardShell
      workspace="driver"
      headline="Ready when the next route lands."
      subline={active ? humanStatus(displayStatus(active) ?? "active") : "Stay online to receive nearby delivery work."}
      primary={{ label: active ? "Open active job" : "Go online", icon: Truck, href: active ? `/(driver)/job/${recordId(active)}` : "/(driver)/availability" }}
      utility={<HeaderMetric label="AVAILABLE EARNINGS" value={formatMoney(earnings, currency)} />}
    >
      {pending ? <ScreenSkeleton cards={3} /> : failed ? <LoadError onRetry={() => void Promise.all([jobs.refetch(), commissions.refetch(), vehicles.refetch()])} /> : (
        <>
          <StatusRail items={[
            { label: "Jobs", value: String(jobs.data?.length ?? 0) },
            { label: "Vehicles", value: String(vehicles.data?.length ?? 0) },
            { label: "Earnings", value: String(commissions.data?.length ?? 0) },
          ]} />
          <ActionRail actions={[
            { label: "Scan", hint: "Verify cylinder", icon: ScanLine, href: "/(driver)/scan" },
            { label: "Availability", hint: "Location & status", icon: Navigation, href: "/(driver)/availability" },
            { label: "Vehicles", hint: "Delivery fleet", icon: Truck, href: "/(driver)/vehicles" },
            { label: "Earnings", hint: formatMoney(earnings, currency), icon: WalletCards, href: "/(driver)/earnings" },
          ]} />
          {active ? <LiveOperation record={active} href={`/(driver)/job/${recordId(active) ?? ""}`} label="ACTIVE ASSIGNMENT" /> : null}
          <CompactSection title="Delivery queue" action="All jobs" href="/(driver)/jobs">
            <GroupedRecords records={jobs.data ?? []} empty="You are clear. New assignments will appear here." detailBase="/(driver)/job" icon={Navigation} />
          </CompactSection>
          <SupportLine href="/(driver)/support" />
        </>
      )}
    </DashboardShell>
  );
}

export function StationDashboard() {
  const jobs = domainQueries.stationJobs();
  const settlements = domainQueries.settlements();
  const pending = jobs.isPending || settlements.isPending;
  const failed = jobs.error ?? settlements.error;
  const records = jobs.data ?? [];
  const inProgress = records.filter((item) => !["completed", "cancelled"].includes(displayStatus(item) ?? "")).length;
  const settled = (settlements.data ?? []).reduce((sum, item) => sum + (firstNumber(item, ["net_amount", "netAmount", "amount"]) ?? 0), 0);
  const currency = firstString(settlements.data?.[0], ["currency_code", "currencyCode"]) ?? "NGN";

  return (
    <DashboardShell
      workspace="station"
      headline="A cleaner view of today’s floor."
      subline="Receive, inspect, refill and release without losing the queue."
      primary={{ label: "Scan cylinder", icon: ScanLine, href: "/(station)/scan" }}
      utility={<HeaderMetric label="SETTLEMENTS" value={formatMoney(settled, currency)} />}
    >
      {pending ? <ScreenSkeleton cards={3} /> : failed ? <LoadError onRetry={() => void Promise.all([jobs.refetch(), settlements.refetch()])} /> : (
        <>
          <StatusRail items={[
            { label: "Waiting", value: String(records.length) },
            { label: "In progress", value: String(inProgress) },
            { label: "Settled", value: String(settlements.data?.length ?? 0) },
          ]} />
          <ActionRail actions={[
            { label: "Scan", hint: "Receive cylinder", icon: ScanLine, href: "/(station)/scan" },
            { label: "Inventory", hint: "Capacity & stock", icon: PackageCheck, href: "/(station)/inventory" },
            { label: "Jobs", hint: `${records.length} in queue`, icon: QrCode, href: "/(station)/jobs" },
            { label: "Settlements", hint: formatMoney(settled, currency), icon: WalletCards, href: "/(station)/settlements" },
          ]} />
          <CompactSection title="Refill queue" action="Open floor" href="/(station)/jobs">
            <GroupedRecords records={records} empty="The station queue is clear." detailBase="/(station)/job" icon={PackageCheck} />
          </CompactSection>
          <SupportLine href="/(station)/support" />
        </>
      )}
    </DashboardShell>
  );
}

function DashboardShell({ workspace, headline, subline, primary, utility, children }: {
  workspace: Workspace;
  headline: string;
  subline: string;
  primary: { label: string; icon: IconType; href: string };
  utility?: ReactNode;
  children: ReactNode;
}) {
  const session = useSession();
  const { palette } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const theme = roleTheme[workspace];
  const Icon = primary.icon;
  const firstName = session.context?.profile?.display_name?.trim().split(/\s+/)[0];
  return (
    <ScrollView style={{ flex: 1, backgroundColor: palette.canvas }} contentContainerStyle={styles.page}>
      <LinearGradient colors={[theme.start, theme.end]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.command, { paddingTop: Math.max(insets.top, 18) + 8 }]}>
        <View style={styles.commandGlow} />
        <View style={[styles.commandInner, { maxWidth: width >= 1024 ? 1120 : 780 }]}>
          <View style={styles.topbar}>
            <View style={styles.identity}><BrandMark compact inverse /><View><Text style={styles.role}>{theme.label} SPACE</Text><Text numberOfLines={1} style={styles.hello}>Hi{firstName ? `, ${firstName}` : ""}</Text></View></View>
            <Pressable accessibilityLabel="Open notifications" onPress={() => router.push(`/${`(${workspace})`}/notifications` as never)} style={styles.glassButton}><Bell color="white" size={19} /></Pressable>
          </View>
          <View style={styles.commandBody}>
            <View style={styles.commandCopy}><Text style={styles.headline}>{headline}</Text><Text style={styles.subline}>{subline}</Text></View>
            {utility ? <View style={styles.utility}>{utility}</View> : null}
          </View>
          <Pressable onPress={() => router.push(primary.href as never)} style={styles.primaryCommand}>
            <Icon color={theme.end} size={19} />
            <Text style={[styles.primaryCommandText, { color: theme.end }]}>{primary.label}</Text>
            <ChevronRight color={theme.end} size={18} />
          </Pressable>
        </View>
      </LinearGradient>
      <View style={[styles.workspaceDock, { maxWidth: width >= 1024 ? 1120 : 780 }]}><WorkspaceSwitcher current={workspace} /></View>
      <View style={[styles.content, { maxWidth: width >= 1024 ? 1120 : 780 }]}>{children}</View>
    </ScrollView>
  );
}

function ActionRail({ actions }: { actions: readonly { label: string; hint: string; icon: IconType; href: string }[] }) {
  const { palette } = useAppTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actionRail}>
      {actions.map(({ label, hint, icon: Icon, href }, index) => (
        <Pressable key={label} onPress={() => router.push(href as never)} style={[styles.actionTile, { backgroundColor: palette.surface }, index === 0 && styles.actionTilePrimary]}>
          <View style={[styles.actionIcon, { backgroundColor: index === 0 ? "rgba(255,255,255,.18)" : palette.brandSoft }]}><Icon color={index === 0 ? "white" : colors.brand} size={21} /></View>
          <Text style={[styles.actionLabel, { color: index === 0 ? "white" : palette.ink }]}>{label}</Text>
          <Text numberOfLines={1} style={[styles.actionHint, { color: index === 0 ? "rgba(255,255,255,.72)" : palette.muted }]}>{hint}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function StatusRail({ items }: { items: readonly { label: string; value: string }[] }) {
  const { palette } = useAppTheme();
  return <View style={[styles.statusRail, { backgroundColor: palette.surface }]}>{items.map((item, index) => <View key={item.label} style={[styles.statusItem, index > 0 && { borderLeftColor: palette.border, borderLeftWidth: 1 }]}><Text style={[styles.statusValue, { color: palette.ink }]}>{item.value}</Text><Text style={[styles.statusLabel, { color: palette.muted }]}>{item.label}</Text></View>)}</View>;
}

function CompactSection({ title, action, href, children }: { title: string; action: string; href: string; children: ReactNode }) {
  const { palette } = useAppTheme();
  return <View style={styles.section}><View style={styles.sectionHead}><Text style={[styles.sectionTitle, { color: palette.ink }]}>{title}</Text><Pressable onPress={() => router.push(href as never)} style={styles.sectionAction}><Text style={styles.sectionActionText}>{action}</Text><ChevronRight color={colors.brand} size={15} /></Pressable></View>{children}</View>;
}

function GroupedRecords({ records, empty, detailBase, icon: Icon }: { records: PlatformRecord[]; empty: string; detailBase: string; icon: IconType }) {
  const { palette } = useAppTheme();
  if (!records.length) return <View style={[styles.group, styles.emptyGroup, { backgroundColor: palette.surface }]}><Icon color={colors.brand} size={24} /><Text style={[styles.emptyText, { color: palette.muted }]}>{empty}</Text></View>;
  return <View style={[styles.group, { backgroundColor: palette.surface }]}>{records.slice(0, 4).map((record, index) => { const id = recordId(record) ?? String(index); return <Pressable key={id} onPress={() => router.push(`${detailBase}/${id}` as never)} style={[styles.recordRow, index > 0 && { borderTopColor: palette.border, borderTopWidth: StyleSheet.hairlineWidth }]}><View style={[styles.recordIcon, { backgroundColor: palette.soft }]}><Icon color={colors.brand} size={19} /></View><View style={styles.recordCopy}><Text numberOfLines={1} style={[styles.recordTitle, { color: palette.ink }]}>{displayTitle(record)}</Text><Text numberOfLines={1} style={[styles.recordMeta, { color: palette.muted }]}>{humanStatus(displayStatus(record) ?? displaySubtitle(record) ?? "available")}</Text></View><ChevronRight color={palette.muted} size={18} /></Pressable>; })}</View>;
}

function LiveOperation({ record, href, label = "LIVE ORDER" }: { record: PlatformRecord; href: string; label?: string }) {
  const { palette } = useAppTheme();
  return <Pressable onPress={() => router.push(href as never)} style={[styles.live, { backgroundColor: palette.successSoft }]}><View style={styles.pulse}><View style={styles.pulseCore} /></View><View style={styles.recordCopy}><Text style={styles.liveLabel}>{label}</Text><Text numberOfLines={1} style={[styles.recordTitle, { color: palette.ink }]}>{displayTitle(record)}</Text><Text numberOfLines={1} style={[styles.recordMeta, { color: palette.muted }]}>{humanStatus(displayStatus(record) ?? "in progress")}</Text></View><View style={styles.liveOpen}><Navigation color={colors.success} size={18} /></View></Pressable>;
}

function HeaderMetric({ label, value }: { label: string; value: string }) {
  return <View><Text style={styles.headerMetricLabel}>{label}</Text><Text numberOfLines={1} adjustsFontSizeToFit style={styles.headerMetricValue}>{value}</Text></View>;
}

function FinanceBar({ label, value, href }: { label: string; value: string; href: string }) {
  const { palette } = useAppTheme();
  return <Pressable onPress={() => router.push(href as never)} style={[styles.finance, { borderColor: palette.border }]}><View><Text style={[styles.financeLabel, { color: palette.muted }]}>{label}</Text><Text style={[styles.financeValue, { color: palette.ink }]}>{value}</Text></View><View style={[styles.financeIcon, { backgroundColor: palette.brandSoft }]}><WalletCards color={colors.brand} size={20} /></View></Pressable>;
}

function SupportLine({ href }: { href: string }) {
  const { palette } = useAppTheme();
  return <Pressable onPress={() => router.push(href as never)} style={styles.support}><CircleHelp color={palette.muted} size={19} /><Text style={[styles.supportText, { color: palette.muted }]}>Need operational help?</Text><Text style={styles.supportLink}>Open support</Text></Pressable>;
}

function LoadError({ onRetry }: { onRetry(): void }) {
  const { palette } = useAppTheme();
  return <View style={[styles.error, { backgroundColor: palette.surface }]}><CircleHelp color={colors.brand} size={26} /><View style={styles.recordCopy}><Text style={[styles.recordTitle, { color: palette.ink }]}>This view needs a refresh</Text><Text style={[styles.recordMeta, { color: palette.muted }]}>Your saved information is safe.</Text></View><Pressable onPress={onRetry}><Text style={styles.supportLink}>Try again</Text></Pressable></View>;
}

function formatMoney(value: number, currency: string) {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(value); }
  catch { return `${currency} ${value.toFixed(0)}`; }
}

function humanStatus(value: string) {
  const key = value.toLowerCase().replace(/[\s-]+/g, "_");
  const labels: Record<string, string> = {
    active: "Ready", available: "Ready", pending: "In progress", awaiting_payment: "Awaiting payment",
    payment_reserved: "Payment confirmed", matching_station: "Finding station", matching_driver: "Finding driver",
    driver_offered: "Driver notified", driver_accepted: "Driver assigned", pickup_en_route: "Heading to pickup",
    pickup_verified: "Cylinder collected", station_en_route: "Heading to station", station_verified: "At station",
    refill_in_progress: "Refill underway", refill_confirmed: "Refill complete", return_en_route: "Returning to customer",
    delivery_verification_pending: "Ready for handover", delivered: "Delivered", completed: "Completed", cancelled: "Cancelled",
  };
  return labels[key] ?? key.replace(/_/g, " ").replace(/^./, (char) => char.toUpperCase());
}

const styles = StyleSheet.create({
  page: { paddingBottom: 112 },
  command: { minHeight: 292, overflow: "hidden", paddingHorizontal: 18, paddingBottom: 34 },
  commandGlow: { position: "absolute", width: 280, height: 280, borderRadius: 140, right: -110, top: -100, backgroundColor: "rgba(255,255,255,.10)" },
  commandInner: { width: "100%", alignSelf: "center", gap: 17 },
  topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  identity: { flexDirection: "row", alignItems: "center", gap: 11 },
  role: { color: "rgba(255,255,255,.64)", fontSize: 9, fontWeight: "900", letterSpacing: 1.4 },
  hello: { maxWidth: 190, color: "white", fontSize: 17, fontWeight: "900", marginTop: 2 },
  glassButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 20, backgroundColor: "rgba(255,255,255,.14)" },
  commandBody: { minHeight: 80, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: spacing.md },
  commandCopy: { flex: 1, maxWidth: 520, gap: 5 },
  headline: { color: "white", fontSize: 26, lineHeight: 30, fontWeight: "900", letterSpacing: -.65 },
  subline: { color: "rgba(255,255,255,.72)", fontSize: 13, lineHeight: 18, maxWidth: 470 },
  utility: { maxWidth: "44%" },
  glassLine: { maxWidth: 280, minHeight: 42, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, borderRadius: 13, backgroundColor: "rgba(255,255,255,.12)" },
  glassText: { flex: 1, color: "white", fontSize: 12, fontWeight: "800" },
  primaryCommand: { alignSelf: "flex-start", minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, borderRadius: 14, backgroundColor: "white" },
  primaryCommandText: { fontSize: 14, fontWeight: "900" },
  headerMetricLabel: { color: "rgba(255,255,255,.55)", fontSize: 9, fontWeight: "900", textAlign: "right", letterSpacing: 1 },
  headerMetricValue: { maxWidth: 190, color: "white", fontSize: 24, fontWeight: "900", textAlign: "right", marginTop: 3 },
  workspaceDock: { width: "100%", alignSelf: "center", marginTop: -20, paddingHorizontal: 18, zIndex: 2 },
  content: { width: "100%", alignSelf: "center", gap: 22, paddingHorizontal: 18, paddingTop: 18 },
  actionRail: { gap: 10, paddingRight: 18 },
  actionTile: { width: 142, minHeight: 116, justifyContent: "space-between", padding: 14, borderRadius: 20 },
  actionTilePrimary: { backgroundColor: colors.brand },
  actionIcon: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 12 },
  actionLabel: { fontSize: 14, fontWeight: "900" },
  actionHint: { fontSize: 11, fontWeight: "600" },
  statusRail: { minHeight: 76, flexDirection: "row", alignItems: "center", borderRadius: 20, paddingVertical: 8 },
  statusItem: { flex: 1, alignItems: "center", gap: 3, paddingHorizontal: 8 },
  statusValue: { fontSize: 20, fontWeight: "900" },
  statusLabel: { fontSize: 10, fontWeight: "700", textAlign: "center" },
  section: { gap: 11 },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { fontSize: 19, fontWeight: "900", letterSpacing: -.3 },
  sectionAction: { flexDirection: "row", alignItems: "center", gap: 2 },
  sectionActionText: { color: colors.brand, fontSize: 12, fontWeight: "900" },
  group: { overflow: "hidden", borderRadius: 20 },
  emptyGroup: { minHeight: 90, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18 },
  emptyText: { flex: 1, fontSize: 13, lineHeight: 18 },
  recordRow: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14 },
  recordIcon: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 13 },
  recordCopy: { flex: 1, gap: 3 },
  recordTitle: { fontSize: 14, fontWeight: "900" },
  recordMeta: { fontSize: 12, lineHeight: 16 },
  live: { minHeight: 88, flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 20 },
  pulse: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 17, backgroundColor: "rgba(18,148,71,.13)" },
  pulseCore: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.success },
  liveLabel: { color: colors.success, fontSize: 9, fontWeight: "900", letterSpacing: 1 },
  liveOpen: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: "rgba(18,148,71,.12)" },
  finance: { minHeight: 72, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 12 },
  financeLabel: { fontSize: 11, fontWeight: "700" },
  financeValue: { fontSize: 21, fontWeight: "900", marginTop: 2 },
  financeIcon: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 14 },
  support: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8 },
  supportText: { flex: 1, fontSize: 12 },
  supportLink: { color: colors.brand, fontSize: 12, fontWeight: "900" },
  error: { minHeight: 88, flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 20 },
});
