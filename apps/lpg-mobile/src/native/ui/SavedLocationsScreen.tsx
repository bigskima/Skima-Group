import { router } from "expo-router";
import { Check, MapPin, Plus, ShieldCheck } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";
import { domainQueries } from "../api/domains";
import { displaySubtitle, displayTitle, recordId } from "../api/records";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { AppButton } from "./AppButton";
import { EmptyState } from "./EmptyState";
import { Screen } from "./Screen";
import { ScreenSkeleton } from "./ScreenSkeleton";

export function SavedLocationsScreen() {
  const { palette } = useAppTheme();
  const locations = domainQueries.locations();
  const records = locations.data ?? [];

  return (
    <Screen
      eyebrow="Delivery"
      title="Saved places"
      subtitle="Pickup and return addresses you can reuse for future orders."
      action={
        <AppButton
          label="Add place"
          size="sm"
          icon={<Plus color="#FFFFFF" size={16} />}
          onPress={() => router.push("/(customer)/location-editor" as never)}
        />
      }
    >
      <View style={[styles.summary, shadows.soft, { backgroundColor: palette.brandSofter, borderColor: palette.brandSoft }]}>
        <View style={[styles.summaryIcon, { backgroundColor: palette.brandSoft }]}>
          <MapPin color={palette.brand} size={23} />
        </View>
        <View style={styles.summaryCopy}>
          <Text style={[styles.summaryValue, { color: palette.ink }]}>{locations.isPending ? "—" : records.length}</Text>
          <Text style={[styles.summaryLabel, { color: palette.muted }]}>
            {locations.isPending ? "loading saved places" : records.length === 1 ? "saved delivery place" : "saved delivery places"}
          </Text>
        </View>
        <View style={[styles.safeBadge, { backgroundColor: palette.surface }]}>
          <ShieldCheck color={palette.success} size={14} />
          <Text style={[styles.safeText, { color: palette.success }]}>Reusable</Text>
        </View>
      </View>

      {locations.isPending ? (
        <ScreenSkeleton cards={2} />
      ) : locations.error ? (
        <EmptyState
          icon={<MapPin color={palette.brand} size={26} />}
          title="Saved places couldn't be loaded"
          description="Check your connection and try again."
          action={<AppButton label="Retry" onPress={() => void locations.refetch()} />}
        />
      ) : records.length === 0 ? (
        <EmptyState
          icon={<MapPin color={palette.brand} size={26} />}
          title="No saved places yet"
          description="Add your home, office or another pickup point once and reuse it whenever you order."
          action={
            <AppButton
              label="Add your first place"
              icon={<Plus color="#FFFFFF" size={17} />}
              onPress={() => router.push("/(customer)/location-editor" as never)}
            />
          }
        />
      ) : (
        <View style={styles.list}>
          {records.map((item, index) => {
            const id = recordId(item);
            const title = displayTitle(item) || "Saved place";
            const address = displaySubtitle(item) ?? "Saved pickup and return point";
            return (
              <View
                key={id ?? String(index)}
                style={[
                  styles.place,
                  shadows.soft,
                  { backgroundColor: palette.surface, borderColor: palette.border },
                ]}
              >
                <View style={[styles.pin, { backgroundColor: palette.brandSoft }]}>
                  <MapPin color={palette.brand} size={20} />
                </View>
                <View style={styles.copy}>
                  <Text numberOfLines={1} style={[styles.title, { color: palette.ink }]}>{title}</Text>
                  <Text numberOfLines={2} style={[styles.address, { color: palette.muted }]}>{address}</Text>
                </View>
                <View style={[styles.savedBadge, { backgroundColor: palette.successSoft }]}>
                  <Check color={palette.success} size={13} />
                  <Text style={[styles.savedBadgeText, { color: palette.success }]}>Saved</Text>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  summary: {
    minHeight: 94,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.xl,
    padding: spacing.md,
  },
  summaryIcon: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  summaryCopy: { flex: 1, gap: 1 },
  summaryValue: { ...typography.heading, fontSize: 24, lineHeight: 28 },
  summaryLabel: { ...typography.caption, fontSize: 11 },
  safeBadge: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, paddingVertical: 6, borderRadius: radii.pill },
  safeText: { ...typography.caption, fontSize: 9, fontWeight: "900" },
  list: { gap: spacing.sm },
  place: {
    minHeight: 88,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.xl,
    padding: spacing.md,
  },
  pin: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  title: { ...typography.bodyStrong, fontSize: 14 },
  address: { ...typography.caption, fontSize: 11, lineHeight: 16 },
  savedBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: radii.pill },
  savedBadgeText: { ...typography.caption, fontSize: 9, fontWeight: "900" },
});
