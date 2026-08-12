import type { PropsWithChildren } from "react";
import { StyleSheet, View } from "react-native";
import { colors, radii, spacing } from "../theme/tokens";
import { useAppTheme } from "../theme/ThemeProvider";

export function Card({ children }: PropsWithChildren) {
  const { palette } = useAppTheme();
  return <View style={[styles.card, { backgroundColor: palette.surface, shadowColor: palette.shadow }]}>{children}</View>;
}
const styles = StyleSheet.create({
  card: {
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.md,
    shadowOpacity: 1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 7 },
    elevation: 2,
  },
});
