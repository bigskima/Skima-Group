import { router } from "expo-router";
import {
  Bell, Box, BriefcaseBusiness, CarFront, ChevronRight, House, Package,
  PackageCheck, ShoppingBag, ShieldCheck, Truck, WalletCards, Receipt,
} from "lucide-react-native";
import { useMemo } from "react";
import { useWindowDimensions, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useLogisticsQuery, asNumber, asString } from "../api/logistics";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, typography } from "../theme/tokens";
import { AppButton } from "../ui/AppButton";
import { BrandMark } from "../ui/BrandMark";
import { LogisticsPromotionBanner } from "../ui/LogisticsPromotionBanner";
import { Screen } from "../ui/Screen";
import { ScreenSkeleton } from "../ui/ScreenSkeleton";
import { SectionHeader } from "../ui/SectionHeader";
import { StatePanel } from "../ui/StatePanel";
import { StatusPill } from "../ui/StatusPill";
import { GuideLaunchLink, GuideTarget } from "../onboarding/LogisticsGuideProvider";

const CATEGORY_ICONS: Record<string, typeof Package> = {
  "courier.parcel": Package,
  "goods.delivery": Box,
  "moving.relocation": House,
  "freight.trucking": Truck,
  "vehicle.transport": CarFront,
  "specialized.logistics": ShieldCheck,
};

function locationName(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Location pending";
  const record = value as Record<string, unknown>;
  return asString(record, "display_name", "canonical_name", "formatted_address", "address") ?? "Location pending";
}
function greetingName(value: string | null | undefined) {
  return value?.trim().split(/\s+/)[0] || "there";
}
function displayDate(value: string | null) {
  if (!value) return "Just now";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Recently posted" : new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short" }).format(parsed);
}

