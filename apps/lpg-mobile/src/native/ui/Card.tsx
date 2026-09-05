import type { PropsWithChildren } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing } from "../theme/tokens";

export function Card({
  children,
  variant = "default",
  padding = "md",
}: PropsWithChildren<{
  variant?: "default" | "subtle" | "outline" | "brandSoft";
  padding?: "sm" | "md" | "lg";
}>) {
  const { palette } = useAppTheme();

  const backgroundColor =
    variant === "subtle"
      ? palette.surfaceSubtle
      : variant === "brandSoft"
        ? palette.brandSofter
        : palette.surface;

  const cardStyle: ViewStyle = {
    backgroundColor,
    borderColor: variant === "brandSoft" ? palette.brandSoft : palette.border,
  };

  return (
    <View
      style={[
        styles.card,
        variant !== "outline" && shadows.soft,
        padding === "sm" && styles.paddingSm,
        padding === "md" && styles.paddingMd,
        padding === "lg" && styles.paddingLg,
        cardStyle,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.xl,
    gap: 14,
  },
  paddingSm: { padding: 13 },
  paddingMd: { padding: 17 },
  paddingLg: { padding: spacing.lg },
});
