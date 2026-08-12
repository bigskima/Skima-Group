import { router } from "expo-router";
import {
  Bell,
  ChevronRight,
  CircleHelp,
  PackageCheck,
  MapPin,
  QrCode,
  ShieldCheck,
  WalletCards,
} from "lucide-react-native";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
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
import { colors, radii, spacing } from "../theme/tokens";
import { Screen } from "./Screen";
import { ScreenSkeleton } from "./ScreenSkeleton";
import { useAppTheme } from "../theme/ThemeProvider";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { BrandMark } from "./BrandMark";
import { PromotionBanner } from "./PromotionBanner";

export function CustomerDashboard() {
  const { palette } = useAppTheme();
  const cylinders = domainQueries.cylinders();
  const active = domainQueries.activeOrders();
  const locations = domainQueries.locations();
  const wallets = domainQueries.wallets();
  const stations = domainQueries.stations();
  if (
    cylinders.isPending ||
    active.isPending ||
    locations.isPending ||
    wallets.isPending ||
    stations.isPending
  )
    return (
      <DashboardFrame workspace="LPG" title="Getting things ready">
        <ScreenSkeleton cards={4} />
      </DashboardFrame>
    );
  const customerError =
    cylinders.error ??
    active.error ??
    locations.error ??
    wallets.error ??
    stations.error;
  if (customerError)
    return (
      <DashboardFrame workspace="LPG" title="Your home needs a refresh">
        <DashboardError
          message={customerError.message}
          onRetry={() =>
            void Promise.all([
              cylinders.refetch(),
              active.refetch(),
              locations.refetch(),
              wallets.refetch(),
              stations.refetch(),
            ])
          }
        />
      </DashboardFrame>
    );
  const firstCylinder = cylinders.data?.[0];
  const firstOrder = active.data?.[0];
  const location = locations.data?.[0];
  const walletBalance = (wallets.data ?? []).reduce(
    (total, wallet) => total + (firstNumber(wallet, ["balance"]) ?? 0),
    0,
  );
  const walletCurrency =
    firstString(wallets.data?.[0], ["currency_code", "currencyCode"]) ?? "NGN";
  return (
    <DashboardFrame workspace="LPG" title="What do you need today?">
      <LocationBar
        value={location ? displayTitle(location) : "Select a delivery location"}
        onPress={() => router.push("/(customer)/locations")}
      />
      <Hero
        title={
          firstCylinder
            ? displayTitle(firstCylinder)
            : "Register your first cylinder"
        }
        eyebrow="Refill a cylinder"
        body={
          firstCylinder
            ? humanStatus(displayStatus(firstCylinder) ?? "available")
            : "Add a name, size and clear photo. We’ll create its SKIMA identity."
        }
        action={firstCylinder ? "Refill now" : "Register cylinder"}
        onPress={() =>
          router.push(
            firstCylinder
              ? "/(customer)/orders/new"
              : "/(customer)/cylinder/register",
          )
        }
      />
      {firstOrder ? (
        <ActiveCard
          record={firstOrder}
          href={`/(customer)/orders/${recordId(firstOrder) ?? ""}`}
        />
      ) : null}
      <PromotionBanner audience="customer" />
      <QuickActions
        actions={[
          { label: "Refill", icon: QrCode, href: "/(customer)/orders/new" },
          {
            label: "Register",
            icon: ShieldCheck,
            href: "/(customer)/cylinder/register",
          },
          { label: "Wallet", icon: WalletCards, href: "/(customer)/wallet" },
          { label: "Support", icon: CircleHelp, href: "/(customer)/account" },
        ]}
      />
      <Section title="My cylinders" href="/(customer)/cylinders">
        <RecordGrid
          records={cylinders.data ?? []}
          empty="No cylinders registered yet."
          detailBase="/(customer)/cylinder"
        />
      </Section>
      <Section title="Stations near you" href="/(customer)/stations">
        <RecordGrid
          records={stations.data ?? []}
          empty="No approved stations are currently available."
          detailBase="/(customer)/station"
        />
      </Section>
      <View style={[styles.customerSummary, { borderColor: palette.border }]}><View><Text style={[styles.summaryLabel, { color: palette.muted }]}>SKIMA wallet</Text><Text style={[styles.summaryValue, { color: palette.ink }]}>{formatMoney(walletBalance, walletCurrency)}</Text></View><Pressable onPress={() => router.push("/(customer)/wallet")} style={styles.summaryAction}><Text style={styles.summaryActionText}>View wallet</Text><ChevronRight color={colors.brand} size={17} /></Pressable></View>
    </DashboardFrame>
  );
}

