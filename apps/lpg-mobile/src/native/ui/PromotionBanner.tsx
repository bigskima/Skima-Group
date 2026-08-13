import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import { router } from "expo-router";
import { ArrowUpRight } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import type { ProductContentRecord } from "../api/productContent";
import { usePublishedProductContent } from "../api/productContent";
import { colors, spacing } from "../theme/tokens";

const AUTO_ADVANCE_INTERVAL_MS = 4_500;
const LOOP_RESET_DELAY_MS = 650;

export function PromotionBanner({ audience = "customer" }: { audience?: "customer" | "driver" | "station" }) {
  const { width } = useWindowDimensions();
  const content = usePublishedProductContent(["mobile.home.promotion"], { audience, moduleKey: "lpg" });
  const publications = (content.data ?? [])
    .filter((item) => item.placementKey === "mobile.home.promotion")
    .sort((left, right) => right.priority - left.priority);

  const cardWidth = Math.min(Math.max(width - 56, 296), 604);
  const pageWidth = cardWidth + 12;
  const scrollViewRef = useRef<ScrollView>(null);
  const rawPageRef = useRef(0);
  const interactingRef = useRef(false);
  const loopResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const loopedPublications = publications.length > 1
    ? [...publications, publications[0]!]
    : publications;

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    rawPageRef.current = 0;
    setActiveIndex(0);
    scrollViewRef.current?.scrollTo({ x: 0, animated: false });

    if (publications.length <= 1 || reduceMotion) return;

    const timer = setInterval(() => {
      if (interactingRef.current) return;

      const nextPage = rawPageRef.current + 1;
      rawPageRef.current = nextPage;
      setActiveIndex(nextPage % publications.length);
      scrollViewRef.current?.scrollTo({ x: nextPage * pageWidth, animated: true });

      if (nextPage === publications.length) {
        if (loopResetTimerRef.current) clearTimeout(loopResetTimerRef.current);
        loopResetTimerRef.current = setTimeout(() => {
          scrollViewRef.current?.scrollTo({ x: 0, animated: false });
          rawPageRef.current = 0;
          loopResetTimerRef.current = null;
        }, LOOP_RESET_DELAY_MS);
      }
    }, AUTO_ADVANCE_INTERVAL_MS);

    return () => {
      clearInterval(timer);
      if (loopResetTimerRef.current) {
        clearTimeout(loopResetTimerRef.current);
        loopResetTimerRef.current = null;
      }
    };
  }, [pageWidth, publications.length, reduceMotion]);

  const handleMomentumScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (publications.length <= 1) return;

    const rawPage = Math.max(0, Math.round(event.nativeEvent.contentOffset.x / pageWidth));
    if (rawPage >= publications.length) {
      if (loopResetTimerRef.current) {
        clearTimeout(loopResetTimerRef.current);
        loopResetTimerRef.current = null;
      }
      scrollViewRef.current?.scrollTo({ x: 0, animated: false });
      rawPageRef.current = 0;
      setActiveIndex(0);
      interactingRef.current = false;
      return;
    }

    rawPageRef.current = rawPage;
    setActiveIndex(rawPage);
    interactingRef.current = false;
  };

  if (!publications.length) return null;

  return (
    <View style={styles.carousel}>
      <ScrollView
        ref={scrollViewRef}
        horizontal
        decelerationRate="fast"
        onMomentumScrollEnd={handleMomentumScrollEnd}
        onScrollBeginDrag={() => {
          interactingRef.current = true;
          if (loopResetTimerRef.current) {
            clearTimeout(loopResetTimerRef.current);
            loopResetTimerRef.current = null;
          }
        }}
        onScrollEndDrag={() => {
          interactingRef.current = false;
        }}
        showsHorizontalScrollIndicator={false}
        snapToAlignment="start"
        snapToInterval={pageWidth}
        contentContainerStyle={styles.carouselContent}
      >
        {loopedPublications.map((publication, index) => (
          <PromotionCard
            key={`${publication.publicationId}:${index}`}
            publication={publication}
            width={cardWidth}
          />
        ))}
      </ScrollView>
      {publications.length > 1 ? (
        <View style={styles.dots} accessibilityElementsHidden>
          {publications.map((publication, index) => (
            <View key={publication.publicationId} style={[styles.dot, index === activeIndex && styles.dotActive]} />
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
  const hasArtwork = Boolean(publication.mediaUrl);
  return (
    <Pressable
      accessibilityLabel={publication.accessibilityLabel ?? publication.title ?? "Promotion"}
      accessibilityRole={actionable ? "button" : undefined}
      disabled={!actionable}
      onPress={actionable ? () => router.push(actionValue as never) : undefined}
      style={[styles.banner, { width }]}
    >
      <LinearGradient colors={["#161D19", "#392025"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      {publication.mediaUrl ? <Image contentFit="cover" source={{ uri: publication.mediaUrl }} style={StyleSheet.absoluteFill} /> : null}
      {!hasArtwork ? (
        <View style={styles.copy}>
          {publication.title ? <Text numberOfLines={1} style={styles.title}>{publication.title}</Text> : null}
          {publication.body ? <Text numberOfLines={2} style={styles.body}>{publication.body}</Text> : null}
        </View>
      ) : null}
      {actionable ? <View style={styles.arrow}><ArrowUpRight color={colors.ink} size={17} /></View> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  carousel: { gap: 9 },
  carouselContent: { gap: 12, paddingRight: spacing.sm },
  banner: { minHeight: 118, overflow: "hidden", flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 22 },
  copy: { flex: 1, gap: 3 },
  title: { color: "white", fontSize: 17, lineHeight: 21, fontWeight: "900" },
  body: { color: "rgba(255,255,255,.70)", fontSize: 11, lineHeight: 15 },
  arrow: { position: "absolute", right: 12, bottom: 12, width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: "white" },
  dots: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: "rgba(18,29,23,.18)" },
  dotActive: { width: 18, backgroundColor: colors.brand },
});
