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
  ...props
}: TextInputProps & {
  label: string;
  hint?: string;
  error?: string | null;
  leading?: ReactNode;
}) {
  const { palette } = useAppTheme();
  const [focused, setFocused] = useState(false);
  const { onFocus, onBlur, style: inputStyle, ...inputProps } = props;

  return (
    <View style={styles.group}>
      <Text style={[styles.label, { color: focused ? palette.brand : palette.ink }]}>{label}</Text>
      <View
        style={[
          styles.inputShell,
          multiline && styles.multilineShell,
          {
            backgroundColor: focused ? palette.surface : palette.input,
            borderColor: error ? palette.danger : focused ? palette.brand : palette.borderStrong,
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
          style={[
            styles.input,
            multiline && styles.multilineInput,
            { color: palette.ink },
            inputStyle,
          ]}
        />
      </View>
      {error ? (
        <Text style={[styles.support, { color: palette.danger }]}>{error}</Text>
      ) : hint ? (
        <Text style={[styles.support, { color: palette.muted }]}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: 7 },
  label: { ...typography.caption, fontSize: 12, fontWeight: "900", paddingHorizontal: 2 },
  inputShell: {
    minHeight: controlHeights.lg + 2,
    borderWidth: 1,
    borderRadius: radii.lg,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
  },
  multilineShell: { minHeight: 104, alignItems: "flex-start", paddingVertical: 13 },
  leading: { marginRight: spacing.sm, paddingTop: 1 },
  input: { flex: 1, minHeight: controlHeights.md, paddingVertical: 0, ...typography.body, fontSize: 14 },
  multilineInput: { minHeight: 74, textAlignVertical: "top", paddingTop: 0 },
  support: { ...typography.caption, fontSize: 11, lineHeight: 16, paddingHorizontal: 2 },
});
