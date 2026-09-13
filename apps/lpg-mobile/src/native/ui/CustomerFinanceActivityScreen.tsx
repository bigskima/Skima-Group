import { ArrowDownLeft, ArrowUpRight, ReceiptText, ShieldCheck, WalletCards, Zap } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useState } from "react";
import { domainQueries } from "../api/domains";
import { useWalletActivity } from "../api/walletActivity";
import {
  displayStatus,
  firstNumber,
  firstString,
  type PlatformRecord,
} from "../api/records";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { selectWorkspaceWallet, walletRecordId } from "../utilities/financeWallet";
import { canonicalTransactionStatus, transactionStatusPresentation } from "../utilities/transactionStatus";
import { AppButton } from "./AppButton";
import { EmptyState } from "./EmptyState";
import { RequestFailureState } from "./RequestFailureState";
import { Screen } from "./Screen";
import { ScreenSkeleton } from "./ScreenSkeleton";
import { TransactionStatusPill } from "./TransactionStatusPill";

type TransactionFilter = "all" | "completed" | "pending" | "issues";
const PAGE_SIZE = 8;
const HISTORY_WINDOW = 100;

export function TransactionsScreen() {
  const { palette } = useAppTheme();
  const wallets = domainQueries.wallets();
  const wallet = selectWorkspaceWallet(wallets.data ?? [], "customer");
  const walletId = walletRecordId(wallet);
  const [filter, setFilter] = useState<TransactionFilter>("all");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const activity = useWalletActivity(walletId, HISTORY_WINDOW);
  const rows = activity.data?.items ?? [];
  const succeededCount = rows.filter((item) => canonicalTransactionStatus(displayStatus(item)) === "successful").length;
  const pendingCount = rows.filter((item) => ["pending", "processing"].includes(canonicalTransactionStatus(displayStatus(item)))).length;
  const issueCount = rows.filter((item) => ["cancelled", "failed", "reversed", "expired"].includes(canonicalTransactionStatus(displayStatus(item)))).length;
  const filteredRows = rows.filter((item) => {
    const status = canonicalTransactionStatus(displayStatus(item));
    if (filter === "completed") return status === "successful" || status === "refunded";
    if (filter === "pending") return status === "pending" || status === "processing";
    if (filter === "issues") return ["cancelled", "failed", "reversed", "expired"].includes(status);
    return true;
  });
  const visibleRows = filteredRows.slice(0, visibleCount);
  const remainingRows = Math.max(filteredRows.length - visibleCount, 0);
  const loading = wallets.isPending || (Boolean(walletId) && activity.isPending);
  const error = wallets.error ?? activity.error;

  const selectFilter = (nextFilter: TransactionFilter) => {
    setFilter(nextFilter);
    setVisibleCount(PAGE_SIZE);
  };

  return (
    <Screen
      eyebrow="SKIMA Wallet"
      title="Transactions"
      subtitle="Understand what happened to your money without exposing SKIMA’s internal accounting."
    >
      {loading ? (
        <ScreenSkeleton cards={4} />
      ) : error ? (
        <RequestFailureState
          error={error}
          onRetry={() => void Promise.all([wallets.refetch(), activity.refetch()])}
        />
      ) : !walletId ? (
        <EmptyState
          icon={<WalletCards color={palette.brand} size={27} />}
          title="Wallet not ready"
          description="Your customer wallet is not available yet. It will appear here once wallet setup is complete."
        />
      ) : (
        <>
          <View style={[styles.hero, shadows.raised, { backgroundColor: palette.brand }]}>
            <View style={styles.heroIcon}><WalletCards color="#FFFFFF" size={27} /></View>
            <View style={styles.heroCopy}>
              <Text style={styles.heroEyebrow}>WALLET ACTIVITY</Text>
              <Text style={styles.heroTitle}>{activity.data?.totalCount ?? rows.length} {(activity.data?.totalCount ?? rows.length) === 1 ? "transaction" : "transactions"}</Text>
              <Text style={styles.heroBody}>
                {succeededCount} completed in recent history · {pendingCount} pending{issueCount ? ` · ${issueCount} need attention` : ""}
              </Text>
            </View>
          </View>

          {rows.length ? (
            <>
              <View style={styles.filters}>
                <FilterChip label="All" active={filter === "all"} onPress={() => selectFilter("all")} />
                <FilterChip label="Completed" active={filter === "completed"} onPress={() => selectFilter("completed")} />
                <FilterChip label="Pending" active={filter === "pending"} onPress={() => selectFilter("pending")} />
                {issueCount ? <FilterChip label="Issues" active={filter === "issues"} onPress={() => selectFilter("issues")} /> : null}
              </View>

              {visibleRows.length ? (
                <View style={styles.list}>
                  {visibleRows.map((item, index) => (
                    <WalletActivityRow key={firstString(item, ["activityKey"]) ?? String(index)} item={item} />
                  ))}
                </View>
              ) : (
                <View style={[styles.filteredEmpty, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
                  <Text style={[styles.filteredEmptyTitle, { color: palette.ink }]}>No {filter} transactions in recent history</Text>
                  <Text style={[styles.filteredEmptyText, { color: palette.muted }]}>Choose another filter to review your wallet activity.</Text>
                </View>
              )}

              {remainingRows > 0 ? (
                <AppButton
                  label={`Show ${Math.min(PAGE_SIZE, remainingRows)} older transactions`}
                  variant="secondary"
                  onPress={() => setVisibleCount((count) => count + PAGE_SIZE)}
                />
              ) : null}

              {activity.data?.hasMore ? (
                <View style={[styles.historyLimit, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
                  <ReceiptText color={palette.mutedStrong} size={17} />
                  <Text style={[styles.historyLimitText, { color: palette.muted }]}>Showing the latest {HISTORY_WINDOW} wallet records. Older financial records remain preserved by SKIMA.</Text>
                </View>
              ) : null}
            </>
          ) : (
            <EmptyState
              icon={<ReceiptText color={palette.brand} size={27} />}
              title="No wallet activity yet"
              description="Top-ups, payments, escrow holds, refunds, utility payments and other wallet movements will appear here."
            />
          )}

          <View style={[styles.note, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
            <ShieldCheck color={palette.mutedStrong} size={18} />
            <Text style={[styles.noteText, { color: palette.muted }]}>This history uses public-safe financial descriptions. Internal ledger accounts, reconciliation data, provider diagnostics and webhook payloads are intentionally hidden.</Text>
          </View>
        </>
      )}
    </Screen>
  );
}

function WalletActivityRow({ item }: { item: PlatformRecord }) {
  const { palette } = useAppTheme();
  const amount = Math.abs(firstNumber(item, ["amount"]) ?? 0);
  const currency = firstString(item, ["currencyCode", "currency_code"]) ?? "NGN";
  const rawStatus = displayStatus(item);
  const presentation = transactionStatusPresentation(rawStatus);
  const timestamp = firstString(item, ["occurredAt", "occurred_at"]);
  const direction = firstString(item, ["direction"]) ?? "debit";
  const type = firstString(item, ["type"]) ?? "transaction";
  const description = firstString(item, ["description"]) ?? presentation.explanation;
  const reference = firstString(item, ["publicReference", "public_reference"]);
  const paymentMethod = firstString(item, ["paymentMethod", "payment_method"]);
  const counterparty = firstString(item, ["counterparty"]);
  const isSuccessfulCredit = direction === "credit" && presentation.status === "successful";
  const isDebit = direction === "debit";
  const icon = type === "utility_payment"
    ? <Zap color={palette.brand} size={20} />
    : type === "escrow_hold"
      ? <ShieldCheck color={palette.warning} size={20} />
      : isDebit
        ? <ArrowUpRight color={palette.danger} size={20} />
        : <ArrowDownLeft color={isSuccessfulCredit ? palette.success : palette.brand} size={20} />;
  const iconBackground = type === "escrow_hold"
    ? palette.warningSoft
    : isSuccessfulCredit
      ? palette.successSoft
      : palette.brandSoft;
  const sign = presentation.status === "successful" || presentation.status === "refunded" || type === "escrow_hold"
    ? direction === "credit" ? "+" : "−"
    : "";

  return (
    <View style={[styles.row, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <View style={[styles.icon, { backgroundColor: iconBackground }]}>{icon}</View>
      <View style={styles.copy}>
        <Text numberOfLines={1} style={[styles.title, { color: palette.ink }]}>{activityTitle(type)}</Text>
        {reference ? <Text numberOfLines={1} style={[styles.reference, { color: palette.muted }]}>{reference}</Text> : null}
        <Text numberOfLines={2} style={[styles.explanation, { color: palette.mutedStrong }]}>{description}</Text>
        {paymentMethod || counterparty ? (
          <Text numberOfLines={1} style={[styles.meta, { color: palette.muted }]}>{[paymentMethod, counterparty].filter(Boolean).join(" · ")}</Text>
        ) : null}
        <Text style={[styles.time, { color: palette.muted }]}>{formatDate(timestamp)}</Text>
      </View>
      <View style={styles.right}>
        <Text style={[styles.amount, { color: isSuccessfulCredit ? palette.success : palette.ink }]}>{sign}{money(amount, currency)}</Text>
        <TransactionStatusPill status={rawStatus} />
      </View>
    </View>
  );
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

function activityTitle(type: string) {
  const titles: Record<string, string> = {
    wallet_top_up: "Wallet top up",
    withdrawal: "Withdrawal",
    utility_payment: "Utility payment",
    escrow_hold: "Escrow hold",
    payment: "Payment",
    earnings: "Earnings",
    driver_earnings: "Driver earnings",
    refund: "Refund",
    reversal: "Reversal",
  };
  return titles[type] ?? type.replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
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
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

const styles = StyleSheet.create({
  hero: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderRadius: radii.xl },
  heroIcon: { width: 52, height: 52, borderRadius: 18, backgroundColor: "rgba(255,255,255,.14)", alignItems: "center", justifyContent: "center" },
  heroCopy: { flex: 1, gap: 3 },
  heroEyebrow: { color: "rgba(255,255,255,.72)", ...typography.eyebrow, fontSize: 9 },
  heroTitle: { color: "#FFFFFF", ...typography.heading, fontSize: 20 },
  heroBody: { color: "rgba(255,255,255,.82)", ...typography.caption },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  filterChip: { minHeight: 38, justifyContent: "center", borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: 13 },
  filterText: { ...typography.caption, fontSize: 10, fontWeight: "900" },
  list: { gap: spacing.sm },
  row: { minHeight: 96, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.sm + 2, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg },
  icon: { width: 46, height: 46, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  title: { ...typography.bodyStrong, fontSize: 14 },
  reference: { ...typography.caption, fontSize: 10 },
  explanation: { ...typography.caption, fontSize: 10, lineHeight: 14 },
  meta: { ...typography.caption, fontSize: 9 },
  time: { ...typography.caption, fontSize: 10 },
  right: { alignItems: "flex-end", gap: 7 },
  amount: { ...typography.bodyStrong, fontSize: 14 },
  filteredEmpty: { alignItems: "center", gap: 4, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.lg },
  filteredEmptyTitle: { ...typography.bodyStrong, fontSize: 13 },
  filteredEmptyText: { ...typography.caption, textAlign: "center" },
  historyLimit: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  historyLimitText: { flex: 1, ...typography.caption, lineHeight: 17 },
  note: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm + 2, padding: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg },
  noteText: { flex: 1, ...typography.caption, lineHeight: 18 },
});