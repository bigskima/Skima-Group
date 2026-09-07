import { createClientIdempotencyKey } from "@skima/frontend-core";
import { router } from "expo-router";
import { BadgePercent, Gift, Phone, ReceiptText, Wifi, Zap } from "lucide-react-native";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { z } from "zod";
import { domainQueries } from "../api/domains";
import { useGatewayMutation } from "../api/gateway";
import { firstNumber, firstString, type PlatformRecord } from "../api/records";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { AppButton } from "./AppButton";
import { AppField } from "./AppField";
import { AppModal } from "./AppModal";
import { EmptyState } from "./EmptyState";
import { Screen } from "./Screen";
import { selectWorkspaceWallet, walletRecordId } from "../utilities/financeWallet";

const MutationSchema = z.string().uuid();

export function UtilityBillsScreen() {
  const { palette } = useAppTheme();
  const catalog = domainQueries.utilityCatalog();
  const wallets = domainQueries.wallets();
  const offers = domainQueries.utilityOffers();
  const payments = domainQueries.utilityPayments();
  const [product, setProduct] = useState<PlatformRecord | null>(null);
  const [identifier, setIdentifier] = useState("");
  const [amount, setAmount] = useState("");
  const [phone, setPhone] = useState("");
  const [promo, setPromo] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const createPayment = useGatewayMutation({
    path: "/runtime/utility-billing/requests",
    schema: MutationSchema,
    invalidate: [["utility-billing", "requests"], ["wallets"]],
  });
  const categories = useMemo(() => groupCatalog(catalog.data ?? []), [catalog.data]);
  const selectedCurrency = firstString(product, ["currency_code", "currencyCode"]) ?? "NGN";
  const wallet = selectWorkspaceWallet(
    (wallets.data ?? []).filter((item) =>
      (firstString(item, ["currency_code", "currencyCode"]) ?? "NGN") === selectedCurrency
    ),
    "customer",
  );
  const walletId = walletRecordId(wallet);
  const balance = firstNumber(wallet, ["available_balance", "availableBalance", "balance"]) ?? 0;
  const currency = firstString(wallet, ["currency_code", "currencyCode"]) ?? "NGN";

  const submit = async () => {
    if (!product || !walletId) return;
    const fixed = firstNumber(product, ["fixed_amount"]);
    const numericAmount = fixed ?? Number(amount);
    if (!identifier.trim() || !Number.isFinite(numericAmount) || numericAmount <= 0) return;
    try {
      await createPayment.mutateAsync({
        productId: firstString(product, ["product_id"]), walletId,
        customerIdentifier: identifier.trim(), amount: numericAmount,
        recipientPhone: phone.trim() || undefined, promotionKey: promo.trim() || undefined,
        idempotencyKey: createClientIdempotencyKey("utility-payment", firstString(product, ["product_id"]) ?? "product"),
        metadata: { channel: "lpg-mobile" },
      });
      setProduct(null); setIdentifier(""); setAmount(""); setPhone(""); setPromo("");
      setNotice("Your request is ready. Your balance will only be used after the payment is confirmed.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The bill request could not be created.");
    }
  };

  return <Screen eyebrow="Everyday services" title="Pay bills" subtitle="Electricity, airtime, data and more—all in one place." action={<AppButton label="Back" size="sm" variant="ghost" onPress={() => router.back()} />}>
    <View style={[styles.balance, shadows.raised]}><Text style={styles.balanceLabel}>Available wallet balance</Text><Text style={styles.balanceValue}>{formatMajorMoney(balance, currency)}</Text><Text style={styles.balanceHint}>Use your available balance to pay for connected everyday services.</Text></View>
    {(offers.data?.length ?? 0) > 0 ? <View style={styles.offerStrip}>{offers.data?.map((offer) => { const cashback=firstString(offer,["offer_type"])==="cashback"; const offerKey=firstString(offer,["offer_key"]) ?? ""; return <Pressable accessibilityRole="button" accessibilityLabel={cashback ? `${firstString(offer,["offer_name"])} cashback details` : `Apply ${firstString(offer,["offer_name"])}`} key={offerKey} onPress={() => { if (!cashback) setPromo(offerKey); }} style={({pressed})=>[styles.offerCard,{backgroundColor:cashback?palette.successSoft:palette.brandSoft,opacity:pressed?.75:1,borderColor:!cashback&&promo===offerKey?palette.brand:"transparent"}]}>{cashback?<Gift color={palette.success} size={20}/>:<BadgePercent color={palette.brand} size={20}/>}<View style={styles.offerCopy}><Text style={[styles.offerValue,{color:cashback?palette.success:palette.brand}]}>{firstString(offer,["value_label"])}</Text><Text numberOfLines={1} style={[styles.offerName,{color:palette.ink}]}>{firstString(offer,["offer_name"])}</Text>{!cashback&&promo===offerKey?<Text style={[styles.offerName,{color:palette.brand}]}>Applied</Text>:null}</View></Pressable>; })}</View> : null}
    {catalog.isPending ? <ActivityIndicator color={palette.brand} size="large" /> : catalog.error ? <EmptyState title="Bills are unavailable" description="We could not load bill services. Try again shortly." action={<AppButton label="Retry" onPress={() => void catalog.refetch()} />} /> : categories.length === 0 ? <EmptyState title="More services are coming" description="Electricity, airtime and data will appear here as soon as they are available." /> : categories.map(({ name, icon, products }) => <View key={name} style={styles.section}><View style={styles.heading}>{serviceIcon(icon, palette.brand)}<Text style={[styles.title, { color: palette.ink }]}>{name}</Text></View><View style={styles.grid}>{products.map(item => { const available = item.available === true; return <Pressable key={firstString(item, ["product_id"])} disabled={!available} onPress={() => setProduct(item)} style={({ pressed }) => [styles.product, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border, opacity: available ? (pressed ? .72 : 1) : .5 }]}><Text style={[styles.productTitle, { color: palette.ink }]}>{firstString(item, ["product_name"])}</Text><Text style={[styles.productMeta, { color: palette.muted }]}>{available ? "Pay now" : "Coming soon"}</Text></Pressable>; })}</View></View>)}
    {(payments.data?.length ?? 0) > 0 ? <View style={styles.section}><Text style={[styles.title, { color: palette.ink }]}>Recent bill requests</Text>{payments.data?.slice(0, 5).map(item => <View key={firstString(item, ["id"])} style={[styles.history, { borderColor: palette.border }]}><View><Text style={[styles.productTitle, { color: palette.ink }]}>{firstString(item, ["public_reference"])}</Text><Text style={[styles.productMeta, { color: palette.muted }]}>{firstString(item, ["customer_identifier"])}</Text></View><Text style={[styles.status, { color: palette.brand }]}>{firstString(item, ["status"])?.replaceAll("_", " ")}</Text></View>)}</View> : null}
    <AppModal visible={Boolean(product)} title={firstString(product, ["product_name"]) ?? "Pay bill"} description="Check the account details and amount carefully before continuing." onClose={() => setProduct(null)}>
      <AppField label={firstString(product, ["customer_identifier_label"]) ?? "Account or phone number"} value={identifier} onChangeText={setIdentifier} placeholder={firstString(product, ["customer_identifier_hint"]) ?? "Enter identifier"} />
      {firstNumber(product, ["fixed_amount"]) == null ? <AppField label="Amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" /> : null}
      <AppField label="Recipient phone (optional)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <AppField label="Promo code (optional)" value={promo} onChangeText={setPromo} autoCapitalize="none" />
      <View style={styles.actions}><AppButton label="Cancel" variant="secondary" onPress={() => setProduct(null)} /><AppButton label="Continue" loading={createPayment.isPending} disabled={!walletId || !identifier.trim()} onPress={() => void submit()} /></View>
    </AppModal>
    <AppModal visible={Boolean(notice)} title={createPayment.isError ? "Bill request not completed" : "Request received"} description={notice ?? ""} tone={createPayment.isError ? "danger" : "success"} onClose={() => setNotice(null)}><AppButton label="Done" onPress={() => setNotice(null)} /></AppModal>
  </Screen>;
}

