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
import { Screen } from "./Screen";
export function TopUpScreen() {
  const wallets = domainQueries.wallets();
  const deposits = domainQueries.transactions();
  const currencies = domainQueries.currencies();
  const providers = domainQueries.providers();
  const [amount, setAmount] = useState("");
  const [provider, setProvider] = useState("");
  const [error, setError] = useState<string | null>(null);
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
        providerAdapterKey: provider || undefined,
        source: "skima.lpg.mobile",
        idempotencyKey: idempotencyKey("wallet-top-up", walletId ?? "wallet"),
        metadata: { returnUrl: Linking.createURL("payment-return") },
      });
      const resultId =
        typeof result === "string"
          ? result
          : result &&
              typeof result === "object" &&
              typeof result.id === "string"
            ? result.id
            : null;
      const refreshed = await deposits.refetch();
      const deposit = refreshed.data?.find(
        (item) => firstString(item, ["id"]) === resultId,
      );
      const checkout = firstString(deposit, ["checkout_url", "checkoutUrl"]);
      if (checkout && (await Linking.canOpenURL(checkout)))
        await Linking.openURL(checkout);
      else router.replace("/(customer)/wallet");
    } catch (cause) {
      setError(
        friendlyError(cause, "The top-up could not be started. Please try again."),
      );
    }
  };
  return (
    <Screen
      eyebrow="Wallet"
      title="Top up securely"
      action={
        <Pressable onPress={() => router.back()}>
          <Text style={styles.link}>Cancel</Text>
        </Pressable>
      }
    >
      <View style={styles.hero}>
        <Text style={styles.heroLabel}>Funding currency</Text>
        <Text style={styles.heroValue}>{currency}</Text>
      </View>
      <TextInput
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        placeholder="Amount"
        placeholderTextColor={colors.muted}
        style={styles.input}
      />
      <View style={styles.providers}>
        <Pressable
          onPress={() => setProvider("")}
          style={[styles.provider, !provider && styles.selected]}
        >
          <Text style={styles.providerText}>Backend default</Text>
        </Pressable>
        {paymentProviders.map((item) => {
          const key = firstString(item, ["key"]) ?? "";
          return (
            <Pressable
              key={key}
              onPress={() => setProvider(key)}
              style={[styles.provider, provider === key && styles.selected]}
            >
              <Text style={styles.providerText}>
                {firstString(item, ["display_name", "displayName"]) ?? key}
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
          <Text style={styles.primaryText}>Continue to payment provider</Text>
        )}
      </Pressable>
      <Text style={styles.note}>
        Payment details are entered on the secure payment page. Your balance
        updates after the payment is confirmed.
      </Text>
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
