import { router } from "expo-router";
import { ArrowDownToLine, Banknote, Clock3, ReceiptText, WalletCards } from "lucide-react-native";
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
import { SectionHeader } from "./SectionHeader";
import { StatusPill } from "./StatusPill";

export function FinanceScreen({ workspace }: { workspace: "driver" | "station" }) {
  const { palette } = useAppTheme();
  const wallets = domainQueries.wallets();
  const entries = workspace === "driver" ? domainQueries.commissions() : domainQueries.settlements();
  const withdrawals = domainQueries.withdrawals();
  const wallet = wallets.data?.[0];
  const currency = firstString(wallet, ["currency_code", "currencyCode"]) ?? "NGN";
  const available = firstNumber(wallet, ["available_balance", "availableBalance", "balance"]) ?? 0;
  const activity = entries.data ?? [];
  const withdrawalRows = withdrawals.data ?? [];
  const pendingCount = activity.filter((item) => {
    const status = (displayStatus(item) ?? "").toLowerCase();
    return ["pending", "processing", "reserved", "earned_pending", "queued"].includes(status);
  }).length;

  const withdrawPath = `/${workspace === "driver" ? "(driver)" : "(station)"}/withdraw` as never;

  return (
    <Screen
      eyebrow={workspace === "driver" ? "Driver finance" : "Station finance"}
      title={workspace === "driver" ? "Earnings" : "Settlements"}
      subtitle={
        workspace === "driver"
          ? "Track commission activity, available earnings and payout requests."
          : "Track station earnings, settlement activity and withdrawals."
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
        <Text style={styles.heroBody}>Funds shown here come from the SKIMA wallet and ledger. Withdrawal requests are processed through the active payout policy.</Text>
      </View>

      {entries.isPending || wallets.isPending || withdrawals.isPending ? (
        <ScreenSkeleton cards={3} />
      ) : entries.error || wallets.error || withdrawals.error ? (
        <EmptyState
          icon={<Banknote color={palette.brand} size={27} />}
          title="Finance activity could not be loaded"
          description="Check your connection and refresh your finance workspace."
          action={<AppButton label="Retry" onPress={() => void Promise.all([entries.refetch(), wallets.refetch(), withdrawals.refetch()])} />}
        />
      ) : (
        <>
          <View style={styles.metricGrid}>
            <Metric icon={<ReceiptText color={palette.brand} size={19} />} label={workspace === "driver" ? "Commission entries" : "Settlement entries"} value={String(activity.length)} />
            <Metric icon={<Clock3 color={palette.warning} size={19} />} label="Pending activity" value={String(pendingCount)} />
            <Metric icon={<ArrowDownToLine color={palette.brand} size={19} />} label="Withdrawals" value={String(withdrawalRows.length)} />
          </View>

          <SectionHeader
            title="Recent activity"
            description={workspace === "driver" ? "Your latest commission records from completed or progressing fulfilment." : "Your latest station settlement records from LPG fulfilment."}
          />

          <View style={styles.activityList}>
            {activity.length ? (
              activity.slice(0, 15).map((item, index) => {
                const status = displayStatus(item) ?? "recorded";
                const amount = firstNumber(item, ["net_amount", "netAmount", "amount", "commission_amount", "commissionAmount"]) ?? 0;
                const itemCurrency = firstString(item, ["currency_code", "currencyCode"]) ?? currency;
                const timestamp = firstString(item, ["processed_at", "processedAt", "settled_at", "settledAt", "created_at", "createdAt"]);
                return (
                  <View
                    key={recordId(item) ?? String(index)}
                    style={[styles.activityCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}
                  >
                    <View style={[styles.activityIcon, { backgroundColor: palette.brandSoft }]}>
                      <Banknote color={palette.brand} size={21} />
                    </View>
                    <View style={styles.activityCopy}>
                      <Text numberOfLines={1} style={[styles.activityTitle, { color: palette.ink }]}>{displayReference(item) ?? (workspace === "driver" ? "Driver commission" : "Station settlement")}</Text>
                      <Text style={[styles.activityMeta, { color: palette.muted }]}>{formatDate(timestamp)}</Text>
                    </View>
                    <View style={styles.activityRight}>
                      <Text style={[styles.activityAmount, { color: palette.ink }]}>{money(amount, itemCurrency)}</Text>
                      <StatusPill label={friendlyStatus(status)} tone={statusTone(status)} />
                    </View>
                  </View>
                );
              })
            ) : (
              <EmptyState
                icon={<ReceiptText color={palette.brand} size={26} />}
                title={workspace === "driver" ? "No commission activity yet" : "No settlement activity yet"}
                description={workspace === "driver" ? "Eligible commission records will appear here as fulfilment reaches the required release stage." : "Station settlement records will appear here as eligible LPG fulfilment is completed."}
              />
            )}
          </View>

          <View style={[styles.ledgerNote, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
            <WalletCards color={palette.mutedStrong} size={18} />
            <Text style={[styles.ledgerText, { color: palette.muted }]}>This screen is a presentation of SKIMA financial records. The wallet and immutable ledger remain the financial source of truth.</Text>
          </View>
        </>
      )}
    </Screen>
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

function formatDate(value: string | null) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function friendlyStatus(value: string) {
  const normalized = value.toLowerCase().replace(/[-\s]+/g, "_");
  const labels: Record<string, string> = {
    pending: "Pending",
    processing: "Processing",
    reserved: "Reserved",
    earned_pending: "Pending release",
    released: "Released",
    paid: "Paid",
    settled: "Settled",
    completed: "Completed",
    failed: "Failed",
    reversed: "Reversed",
    cancelled: "Cancelled",
  };
  return labels[normalized] ?? normalized.replace(/_/g, " ");
}

function statusTone(value: string): "neutral" | "brand" | "success" | "warning" | "danger" {
  const normalized = value.toLowerCase();
  if (["released", "paid", "settled", "completed"].some((part) => normalized.includes(part))) return "success";
  if (["failed", "reversed", "cancelled"].some((part) => normalized.includes(part))) return "danger";
  if (["pending", "processing", "reserved", "queued"].some((part) => normalized.includes(part))) return "warning";
  return "brand";
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
  activityList: { gap: spacing.sm },
  activityCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  activityIcon: { width: 45, height: 45, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  activityCopy: { flex: 1, minWidth: 0, gap: 3 },
  activityTitle: { ...typography.bodyStrong, fontSize: 14 },
  activityMeta: { ...typography.caption, fontSize: 11 },
  activityRight: { alignItems: "flex-end", gap: 6 },
  activityAmount: { ...typography.bodyStrong, fontSize: 14 },
  ledgerNote: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm + 2, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  ledgerText: { flex: 1, ...typography.caption, lineHeight: 18 },
});