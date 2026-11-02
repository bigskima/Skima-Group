import { createClientIdempotencyKey } from "@skima/frontend-core";
import { router, useLocalSearchParams } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, CheckCircle2, LockKeyhole, ShieldCheck, WalletCards } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { z } from "zod";
import { asNumber, asString, useLogisticsQuery } from "../api/logistics";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";
import { AppButton } from "../ui/AppButton";
import { Card } from "../ui/Card";
import { Screen } from "../ui/Screen";
import { ScreenSkeleton } from "../ui/ScreenSkeleton";
import { SectionHeader } from "../ui/SectionHeader";
import { StatePanel } from "../ui/StatePanel";
import { StatusPill } from "../ui/StatusPill";

export function LogisticsBookingScreen() {
  const { id: routeId } = useLocalSearchParams<{ id: string }>();
  const bookingId = Array.isArray(routeId) ? routeId[0] : routeId;
  const { palette } = useAppTheme();
  const { api, session } = useSession();
  const bookings = useLogisticsQuery(["bookings"], "/runtime/logistics/bookings", Boolean(bookingId));
  const walletsQuery = useLogisticsQuery(["wallets"], "/runtime/wallets");
  const balancesQuery = useLogisticsQuery(["wallet-balances"], "/runtime/wallet-balances");
  const booking = (bookings.data ?? []).find((item) => asString(item, "id") === bookingId) ?? null;
  const currency = asString(booking, "currency_code") ?? "";
  const customerId = session?.user.id ?? "";
  const customerWallets = useMemo(() => (walletsQuery.data ?? []).filter((wallet) =>
    asString(wallet, "wallet_type") === "customer" &&
    asString(wallet, "owner_entity_type") === "user" &&
    asString(wallet, "owner_entity_id") === customerId &&
    asString(wallet, "currency_code") === currency &&
    asString(wallet, "status") === "active"
  ), [walletsQuery.data, customerId, currency]);
  const [selectedWalletId, setSelectedWalletId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const walletBalances = balancesQuery.data ?? [];
  const walletWithBalance = customerWallets.map((wallet) => ({
    ...wallet,
    balance: walletBalances.find((item) => asString(item, "wallet_id") === asString(wallet, "id"))?.balance ?? 0,
  }));
  const selectedWallet = walletWithBalance.find((wallet) => asString(wallet, "id") === selectedWalletId) ?? walletWithBalance[0] ?? null;
  const total = asNumber(booking, "total_customer_charge") ?? 0;
  const bookingFee = asNumber(booking, "customer_booking_fee_amount") ?? 0;
  const delivery = asNumber(booking, "delivery_amount") ?? 0;
  const providerReceival = asNumber(booking, "provider_receival_fee_amount") ?? 0;
  const status = asString(booking, "status") ?? "awaiting_payment";
  const paymentMode = asString(booking, "payment_mode") ?? "online_wallet";
  const balance = Number(selectedWallet?.balance ?? 0);
  const requiredFromCustomer = paymentMode === "offline" ? bookingFee : total;
  const enoughBalance = Number.isFinite(balance) && balance >= requiredFromCustomer;

  const payOnline = useMutation({
    mutationFn: async () => api.post("/runtime/logistics/bookings/pay", {
      bookingId,
      walletId: asString(selectedWallet, "id"),
      idempotencyKey: createClientIdempotencyKey("logistics.booking.pay", bookingId),
    }, z.record(z.string(), z.unknown())),
    onSuccess: async () => { setError(null); await bookings.refetch(); },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "Wallet payment could not be completed."),
  });
  const confirmOffline = useMutation({
    mutationFn: async () => api.post("/runtime/logistics/bookings/offline/confirm", {
      bookingId,
      walletId: asString(selectedWallet, "id"),
      idempotencyKey: createClientIdempotencyKey("logistics.booking.offline-confirm", bookingId),
    }, z.record(z.string(), z.unknown())),
    onSuccess: async () => { setError(null); await bookings.refetch(); },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "Offline fee confirmation could not be completed."),
  });
  const refresh = async () => { await Promise.all([bookings.refetch(), walletsQuery.refetch(), balancesQuery.refetch()]); };
  const isWorking = payOnline.isPending || confirmOffline.isPending;

  return (
    <Screen eyebrow="BOOKING" title="Booking & payment" subtitle="Review the total and complete the payment step securely."
      action={<AppButton label="Back" size="sm" variant="secondary" icon={<ArrowLeft color={palette.ink} size={15} />} onPress={() => router.back()} />}
      refreshControl={<RefreshControl refreshing={bookings.isRefetching || walletsQuery.isRefetching || balancesQuery.isRefetching} onRefresh={() => void refresh()} tintColor={palette.brand} />}>
      {bookings.isPending ? <ScreenSkeleton cards={3} /> : !booking ? (
        <StatePanel title="Booking not found" description="This booking may not be available to the signed-in account." retry={() => void bookings.refetch()} />
      ) : (
        <View style={styles.content}>
          <Card variant={status === "payment_reserved" || status === "offline_payment_confirmed" ? "success" : "default"} padding="lg">
            <View style={styles.bookingHead}>
              <View style={[styles.bookingIcon, { backgroundColor: status === "payment_reserved" || status === "offline_payment_confirmed" ? palette.successSoft : palette.brandSoft }]}>
                {status === "payment_reserved" || status === "offline_payment_confirmed" ? <CheckCircle2 color={palette.success} size={21} /> : <LockKeyhole color={palette.brand} size={21} />}
              </View>
              <View style={styles.bookingCopy}>
                <Text style={[styles.bookingTitle, { color: palette.ink }]}>Logistics booking</Text>
                <Text style={[styles.bookingRef, { color: palette.muted }]}>{bookingId?.slice(0, 8).toUpperCase()}</Text>
              </View>
              <StatusPill status={status} />
            </View>
            <Text style={[styles.totalEyebrow, { color: palette.muted }]}>TOTAL CUSTOMER CHARGE</Text>
            <Text style={[styles.total, { color: palette.ink }]}>{formatMoney(total, currency)}</Text>
            <Text style={[styles.totalHint, { color: palette.muted }]}>Includes the provider delivery price and your configured customer booking fee.</Text>
            <View style={[styles.amountDivider, { backgroundColor: palette.border }]} />
            <AmountLine label="Provider delivery price" value={formatMoney(delivery, currency)} />
            <AmountLine label="Customer booking fee" value={formatMoney(bookingFee, currency)} />
            {paymentMode === "offline" ? <AmountLine label="Provider receival fee" value="Paid by the company" subtle /> : null}
            {paymentMode === "online_wallet" && (asNumber(booking, "provider_commission_amount") ?? 0) > 0 ? <AmountLine label="Provider commission" value="Deducted from provider proceeds" subtle /> : null}
          </Card>

          {paymentMode === "online_wallet" ? (
            <Card padding="lg">
              <View style={styles.sectionHeading}>
                <View style={[styles.sectionIcon, { backgroundColor: palette.brandSoft }]}><WalletCards color={palette.brand} size={19} /></View>
                <View style={styles.sectionCopy}>
                  <Text style={[styles.sectionTitle, { color: palette.ink }]}>Pay from your wallet</Text>
                  <Text style={[styles.sectionDescription, { color: palette.muted }]}>The full delivery amount and booking fee are reserved securely in escrow.</Text>
                </View>
              </View>
              <WalletPicker wallets={walletWithBalance} selectedId={selectedWalletId || asString(selectedWallet, "id") || ""} onSelect={setSelectedWalletId} />
              {walletWithBalance.length === 0 ? <StatePanel title="No active wallet found" description={`An active customer wallet in ${currency} is required for this booking.`} /> : (
                <View style={[styles.balanceRow, { backgroundColor: palette.surfaceSubtle }]}>
                  <Text style={[styles.balanceLabel, { color: palette.muted }]}>Available balance</Text>
                  <Text style={[styles.balanceValue, { color: palette.ink }]}>{formatMoney(balance, currency)}</Text>
                </View>
              )}
              <AppButton label="Pay securely" fullWidth loading={payOnline.isPending} disabled={!selectedWallet || !enoughBalance || status !== "awaiting_payment"} onPress={() => { setError(null); payOnline.mutate(); }} icon={<LockKeyhole color="#FFFFFF" size={16} />} />
              {selectedWallet && !enoughBalance ? <Text style={[styles.inlineError, { color: palette.danger }]}>Your selected wallet does not have enough balance for this booking.</Text> : null}
            </Card>
          ) : (
            <Card padding="lg">
              <View style={styles.sectionHeading}>
                <View style={[styles.sectionIcon, { backgroundColor: palette.successSoft }]}><ShieldCheck color={palette.success} size={19} /></View>
                <View style={styles.sectionCopy}>
                  <Text style={[styles.sectionTitle, { color: palette.ink }]}>Offline payment</Text>
                  <Text style={[styles.sectionDescription, { color: palette.muted }]}>Your wallet pays the customer booking fee. The provider receival fee is separately charged to the company’s wallet.</Text>
                </View>
              </View>
              <WalletPicker wallets={walletWithBalance} selectedId={selectedWalletId || asString(selectedWallet, "id") || ""} onSelect={setSelectedWalletId} />
              {walletWithBalance.length === 0 ? <StatePanel title="No active wallet found" description={`An active customer wallet in ${currency} is required to collect your booking fee.`} /> : (
                <View style={[styles.balanceRow, { backgroundColor: palette.surfaceSubtle }]}>
                  <Text style={[styles.balanceLabel, { color: palette.muted }]}>Your wallet · booking fee only</Text>
                  <Text style={[styles.balanceValue, { color: palette.ink }]}>{formatMoney(balance, currency)}</Text>
                </View>
              )}
              <AppButton label="Confirm offline booking fee" fullWidth loading={confirmOffline.isPending} disabled={!selectedWallet || !enoughBalance || status !== "awaiting_offline_confirmation"} onPress={() => { setError(null); confirmOffline.mutate(); }} />
              {selectedWallet && !enoughBalance ? <Text style={[styles.inlineError, { color: palette.danger }]}>Your selected wallet does not have enough balance for the booking fee.</Text> : null}
            </Card>
          )}

          {status === "payment_reserved" ? (
            <Card variant="success" padding="lg">
              <View style={styles.sectionHeading}><ShieldCheck color={palette.success} size={21} /><Text style={[styles.sectionTitle, { color: palette.ink }]}>Payment protected in escrow</Text></View>
              <Text style={[styles.sectionDescription, { color: palette.muted }]}>Your online payment is reserved. The provider settlement follows the verified delivery process.</Text>
            </Card>
          ) : null}
          {status === "offline_payment_confirmed" ? (
            <Card variant="success" padding="lg">
              <View style={styles.sectionHeading}><CheckCircle2 color={palette.success} size={21} /><Text style={[styles.sectionTitle, { color: palette.ink }]}>Booking fee confirmed</Text></View>
              <Text style={[styles.sectionDescription, { color: palette.muted }]}>Your customer booking fee has been recorded. The company’s receival fee was handled separately.</Text>
            </Card>
          ) : null}

          {error ? <View style={[styles.error, { backgroundColor: palette.dangerSoft }]}><AlertCircle color={palette.danger} size={16} /><Text style={[styles.inlineError, { color: palette.danger }]}>{error}</Text></View> : null}
        </View>
      )}
    </Screen>
  );
}