function groupCatalog(records: readonly PlatformRecord[]) { const groups = new Map<string, { name: string; icon: string; products: PlatformRecord[] }>(); for (const item of records) { const key = firstString(item, ["category_key"]) ?? "other"; const group = groups.get(key) ?? { name: firstString(item, ["category_name"]) ?? "More bills", icon: firstString(item, ["icon_key"]) ?? "receipt", products: [] }; group.products.push(item); groups.set(key, group); } return [...groups.values()]; }
function serviceIcon(key: string, color: string) { const Icon = key === "zap" ? Zap : key === "phone" ? Phone : key === "wifi" ? Wifi : ReceiptText; return <Icon color={color} size={20} />; }
function formatMajorMoney(value: number, currency: string) { try { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value); } catch { return `${currency} ${value.toFixed(2)}`; } }
const styles = StyleSheet.create({ balance: { backgroundColor: "#16181D", borderRadius: radii.xl, padding: spacing.lg, gap: 5 }, balanceLabel: { color: "#CDD1D8", fontSize: 12, fontWeight: "700" }, balanceValue: { color: "#FFFFFF", fontSize: 30, fontWeight: "900" }, balanceHint: { color: "#AEB4BE", fontSize: 12, lineHeight: 18 }, offerStrip:{flexDirection:"row",flexWrap:"wrap",gap:spacing.sm},offerCard:{minWidth:145,flex:1,flexDirection:"row",alignItems:"center",gap:spacing.sm,padding:spacing.md,borderRadius:radii.lg,borderWidth:2},offerCopy:{flex:1,gap:2},offerValue:{fontSize:13,fontWeight:"900"},offerName:{fontSize:11,fontWeight:"700"}, section: { gap: spacing.sm }, heading: { flexDirection: "row", alignItems: "center", gap: spacing.sm }, title: { ...typography.sectionTitle }, grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }, product: { minWidth: 145, flexGrow: 1, borderWidth: 1, borderRadius: radii.lg, padding: spacing.md, gap: 5 }, productTitle: { fontSize: 14, fontWeight: "800" }, productMeta: { fontSize: 12 }, history: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: spacing.sm, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, status: { fontSize: 11, fontWeight: "800", textTransform: "capitalize" }, actions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm } });
