import { router } from "expo-router";
import {
  ArrowDownLeft,
  ArrowUpRight,
  History,
  Plus,
  ShieldCheck,
} from "lucide-react-native";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { domainQueries } from "../api/domains";
import {
  displayReference,
  displayStatus,
  firstNumber,
  firstString,
  recordId,
} from "../api/records";
import { useAppTheme } from "../theme/ThemeProvider";
import { colors, radii, shadows, spacing, typography } from "../theme/tokens";
import { selectWorkspaceWallet } from "../utilities/financeWallet";
import { AppButton } from "./AppButton";
import { Card } from "./Card";
import { EmptyState } from "./EmptyState";
import { Screen } from "./Screen";
import { SectionHeader } from "./SectionHeader";
import { StatusPill } from "./StatusPill";

export function CustomerWalletScreen() {
  const { palette } = useAppTheme();
  const wallets = domainQueries.wallets();
  const transactions = domainQueries.transactions();
  const wallet = selectWorkspaceWallet(wallets.data ?? [], "customer");
  const currency = firstString(wallet, ["currency_code", "currencyCode"]) ?? "NGN";
  const available = firstNumber(wallet, ["available_balance", "availableBalance", "balance"]) ?? 0;
  const pending = firstNumber(wallet, ["pending_balance", "pendingBalance", "reserved_balance", "reservedBalance"]) ?? 0;

  return (
    <Screen
      eyebrow="Your money"
      title="Wallet"
      subtitle="One SKIMA balance for payments, refunds, and eligible withdrawals."
      action={
        <AppButton
          label="Top up"
          size="sm"
          icon={<Plus color="#FFFFFF" size={16} />}
          onPress={() => router.push("/(customer)/wallet/top-up" as never)}
        />
      }
    >
      {wallets.isPending ? (
        <View style={styles.loading}>
          <ActivityIndicator color={palette.brand} />
        </View>
      ) : (
        <>
          <View style={[styles.hero, shadows.raised, { backgroundColor: palette.brand }]}>
            <View style={styles.heroHead}>
              <View style={styles.heroCopy}>
                <Text style={styles.heroLabel}>AVAILABLE BALANCE</Text>
                <Text adjustsFontSizeToFit numberOfLines={1} style={styles.heroValue}>
                  {money(available, currency)}
                </Text>
              </View>
              <View style={styles.shield}>
                <ShieldCheck color="#FFFFFF" size={24} />
              </View>
            </View>
            <View style={styles.heroFooter}>
              <View>
                <Text style={styles.heroMeta}>Pending or reserved</Text>
                <Text style={styles.heroPending}>{money(pending, currency)}</Text>
              </View>
              <Text style={styles.heroTrust}>Protected by SKIMA payment controls</Text>
            </View>
          </View>

          <View style={styles.actions}>
            <WalletAction
              icon={<Plus color={palette.brand} size={20} />}
              label="Top up"
              onPress={() => router.push("/(customer)/wallet/top-up" as never)}
            />
            <WalletAction
              icon={<ArrowUpRight color={palette.brand} size={20} />}
              label="Withdraw"
              onPress={() => router.push("/(customer)/wallet/withdraw" as never)}
            />
            <WalletAction
              icon={<History color={palette.brand} size={20} />}
              label="History"
              onPress={() => router.push("/(customer)/transactions" as never)}
            />
          </View>

          <SectionHeader
            title="Recent top-ups"
            description="Latest wallet top-up attempts and their current status."
            action={
              <Pressable onPress={() => router.push("/(customer)/transactions" as never)}>
                <Text style={[styles.link, { color: palette.brand }]}>See all</Text>
              </Pressable>
            }
          />

          {transactions.isPending ? (
            <View style={styles.loadingCompact}>
              <ActivityIndicator color={palette.brand} />
            </View>
          ) : (transactions.data ?? []).length > 0 ? (
            <View style={styles.transactionList}>
              {(transactions.data ?? []).slice(0, 5).map((item, index) => {
                const status = displayStatus(item) ?? "recorded";
                const amount = Math.abs(firstNumber(item, ["amount", "net_amount", "netAmount"]) ?? 0);
                const reference = displayReference(item) ?? "SKIMA top up";
                const date = formatDate(firstString(item, ["initialized_at", "initializedAt", "created_at", "createdAt"]));
                return (
                  <Card key={recordId(item) ?? String(index)} padding="sm">
                    <View style={styles.row}>
                      <View style={[styles.txIcon, { backgroundColor: palette.successSoft }]}>
                        <ArrowDownLeft color={palette.success} size={20} />
                      </View>
                      <View style={styles.txCopy}>
                        <Text numberOfLines={1} style={[styles.txTitle, { color: palette.ink }]}>Wallet top up</Text>
                        <Text numberOfLines={1} style={[styles.meta, { color: palette.muted }]}>{reference} · {date}</Text>
                      </View>
                      <View style={styles.txRight}>
                        <Text style={[styles.amount, { color: palette.success }]}>
                          +{money(amount, firstString(item, ["currency_code", "currencyCode"]) ?? currency)}
                        </Text>
                        <StatusPill label={status} tone={statusTone(status)} />
                      </View>
                    </View>
                  </Card>
                );
              })}
            </View>
          ) : (
            <EmptyState
              icon={<History color={palette.brand} size={25} />}
              title="No top-up activity yet"
              description="Wallet top-ups will appear here after you start a payment."
              action={
                <AppButton
                  label="Top up wallet"
                  onPress={() => router.push("/(customer)/wallet/top-up" as never)}
                />
              }
            />
          )}
        </>
      )}
    </Screen>
  );
}

