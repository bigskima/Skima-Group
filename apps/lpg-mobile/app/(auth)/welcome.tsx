import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Flame,
  Home,
  PackageCheck,
  ScanLine,
  Truck,
} from "lucide-react-native";
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
import type { ProductContentRecord } from "../../src/native/api/productContent";
import { usePublishedProductContent } from "../../src/native/api/productContent";
import { useAppTheme } from "../../src/native/theme/ThemeProvider";
import { colors, radii, spacing } from "../../src/native/theme/tokens";
import { BrandMark } from "../../src/native/ui/BrandMark";

const placements = [
  "mobile.onboarding.customer.request",
  "mobile.onboarding.customer.pickup",
  "mobile.onboarding.customer.track",
  "mobile.onboarding.customer.refill",
  "mobile.onboarding.customer.return",
] as const;
const contentPlacements = ["mobile.welcome.hero", ...placements] as const;

const fallbacks = [
  {
    title: "Request your refill",
    body: "Choose your cylinder and tell us where to collect it.",
  },
  {
    title: "We collect it",
    body: "A verified driver collects your cylinder at the arranged time.",
  },
  {
    title: "Identified and tracked",
    body: "Your cylinder is checked at every hand-off, and you can follow its journey.",
  },
  {
    title: "Refilled by a partner station",
    body: "A trusted station refills your cylinder and confirms the amount supplied.",
  },
  {
    title: "Returned to your door",
    body: "Your driver brings the same identified cylinder safely back to you.",
  },
] as const;

const icons = [PackageCheck, Truck, ScanLine, Flame, Home] as const;