export function DriverDashboard() {
  const jobs = domainQueries.driverJobs();
  const commissions = domainQueries.commissions();
  const vehicles = domainQueries.vehicles();
  if (jobs.isPending || commissions.isPending || vehicles.isPending)
    return (
      <DashboardFrame workspace="Driver" title="Checking today’s route">
        <ScreenSkeleton cards={3} />
      </DashboardFrame>
    );
  const driverError = jobs.error ?? commissions.error ?? vehicles.error;
  if (driverError)
    return (
      <DashboardFrame workspace="Driver" title="Your jobs need a refresh">
        <DashboardError
          message={driverError.message}
          onRetry={() =>
            void Promise.all([
              jobs.refetch(),
              commissions.refetch(),
              vehicles.refetch(),
            ])
          }
        />
      </DashboardFrame>
    );
  const active = jobs.data?.[0];
  const earningsTotal = (commissions.data ?? []).reduce(
    (total, entry) =>
      total +
      (firstNumber(entry, ["amount", "commission_amount", "net_amount"]) ?? 0),
    0,
  );
  const earningsCurrency =
    firstString(commissions.data?.[0], ["currency_code", "currencyCode"]) ??
    "NGN";
  return (
    <DashboardFrame workspace="Driver" title="Ready for the road?">
      <MetricHero
        label="Available earnings"
        value={formatMoney(earningsTotal, earningsCurrency)}
        secondary={`${jobs.data?.length ?? 0} available jobs`}
      />
      <StatusBanner
        title={
          active
            ? "You have an active assignment"
            : "You are available for jobs"
        }
        body={
          active
            ? displayTitle(active)
            : "New jobs will appear here when they match your vehicle and service area."
        }
      />
      <Pressable
        onPress={() => router.push("/(driver)/availability")}
        style={styles.outlineButton}
      >
        <Text style={styles.outlineText}>Update availability and location</Text>
        <ChevronRight color={colors.brand} size={18} />
      </Pressable>
      <QuickActions
        actions={[
          { label: "Scan", icon: QrCode, href: "/(driver)/scan" },
          { label: "Vehicles", icon: ShieldCheck, href: "/(driver)/vehicles" },
          { label: "Earnings", icon: WalletCards, href: "/(driver)/earnings" },
          { label: "Support", icon: CircleHelp, href: "/(driver)/support" },
        ]}
      />
      <Section title="Available jobs" href="/(driver)/jobs">
        <RecordGrid
          records={jobs.data ?? []}
          empty="No assignments are available right now."
          detailBase="/(driver)/job"
        />
      </Section>
      <MetricStrip
        metrics={[
          { label: "Jobs", value: String(jobs.data?.length ?? 0) },
          { label: "Vehicles", value: String(vehicles.data?.length ?? 0) },
          {
            label: "Earning entries",
            value: String(commissions.data?.length ?? 0),
          },
        ]}
      />
    </DashboardFrame>
  );
}

