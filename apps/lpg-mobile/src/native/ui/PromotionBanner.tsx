import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import { router } from "expo-router";
import { ArrowUpRight, Sparkles } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import type { ProductContentRecord } from "../api/productContent";
import { usePublishedProductContent } from "../api/productContent";
import { colors, radii, spacing } from "../theme/tokens";

export function PromotionBanner({ audience = "customer" }: { audience?: "customer" | "driver" | "station" }) {
  const { width } = useWindowDimensions();
  const content = usePublishedProductContent(["mobile.home.promotion"], { audience, moduleKey: "lpg" });
  const publications = (content.data ?? [])
    .filter((item) => item.placementKey === "mobile.home.promotion")
    .sort((left, right) => right.priority - left.priority)
    .slice(0, 8);

  if (!publications.length) return null;

  const cardWidth = Math.min(Math.max(width - 56, 296), 604);

  return (
    <View style={styles.carousel}>
      <ScrollView
        horizontal
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        snapToAlignment="start"
        snapToInterval={cardWidth + 12}
        contentContainerStyle={styles.carouselContent}
      >
        {publications.map((publication) => (
          <PromotionCard
            key={publication.publicationId}
            publication={publication}
            width={cardWidth}
          />
        ))}
      </ScrollView>
      {publications.length > 1 ? (
        <View style={styles.dots} accessibilityElementsHidden>
          {publications.map((publication, index) => (
            <View key={publication.publicationId} style={[styles.dot, index === 0 && styles.dotActive]} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function PromotionCard({ publication, width }: {
  publication: ProductContentRecord;
  width: number;
}) {
  const actionType = typeof publication.ctaAction.type === "string" ? publication.ctaAction.type : null;
  const actionValue = typeof publication.ctaAction.value === "string"
    ? publication.ctaAction.value
    : typeof publication.ctaAction.target === "string"
    ? publication.ctaAction.target
    : null;
  const actionable = actionType === "route" && Boolean(actionValue);
  return (
    <Pressable accessibilityRole={actionable ? "button" : undefined} disabled={!actionable} onPress={actionable ? () => router.push(actionValue as never) : undefined} style={[styles.banner, { width }]}>
      <LinearGradient colors={["#161D19", "#392025"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      {publication.mediaUrl ? <Image contentFit="cover" source={{ uri: publication.mediaUrl }} style={StyleSheet.absoluteFill} /> : null}
      <View style={styles.scrim} />
      <View style={styles.spark}><Sparkles color="white" size={17} /></View>
      <View style={styles.copy}>
        <Text style={styles.kicker}>FEATURED</Text>
        {publication.title ? <Text numberOfLines={1} style={styles.title}>{publication.title}</Text> : null}
        {publication.body ? <Text numberOfLines={2} style={styles.body}>{publication.body}</Text> : null}
      </View>
      {actionable ? <View style={styles.arrow}><ArrowUpRight color={colors.ink} size={17} /></View> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  carousel: { gap: 9 },
  carouselContent: { gap: 12, paddingRight: spacing.sm },
  banner: { minHeight: 118, overflow: "hidden", flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 22 },
  scrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(5,12,8,.35)" },
  spark: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: "rgba(255,255,255,.15)" },
  copy: { flex: 1, gap: 3 },
  kicker: { color: "rgba(255,255,255,.58)", fontSize: 8, fontWeight: "900", letterSpacing: 1.2 },
  title: { color: "white", fontSize: 17, lineHeight: 21, fontWeight: "900" },
  body: { color: "rgba(255,255,255,.70)", fontSize: 11, lineHeight: 15 },
  arrow: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: "white" },
  dots: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: "rgba(18,29,23,.18)" },
  dotActive: { width: 18, backgroundColor: colors.brand },
});
