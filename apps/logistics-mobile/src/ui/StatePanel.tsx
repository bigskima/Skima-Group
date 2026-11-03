import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";
import { AppButton } from "./AppButton";

export function StatePanel({ title, description, icon, retry }: {
  title: string; description: string; icon?: ReactNode; retry?: () => void;
}) {
  const { palette } = useAppTheme();
  return (
    <View style={[styles.panel, { borderColor: palette.border, backgroundColor: palette.surface }]}>
      {icon ? <View style={[styles.icon, { backgroundColor: palette.brandSoft }]}>{icon}</View> : null}
      <Text style={[styles.title, { color: palette.ink }]}>{title}</Text>
      <Text style={[styles.description, { color: palette.muted }]}>{description}</Text>
      {retry ? <AppButton label="Try again" variant="secondary" onPress={retry} /> : null}
    </View>
  );
}
const styles = StyleSheet.create({
  panel: { alignItems: "center", gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.xl },
  icon: { width: 56, height: 56, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  title: { ...typography.heading, fontSize: 18, textAlign: "center" },
  description: { ...typography.body, fontSize: 13, lineHeight: 19, textAlign: "center", maxWidth: 420 },
});
