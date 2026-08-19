import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  const { palette } = useAppTheme();
  return (
    <View style={[styles.container, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      {icon ? <View style={[styles.icon, { backgroundColor: palette.brandSoft }]}>{icon}</View> : null}
      <Text style={[styles.title, { color: palette.ink }]}>{title}</Text>
      <Text style={[styles.description, { color: palette.muted }]}>{description}</Text>
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  icon: { width: 52, height: 52, borderRadius: 18, alignItems: "center", justifyContent: "center", marginBottom: 2 },
  title: { ...typography.subheading, textAlign: "center" },
  description: { ...typography.body, textAlign: "center", maxWidth: 420 },
  action: { marginTop: spacing.sm, minWidth: 180 },
});
