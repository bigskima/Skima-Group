import * as Linking from "expo-linking";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { z } from "zod";
import { createClientIdempotencyKey } from "@skima/frontend-core";
import { useLogisticsQuery, asString, asNumber } from "../api/logistics";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii } from "../theme/tokens";
import { Screen } from "../ui/Screen";
import { StatePanel } from "../ui/StatePanel";

const RecordSchema = z.record(z.string(), z.unknown());
const money = (value: number, currency: string) => {
  try { return new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 2 }).format(value); }
  catch { return `${currency} ${value.toFixed(2)}`; }
};
const nested = (value: Record<string, unknown>) => value.data && typeof value.data === "object" ? value.data as Record<string, unknown> : {};
export function CustomerWalletTopUpScreen() {
  const { palette } = useAppTheme();
  const { session } = useSession();
  const params = useLocalSearchParams<{ walletId?: string | string[] }>();
  const walletIdParam = Array.isArray(params.walletId) ? params.walletId[0] : params.walletId;
  const wallets = useLogisticsQuery(["customer-wallets"], "/runtime/wallets", true, 30000);
  const balances = useLogisticsQuery(["customer-wallet-balances"], "/runtime/wallet-balances", true, 30000);
  const wallet = (wallets.data ?? []).find(w => asString(w, "wallet_type") === "customer" && asString(w, "owner_entity_type") === "user" && asString(w, "owner_entity_id") === session?.user.id && (!walletIdParam || asString(w, "id", "wallet_id", "walletId") === walletIdParam)) ?? null;
  const walletId = asString(wallet, "id", "wallet_id");
  const currency = asString(wallet, "currency_code") ?? "NGN";
  const balance = asNumber((balances.data ?? []).find(b => asString(b, "wallet_id") === walletId), "balance") ?? asNumber(wallet, "available_balance", "balance") ?? 0;
  const [amount, setAmount] = useState("");
  const [previewData, setPreviewData] = useState<Record<string, unknown> | null>(null);
  const [previewedAmount, setPreviewedAmount] = useState(0);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");
  const [previewKey, setPreviewKey] = useState(() => createClientIdempotencyKey("logistics.wallet.topup.preview", session?.user.id ?? "customer"));
  const [depositKey, setDepositKey] = useState(() => createClientIdempotencyKey("logistics.wallet.topup", session?.user.id ?? "customer"));
  const preview = useMutation({ mutationFn: (body: Record<string, unknown>) => session.api.post("/runtime/payments/deposits/preview", body, RecordSchema) });
  const initialize = useMutation({ mutationFn: (body: Record<string, unknown>) => session.api.post("/runtime/payments/deposits", body, RecordSchema) });
  const value = Number(amount);
  const credit = asNumber(previewData, "walletCreditAmount", "wallet_credit_amount") ?? value;
  const fee = asNumber(previewData, "calculatedFeeAmount", "calculated_fee_amount") ?? 0;
  const total = asNumber(previewData, "totalChargeAmount", "total_charge_amount") ?? credit + fee;
  async function submit() {
    setError("");
    if (!Number.isFinite(value) || value <= 0) { setError("Enter a valid amount."); return; }
    try {
      if (!previewData || previewedAmount !== value) {
        const result = await preview.mutateAsync({ amount: value, walletId: walletId ?? undefined, idempotencyKey: previewKey });
        setPreviewData(result); setPreviewedAmount(value); return;
      }
      const resolvedWalletId = asString(previewData, "walletId", "wallet_id") ?? walletId;
      const result = await initialize.mutateAsync({ amount: value, currencyCode: currency, walletId: resolvedWalletId ?? undefined, idempotencyKey: depositKey, metadata: { returnUrl: Linking.createURL("payment-return"), appReturnTo: "/(customer)/wallet" } });
      const data = nested(result);
      const url = asString(result, "checkout_url", "checkoutUrl", "authorization_url", "url") ?? asString(data, "checkout_url", "checkoutUrl", "authorization_url", "url");
      const id = asString(result, "id", "deposit_id", "depositId", "depositRequestId", "deposit_request_id") ?? asString(data, "id", "deposit_id", "depositId", "depositRequestId", "deposit_request_id");
      if (!url && !id) throw new Error("No payment session was returned.");
      setCheckoutUrl(url); setReference(id ?? ""); if (url) await Linking.openURL(url);
      setPreviewData(null);
      setPreviewKey(createClientIdempotencyKey("logistics.wallet.topup.preview", resolvedWalletId ?? "customer"));
      setDepositKey(createClientIdempotencyKey("logistics.wallet.topup", resolvedWalletId ?? "customer"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Funding could not be started."); }
  }
  return <Screen title="Fund SKIMA Wallet" denseHeader>
    <Pressable onPress={() => router.back()}><Text style={{ color: palette.brand, fontWeight: "800" }}>‹ Back to wallet</Text></Pressable>
    {wallets.isPending ? <ActivityIndicator color={palette.brand} /> : wallets.error ? <StatePanel title="Wallet unavailable" description="Refresh and try again." retry={() => void wallets.refetch()} /> : <>
      <View style={[styles.hero, { backgroundColor: palette.brand }]}><Text style={styles.kicker}>SHARED SKIMA CUSTOMER WALLET</Text><Text style={styles.balance}>{money(balance, currency)}</Text><Text style={styles.hint}>One wallet for LPG, Logistics and SKIMA Store purchases.</Text></View>
      <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}><Text style={{ color: palette.ink, fontWeight: "800" }}>Amount to add ({currency})</Text>
        <TextInput value={amount} onChangeText={v => { setAmount(v.replace(/[^0-9.]/g, "")); setPreviewData(null); setError(""); setPreviewKey(createClientIdempotencyKey("logistics.wallet.topup.preview", walletId ?? "customer")); setDepositKey(createClientIdempotencyKey("logistics.wallet.topup", walletId ?? "customer")); }} keyboardType="decimal-pad" placeholder="Enter amount" placeholderTextColor={palette.muted} style={[styles.input, { color: palette.ink, borderColor: palette.border }]} />
        {previewData ? <View style={styles.row}><Text style={{ color: palette.muted }}>Wallet credit</Text><Text style={{ color: palette.ink }}>{money(credit, currency)}</Text><Text style={{ color: palette.muted }}>Fee</Text><Text style={{ color: palette.ink }}>{money(fee, currency)}</Text><Text style={{ color: palette.ink, fontWeight: "900" }}>Total {money(total, currency)}</Text></View> : null}
        {error ? <Text style={{ color: palette.danger, fontSize: 11 }}>{error}</Text> : null}
        <Pressable disabled={preview.isPending || initialize.isPending} onPress={() => void submit()} style={[styles.button, { backgroundColor: palette.brand }]}>{preview.isPending || initialize.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{previewData ? "Continue to payment" : "Review top-up"}</Text>}</Pressable>
      </View>
      {checkoutUrl || reference ? <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}><Text style={{ color: palette.ink, fontWeight: "900" }}>Payment session created</Text><Text style={{ color: palette.muted, fontSize: 11 }}>Wallet funds are added only after the payment provider confirms the deposit.</Text>{reference ? <Text style={{ color: palette.ink }}>Reference: {reference}</Text> : null}{checkoutUrl ? <Pressable onPress={() => void Linking.openURL(checkoutUrl)}><Text style={{ color: palette.brand, fontWeight: "800" }}>Open payment page</Text></Pressable> : null}<Pressable onPress={() => void Promise.all([wallets.refetch(), balances.refetch()])}><Text style={{ color: palette.brand, fontWeight: "800" }}>Refresh wallet balance</Text></Pressable></View> : null}
    </>}
  </Screen>;
}
const styles = StyleSheet.create({ hero: { borderRadius: radii.lg, padding: 16, gap: 7 }, kicker: { color: "rgba(255,255,255,.8)", fontSize: 9, fontWeight: "900", letterSpacing: 1 }, balance: { color: "#fff", fontSize: 27, fontWeight: "900" }, hint: { color: "rgba(255,255,255,.85)", fontSize: 11 }, card: { borderWidth: 1, borderRadius: radii.lg, padding: 14, gap: 12 }, input: { height: 46, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: 12, fontSize: 16 }, row: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 8 }, button: { minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: radii.md }, buttonText: { color: "#fff", fontWeight: "900", fontSize: 12 } });
