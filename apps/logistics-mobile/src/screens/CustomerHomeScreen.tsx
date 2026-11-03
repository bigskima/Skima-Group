import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import {
  ArrowRight, Bell, Box, Building2, CarFront, ChevronRight, Clock3, FileText,
  House, Package, PackageCheck, ShieldCheck, Truck, Weight,
} from "lucide-react-native";
import { useMemo } from "react";
import { Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useLogisticsQuery, asString } from "../api/logistics";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { AppButton } from "../ui/AppButton";
import { BrandMark } from "../ui/BrandMark";
import { Card } from "../ui/Card";
import { Screen } from "../ui/Screen";
import { ScreenSkeleton } from "../ui/ScreenSkeleton";
import { SectionHeader } from "../ui/SectionHeader";
import { StatePanel } from "../ui/StatePanel";
import { StatusPill } from "../ui/StatusPill";

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
  const first = value?.trim().split(/\s+/)[0];
  return first || "there";
}
function displayDate(value: string | null) {
  if (!value) return "Just now";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Recently posted" : new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short" }).format(parsed);
}

export function CustomerHomeScreen() {
  const { palette } = useAppTheme();
  const { context, session } = useSession();
  const categories = useLogisticsQuery(["categories"], "/runtime/logistics/categories");
  const jobs = useLogisticsQuery(["jobs"], "/runtime/logistics/jobs", true, 30_000);
  const bookings = useLogisticsQuery(["bookings"], "/runtime/logistics/bookings", true, 30_000);
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
  const refresh = async () => {
    await Promise.all([categories.refetch(), jobs.refetch(), bookings.refetch()]);
  };
  const firstError = categories.error ?? jobs.error ?? bookings.error;

  return (
    <Screen
      eyebrow="SKIMA LOGISTICS"
      title={`Good day, ${name}`}
      subtitle="The right logistics partner starts with the right connection."
      action={
        <Pressable accessibilityRole="button" accessibilityLabel="Open account" onPress={() => router.push("/(customer)/account" as never)}
          style={[styles.avatar, { backgroundColor: palette.brandSoft, borderColor: palette.border }]}>
          <Text style={[styles.avatarText, { color: palette.brand }]}>{name.slice(0, 1).toUpperCase()}</Text>
        </Pressable>
      }
      refreshControl={<RefreshControl refreshing={categories.isRefetching || jobs.isRefetching || bookings.isRefetching} onRefresh={() => void refresh()} tintColor={palette.brand} />}
    >
      <View style={styles.topBrandRow}>
        <BrandMark />
        <View style={styles.topRight}>
          <View style={[styles.secureTag, { backgroundColor: palette.successSoft }]}>
            <ShieldCheck color={palette.success} size={13} />
            <Text style={[styles.secureText, { color: palette.success }]}>Trusted network</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="View activity" onPress={() => router.push("/(customer)/jobs" as never)}
            style={[styles.bell, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <Bell color={palette.ink} size={18} />
            {activeJobs.length + activeBookings.length > 0 ? <View style={[styles.bellDot, { backgroundColor: palette.brand }]} /> : null}
          </Pressable>
        </View>
      </View>

      <LinearGradient colors={["#E21D2F", "#B91323"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
        <View pointerEvents="none" style={styles.heroOrbLarge} />
        <View pointerEvents="none" style={styles.heroOrbSmall} />
        <View style={styles.heroCopy}>
          <Text style={styles.heroEyebrow}>YOUR DELIVERY. YOUR CHOICE.</Text>
          <Text style={styles.heroTitle}>Move anything.{ "\n" }Move with confidence.</Text>
          <Text style={styles.heroBody}>Connect with logistics companies ready for your route, cargo and timing.</Text>
          <AppButton label="Create a request" size="lg" onPress={() => router.push("/(customer)/request" as never)}
            variant="secondary" trailingIcon={<ArrowRight color={palette.brandDark} size={17} />} />
        </View>
        <View style={styles.heroIcon}>
          <Truck color="#FFFFFF" size={34} strokeWidth={1.8} />
        </View>
        <View style={styles.heroFoot}>
          <View style={styles.heroFootItem}><ShieldCheck color="rgba(255,255,255,.82)" size={13} /><Text style={styles.heroFootText}>Verified providers</Text></View>
          <View style={styles.heroFootDivider} />
          <View style={styles.heroFootItem}><FileText color="rgba(255,255,255,.82)" size={13} /><Text style={styles.heroFootText}>Compare offers</Text></View>
          <View style={styles.heroFootDivider} />
          <View style={styles.heroFootItem}><Clock3 color="rgba(255,255,255,.82)" size={13} /><Text style={styles.heroFootText}>Track progress</Text></View>
        </View>
      </LinearGradient>

      <View style={styles.statsRow}>
        <View style={[styles.stat, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <Text style={[styles.statValue, { color: palette.ink }]}>{activeJobs.length}</Text>
          <Text style={[styles.statLabel, { color: palette.muted }]}>Open requests</Text>
        </View>
        <View style={[styles.stat, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <Text style={[styles.statValue, { color: palette.ink }]}>{activeBookings.length}</Text>
          <Text style={[styles.statLabel, { color: palette.muted }]}>Active bookings</Text>
        </View>
        <View style={[styles.stat, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <Text style={[styles.statValue, { color: palette.brand }]}>Free</Text>
          <Text style={[styles.statLabel, { color: palette.muted }]}>Provider matching</Text>
        </View>
      </View>

      <View style={styles.section}>
        <SectionHeader title="What are you moving?" description="Choose a service to start with." action={
          <Pressable onPress={() => router.push("/(customer)/request" as never)}><Text style={[styles.seeAll, { color: palette.brand }]}>View all</Text></Pressable>
        } />
        {categories.isPending ? <ScreenSkeleton cards={2} /> : categories.error ? (
          <StatePanel title="Services couldn’t load" description="We couldn’t retrieve the live Logistics service catalogue." retry={() => void categories.refetch()} icon={<Package color={palette.brand} size={23} />} />
        ) : (categories.data ?? []).filter((item) => asString(item, "status") === "active").length ? (
          <View style={styles.categoryGrid}>
            {(categories.data ?? []).filter((item) => asString(item, "status") === "active").map((item) => {
              const key = asString(item, "key") ?? "";
              const Icon = CATEGORY_ICONS[key] ?? Package;
              return (
                <Pressable key={key} accessibilityRole="button" onPress={() => router.push({ pathname: "/(customer)/request", params: { category: key } } as never)}
                  style={({ pressed }) => [styles.categoryCard, shadows.subtle, { backgroundColor: palette.surface, borderColor: palette.border, transform: [{ scale: pressed ? 0.985 : 1 }] }]}>
                  <View style={[styles.categoryIcon, { backgroundColor: palette.brandSoft }]}><Icon color={palette.brand} size={22} strokeWidth={1.9} /></View>
                  <View style={styles.categoryCopy}>
                    <Text style={[styles.categoryTitle, { color: palette.ink }]} numberOfLines={2}>{asString(item, "display_name") ?? "Logistics service"}</Text>
                    <Text style={[styles.categoryDescription, { color: palette.muted }]} numberOfLines={2}>{asString(item, "description") ?? "Find a qualified logistics provider."}</Text>
                  </View>
                  <View style={[styles.categoryArrow, { backgroundColor: palette.brandSofter }]}><ChevronRight color={palette.brand} size={16} /></View>
                </Pressable>
              );
            })}
          </View>
        ) : (
          <StatePanel title="Services are being prepared" description="The available service catalogue will appear here when it is enabled." icon={<Package color={palette.brand} size={23} />} />
        )}
      </View>

      <View style={styles.section}>
        <SectionHeader title="Your activity" description="Keep an eye on requests and confirmed bookings." action={
          <Pressable onPress={() => router.push("/(customer)/jobs" as never)}><Text style={[styles.seeAll, { color: palette.brand }]}>See all</Text></Pressable>
        } />
        {jobs.isPending && bookings.isPending ? <ScreenSkeleton cards={2} /> : firstError ? (
          <StatePanel title="Activity couldn’t load" description="Your requests are safe. Refresh to try again." retry={() => void refresh()} />
        ) : activeJobs.length === 0 && activeBookings.length === 0 ? (
          <Card variant="subtle" padding="lg">
            <View style={styles.activityEmpty}>
              <View style={[styles.emptyIcon, { backgroundColor: palette.brandSoft }]}><PackageCheck color={palette.brand} size={23} /></View>
              <View style={styles.emptyCopy}>
                <Text style={[styles.emptyTitle, { color: palette.ink }]}>Your next move starts here</Text>
                <Text style={[styles.emptyBody, { color: palette.muted }]}>Create a request and matched logistics companies can send you offers.</Text>
              </View>
              <AppButton label="Start a request" fullWidth onPress={() => router.push("/(customer)/request" as never)} />
            </View>
          </Card>
        ) : (
          <View style={styles.activityList}>
            {activeBookings.slice(0, 2).map((booking) => (
              <Pressable key={String(booking.id)} onPress={() => router.push({ pathname: "/(customer)/jobs/[id]", params: { id: String(booking.job_id) } } as never)}
                style={[styles.activityCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                <View style={[styles.activityIcon, { backgroundColor: palette.successSoft }]}><Truck color={palette.success} size={18} /></View>
                <View style={styles.activityCopy}>
                  <Text style={[styles.activityTitle, { color: palette.ink }]}>Confirmed booking</Text>
                  <Text style={[styles.activityMeta, { color: palette.muted }]}>{asString(booking, "currency_code") ?? ""} {String(booking.total_customer_charge ?? "")}</Text>
                  <StatusPill status={asString(booking, "status") ?? "booked"} />
                </View>
                <ChevronRight color={palette.muted} size={18} />
              </Pressable>
            ))}
            {activeJobs.slice(0, 2).map((job) => (
              <Pressable key={String(job.id)} onPress={() => router.push({ pathname: "/(customer)/jobs/[id]", params: { id: String(job.id) } } as never)}
                style={[styles.activityCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                <View style={[styles.activityIcon, { backgroundColor: palette.brandSoft }]}><Package color={palette.brand} size={18} /></View>
                <View style={styles.activityCopy}>
                  <Text style={[styles.activityTitle, { color: palette.ink }]} numberOfLines={1}>{asString(job, "title") ?? "Logistics request"}</Text>
                  <Text style={[styles.activityMeta, { color: palette.muted }]}>{displayDate(asString(job, "created_at"))} · {locationName(job.pickup_location)} → {locationName(job.destination_location)}</Text>
                  <StatusPill status={asString(job, "status") ?? "open"} />
                </View>
                <ChevronRight color={palette.muted} size={18} />
              </Pressable>
            ))}
          </View>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBrandRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: -8, marginBottom: -4 },
  topRight: { flexDirection: "row", alignItems: "center", gap: 9 },
  secureTag: { height: 30, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, borderRadius: radii.pill },
  secureText: { ...typography.caption, fontSize: 9, fontWeight: "900" },
  bell: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  bellDot: { position: "absolute", top: 8, right: 8, width: 6, height: 6, borderRadius: 3 },
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth },
  avatarText: { ...typography.bodyStrong, fontSize: 16 },
  hero: { minHeight: 260, overflow: "hidden", borderRadius: 28, padding: 20, justifyContent: "space-between", gap: 18 },
  heroOrbLarge: { position: "absolute", width: 240, height: 240, borderRadius: 120, top: -115, right: -75, backgroundColor: "rgba(255,255,255,.09)" },
  heroOrbSmall: { position: "absolute", width: 130, height: 130, borderRadius: 65, top: 75, right: -36, backgroundColor: "rgba(255,255,255,.055)" },
  heroCopy: { alignItems: "flex-start", gap: 8, zIndex: 1, maxWidth: 340 },
  heroEyebrow: { color: "rgba(255,255,255,.72)", ...typography.eyebrow, fontSize: 8 },
  heroTitle: { color: "#FFFFFF", fontSize: 29, lineHeight: 33, fontWeight: "900", letterSpacing: -0.75 },
  heroBody: { color: "rgba(255,255,255,.78)", ...typography.caption, fontSize: 11, lineHeight: 17, maxWidth: 300, marginBottom: 5 },
  heroIcon: { position: "absolute", top: 38, right: 26, width: 68, height: 68, borderRadius: 24, backgroundColor: "rgba(255,255,255,.13)", alignItems: "center", justifyContent: "center" },
  heroFoot: { flexDirection: "row", alignItems: "center", gap: 9, zIndex: 1, flexWrap: "wrap" },
  heroFootItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  heroFootText: { color: "rgba(255,255,255,.84)", fontSize: 9, fontWeight: "800" },
  heroFootDivider: { width: 3, height: 3, borderRadius: 2, backgroundColor: "rgba(255,255,255,.5)" },
  statsRow: { flexDirection: "row", gap: 8 },
  stat: { flex: 1, minWidth: 0, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: 12, gap: 2 },
  statValue: { ...typography.heading, fontSize: 20, lineHeight: 24 },
  statLabel: { ...typography.caption, fontSize: 9, lineHeight: 13 },
  section: { gap: 13 },
  seeAll: { ...typography.caption, fontSize: 11, fontWeight: "900" },
  categoryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  categoryCard: { width: "48.5%", minHeight: 160, flexGrow: 1, flexBasis: "46%", borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: 13, gap: 10, justifyContent: "space-between" },
  categoryIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  categoryCopy: { gap: 4, flex: 1 },
  categoryTitle: { ...typography.bodyStrong, fontSize: 13, lineHeight: 17 },
  categoryDescription: { ...typography.caption, fontSize: 10, lineHeight: 15 },
  categoryArrow: { position: "absolute", right: 10, top: 10, width: 27, height: 27, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  activityList: { gap: 9 },
  activityCard: { flexDirection: "row", alignItems: "center", gap: 11, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: 13 },
  activityIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  activityCopy: { flex: 1, minWidth: 0, gap: 4 },
  activityTitle: { ...typography.bodyStrong, fontSize: 13 },
  activityMeta: { ...typography.caption, fontSize: 10, lineHeight: 14 },
  activityEmpty: { alignItems: "flex-start", gap: 12 },
  emptyIcon: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  emptyCopy: { gap: 3 },
  emptyTitle: { ...typography.bodyStrong, fontSize: 14 },
  emptyBody: { ...typography.caption, lineHeight: 18 },
});
