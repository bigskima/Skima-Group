import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { ArrowUpRight, Sparkles } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { spacing, typography } from "../theme/tokens";
import type { AiAssistantWorkspace } from "./AiAssistantScreen";

export function AiAssistantLauncher({ workspace }: { readonly workspace: AiAssistantWorkspace }) {
  const copy = workspace === "driver"
    ? "Ask what to do next or understand your current work."
    : workspace === "station"
    ? "See what needs attention across your station queue."
    : "Ask about your refill, cylinder or latest order.";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open Ask SKIMA"
      onPress={() => router.push(("/(" + workspace + ")/assistant") as never)}
      style={({ pressed }) => [styles.shell, { opacity: pressed ? 0.93 : 1 }]}
    >
      <LinearGradient
        colors={["#23121A", "#7F1020"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.glow} />
      <View style={styles.icon}>
        <Sparkles color="#FFFFFF" size={19} />
      </View>
      <View style={styles.copy}>
        <Text style={styles.eyebrow}>SKIMA INTELLIGENCE</Text>
        <Text style={styles.title}>Ask SKIMA</Text>
        <Text numberOfLines={2} style={styles.body}>{copy}</Text>
      </View>
      <View style={styles.arrow}>
        <ArrowUpRight color="#FFFFFF" size={18} strokeWidth={2.5} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shell: {
    minHeight: 94,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  glow: { position: "absolute", width: 120, height: 120, borderRadius: 60, right: -28, top: -55, backgroundColor: "rgba(255,255,255,.09)" },
  icon: { width: 42, height: 42, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,.12)" },
  copy: { flex: 1, gap: 1 },
  eyebrow: { color: "rgba(255,255,255,.64)", ...typography.eyebrow, fontSize: 8 },
  title: { color: "#FFFFFF", fontSize: 17, lineHeight: 21, fontWeight: "900", letterSpacing: -0.3 },
  body: { color: "rgba(255,255,255,.76)", ...typography.caption, fontSize: 10, lineHeight: 14, marginTop: 2 },
  arrow: { width: 34, height: 34, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,.12)" },
});
