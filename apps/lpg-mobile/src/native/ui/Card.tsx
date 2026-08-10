import type { PropsWithChildren } from "react";
import { StyleSheet, View } from "react-native";
import { colors, radii, spacing } from "../theme/tokens";
import { useAppTheme } from "../theme/ThemeProvider";

export function Card({ children }: PropsWithChildren) {
  const { palette } = useAppTheme();
  return <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>{children}</View>;
}
const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
});
