import { router } from "expo-router";
import { ChevronRight, Sparkles } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";
import type { AiAssistantWorkspace } from "./AiAssistantScreen";

export function AiContextAction({
  workspace,
  prompt,
  label = "Explain with Matty",
  detail = "Opens Matty with this question ready. Nothing is sent until you choose Send.",
}: {
  readonly workspace: AiAssistantWorkspace;
  readonly prompt: string;
  readonly label?: string;
  readonly detail?: string;
}) {
  const { palette } = useAppTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() =>
        router.push(
          (`/(${workspace})/assistant?prompt=${encodeURIComponent(prompt)}`) as never,
        )
      }
      style={({ pressed }) => [
        styles.shell,
        {
          backgroundColor: pressed ? palette.brandSoft : palette.surface,
          borderColor: palette.border,
          opacity: pressed ? 0.9 : 1,
        },
      ]}
    >
      <View style={[styles.icon, { backgroundColor: palette.brandSoft }]}>
        <Sparkles color={palette.brand} size={17} />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.label, { color: palette.ink }]}>{label}</Text>
        <Text numberOfLines={2} style={[styles.detail, { color: palette.muted }]}>
          {detail}
        </Text>
      </View>
      <ChevronRight color={palette.muted} size={17} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shell: {
    alignItems: "center",
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 58,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  icon: {
    alignItems: "center",
    borderRadius: 11,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  copy: {
    flex: 1,
    gap: 2,
  },
  label: {
    ...typography.bodyStrong,
    fontSize: 12,
  },
  detail: {
    ...typography.caption,
    fontSize: 9,
    lineHeight: 13,
  },
});
