import { router } from "expo-router";
import { BookOpen, CheckCircle2, ChevronRight, ShieldAlert } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useCurrentPolicy, useCurrentPolicyAcceptance } from "../api/policies";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";

export function PolicySummaryCard({
  policyKey,
  href,
  fallbackTitle,
  fallbackSummary,
}: {
  readonly policyKey: "policy.customer.terms" | "policy.partner.participation";
  readonly href: "/policies/customer-terms" | "/policies/partner-participation";
  readonly fallbackTitle: string;
  readonly fallbackSummary: string;
}) {
  const { palette } = useAppTheme();
  const policy = useCurrentPolicy(policyKey);
  const acceptance = useCurrentPolicyAcceptance(
    policyKey,
    null,
    policy.data?.published === true,
  );
  const title = policy.data?.title ?? fallbackTitle;
  const summary = policy.data?.summary?.trim() || fallbackSummary;
  const accepted = acceptance.data === true;
  const acceptanceKnown = policy.data?.published === true && !acceptance.isPending;

  return (
    <View
      style={[
        styles.card,
        shadows.soft,
        { backgroundColor: palette.surface, borderColor: palette.border },
      ]}
    >
      <View style={[styles.iconBox, { backgroundColor: palette.brandSoft }]}>
        <BookOpen color={palette.brand} size={20} />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.eyebrow, { color: palette.brand }]}>TERMS AND PRIVACY</Text>
        <Text style={[styles.title, { color: palette.ink }]}>{title}</Text>
        <Text style={[styles.summary, { color: palette.muted }]}>{summary}</Text>

        {acceptanceKnown ? (
          <View
            style={[
              styles.status,
              {
                backgroundColor: accepted ? palette.successSoft : palette.warningSoft,
                borderColor: accepted ? palette.success : palette.warning,
              },
            ]}
          >
            {accepted ? (
              <CheckCircle2 color={palette.success} size={15} />
            ) : (
              <ShieldAlert color={palette.warning} size={15} />
            )}
            <Text
              style={[
                styles.statusText,
                { color: accepted ? palette.success : palette.ink },
              ]}
            >
              {accepted ? "Current terms accepted" : "Acceptance required before continuing"}
            </Text>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(href as never)}
          style={({ pressed }) => [styles.learnMore, { opacity: pressed ? 0.65 : 1 }]}
        >
          <Text style={[styles.learnMoreText, { color: palette.brand }]}>Learn more</Text>
          <ChevronRight color={palette.brand} size={16} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.lg,
    padding: spacing.md,
  },
  iconBox: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { flex: 1, minWidth: 0, gap: 4 },
  eyebrow: { ...typography.eyebrow, fontSize: 9 },
  title: { ...typography.subheading, fontSize: 14 },
  summary: { ...typography.caption, lineHeight: 18 },
  status: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.pill,
    paddingHorizontal: 9,
    paddingVertical: 5,
    marginTop: 5,
  },
  statusText: { ...typography.caption, fontWeight: "800", fontSize: 10 },
  learnMore: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    marginTop: 4,
    paddingVertical: 4,
  },
  learnMoreText: { ...typography.caption, fontWeight: "900" },
});
