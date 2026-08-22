import { router } from "expo-router";
import { BookOpen, CheckCircle2, ChevronRight } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useCurrentPolicy, useCurrentPolicyAcceptance } from "../api/policies";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";

export function PolicySummaryCard({
  policyKey,
  href,
  fallbackTitle,
  fallbackSummary,
  applicationId = null,
  roleKey = null,
  requiredForNextAction = false,
}: {
  readonly policyKey: "policy.customer.terms" | "policy.partner.participation";
  readonly href: "/policies/customer-terms" | "/policies/partner-participation";
  readonly fallbackTitle: string;
  readonly fallbackSummary: string;
  readonly applicationId?: string | null;
  readonly roleKey?: string | null;
  readonly requiredForNextAction?: boolean;
}) {
  const { palette } = useAppTheme();
  const policy = useCurrentPolicy(policyKey);
  const acceptance = useCurrentPolicyAcceptance(
    policyKey,
    applicationId,
    policy.data?.published === true,
  );
  const title = policy.data?.title ?? fallbackTitle;
  const summary = policy.data?.summary?.trim() || fallbackSummary;
  const accepted = acceptance.data === true;

  const openPolicy = () => {
    if (href === "/policies/partner-participation" && (applicationId || roleKey)) {
      router.push({
        pathname: href,
        params: {
          ...(applicationId ? { applicationId } : {}),
          ...(roleKey ? { roleKey } : {}),
        },
      } as never);
      return;
    }
    router.push(href as never);
  };

  return (
    <View
      style={[
        styles.card,
        shadows.soft,
        { backgroundColor: palette.surface, borderColor: palette.border },
      ]}
    >
      <View style={[styles.iconBox, { backgroundColor: accepted ? palette.successSoft : palette.brandSoft }]}>
        {accepted ? (
          <CheckCircle2 color={palette.success} size={20} />
        ) : (
          <BookOpen color={palette.brand} size={20} />
        )}
      </View>
      <View style={styles.copy}>
        <View style={styles.eyebrowRow}>
          <Text style={[styles.eyebrow, { color: palette.brand }]}>TERMS & POLICY</Text>
          {accepted ? (
            <View style={[styles.statusPill, { backgroundColor: palette.successSoft }]}>
              <Text style={[styles.statusText, { color: palette.success }]}>Accepted</Text>
            </View>
          ) : requiredForNextAction && policy.data?.published ? (
            <View style={[styles.statusPill, { backgroundColor: palette.warningSoft }]}>
              <Text style={[styles.statusText, { color: palette.warning }]}>Acceptance required</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.title, { color: palette.ink }]}>{title}</Text>
        <Text style={[styles.summary, { color: palette.muted }]}>{summary}</Text>
        {requiredForNextAction && policy.data?.published && !accepted ? (
          <Text style={[styles.requiredText, { color: palette.ink }]}>Read and accept the current version before continuing.</Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          onPress={openPolicy}
          style={({ pressed }) => [styles.learnMore, { opacity: pressed ? 0.65 : 1 }]}
        >
          <Text style={[styles.learnMoreText, { color: palette.brand }]}>{accepted ? "Review terms" : "Learn more"}</Text>
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
  eyebrowRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 7 },
  eyebrow: { ...typography.eyebrow, fontSize: 9 },
  statusPill: { borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { ...typography.caption, fontSize: 9, fontWeight: "900" },
  title: { ...typography.subheading, fontSize: 14 },
  summary: { ...typography.caption, lineHeight: 18 },
  requiredText: { ...typography.caption, lineHeight: 18, fontWeight: "800", marginTop: 2 },
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
