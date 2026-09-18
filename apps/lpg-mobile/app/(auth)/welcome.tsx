import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { ArrowLeft, ArrowRight, Flame } from "lucide-react-native";
import { useMemo, useState } from "react";
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

const ONBOARDING_STEPS = [
  {
    placementKey: "mobile.onboarding.customer.request",
    title: "Request your refill",
    body: "Choose your cylinder and tell SKIMA where to collect it.",
  },
  {
    placementKey: "mobile.onboarding.customer.pickup",
    title: "We collect with care",
    body: "A verified driver collects your identified cylinder and confirms the hand-off.",
  },
  {
    placementKey: "mobile.onboarding.customer.track",
    title: "Follow every step",
    body: "Track progress as SKIMA coordinates pickup, refill and return.",
  },
  {
    placementKey: "mobile.onboarding.customer.refill",
    title: "Refilled through SKIMA",
    body: "SKIMA uses the available fulfillment route for your area while keeping your order protected.",
  },
  {
    placementKey: "mobile.onboarding.customer.return",
    title: "Returned to your door",
    body: "Your driver brings the same identified cylinder safely back to you.",
  },
] as const;

const CONTENT_KEYS = [
  "mobile.welcome.hero",
  ...ONBOARDING_STEPS.map((step) => step.placementKey),
] as const;

