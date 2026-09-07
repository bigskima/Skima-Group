import { StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";

export interface ApplicationProgressProps {
  currentStep: number;
  totalSteps: number;
  stepTitle: string;
  completionPercent?: number;
  completionLabel?: string;
}

export function ApplicationProgress({
  currentStep,
  totalSteps,
  stepTitle,
  completionPercent,
  completionLabel,
}: ApplicationProgressProps) {
  const { palette } = useAppTheme();
  const stepPercent = Math.min(100, Math.max(0, Math.round((currentStep / totalSteps) * 100)));
  const progressPercent = completionPercent === undefined
    ? stepPercent
    : Math.min(100, Math.max(0, Math.round(completionPercent)));
  const label = completionLabel ?? (completionPercent === undefined
    ? currentStep >= totalSteps
      ? "Final step"
      : `${progressPercent}% through steps`
    : `${progressPercent}% complete`);

  return (
    <View style={[styles.container, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <View style={styles.topRow}>
        <View style={[styles.stepBadge, { backgroundColor: palette.brandSoft }]}>
          <Text style={[styles.stepCounter, { color: palette.brand }]}>Step {currentStep} of {totalSteps}</Text>
        </View>
        <Text style={[styles.percentText, { color: palette.muted }]}>{label}</Text>
      </View>
      <Text style={[styles.stepTitle, { color: palette.ink }]}>{stepTitle}</Text>
      <View style={[styles.track, { backgroundColor: palette.soft }]}>
        <View style={[styles.fill, { width: `${progressPercent}%`, backgroundColor: palette.brand }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 6,
    marginBottom: 2,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 6 },
  stepBadge: { borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 3 },
  stepCounter: { ...typography.eyebrow, fontSize: 9, textTransform: "uppercase" },
  percentText: { ...typography.caption, fontSize: 9.5 },
  track: { height: 5, borderRadius: radii.pill, overflow: "hidden" },
  fill: { height: "100%", borderRadius: radii.pill },
  stepTitle: { ...typography.subheading, fontSize: 15, lineHeight: 19 },
});
