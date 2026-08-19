import type { ReactNode } from "react";
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
  return (
    <View style={styles.group}>
      <Text style={[styles.label, { color: palette.ink }]}>{label}</Text>
      <View
        style={[
          styles.inputShell,
          multiline && styles.multilineShell,
          {
            backgroundColor: palette.input,
            borderColor: error ? palette.danger : palette.borderStrong,
          },
        ]}
      >
        {leading ? <View style={styles.leading}>{leading}</View> : null}
        <TextInput
          {...props}
          multiline={multiline}
          placeholderTextColor={palette.muted}
          style={[
            styles.input,
            multiline && styles.multilineInput,
            { color: palette.ink },
            props.style,
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
  label: { ...typography.caption, fontSize: 13, fontWeight: "800" },
  inputShell: {
    minHeight: controlHeights.lg,
    borderWidth: 1,
    borderRadius: radii.md,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
  },
  multilineShell: { minHeight: 94, alignItems: "flex-start", paddingVertical: 12 },
  leading: { marginRight: spacing.sm, paddingTop: 1 },
  input: { flex: 1, minHeight: controlHeights.md, paddingVertical: 0, ...typography.body },
  multilineInput: { minHeight: 68, textAlignVertical: "top", paddingTop: 0 },
  support: { ...typography.caption, paddingHorizontal: 2 },
});
