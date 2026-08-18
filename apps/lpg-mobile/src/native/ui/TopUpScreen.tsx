import * as Linking from "expo-linking";
import { router } from "expo-router";
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
import { idempotencyKey } from "../utilities/idempotency";
import { friendlyError } from "../utilities/friendlyError";
import { PaystackPaymentModal } from "./PaystackPaymentModal";
import { BankTransferModal } from "./BankTransferModal";
import { Screen } from "./Screen";

export function TopUpScreen() {
  const wallets = domainQueries.wallets();
  const currencies = domainQueries.currencies();
  const providers = domainQueries.providers();

  const [amount, setAmount] = useState("");
  const [provider, setProvider] = useState("provider.payment.paystack");
  const [error, setError] = useState<string | null>(null);

  const [modalVisible, setModalVisible] = useState(false);
  const [bankTransferModalVisible, setBankTransferModalVisible] = useState(false);
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

  const paymentProviders = (providers.data ?? []).filter(
    (item) =>
      firstString(item, ["provider_kind", "providerKind"]) === "payment" &&
      firstString(item, ["status"]) === "active",
  );

  const submit = async () => {
    const value = Number(amount);
    setError(null);
    if (!Number.isFinite(value) || value <= 0) {
      setError("Enter a valid amount.");
      return;
    }

    try {
      const result = await mutation.mutateAsync({
        amount: value,
        currencyCode: currency,
        walletId: walletId ?? undefined,
        providerAdapterKey: provider || "provider.payment.paystack",
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

      if (provider === "provider.payment.bank_transfer") {
        setBankTransferModalVisible(true);
      } else {
        setModalVisible(true);
      }
    } catch (cause) {
      setError(
        friendlyError(cause, "The top-up could not be started. Please try again."),
      );
    }
  };

  return (
    <Screen
      eyebrow="Wallet"
      title="Add money"
      action={
        <Pressable onPress={() => router.back()}>
          <Text style={styles.link}>Cancel</Text>
        </Pressable>
      }
    >
      <View style={styles.hero}>
        <Text style={styles.heroLabel}>Wallet currency</Text>
        <Text style={styles.heroValue}>{currency}</Text>
      </View>

      <TextInput
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        placeholder="Enter amount (e.g. 5000)"
        placeholderTextColor={colors.muted}
        style={styles.input}
      />

      <Text style={styles.fieldLabel}>Choose payment method</Text>
      <View style={styles.providers}>
        <Pressable
          onPress={() => setProvider("provider.payment.paystack")}
          style={[styles.provider, (provider === "provider.payment.paystack" || !provider) && styles.selected]}
        >
          <Text style={styles.providerText}>Paystack Modal (Card, USSD, QR)</Text>
        </Pressable>

        <Pressable
          onPress={() => setProvider("provider.payment.bank_transfer")}
          style={[styles.provider, provider === "provider.payment.bank_transfer" && styles.selected]}
        >
          <Text style={styles.providerText}>Direct Bank Transfer (Virtual Account)</Text>
        </Pressable>

        {paymentProviders.map((item, index) => {
          const key = firstString(item, ["key"]) ?? "";
          if (key === "provider.payment.paystack" || key === "provider.payment.bank_transfer") return null;
          return (
            <Pressable
              key={key}
              onPress={() => setProvider(key)}
              style={[styles.provider, provider === key && styles.selected]}
            >
              <Text style={styles.providerText}>
                {firstString(item, ["display_name", "displayName"]) ??
                  `Payment option ${index + 1}`}
              </Text>
            </Pressable>
          );
        })}
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
          <Text style={styles.primaryText}>
            {provider === "provider.payment.bank_transfer"
              ? "Get Transfer Account Number"
              : "Continue to Paystack Modal"}
          </Text>
        )}
      </Pressable>

      <Text style={styles.note}>
        Choose Paystack for Instant Cards/USSD or Direct Bank Transfer to copy a virtual account number and send money from your banking app.
      </Text>

      {/* Paystack Checkout Modal */}
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

      {/* Direct Bank Transfer Virtual Account Modal */}
      <BankTransferModal
        visible={bankTransferModalVisible}
        depositId={pendingDeposit?.depositId ?? null}
        checkoutUrl={pendingDeposit?.checkoutUrl ?? null}
        amount={pendingDeposit?.amount ?? null}
        currency={currency}
        onClose={() => setBankTransferModalVisible(false)}
        onSuccess={() => {
          setBankTransferModalVisible(false);
          router.replace("/(customer)/wallet");
        }}
      />
    </Screen>
  );
}
const styles = StyleSheet.create({
  link: { color: colors.brand, fontWeight: "800" },
  hero: {
    padding: spacing.xl,
    borderRadius: radii.lg,
    backgroundColor: colors.brand,
  },
  heroLabel: { color: "#FFE5E8", fontWeight: "700" },
  heroValue: { color: "white", fontSize: 38, fontWeight: "900" },
  input: {
    minHeight: 58,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    fontSize: 18,
    backgroundColor: colors.surface,
  },
  providers: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  fieldLabel: { color: colors.ink, fontWeight: "900" },
  provider: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  selected: { borderColor: colors.brand, backgroundColor: "#FFF0F1" },
  providerText: { color: colors.ink, fontWeight: "700" },
  primary: {
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: colors.brand,
  },
  primaryText: { color: "white", fontWeight: "900" },
  error: { color: colors.danger },
  note: { color: colors.muted, lineHeight: 20 },
});
