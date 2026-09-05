import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "../theme/ThemeProvider";
import { spacing, typography } from "../theme/tokens";

export function SectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  const { palette } = useAppTheme();
  return (
    <View style={styles.row}>
      <View style={styles.copy}>
        <Text style={[styles.title, { color: palette.ink }]}>{title}</Text>
        {description ? <Text style={[styles.description, { color: palette.muted }]}>{description}</Text> : null}
      </View>
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, paddingHorizontal: 2, paddingTop: spacing.xs },
  copy: { flex: 1, gap: 4 },
  title: { ...typography.heading, fontSize: 18, lineHeight: 23, letterSpacing: -0.3 },
  description: { ...typography.caption, fontSize: 11, lineHeight: 16, maxWidth: 620 },
  action: { flexShrink: 0 },
});
