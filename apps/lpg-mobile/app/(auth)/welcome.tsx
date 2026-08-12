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
  const content = usePublishedProductContent(placements, {
    audience: "public",
    moduleKey: "lpg",
  });
  const steps = useMemo(
    () =>
      placements.map((placement, stepIndex) => {
        const publication = content.data?.find(
          (item) => item.placementKey === placement,
        );
        return {
          title: publication?.title ?? fallbacks[stepIndex].title,
          body: publication?.body ?? fallbacks[stepIndex].body,
          mediaUrl: publication?.mediaUrl ?? null,
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
            <BrandMark />
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
                  source={step.mediaUrl}
                  style={StyleSheet.absoluteFill}
                />
              ) : null}
              <View style={styles.mediaShade} />
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
  skip: {
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  skipText: { fontSize: 14, fontWeight: "800" },
  stage: { gap: 20 },
  stageWide: { flexDirection: "row", alignItems: "center", gap: 56 },
  visual: {
    minHeight: 252,
    flex: 1.08,
    overflow: "hidden",
    justifyContent: "space-between",
    padding: 20,
    borderRadius: 30,
  },
  mediaShade: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(7,16,11,.48)",
  },
  orb: {
    position: "absolute",
    width: 210,
    height: 210,
    right: -72,
    top: -88,
    borderRadius: 105,
    backgroundColor: "rgba(237,28,46,.48)",
  },
  visualHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
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
    width: 84,
    height: 84,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.22)",
    borderRadius: 42,
    backgroundColor: "rgba(255,255,255,.12)",
  },
  journey: {
    position: "relative",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 4,
  },
  routeLine: {
    position: "absolute",
    left: 20,
    right: 20,
    height: 2,
    backgroundColor: "rgba(255,255,255,.18)",
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
