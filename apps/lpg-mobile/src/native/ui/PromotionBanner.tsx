import { Image } from "expo-image";
import { router } from "expo-router";
import { ArrowUpRight, Sparkles } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { usePublishedProductContent } from "../api/productContent";
import { useAppTheme } from "../theme/ThemeProvider";
import { colors, radii, spacing } from "../theme/tokens";

export function PromotionBanner({ audience = "customer" }: { audience?: "customer" | "driver" | "station" }) {
  const { palette } = useAppTheme();
  const content = usePublishedProductContent(["mobile.home.promotion"], {
    audience,
    moduleKey: "lpg",
  });
  const publication = content.data?.[0];
  if (!publication) return null;
  const actionType = typeof publication.ctaAction.type === "string" ? publication.ctaAction.type : null;
  const actionValue = typeof publication.ctaAction.value === "string" ? publication.ctaAction.value : null;
  const actionable = actionType === "route" && Boolean(actionValue);
  return (
    <Pressable
      accessibilityRole={actionable ? "button" : undefined}
      disabled={!actionable}
      onPress={actionable ? () => router.push(actionValue as never) : undefined}
      style={[styles.banner, { backgroundColor: palette.ink }]}
    >
      <View style={styles.glow} />
      {publication.mediaUrl ? <Image contentFit="cover" source={publication.mediaUrl} style={styles.media} /> : null}
      <View style={styles.scrim} />
      <View style={styles.icon}><Sparkles color="white" size={19} /></View>
      <View style={styles.copy}>
        {publication.title ? <Text style={styles.title}>{publication.title}</Text> : null}
        {publication.body ? <Text numberOfLines={2} style={styles.body}>{publication.body}</Text> : null}
        {publication.ctaLabel ? <Text style={styles.cta}>{publication.ctaLabel}</Text> : null}
      </View>
      {actionable ? <View style={styles.arrow}><ArrowUpRight color={colors.ink} size={19} /></View> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: { minHeight: 168, overflow: "hidden", flexDirection: "row", alignItems: "flex-end", gap: spacing.md, padding: spacing.lg, borderRadius: radii.lg },
  glow: { position: "absolute", width: 220, height: 220, top: -100, right: -40, borderRadius: 110, backgroundColor: colors.brand },
  media: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  scrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(8,16,12,.44)" },
  icon: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 19, backgroundColor: "rgba(255,255,255,.17)" },
  copy: { flex: 1, gap: 6 },
  title: { maxWidth: 520, color: "white", fontSize: 21, lineHeight: 26, fontWeight: "900" },
  body: { maxWidth: 560, color: "rgba(255,255,255,.82)", lineHeight: 20 },
  cta: { color: "white", fontWeight: "900", marginTop: 3 },
  arrow: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 20, backgroundColor: "white" },
});
