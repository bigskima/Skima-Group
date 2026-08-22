import { router, useLocalSearchParams } from "expo-router";
import {
  CheckCircle2,
  Clock3,
  RefreshCw,
  ShieldAlert,
  WalletCards,
} from "lucide-react-native";
import { RefreshControl, StyleSheet, Text, View } from "react-native";
import { RecordArraySchema, displayStatus, firstString, recordId } from "../api/records";
import { useGatewayQuery } from "../api/gateway";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { AppButton } from "./AppButton";
import { Screen } from "./Screen";
import { ScreenSkeleton } from "./ScreenSkeleton";
import { StatusPill } from "./StatusPill";

const finalSuccess = new Set(["completed", "confirmed", "credited", "succeeded", "successful"]);
const finalFailure = new Set(["cancelled", "failed", "rejected", "expired"]);

export function PaymentReturnScreen() {
  const { palette } = useAppTheme();
  const params = useLocalSearchParams<{ depositRequestId?: string; reference?: string }>();
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
          firstString(item, ["public_reference", "publicReference", "provider_reference", "providerReference"]) === requested,
      )
    : deposits.data?.[0];
  const status = deposit ? (displayStatus(deposit) ?? "pending").toLowerCase() : "pending";
  const succeeded = finalSuccess.has(status);
  const failed = finalFailure.has(status);
  const reference = deposit
    ? firstString(deposit, ["public_reference", "publicReference", "id"]) ?? "Available after confirmation"
    : requested ?? "Payment reference pending";

  return (
    <Screen
      eyebrow="Wallet funding"
      title={succeeded ? "Money added" : failed ? "Payment not completed" : "Checking your payment"}
      subtitle={
        succeeded
          ? "Your SKIMA wallet has received the confirmed top-up."
          : failed
            ? "Your wallet was not credited for this payment attempt."
            : "SKIMA is checking the latest payment confirmation."
      }
      refreshControl={
        <RefreshControl
          refreshing={deposits.isRefetching}
          onRefresh={() => void deposits.refetch()}
          tintColor={palette.brand}
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
              shadows.raised,
              {
                backgroundColor: succeeded ? palette.success : failed ? palette.danger : palette.warning,
              },
            ]}
          >
            <View style={styles.heroIcon}>
              {succeeded ? (
                <CheckCircle2 color="#FFFFFF" size={29} />
              ) : failed ? (
                <ShieldAlert color="#FFFFFF" size={29} />
              ) : (
                <Clock3 color="#FFFFFF" size={29} />
              )}
            </View>
            <View style={styles.heroCopy}>
              <Text style={styles.heroEyebrow}>{succeeded ? "PAYMENT CONFIRMED" : failed ? "PAYMENT ENDED" : "CONFIRMATION IN PROGRESS"}</Text>
              <Text style={styles.heroTitle}>{succeeded ? "Your wallet is ready" : failed ? "No wallet credit was added" : "We are checking the result"}</Text>
              <Text style={styles.heroBody}>
                {succeeded
                  ? "You can return to your wallet and use the updated balance."
                  : failed
                    ? "You can try adding money again whenever you are ready."
                    : "You can safely leave this screen. SKIMA will keep the payment record and your wallet will update only after a successful confirmation."}
              </Text>
            </View>
          </View>

          <View style={[styles.statusCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <View style={styles.statusHead}>
              <View style={[styles.statusIcon, { backgroundColor: palette.brandSoft }]}><WalletCards color={palette.brand} size={21} /></View>
              <View style={styles.statusCopy}>
                <Text style={[styles.statusTitle, { color: palette.ink }]}>Top-up status</Text>
                <Text style={[styles.statusSub, { color: palette.muted }]}>Latest information returned for this SKIMA payment request.</Text>
              </View>
              <StatusPill label={friendly(status)} tone={succeeded ? "success" : failed ? "danger" : "warning"} />
            </View>
            <View style={[styles.divider, { backgroundColor: palette.border }]} />
            <View style={styles.field}>
              <Text style={[styles.label, { color: palette.muted }]}>Reference</Text>
              <Text numberOfLines={2} selectable style={[styles.value, { color: palette.ink }]}>{reference}</Text>
            </View>
            <View style={styles.field}>
              <Text style={[styles.label, { color: palette.muted }]}>Status</Text>
              <Text style={[styles.value, { color: palette.ink }]}>{friendly(status)}</Text>
            </View>
          </View>

          {!succeeded && !failed ? (
            <AppButton
              label="Check payment status"
              fullWidth
              variant="secondary"
              loading={deposits.isRefetching}
              icon={<RefreshCw color={palette.brand} size={18} />}
              onPress={() => void deposits.refetch()}
            />
          ) : null}

          <AppButton
            label={failed ? "Return to wallet" : succeeded ? "Open wallet" : "Go to wallet"}
            fullWidth
            size="lg"
            onPress={() => router.replace("/(customer)/wallet")}
          />

          {failed ? (
            <AppButton
              label="Try adding money again"
              fullWidth
              variant="secondary"
              onPress={() => router.replace("/(customer)/wallet/top-up")}
            />
          ) : null}

          {deposits.error ? (
            <View style={[styles.error, { backgroundColor: palette.dangerSoft }]}>
              <Text accessibilityRole="alert" style={[styles.errorText, { color: palette.danger }]}>{friendlyError(deposits.error, "Payment status is unavailable right now.")}</Text>
            </View>
          ) : null}
        </>
      )}
    </Screen>
  );
}

function friendly(value: string) {
  const labels: Record<string, string> = {
    completed: "Completed",
    confirmed: "Confirmed",
    credited: "Credited",
    succeeded: "Successful",
    successful: "Successful",
    pending: "Confirming",
    processing: "Processing",
    cancelled: "Cancelled",
    failed: "Failed",
    rejected: "Rejected",
    expired: "Expired",
  };
  return labels[value.toLowerCase()] ?? value.replace(/[_-]/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

const styles = StyleSheet.create({
  hero: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, padding: spacing.lg, borderRadius: radii.xl },
  heroIcon: { width: 52, height: 52, borderRadius: 18, backgroundColor: "rgba(255,255,255,.14)", alignItems: "center", justifyContent: "center" },
  heroCopy: { flex: 1, gap: 4 },
  heroEyebrow: { color: "rgba(255,255,255,.72)", ...typography.eyebrow, fontSize: 9 },
  heroTitle: { color: "#FFFFFF", ...typography.heading, fontSize: 20 },
  heroBody: { color: "rgba(255,255,255,.86)", ...typography.caption, lineHeight: 18 },
  statusCard: { gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.lg },
  statusHead: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  statusIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  statusCopy: { flex: 1, minWidth: 0, gap: 2 },
  statusTitle: { ...typography.bodyStrong, fontSize: 14 },
  statusSub: { ...typography.caption, lineHeight: 17 },
  divider: { height: StyleSheet.hairlineWidth },
  field: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md },
  label: { ...typography.caption, flex: 0.34 },
  value: { ...typography.bodyStrong, fontSize: 13, flex: 0.66, textAlign: "right" },
  error: { borderRadius: radii.md, padding: spacing.md },
  errorText: { ...typography.caption, fontWeight: "800", textAlign: "center" },
});