export default function Welcome() {
  const { palette } = useAppTheme();
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const content = usePublishedProductContent(contentPlacements, {
    audience: "public",
    moduleKey: "lpg",
  });
  const steps = useMemo(
    () =>
      placements.map((placement, stepIndex) => {
        const publication = findTopPublication(content.data, placement);
        const mediaPublication = findTopMediaPublication(content.data, placement);
        return {
          title: publication?.title ?? fallbacks[stepIndex].title,
          body: publication?.body ?? fallbacks[stepIndex].body,
          mediaUrl: mediaPublication?.mediaUrl ?? findTopMediaPublication(content.data, "mobile.welcome.hero")?.mediaUrl ?? null,
        };
      }),
    [content.data],
  );
  const step = steps[index];
  const StepIcon = icons[index];
  const finalStep = index === steps.length - 1;
  const wide = width >= 860;

  const continueJourney = () => {
    if (finalStep) router.push("/(auth)/register");
    else setIndex((value) => value + 1);
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.canvas }]}>
      <ScrollView
        contentContainerStyle={styles.outer}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.shell, wide && styles.shellWide]}>
          <View style={styles.topbar}>
            <View style={styles.logoLockup}>
              <View style={[styles.logoPlate, { backgroundColor: palette.elevated, borderColor: palette.border }]}>
                <BrandMark compact />
              </View>
              <View>
                <Text style={[styles.logoKicker, { color: palette.muted }]}>SKIMA LPG</Text>
                <Text style={[styles.logoText, { color: palette.ink }]}>Refill journey</Text>
              </View>
            </View>
            {!finalStep ? (
              <Pressable
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => router.push("/(auth)/login")}
                style={({ pressed }) => [styles.skip, pressed && styles.pressed]}
              >
                <Text style={[styles.skipText, { color: palette.muted }]}>Skip</Text>
              </Pressable>
            ) : null}
          </View>

          <View style={[styles.stage, wide && styles.stageWide]}>
            <LinearGradient
              colors={["#121D17", "#24342B"]}
              end={{ x: 1, y: 1 }}
              start={{ x: 0, y: 0 }}
              style={styles.visual}
            >
              {step.mediaUrl ? (
                <Image
                  accessibilityElementsHidden
                  contentFit="cover"
                  source={{ uri: step.mediaUrl }}
                  style={StyleSheet.absoluteFill}
                />
              ) : null}
              <LinearGradient
                colors={["rgba(7,16,11,.10)", "rgba(7,16,11,.12)", "rgba(7,16,11,.62)"]}
                style={StyleSheet.absoluteFill}
              />
              <View style={styles.orb} />

              <View style={styles.visualHeader}>
                <Text style={styles.visualLabel}>THE SKIMA JOURNEY</Text>
                <Text style={styles.visualCount}>
                  {String(index + 1).padStart(2, "0")}
                </Text>
              </View>

              <View style={styles.heroIcon}>
                <StepIcon color="white" size={42} strokeWidth={1.8} />
              </View>

              <View style={styles.journey}>
                <View style={styles.routeLine} />
                {icons.map((JourneyIcon, journeyIndex) => {
                  const complete = journeyIndex < index;
                  const active = journeyIndex === index;
                  return (
                    <View
                      key={placements[journeyIndex]}
                      style={[
                        styles.journeyStop,
                        active && styles.journeyStopActive,
                        complete && styles.journeyStopComplete,
                      ]}
                    >
                      {complete ? (
                        <Check color="white" size={14} strokeWidth={3} />
                      ) : (
                        <JourneyIcon
                          color={active ? colors.brand : "#9FAAA3"}
                          size={active ? 19 : 15}
                          strokeWidth={2.2}
                        />
                      )}
                    </View>
                  );
                })}
              </View>
            </LinearGradient>

            <View style={styles.copyColumn}>
              <Text style={styles.kicker}>REFILL, WITHOUT THE RUNAROUND</Text>
              <Text style={[styles.title, { color: palette.ink }]}>
                {step.title}
              </Text>
              <Text style={[styles.body, { color: palette.muted }]}>
                {step.body}
              </Text>

              <View style={styles.progressRow}>
                <View
                  accessibilityLabel={`Step ${index + 1} of ${steps.length}`}
                  style={styles.progress}
                >
                  {steps.map((_, dotIndex) => (
                    <Pressable
                      accessibilityLabel={`Go to step ${dotIndex + 1}`}
                      accessibilityRole="button"
                      key={placements[dotIndex]}
                      onPress={() => setIndex(dotIndex)}
                      style={[
                        styles.dot,
                        { backgroundColor: palette.border },
                        dotIndex <= index && styles.activeDot,
                      ]}
                    />
                  ))}
                </View>
                <Text style={[styles.stepLabel, { color: palette.muted }]}>
                  {index + 1} of {steps.length}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.actions}>
            {index > 0 ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setIndex((value) => value - 1)}
                style={({ pressed }) => [
                  styles.back,
                  { borderColor: palette.border },
                  pressed && styles.pressed,
                ]}
              >
                <ArrowLeft color={palette.ink} size={19} />
                <Text style={[styles.backText, { color: palette.ink }]}>Back</Text>
              </Pressable>
            ) : (
              <View />
            )}
            <Pressable
              accessibilityRole="button"
              onPress={continueJourney}
              style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
            >
              <Text style={styles.primaryText}>
                {finalStep ? "Create account" : "Continue"}
              </Text>
              <ArrowRight color="white" size={19} />
            </Pressable>
          </View>

          {finalStep ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/(auth)/login")}
            >
              <Text style={[styles.signIn, { color: palette.muted }]}>
                Already have an account?{" "}
                <Text style={styles.signInStrong}>Sign in</Text>
              </Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function findTopPublication(
  publications: ProductContentRecord[] | undefined,
  placementKey: string,
) {
  return publications
    ?.filter((item) => item.placementKey === placementKey)
    .sort((left, right) => right.priority - left.priority)[0];
}

function findTopMediaPublication(
  publications: ProductContentRecord[] | undefined,
  placementKey: string,
) {
  return publications
    ?.filter((item) => item.placementKey === placementKey && item.mediaUrl)
    .sort((left, right) => right.priority - left.priority)[0];
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  outer: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  shell: { width: "100%", maxWidth: 1100, gap: 18 },
  shellWide: { minHeight: 620, justifyContent: "center" },
  topbar: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  logoLockup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  logoPlate: {
    width: 58,
    height: 58,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 22,
  },
  logoKicker: {
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.4,
  },
  logoText: {
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: -0.2,
  },
  skip: {
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  skipText: { fontSize: 14, fontWeight: "800" },
  stage: { gap: 20 },
  stageWide: { flexDirection: "row", alignItems: "center", gap: 56 },
  visual: {
    minHeight: 308,
    flex: 1.08,
    overflow: "hidden",
    justifyContent: "space-between",
    padding: 18,
    borderRadius: 34,
  },
  orb: {
    position: "absolute",
    width: 190,
    height: 190,
    right: -64,
    top: -72,
    borderRadius: 95,
    backgroundColor: "rgba(237,28,46,.35)",
  },
  visualHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 2,
  },
  visualLabel: {
    color: "rgba(255,255,255,.72)",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.25,
  },
  visualCount: {
    color: "rgba(255,255,255,.45)",
    fontSize: 20,
    fontWeight: "900",
  },
  heroIcon: {
    position: "absolute",
    right: 18,
    bottom: 78,
    width: 64,
    height: 64,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.28)",
    borderRadius: 32,
    backgroundColor: "rgba(7,16,11,.50)",
  },
  journey: {
    position: "relative",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.14)",
    borderRadius: radii.pill,
    backgroundColor: "rgba(7,16,11,.46)",
  },
  routeLine: {
    position: "absolute",
    left: 28,
    right: 28,
    height: 2,
    backgroundColor: "rgba(255,255,255,.22)",
  },
  journeyStop: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 15,
    backgroundColor: "#E8EDE9",
  },
  journeyStopActive: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 4,
    borderColor: "rgba(255,255,255,.28)",
    backgroundColor: "white",
  },
  journeyStopComplete: { backgroundColor: colors.success },
  copyColumn: { flex: 0.92, gap: 10, justifyContent: "center" },
  kicker: {
    color: colors.brand,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.15,
  },
  title: {
    maxWidth: 520,
    fontSize: 31,
    lineHeight: 36,
    letterSpacing: -0.8,
    fontWeight: "900",
  },
  body: { maxWidth: 520, fontSize: 16, lineHeight: 23 },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 6,
  },
  progress: { flex: 1, flexDirection: "row", gap: 6, marginRight: 16 },
  dot: { flex: 1, maxWidth: 42, height: 4, borderRadius: 2 },
  activeDot: { backgroundColor: colors.brand },
  stepLabel: { fontSize: 12, fontWeight: "800" },
  actions: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  back: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderRadius: radii.md,
  },
  backText: { fontWeight: "900" },
  primary: {
    minHeight: 54,
    minWidth: 156,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 22,
    borderRadius: radii.md,
    backgroundColor: colors.brand,
  },
  primaryText: { color: "white", fontSize: 15, fontWeight: "900" },
  pressed: { opacity: 0.72 },
  signIn: { textAlign: "center", fontSize: 14 },
  signInStrong: { color: colors.brand, fontWeight: "900" },
});
