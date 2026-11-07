import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { ArrowUpRight, Megaphone } from "lucide-react-native";
import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSession } from "../session/SessionProvider";
import { radii, spacing, typography } from "../theme/tokens";

type Promotion = {
  title: string | null;
  body: string | null;
  mediaUrl: string | null;
  accessibilityLabel: string | null;
  ctaLabel: string | null;
  ctaAction: Record<string, unknown>;
};

export function LogisticsPromotionBanner() {
  const { supabase } = useSession();
  const promotion = useQuery<Promotion | null>({
    queryKey: ["logistics-customer-promotion"],
    staleTime: 2 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_published_product_content", {
        target_placement_keys: ["mobile.home.promotion"],
        target_module_key: "logistics",
        target_audience_key: "customer",
        target_country_code: null,
        target_region: null,
        target_city: null,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] as Record<string, unknown> | undefined : undefined;
      if (!row) return null;
      const metadata = isRecord(row.metadata) ? row.metadata : {};
      const directUrl = readString(metadata.media_public_url) ?? readString(metadata.mediaPublicUrl);
      const bucket = readString(row.media_storage_bucket);
      const path = readString(row.media_storage_path);
      const mediaUrl = directUrl ?? (bucket && path ? supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl : null);
      return {
        title: readString(row.title),
        body: readString(row.body),
        mediaUrl,
        accessibilityLabel: readString(row.accessibility_label),
        ctaLabel: readString(row.cta_label),
        ctaAction: isRecord(row.cta_action) ? row.cta_action : {},
      };
    },
  });

  const item = promotion.data;
  if (!item || promotion.isError) return null;
  const actionType = readString(item.ctaAction.type);
  const target = readString(item.ctaAction.value) ?? readString(item.ctaAction.target);
  const canNavigate = Boolean(target && (actionType === "route" || actionType === "url"));
  const onPress = () => {
    if (!target) return;
    if (actionType === "route" && target.startsWith("/")) router.push(target as never);
    else if (actionType === "url" && /^https:\/\//i.test(target)) void Linking.openURL(target).catch(() => undefined);
  };

  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole={canNavigate ? "button" : undefined}
        accessibilityLabel={item.accessibilityLabel ?? item.title ?? "SKIMA Logistics promotion"}
        disabled={!canNavigate}
        onPress={onPress}
        style={({ pressed }) => [styles.banner, { transform: [{ scale: pressed ? 0.995 : 1 }] }]}
      >
        <LinearGradient colors={["#E21D2F", "#9C1422"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        {item.mediaUrl ? <Image source={{ uri: item.mediaUrl }} resizeMode="cover" style={StyleSheet.absoluteFill} /> : null}
        {item.mediaUrl ? <LinearGradient colors={["rgba(0,0,0,.08)", "rgba(0,0,0,.70)"]} style={StyleSheet.absoluteFill} /> : null}
        <View style={styles.copy}>
          <View style={styles.eyebrow}><Megaphone size={13} color="#FFFFFF" /><Text style={styles.eyebrowText}>SKIMA FOR YOU</Text></View>
          <Text numberOfLines={2} style={styles.title}>{item.title ?? "Move with confidence"}</Text>
          {item.body ? <Text numberOfLines={2} style={styles.body}>{item.body}</Text> : null}
          {canNavigate ? (
            <View style={styles.cta}>
              <Text style={styles.ctaText}>{item.ctaLabel ?? "Explore"}</Text>
              <ArrowUpRight size={15} color="#A31222" />
            </View>
          ) : null}
        </View>
      </Pressable>
    </View>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const styles = StyleSheet.create({
  wrap: { width: "100%" },
  banner: { width: "100%", aspectRatio: 16 / 7, minHeight: 190, maxHeight: 230, overflow: "hidden", borderRadius: radii.xl, padding: spacing.lg, justifyContent: "center" },
  copy: { alignItems: "flex-start", maxWidth: 540, gap: 8 },
  eyebrow: { flexDirection: "row", alignItems: "center", gap: 6 },
  eyebrowText: { color: "rgba(255,255,255,.82)", ...typography.eyebrow, fontSize: 8, letterSpacing: 1.2 },
  title: { color: "#FFFFFF", fontSize: 21, lineHeight: 26, fontWeight: "900", maxWidth: 440 },
  body: { color: "rgba(255,255,255,.82)", ...typography.caption, fontSize: 11, lineHeight: 16, maxWidth: 480 },
  cta: { minHeight: 34, backgroundColor: "#FFFFFF", borderRadius: radii.pill, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  ctaText: { color: "#A31222", fontSize: 10, fontWeight: "900" },
});
