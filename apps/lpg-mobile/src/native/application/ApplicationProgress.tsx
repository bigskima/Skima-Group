import { StyleSheet, Text, View } from "react-native";
import { colors, radii, spacing } from "../theme/tokens";

export interface ApplicationProgressProps {
  currentStep: number;
  totalSteps: number;
  stepTitle: string;
}

export function ApplicationProgress({
  currentStep,
  totalSteps,
  stepTitle,
}: ApplicationProgressProps) {
  const progressPercent = Math.min(100, Math.max(0, Math.round((currentStep / totalSteps) * 100)));

  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <Text style={styles.stepCounter}>
          Step {currentStep} of {totalSteps}
        </Text>
        <Text style={styles.percentText}>{progressPercent}% completed</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${progressPercent}%` }]} />
      </View>
      <Text style={styles.stepTitle}>{stepTitle}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  stepCounter: {
    fontSize: 11,
    fontWeight: "900",
    color: colors.brand,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  percentText: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.muted,
  },
  track: {
    height: 6,
    borderRadius: radii.pill,
    backgroundColor: "#F3F4F6",
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    backgroundColor: colors.brand,
    borderRadius: radii.pill,
  },
  stepTitle: {
    fontSize: 20,
    fontWeight: "900",
    color: colors.ink,
    marginTop: 4,
  },
});
