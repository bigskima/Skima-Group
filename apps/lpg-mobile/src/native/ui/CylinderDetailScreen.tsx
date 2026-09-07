import { router, useLocalSearchParams } from "expo-router";
import {
  ChevronRight,
  ImagePlus,
  PencilLine,
  QrCode,
  Scale,
  ShieldCheck,
} from "lucide-react-native";
import type { ComponentType } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { domainQueries, useEntityMediaLinks } from "../api/domains";
import {
  displayReference,
  displayStatus,
  firstNumber,
  firstString,
  recordId,
} from "../api/records";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { AppButton } from "./AppButton";
import { EmptyState } from "./EmptyState";
import { RuntimeMediaImage } from "./RuntimeMediaImage";
import { Screen } from "./Screen";
import { ScreenSkeleton } from "./ScreenSkeleton";
import { StatusPill } from "./StatusPill";

type IconType = ComponentType<{ color?: string; size?: number; strokeWidth?: number }>;

export function CylinderDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { palette } = useAppTheme();
  const cylinders = domainQueries.cylinders();
  const cylinder = cylinders.data?.find(
    (item) => recordId(item) === id || displayReference(item) === id,
  );
  const cylinderId = cylinder ? recordId(cylinder) : null;
  const media = useEntityMediaLinks("lpg_cylinder", cylinderId);
  const presentation = (media.data ?? []).find((item) =>
    (firstString(item, ["media_role", "mediaRole"]) ?? "").includes("presentation")
  );
  const presentationId = firstString(presentation, ["media_asset_id", "mediaAssetId"]);
  const originalId = cylinder ? firstAssetId(cylinder.image_asset_ids ?? cylinder.imageAssetIds) : null;
  const displayName = firstString(cylinder, ["display_name", "displayName"]) ?? "Cylinder";
  const reference = cylinder ? displayReference(cylinder) : null;
  const status = cylinder ? displayStatus(cylinder) ?? "registered" : "registered";
  const sizeKg = firstNumber(cylinder, ["size_kg", "sizeKg"]);
  const brand = firstString(cylinder, ["brand", "manufacturer"]) ?? "Not added";
  const colour = firstString(cylinder, ["colour", "color"]) ?? "Not added";

  if (cylinders.isPending) {
    return <Screen eyebrow="Your cylinder" title="Cylinder"><ScreenSkeleton cards={3} /></Screen>;
  }

  if (!cylinder || !cylinderId) {
    return (
      <Screen eyebrow="Your cylinder" title="Cylinder">
        <EmptyState
          icon={<QrCode color={palette.brand} size={27} />}
          title="Cylinder unavailable"
          description="This cylinder is unavailable or no longer belongs to this account."
          action={<AppButton label="Back to cylinders" onPress={() => router.replace("/(customer)/cylinders")} />}
        />
      </Screen>
    );
  }

  return (
    <Screen
      eyebrow="Your cylinder"
      title={displayName}
      subtitle="Manage this cylinder without one long settings form."
      action={<AppButton label="Back" variant="ghost" size="sm" onPress={() => router.back()} />}
    >
      <View style={[styles.hero, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <RuntimeMediaImage
          assetId={presentationId ?? originalId}
          label={displayName}
          variant="thumbnail"
        />
        <View style={styles.heroCopy}>
          <Text numberOfLines={1} style={[styles.reference, { color: palette.ink }]}>
            {reference ?? "SKIMA cylinder"}
          </Text>
          <Text style={[styles.meta, { color: palette.muted }]}>
            {sizeKg === null ? "Size not added" : String(sizeKg) + " kg"} · {colour}
          </Text>
          <StatusPill label={friendly(status)} tone={statusTone(status)} />
        </View>
      </View>

      <View style={styles.quickGrid}>
        <CylinderRouteCard
          icon={ImagePlus}
          title="Photo & AI image"
          description={originalId ? "Replace photo or regenerate image" : "Upload a photo or generate without one"}
          onPress={() => router.push(("/(customer)/cylinder/" + cylinderId + "/media") as never)}
        />
        <CylinderRouteCard
          icon={PencilLine}
          title="Cylinder details"
          description="Name, brand, colour and markings"
          onPress={() => router.push(("/(customer)/cylinder/" + cylinderId + "/edit") as never)}
        />
        <CylinderRouteCard
          icon={QrCode}
          title="ID & QR"
          description="View or save the cylinder identity"
          onPress={() => router.push(("/(customer)/cylinder/" + cylinderId + "/identity") as never)}
        />
        <CylinderRouteCard
          icon={Scale}
          title="Capacity"
          description="Review or correct verified size"
          onPress={() => router.push(("/(customer)/cylinder-capacity/" + cylinderId) as never)}
        />
      </View>

      <View style={[styles.summary, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
        <SummaryItem label="Brand" value={brand} />
        <View style={[styles.summaryDivider, { backgroundColor: palette.border }]} />
        <SummaryItem label="Colour" value={colour} />
        <View style={[styles.summaryDivider, { backgroundColor: palette.border }]} />
        <SummaryItem label="Condition" value={friendly(firstString(cylinder, ["condition_status", "conditionStatus"]) ?? "unknown")} />
      </View>

      <View style={[styles.guardrail, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
        <ShieldCheck color={palette.mutedStrong} size={16} />
        <Text style={[styles.guardrailText, { color: palette.muted }]}>
          Capacity and safety-sensitive fields use their own review flow. Editing normal cylinder details does not bypass SKIMA safety checks.
        </Text>
      </View>
    </Screen>
  );
}

function CylinderRouteCard({
  icon: Icon,
  title,
  description,
  onPress,
}: {
  icon: IconType;
  title: string;
  description: string;
  onPress: () => void;
}) {
  const { palette } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.routeCard,
        shadows.soft,
        {
          backgroundColor: palette.surface,
          borderColor: palette.border,
          opacity: pressed ? 0.82 : 1,
        },
      ]}
    >
      <View style={[styles.routeIcon, { backgroundColor: palette.brandSoft }]}>
        <Icon color={palette.brand} size={20} />
      </View>
      <View style={styles.routeCopy}>
        <Text style={[styles.routeTitle, { color: palette.ink }]}>{title}</Text>
        <Text numberOfLines={2} style={[styles.routeBody, { color: palette.muted }]}>{description}</Text>
      </View>
      <ChevronRight color={palette.muted} size={17} />
    </Pressable>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  const { palette } = useAppTheme();
  return (
    <View style={styles.summaryItem}>
      <Text style={[styles.summaryLabel, { color: palette.muted }]}>{label}</Text>
      <Text numberOfLines={1} style={[styles.summaryValue, { color: palette.ink }]}>{value}</Text>
    </View>
  );
}

function firstAssetId(value: unknown) {
  return Array.isArray(value)
    ? value.find((item): item is string => typeof item === "string") ?? null
    : null;
}

function friendly(value: string) {
  return value.replace(/[_-]/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

function statusTone(value: string): "neutral" | "brand" | "success" | "warning" | "danger" {
  const normalized = value.toLowerCase();
  if (["active", "registered", "verified"].some((part) => normalized.includes(part))) return "success";
  if (["unsafe", "damaged", "lost", "stolen"].some((part) => normalized.includes(part))) return "danger";
  if (["expired", "pending"].some((part) => normalized.includes(part))) return "warning";
  return "brand";
}

const styles = StyleSheet.create({
  hero: {
    minHeight: 116,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.xl,
    padding: spacing.md,
  },
  heroCopy: { flex: 1, minWidth: 0, alignItems: "flex-start", gap: 5 },
  reference: { ...typography.subheading, fontSize: 16 },
  meta: { ...typography.caption, fontSize: 10 },
  quickGrid: { gap: spacing.sm },
  routeCard: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
  },
  routeIcon: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  routeCopy: { flex: 1, gap: 2 },
  routeTitle: { ...typography.bodyStrong, fontSize: 13 },
  routeBody: { ...typography.caption, fontSize: 9.5, lineHeight: 14 },
  summary: {
    minHeight: 66,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.sm,
  },
  summaryItem: { flex: 1, alignItems: "center", gap: 2, minWidth: 0 },
  summaryLabel: { ...typography.caption, fontSize: 8, textTransform: "uppercase", fontWeight: "800" },
  summaryValue: { ...typography.bodyStrong, fontSize: 11 },
  summaryDivider: { width: StyleSheet.hairlineWidth, height: 32 },
  guardrail: { flexDirection: "row", gap: spacing.sm, padding: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md },
  guardrailText: { flex: 1, ...typography.caption, fontSize: 9, lineHeight: 14 },
});
