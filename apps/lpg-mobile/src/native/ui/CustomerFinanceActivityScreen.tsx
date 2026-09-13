import { ArrowDownLeft, ReceiptText, WalletCards } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useState } from "react";
import { domainQueries } from "../api/domains";
import {
  displayReference,
  displayStatus,
  firstNumber,
  firstString,
  recordId,
} from "../api/records";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { canonicalTransactionStatus, transactionStatusPresentation } from "../utilities/transactionStatus";
import { AppButton } from "./AppButton";
import { EmptyState } from "./EmptyState";
import { RequestFailureState } from "./RequestFailureState";
import { Screen } from "./Screen";
import { ScreenSkeleton } from "./ScreenSkeleton";
import { TransactionStatusPill } from "./TransactionStatusPill";

type TransactionFilter = "all" | "completed" | "pending" | "issues";
const PAGE_SIZE = 8;

export function TransactionsScreen() {
  const { palette } = useAppTheme();
  const transactions = domainQueries.transactions();
  const rows = transactions.data ?? [];
  const [filter, setFilter] = useState<TransactionFilter>("all");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
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

  const selectFilter = (nextFilter: TransactionFilter) => {
    setFilter(nextFilter);
    setVisibleCount(PAGE_SIZE);
  };

  return (
    <Screen
      eyebrow="SKIMA Wallet"
      title="Transactions"
      subtitle="Review your wallet top-ups and their canonical payment status."
    >
      {transactions.isPending ? (
        <ScreenSkeleton cards={4} />
      ) : transactions.error ? (
        <RequestFailureState error={transactions.error} onRetry={() => void transactions.refetch()} />
      ) : (
        <>
          <View style={[styles.hero, shadows.raised, { backgroundColor: palette.brand }]}>
            <View style={styles.heroIcon}><WalletCards color="#FFFFFF" size={27} /></View>
            <View style={styles.heroCopy}>
              <Text style={styles.heroEyebrow}>TOP-UP ACTIVITY</Text>
              <Text style={styles.heroTitle}>{rows.length} {rows.length === 1 ? "top-up" : "top-ups"}</Text>
              <Text style={styles.heroBody}>
                {succeededCount} successful · {pendingCount} pending{issueCount ? ` · ${issueCount} need attention` : ""}
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

              {filteredRows.length ? (
                <View style={styles.list}>
                  {visibleRows.map((item, index) => {
                    const id = recordId(item) ?? String(index);
                    const amount = transactionAmount(item);
                    const currency = firstString(item, ["currency_code", "currencyCode"]) ?? "NGN";
                    const rawStatus = displayStatus(item);
                    const presentation = transactionStatusPresentation(rawStatus);
                    const timestamp = firstString(item, ["initialized_at", "initializedAt", "created_at", "createdAt"]);
                    const succeeded = presentation.status === "successful";
                    return (
                      <View
                        key={id}
                        style={[styles.row, { backgroundColor: palette.surface, borderColor: palette.border }]}
                      >
                        <View style={[styles.icon, { backgroundColor: succeeded ? palette.successSoft : palette.brandSoft }]}>
                          <ArrowDownLeft color={succeeded ? palette.success : palette.brand} size={20} />
                        </View>
                        <View style={styles.copy}>
                          <Text numberOfLines={1} style={[styles.title, { color: palette.ink }]}>Wallet top up</Text>
                          <Text numberOfLines={1} style={[styles.reference, { color: palette.muted }]}>{displayReference(item) ?? "SKIMA top up"}</Text>
                          <Text numberOfLines={2} style={[styles.explanation, { color: palette.mutedStrong }]}>{presentation.explanation}</Text>
                          <Text style={[styles.time, { color: palette.muted }]}>{formatDate(timestamp)}</Text>
                        </View>
                        <View style={styles.right}>
                          <Text style={[styles.amount, { color: succeeded ? palette.success : palette.ink }]}>{succeeded ? "+" : ""}{money(amount, currency)}</Text>
                          <TransactionStatusPill status={rawStatus} />
                        </View>
                      </View>
                    );
                  })}
                </View>
              ) : (
                <View style={[styles.filteredEmpty, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
                  <Text style={[styles.filteredEmptyTitle, { color: palette.ink }]}>No {filter} transactions</Text>
                  <Text style={[styles.filteredEmptyText, { color: palette.muted }]}>Choose another activity filter to see your wallet records.</Text>
                </View>
              )}

              {visibleCount < filteredRows.length ? (
                <AppButton
                  label={`Show ${Math.min(PAGE_SIZE, filteredRows.length - visibleCount)} older transactions`}
                  variant="secondary"
                  onPress={() => setVisibleCount((count) => count + PAGE_SIZE)}
                />
              ) : null}
            </>
          ) : (
            <EmptyState
              icon={<ReceiptText color={palette.brand} size={27} />}
              title="No top-up activity yet"
              description="Wallet top-ups will appear here after you start a payment."
            />
          )}

          <View style={[styles.note, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
            <WalletCards color={palette.mutedStrong} size={18} />
            <Text style={[styles.noteText, { color: palette.muted }]}>A top-up record existing does not mean funds were added. Only a successful backend status is shown as completed.</Text>
          </View>
        </>
      )}
    </Screen>
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

function transactionAmount(item: Record<string, unknown>) {
  return Math.abs(firstNumber(item, ["amount", "net_amount", "netAmount", "value"]) ?? 0);
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
  row: { minHeight: 90, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.sm + 2, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg },
  icon: { width: 46, height: 46, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  title: { ...typography.bodyStrong, fontSize: 14 },
  reference: { ...typography.caption, fontSize: 10 },
  explanation: { ...typography.caption, fontSize: 10, lineHeight: 14 },
  time: { ...typography.caption, fontSize: 10 },
  right: { alignItems: "flex-end", gap: 7 },
  amount: { ...typography.bodyStrong, fontSize: 14 },
  filteredEmpty: { alignItems: "center", gap: 4, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.lg },
  filteredEmptyTitle: { ...typography.bodyStrong, fontSize: 13 },
  filteredEmptyText: { ...typography.caption, textAlign: "center" },
  note: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm + 2, padding: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg },
  noteText: { flex: 1, ...typography.caption, lineHeight: 18 },
});
