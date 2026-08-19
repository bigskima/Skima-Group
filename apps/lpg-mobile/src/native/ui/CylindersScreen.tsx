import { router } from "expo-router";
import { ChevronRight, Plus, QrCode, Sparkles } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { domainQueries, useEntityMediaLinks } from "../api/domains";
import { displayReference, displayStatus, displayTitle, firstNumber, firstString, recordId, type PlatformRecord } from "../api/records";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { AppButton } from "./AppButton";
import { EmptyState } from "./EmptyState";
import { RuntimeMediaImage } from "./RuntimeMediaImage";
import { Screen } from "./Screen";
import { ScreenSkeleton } from "./ScreenSkeleton";
import { StatusPill } from "./StatusPill";

export function CylindersScreen() {
  const cylinders = domainQueries.cylinders();
  const { palette } = useAppTheme();

  return (
    <Screen
      eyebrow="Cylinder identity"
      title="Your cylinders"
      subtitle="Each cylinder has a SKIMA-managed identity used for refill requests, scanning, hand-offs and anti-switching checks."
      action={<AppButton label="Add cylinder" size="sm" icon={<Plus color="#FFFFFF" size={16} />} onPress={() => router.push("/(customer)/cylinder/register")} />}
    >
      {cylinders.isPending ? (
        <ScreenSkeleton cards={3} />
      ) : cylinders.error ? (
        <EmptyState
          title="We couldn't load your cylinders"
          description="Check your connection and try again."
          action={<AppButton label="Try again" variant="secondary" onPress={() => void cylinders.refetch()} />}
        />
      ) : (cylinders.data ?? []).length ? (
        <View style={styles.list}>
          {(cylinders.data ?? []).map((item, index) => (
            <CylinderRow key={recordId(item) ?? String(index)} cylinder={item} />
          ))}
        </View>
      ) : (
        <EmptyState
          icon={<QrCode color={palette.brand} size={28} />}
          title="Add your first cylinder"
          description="Give it a name, choose its size and add a photo. SKIMA creates the permanent cylinder identity used throughout the refill journey."
          action={<AppButton label="Add a cylinder" icon={<Plus color="#FFFFFF" size={17} />} onPress={() => router.push("/(customer)/cylinder/register")} />}
        />
      )}
    </Screen>
  );
}

function CylinderRow({ cylinder }: { cylinder: PlatformRecord }) {
  const { palette } = useAppTheme();
  const id = recordId(cylinder);
  const links = useEntityMediaLinks("lpg_cylinder", id);
  const presentation = (links.data ?? []).find((item) => (firstString(item, ["media_role", "mediaRole"]) ?? "").includes("presentation"));
  const presentationId = firstString(presentation, ["media_asset_id", "mediaAssetId"]);
  const originalId = firstAssetId(cylinder.image_asset_ids ?? cylinder.imageAssetIds);
  const status = displayStatus(cylinder) ?? "registered";
  const size = firstNumber(cylinder, ["size_kg", "sizeKg"]);
  const reference = displayReference(cylinder) ?? "SKIMA cylinder";

  return (
    <Pressable
      accessibilityRole="button"
      disabled={!id}
      onPress={() => router.push(`/(customer)/cylinder/${id}` as never)}
      style={({ pressed }) => [
        styles.asset,
        shadows.soft,
        { backgroundColor: palette.surface, borderColor: palette.border, opacity: pressed ? 0.76 : 1 },
      ]}
    >
      <View style={styles.mediaShell}>
        <RuntimeMediaImage assetId={presentationId ?? originalId} label={`${displayTitle(cylinder)} cylinder`} variant="thumbnail" />
        <View style={[styles.qrBadge, { backgroundColor: palette.brand }]}>
          <QrCode color="#FFFFFF" size={13} />
        </View>
      </View>

      <View style={styles.assetCopy}>
        <View style={styles.assetHead}>
          <Text numberOfLines={1} style={[styles.title, { color: palette.ink }]}>{displayTitle(cylinder)}</Text>
          {presentationId ? (
            <View style={[styles.presentationBadge, { backgroundColor: palette.brandSofter }]}>
              <Sparkles color={palette.brand} size={11} />
              <Text style={[styles.presentationText, { color: palette.brand }]}>Enhanced</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.body, { color: palette.muted }]}>{size ?? "Configured"} kg · {reference}</Text>
        <StatusPill label={friendlyCylinderStatus(status)} tone={cylinderStatusTone(status)} />
      </View>

      <ChevronRight color={palette.muted} size={20} />
    </Pressable>
  );
}

function firstAssetId(value: unknown) {
  return Array.isArray(value) ? value.find((item): item is string => typeof item === "string") ?? null : null;
}

function normalizeStatus(value: string) {
  return value.toLowerCase().replace(/[-\s]+/g, "_");
}

function friendlyCylinderStatus(value: string) {
  const normalized = normalizeStatus(value);
  const labels: Record<string, string> = {
    active: "Ready to refill",
    registered: "Ready to refill",
    damaged: "Needs attention",
    unsafe: "Not safe to refill",
    expired: "Inspection needed",
    suspended: "Temporarily unavailable",
  };
  return labels[normalized] ?? "Cylinder saved";
}

function cylinderStatusTone(value: string): "neutral" | "brand" | "success" | "warning" | "danger" {
  const normalized = normalizeStatus(value);
  if (["active", "registered"].includes(normalized)) return "success";
  if (["damaged", "expired", "suspended"].includes(normalized)) return "warning";
  if (normalized === "unsafe") return "danger";
  return "neutral";
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  asset: { minHeight: 126, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radii.xl, borderWidth: StyleSheet.hairlineWidth },
  mediaShell: { position: "relative" },
  qrBadge: { position: "absolute", right: -4, bottom: -4, width: 28, height: 28, borderRadius: 10, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#FFFFFF" },
  assetCopy: { flex: 1, minWidth: 0, gap: spacing.sm },
  assetHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  title: { flexShrink: 1, ...typography.subheading, fontSize: 17 },
  body: { ...typography.caption, fontSize: 12, lineHeight: 18 },
  presentationBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 4, borderRadius: radii.pill },
  presentationText: { ...typography.caption, fontSize: 9, fontWeight: "900" },
});