export function StationDashboard() {
  const jobs = domainQueries.stationJobs();
  const settlements = domainQueries.settlements();
  if (jobs.isPending || settlements.isPending)
    return (
      <DashboardFrame workspace="Station" title="Preparing today’s station view">
        <ScreenSkeleton cards={3} />
      </DashboardFrame>
    );
  const stationError = jobs.error ?? settlements.error;
  if (stationError)
    return (
      <DashboardFrame
        workspace="Station"
        title="Your station view needs a refresh"
      >
        <DashboardError
          message={stationError.message}
          onRetry={() =>
            void Promise.all([jobs.refetch(), settlements.refetch()])
          }
        />
      </DashboardFrame>
    );
  const active = jobs.data ?? [];
  const settlementTotal = (settlements.data ?? []).reduce(
    (total, entry) =>
      total + (firstNumber(entry, ["net_amount", "netAmount", "amount"]) ?? 0),
    0,
  );
  const settlementCurrency =
    firstString(settlements.data?.[0], ["currency_code", "currencyCode"]) ??
    "NGN";
  return (
    <DashboardFrame workspace="Station" title="Keep today’s refills moving">
      <MetricStrip
        metrics={[
          { label: "Incoming jobs", value: String(active.length) },
          {
            label: "Settlements",
            value: formatMoney(settlementTotal, settlementCurrency),
          },
          {
            label: "In progress",
            value: String(
              active.filter(
                (item) =>
                  !["completed", "cancelled"].includes(
                    displayStatus(item) ?? "",
                  ),
              ).length,
            ),
          },
        ]}
      />
      <StatusBanner
        title="Station ready"
        body="Review incoming cylinders, record each refill and confirm every hand-off."
      />
      <QuickActions
        actions={[
          { label: "Scan", icon: QrCode, href: "/(station)/scan" },
          {
            label: "Inventory",
            icon: ShieldCheck,
            href: "/(station)/inventory",
          },
          {
            label: "Settlements",
            icon: WalletCards,
            href: "/(station)/settlements",
          },
          { label: "Support", icon: CircleHelp, href: "/(station)/support" },
        ]}
      />
      <Section title="Incoming refill jobs" href="/(station)/jobs">
        <RecordGrid
          records={active}
          empty="No station jobs are waiting."
          detailBase="/(station)/job"
        />
      </Section>
    </DashboardFrame>
  );
}

function DashboardFrame({
  workspace,
  title,
  children,
}: {
  workspace: string;
  title: string;
  children: React.ReactNode;
}) {
  const session = useSession();
  const { scheme, palette } = useAppTheme();
  const dark = scheme === "dark";
  return (
    <Screen
      eyebrow={title}
      title={`Hello${session.context?.profile?.display_name ? `, ${session.context.profile.display_name}` : ""}`}
      action={<View style={styles.headerActions}><BrandMark compact /><Pressable accessibilityRole="button" accessibilityLabel="Open notifications" onPress={() => router.push(`/${workspace === "LPG" ? "(customer)" : workspace === "Driver" ? "(driver)" : "(station)"}/notifications` as never)} style={[styles.bell, { backgroundColor: palette.surface }]}><Bell color={palette.ink} size={20} /></Pressable></View>}
    >
      <WorkspaceSwitcher current={workspace === "LPG" ? "customer" : workspace === "Driver" ? "driver" : "station"} />
      {children}
    </Screen>
  );
}
function DashboardError({
  message: _message,
  onRetry,
}: {
  message: string;
  onRetry(): void;
}) {
  return (
    <View accessibilityRole="alert" style={styles.dashboardError}>
      <CircleHelp color={colors.brand} size={28} />
      <Text style={styles.statusTitle}>We couldn’t refresh this page</Text>
      <Text style={styles.cardBody}>Check your connection and try again. Your saved information is still safe.</Text>
      <Pressable onPress={onRetry} style={styles.heroButton}>
        <Text style={styles.heroButtonText}>Try again</Text>
      </Pressable>
    </View>
  );
}
function LocationBar({ value, onPress }: { value: string; onPress(): void }) {
  const dark = useAppTheme().scheme === "dark";
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.location, dark && styles.darkCard]}
    >
      <MapPin color={colors.brand} size={22} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.micro, dark && styles.darkMuted]}>
          Delivering to
        </Text>
        <Text
          numberOfLines={1}
          style={[styles.locationText, dark && styles.darkText]}
        >
          {value}
        </Text>
      </View>
      <ChevronRight color={dark ? colors.darkInk : colors.ink} size={20} />
    </Pressable>
  );
}
function formatMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}
function humanStatus(value: string) {
  const normalized = value.toLowerCase().replace(/[\s-]+/g, "_");
  const labels: Record<string, string> = {
    active: "Ready to refill",
    available: "Ready to use",
    awaiting_payment: "Waiting for payment",
    payment_reserved: "Payment confirmed",
    matching_station: "Finding a refill station",
    matching_driver: "Finding your driver",
    driver_offered: "Driver notified",
    driver_accepted: "Driver assigned",
    pickup_en_route: "Driver heading to pickup",
    pickup_verified: "Cylinder collected",
    station_en_route: "Heading to the station",
    station_verified: "Received by the station",
    refill_in_progress: "Refill in progress",
    refill_confirmed: "Refill complete",
    return_en_route: "On the way back to you",
    delivery_verification_pending: "Ready for hand-over",
    delivered: "Delivered",
    completed: "Completed",
    cancelled: "Cancelled",
    pending: "In progress",
  };
  return labels[normalized] ?? normalized.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}
