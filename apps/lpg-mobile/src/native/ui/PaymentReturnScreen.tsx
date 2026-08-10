import { router, useLocalSearchParams } from "expo-router";
import {
  CheckCircle2,
  Clock3,
  RefreshCw,
  ShieldAlert,
} from "lucide-react-native";
import {
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  RecordArraySchema,
  displayStatus,
  firstString,
  recordId,
} from "../api/records";
import { useGatewayQuery } from "../api/gateway";
import { colors, radii, spacing } from "../theme/tokens";
import { Card } from "./Card";
import { Screen } from "./Screen";
import { ScreenSkeleton } from "./ScreenSkeleton";

const finalSuccess = new Set([
  "completed",
  "confirmed",
  "credited",
  "succeeded",
  "successful",
]);
const finalFailure = new Set(["cancelled", "failed", "rejected", "expired"]);

export function PaymentReturnScreen() {
  const params = useLocalSearchParams<{
    depositRequestId?: string;
    reference?: string;
  }>();
  const deposits = useGatewayQuery({
    key: ["deposits", "payment-return"],
    path: "/runtime/payments/deposits",
    schema: RecordArraySchema,
    refetchInterval: 5000,
  });
  const requested = params.depositRequestId ?? params.reference ?? null;
  const deposit = requested
    ? (deposits.data ?? []).find(
        (item) =>
          recordId(item) === requested ||
          firstString(item, [
            "public_reference",
            "publicReference",
            "provider_reference",
            "providerReference",
          ]) === requested,
      )
    : deposits.data?.[0];
  const status = deposit
    ? (displayStatus(deposit) ?? "pending").toLowerCase()
    : "pending";
  const succeeded = finalSuccess.has(status);
  const failed = finalFailure.has(status);
  return (
    <Screen
      eyebrow="Secure payment return"
      title={
        succeeded
          ? "Funds confirmed"
          : failed
            ? "Payment not completed"
            : "Confirming your payment"
      }
      refreshControl={
        <RefreshControl
          refreshing={deposits.isRefetching}
          onRefresh={() => void deposits.refetch()}
          tintColor={colors.brand}
        />
      }
    >
      {deposits.isPending ? (
        <ScreenSkeleton cards={2} />
      ) : (
        <>
          <View
            style={[
              styles.hero,
              succeeded
                ? styles.success
                : failed
                  ? styles.failure
                  : styles.pending,
            ]}
          >
            {succeeded ? (
              <CheckCircle2 color="white" size={34} />
            ) : failed ? (
              <ShieldAlert color="white" size={34} />
            ) : (
              <Clock3 color="white" size={34} />
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.heroTitle}>
                {succeeded
                  ? "Backend credit confirmed"
                  : failed
                    ? "Provider result recorded"
                    : "Waiting for backend verification"}
              </Text>
              <Text style={styles.heroBody}>
                {succeeded
                  ? "Your wallet balance will reflect the authoritative ledger entry."
                  : failed
                    ? "No wallet credit is shown unless the backend confirms it."
                    : "The payment provider and secure webhook must confirm the deposit. This screen never marks a payment successful locally."}
              </Text>
            </View>
          </View>
          <Card>
            <Text style={styles.label}>Deposit reference</Text>
            <Text style={styles.value}>
              {deposit
                ? (firstString(deposit, [
                    "public_reference",
                    "publicReference",
                    "id",
                  ]) ?? "Available after confirmation")
                : (requested ?? "Waiting for provider return data")}
            </Text>
            <Text style={styles.label}>Backend status</Text>
            <Text
              style={[
                styles.status,
                succeeded && styles.statusSuccess,
                failed && styles.statusFailure,
              ]}
            >
              {status.replace(/[_-]/g, " ")}
            </Text>
          </Card>
          {!succeeded && !failed ? (
            <Pressable
              onPress={() => void deposits.refetch()}
              style={styles.secondary}
            >
              <RefreshCw color={colors.brand} size={18} />
              <Text style={styles.secondaryText}>Check payment status</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => router.replace("/(customer)/wallet")}
            style={styles.primary}
          >
            <Text style={styles.primaryText}>Return to wallet</Text>
          </Pressable>
          {deposits.error ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {deposits.error.message}
            </Text>
          ) : null}
        </>
      )}
    </Screen>
  );
}
const styles = StyleSheet.create({
  hero: {
    minHeight: 150,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.xl,
    borderRadius: radii.lg,
  },
  success: { backgroundColor: colors.success },
  failure: { backgroundColor: colors.danger },
  pending: { backgroundColor: "#7A5200" },
  heroTitle: { color: "white", fontSize: 21, fontWeight: "900" },
  heroBody: { color: "white", lineHeight: 20, marginTop: 5 },
  label: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  value: { color: colors.ink, fontSize: 16, fontWeight: "800" },
  status: {
    color: "#7A5200",
    fontSize: 17,
    fontWeight: "900",
    textTransform: "capitalize",
  },
  statusSuccess: { color: colors.success },
  statusFailure: { color: colors.danger },
  primary: {
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: colors.brand,
  },
  primaryText: { color: "white", fontWeight: "900" },
  secondary: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: radii.md,
  },
  secondaryText: { color: colors.brand, fontWeight: "900" },
  error: { color: colors.danger },
});
