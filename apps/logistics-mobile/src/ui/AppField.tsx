import { useState, type ReactNode } from "react";
import { StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { useAppTheme } from "../theme/ThemeProvider";
import { controlHeights, radii, spacing, typography } from "../theme/tokens";

export function AppField({ label, hint, error, leading, trailing, optional = false, multiline, ...props }: TextInputProps & {
  label: string; hint?: string; error?: string | null; leading?: ReactNode; trailing?: ReactNode; optional?: boolean;
}) {
  const { palette } = useAppTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.group}>
      <View style={styles.labelRow}>
        <Text style={[styles.label, { color: error ? palette.danger : focused ? palette.brand : palette.ink }]}>{label}</Text>
        {optional ? <Text style={[styles.optional, { color: palette.muted }]}>Optional</Text> : null}
      </View>
      <View style={[styles.shell, multiline && styles.multilineShell, {
        backgroundColor: focused ? palette.surface : palette.input,
        borderColor: error ? palette.danger : focused ? palette.brand : palette.borderStrong,
        shadowColor: focused ? palette.brand : palette.shadow,
      }]}>
        {leading ? <View style={styles.leading}>{leading}</View> : null}
        <TextInput
          {...props} multiline={multiline}
          onFocus={(event) => { setFocused(true); props.onFocus?.(event); }}
          onBlur={(event) => { setFocused(false); props.onBlur?.(event); }}
          placeholderTextColor={palette.muted} selectionColor={palette.brand}
          accessibilityLabel={props.accessibilityLabel ?? label}
          style={[styles.input, multiline && styles.multilineInput, { color: palette.ink }, props.style]}
        />
        {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
      </View>
      {error || hint ? <Text accessibilityRole={error ? "alert" : undefined} style={[styles.support, { color: error ? palette.danger : palette.muted }]}>{error ?? hint}</Text> : null}
    </View>
  );
}
const styles = StyleSheet.create({
  group: { gap: 7 },
  labelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 2 },
  label: { ...typography.caption, fontSize: 12, fontWeight: "900", paddingHorizontal: 2 },
  optional: { ...typography.caption, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.6 },
  shell: { minHeight: controlHeights.lg + 2, borderWidth: 1, borderRadius: radii.lg, flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md,
    shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 10, elevation: 1 },
  multilineShell: { minHeight: 104, alignItems: "flex-start", paddingVertical: 13 },
  leading: { marginRight: spacing.sm, paddingTop: 1 },
  trailing: { marginLeft: spacing.sm, minWidth: 34, minHeight: 40, alignItems: "center", justifyContent: "center" },
  input: { flex: 1, minHeight: controlHeights.md, paddingVertical: 0, ...typography.body, fontSize: 14 },
  multilineInput: { minHeight: 74, textAlignVertical: "top", paddingTop: 0 },
  support: { ...typography.caption, fontSize: 11, lineHeight: 16, paddingHorizontal: 2 },
});
