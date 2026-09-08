import { router, useLocalSearchParams } from "expo-router";
import { CheckCircle2, ShieldCheck, WalletCards } from "lucide-react-native";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { domainQueries } from "../api/domains";
import { useGatewayMutation } from "../api/gateway";
import {
  ActionResponseSchema,
  displayReference,
  displayStatus,
  firstNumber,
  firstString,
} from "../api/records";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { selectWorkspaceWallet } from "../utilities/financeWallet";
import { idempotencyKey } from "../utilities/idempotency";
import { AppButton } from "./AppButton";
import { EmptyState } from "./EmptyState";
import { Screen } from "./Screen";
import { StatusPill } from "./StatusPill";

const PAID_PAYMENT_STATES = new Set([
  "reserved",
  "payment_reserved",
  "paid",
  "settled",
]);

export function CustomerOrderPaymentScreen() {
  const { palette } = useAppTheme();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const orderId = typeof id === "string" ? id : null;
  const orders = domainQueries.orders();
  const wallets = domainQueries.wallets();
  const reserve = useGatewayMutation({
    path: "/lpg/orders/reserve-payment",
    schema: ActionResponseSchema,
    invalidate: [["orders"], ["orders", "active"], ["wallets"]],
  });

  const order = (orders.data ?? []).find((item) => firstString(item, ["id"]) === orderId) ?? null;
  const wallet = selectWorkspaceWallet(wallets.data ?? [], "customer");
  const walletId = firstString(wallet, ["wallet_id", "walletId", "id"]);
  const currency =
    firstString(order, ["currency_code", "currencyCode"]) ??
    firstString(wallet, ["currency_code", "currencyCode"]) ??
    "NGN";
  const total = firstNumber(order, [
    "total_amount",
    "totalAmount",
    "quoted_total",
    "quotedTotal",
  ]);
  const available = firstNumber(wallet, [
    "available_balance",
    "availableBalance",
    "balance",
  ]) ?? 0;
  const paymentStatus = normalizeStatus(
    firstString(order, ["payment_status", "paymentStatus"]) ??
      displayStatus(order) ??
      "pending",
  );
  const paid = PAID_PAYMENT_STATES.has(paymentStatus);
  const enoughBalance = total === null || available >= total;

  const continuePayment = async () => {
    if (!orderId || !walletId || paid) return;
    try {
      await reserve.mutateAsync({
        lpgOrderId: orderId,
        customerWalletId: walletId,
        source: "skima.lpg.mobile.resume-payment",
        idempotencyKey: idempotencyKey("reserve-order-payment", orderId),
      });
      await Promise.all([orders.refetch(), wallets.refetch()]);
      router.replace(`/(customer)/orders/${orderId}` as never);
    } catch {
      // React Query keeps the mutation error so the saved-order payment screen
      // can explain the failure without deleting or duplicating the order.
    }
  };

  return (
    <Screen
      eyebrow="Order payment"
      title={order ? displayReference(order) ?? "Complete payment" : "Complete payment"}
      subtitle="Resume payment for an order you already created. SKIMA will not create a duplicate refill."
      action={<AppButton label="Back" variant="ghost" size="sm" onPress={() => router.back()} />}
    >
      {orders.isPending || wallets.isPending ? (
        <View style={styles.loading}>
          <ActivityIndicator color={palette.brand} />
          <Text style={[styles.caption, { color: palette.muted }]}>Loading the saved order and wallet…</Text>
        </View>
      ) : orders.error || !order ? (
        <EmptyState
          title="This order could not be loaded"
          description="Return to Orders and refresh before trying payment again."
          action={<AppButton label="Back to orders" onPress={() => router.replace("/(customer)/orders" as never)} />}
        />
      ) : paid ? (
        <View style={[styles.successCard, shadows.soft, { backgroundColor: palette.successSoft, borderColor: palette.success }]}>
          <CheckCircle2 color={palette.success} size={26} />
          <View style={styles.flexCopy}>
            <Text style={[styles.title, { color: palette.ink }]}>Payment already confirmed</Text>
            <Text style={[styles.caption, { color: palette.mutedStrong }]}>This refill is already funded. You can return to the order and continue tracking it.</Text>
          </View>
          <AppButton label="Open order" onPress={() => router.replace(`/(customer)/orders/${orderId}` as never)} />
        </View>
      ) : (
        <>
          <View style={[styles.hero, shadows.raised, { backgroundColor: palette.brand }]}>
            <View style={styles.heroTop}>
              <View style={styles.flexCopy}>
                <Text style={styles.heroEyebrow}>PAYMENT NEEDED</Text>
                <Text adjustsFontSizeToFit numberOfLines={1} style={styles.heroValue}>
                  {total === null ? "Amount pending" : money(total, currency)}
                </Text>
              </View>
              <View style={styles.heroIcon}>
                <WalletCards color="#FFFFFF" size={25} />
              </View>
            </View>
            <Text style={styles.heroBody}>This payment funds the refill order already saved in SKIMA.</Text>
          </View>

          <View style={[styles.walletCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <View style={styles.walletHead}>
              <View style={[styles.walletIcon, { backgroundColor: palette.brandSoft }]}>
                <ShieldCheck color={palette.brand} size={20} />
              </View>
              <View style={styles.flexCopy}>
                <Text style={[styles.label, { color: palette.muted }]}>AVAILABLE WALLET BALANCE</Text>
                <Text style={[styles.balance, { color: palette.ink }]}>{money(available, currency)}</Text>
              </View>
              <StatusPill label={enoughBalance ? "Ready" : "Top up needed"} tone={enoughBalance ? "success" : "warning"} />
            </View>
            <Text style={[styles.caption, { color: palette.muted }]}>
              {enoughBalance
                ? "SKIMA will reserve the order amount from your wallet and move the refill into dispatch."
                : "Your saved order remains waiting for payment. Add funds, then return here to continue."}
            </Text>
          </View>

          {reserve.error ? (
            <View style={[styles.errorCard, { backgroundColor: palette.dangerSoft, borderColor: palette.danger }]}>
              <Text style={[styles.errorText, { color: palette.danger }]}>
                {friendlyError(reserve.error, "Payment could not be completed. Your order is still saved and you can try again.")}
              </Text>
            </View>
          ) : null}

          <View style={styles.actions}>
            {!enoughBalance ? (
              <AppButton
                label="Top up wallet"
                fullWidth
                onPress={() => router.push("/(customer)/wallet/top-up" as never)}
              />
            ) : null}
            <AppButton
              label={enoughBalance ? "Confirm payment" : "Try payment after top up"}
              variant={enoughBalance ? "primary" : "secondary"}
              fullWidth
              loading={reserve.isPending}
              disabled={!walletId || !enoughBalance}
              onPress={() => void continuePayment()}
            />
            <AppButton
              label="View order details"
              variant="ghost"
              fullWidth
              onPress={() => router.replace(`/(customer)/orders/${orderId}` as never)}
            />
          </View>
        </>
      )}
    </Screen>
  );
}

function normalizeStatus(value: string) {
  return value.toLowerCase().replace(/[-\s]+/g, "_");
}

function money(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

const styles = StyleSheet.create({
  loading: { minHeight: 190, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  flexCopy: { flex: 1, minWidth: 0 },
  caption: { ...typography.caption, lineHeight: 18 },
  title: { ...typography.subheading, fontSize: 16 },
  hero: { gap: spacing.md, padding: spacing.lg, borderRadius: radii.xl },
  heroTop: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  heroEyebrow: { color: "rgba(255,255,255,.76)", ...typography.eyebrow, fontSize: 9 },
  heroValue: { color: "#FFFFFF", fontSize: 32, lineHeight: 40, fontWeight: "900", letterSpacing: -0.8, marginTop: 5 },
  heroBody: { color: "rgba(255,255,255,.86)", ...typography.caption, lineHeight: 18 },
  heroIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: "rgba(255,255,255,.15)", alignItems: "center", justifyContent: "center" },
  walletCard: { gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.md },
  walletHead: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  walletIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  label: { ...typography.eyebrow, fontSize: 8 },
  balance: { ...typography.subheading, fontSize: 19, marginTop: 3 },
  successCard: { gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.lg },
  errorCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  errorText: { ...typography.caption, fontWeight: "800", lineHeight: 18 },
  actions: { gap: spacing.sm },
});
