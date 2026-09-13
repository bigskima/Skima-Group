import { router } from "expo-router";
import { ArrowDownToLine, Clock3, ReceiptText, WalletCards } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { domainQueries } from "../api/domains";
import { useWalletActivity } from "../api/walletActivity";
import { firstNumber, firstString, type PlatformRecord } from "../api/records";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { canonicalTransactionStatus } from "../utilities/transactionStatus";
import { selectWorkspaceWallet, walletRecordId } from "../utilities/financeWallet";
import { AiContextAction } from "./AiContextAction";
import { AppButton } from "./AppButton";
import { EmptyState } from "./EmptyState";
import { FinancialActivityRow } from "./FinancialActivityRow";
import { RequestFailureState } from "./RequestFailureState";
import { Screen } from "./Screen";
import { ScreenSkeleton } from "./ScreenSkeleton";
import { SectionHeader } from "./SectionHeader";

type ActivityFilter = "all" | "money_in" | "money_out" | "issues";
const PAGE_SIZE = 8;

export function FinanceScreen({ workspace }: { workspace: "driver" | "station" }) {
  const { palette } = useAppTheme();
  const wallets = domainQueries.wallets();
  const wallet = selectWorkspaceWallet(wallets.data ?? [], workspace);
  const walletId = walletRecordId(wallet);
  const history = useWalletActivity(walletId, 100);
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const currency = firstString(wallet, ["currency_code", "currencyCode"]) ?? "NGN";
  const available = firstNumber(wallet, ["available_balance", "availableBalance", "balance"]) ?? 0;
  const activity = history.data?.items ?? [];
  const pendingCount = activity.filter((item) => {
    const status = canonicalTransactionStatus(firstString(item, ["status"]));
    return status === "pending" || status === "processing";
  }).length;
  const withdrawalCount = activity.filter((item) => activityType(item) === "withdrawal").length;
  const filteredActivity = useMemo(
    () => activity.filter((item) => {
      if (filter === "money_in") return firstString(item, ["direction"]) === "credit";
      if (filter === "money_out") return firstString(item, ["direction"]) === "debit";
      if (filter === "issues") {
        return ["cancelled", "failed", "reversed", "expired"].includes(
          canonicalTransactionStatus(firstString(item, ["status"])),
        );
      }
      return true;
    }),
    [activity, filter],
  );
  const visibleActivity = filteredActivity.slice(0, visibleCount);
  const withdrawPath = `/${workspace === "driver" ? "(driver)" : "(station)"}/withdraw` as never;
  const financeError = wallets.error ?? history.error;

  const selectFilter = (next: ActivityFilter) => {
    setFilter(next);
    setVisibleCount(PAGE_SIZE);
  };

  return (
    <Screen
      eyebrow={workspace === "driver" ? "Driver finance" : "Station finance"}
      title="Earnings & activity"
      subtitle={
        workspace === "driver"
          ? "See your available balance, delivery earnings, withdrawals and other wallet movements."
          : "See your available balance, LPG earnings, withdrawals and other station wallet movements."
      }
      action={<AppButton label="Withdraw" size="sm" icon={<ArrowDownToLine color="#FFFFFF" size={16} />} onPress={() => router.push(withdrawPath)} />}
    >
      <View style={[styles.hero, shadows.raised, { backgroundColor: palette.brand }]}>
        <View style={styles.heroTop}>
          <View style={styles.heroCopy}>
            <Text style={styles.heroEyebrow}>AVAILABLE TO WITHDRAW</Text>
            <Text adjustsFontSizeToFit numberOfLines={1} style={styles.heroAmount}>{money(available, currency)}</Text>
          </View>
          <View style={styles.heroIcon}><WalletCards color="#FFFFFF" size={27} /></View>
        </View>
        <Text style={styles.heroBody}>This is your spendable wallet balance, not a sum of every activity record shown below.</Text>
      </View>

      {wallets.isPending || (Boolean(walletId) && history.isPending) ? (
        <ScreenSkeleton cards={4} />
      ) : financeError ? (
        <RequestFailureState
          error={financeError}
          onRetry={() => void Promise.all([wallets.refetch(), history.refetch()])}
          overrides={workspace === "station" ? {
            permission: {
              title: "Financial activity access restricted",
              description: "You do not have permission to view financial activity for this station. Access is limited to the Station Owner or operators explicitly granted finance permission.",
            },
            role: {
              title: "Finance role required",
              description: "Your Station role does not include financial history. Ask the Station Owner to grant the appropriate finance permission if you need it.",
            },
            station_scope: {
              title: "Financial activity access restricted",
              description: "This wallet belongs to another station, or your access to this station has changed.",
            },
          } : undefined}
        />
      ) : !wallet || !walletId ? (
        <EmptyState
          icon={<WalletCards color={palette.brand} size={27} />}
          title="Wallet not available yet"
          description={workspace === "driver" ? "Your Driver wallet will appear when your approved Driver account is financially active." : "This Station wallet is not available for your current account or role."}
        />
      ) : (
        <>
          <View style={styles.metricGrid}>
            <Metric icon={<ReceiptText color={palette.brand} size={19} />} label="Recent activity" value={String(history.data?.totalCount ?? activity.length)} />
            <Metric icon={<Clock3 color={palette.warning} size={19} />} label="Pending" value={String(pendingCount)} />
            <Metric icon={<ArrowDownToLine color={palette.brand} size={19} />} label="Withdrawals" value={String(withdrawalCount)} />
          </View>

          {workspace === "driver" ? (
            <AiContextAction
              workspace="driver"
              label="Explain my earnings"
              detail="Ask about posted delivery pay, pending movements or withdrawals. Nothing is sent until you choose Send. Nothing is moved until you choose an action."
              prompt="Explain my recent Driver wallet activity using only records I can access. Distinguish posted delivery earnings, pending or processing movements, withdrawals, refunds and reversals. Do not estimate earnings, expose internal ledger accounts, move funds or change a payout."
            />
          ) : (
            <AiContextAction
              workspace="station"
              label="Explain station earnings"
              detail="Ask about LPG earnings, pending movements, withdrawals or refunds. Nothing is sent until you choose Send. Nothing is moved until you choose an action."
              prompt="Explain my recent Station wallet activity using only records I can access. Distinguish posted LPG earnings, pending or processing movements, withdrawals, refunds and reversals. Do not expose platform margin, Driver payout, escrow accounts or internal ledger implementation, and do not move funds."
            />
          )}

          <SectionHeader
            title="Financial history"
            description="Public-facing wallet activity only. SKIMA internal accounts, provider diagnostics and reconciliation metadata are intentionally hidden."
          />

          <View style={styles.filters}>
            <FilterChip label="All" active={filter === "all"} onPress={() => selectFilter("all")} />
            <FilterChip label="Money in" active={filter === "money_in"} onPress={() => selectFilter("money_in")} />
            <FilterChip label="Money out" active={filter === "money_out"} onPress={() => selectFilter("money_out")} />
            <FilterChip label="Issues" active={filter === "issues"} onPress={() => selectFilter("issues")} />
          </View>

          {visibleActivity.length ? (
            <View style={styles.activityList}>
              {visibleActivity.map((item, index) => (
                <FinancialActivityRow
                  key={firstString(item, ["activityKey", "activity_key"]) ?? String(index)}
                  item={item}
                />
              ))}
            </View>
          ) : (
            <EmptyState
              icon={<ReceiptText color={palette.brand} size={26} />}
              title={filter === "all" ? "No financial activity yet" : "No matching activity"}
              description={filter === "all" ? (workspace === "driver" ? "Delivery earnings, withdrawals, refunds and other Driver wallet activity will appear here." : "Station earnings, withdrawals, refunds and other Station wallet activity will appear here.") : "Choose another filter to review the wallet history."}
            />
          )}

          {visibleCount < filteredActivity.length ? (
            <AppButton
              label={`Show ${Math.min(PAGE_SIZE, filteredActivity.length - visibleCount)} older items`}
              variant="secondary"
              fullWidth
              onPress={() => setVisibleCount((count) => count + PAGE_SIZE)}
            />
          ) : null}

          {history.data?.hasMore ? (
            <View style={[styles.limitNote, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
              <ReceiptText color={palette.mutedStrong} size={17} />
              <Text style={[styles.limitText, { color: palette.muted }]}>Showing the latest 100 wallet activities. Older records remain preserved in SKIMA financial history.</Text>
            </View>
          ) : null}

          <View style={[styles.ledgerNote, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
            <WalletCards color={palette.mutedStrong} size={18} />
            <Text style={[styles.ledgerText, { color: palette.muted }]}>Balances and financial history update from canonical backend states. A record is not treated as successful merely because it exists.</Text>
          </View>
        </>
      )}
    </Screen>
  );
}

function activityType(item: PlatformRecord) {
  return firstString(item, ["type", "activityType", "activity_type"]) ?? "transaction";
}

function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress(): void }) {
  const { palette } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.filterChip,
        {
          backgroundColor: active ? palette.brandSoft : palette.surface,
          borderColor: active ? palette.brand : palette.border,
          opacity: pressed ? 0.76 : 1,
        },
      ]}
    >
      <Text style={[styles.filterText, { color: active ? palette.brand : palette.mutedStrong }]}>{label}</Text>
    </Pressable>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  const { palette } = useAppTheme();
  return (
    <View style={[styles.metric, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <View style={[styles.metricIcon, { backgroundColor: palette.brandSoft }]}>{icon}</View>
      <Text style={[styles.metricValue, { color: palette.ink }]}>{value}</Text>
      <Text style={[styles.metricLabel, { color: palette.muted }]}>{label}</Text>
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
  hero: { gap: spacing.md, padding: spacing.lg, borderRadius: radii.xl },
  heroTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: spacing.md },
  heroCopy: { flex: 1 },
  heroEyebrow: { color: "rgba(255,255,255,.72)", ...typography.eyebrow, fontSize: 9 },
  heroAmount: { color: "#FFFFFF", fontSize: 37, lineHeight: 44, fontWeight: "900", letterSpacing: -1, marginTop: 5 },
  heroIcon: { width: 50, height: 50, borderRadius: 17, backgroundColor: "rgba(255,255,255,.14)", alignItems: "center", justifyContent: "center" },
  heroBody: { color: "rgba(255,255,255,.84)", ...typography.caption, lineHeight: 18 },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  metric: { flex: 1, minWidth: 100, gap: 5, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  metricIcon: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  metricValue: { ...typography.heading, fontSize: 21 },
  metricLabel: { ...typography.caption },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  filterChip: { minHeight: 38, justifyContent: "center", borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: 13 },
  filterText: { ...typography.caption, fontSize: 10, fontWeight: "900" },
  activityList: { gap: spacing.sm },
  limitNote: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  limitText: { flex: 1, ...typography.caption, lineHeight: 17 },
  ledgerNote: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm + 2, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  ledgerText: { flex: 1, ...typography.caption, lineHeight: 18 },
});