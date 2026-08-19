import { router } from "expo-router";
import { ArrowDownLeft, ArrowUpRight, History, Plus, ShieldCheck } from "lucide-react-native";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { domainQueries } from "../api/domains";
import { displayReference, displayStatus, firstNumber, firstString, recordId } from "../api/records";
import { colors, radii, spacing } from "../theme/tokens";
import { Card } from "./Card";
import { Screen } from "./Screen";

export function CustomerWalletScreen() {
  const wallets = domainQueries.wallets();
  const transactions = domainQueries.transactions();
  const wallet = wallets.data?.[0];
  const currency = firstString(wallet, ["currency_code", "currencyCode"]) ?? "NGN";
  const available = firstNumber(wallet, ["available_balance", "availableBalance", "balance"]) ?? 0;
  const pending = firstNumber(wallet, ["pending_balance", "pendingBalance", "reserved_balance", "reservedBalance"]) ?? 0;

  return (
    <Screen
      eyebrow="Your money"
      title="Wallet"
      action={
        <View style={styles.headerActions}>
          <Pressable onPress={() => router.push("/(customer)/wallet/top-up" as never)} style={styles.topup}>
            <Plus color="white" size={16} />
            <Text style={styles.topupText}>Top up</Text>
          </Pressable>
          <Pressable onPress={() => router.push("/(customer)/wallet/withdraw" as never)} style={styles.withdrawHeader}>
            <ArrowUpRight color={colors.brand} size={16} />
            <Text style={styles.withdrawHeaderText}>Withdraw</Text>
          </Pressable>
        </View>
      }
    >
      {wallets.isPending ? (
        <ActivityIndicator color={colors.brand} />
      ) : (
        <>
          <View style={styles.hero}>
            <View style={styles.heroHead}>
              <View>
                <Text style={styles.heroLabel}>AVAILABLE BALANCE</Text>
                <Text style={styles.heroValue}>{money(available, currency)}</Text>
              </View>
              <View style={styles.shield}>
                <ShieldCheck color="white" size={25} />
              </View>
            </View>
            <View style={styles.heroFooter}>
              <Text style={styles.heroMeta}>Pending or reserved</Text>
              <Text style={styles.heroPending}>{money(pending, currency)}</Text>
            </View>
          </View>
          <View style={styles.actions}>
            <Action icon={Plus} label="Top up" onPress={() => router.push("/(customer)/wallet/top-up" as never)} />
            <Action icon={ArrowUpRight} label="Withdraw" onPress={() => router.push("/(customer)/wallet/withdraw" as never)} />
            <Action icon={History} label="History" onPress={() => router.push("/(customer)/transactions" as never)} />
          </View>
          <View style={styles.heading}>
            <Text style={styles.section}>Recent activity</Text>
            <Pressable onPress={() => router.push("/(customer)/transactions" as never)}>
              <Text style={styles.link}>See all</Text>
            </Pressable>
          </View>
          {transactions.isPending ? (
            <ActivityIndicator color={colors.brand} />
          ) : (
            (transactions.data ?? []).slice(0, 5).map((item, index) => (
              <Card key={recordId(item) ?? String(index)}>
                <View style={styles.row}>
                  <View style={styles.txIcon}>
                    <ArrowDownLeft color={colors.success} size={21} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title}>{displayReference(item) ?? "Wallet transaction"}</Text>
                    <Text style={styles.meta}>
                      {formatDate(firstString(item, ["created_at", "createdAt"]))} · {(displayStatus(item) ?? "recorded").replace(/[_-]/g, " ")}
                    </Text>
                  </View>
                  <Text style={styles.amount}>
                    {money(
                      firstNumber(item, ["amount", "net_amount", "netAmount"]) ?? 0,
                      firstString(item, ["currency_code", "currencyCode"]) ?? currency,
                    )}
                  </Text>
                </View>
              </Card>
            ))
          )}
          {(transactions.data ?? []).length === 0 && !transactions.isPending ? (
            <View style={styles.empty}>
              <History color={colors.brand} size={30} />
              <Text style={styles.title}>No wallet activity yet</Text>
              <Text style={styles.meta}>Paystack deposits, withdrawals, and updates will appear here.</Text>
            </View>
          ) : null}
        </>
      )}
    </Screen>
  );
}

function Action({ icon: Icon, label, onPress }: { icon: typeof Plus; label: string; onPress(): void }) {
  return (
    <Pressable onPress={onPress} style={styles.action}>
      <View style={styles.actionIcon}>
        <Icon color={colors.brand} size={20} />
      </View>
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

function money(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function formatDate(value: string | null) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: "row", gap: 8 },
  topup: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.brand, paddingHorizontal: 14, paddingVertical: 8, borderRadius: radii.pill },
  topupText: { color: "white", fontWeight: "900", fontSize: 13 },
  withdrawHeader: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.brand, paddingHorizontal: 14, paddingVertical: 8, borderRadius: radii.pill },
  withdrawHeaderText: { color: colors.brand, fontWeight: "900", fontSize: 13 },
  hero: { padding: spacing.xl, gap: spacing.xl, borderRadius: 24, backgroundColor: colors.brand },
  heroHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  heroLabel: { color: "#FFDDE1", fontSize: 11, letterSpacing: 1.3, fontWeight: "900" },
  heroValue: { color: "white", fontSize: 39, fontWeight: "900", marginTop: 7 },
  shield: { width: 50, height: 50, borderRadius: 25, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,.16)" },
  heroFooter: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: "rgba(255,255,255,.2)", paddingTop: spacing.md },
  heroMeta: { color: "#FFF1F2" },
  heroPending: { color: "white", fontWeight: "900" },
  actions: { flexDirection: "row", gap: spacing.sm },
  action: { flex: 1, alignItems: "center", gap: 6, paddingVertical: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, backgroundColor: colors.surface },
  actionIcon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: "#FFF0F1" },
  actionText: { color: colors.ink, fontWeight: "800", fontSize: 11 },
  heading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  section: { color: colors.ink, fontSize: 21, fontWeight: "900" },
  link: { color: colors.brand, fontWeight: "900" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  txIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "#E9F7EE" },
  title: { color: colors.ink, fontWeight: "900" },
  meta: { color: colors.muted, lineHeight: 19, marginTop: 4, textTransform: "capitalize" },
  amount: { color: colors.ink, fontWeight: "900" },
  empty: { alignItems: "center", gap: spacing.sm, padding: spacing.xl, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, backgroundColor: colors.surface },
});
