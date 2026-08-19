import * as Linking from "expo-linking";
import { router } from "expo-router";
import { ShieldCheck, WalletCards } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { domainQueries } from "../api/domains";
import { useGatewayMutation } from "../api/gateway";
import { ActionResponseSchema, firstString, nestedRecord, type PlatformRecord } from "../api/records";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { idempotencyKey } from "../utilities/idempotency";
import { AppButton } from "./AppButton";
import { AppField } from "./AppField";
import { Card } from "./Card";
import { PaymentCheckoutModal } from "./PaymentCheckoutModal";
import { Screen } from "./Screen";

export function TopUpScreen() {
  const { palette } = useAppTheme();
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
        source: "skima.lpg.mobile",
        idempotencyKey: idempotencyKey("wallet-top-up", walletId ?? "wallet"),
        metadata: { returnUrl: Linking.createURL("payment-return") },
      });

      const response = typeof result === "object" && result !== null ? result as PlatformRecord : {};
      const nestedData = nestedRecord(response, "data");
      const checkout =
        firstString(response, ["checkout_url", "checkoutUrl", "authorization_url", "authorizationUrl", "url"]) ??
        firstString(nestedData, ["checkout_url", "checkoutUrl", "authorization_url", "authorizationUrl", "url"]);
      const depositId =
        firstString(response, ["id", "deposit_id", "depositId"]) ??
        firstString(nestedData, ["id", "deposit_id", "depositId"]);

      if (!checkout && !depositId) {
        throw new Error("The payment session did not return a checkout or deposit reference.");
      }

      setPendingDeposit({ checkoutUrl: checkout, depositId, amount: value });
      setModalVisible(true);
    } catch (cause) {
      setError(friendlyError(cause, "The payment session could not be started. Please try again."));
    }
  };

  return (
    <Screen
      eyebrow="SKIMA Wallet"
      title="Add money"
      subtitle="Fund your wallet through the secure payment options currently available to your account."
      action={<AppButton label="Cancel" variant="ghost" size="sm" onPress={() => router.back()} />}
    >
      <View style={[styles.hero, shadows.raised, { backgroundColor: palette.brand }]}>
        <View style={styles.heroHeader}>
          <View>
            <Text style={styles.heroLabel}>ADD FUNDS TO WALLET</Text>
            <Text style={styles.heroValue}>{currency}</Text>
          </View>
          <View style={styles.heroIcon}>
            <WalletCards color="#FFFFFF" size={25} />
          </View>
        </View>
        <Text style={styles.heroSub}>Enter the amount you want to add. Payment confirmation updates your SKIMA balance automatically.</Text>
      </View>

      <Card padding="lg">
        <AppField
          label={`Amount (${currency})`}
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="e.g. 5,000"
          error={error}
        />
        <AppButton
          label="Continue to payment"
          fullWidth
          loading={mutation.isPending}
          onPress={() => void submit()}
        />
      </Card>

      <View style={[styles.infoBox, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
        <View style={[styles.infoIcon, { backgroundColor: palette.successSoft }]}>
          <ShieldCheck color={palette.success} size={20} />
        </View>
        <View style={styles.infoCopy}>
          <Text style={[styles.infoTitle, { color: palette.ink }]}>Secure payment options</Text>
          <Text style={[styles.infoBody, { color: palette.muted }]}>Available card, bank transfer, or USSD options are presented during checkout according to the active SKIMA payment configuration.</Text>
        </View>
      </View>

      <PaymentCheckoutModal
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
  hero: { padding: spacing.lg, borderRadius: radii.xl, gap: spacing.md },
  heroHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: spacing.md },
  heroLabel: { color: "rgba(255,255,255,.78)", ...typography.eyebrow, fontSize: 9 },
  heroValue: { color: "#FFFFFF", fontSize: 35, lineHeight: 42, fontWeight: "900", letterSpacing: -0.8, marginTop: 4 },
  heroIcon: { width: 48, height: 48, borderRadius: 17, backgroundColor: "rgba(255,255,255,.14)", alignItems: "center", justifyContent: "center" },
  heroSub: { color: "rgba(255,255,255,.84)", ...typography.caption, lineHeight: 18, maxWidth: 460 },
  infoBox: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, padding: spacing.md, borderRadius: radii.lg, borderWidth: StyleSheet.hairlineWidth },
  infoIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  infoCopy: { flex: 1, gap: 3 },
  infoTitle: { ...typography.bodyStrong, fontSize: 14 },
  infoBody: { ...typography.caption, lineHeight: 18 },
});
