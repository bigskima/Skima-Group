import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";

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
    <View style={[styles.container, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      {icon ? <View style={[styles.icon, { backgroundColor: palette.brandSoft }]}>{icon}</View> : null}
      <View style={styles.copy}>
        <Text style={[styles.title, { color: palette.ink }]}>{title}</Text>
        <Text style={[styles.description, { color: palette.muted }]}>{description}</Text>
      </View>
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.xl,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  icon: { width: 60, height: 60, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  copy: { alignItems: "center", gap: 5 },
  title: { ...typography.heading, fontSize: 18, lineHeight: 23, textAlign: "center" },
  description: { ...typography.body, fontSize: 13, lineHeight: 19, textAlign: "center", maxWidth: 420 },
  action: { marginTop: spacing.xs, minWidth: 180, maxWidth: "100%" },
});
