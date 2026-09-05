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
    <View style={[styles.pill, { backgroundColor, borderColor: palette.border }]}>
      <View style={[styles.dotHalo, { backgroundColor }]}>
        <View style={[styles.dot, { backgroundColor: color }]} />
      </View>
      <Text numberOfLines={1} style={[styles.label, { color }]}>{label.replace(/[_-]/g, " ")}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    minHeight: 30,
    maxWidth: "100%",
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 5,
  },
  dotHalo: { width: 14, height: 14, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { flexShrink: 1, ...typography.caption, fontSize: 10, fontWeight: "900", textTransform: "capitalize" },
});