function Hero({
  eyebrow,
  title,
  body,
  action,
  onPress,
}: {
  eyebrow: string;
  title: string;
  body: string;
  action: string;
  onPress(): void;
}) {
  const dark = useAppTheme().scheme === "dark";
  return (
    <View style={[styles.hero, dark && styles.heroDark]}>
      <View style={[styles.heroOrb, dark && styles.heroOrbDark]} />
      <View style={styles.heroArtwork}><PackageCheck color={colors.brand} size={62} strokeWidth={1.7} /></View>
      <Text style={styles.heroEyebrow}>{eyebrow}</Text>
      <Text style={[styles.heroTitle, dark && styles.darkText]}>{title}</Text>
      <Text style={[styles.heroBody, dark && styles.darkMuted]}>{body}</Text>
      <Pressable onPress={onPress} style={styles.heroButton}>
        <Text style={styles.heroButtonText}>{action}</Text>
        <ChevronRight color="white" size={18} />
      </Pressable>
    </View>
  );
}
function ActiveCard({
  record,
  href,
}: {
  record: PlatformRecord;
  href: string;
}) {
  const dark = useAppTheme().scheme === "dark";
  return (
    <Pressable
      onPress={() => router.push(href as never)}
      style={[styles.active, dark && styles.activeDark]}
    >
      <View>
        <Text style={styles.successLabel}>Active order</Text>
        <Text style={[styles.cardTitle, dark && styles.darkText]}>
          {displayTitle(record)}
        </Text>
        <Text style={[styles.cardBody, dark && styles.darkMuted]}>
          {displaySubtitle(record) ??
            humanStatus(displayStatus(record) ?? "In progress")}
        </Text>
      </View>
      <View style={styles.liveButton}>
        <Text style={styles.liveText}>Continue</Text>
        <ChevronRight color={colors.success} size={18} />
      </View>
    </Pressable>
  );
}
function MetricHero({
  label,
  value,
  secondary,
}: {
  label: string;
  value: string;
  secondary: string;
}) {
  return (
    <View style={styles.metricHero}>
      <Text style={styles.metricHeroLabel}>{label}</Text>
      <Text style={styles.metricHeroValue}>{value}</Text>
      <Text style={styles.metricHeroSecondary}>{secondary}</Text>
    </View>
  );
}
function StatusBanner({ title, body }: { title: string; body: string }) {
  const dark = useAppTheme().scheme === "dark";
  return (
    <View style={[styles.statusBanner, dark && styles.darkCard]}>
      <ShieldCheck color={colors.success} size={28} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={[styles.statusTitle, dark && styles.darkText]}>
          {title}
        </Text>
        <Text style={[styles.cardBody, dark && styles.darkMuted]}>{body}</Text>
      </View>
    </View>
  );
}
function QuickActions({
  actions,
}: {
  actions: readonly { label: string; href: string; icon: typeof QrCode }[];
}) {
  const dark = useAppTheme().scheme === "dark";
  return (
    <View style={[styles.quick, dark && styles.darkCard]}>
      {actions.map(({ label, href, icon: Icon }) => (
        <Pressable
          key={label}
          onPress={() => router.push(href as never)}
          style={styles.quickItem}
        >
          <View style={styles.quickIcon}>
            <Icon color={colors.brand} size={22} />
          </View>
          <Text style={[styles.quickText, dark && styles.darkText]}>
            {label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
function Section({
  title,
  href,
  children,
}: {
  title: string;
  href: string;
  children: React.ReactNode;
}) {
  const dark = useAppTheme().scheme === "dark";
  return (
    <View style={{ gap: spacing.md }}>
      <View style={styles.sectionHead}>
        <Text style={[styles.sectionTitle, dark && styles.darkText]}>
          {title}
        </Text>
        <Pressable onPress={() => router.push(href as never)}>
          <Text style={styles.viewAll}>View all →</Text>
        </Pressable>
      </View>
      {children}
    </View>
  );
}
function RecordGrid({
  records,
  empty,
  detailBase,
}: {
  records: PlatformRecord[];
  empty: string;
  detailBase?: string;
}) {
  const { width } = useWindowDimensions();
  const dark = useAppTheme().scheme === "dark";
  if (!records.length)
    return (
      <View style={[styles.empty, dark && styles.darkCard]}>
        <Text style={[styles.cardBody, dark && styles.darkMuted]}>{empty}</Text>
      </View>
    );
  return (
    <View style={styles.recordGrid}>
      {records.slice(0, width > 1000 ? 4 : 3).map((record, index) => {
        const id = recordId(record) ?? String(index);
        return (
          <Pressable
            key={id}
            disabled={!detailBase}
            onPress={
              detailBase
                ? () => router.push(`${detailBase}/${id}` as never)
                : undefined
            }
            style={[
              styles.record,
              { width: width >= 900 ? "31.5%" : "100%" },
              dark && styles.darkCard,
            ]}
          >
            <View style={styles.recordMark}>
              <QrCode color={colors.brand} size={22} />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text
                style={[styles.cardTitle, dark && { color: colors.darkInk }]}
                numberOfLines={1}
              >
                {displayTitle(record)}
              </Text>
              <Text
                style={[styles.cardBody, dark && styles.darkMuted]}
                numberOfLines={1}
              >
                {humanStatus(displayStatus(record) ?? displaySubtitle(record) ?? "Available")}
              </Text>
            </View>
            <ChevronRight color={colors.muted} size={19} />
          </Pressable>
        );
      })}
    </View>
  );
}
function MetricStrip({
  metrics,
}: {
  metrics: readonly { label: string; value: string }[];
}) {
  const dark = useAppTheme().scheme === "dark";
  return (
    <View style={[styles.metrics, dark && styles.darkCard]}>
      {metrics.map((metric) => (
        <View key={metric.label} style={styles.metric}>
          <Text style={[styles.metricValue, dark && styles.darkText]}>
            {metric.value}
          </Text>
          <Text style={[styles.metricLabel, dark && styles.darkMuted]}>
            {metric.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  topline: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: -16,
  },
  subtitle: { color: colors.muted, fontSize: 17 },
  bell: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "rgba(23,33,27,.12)",
    shadowOpacity: 1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  location: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: "#F2CED2",
    backgroundColor: "#FFF8F8",
  },
  micro: { color: colors.muted, fontSize: 12 },
  locationText: { color: colors.ink, fontSize: 16, fontWeight: "800" },
  hero: {
    minHeight: 290,
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "flex-start",
    gap: 9,
    padding: spacing.xl,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "#F4C5CA",
    backgroundColor: "#FFF4F5",
  },
  heroOrb: {
    position: "absolute",
    width: 280,
    height: 280,
    borderRadius: 140,
    right: -65,
    top: 10,
    backgroundColor: "#FFDCE0",
  },
  heroArtwork: { position: "absolute", right: "9%", top: "50%", width: 122, height: 122, marginTop: -61, alignItems: "center", justifyContent: "center", borderRadius: 61, backgroundColor: "rgba(255,255,255,.72)" },
  heroEyebrow: {
    color: colors.brand,
    fontSize: 13,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  heroTitle: {
    color: colors.ink,
    fontSize: 27,
    lineHeight: 33,
    fontWeight: "900",
    maxWidth: "68%",
  },
  heroBody: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
    maxWidth: "62%",
  },
  heroButton: {
    marginTop: 8,
    minHeight: 52,
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    borderRadius: radii.md,
    backgroundColor: colors.brand,
    paddingHorizontal: 22,
  },
  heroButtonText: { color: "white", fontWeight: "900", fontSize: 16 },
  active: {
    minHeight: 160,
    padding: spacing.lg,
    gap: spacing.lg,
    justifyContent: "space-between",
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: "#BFE7CF",
    backgroundColor: "#F4FCF7",
  },
  successLabel: {
    color: colors.success,
    textTransform: "uppercase",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.7,
  },
  cardTitle: { color: colors.ink, fontSize: 17, fontWeight: "900" },
  cardBody: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  liveButton: {
    alignSelf: "flex-end",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#E1F5E8",
    borderRadius: radii.md,
    paddingHorizontal: 15,
    paddingVertical: 10,
  },
  liveText: { color: colors.success, fontWeight: "800" },
  quick: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  quickItem: {
    flex: 1,
    minWidth: 76,
    alignItems: "center",
    gap: 7,
    minHeight: 94,
    justifyContent: "center",
    padding: spacing.sm,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
  },
  quickIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF0F1",
  },
  quickText: { color: colors.ink, fontSize: 12, fontWeight: "700" },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: { color: colors.ink, fontSize: 20, fontWeight: "900" },
  viewAll: { color: colors.brand, fontWeight: "800" },
  recordGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  record: {
    minHeight: 94,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    shadowColor: "rgba(23,33,27,.08)",
    shadowOpacity: 1,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 1,
  },
  recordMark: {
    width: 46,
    height: 58,
    borderRadius: 12,
    backgroundColor: "#FFF0F1",
    alignItems: "center",
    justifyContent: "center",
  },
  empty: {
    minHeight: 110,
    justifyContent: "center",
    padding: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  darkCard: { backgroundColor: colors.darkSurface, borderColor: "#29382F" },
  darkText: { color: colors.darkInk },
  darkMuted: { color: colors.darkMuted },
  heroDark: { backgroundColor: "#241719", borderColor: "#5C2A30" },
  heroOrbDark: { backgroundColor: "#3A2024" },
  activeDark: { backgroundColor: "#13271B", borderColor: "#285C3A" },
  metrics: {
    flexDirection: "row",
    flexWrap: "wrap",
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  metric: {
    flex: 1,
    minWidth: 100,
    alignItems: "center",
    gap: 5,
    padding: spacing.md,
  },
  metricValue: { color: colors.ink, fontSize: 23, fontWeight: "900" },
  metricLabel: { color: colors.muted, fontSize: 12, textAlign: "center" },
  metricHero: {
    minHeight: 220,
    justifyContent: "center",
    gap: 8,
    padding: spacing.xl,
    borderRadius: 28,
    backgroundColor: colors.brand,
  },
  metricHeroLabel: { color: "#FFE7E9", fontSize: 14, fontWeight: "700" },
  metricHeroValue: {
    color: "white",
    fontSize: 38,
    fontWeight: "900",
    letterSpacing: -1,
  },
  metricHeroSecondary: { color: "white", fontSize: 16, fontWeight: "700" },
  statusBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  statusTitle: { color: colors.ink, fontWeight: "900", fontSize: 16 },
  outlineButton: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: radii.md,
  },
  outlineText: { color: colors.brand, fontWeight: "900" },
  dashboardError: {
    alignItems: "flex-start",
    gap: spacing.md,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: "#F1B9BF",
    borderRadius: radii.lg,
    backgroundColor: "#FFF7F8",
  },
  customerSummary: { minHeight: 94, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, paddingVertical: spacing.md, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border },
  summaryLabel: { color: colors.muted, fontSize: 12, fontWeight: "800" },
  summaryValue: { color: colors.ink, fontSize: 24, fontWeight: "900", marginTop: 4 },
  summaryAction: { flexDirection: "row", alignItems: "center", gap: 4 },
  summaryActionText: { color: colors.brand, fontWeight: "900" },
});
