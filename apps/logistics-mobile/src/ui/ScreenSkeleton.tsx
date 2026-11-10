import { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing } from "../theme/tokens";

export type SkeletonVariant = "screen" | "list" | "detail" | "dashboard" | "form" | "policy";

function usePulse() {
  const opacity = useRef(new Animated.Value(0.48)).current;
  useEffect(() => {
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 0.82, duration: 780, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0.48, duration: 780, useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [opacity]);
  return opacity;
}

export function SkeletonRows({ rows = 2, compact = false }: { rows?: number; compact?: boolean }) {
  const { palette, scheme } = useAppTheme();
  const opacity = usePulse();
  const fill = scheme === "dark" ? "rgba(255,255,255,0.075)" : "rgba(25,25,27,0.075)";
  return (
    <View accessibilityLabel="Loading content" style={styles.rows}>
      {Array.from({ length: rows }, (_, index) => (
        <Animated.View key={index} style={[styles.row, { opacity, borderColor: palette.border, backgroundColor: palette.surface, minHeight: compact ? 58 : 76 }]}>
          <View style={[styles.avatar, { backgroundColor: fill, width: compact ? 30 : 40, height: compact ? 30 : 40 }]} />
          <View style={styles.rowCopy}>
            <View style={[styles.line, { backgroundColor: fill, width: "48%" }]} />
            <View style={[styles.line, { backgroundColor: fill, width: "88%", height: 9 }]} />
            {!compact ? <View style={[styles.line, { backgroundColor: fill, width: "66%", height: 9 }]} /> : null}
          </View>
        </Animated.View>
      ))}
    </View>
  );
}

export function ScreenSkeleton({
  cards = 3,
  variant = "screen",
  compact = false,
}: {
  cards?: number;
  variant?: SkeletonVariant;
  compact?: boolean;
}) {
  const { palette, scheme } = useAppTheme();
  const opacity = usePulse();
  const fill = scheme === "dark" ? "rgba(255,255,255,0.075)" : "rgba(25,25,27,0.075)";
  const line = (width: `${number}%`, height = 11) => (
    <Animated.View style={[styles.line, { width, height, backgroundColor: fill, opacity }]} />
  );

  if (variant === "policy") {
    return (
      <View accessibilityLabel="Loading current terms" style={styles.policy}>
        <View style={styles.policyIntro}>
          <Animated.View style={[styles.brandMark, { backgroundColor: fill, opacity }]} />
          {line("34%", 9)}
          {line("76%", 24)}
          {line("94%", 12)}
          {line("83%", 12)}
        </View>
        <View style={[styles.panel, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <View style={styles.panelHeading}>
            <View style={{ flex: 1, gap: 10 }}>{line("42%", 9)}{line("72%", 17)}</View>
            {line("18%", 17)}
          </View>
          <View style={[styles.progressTrack, { backgroundColor: palette.border }]}><Animated.View style={[styles.progressFill, { backgroundColor: palette.brand, opacity }]} /></View>
          <View style={styles.toolbar}>
            <View style={[styles.tool, { backgroundColor: fill, opacity }]} />
            <View style={[styles.tool, { backgroundColor: fill, opacity }]} />
          </View>
          {line("54%", 20)}
          {line("100%")}
          {line("96%")}
          {line("90%")}
          {line("100%")}
          {line("78%")}
          <View style={styles.paragraphGap} />
          {line("62%", 16)}
          {line("100%")}
          {line("92%")}
          {line("86%")}
        </View>
        <View style={[styles.agreement, { borderColor: palette.border }]}>
          <View style={[styles.checkbox, { backgroundColor: fill, opacity }]} />
          <View style={{ flex: 1, gap: 8 }}>{line("74%", 12)}{line("96%", 9)}</View>
        </View>
        <View style={[styles.acceptButton, { backgroundColor: palette.brandSoft }]} />
      </View>
    );
  }

  if (variant === "form") {
    return (
      <View style={styles.stack}>
        {Array.from({ length: cards }, (_, index) => (
          <View key={index} style={[styles.panel, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            {line("38%", 10)}
            {line("100%", 42)}
            {line("38%", 10)}
            {line("100%", 42)}
            {line("26%", 10)}
            {line("100%", 42)}
          </View>
        ))}
      </View>
    );
  }

  if (variant === "detail") {
    return (
      <View style={styles.stack}>
        {line("56%", 22)}
        {line("38%", 10)}
        <View style={[styles.panel, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          {line("44%", 12)}{line("100%", 12)}{line("94%", 12)}{line("83%", 12)}
        </View>
        <View style={[styles.panel, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          {line("34%", 12)}{line("92%", 12)}{line("68%", 12)}
        </View>
      </View>
    );
  }

  if (variant === "list") {
    return <View style={styles.stack}><SkeletonRows rows={cards} compact={compact} /></View>;
  }

  return (
    <View style={styles.stack}>
      <Animated.View style={[styles.hero, { backgroundColor: fill, opacity, height: variant === "dashboard" ? 142 : compact ? 74 : 112 }]} />
      {variant === "dashboard" ? (
        <View style={styles.metricRow}>
          {Array.from({ length: 2 }, (_, index) => <Animated.View key={index} style={[styles.metric, { backgroundColor: palette.surface, borderColor: palette.border, opacity }]}><View style={[styles.line, { backgroundColor: fill, width: "50%" }]} /><View style={[styles.line, { backgroundColor: fill, width: "76%", height: 18 }]} /></Animated.View>)}
        </View>
      ) : null}
      <SkeletonRows rows={cards} compact={compact} />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { width: "100%", gap: spacing.md },
  rows: { width: "100%", gap: spacing.sm },
  row: { minHeight: 76, borderRadius: radii.lg, borderWidth: StyleSheet.hairlineWidth, padding: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.md },
  avatar: { borderRadius: radii.md },
  rowCopy: { flex: 1, gap: 9 },
  line: { height: 11, borderRadius: radii.pill },
  hero: { width: "100%", borderRadius: radii.xl },
  metricRow: { flexDirection: "row", gap: spacing.sm },
  metric: { flex: 1, minHeight: 82, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md, justifyContent: "center", gap: 12 },
  policy: { flex: 1, width: "100%", maxWidth: 820, alignSelf: "center", justifyContent: "center", gap: spacing.md, padding: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.xl },
  policyIntro: { gap: 10, paddingBottom: spacing.xs },
  brandMark: { width: 42, height: 42, borderRadius: 14, marginBottom: 2 },
  panel: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.md, gap: 11 },
  panelHeading: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  progressTrack: { width: "100%", height: 6, borderRadius: radii.pill, overflow: "hidden" },
  progressFill: { width: "34%", height: 6, borderRadius: radii.pill },
  toolbar: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
  tool: { width: "30%", height: 34, borderRadius: radii.pill },
  paragraphGap: { height: 8 },
  agreement: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  checkbox: { width: 22, height: 22, borderRadius: 6 },
  acceptButton: { width: "100%", height: 48, borderRadius: radii.pill },
});
