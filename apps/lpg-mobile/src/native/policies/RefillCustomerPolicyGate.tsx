import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useCurrentPolicy, useCurrentPolicyAcceptance } from "../api/policies";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { spacing, typography } from "../theme/tokens";
import { PolicyDocumentScreen } from "../ui/PolicyDocumentScreen";

export function RefillCustomerPolicyGate({ children }: React.PropsWithChildren) {
  const session = useSession();
  const { palette } = useAppTheme();
  const policy = useCurrentPolicy("policy.customer.terms");
  const acceptance = useCurrentPolicyAcceptance(
    "policy.customer.terms",
    null,
    policy.data?.published === true,
  );

  if (session.status !== "authenticated") return <>{children}</>;
  if (policy.isPending || (policy.data?.published === true && acceptance.isPending)) {
    return (
      <View style={[styles.status, { backgroundColor: palette.canvas }]}>
        <ActivityIndicator color={palette.brand} />
        <Text style={[styles.copy, { color: palette.muted }]}>Preparing your current SKIMA Refill terms…</Text>
      </View>
    );
  }
  if (policy.error || acceptance.error || policy.data?.published !== true) {
    return (
      <View style={[styles.status, { backgroundColor: palette.canvas }]}>
        <Text style={[styles.title, { color: palette.ink }]}>Terms temporarily unavailable</Text>
        <Text style={[styles.copy, { color: palette.muted }]}>
          We cannot safely open SKIMA Refill until we can load and verify the current customer terms.
        </Text>
        <Pressable onPress={() => { void policy.refetch(); void acceptance.refetch(); }} style={[styles.retry, { backgroundColor: palette.brand }]}>
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      </View>
    );
  }
  if (acceptance.data === true) return <>{children}</>;
  return <PolicyDocumentScreen policyKey="policy.customer.terms" mandatory />;
}

const styles = StyleSheet.create({
  status: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  title: { ...typography.heading, textAlign: "center" },
  copy: { ...typography.body, fontSize: 13, textAlign: "center", maxWidth: 360 },
  retry: { minHeight: 46, minWidth: 150, paddingHorizontal: 20, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  retryText: { color: "#FFFFFF", fontWeight: "900" },
});
