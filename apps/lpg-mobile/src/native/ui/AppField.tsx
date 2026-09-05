import { useState, type ReactNode } from "react";
import { StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { useAppTheme } from "../theme/ThemeProvider";
import { controlHeights, radii, spacing, typography } from "../theme/tokens";

export function AppField({
  label,
  hint,
  error,
  leading,
  multiline,
  optional = false,
  showCharacterCount = false,
  ...props
}: TextInputProps & {
  label: string;
  hint?: string;
  error?: string | null;
  leading?: ReactNode;
  optional?: boolean;
  showCharacterCount?: boolean;
}) {
  const { palette } = useAppTheme();
  const [focused, setFocused] = useState(false);
  const { onFocus, onBlur, style: inputStyle, ...inputProps } = props;

  return (
    <View style={styles.group}>
      <View style={styles.labelRow}>
        <Text style={[styles.label, { color: error ? palette.danger : focused ? palette.brand : palette.ink }]}>{label}</Text>
        {optional ? <Text style={[styles.optional, { color: palette.muted }]}>Optional</Text> : null}
      </View>
      <View
        style={[
          styles.inputShell,
          multiline && styles.multilineShell,
          styles.inputShadow,
          {
            backgroundColor: focused ? palette.surface : palette.input,
            borderColor: error ? palette.danger : focused ? palette.brand : palette.borderStrong,
            shadowColor: focused ? palette.brand : palette.shadow,
          },
        ]}
      >
        {leading ? <View style={styles.leading}>{leading}</View> : null}
        <TextInput
          {...inputProps}
          multiline={multiline}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          placeholderTextColor={palette.muted}
          selectionColor={palette.brand}
          accessibilityLabel={props.accessibilityLabel ?? label}
          style={[
            styles.input,
            multiline && styles.multilineInput,
            { color: palette.ink },
            inputStyle,
          ]}
        />
      </View>
      {error || hint || (showCharacterCount && props.maxLength) ? (
        <View style={styles.supportRow}>
          {error ? <Text accessibilityRole="alert" style={[styles.support, { color: palette.danger }]}>{error}</Text>
            : hint ? <Text style={[styles.support, { color: palette.muted }]}>{hint}</Text> : <View />}
          {showCharacterCount && props.maxLength ? (
            <Text style={[styles.counter, { color: palette.muted }]}>{String(props.value ?? "").length}/{props.maxLength}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: 7 },
  labelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 2 },
  label: { ...typography.caption, fontSize: 12, fontWeight: "900", paddingHorizontal: 2 },
  optional: { ...typography.caption, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.6 },
  inputShell: {
    minHeight: controlHeights.lg + 2,
    borderWidth: 1,
    borderRadius: radii.lg,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
  },
  inputShadow: { shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 10, elevation: 1 },
  multilineShell: { minHeight: 104, alignItems: "flex-start", paddingVertical: 13 },
  leading: { marginRight: spacing.sm, paddingTop: 1 },
  input: { flex: 1, minHeight: controlHeights.md, paddingVertical: 0, ...typography.body, fontSize: 14 },
  multilineInput: { minHeight: 74, textAlignVertical: "top", paddingTop: 0 },
  support: { ...typography.caption, fontSize: 11, lineHeight: 16, paddingHorizontal: 2 },
  supportRow: { minHeight: 16, flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.sm },
  counter: { ...typography.caption, fontSize: 10, flexShrink: 0 },
});
