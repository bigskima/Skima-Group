import { StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";

export function StatusPill({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "brand" | "success" | "warning" | "danger";
}) {
  const { palette } = useAppTheme();

  const backgroundColor =
    tone === "brand"
      ? palette.brandSoft
      : tone === "success"
        ? palette.successSoft
        : tone === "warning"
          ? palette.warningSoft
          : tone === "danger"
            ? palette.dangerSoft
            : palette.soft;
  const color =
    tone === "brand"
      ? palette.brand
      : tone === "success"
        ? palette.success
        : tone === "warning"
          ? palette.warning
          : tone === "danger"
            ? palette.danger
            : palette.mutedStrong;

  return (
    <View style={[styles.pill, { backgroundColor }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.label, { color }]}>{label.replace(/[_-]/g, " ")}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    minHeight: 28,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 5,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { ...typography.caption, fontSize: 11, textTransform: "capitalize" },
});
