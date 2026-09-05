import { router } from "expo-router";
import {
  BadgeDollarSign,
  ChevronRight,
  Clock3,
  Power,
  ShieldCheck,
  Store,
} from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { domainQueries, useStationRuntime } from "../api/domains";
import {
  firstNumber,
  firstString,
  nestedRecord,
  nestedRecords,
  recordId,
} from "../api/records";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { AppButton } from "./AppButton";
import { EmptyState } from "./EmptyState";
import { Screen } from "./Screen";
import { ScreenSkeleton } from "./ScreenSkeleton";
import { StatusPill } from "./StatusPill";

export function StationSettingsScreen() {
  const session = useSession();
  const { palette } = useAppTheme();
  const hasPermission = (permission: string) =>
    Boolean(
      session.context?.platformAdmin ||
        session.context?.permissions.includes(permission) ||
        session.context?.roles.some((role) => role.permissions.includes(permission)),
    );

  const canManageOperations = hasPermission("lpg.stations.manage");
  const canManagePrice = hasPermission("business.partner_price.manage") ||
    hasPermission("platform.partner_price.manage") ||
    canManageOperations;
  const canViewSettings = canManageOperations || canManagePrice;

  const runtime = useStationRuntime();
  const branch = nestedRecord(runtime.data, "branch");
  const branchId = branch ? recordId(branch) : null;
  const catalogPrices = domainQueries.stationCatalogPrices(branchId);
  const hours = nestedRecord(branch, "operatingHours") ?? nestedRecord(branch, "operating_hours");
  const pricing = catalogPrices.data?.[0] ?? nestedRecords(runtime.data, "pricing")[0];

  const availability = firstString(branch, ["availabilityStatus", "availability_status"]) ?? "available";
  const opens = firstString(hours, ["opensAt", "opens_at"]);
  const closes = firstString(hours, ["closesAt", "closes_at"]);
  const price = firstNumber(pricing, ["pricePerKg", "price_per_kg"]);

  if (!canViewSettings) {
    return (
      <Screen
        eyebrow="Station operations"
        title="Settings & pricing"
        subtitle="Only authorised station team members can manage these areas."
      >
        <EmptyState
          icon={<ShieldCheck color={palette.brand} size={27} />}
          title="Settings access restricted"
          description="Your current station role does not include operating-settings or branch-pricing permissions."
          action={<AppButton label="Back" variant="secondary" onPress={() => router.back()} />}
        />
      </Screen>
    );
  }

  return (
    <Screen
      eyebrow="Station operations"
      title="Settings & pricing"
      subtitle="Choose the station setting you want to manage."
      action={<AppButton label="Back" variant="ghost" size="sm" onPress={() => router.back()} />}
    >
      {runtime.isPending || catalogPrices.isPending ? (
        <ScreenSkeleton cards={2} />
      ) : runtime.error || catalogPrices.error ? (
        <EmptyState
          icon={<Store color={palette.brand} size={27} />}
          title="Station settings could not be loaded"
          description="Check your connection and try again."
          action={<AppButton label="Retry" onPress={() => void Promise.all([runtime.refetch(), catalogPrices.refetch()])} />}
        />
      ) : (
        <>
          <View style={[styles.hero, shadows.raised, { backgroundColor: availability === "available" ? palette.brand : palette.ink }]}>
            <View style={styles.heroTop}>
              <View style={styles.heroCopy}>
                <Text style={styles.heroEyebrow}>CURRENT BRANCH STATUS</Text>
                <Text style={styles.heroTitle}>{availabilityLabel(availability)}</Text>
              </View>
              <View style={styles.heroIcon}><Power color="#FFFFFF" size={25} /></View>
            </View>
            <View style={styles.heroFooter}>
              <StatusPill
                label={availabilityLabel(availability)}
                tone={availability === "available" ? "success" : availability === "paused" ? "warning" : "neutral"}
              />
              <Text style={styles.heroHours}>{opens && closes ? `${opens} – ${closes}` : "Hours not fully set"}</Text>
            </View>
          </View>

          <View style={styles.grid}>
            <SettingTile
              icon={Clock3}
              title="Availability & hours"
              description="Branch status and daily operating hours"
              meta={canManageOperations ? "You can manage this" : "View only"}
              onPress={() => router.push("/(station)/operating-settings" as never)}
            />
            <SettingTile
              icon={BadgeDollarSign}
              title="LPG selling price"
              description="Set this branch's price per kilogram"
              meta={price === null ? "Price not set" : `₦${price.toLocaleString()}/kg`}
              onPress={() => router.push("/(station)/pricing-settings" as never)}
            />
          </View>

          <View style={[styles.note, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
            <ShieldCheck color={palette.mutedStrong} size={18} />
            <Text style={[styles.noteText, { color: palette.muted }]}>
              Choose availability and pricing separately whenever you need to make a change.
            </Text>
          </View>
        </>
      )}
    </Screen>
  );
}

function SettingTile({
  icon: Icon,
  title,
  description,
  meta,
  onPress,
}: {
  icon: typeof Clock3;
  title: string;
  description: string;
  meta: string;
  onPress: () => void;
}) {
  const { palette } = useAppTheme();

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        shadows.soft,
        {
          backgroundColor: palette.surface,
          borderColor: palette.border,
          opacity: pressed ? 0.72 : 1,
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
      ]}
    >
      <View style={styles.tileTop}>
        <View style={[styles.tileIcon, { backgroundColor: palette.brandSoft }]}>
          <Icon color={palette.brand} size={21} />
        </View>
        <ChevronRight color={palette.muted} size={18} />
      </View>
      <View style={styles.tileCopy}>
        <Text style={[styles.tileTitle, { color: palette.ink }]}>{title}</Text>
        <Text style={[styles.tileBody, { color: palette.muted }]}>{description}</Text>
      </View>
      <Text style={[styles.tileMeta, { color: palette.brand }]}>{meta}</Text>
    </Pressable>
  );
}

function availabilityLabel(value: string) {
  const labels: Record<string, string> = {
    available: "Available",
    paused: "Paused",
    closed: "Closed",
    unavailable: "Unavailable",
  };
  return labels[value] ?? value.replace(/[_-]/g, " ");
}

const styles = StyleSheet.create({
  hero: { gap: spacing.md, padding: spacing.lg, borderRadius: radii.xl },
  heroTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md },
  heroCopy: { flex: 1, gap: 3 },
  heroEyebrow: { color: "rgba(255,255,255,.72)", ...typography.eyebrow, fontSize: 9 },
  heroTitle: { color: "#FFFFFF", ...typography.title, fontSize: 27 },
  heroIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: "rgba(255,255,255,.14)", alignItems: "center", justifyContent: "center" },
  heroFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  heroHours: { color: "rgba(255,255,255,.86)", ...typography.caption, fontWeight: "800" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  tile: {
    minWidth: 145,
    flexGrow: 1,
    flexBasis: "47%",
    minHeight: 154,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.xl,
    padding: spacing.md,
    gap: spacing.md,
  },
  tileTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  tileIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  tileCopy: { flex: 1, gap: 3 },
  tileTitle: { ...typography.bodyStrong, fontSize: 14 },
  tileBody: { ...typography.caption, fontSize: 10, lineHeight: 14 },
  tileMeta: { ...typography.caption, fontSize: 10, fontWeight: "900" },
  note: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm + 2, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  noteText: { flex: 1, ...typography.caption, lineHeight: 18 },
});
