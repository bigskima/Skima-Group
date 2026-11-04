import { router, useLocalSearchParams, Redirect } from "expo-router";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useMemo } from "react";
import { useLogisticsQuery, asString } from "../api/logistics";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii } from "../theme/tokens";
import { Screen } from "../ui/Screen";
import { StatePanel } from "../ui/StatePanel";

const SUCCESS = new Set(["completed", "confirmed", "credited", "succeeded", "successful"]);
const FAILED = new Set(["cancelled", "failed", "rejected", "expired"]);
export function PaymentReturnScreen() {
  const { palette } = useAppTheme();
  const { status } = useSession();
  const params = useLocalSearchParams<{ depositRequestId?: string | string[]; depositId?: string | string[]; reference?: string | string[] }>();
  const requested = Array.isArray(params.depositRequestId) ? params.depositRequestId[0] : params.depositRequestId
    ?? (Array.isArray(params.depositId) ? params.depositId[0] : params.depositId)
    ?? (Array.isArray(params.reference) ? params.reference[0] : params.reference);
  const deposits = useLogisticsQuery(["payment-return-deposits"], "/runtime/payments/deposits?scope=customer", true, 3000);
  const wallets = useLogisticsQuery(["customer-wallets"], "/runtime/wallets", true, 30000);
  const balances = useLogisticsQuery(["customer-wallet-balances"], "/runtime/wallet-balances", true, 15000);
  const deposit = useMemo(() => {
    const rows = deposits.data ?? [];
    if (requested) {
      const exact = rows.find(item => asString(item, "id", "deposit_id", "depositId", "deposit_request_id", "depositRequestId", "public_reference", "publicReference") === requested);
      if (exact) return exact;
    }
    return [...rows].sort((a,b) => (Date.parse(asString(b, "created_at", "initialized_at") ?? "") || 0) - (Date.parse(asString(a, "created_at", "initialized_at") ?? "") || 0))[0] ?? null;
  }, [deposits.data, requested]);
  const paymentStatus = (asString(deposit, "status", "deposit_status", "payment_status") ?? "pending").toLowerCase();
  const succeeded = SUCCESS.has(paymentStatus);
  const failed = FAILED.has(paymentStatus);

  if (status === "loading") return <View style={[styles.loading, { backgroundColor: palette.canvas }]}><ActivityIndicator color={palette.brand} size="large" /></View>;
  if (status !== "authenticated") return <Redirect href="/(auth)/sign-in" />;

  async function refresh() {
    await Promise.all([deposits.refetch(), wallets.refetch(), balances.refetch()]);
  }
  return <Screen title="Payment status" denseHeader>
    {deposits.isPending ? <View style={styles.loading}><ActivityIndicator color={palette.brand} /></View> :
      deposits.error ? <StatePanel title="Payment status unavailable" description="Your payment may still be processing. Refresh to check the provider confirmation." retry={() => void refresh()} /> :
      <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <Text style={[styles.title, { color: succeeded ? palette.success : failed ? palette.danger : palette.ink }]}>{succeeded ? "Payment confirmed" : failed ? "Payment not completed" : "Waiting for payment confirmation"}</Text>
        <Text style={[styles.description, { color: palette.muted }]}>{succeeded
          ? "The payment provider confirmed your deposit. Refreshing the shared SKIMA customer wallet will show the updated balance."
          : failed
            ? "This payment session was not completed. Your wallet is only credited for provider-confirmed payments."
            : "Keep this screen open while SKIMA checks the payment provider. Your wallet is credited only after confirmation."}</Text>
        <View style={[styles.statusPill, { backgroundColor: succeeded ? palette.successSoft : failed ? palette.dangerSoft : palette.brandSoft }]}><Text style={{ color: succeeded ? palette.success : failed ? palette.danger : palette.brand, fontSize: 11, fontWeight: "900" }}>{paymentStatus.toUpperCase()}</Text></View>
        {deposit ? <Text style={[styles.reference, { color: palette.muted }]}>Reference: {asString(deposit, "public_reference", "publicReference", "id") ?? "Pending"}</Text> : null}
        {!succeeded && !failed ? <View style={styles.polling}><ActivityIndicator color={palette.brand} size="small" /><Text style={[styles.description, { color: palette.muted }]}>Checking automatically every few seconds…</Text></View> : null}
        <Pressable onPress={() => void refresh()} style={[styles.button, { backgroundColor: palette.brand }]}><Text style={styles.buttonText}>Refresh payment and wallet</Text></Pressable>
        <Pressable onPress={() => router.replace("/(customer)/wallet" as never)} style={styles.link}><Text style={{ color: palette.brand, fontSize: 11, fontWeight: "900" }}>Return to SKIMA Wallet</Text></Pressable>
      </View>}
  </Screen>;
}
const styles = StyleSheet.create({
  loading: { minHeight: 180, alignItems: "center", justifyContent: "center" },
  card: { borderWidth: 1, borderRadius: radii.lg, padding: 16, gap: 12 },
  title: { fontSize: 17, fontWeight: "900" },
  description: { fontSize: 11, lineHeight: 17 },
  statusPill: { alignSelf: "flex-start", borderRadius: radii.pill, paddingHorizontal: 11, paddingVertical: 7 },
  reference: { fontSize: 10, fontWeight: "700" },
  polling: { flexDirection: "row", alignItems: "center", gap: 8 },
  button: { minHeight: 44, borderRadius: radii.md, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  buttonText: { color: "#fff", fontSize: 11, fontWeight: "900" },
  link: { paddingVertical: 6, alignItems: "center" },
});
