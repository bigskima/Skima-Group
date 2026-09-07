import { LinearGradient } from "expo-linear-gradient";
import { ArrowRight, CheckCircle2, CircleAlert, ShieldCheck } from "lucide-react-native";
import React, { type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";

import { useAppTheme } from "../theme/ThemeProvider";
import { colors, radii, shadows, spacing } from "../theme/tokens";

export function AuthTextField({
  label,
  icon,
  rightAction,
  helper,
  ...props
}: TextInputProps & {
  readonly label: string;
  readonly icon: ReactNode;
  readonly rightAction?: ReactNode;
  readonly helper?: string;
}) {
  const { palette } = useAppTheme();
  const [focused, setFocused] = React.useState(false);

  return (
    <View style={styles.fieldBlock}>
      <Text style={[styles.label, { color: palette.mutedStrong }]}>{label}</Text>
      <View
        style={[
          styles.field,
          shadows.subtle,
          {
            backgroundColor: palette.input,
            borderColor: focused ? palette.brand : palette.border,
          },
          focused && { shadowColor: palette.brand, shadowOpacity: 0.12 },
        ]}
      >
        <View style={[styles.iconTile, { backgroundColor: focused ? palette.brandSoft : palette.soft }]}>
          {icon}
        </View>
        <TextInput
          {...props}
          onBlur={(event) => {
            setFocused(false);
            props.onBlur?.(event);
          }}
          onFocus={(event) => {
            setFocused(true);
            props.onFocus?.(event);
          }}
          placeholderTextColor={palette.muted}
          selectionColor={palette.brand}
          style={[styles.input, { color: palette.ink }, props.style]}
        />
        {rightAction ? <View style={styles.rightAction}>{rightAction}</View> : null}
      </View>
      {helper ? <Text style={[styles.helper, { color: palette.muted }]}>{helper}</Text> : null}
    </View>
  );
}

export function AuthPrimaryButton({
  label,
  pending = false,
  disabled = false,
  onPress,
}: {
  readonly label: string;
  readonly pending?: boolean;
  readonly disabled?: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || pending}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        (disabled || pending) && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <LinearGradient
        colors={[colors.brand, "#F33C4E", colors.brandDark]}
        end={{ x: 1, y: 1 }}
        start={{ x: 0, y: 0 }}
        style={styles.primaryFill}
      >
        {pending ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <>
            <Text style={styles.primaryLabel}>{label}</Text>
            <View style={styles.primaryArrow}>
              <ArrowRight color="#FFFFFF" size={17} strokeWidth={2.5} />
            </View>
          </>
        )}
      </LinearGradient>
    </Pressable>
  );
}

export function AuthFeedback({
  message,
  tone,
}: {
  readonly message: string;
  readonly tone: "error" | "success" | "info";
}) {
  const { palette } = useAppTheme();
  const toneStyle =
    tone === "error"
      ? { backgroundColor: palette.dangerSoft, borderColor: palette.danger + "42", color: palette.danger }
      : tone === "success"
        ? { backgroundColor: palette.successSoft, borderColor: palette.success + "42", color: palette.success }
        : { backgroundColor: palette.soft, borderColor: palette.border, color: palette.mutedStrong };
  const Icon = tone === "error" ? CircleAlert : tone === "success" ? CheckCircle2 : ShieldCheck;

  return (
    <View
      accessibilityRole={tone === "error" ? "alert" : undefined}
      style={[
        styles.feedback,
        {
          backgroundColor: toneStyle.backgroundColor,
          borderColor: toneStyle.borderColor,
        },
      ]}
    >
      <Icon color={toneStyle.color} size={18} strokeWidth={2.2} />
      <Text style={[styles.feedbackText, { color: toneStyle.color }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fieldBlock: { gap: 7 },
  label: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "800",
    letterSpacing: 0.25,
  },
  field: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    borderWidth: 1,
    borderRadius: radii.lg,
    paddingHorizontal: 10,
  },
  iconTile: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
  },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 58,
    paddingVertical: 0,
    fontSize: 15,
    fontWeight: "700",
    backgroundColor: "transparent",
  },
  rightAction: {
    minWidth: 34,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  helper: {
    paddingHorizontal: 2,
    fontSize: 10,
    lineHeight: 15,
    fontWeight: "600",
  },
  primaryButton: {
    minHeight: 60,
    overflow: "hidden",
    borderRadius: radii.lg,
    ...shadows.raised,
  },
  primaryFill: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  primaryLabel: {
    color: "#FFFFFF",
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "900",
    letterSpacing: -0.15,
  },
  primaryArrow: {
    width: 29,
    height: 29,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 15,
    backgroundColor: "rgba(255,255,255,.16)",
  },
  feedback: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: 13,
    paddingVertical: 12,
  },
  feedbackText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 17,
    fontWeight: "700",
  },
  disabled: { opacity: 0.48 },
  pressed: { transform: [{ scale: 0.992 }], opacity: 0.9 },
});