function WalletPicker({ wallets, selectedId, onSelect }: { wallets: Record<string, unknown>[]; selectedId: string; onSelect(id: string): void }) {
  const { palette } = useAppTheme();
  if (!wallets.length) return null;
  return (
    <View style={styles.walletList}>
      {wallets.map((wallet, index) => {
        const id = asString(wallet, "id") ?? "";
        const selected = selectedId === id;
        const balance = Number(wallet.balance ?? 0);
        return (
          <Pressable key={id || index} onPress={() => onSelect(id)} style={[styles.walletChoice, { borderColor: selected ? palette.brand : palette.border, backgroundColor: selected ? palette.brandSofter : palette.surface }]}>
            <View style={[styles.walletIcon, { backgroundColor: palette.brandSoft }]}><WalletCards color={palette.brand} size={17} /></View>
            <View style={styles.walletCopy}>
              <Text style={[styles.walletName, { color: palette.ink }]}>{asString(wallet, "currency_code") ?? "Wallet"} wallet</Text>
              <Text style={[styles.walletBalance, { color: palette.muted }]}>{formatMoney(balance, asString(wallet, "currency_code") ?? "")} available</Text>
            </View>
            <View style={[styles.radio, { borderColor: selected ? palette.brand : palette.borderStrong }]}>{selected ? <View style={[styles.radioDot, { backgroundColor: palette.brand }]} /> : null}</View>
          </Pressable>
        );
      })}
    </View>
  );
}
function AmountLine({ label, value, subtle = false }: { label: string; value: string; subtle?: boolean }) {
  const { palette } = useAppTheme();
  return <View style={styles.amountLine}><Text style={[styles.amountLabel, { color: palette.muted }]}>{label}</Text><Text style={[styles.amountValue, { color: subtle ? palette.muted : palette.ink }]}>{value}</Text></View>;
}
function formatMoney(amount: number, currency: string) {
  if (!currency) return amount.toLocaleString("en-NG");
  try { return new Intl.NumberFormat("en-NG", { style: "currency", currency }).format(amount); }
  catch { return `${currency} ${amount.toLocaleString("en-NG")}`; }
}
const styles = StyleSheet.create({
  content: { gap: spacing.md },
  bookingHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  bookingIcon: { width: 43, height: 43, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  bookingCopy: { flex: 1, gap: 2 },
  bookingTitle: { ...typography.bodyStrong, fontSize: 14 },
  bookingRef: { ...typography.caption, fontSize: 9 },
  totalEyebrow: { ...typography.eyebrow, fontSize: 8, marginTop: 5 },
  total: { ...typography.display, fontSize: 31, lineHeight: 37 },
  totalHint: { ...typography.caption, lineHeight: 17, fontSize: 10 },
  amountDivider: { height: StyleSheet.hairlineWidth, marginVertical: 3 },
  amountLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  amountLabel: { ...typography.caption, fontSize: 10 },
  amountValue: { ...typography.caption, fontWeight: "900", fontSize: 11, textAlign: "right" },
  sectionHeading: { flexDirection: "row", alignItems: "center", gap: 9 },
  sectionIcon: { width: 40, height: 40, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  sectionCopy: { flex: 1, gap: 2 },
  sectionTitle: { ...typography.bodyStrong, fontSize: 13 },
  sectionDescription: { ...typography.caption, lineHeight: 17, fontSize: 10 },
  balanceRow: { borderRadius: radii.lg, padding: 12, gap: 4 },
  balanceLabel: { ...typography.caption, fontSize: 9 },
  balanceValue: { ...typography.bodyStrong, fontSize: 15 },
  walletList: { gap: 8 },
  walletChoice: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: radii.lg, padding: 10 },
  walletIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  walletCopy: { flex: 1, gap: 2 },
  walletName: { ...typography.bodyStrong, fontSize: 11 },
  walletBalance: { ...typography.caption, fontSize: 9 },
  radio: { width: 19, height: 19, borderRadius: 10, borderWidth: 1.6, alignItems: "center", justifyContent: "center" },
  radioDot: { width: 9, height: 9, borderRadius: 5 },
  inlineError: { ...typography.caption, fontSize: 10, flex: 1, lineHeight: 17 },
  error: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderRadius: radii.md, padding: spacing.md },
});
