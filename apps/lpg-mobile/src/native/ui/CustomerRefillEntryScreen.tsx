import { RefreshCcw, ShieldCheck } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";

import { useCurrentPolicy, useCurrentPolicyAcceptance } from "../api/policies";
import { useAppTheme } from "../theme/ThemeProvider";
import { spacing, typography } from "../theme/tokens";
import { AppButton } from "./AppButton";
import { NewRefillScreen } from "./NewRefillScreen";
import { PolicySummaryCard } from "./PolicySummaryCard";
import { Screen } from "./Screen";

export function CustomerRefillEntryScreen() {
  const { palette } = useAppTheme();
  const policy = useCurrentPolicy("policy.customer.terms");
  const acceptance = useCurrentPolicyAcceptance(
    "policy.customer.terms",
    null,
    policy.data?.published === true,
  );

  if (policy.data?.published !== true) {
    return <NewRefillScreen />;
  }

  if (acceptance.data === true) {
    return <NewRefillScreen />;
  }

  return (
    <Screen
      eyebrow="Before your first order"
      title="Review the current customer terms"
      subtitle="Review and accept the terms before your next order. We’ll let you know when an update needs your attention."
    >
      <PolicySummaryCard
        policyKey="policy.customer.terms"
        href="/policies/customer-terms"
        fallbackTitle="SKIMA Customer Terms of Service"
        fallbackSummary="Review the key rules for LPG orders, pricing, pickup and return, refill quantity, safety, refunds, disputes and your customer rights."
      />

      <View style={[styles.note, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
        <ShieldCheck color={palette.brand} size={20} />
        <Text style={[styles.noteText, { color: palette.muted }]}>
          Tap Learn more to read the full terms in SKIMA.
        </Text>
      </View>

      {policy.isError || acceptance.isError ? (
        <AppButton
          label="Check acceptance again"
          variant="secondary"
          icon={<RefreshCcw color={palette.brand} size={17} />}
          onPress={() => {
            void policy.refetch();
            void acceptance.refetch();
          }}
        />
      ) : (
        <AppButton
          label="I've accepted — continue"
          variant="secondary"
          loading={policy.isPending || acceptance.isPending || acceptance.isFetching}
          onPress={() => void acceptance.refetch()}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  note: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: spacing.md,
  },
  noteText: {
    flex: 1,
    ...typography.caption,
    lineHeight: 19,
  },
});
