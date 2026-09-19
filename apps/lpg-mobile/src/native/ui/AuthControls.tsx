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
          focused && styles.fieldFocused,
        ]}
      >
        <View style={[styles.iconWrap, focused && { backgroundColor: palette.brandSoft }]}>
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
              <ArrowRight color="#FFFFFF" size={17} strokeWidth={2.6} />
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
      ? {
          backgroundColor: palette.dangerSoft,
          borderColor: palette.danger + "42",
          color: palette.danger,
        }
      : tone === "success"
        ? {
            backgroundColor: palette.successSoft,
            borderColor: palette.success + "42",
            color: palette.success,
          }
        : {
            backgroundColor: palette.soft,
            borderColor: palette.border,
            color: palette.mutedStrong,
          };
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
    paddingHorizontal: 2,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  field: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 12,
  },
  fieldFocused: {
    shadowColor: colors.brand,
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  iconWrap: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 11,
  },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 56,
    paddingVertical: 0,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
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
    minHeight: 58,
    overflow: "hidden",
    borderRadius: 18,
    ...shadows.raised,
  },
  primaryFill: {
    minHeight: 58,
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
    letterSpacing: -0.18,
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
  disabled: { opacity: 0.46 },
  pressed: { transform: [{ scale: 0.992 }], opacity: 0.92 },
});
