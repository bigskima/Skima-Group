import { router } from "expo-router";
import { ArrowDownLeft, ArrowLeft, ArrowUpRight, WalletCards } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useLogisticsQuery, asNumber, asString } from "../api/logistics";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, typography } from "../theme/tokens";
import { Screen } from "../ui/Screen";
import { ScreenSkeleton } from "../ui/ScreenSkeleton";
import { StatePanel } from "../ui/StatePanel";

const money = (amount: number, code: string) => {
  try { return new Intl.NumberFormat("en-NG", { style: "currency", currency: code, maximumFractionDigits: 2 }).format(amount); }
  catch { return `${code} ${amount.toFixed(2)}`; }
};

export function CustomerWalletScreen() {
  const { palette } = useAppTheme();
  const { session } = useSession();
  const wallets = useLogisticsQuery(["customer-wallets"], "/runtime/wallets", true, 30000);
  const balances = useLogisticsQuery(["customer-wallet-balances"], "/runtime/wallet-balances", true, 30000);
  const mine = (wallets.data ?? []).filter(wallet =>
    asString(wallet, "wallet_type", "walletType") === "customer" &&
    asString(wallet, "owner_entity_type", "ownerEntityType") === "user" &&
    asString(wallet, "owner_entity_id", "ownerEntityId") === session?.user.id &&
    !["closed", "disabled"].includes((asString(wallet, "status", "wallet_status") ?? "").toLowerCase())
  );
  return <Screen title="SKIMA Wallet" denseHeader>
    <Pressable onPress={() => router.back()} style={styles.back}><ArrowLeft color={palette.ink} size={17} /><Text style={{ color: palette.ink, fontSize: 11, fontWeight: "800" }}>Back</Text></Pressable>
    {wallets.isPending || balances.isPending ? <ScreenSkeleton cards={2} /> :
      wallets.error || balances.error ? <StatePanel title="Wallet unavailable" description="Refresh your SKIMA Wallet." retry={() => void Promise.all([wallets.refetch(), balances.refetch()])} /> :
      mine.length ? mine.map(wallet => {
        const id = asString(wallet, "id", "wallet_id", "walletId") ?? "";
        const code = asString(wallet, "currency_code", "currencyCode") ?? "NGN";
        const balance = asNumber((balances.data ?? []).find(item => asString(item, "wallet_id", "walletId") === id), "balance")
          ?? asNumber(wallet, "available_balance", "availableBalance", "balance") ?? 0;
        return <View key={id} style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <View style={styles.head}>
            <View style={[styles.icon, { backgroundColor: palette.brandSoft }]}><WalletCards color={palette.brand} size={21} /></View>
            <View style={styles.headingCopy}><Text style={[styles.currency, { color: palette.ink }]}>{code} customer wallet</Text><Text style={[styles.hint, { color: palette.muted }]}>SKIMA Wallet</Text></View>
          </View>
          <Text style={[styles.amount, { color: palette.ink }]}>{money(balance, code)}</Text>
          <Text style={[styles.hint, { color: palette.muted }]}>Use your SKIMA Wallet to pay for eligible bookings and services.</Text>
          <View style={styles.actions}>
            <Pressable onPress={() => router.push({ pathname: "/(customer)/wallet/top-up", params: { walletId: id } } as never)} style={[styles.action, { backgroundColor: palette.brand }]}>
              <ArrowDownLeft color="#fff" size={17} /><Text style={styles.actionText}>Fund wallet</Text>
            </Pressable>
            <Pressable onPress={() => router.push({ pathname: "/(customer)/wallet/withdraw", params: { walletId: id } } as never)} style={[styles.action, styles.outline, { borderColor: palette.border }]}>
              <ArrowUpRight color={palette.brand} size={17} /><Text style={[styles.actionText, { color: palette.brand }]}>Withdraw</Text>
            </Pressable>
          </View>
        </View>;
      }) : <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <StatePanel title="Your SKIMA Wallet is not ready" description="We couldn’t open your wallet. Refresh and try again, or contact support if the problem continues." />
        <Pressable onPress={() => router.push("/(customer)/wallet/top-up" as never)} style={[styles.action, { backgroundColor: palette.brand }]}><ArrowDownLeft color="#fff" size={17} /><Text style={styles.actionText}>Fund customer wallet</Text></Pressable>
      </View>}
  </Screen>;
}
const styles = StyleSheet.create({
  back: { flexDirection: "row", alignItems: "center", gap: 7 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: 15, gap: 11 },
  head: { flexDirection: "row", alignItems: "center", gap: 9 },
  icon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  headingCopy: { flex: 1, gap: 2 },
  currency: { fontSize: 13, fontWeight: "900" },
  amount: { fontSize: 27, fontWeight: "900" },
  hint: { ...typography.caption, fontSize: 10, lineHeight: 15 },
  actions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  action: { flex: 1, minWidth: 130, minHeight: 42, borderRadius: radii.md, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  outline: { borderWidth: 1, backgroundColor: "transparent" },
  actionText: { color: "#fff", fontSize: 11, fontWeight: "900" },
});
