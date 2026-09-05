import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { ArrowUpRight, Sparkles } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { z } from "zod";

import { useGatewayQuery } from "../api/gateway";
import { spacing, typography } from "../theme/tokens";
import type { AiAssistantWorkspace } from "./AiAssistantScreen";

const AiHomeInsightSchema = z.object({
  kind: z.string(),
  eyebrow: z.string(),
  title: z.string(),
  body: z.string(),
  actionLabel: z.string(),
  estimateOnly: z.boolean().default(false),
}).nullable();

export function AiAssistantLauncher({ workspace }: { readonly workspace: AiAssistantWorkspace }) {
  const insight = useGatewayQuery({
    key: ["ai-home-insight", workspace],
    path: `/runtime/ai/home-insight?workspace=${encodeURIComponent(workspace)}`,
    schema: AiHomeInsightSchema,
    globalError: false,
    refetchInterval: 60000,
  });

  const fallback = workspace === "driver"
    ? {
        eyebrow: "SKIMA INTELLIGENCE",
        title: "Ask SKIMA",
        body: "Ask what to do next or understand your current work.",
        actionLabel: "Ask copilot",
      }
    : workspace === "station"
    ? {
        eyebrow: "SKIMA INTELLIGENCE",
        title: "Ask SKIMA",
        body: "See what needs attention across your station queue.",
        actionLabel: "Ask SKIMA",
      }
    : {
        eyebrow: "SKIMA INTELLIGENCE",
        title: "Ask SKIMA",
        body: "Ask about your refill, cylinder or latest order.",
        actionLabel: "Ask SKIMA",
      };

  const copy = insight.data ?? fallback;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={copy.actionLabel}
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
        <Text style={styles.eyebrow}>{copy.eyebrow}</Text>
        <Text numberOfLines={1} style={styles.title}>{copy.title}</Text>
        <Text numberOfLines={2} style={styles.body}>{copy.body}</Text>
        {"estimateOnly" in copy && copy.estimateOnly ? (
          <Text style={styles.estimate}>History-based estimate</Text>
        ) : null}
      </View>
      <View style={styles.action}>
        <Text numberOfLines={1} style={styles.actionText}>{copy.actionLabel}</Text>
        <View style={styles.arrow}>
          <ArrowUpRight color="#FFFFFF" size={17} strokeWidth={2.5} />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shell: {
    minHeight: 98,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  glow: {
    position: "absolute",
    width: 120,
    height: 120,
    borderRadius: 60,
    right: -28,
    top: -55,
    backgroundColor: "rgba(255,255,255,.09)",
  },
  icon: {
    width: 42,
    height: 42,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,.12)",
  },
  copy: { flex: 1, gap: 1, minWidth: 0 },
  eyebrow: {
    color: "rgba(255,255,255,.64)",
    ...typography.eyebrow,
    fontSize: 8,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "900",
    letterSpacing: -0.3,
  },
  body: {
    color: "rgba(255,255,255,.76)",
    ...typography.caption,
    fontSize: 10,
    lineHeight: 14,
    marginTop: 2,
  },
  estimate: {
    color: "rgba(255,255,255,.58)",
    ...typography.caption,
    fontSize: 8,
    lineHeight: 11,
    marginTop: 3,
    fontWeight: "800",
  },
  action: {
    alignItems: "flex-end",
    gap: 5,
    maxWidth: 86,
  },
  actionText: {
    color: "rgba(255,255,255,.76)",
    ...typography.caption,
    fontSize: 8,
    fontWeight: "900",
    textAlign: "right",
  },
  arrow: {
    width: 32,
    height: 32,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,.12)",
  },
});
