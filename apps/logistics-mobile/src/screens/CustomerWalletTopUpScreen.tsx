import * as Linking from "expo-linking";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ActivityIndicator, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { WebView } from "react-native-webview";
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
  const { session, api } = useSession();
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
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");
  const [previewKey, setPreviewKey] = useState(() => createClientIdempotencyKey("logistics.wallet.topup.preview", session?.user.id ?? "customer"));
  const [depositKey, setDepositKey] = useState(() => createClientIdempotencyKey("logistics.wallet.topup", session?.user.id ?? "customer"));
  const deposits = useLogisticsQuery(["customer-deposits", reference], "/runtime/payments/deposits?scope=customer", Boolean(reference), 3000);
  const currentDeposit = (deposits.data ?? []).find((deposit) =>
    asString(deposit, "id", "deposit_id", "depositId", "public_reference", "publicReference") === reference
  );
  const depositStatus = (asString(currentDeposit, "status", "state") ?? "pending").toLowerCase();
  const paymentConfirmed = ["completed", "confirmed", "credited", "succeeded", "successful", "settled"].includes(depositStatus);
  useEffect(() => {
    if (paymentConfirmed) {
      void Promise.all([wallets.refetch(), balances.refetch()]);
      setCheckoutOpen(false);
    }
  }, [paymentConfirmed]);
  const preview = useMutation({ mutationFn: (body: Record<string, unknown>) => api.post("/runtime/payments/deposits/preview", body, RecordSchema) });
  const initialize = useMutation({ mutationFn: (body: Record<string, unknown>) => api.post("/runtime/payments/deposits", body, RecordSchema) });
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
      setCheckoutUrl(url); setReference(id ?? ""); setCheckoutError(""); setCheckoutOpen(Boolean(url));
      setPreviewData(null);
      setPreviewKey(createClientIdempotencyKey("logistics.wallet.topup.preview", resolvedWalletId ?? "customer"));
      setDepositKey(createClientIdempotencyKey("logistics.wallet.topup", resolvedWalletId ?? "customer"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Funding could not be started."); }
  }
  return <><Screen title="Fund SKIMA Wallet" denseHeader>
    <Pressable onPress={() => router.back()}><Text style={{ color: palette.brand, fontWeight: "800" }}>‹ Back to wallet</Text></Pressable>
    {wallets.isPending ? <ActivityIndicator color={palette.brand} /> : wallets.error ? <StatePanel title="Wallet unavailable" description="Refresh and try again." retry={() => void wallets.refetch()} /> : <>
      <View style={[styles.hero, { backgroundColor: palette.brand }]}><Text style={styles.kicker}>SHARED SKIMA CUSTOMER WALLET</Text><Text adjustsFontSizeToFit minimumFontScale={0.55} numberOfLines={1} style={styles.balance}>{money(balance, currency)}</Text><Text style={styles.hint}>One wallet for LPG, Logistics and SKIMA Store purchases.</Text></View>
      <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}><Text style={{ color: palette.ink, fontWeight: "800" }}>Amount to add ({currency})</Text>
        <TextInput value={amount} onChangeText={v => { setAmount(v.replace(/[^0-9.]/g, "")); setPreviewData(null); setError(""); setPreviewKey(createClientIdempotencyKey("logistics.wallet.topup.preview", walletId ?? "customer")); setDepositKey(createClientIdempotencyKey("logistics.wallet.topup", walletId ?? "customer")); }} keyboardType="decimal-pad" placeholder="Enter amount" placeholderTextColor={palette.muted} style={[styles.input, { color: palette.ink, borderColor: palette.border }]} />
        {previewData ? <View style={styles.row}><Text style={{ color: palette.muted }}>Wallet credit</Text><Text style={{ color: palette.ink }}>{money(credit, currency)}</Text><Text style={{ color: palette.muted }}>Fee</Text><Text style={{ color: palette.ink }}>{money(fee, currency)}</Text><Text style={{ color: palette.ink, fontWeight: "900" }}>Total {money(total, currency)}</Text></View> : null}
        {error ? <Text style={{ color: palette.danger, fontSize: 11 }}>{error}</Text> : null}
        <Pressable disabled={preview.isPending || initialize.isPending} onPress={() => void submit()} style={[styles.button, { backgroundColor: palette.brand }]}>{preview.isPending || initialize.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{previewData ? "Continue to payment" : "Review top-up"}</Text>}</Pressable>
      </View>
      {checkoutUrl || reference ? <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}><Text style={{ color: palette.ink, fontWeight: "900" }}>Payment session created</Text><Text style={{ color: palette.muted, fontSize: 11 }}>Wallet funds are added only after the payment provider confirms the deposit.</Text>{reference ? <Text style={{ color: palette.ink }}>Reference: {reference}</Text> : null}{checkoutUrl ? <Pressable onPress={() => { setCheckoutError(""); setCheckoutOpen(true); }}><Text style={{ color: palette.brand, fontWeight: "800" }}>Continue to secure checkout</Text></Pressable> : null}<Pressable onPress={() => void Promise.all([wallets.refetch(), balances.refetch()])}><Text style={{ color: palette.brand, fontWeight: "800" }}>Refresh wallet balance</Text></Pressable></View> : null}
    </>}
  </Screen>

      <Modal visible={checkoutOpen} animationType="slide" transparent={false} presentationStyle="fullScreen" statusBarTranslucent onRequestClose={() => setCheckoutOpen(false)}>
        <View style={[styles.checkoutScreen, { backgroundColor: palette.canvas }]}>
          <View style={[styles.checkoutHeader, { borderBottomColor: palette.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: palette.ink, fontSize: 17, fontWeight: "900" }}>Secure SKIMA checkout</Text>
              <Text style={{ color: palette.muted, fontSize: 10 }}>Your wallet is credited after payment confirmation.</Text>
            </View>
            <Pressable onPress={() => setCheckoutOpen(false)} style={[styles.close, { backgroundColor: palette.surface }]}><Text style={{ color: palette.ink, fontSize: 18 }}>×</Text></Pressable>
          </View>
          <View style={[styles.checkoutAmount, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <Text style={{ color: palette.muted, fontSize: 9, fontWeight: "900" }}>AMOUNT TO PAY</Text>
            <Text adjustsFontSizeToFit minimumFontScale={0.6} numberOfLines={1} style={{ color: palette.brand, fontSize: 20, fontWeight: "900" }}>{money(total, currency)}</Text>
          </View>
          <View style={{ flex: 1, minHeight: 0, backgroundColor: "#fff" }}>
            {checkoutError ? (
              <View style={styles.checkoutError}>
                <Text style={{ color: palette.danger, fontWeight: "900" }}>Checkout could not load</Text>
                <Text style={{ color: palette.muted, fontSize: 11, textAlign: "center" }}>{checkoutError}</Text>
                <Pressable onPress={() => setCheckoutError("")}><Text style={{ color: palette.brand, fontWeight: "900" }}>Retry</Text></Pressable>
              </View>
            ) : checkoutUrl && Platform.OS === "web" ? (
              <iframe src={checkoutUrl} title="SKIMA payment checkout" style={{ width: "100%", height: "100%", minHeight: 420, border: "none" }} />
            ) : checkoutUrl ? (
              <WebView
                source={{ uri: checkoutUrl }}
                style={{ flex: 1, backgroundColor: "#fff" }}
                originWhitelist={["*"]}
                onShouldStartLoadWithRequest={(request) => {
                  if (request.url.startsWith(Linking.createURL("payment-return"))) {
                    void Promise.all([deposits.refetch(), wallets.refetch(), balances.refetch()]);
                    return false;
                  }
                  return /^https?:\\/\\//i.test(request.url);
                }}
                javaScriptEnabled domStorageEnabled sharedCookiesEnabled thirdPartyCookiesEnabled
                allowsBackForwardNavigationGestures setSupportMultipleWindows={false} startInLoadingState
                renderLoading={() => <View style={styles.webLoading}><ActivityIndicator size="large" color={palette.brand}/><Text style={{ color: palette.muted, marginTop: 10 }}>Opening secure payment…</Text></View>}
                onError={(event) => setCheckoutError(event.nativeEvent.description || "Please check your connection and retry.")}
                onHttpError={(event) => { if (event.nativeEvent.statusCode >= 500) setCheckoutError("The payment provider is temporarily unavailable."); }}
              />
            ) : (
              <View style={styles.webLoading}><ActivityIndicator size="large" color={palette.brand}/><Text style={{ color: palette.muted, marginTop: 10 }}>Waiting for payment session…</Text></View>
            )}
          </View>
          <View style={[styles.checkoutFooter, { backgroundColor: palette.surface, borderTopColor: palette.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: paymentConfirmed ? palette.success : palette.muted, fontSize: 11, fontWeight: "800" }}>{paymentConfirmed ? "Payment confirmed" : "Waiting for payment confirmation"}</Text>
              <Text style={{ color: palette.muted, fontSize: 9 }}>You can close checkout; the payment status will remain available in your wallet.</Text>
            </View>
            <Pressable onPress={() => void Promise.all([deposits.refetch(), wallets.refetch(), balances.refetch()])} style={[styles.checkButton, { borderColor: palette.border }]}><Text style={{ color: palette.brand, fontWeight: "900", fontSize: 10 }}>Check status</Text></Pressable>
          </View>
        </View>
      </Modal>
    </>;
}
const styles = StyleSheet.create({
 hero:{borderRadius:radii.lg,padding:16,gap:7},
 kicker:{color:"rgba(255,255,255,.8)",fontSize:9,fontWeight:"900",letterSpacing:1},
 balance:{color:"#fff",fontSize:27,fontWeight:"900",flexShrink:1},
 hint:{color:"rgba(255,255,255,.85)",fontSize:11},
 card:{borderWidth:1,borderRadius:radii.lg,padding:14,gap:12},
 input:{height:46,borderWidth:1,borderRadius:radii.md,paddingHorizontal:12,fontSize:16},
 row:{flexDirection:"row",flexWrap:"wrap",justifyContent:"space-between",gap:8},
 button:{minHeight:44,alignItems:"center",justifyContent:"center",borderRadius:radii.md},
 buttonText:{color:"#fff",fontWeight:"900",fontSize:12},
 checkoutScreen:{flex:1},
 checkoutHeader:{minHeight:64,paddingHorizontal:16,paddingTop:42,paddingBottom:10,borderBottomWidth:StyleSheet.hairlineWidth,flexDirection:"row",alignItems:"center",gap:12},
 close:{width:38,height:38,borderRadius:12,alignItems:"center",justifyContent:"center"},
 checkoutAmount:{minHeight:58,margin:12,paddingHorizontal:14,paddingVertical:8,borderRadius:radii.md,borderWidth:StyleSheet.hairlineWidth,gap:2,justifyContent:"center"},
 checkoutError:{flex:1,alignItems:"center",justifyContent:"center",padding:24,gap:10},
 webLoading:{flex:1,alignItems:"center",justifyContent:"center",backgroundColor:"#fff"},
 checkoutFooter:{minHeight:68,paddingHorizontal:14,paddingVertical:10,borderTopWidth:StyleSheet.hairlineWidth,flexDirection:"row",alignItems:"center",gap:10},
 checkButton:{borderWidth:1,borderRadius:radii.md,paddingHorizontal:12,paddingVertical:10},
});