function WalletAction({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress(): void }) {
  const { palette } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        { backgroundColor: palette.surface, borderColor: palette.border, opacity: pressed ? 0.76 : 1 },
      ]}
    >
      <View style={[styles.actionIcon, { backgroundColor: palette.brandSoft }]}>{icon}</View>
      <Text style={[styles.actionText, { color: palette.ink }]}>{label}</Text>
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
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function statusTone(status: string): "neutral" | "brand" | "success" | "warning" | "danger" {
  if (/success|completed|settled|approved|credited/i.test(status)) return "success";
  if (/fail|reject|cancel|revers/i.test(status)) return "danger";
  if (/pending|processing|review|hold/i.test(status)) return "warning";
  if (/active|recorded/i.test(status)) return "brand";
  return "neutral";
}

const styles = StyleSheet.create({
  loading: { minHeight: 220, alignItems: "center", justifyContent: "center" },
  loadingCompact: { minHeight: 90, alignItems: "center", justifyContent: "center" },
  hero: { padding: spacing.lg, gap: spacing.lg, borderRadius: radii.xl },
  heroHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: spacing.md },
  heroCopy: { flex: 1 },
  heroLabel: { color: "#FFE4E8", fontSize: 10, letterSpacing: 1.35, fontWeight: "900" },
  heroValue: { color: "#FFFFFF", fontSize: 38, lineHeight: 46, fontWeight: "900", letterSpacing: -1.25, marginTop: 7 },
  shield: { width: 48, height: 48, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,.16)" },
  heroFooter: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(255,255,255,.24)", paddingTop: spacing.md },
  heroMeta: { color: "#FFE9EC", ...typography.caption },
  heroPending: { color: "#FFFFFF", ...typography.bodyStrong, marginTop: 2 },
  heroTrust: { color: "rgba(255,255,255,.78)", ...typography.caption, textAlign: "right", maxWidth: 170 },
  actions: { flexDirection: "row", gap: spacing.sm },
  action: { flex: 1, alignItems: "center", gap: 7, paddingVertical: 13, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg },
  actionIcon: { width: 40, height: 40, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  actionText: { ...typography.caption, fontWeight: "800" },
  link: { ...typography.caption, fontWeight: "900" },
  transactionList: { gap: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  txIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  txCopy: { flex: 1, minWidth: 0 },
  txTitle: { ...typography.bodyStrong },
  meta: { ...typography.caption, marginTop: 3 },
  txRight: { alignItems: "flex-end", gap: 6 },
  amount: { ...typography.bodyStrong },
});
