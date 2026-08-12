import { router } from "expo-router";
import { ArrowLeft, ArrowRight, CheckCircle2, Home, MapPinned, PackageCheck, Truck } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { usePublishedProductContent } from "../../src/native/api/productContent";
import { useAppTheme } from "../../src/native/theme/ThemeProvider";
import { colors, radii, spacing } from "../../src/native/theme/tokens";
import { BrandMark } from "../../src/native/ui/BrandMark";

const placements = [
  "mobile.onboarding.customer.request",
  "mobile.onboarding.customer.pickup",
  "mobile.onboarding.customer.track",
  "mobile.onboarding.customer.return",
] as const;

const fallbacks = [
  { title: "Request your refill", body: "Choose a registered cylinder and tell us where to collect it." },
  { title: "We collect with care", body: "A verified driver picks up your cylinder and confirms every hand-off." },
  { title: "Follow every step", body: "See progress from pickup through the partner station and back to you." },
  { title: "Delivered back safely", body: "Confirm your return and keep the same SKIMA cylinder identity for next time." },
] as const;

const icons = [PackageCheck, Truck, MapPinned, Home] as const;

export default function Welcome() {
  const { palette } = useAppTheme();
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const content = usePublishedProductContent(placements, { audience: "public", moduleKey: "lpg" });
  const steps = useMemo(() => placements.map((placement, stepIndex) => {
    const publication = content.data?.find((item) => item.placementKey === placement);
    return {
      title: publication?.title ?? fallbacks[stepIndex].title,
      body: publication?.body ?? fallbacks[stepIndex].body,
      mediaUrl: publication?.mediaUrl ?? null,
    };
  }), [content.data]);
  const step = steps[index];
  const Icon = icons[index];
  const finalStep = index === steps.length - 1;
  const wide = width >= 860;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.canvas }]}>
      <ScrollView contentContainerStyle={styles.outer}>
        <View style={[styles.shell, wide && styles.shellWide]}>
          <View style={styles.topbar}>
            <BrandMark />
            <Pressable accessibilityRole="button" onPress={() => router.push("/(auth)/login")} style={styles.skip}>
              <Text style={[styles.skipText, { color: palette.muted }]}>Skip</Text>
            </Pressable>
          </View>

          <View style={[styles.stage, wide && styles.stageWide]}>
            <View style={[styles.visual, { backgroundColor: palette.ink }]}>
              <View style={styles.visualOrbLarge} />
              <View style={styles.visualOrbSmall} />
              <View style={styles.routeLine} />
              <View style={styles.iconHero}><Icon color="white" size={54} strokeWidth={1.8} /></View>
              <View style={[styles.miniStop, styles.stopOne]}><PackageCheck color={colors.brand} size={21} /></View>
              <View style={[styles.miniStop, styles.stopTwo]}><Truck color={colors.brand} size={21} /></View>
              <View style={[styles.miniStop, styles.stopThree]}><Home color={colors.success} size={21} /></View>
              <View style={styles.visualCaption}><CheckCircle2 color="#8EE0AD" size={18} /><Text style={styles.visualCaptionText}>Tracked from pickup to return</Text></View>
            </View>

            <View style={styles.copyColumn}>
              <Text style={styles.kicker}>HOW SKIMA WORKS</Text>
              <Text style={[styles.title, { color: palette.ink }]}>{step.title}</Text>
              <Text style={[styles.body, { color: palette.muted }]}>{step.body}</Text>
              <View accessibilityLabel={`Step ${index + 1} of ${steps.length}`} style={styles.progress}>
                {steps.map((_, dotIndex) => <View key={dotIndex} style={[styles.dot, { backgroundColor: dotIndex === index ? colors.brand : palette.border }, dotIndex === index && styles.activeDot]} />)}
              </View>
              <Text style={[styles.stepLabel, { color: palette.muted }]}>Step {index + 1} of {steps.length}</Text>
            </View>
          </View>

          <View style={styles.actions}>
            {index > 0 ? <Pressable accessibilityRole="button" onPress={() => setIndex((value) => value - 1)} style={[styles.back, { borderColor: palette.border }]}><ArrowLeft color={palette.ink} size={20} /><Text style={[styles.backText, { color: palette.ink }]}>Back</Text></Pressable> : <View />}
            <Pressable accessibilityRole="button" onPress={() => finalStep ? router.push("/(auth)/register") : setIndex((value) => value + 1)} style={styles.primary}><Text style={styles.primaryText}>{finalStep ? "Create my account" : "Continue"}</Text><ArrowRight color="white" size={20} /></Pressable>
          </View>
          {finalStep ? <Pressable onPress={() => router.push("/(auth)/login")}><Text style={styles.signIn}>Already use SKIMA? <Text style={styles.signInStrong}>Sign in</Text></Text></Pressable> : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  outer: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg },
  shell: { width: "100%", maxWidth: 1120, minHeight: 680, gap: spacing.xl },
  shellWide: { minHeight: 620 },
  topbar: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  skip: { minHeight: 42, justifyContent: "center", paddingHorizontal: spacing.md },
  skipText: { fontWeight: "800" },
  stage: { flex: 1, gap: spacing.xl },
  stageWide: { flexDirection: "row", alignItems: "center", gap: 64 },
  visual: { minHeight: 350, flex: 1.1, overflow: "hidden", alignItems: "center", justifyContent: "center", borderRadius: 36 },
  visualOrbLarge: { position: "absolute", width: 370, height: 370, right: -140, top: -130, borderRadius: 185, backgroundColor: colors.brand },
  visualOrbSmall: { position: "absolute", width: 180, height: 180, left: -70, bottom: -70, borderRadius: 90, backgroundColor: "rgba(237,28,46,.35)" },
  routeLine: { position: "absolute", width: "64%", height: 3, top: "67%", borderRadius: 2, backgroundColor: "rgba(255,255,255,.24)" },
  iconHero: { width: 132, height: 132, alignItems: "center", justifyContent: "center", borderRadius: 66, backgroundColor: "rgba(255,255,255,.13)", borderWidth: 1, borderColor: "rgba(255,255,255,.18)" },
  miniStop: { position: "absolute", width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: 24, backgroundColor: "white" },
  stopOne: { left: "17%", top: "62%" },
  stopTwo: { left: "46%", top: "62%" },
  stopThree: { right: "16%", top: "62%" },
  visualCaption: { position: "absolute", left: spacing.lg, bottom: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radii.pill, backgroundColor: "rgba(0,0,0,.28)" },
  visualCaptionText: { color: "white", fontSize: 12, fontWeight: "800" },
  copyColumn: { flex: 1, gap: spacing.md, justifyContent: "center" },
  kicker: { color: colors.brand, fontSize: 12, fontWeight: "900", letterSpacing: 1.2 },
  title: { maxWidth: 520, fontSize: 42, lineHeight: 47, letterSpacing: -1.4, fontWeight: "900" },
  body: { maxWidth: 520, fontSize: 18, lineHeight: 28 },
  progress: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: spacing.md },
  dot: { width: 8, height: 8, borderRadius: 4 },
  activeDot: { width: 30 },
  stepLabel: { fontSize: 12, fontWeight: "700" },
  actions: { minHeight: 58, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  back: { minHeight: 56, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, borderWidth: 1, borderRadius: radii.md },
  backText: { fontWeight: "900" },
  primary: { minHeight: 58, minWidth: 180, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingHorizontal: spacing.xl, borderRadius: radii.md, backgroundColor: colors.brand },
  primaryText: { color: "white", fontSize: 16, fontWeight: "900" },
  signIn: { color: colors.muted, textAlign: "right", marginTop: -18 },
  signInStrong: { color: colors.brand, fontWeight: "900" },
});
