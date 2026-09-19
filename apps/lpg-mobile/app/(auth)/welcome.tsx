import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { ArrowRight } from "lucide-react-native";
import { useMemo } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  type ProductContentRecord,
  usePublishedProductContent,
} from "../../src/native/api/productContent";
import { useAppTheme } from "../../src/native/theme/ThemeProvider";
import { colors, radii, shadows } from "../../src/native/theme/tokens";
import { BrandMark } from "../../src/native/ui/BrandMark";

const JOURNEY = [
  {
    placementKey: "mobile.onboarding.customer.pickup",
    fallbackTitle: "Pickup",
  },
  {
    placementKey: "mobile.onboarding.customer.refill",
    fallbackTitle: "Refill",
  },
  {
    placementKey: "mobile.onboarding.customer.return",
    fallbackTitle: "Return",
  },
] as const;

const CONTENT_KEYS = [
  "mobile.welcome.hero",
  ...JOURNEY.map((item) => item.placementKey),
] as const;

export default function Welcome() {
  const { palette, scheme } = useAppTheme();
  const { width } = useWindowDimensions();
  const dark = scheme === "dark";
  const wide = width >= 760;
  const content = usePublishedProductContent(CONTENT_KEYS, {
    audience: "public",
    moduleKey: "lpg",
  });

  const experience = useMemo(() => {
    const publications = content.data ?? [];
    const hero = bestPublication(publications, "mobile.welcome.hero");
    const journey = JOURNEY.map((item) => ({
      placementKey: item.placementKey,
      title:
        bestPublication(publications, item.placementKey)?.title ??
        item.fallbackTitle,
    }));
    const fallbackMedia = JOURNEY.map((item) =>
      bestPublication(publications, item.placementKey)?.mediaUrl,
    ).find(Boolean);

    return {
      title: hero?.title ?? "Your cylinder. Picked up, refilled and returned.",
      body:
        hero?.body ??
        "A simpler way to refill LPG without carrying your cylinder around.",
      mediaUrl: hero?.mediaUrl ?? fallbackMedia ?? null,
      accessibilityLabel:
        hero?.accessibilityLabel ??
        hero?.title ??
        "SKIMA LPG pickup, refill and return service",
      journey,
    };
  }, [content.data]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: dark ? "#07080A" : "#F7F7F8" }]}>
      <LinearGradient
        colors={dark ? ["#07080A", "#150B0F", "#090A0C"] : ["#FFFFFF", "#FFF5F6", "#F6F6F8"]}
        end={{ x: 1, y: 1 }}
        start={{ x: 0, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      <View pointerEvents="none" style={styles.glowPrimary} />
      <View pointerEvents="none" style={styles.glowSecondary} />

      <ScrollView
        contentContainerStyle={styles.outer}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.shell, wide && styles.shellWide]}>
          <View style={styles.topBar}>
            <View style={styles.brandRow}>
              <View
                style={[
                  styles.logoPlate,
                  {
                    backgroundColor: palette.surface,
                    borderColor: palette.border,
                  },
                ]}
              >
                <BrandMark compact />
              </View>
              <View>
                <Text style={[styles.brandName, { color: palette.ink }]}>SKIMA</Text>
                <Text style={[styles.brandCaption, { color: palette.muted }]}>LPG</Text>
              </View>
            </View>

            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/(auth)/login")}
              style={({ pressed }) => [
                styles.signInButton,
                {
                  backgroundColor: palette.surface,
                  borderColor: palette.border,
                },
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.signInText}>Sign in</Text>
            </Pressable>
          </View>

          <View
            style={[
              styles.heroCard,
              wide && styles.heroCardWide,
              shadows.floating,
              {
                backgroundColor: palette.surface,
                borderColor: palette.border,
              },
            ]}
          >
            <View
              style={[
                styles.visual,
                wide ? styles.visualWide : styles.visualMobile,
                { backgroundColor: palette.surfaceSubtle },
              ]}
            >
              {experience.mediaUrl ? (
                <Image
                  accessibilityLabel={experience.accessibilityLabel}
                  contentFit="cover"
                  source={{ uri: experience.mediaUrl }}
                  style={StyleSheet.absoluteFill}
                  transition={220}
                />
              ) : (
                <LinearGradient
                  colors={dark ? ["#281017", "#101114"] : ["#FFE7EA", "#FFF7F8"]}
                  end={{ x: 1, y: 1 }}
                  start={{ x: 0, y: 0 }}
                  style={StyleSheet.absoluteFill}
                >
                  <View style={styles.fallbackVisual}>
                    <View style={styles.fallbackLogo}>
                      <BrandMark compact />
                    </View>
                    <Text style={[styles.fallbackWordmark, { color: palette.ink }]}>
                      SKIMA LPG
                    </Text>
                  </View>
                </LinearGradient>
              )}

              <LinearGradient
                colors={["rgba(0,0,0,0)", "rgba(0,0,0,.10)", "rgba(0,0,0,.42)"]}
                end={{ x: 0.5, y: 1 }}
                start={{ x: 0.5, y: 0 }}
                style={StyleSheet.absoluteFill}
              />

              <View style={styles.visualBadge}>
                <View style={styles.badgeDot} />
                <Text style={styles.visualBadgeText}>Pickup · Refill · Return</Text>
              </View>
            </View>

            <View style={[styles.copyPanel, wide && styles.copyPanelWide]}>
              <View style={styles.copy}>
                <Text style={styles.kicker}>SKIMA LPG</Text>
                <Text
                  numberOfLines={3}
                  style={[styles.title, { color: palette.ink }]}
                >
                  {experience.title}
                </Text>
                <Text
                  numberOfLines={3}
                  style={[styles.body, { color: palette.muted }]}
                >
                  {experience.body}
                </Text>
              </View>

              <View style={styles.journeyBlock}>
                <Text style={[styles.journeyLabel, { color: palette.mutedStrong }]}>
                  HOW IT WORKS
                </Text>
                <View style={styles.journeyRow}>
                  {experience.journey.map((item, index) => (
                    <View
                      key={item.placementKey}
                      style={[
                        styles.journeyPill,
                        {
                          backgroundColor: palette.surfaceSubtle,
                          borderColor: palette.border,
                        },
                      ]}
                    >
                      <View style={styles.journeyNumber}>
                        <Text style={styles.journeyNumberText}>{index + 1}</Text>
                      </View>
                      <Text
                        numberOfLines={1}
                        style={[styles.journeyText, { color: palette.ink }]}
                      >
                        {item.title}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>

              <View style={styles.actions}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push("/(auth)/register")}
                  style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
                >
                  <LinearGradient
                    colors={[colors.brand, "#F33C4E", colors.brandDark]}
                    end={{ x: 1, y: 1 }}
                    start={{ x: 0, y: 0 }}
                    style={styles.primaryFill}
                  >
                    <Text style={styles.primaryText}>Get started</Text>
                    <View style={styles.arrowBubble}>
                      <ArrowRight color="#FFFFFF" size={17} strokeWidth={2.6} />
                    </View>
                  </LinearGradient>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push("/(auth)/login")}
                  style={({ pressed }) => [
                    styles.secondary,
                    {
                      backgroundColor: palette.surfaceSubtle,
                      borderColor: palette.border,
                    },
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.secondaryText, { color: palette.ink }]}>
                    I already have an account
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function bestPublication(
  publications: readonly ProductContentRecord[],
  placementKey: string,
) {
  return publications
    .filter((publication) => publication.placementKey === placementKey)
    .sort((left, right) => right.priority - left.priority || right.revision - left.revision)[0];
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  glowPrimary: {
    position: "absolute",
    width: 500,
    height: 500,
    borderRadius: 250,
    right: -280,
    top: -235,
    backgroundColor: "rgba(226,29,47,.13)",
  },
  glowSecondary: {
    position: "absolute",
    width: 330,
    height: 330,
    borderRadius: 165,
    left: -240,
    bottom: -150,
    backgroundColor: "rgba(226,29,47,.05)",
  },
  outer: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 17,
    paddingVertical: 18,
  },
  shell: { width: "100%", maxWidth: 1000, gap: 17 },
  shellWide: { gap: 22 },
  topBar: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  logoPlate: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
  },
  brandName: {
    fontSize: 15,
    lineHeight: 18,
    fontWeight: "900",
    letterSpacing: 1.05,
  },
  brandCaption: {
    fontSize: 9,
    lineHeight: 12,
    fontWeight: "800",
    letterSpacing: 1.55,
  },
  signInButton: {
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: 16,
    borderWidth: 1,
    borderRadius: radii.pill,
  },
  signInText: {
    color: colors.brand,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "900",
  },
  heroCard: {
    overflow: "hidden",
    borderWidth: 1,
    borderRadius: 32,
  },
  heroCardWide: {
    minHeight: 570,
    flexDirection: "row",
  },
  visual: {
    position: "relative",
    overflow: "hidden",
  },
  visualMobile: {
    width: "100%",
    aspectRatio: 1.15,
  },
  visualWide: {
    flex: 1.08,
    minHeight: 570,
  },
  fallbackVisual: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
  },
  fallbackLogo: {
    width: 76,
    height: 76,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 25,
    backgroundColor: "rgba(255,255,255,.86)",
    ...shadows.raised,
  },
  fallbackWordmark: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "900",
    letterSpacing: 1.7,
  },
  visualBadge: {
    position: "absolute",
    left: 16,
    bottom: 16,
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: radii.pill,
    backgroundColor: "rgba(10,10,12,.72)",
  },
  badgeDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#FFFFFF",
  },
  visualBadgeText: {
    color: "#FFFFFF",
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "900",
  },
  copyPanel: {
    gap: 22,
    padding: 22,
  },
  copyPanelWide: {
    flex: 0.92,
    justifyContent: "center",
    padding: 38,
  },
  copy: { gap: 10 },
  kicker: {
    color: colors.brand,
    fontSize: 9,
    lineHeight: 13,
    fontWeight: "900",
    letterSpacing: 1.3,
  },
  title: {
    maxWidth: 470,
    fontSize: 33,
    lineHeight: 38,
    fontWeight: "900",
    letterSpacing: -1.1,
  },
  body: {
    maxWidth: 440,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "500",
  },
  journeyBlock: { gap: 9 },
  journeyLabel: {
    fontSize: 9,
    lineHeight: 13,
    fontWeight: "900",
    letterSpacing: 1.05,
  },
  journeyRow: {
    flexDirection: "row",
    gap: 7,
  },
  journeyPill: {
    minWidth: 0,
    flex: 1,
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderRadius: 14,
  },
  journeyNumber: {
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 11,
    backgroundColor: colors.brand,
  },
  journeyNumberText: {
    color: "#FFFFFF",
    fontSize: 9,
    lineHeight: 11,
    fontWeight: "900",
  },
  journeyText: {
    flex: 1,
    minWidth: 0,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "800",
  },
  actions: { gap: 9 },
  primary: {
    minHeight: 58,
    overflow: "hidden",
    borderRadius: 18,
    ...shadows.raised,
  },
  primaryFill: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    paddingHorizontal: 18,
  },
  primaryText: {
    color: "#FFFFFF",
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "900",
  },
  arrowBubble: {
    width: 29,
    height: 29,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 15,
    backgroundColor: "rgba(255,255,255,.16)",
  },
  secondary: {
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    borderWidth: 1,
    borderRadius: 17,
  },
  secondaryText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
  },
  pressed: {
    opacity: 0.8,
    transform: [{ scale: 0.994 }],
  },
});
