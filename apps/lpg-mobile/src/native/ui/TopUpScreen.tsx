import * as Linking from "expo-linking";
import { router } from "expo-router";
import { ShieldCheck, WalletCards } from "lucide-react-native";
import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { domainQueries } from "../api/domains";
import { useFinanceMutation } from "../api/finance";
import {
  firstNumber,
  firstString,
  nestedRecord,
  RecordObjectSchema,
  type PlatformRecord,
} from "../api/records";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { selectWorkspaceWallet } from "../utilities/financeWallet";
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
  const [feePreview, setFeePreview] = useState<PlatformRecord | null>(null);
  const [previewedAmount, setPreviewedAmount] = useState<number | null>(null);
  const [pendingDeposit, setPendingDeposit] = useState<{
    checkoutUrl: string | null;
    depositId: string | null;
    amount: number;
  } | null>(null);

  const wallet = useMemo(
    () => selectWorkspaceWallet(wallets.data ?? [], "customer"),
    [wallets.data],
  );
  const walletId = firstString(wallet, ["id", "wallet_id", "walletId"]);
  const currency =
    firstString(wallet, ["currency_code", "currencyCode"]) ??
    firstString(currencies.data?.[0], ["code"]) ??
    "NGN";

  const preview = useFinanceMutation({
    path: "/deposits/preview",
    schema: RecordObjectSchema,
  });
  const initialize = useFinanceMutation({
    path: "/deposits",
    schema: RecordObjectSchema,
    invalidate: [["deposits"], ["wallets"]],
  });

  const enteredAmount = Number.isFinite(Number(amount)) ? Number(amount) : 0;
  const walletCreditAmount = firstNumber(feePreview, ["walletCreditAmount", "wallet_credit_amount"]) ?? enteredAmount;
  const feeAmount = firstNumber(feePreview, ["calculatedFeeAmount", "calculated_fee_amount"]) ?? 0;
  const totalCharge = firstNumber(feePreview, ["totalChargeAmount", "total_charge_amount"]) ?? walletCreditAmount + feeAmount;

  const changeAmount = (value: string) => {
    setAmount(value);
    setFeePreview(null);
    setPreviewedAmount(null);
    setError(null);
  };

  const submit = async () => {
    const value = Number(amount);
    setError(null);
    if (!Number.isFinite(value) || value <= 0) {
      setError("Please enter a valid amount to add.");
      return;
    }

    try {
      if (!feePreview || previewedAmount !== value) {
        const result = await preview.mutateAsync({
          amount: value,
          walletId: walletId ?? undefined,
          idempotencyKey: idempotencyKey("wallet-top-up-preview", walletId ?? "wallet"),
        });
        setFeePreview(result);
        setPreviewedAmount(value);
        return;
      }

      const result = await initialize.mutateAsync({
        amount: value,
        currencyCode: currency,
        walletId: walletId ?? undefined,
        callbackUrl: Linking.createURL("payment-return"),
        idempotencyKey: idempotencyKey("wallet-top-up", walletId ?? "wallet"),
        metadata: { returnUrl: Linking.createURL("payment-return") },
      });

      const response = result ?? {};
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
      subtitle="See exactly what enters your wallet and any SKIMA fee before payment."
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
        <Text style={styles.heroSub}>Your wallet receives the amount you choose. Any SKIMA fee is shown separately before you pay.</Text>
      </View>

      <Card padding="lg">
        <AppField
          label={`Amount to add (${currency})`}
          value={amount}
          onChangeText={changeAmount}
          keyboardType="decimal-pad"
          placeholder="e.g. 5,000"
          error={error}
        />

        {feePreview ? (
          <View style={[styles.breakdown, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
            <MoneyRow label="Wallet receives" value={money(walletCreditAmount, currency)} />
            <MoneyRow label="SKIMA fee" value={money(feeAmount, currency)} />
            <View style={[styles.totalDivider, { borderTopColor: palette.border }]} />
            <MoneyRow label="Total payment" value={money(totalCharge, currency)} strong />
          </View>
        ) : null}

        <AppButton
          label={feePreview && previewedAmount === Number(amount) ? `Pay ${money(totalCharge, currency)}` : "Review payment"}
          fullWidth
          loading={preview.isPending || initialize.isPending}
          onPress={() => void submit()}
        />
      </Card>

      <View style={[styles.infoBox, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
        <View style={[styles.infoIcon, { backgroundColor: palette.successSoft }]}>
          <ShieldCheck color={palette.success} size={20} />
        </View>
        <View style={styles.infoCopy}>
          <Text style={[styles.infoTitle, { color: palette.ink }]}>Secure wallet funding</Text>
          <Text style={[styles.infoBody, { color: palette.muted }]}>Your wallet is credited only after payment is confirmed. Any SKIMA fee is shown separately and is reversed automatically if the payment is reversed.</Text>
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

function MoneyRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  const { palette } = useAppTheme();
  return (
    <View style={styles.moneyRow}>
      <Text style={[strong ? styles.totalLabel : styles.moneyLabel, { color: strong ? palette.ink : palette.muted }]}>{label}</Text>
      <Text style={[strong ? styles.totalValue : styles.moneyValue, { color: palette.ink }]}>{value}</Text>
    </View>
  );
}

function money(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

const styles = StyleSheet.create({
  hero: { padding: spacing.lg, borderRadius: radii.xl, gap: spacing.md },
  heroHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: spacing.md },
  heroLabel: { color: "rgba(255,255,255,.78)", ...typography.eyebrow, fontSize: 9 },
  heroValue: { color: "#FFFFFF", fontSize: 35, lineHeight: 42, fontWeight: "900", letterSpacing: -0.8, marginTop: 4 },
  heroIcon: { width: 48, height: 48, borderRadius: 17, backgroundColor: "rgba(255,255,255,.14)", alignItems: "center", justifyContent: "center" },
  heroSub: { color: "rgba(255,255,255,.84)", ...typography.caption, lineHeight: 18, maxWidth: 460 },
  breakdown: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm, marginBottom: spacing.md },
  moneyRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md },
  moneyLabel: { ...typography.caption },
  moneyValue: { ...typography.bodyStrong, fontSize: 13 },
  totalDivider: { borderTopWidth: StyleSheet.hairlineWidth, marginVertical: 2 },
  totalLabel: { ...typography.bodyStrong, fontSize: 14 },
  totalValue: { ...typography.subheading, fontSize: 16 },
  infoBox: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, padding: spacing.md, borderRadius: radii.lg, borderWidth: StyleSheet.hairlineWidth },
  infoIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  infoCopy: { flex: 1, gap: 3 },
  infoTitle: { ...typography.bodyStrong, fontSize: 14 },
  infoBody: { ...typography.caption, lineHeight: 18 },
});
