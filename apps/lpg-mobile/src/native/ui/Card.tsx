import type { PropsWithChildren } from "react";
import { StyleSheet, View } from "react-native";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing } from "../theme/tokens";

export function Card({ children }: PropsWithChildren) {
  const { palette } = useAppTheme();
  return <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: 12,
  },
});