export default function Welcome() {
  const { palette, scheme } = useAppTheme();
  const { width } = useWindowDimensions();
  const [stepIndex, setStepIndex] = useState(0);
  const content = usePublishedProductContent(CONTENT_KEYS, {
    audience: "public",
    moduleKey: "lpg",
  });
  const dark = scheme === "dark";
  const wide = width >= 760;

  const slides = useMemo(() => {
    const publications = content.data ?? [];
    const fallbackArtwork = bestPublication(publications, "mobile.welcome.hero")?.mediaUrl ?? null;
    return ONBOARDING_STEPS.map((fallback) => {
      const publication = bestPublication(publications, fallback.placementKey);
      return {
        placementKey: fallback.placementKey,
        title: publication?.title ?? fallback.title,
        body: publication?.body ?? fallback.body,
        mediaUrl: publication?.mediaUrl ?? fallbackArtwork,
        accessibilityLabel: publication?.accessibilityLabel ?? publication?.title ?? fallback.title,
      };
    });
  }, [content.data]);

  const slide = slides[stepIndex] ?? slides[0]!;
  const finalStep = stepIndex === slides.length - 1;

  const next = () => {
    if (finalStep) {
      router.push("/(auth)/register");
      return;
    }
    setStepIndex((current) => Math.min(current + 1, slides.length - 1));
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: dark ? "#08090B" : "#F8F8F9" }]}>
      <LinearGradient
        colors={dark ? ["#08090B", "#150B0F", "#090A0C"] : ["#FFFFFF", "#FFF5F6", "#F8F8F9"]}
        end={{ x: 1, y: 1 }}
        start={{ x: 0, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.glow} />

      <ScrollView contentContainerStyle={styles.outer} showsVerticalScrollIndicator={false}>
        <View style={[styles.shell, wide && styles.shellWide]}>
          <View style={styles.topBar}>
            <View style={styles.brandRow}>
              <View style={[styles.logoPlate, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                <BrandMark compact />
              </View>
              <Text style={[styles.brandName, { color: palette.ink }]}>SKIMA</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/(auth)/login")}
              style={({ pressed }) => [styles.signInLink, pressed && styles.pressed]}
            >
              <Text style={styles.signInText}>Sign in</Text>
            </Pressable>
          </View>

          <View
            style={[
              styles.storyCard,
              wide && styles.storyCardWide,
              shadows.floating,
              { backgroundColor: palette.surface, borderColor: palette.border },
            ]}
          >
            <View style={[styles.artwork, !wide && styles.artworkMobile, wide && styles.artworkWide, { backgroundColor: palette.surfaceSubtle }]}>
              {slide.mediaUrl ? (
                <Image
                  accessibilityLabel={slide.accessibilityLabel}
                  contentFit="cover"
                  source={{ uri: slide.mediaUrl }}
                  style={StyleSheet.absoluteFill}
                  transition={220}
                />
              ) : (
                <LinearGradient
                  colors={dark ? ["#2B1017", "#111216"] : ["#FFE9EC", "#FFF7F8"]}
                  end={{ x: 1, y: 1 }}
                  start={{ x: 0, y: 0 }}
                  style={StyleSheet.absoluteFill}
                >
                  <View style={styles.fallbackArtwork}>
                    <View style={styles.fallbackIcon}>
                      <Flame color="#FFFFFF" size={32} strokeWidth={2.3} />
                    </View>
                    <Text style={[styles.fallbackWordmark, { color: palette.ink }]}>SKIMA LPG</Text>
                  </View>
                </LinearGradient>
              )}
              <View style={styles.artworkShade} />
              <View style={styles.stepBadge}>
                <Text style={styles.stepBadgeText}>{stepIndex + 1} / {slides.length}</Text>
              </View>
            </View>

            <View style={[styles.copyPanel, wide && styles.copyPanelWide]}>
              <View style={styles.copy}>
                <Text style={styles.kicker}>YOUR REFILL, STEP BY STEP</Text>
                <Text style={[styles.title, { color: palette.ink }]}>{slide.title}</Text>
                <Text style={[styles.body, { color: palette.muted }]}>{slide.body}</Text>
              </View>

              <View style={styles.dots} accessibilityLabel={"Step " + (stepIndex + 1) + " of " + slides.length}>
                {slides.map((item, index) => (
                  <Pressable
                    key={item.placementKey}
                    accessibilityLabel={"Go to onboarding step " + (index + 1)}
                    accessibilityRole="button"
                    onPress={() => setStepIndex(index)}
                    style={[
                      styles.dot,
                      {
                        backgroundColor: index === stepIndex ? palette.brand : palette.borderStrong,
                        width: index === stepIndex ? 24 : 7,
                      },
                    ]}
                  />
                ))}
              </View>

              <View style={styles.actions}>
                {stepIndex > 0 ? (
                  <Pressable
                    accessibilityLabel="Previous onboarding step"
                    accessibilityRole="button"
                    onPress={() => setStepIndex((current) => Math.max(0, current - 1))}
                    style={({ pressed }) => [
                      styles.backButton,
                      { backgroundColor: palette.surfaceSubtle, borderColor: palette.border },
                      pressed && styles.pressed,
                    ]}
                  >
                    <ArrowLeft color={palette.ink} size={18} />
                  </Pressable>
                ) : null}

                <Pressable
                  accessibilityRole="button"
                  onPress={next}
                  style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
                >
                  <LinearGradient
                    colors={[colors.brand, "#F33C4E", colors.brandDark]}
                    end={{ x: 1, y: 1 }}
                    start={{ x: 0, y: 0 }}
                    style={styles.primaryFill}
                  >
                    <Text style={styles.primaryText}>{finalStep ? "Create my account" : "Next"}</Text>
                    <ArrowRight color="#FFFFFF" size={18} strokeWidth={2.5} />
                  </LinearGradient>
                </Pressable>
              </View>

              {finalStep ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push("/(auth)/login")}
                  style={({ pressed }) => [styles.existingAccount, pressed && styles.pressed]}
                >
                  <Text style={[styles.existingAccountText, { color: palette.mutedStrong }]}>
                    Already have an account? <Text style={styles.existingAccountStrong}>Sign in</Text>
                  </Text>
                </Pressable>
              ) : null}
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
  glow: {
    position: "absolute",
    width: 470,
    height: 470,
    borderRadius: 235,
    right: -250,
    top: -210,
    backgroundColor: "rgba(226,29,47,.12)",
  },
  outer: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 17,
    paddingVertical: 20,
  },
  shell: { width: "100%", maxWidth: 980, gap: 18 },
  shellWide: { gap: 24 },
  topBar: { minHeight: 50, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  logoPlate: { width: 46, height: 46, alignItems: "center", justifyContent: "center", borderRadius: 15, borderWidth: StyleSheet.hairlineWidth },
  brandName: { fontSize: 15, lineHeight: 18, fontWeight: "900", letterSpacing: 1.2 },
  signInLink: { paddingHorizontal: 9, paddingVertical: 8 },
  signInText: { color: colors.brand, fontSize: 12, lineHeight: 16, fontWeight: "900" },
  storyCard: { overflow: "hidden", borderWidth: 1, borderRadius: 30 },
  storyCardWide: { minHeight: 560, flexDirection: "row" },
  artwork: { position: "relative", width: "100%", overflow: "hidden" },
  artworkMobile: { aspectRatio: 1.18 },
  artworkWide: { flex: 1.08, width: "auto", minHeight: 560 },
  artworkShade: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,.08)" },
  stepBadge: { position: "absolute", top: 16, right: 16, paddingHorizontal: 10, paddingVertical: 7, borderRadius: radii.pill, backgroundColor: "rgba(12,13,15,.68)" },
  stepBadgeText: { color: "#FFFFFF", fontSize: 10, lineHeight: 13, fontWeight: "900" },
  fallbackArtwork: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16 },
  fallbackIcon: { width: 74, height: 74, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: colors.brand, ...shadows.raised },
  fallbackWordmark: { fontSize: 16, lineHeight: 20, fontWeight: "900", letterSpacing: 1.8 },
  copyPanel: { gap: 22, padding: 22 },
  copyPanelWide: { flex: 0.92, justifyContent: "center", padding: 34 },
  copy: { gap: 9 },
  kicker: { color: colors.brand, fontSize: 9, lineHeight: 13, fontWeight: "900", letterSpacing: 1.1 },
  title: { fontSize: 30, lineHeight: 35, fontWeight: "900", letterSpacing: -0.9 },
  body: { fontSize: 13, lineHeight: 20, fontWeight: "500" },
  dots: { minHeight: 10, flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { height: 7, borderRadius: 4 },
  actions: { flexDirection: "row", alignItems: "stretch", gap: 10 },
  backButton: { width: 54, minHeight: 56, alignItems: "center", justifyContent: "center", borderWidth: 1, borderRadius: radii.lg },
  primary: { flex: 1, minHeight: 56, overflow: "hidden", borderRadius: radii.lg, ...shadows.raised },
  primaryFill: { flex: 1, minHeight: 56, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 18 },
  primaryText: { color: "#FFFFFF", fontSize: 13, lineHeight: 18, fontWeight: "900" },
  existingAccount: { alignItems: "center", paddingVertical: 2 },
  existingAccountText: { fontSize: 11, lineHeight: 16, fontWeight: "600" },
  existingAccountStrong: { color: colors.brand, fontWeight: "900" },
  pressed: { opacity: 0.76, transform: [{ scale: 0.994 }] },
});
