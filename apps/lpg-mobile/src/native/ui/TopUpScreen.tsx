import * as Linking from "expo-linking";
import { router } from "expo-router";
import { ShieldCheck } from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { domainQueries } from "../api/domains";
import { useGatewayMutation } from "../api/gateway";
import { ActionResponseSchema, firstString } from "../api/records";
import { colors, radii, spacing } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { idempotencyKey } from "../utilities/idempotency";
import { PaystackPaymentModal } from "./PaystackPaymentModal";
import { Screen } from "./Screen";

export function TopUpScreen() {
  const wallets = domainQueries.wallets();
  const currencies = domainQueries.currencies();

  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [pendingDeposit, setPendingDeposit] = useState<{
    checkoutUrl: string | null;
    depositId: string | null;
    amount: number;
  } | null>(null);

  const mutation = useGatewayMutation({
    path: "/runtime/payments/deposits",
    schema: ActionResponseSchema,
    invalidate: [["deposits"], ["wallets"]],
  });

  const wallet = wallets.data?.[0];
  const walletId = firstString(wallet, ["id", "wallet_id", "walletId"]);
  const currency =
    firstString(wallet, ["currency_code", "currencyCode"]) ??
    firstString(currencies.data?.[0], ["code"]) ??
    "NGN";

  const submit = async () => {
    const value = Number(amount);
    setError(null);
    if (!Number.isFinite(value) || value <= 0) {
      setError("Please enter a valid amount to add.");
      return;
    }

    try {
      const result = await mutation.mutateAsync({
        amount: value,
        currencyCode: currency,
        walletId: walletId ?? undefined,
        providerAdapterKey: "provider.payment.paystack",
        source: "skima.lpg.mobile",
        idempotencyKey: idempotencyKey("wallet-top-up", walletId ?? "wallet"),
        metadata: { returnUrl: Linking.createURL("payment-return") },
      });

      const resObj = typeof result === "object" && result !== null ? result : {};
      const nestedData = (resObj as Record<string, unknown>).data as Record<string, unknown> | undefined;

      const checkout =
        firstString(resObj, ["checkout_url", "checkoutUrl", "authorization_url", "authorizationUrl", "url"]) ??
        firstString(nestedData, ["checkout_url", "checkoutUrl", "authorization_url", "authorizationUrl", "url"]);

      const depositId =
        firstString(resObj, ["id", "deposit_id", "depositId"]) ??
        firstString(nestedData, ["id", "deposit_id", "depositId"]);

      setPendingDeposit({
        checkoutUrl: checkout,
        depositId: depositId,
        amount: value,
      });

      setModalVisible(true);
    } catch (cause) {
      setError(
        friendlyError(cause, "The payment session could not be started. Please try again."),
      );
    }
  };

  return (
    <Screen
      eyebrow="SKIMA Wallet"
      title="Add Money"
      action={
        <Pressable onPress={() => router.back()}>
          <Text style={styles.link}>Cancel</Text>
        </Pressable>
      }
    >
      <View style={styles.hero}>
        <View style={styles.heroHeader}>
          <Text style={styles.heroLabel}>ADD FUNDS TO WALLET</Text>
          <ShieldCheck color="white" size={22} />
        </View>
        <Text style={styles.heroValue}>{currency}</Text>
        <Text style={styles.heroSub}>
          Enter the amount you want to add to your SKIMA Wallet.
        </Text>
      </View>

      <View style={styles.inputCard}>
        <Text style={styles.fieldLabel}>Amount ({currency})</Text>
        <TextInput
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="e.g. 5,000"
          placeholderTextColor={colors.muted}
          style={styles.input}
        />
      </View>

      <View style={styles.infoBox}>
        <Text style={styles.infoTitle}>Payment method</Text>
        <Text style={styles.infoBody}>
          You will be shown available secure payment options (Bank Transfer, Card, USSD) during checkout.
        </Text>
        <Text style={styles.infoFooter}>
          Your wallet will be updated once your payment has been successfully confirmed.
        </Text>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        disabled={mutation.isPending}
        onPress={() => void submit()}
        style={styles.primary}
      >
        {mutation.isPending ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text style={styles.primaryText}>Continue to Payment</Text>
        )}
      </Pressable>

      <PaystackPaymentModal
        visible={modalVisible}
        checkoutUrl={pendingDeposit?.checkoutUrl ?? null}
        depositId={pendingDeposit?.depositId ?? null}
        amount={pendingDeposit?.amount ?? null}
        currency={currency}
        onClose={() => setModalVisible(false)}
        onSuccess={() => {
          setModalVisible(false);
          router.replace("/(customer)/wallet");
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  link: { color: colors.brand, fontWeight: "800", fontSize: 14 },
  hero: {
    padding: spacing.xl,
    borderRadius: radii.lg,
    backgroundColor: colors.brand,
    gap: spacing.xs,
  },
  heroHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  heroLabel: { color: "#FFE5E8", fontWeight: "900", fontSize: 11, letterSpacing: 1.2 },
  heroValue: { color: "white", fontSize: 34, fontWeight: "900" },
  heroSub: { color: "#FFF1F2", fontSize: 14, marginTop: 4, lineHeight: 20 },
  inputCard: {
    backgroundColor: colors.surface,
    padding: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  fieldLabel: { color: colors.ink, fontWeight: "800", fontSize: 13 },
  input: {
    minHeight: 56,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    fontSize: 20,
    fontWeight: "700",
    backgroundColor: "#FAFAFA",
    color: colors.ink,
  },
  infoBox: {
    backgroundColor: colors.surface,
    padding: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  infoTitle: { color: colors.ink, fontWeight: "900", fontSize: 15 },
  infoBody: { color: colors.muted, lineHeight: 21, fontSize: 13 },
  infoFooter: { color: colors.brandDark, fontWeight: "700", fontSize: 12, marginTop: 4 },
  primary: {
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: colors.brand,
    marginTop: spacing.sm,
  },
  primaryText: { color: "white", fontWeight: "900", fontSize: 16 },
  error: { color: colors.danger, fontWeight: "700", textAlign: "center" },
});
