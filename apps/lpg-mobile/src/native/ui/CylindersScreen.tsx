import { router } from "expo-router";
import { ChevronRight, Plus, QrCode, Sparkles } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { domainQueries, useEntityMediaLinks } from "../api/domains";
import { displayReference, displayStatus, displayTitle, firstNumber, firstString, recordId, type PlatformRecord } from "../api/records";
import { useAppTheme } from "../theme/ThemeProvider";
import { colors, radii, spacing } from "../theme/tokens";
import { RuntimeMediaImage } from "./RuntimeMediaImage";
import { Screen } from "./Screen";
import { ScreenSkeleton } from "./ScreenSkeleton";

export function CylindersScreen() {
  const cylinders = domainQueries.cylinders();
  const { palette } = useAppTheme();
  return (
    <Screen eyebrow="Your cylinders" title="Ready for the next refill" action={<Pressable onPress={() => router.push("/(customer)/cylinder/register")} style={styles.action}><Plus color="white" size={18} /><Text style={styles.actionText}>Add</Text></Pressable>}>
      {cylinders.isPending ? <ScreenSkeleton cards={3} /> : cylinders.error ? <View style={[styles.empty, { backgroundColor: palette.surface }]}><Text style={[styles.emptyTitle, { color: palette.ink }]}>We couldn’t load your cylinders</Text><Text style={[styles.emptyBody, { color: palette.muted }]}>Check your connection and try again.</Text></View> : (cylinders.data ?? []).length ? <View style={styles.list}>{(cylinders.data ?? []).map((item, index) => <CylinderRow key={recordId(item) ?? String(index)} cylinder={item} />)}</View> : <View style={[styles.empty, { backgroundColor: palette.surface }]}><View style={[styles.emptyVisual, { backgroundColor: palette.brandSoft }]}><QrCode color={colors.brand} size={40} /></View><Text style={[styles.emptyTitle, { color: palette.ink }]}>Add your first cylinder</Text><Text style={[styles.emptyBody, { color: palette.muted }]}>Name it, choose the size and add a photo. SKIMA creates the permanent identity for you.</Text><Pressable onPress={() => router.push("/(customer)/cylinder/register")} style={styles.primary}><Plus color="white" size={18} /><Text style={styles.actionText}>Add a cylinder</Text></Pressable></View>}
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
  return (
    <Pressable disabled={!id} onPress={() => router.push(`/(customer)/cylinder/${id}` as never)} style={[styles.asset, { backgroundColor: palette.surface, shadowColor: palette.shadow }]}>
      <RuntimeMediaImage assetId={presentationId ?? originalId} label={`${displayTitle(cylinder)} cylinder`} variant="thumbnail" />
      <View style={styles.assetCopy}>
        <View style={styles.assetHead}><Text numberOfLines={1} style={[styles.title, { color: palette.ink }]}>{displayTitle(cylinder)}</Text>{presentationId ? <View style={styles.presentationBadge}><Sparkles color="#6B35D3" size={12} /><Text style={styles.presentationText}>Enhanced</Text></View> : null}</View>
        <Text style={[styles.body, { color: palette.muted }]}>{firstNumber(cylinder, ["size_kg", "sizeKg"]) ?? "—"} kg · {displayReference(cylinder) ?? "SKIMA cylinder"}</Text>
        <Text style={[styles.status, status === "active" && styles.ready]}>{friendlyCylinderStatus(status)}</Text>
      </View>
      <ChevronRight color={palette.muted} size={21} />
    </Pressable>
  );
}

function firstAssetId(value: unknown) {
  return Array.isArray(value) ? value.find((item): item is string => typeof item === "string") ?? null : null;
}

function friendlyCylinderStatus(value: string) {
  const normalized = value.toLowerCase().replace(/[-\s]+/g, "_");
  const labels: Record<string, string> = { active: "Ready to refill", registered: "Ready to refill", damaged: "Needs attention", unsafe: "Not safe to refill", expired: "Inspection needed" };
  return labels[normalized] ?? "Cylinder saved";
}

const styles = StyleSheet.create({
  action: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 16, borderRadius: radii.pill, backgroundColor: colors.brand },
  actionText: { color: "white", fontWeight: "900" },
  list: { gap: spacing.md },
  asset: { minHeight: 124, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: 28, shadowOpacity: 1, shadowRadius: 18, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
  assetCopy: { flex: 1, gap: 7 },
  assetHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  title: { flexShrink: 1, fontSize: 18, fontWeight: "900" },
  body: { lineHeight: 20 },
  status: { alignSelf: "flex-start", color: colors.muted, fontSize: 12, fontWeight: "900" },
  ready: { color: colors.success },
  presentationBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radii.pill, backgroundColor: "#F0E9FF" },
  presentationText: { color: "#5A2AB5", fontSize: 10, fontWeight: "900" },
  empty: { minHeight: 370, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl, borderRadius: 32 },
  emptyVisual: { width: 94, height: 118, alignItems: "center", justifyContent: "center", borderRadius: 30 },
  emptyTitle: { fontSize: 23, fontWeight: "900", textAlign: "center" },
  emptyBody: { maxWidth: 430, lineHeight: 22, textAlign: "center" },
  primary: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.xl, borderRadius: radii.md, backgroundColor: colors.brand },
});
