import { ArrowDownLeft, ArrowUpRight, ReceiptText, WalletCards } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";
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
import { AppButton } from "./AppButton";
import { EmptyState } from "./EmptyState";
import { Screen } from "./Screen";
import { ScreenSkeleton } from "./ScreenSkeleton";
import { StatusPill } from "./StatusPill";

export function TransactionsScreen() {
  const { palette } = useAppTheme();
  const transactions = domainQueries.transactions();
  const rows = transactions.data ?? [];
  const creditCount = rows.filter((item) => direction(item) === "credit").length;
  const debitCount = rows.filter((item) => direction(item) === "debit").length;

  return (
    <Screen
      eyebrow="SKIMA Wallet"
      title="Transactions"
      subtitle="Review money added to your wallet, order payments, refunds and other confirmed wallet activity."
    >
      {transactions.isPending ? (
        <ScreenSkeleton cards={4} />
      ) : transactions.error ? (
        <EmptyState
          icon={<ReceiptText color={palette.brand} size={27} />}
          title="Transactions could not be loaded"
          description="Check your connection and refresh your wallet activity."
          action={<AppButton label="Retry" onPress={() => void transactions.refetch()} />}
        />
      ) : (
        <>
          <View style={[styles.hero, shadows.raised, { backgroundColor: palette.brand }]}>
            <View style={styles.heroIcon}><WalletCards color="#FFFFFF" size={27} /></View>
            <View style={styles.heroCopy}>
              <Text style={styles.heroEyebrow}>WALLET ACTIVITY</Text>
              <Text style={styles.heroTitle}>{rows.length} {rows.length === 1 ? "transaction" : "transactions"}</Text>
              <Text style={styles.heroBody}>{creditCount} incoming · {debitCount} outgoing</Text>
            </View>
          </View>

          <View style={styles.list}>
            {rows.length ? (
              rows.map((item, index) => {
                const id = recordId(item) ?? String(index);
                const transactionDirection = direction(item);
                const amount = transactionAmount(item);
                const currency = firstString(item, ["currency_code", "currencyCode"]) ?? "NGN";
                const status = displayStatus(item) ?? "recorded";
                const timestamp = firstString(item, ["posted_at", "postedAt", "created_at", "createdAt"]);
                const title = transactionTitle(item);
                return (
                  <View
                    key={id}
                    style={[styles.row, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}
                  >
                    <View style={[styles.icon, { backgroundColor: transactionDirection === "credit" ? palette.successSoft : palette.brandSoft }]}>
                      {transactionDirection === "credit" ? (
                        <ArrowDownLeft color={palette.success} size={21} />
                      ) : (
                        <ArrowUpRight color={palette.brand} size={21} />
                      )}
                    </View>
                    <View style={styles.copy}>
                      <Text numberOfLines={1} style={[styles.title, { color: palette.ink }]}>{title}</Text>
                      <Text numberOfLines={1} style={[styles.reference, { color: palette.muted }]}>{displayReference(item) ?? "SKIMA wallet activity"}</Text>
                      <Text style={[styles.time, { color: palette.muted }]}>{formatDate(timestamp)}</Text>
                    </View>
                    <View style={styles.right}>
                      <Text style={[styles.amount, { color: transactionDirection === "credit" ? palette.success : palette.ink }]}>
                        {transactionDirection === "credit" ? "+" : "−"}{money(amount, currency)}
                      </Text>
                      <StatusPill label={friendly(status)} tone={transactionTone(status)} />
                    </View>
                  </View>
                );
              })
            ) : (
              <EmptyState
                icon={<ReceiptText color={palette.brand} size={27} />}
                title="No wallet activity yet"
                description="Top-ups, payments, refunds and other confirmed wallet movements will appear here."
              />
            )}
          </View>

          <View style={[styles.note, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
            <WalletCards color={palette.mutedStrong} size={18} />
            <Text style={[styles.noteText, { color: palette.muted }]}>Payment providers are managed by SKIMA behind the scenes. Customers do not need to choose or configure a gateway in the app.</Text>
          </View>
        </>
      )}
    </Screen>
  );
}

function direction(item: Record<string, unknown>) {
  const raw = firstString(item, ["direction", "entry_type", "entryType", "transaction_type", "transactionType", "type"])?.toLowerCase() ?? "";
  if (["credit", "in", "deposit", "refund", "topup", "top_up", "incoming"].some((part) => raw.includes(part))) return "credit";
  return "debit";
}

function transactionAmount(item: Record<string, unknown>) {
  return Math.abs(firstNumber(item, ["amount", "net_amount", "netAmount", "value"]) ?? 0);
}

function transactionTitle(item: Record<string, unknown>) {
  const raw = firstString(item, ["purpose", "description", "transaction_type", "transactionType", "type"]);
  if (!raw) return direction(item) === "credit" ? "Money received" : "Wallet payment";
  return friendly(raw);
}

function friendly(value: string) {
  return value.replace(/[_-]/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

function transactionTone(value: string): "neutral" | "brand" | "success" | "warning" | "danger" {
  const normalized = value.toLowerCase();
  if (["completed", "confirmed", "posted", "successful", "succeeded", "paid", "settled"].some((part) => normalized.includes(part))) return "success";
  if (["failed", "rejected", "reversed", "cancelled"].some((part) => normalized.includes(part))) return "danger";
  if (["pending", "processing", "reserved"].some((part) => normalized.includes(part))) return "warning";
  return "brand";
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
  list: { gap: spacing.sm },
  row: { minHeight: 88, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg },
  icon: { width: 46, height: 46, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  title: { ...typography.bodyStrong, fontSize: 14 },
  reference: { ...typography.caption, fontSize: 10 },
  time: { ...typography.caption, fontSize: 10 },
  right: { alignItems: "flex-end", gap: 7 },
  amount: { ...typography.bodyStrong, fontSize: 14 },
  note: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm + 2, padding: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg },
  noteText: { flex: 1, ...typography.caption, lineHeight: 18 },
});
