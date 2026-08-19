import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
} from "react-native";
import { useAppTheme } from "../theme/ThemeProvider";
import { controlHeights, radii, spacing, typography } from "../theme/tokens";

export function AppButton({
  label,
  icon,
  trailingIcon,
  variant = "primary",
  size = "md",
  loading = false,
  fullWidth = false,
  disabled,
  ...props
}: Omit<PressableProps, "children" | "style"> & {
  label: string;
  icon?: ReactNode;
  trailingIcon?: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  fullWidth?: boolean;
}) {
  const { palette } = useAppTheme();
  const inactive = Boolean(disabled || loading);

  const backgroundColor =
    variant === "primary"
      ? palette.brand
      : variant === "danger"
        ? palette.danger
        : variant === "secondary"
          ? palette.surface
          : "transparent";
  const borderColor =
    variant === "primary"
      ? palette.brand
      : variant === "danger"
        ? palette.danger
        : variant === "secondary"
          ? palette.borderStrong
          : "transparent";
  const textColor =
    variant === "primary" || variant === "danger"
      ? "#FFFFFF"
      : variant === "ghost"
        ? palette.brand
        : palette.ink;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={inactive}
      {...props}
      style={({ pressed }) => [
        styles.base,
        size === "sm" && styles.sm,
        size === "md" && styles.md,
        size === "lg" && styles.lg,
        fullWidth && styles.fullWidth,
        { backgroundColor, borderColor, opacity: inactive ? 0.48 : pressed ? 0.82 : 1 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} size="small" />
      ) : (
        <View style={styles.content}>
          {icon ? <View style={styles.icon}>{icon}</View> : null}
          <Text numberOfLines={1} style={[styles.label, { color: textColor }]}>{label}</Text>
          {trailingIcon ? <View style={styles.icon}>{trailingIcon}</View> : null}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: 1,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  sm: { minHeight: controlHeights.sm },
  md: { minHeight: controlHeights.md },
  lg: { minHeight: controlHeights.lg, paddingHorizontal: spacing.lg },
  fullWidth: { width: "100%" },
  content: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm },
  icon: { alignItems: "center", justifyContent: "center" },
  label: { ...typography.bodyStrong, fontSize: 14 },
});