export function CustomerHomeScreen() {
  const { palette } = useAppTheme();
  const { context, session } = useSession();
  const { width } = useWindowDimensions();
  const categories = useLogisticsQuery(["categories"], "/runtime/logistics/categories");
  const jobs = useLogisticsQuery(["jobs"], "/runtime/logistics/jobs", true, 30_000);
  const bookings = useLogisticsQuery(["bookings"], "/runtime/logistics/bookings", true, 30_000);
  const wallets = useLogisticsQuery(["home-wallets"], "/runtime/wallets", true, 60_000);
  const walletBalances = useLogisticsQuery(["home-wallet-balances"], "/runtime/wallet-balances", true, 30_000);
  const name = greetingName(
    context?.profile?.display_name ??
    (typeof session?.user.user_metadata?.display_name === "string" ? session.user.user_metadata.display_name : null) ??
    session?.user.email?.split("@")[0],
  );
  const activeJobs = useMemo(
    () => (jobs.data ?? []).filter((job) => !["completed", "completed_offline", "delivered", "cancelled", "expired"].includes((asString(job, "status") ?? "").toLowerCase())),
    [jobs.data],
  );
  const activeBookings = useMemo(
    () => (bookings.data ?? []).filter((booking) => !["completed", "completed_offline", "settled", "cancelled", "refunded"].includes((asString(booking, "status") ?? "").toLowerCase())),
    [bookings.data],
  );
  const refresh = async () => { await Promise.all([categories.refetch(), jobs.refetch(), bookings.refetch(), wallets.refetch(), walletBalances.refetch()]); };
  const firstError = categories.error ?? jobs.error ?? bookings.error;
  const activeCategories = (categories.data ?? []).filter((item) => asString(item, "status") === "active");
  const customerWallet = (wallets.data ?? []).find((w) => asString(w, "wallet_type") === "customer" && asString(w, "owner_entity_type") === "user" && asString(w, "owner_entity_id") === session?.user.id && asString(w, "status") === "active") ?? null;
  const customerWalletId = asString(customerWallet, "id");
  const walletCurrency = asString(customerWallet, "currency_code") ?? "NGN";
  const walletBalance = asNumber((walletBalances.data ?? []).find((b) => asString(b, "wallet_id") === customerWalletId), "balance") ?? 0;

  return (
    <Screen
      title={`Good day, ${name}`}
      denseHeader
      action={
        <View style={styles.headerActions}>
          <BrandMark />
          <Pressable accessibilityRole="button" accessibilityLabel="Open notifications" onPress={() => router.push("/(customer)/notifications" as never)}
            style={[styles.bell, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <Bell color={palette.ink} size={19} />
            {activeJobs.length + activeBookings.length > 0 ? <View style={[styles.bellDot, { backgroundColor: palette.brand }]} /> : null}
          </Pressable>
        </View>
      }
      refreshControl={<RefreshControl refreshing={categories.isRefetching || jobs.isRefetching || bookings.isRefetching} onRefresh={() => void refresh()} tintColor={palette.brand} />}
    >
      <GuideTarget targetKey="customer-home-request">
      <Pressable accessibilityRole="button" onPress={() => router.push("/(customer)/request" as never)}
        style={({ pressed }) => [styles.requestAction, { backgroundColor: palette.surface, borderColor: palette.border, transform: [{ scale: pressed ? 0.99 : 1 }] }]}>
        <View style={[styles.requestIcon, { backgroundColor: palette.brandSoft }]}><Truck color={palette.brand} size={21} /></View>
        <View style={styles.requestCopy}>
          <Text style={[styles.requestTitle, { color: palette.ink }]}>Create a delivery request</Text>
          <Text style={[styles.requestMeta, { color: palette.muted }]}>Compare qualified providers for your route</Text>
        </View>
        <ChevronRight color={palette.brand} size={20} />
      </Pressable>
      </GuideTarget>
      <GuideLaunchLink workspace="customer"/>

      {/* Only the configured campaign banner can occupy the main promotional space. */}
      <LogisticsPromotionBanner />

      <View style={styles.statsRow}>
        <Stat value={String(activeJobs.length)} label="Requests" />
        <Stat value={String(activeBookings.length)} label="Bookings" />
        <Stat value="Free" label="Provider matching" accent />
      </View>

      <GuideTarget targetKey="customer-home-wallet">
      <Pressable accessibilityRole="button" onPress={() => router.push("/(customer)/wallet" as never)} style={[styles.walletLink,{backgroundColor:palette.surface,borderColor:palette.border}]}><View style={[styles.walletIcon,{backgroundColor:palette.brandSoft}]}><WalletCards color={palette.brand} size={18}/></View><View style={styles.requestCopy}><Text style={[styles.requestTitle,{color:palette.ink}]}>SKIMA Wallet</Text><Text style={[styles.requestMeta,{color:palette.muted}]}>{customerWalletId ? new Intl.NumberFormat("en-NG",{style:"currency",currency:walletCurrency,maximumFractionDigits:2}).format(walletBalance) : "View your shared wallet"}</Text></View><ChevronRight color={palette.muted} size={18}/></Pressable>

      </GuideTarget>

      <Pressable accessibilityRole="button" onPress={() => router.push("/(customer)/bills" as never)}
        style={[styles.walletLink,{backgroundColor:palette.surface,borderColor:palette.border}]}>
        <View style={[styles.walletIcon,{backgroundColor:palette.brandSoft}]}><Receipt color={palette.brand} size={18}/></View>
        <View style={styles.requestCopy}>
          <Text style={[styles.requestTitle,{color:palette.ink}]}>Pay bills</Text>
          <Text style={[styles.requestMeta,{color:palette.muted}]}>Airtime, data, electricity and TV</Text>
        </View>
        <ChevronRight color={palette.muted} size={18}/>
      </Pressable>

      <GuideTarget targetKey="customer-home-services" style={styles.section}>
      <View style={styles.section}>
        <SectionHeader title="Services" action={
          <Pressable onPress={() => router.push("/(customer)/request" as never)}><Text style={[styles.seeAll, { color: palette.brand }]}>All services</Text></Pressable>
        } />
        {categories.isPending ? <ScreenSkeleton cards={2} /> : categories.error ? (
          <StatePanel title="Services unavailable" description="Try again to load the service list." retry={() => void categories.refetch()} icon={<Package color={palette.brand} size={22} />} />
        ) : activeCategories.length ? (
          <View style={styles.categoryGrid}>
            {activeCategories.map((item) => {
              const key = asString(item, "key") ?? "";
              const Icon = CATEGORY_ICONS[key] ?? Package;
              return (
                <Pressable key={key} accessibilityRole="button" onPress={() => router.push({ pathname: "/(customer)/request", params: { category: key } } as never)}
                  style={({ pressed }) => [styles.categoryCard, shadows.subtle, {
                    width: width >= 1120 ? "31.5%" : width >= 680 ? "48.5%" : "48.5%",
                    flexBasis: width >= 1120 ? "31.5%" : "46%", flexGrow: width >= 1120 ? 0 : 1,
                    backgroundColor: palette.surface, borderColor: palette.border,
                    transform: [{ scale: pressed ? 0.985 : 1 }],
                  }]}>
                  <View style={[styles.categoryIcon, { backgroundColor: palette.brandSoft }]}><Icon color={palette.brand} size={19} /></View>
                  <Text style={[styles.categoryTitle, { color: palette.ink }]} numberOfLines={1}>{asString(item, "display_name") ?? "Logistics service"}</Text>
                  <ChevronRight color={palette.muted} size={15} style={styles.categoryArrow} />
                </Pressable>
              );
            })}
          </View>
        ) : (
          <StatePanel title="No services available" description="Service options will appear here when enabled." icon={<Package color={palette.brand} size={22} />} />
        )}
      </View>
      </GuideTarget>

      <View style={styles.section}>
        <SectionHeader title="Recent activity" action={
          <Pressable onPress={() => router.push("/(customer)/jobs" as never)}><Text style={[styles.seeAll, { color: palette.brand }]}>View all</Text></Pressable>
        } />
        {jobs.isPending && bookings.isPending ? <ScreenSkeleton cards={2} /> : firstError ? (
          <StatePanel title="Activity unavailable" description="Your requests are safe. Refresh to try again." retry={() => void refresh()} />
        ) : activeJobs.length === 0 && activeBookings.length === 0 ? (
          <View style={[styles.empty, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <PackageCheck color={palette.brand} size={22} />
            <Text style={[styles.emptyTitle, { color: palette.ink }]}>No active requests</Text>
            <AppButton label="Create request" size="md" onPress={() => router.push("/(customer)/request" as never)} />
          </View>
        ) : (
          <View style={styles.activityList}>
            {activeBookings.slice(0, 2).map((booking) => (
              <Pressable key={String(booking.id)} onPress={() => router.push({ pathname: "/(customer)/bookings/[id]", params: { id: String(booking.id) } } as never)}
                style={[styles.activityCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                <View style={[styles.activityIcon, { backgroundColor: palette.successSoft }]}><Truck color={palette.success} size={17} /></View>
                <View style={styles.activityCopy}>
                  <Text style={[styles.activityTitle, { color: palette.ink }]} numberOfLines={1}>Confirmed booking</Text>
                  <Text style={[styles.activityMeta, { color: palette.muted }]} numberOfLines={1}>{asString(booking, "currency_code") ?? ""} {String(booking.total_customer_charge ?? "")}</Text>
                  <StatusPill status={asString(booking, "status") ?? "booked"} />
                </View>
                <ChevronRight color={palette.muted} size={17} />
              </Pressable>
            ))}
            {activeJobs.slice(0, 2).map((job) => (
              <Pressable key={String(job.id)} onPress={() => router.push({ pathname: "/(customer)/jobs/[id]", params: { id: String(job.id) } } as never)}
                style={[styles.activityCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                <View style={[styles.activityIcon, { backgroundColor: palette.brandSoft }]}><BriefcaseBusiness color={palette.brand} size={17} /></View>
                <View style={styles.activityCopy}>
                  <Text style={[styles.activityTitle, { color: palette.ink }]} numberOfLines={1}>{asString(job, "title") ?? "Logistics request"}</Text>
                  <Text style={[styles.activityMeta, { color: palette.muted }]} numberOfLines={1}>{displayDate(asString(job, "created_at"))} · {locationName(job.pickup_location)} → {locationName(job.destination_location)}</Text>
                  <StatusPill status={asString(job, "status") ?? "open"} />
                </View>
                <ChevronRight color={palette.muted} size={17} />
              </Pressable>
            ))}
          </View>
        )}
      </View>

      <GuideTarget targetKey="customer-home-store">
      <Pressable accessibilityRole="button" onPress={() => router.push("/(customer)/store" as never)}
        style={[styles.storeLink, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <View style={[styles.storeIcon, { backgroundColor: palette.brandSoft }]}><ShoppingBag color={palette.brand} size={19} /></View>
        <View style={styles.requestCopy}>
          <Text style={[styles.requestTitle, { color: palette.ink }]}>SKIMA Store</Text>
          <Text style={[styles.requestMeta, { color: palette.muted }]}>Cylinders, essentials and more</Text>
        </View>
        <ChevronRight color={palette.muted} size={18} />
      </Pressable>
      </GuideTarget>
    </Screen>
  );
}

function Stat({ value, label, accent = false }: { value: string; label: string; accent?: boolean }) {
  const { palette } = useAppTheme();
  return <View style={[styles.stat, { backgroundColor: palette.surface, borderColor: palette.border }]}>
    <Text style={[styles.statValue, { color: accent ? palette.brand : palette.ink }]}>{value}</Text>
    <Text style={[styles.statLabel, { color: palette.muted }]}>{label}</Text>
  </View>;
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  bell: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  bellDot: { position: "absolute", top: 8, right: 8, width: 6, height: 6, borderRadius: 3 },
  requestAction: { flexDirection: "row", alignItems: "center", gap: 11, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: 13 },
  requestIcon: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  requestCopy: { flex: 1, minWidth: 0, gap: 2 },
  requestTitle: { ...typography.bodyStrong, fontSize: 13 },
  requestMeta: { ...typography.caption, fontSize: 10, lineHeight: 14 },
  statsRow: { flexDirection: "row", gap: 8 },
  stat: { flex: 1, minWidth: 0, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, padding: 10, gap: 1 },
  statValue: { ...typography.heading, fontSize: 19, lineHeight: 23 },
  statLabel: { ...typography.caption, fontSize: 9, lineHeight: 12 },
  section: { gap: 10 },
  seeAll: { ...typography.caption, fontSize: 10, fontWeight: "900" },
  categoryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  categoryCard: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: 9, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: 11 },
  categoryIcon: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  categoryTitle: { flex: 1, ...typography.bodyStrong, fontSize: 11, lineHeight: 15 },
  categoryArrow: { position: "absolute", right: 9, top: 9 },
  activityList: { gap: 8 },
  activityCard: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: 11 },
  activityIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  activityCopy: { flex: 1, minWidth: 0, gap: 3 },
  activityTitle: { ...typography.bodyStrong, fontSize: 11 },
  activityMeta: { ...typography.caption, fontSize: 9, lineHeight: 13 },
  empty: { alignItems: "center", gap: 8, padding: 16, borderRadius: radii.lg, borderWidth: StyleSheet.hairlineWidth },
  emptyTitle: { ...typography.bodyStrong, fontSize: 12 },
  walletLink: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: 11 },
  walletIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  storeLink: { flexDirection: "row", alignItems: "center", gap: 11, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: 12 },
  storeIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});
