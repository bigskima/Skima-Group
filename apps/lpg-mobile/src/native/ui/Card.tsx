import type { PropsWithChildren, ReactNode } from "react";
import { StyleSheet, Text, View, type ViewStyle } from "react-native";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";

export function Card({
  children,
  variant = "default",
  padding = "md",
  eyebrow,
  title,
  description,
  action,
}: PropsWithChildren<{
  variant?: "default" | "subtle" | "outline" | "elevated" | "brandSoft" | "success" | "warning" | "danger";
  padding?: "sm" | "md" | "lg";
  eyebrow?: string;
  title?: string;
  description?: string;
  action?: ReactNode;
}>) {
  const { palette } = useAppTheme();

  const backgroundColor =
    variant === "subtle"
      ? palette.surfaceSubtle
      : variant === "brandSoft"
        ? palette.brandSofter
        : variant === "success"
          ? palette.successSoft
          : variant === "warning"
            ? palette.warningSoft
            : variant === "danger"
              ? palette.dangerSoft
        : palette.surface;

  const accentColor = variant === "success"
    ? palette.success
    : variant === "warning"
      ? palette.warning
      : variant === "danger"
        ? palette.danger
        : variant === "brandSoft"
          ? palette.brand
          : null;

  const cardStyle: ViewStyle = {
    backgroundColor,
    borderColor: accentColor ?? (variant === "outline" ? palette.borderStrong : palette.border),
  };

  return (
    <View
      style={[
        styles.card,
        variant === "default" && shadows.soft,
        variant === "elevated" && shadows.raised,
        padding === "sm" && styles.paddingSm,
        padding === "md" && styles.paddingMd,
        padding === "lg" && styles.paddingLg,
        cardStyle,
      ]}
    >
      {eyebrow || title || description || action ? (
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            {eyebrow ? <Text style={[styles.eyebrow, { color: accentColor ?? palette.brand }]}>{eyebrow}</Text> : null}
            {title ? <Text style={[styles.title, { color: palette.ink }]}>{title}</Text> : null}
            {description ? <Text style={[styles.description, { color: palette.muted }]}>{description}</Text> : null}
          </View>
          {action ? <View style={styles.action}>{action}</View> : null}
        </View>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: radii.xl,
    gap: 14,
  },
  paddingSm: { padding: 13 },
  paddingMd: { padding: 17 },
  paddingLg: { padding: spacing.lg },
  header: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md },
  headerCopy: { flex: 1, gap: 4 },
  eyebrow: { ...typography.eyebrow, textTransform: "uppercase" },
  title: { ...typography.sectionTitle },
  description: { ...typography.caption, maxWidth: 560 },
  action: { flexShrink: 0 },
});
