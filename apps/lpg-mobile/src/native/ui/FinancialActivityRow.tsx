import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  LockKeyhole,
  ReceiptText,
  RotateCcw,
  WalletCards,
  Zap,
} from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";
import {
  firstNumber,
  firstString,
  type PlatformRecord,
} from "../api/records";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { transactionStatusPresentation } from "../utilities/transactionStatus";
import { TransactionStatusPill } from "./TransactionStatusPill";

export function FinancialActivityRow({ item }: { item: PlatformRecord }) {
  const { palette } = useAppTheme();
  const type = firstString(item, ["type", "activityType", "activity_type"]) ?? "transaction";
  const direction = firstString(item, ["direction"]) ?? "";
  const rawStatus = firstString(item, ["status"]);
  const status = transactionStatusPresentation(rawStatus);
  const amount = Math.abs(firstNumber(item, ["amount", "totalAmount", "total_amount"]) ?? 0);
  const currency = firstString(item, ["currencyCode", "currency_code"]) ?? "NGN";
  const description = firstString(item, ["description"]) ?? status.explanation;
  const reference = firstString(item, ["publicReference", "public_reference", "reference"]);
  const paymentMethod = firstString(item, ["paymentMethod", "payment_method"]);
  const counterparty = firstString(item, ["counterparty"]);
  const occurredAt = firstString(item, ["occurredAt", "occurred_at", "createdAt", "created_at"]);
  const successfulMovement = status.status === "successful" || status.status === "refunded" || status.status === "reversed";
  const sign = successfulMovement ? (direction === "credit" ? "+" : direction === "debit" ? "−" : "") : "";
  const visual = activityPresentation(type, direction);

  return (
    <View style={[styles.row, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <View style={[styles.icon, { backgroundColor: visual.soft === "success" ? palette.successSoft : palette.brandSoft }]}>
        {visual.icon(visual.soft === "success" ? palette.success : palette.brand)}
      </View>
      <View style={styles.copy}>
        <Text numberOfLines={1} style={[styles.title, { color: palette.ink }]}>{visual.title}</Text>
        {reference ? <Text numberOfLines={1} style={[styles.reference, { color: palette.muted }]}>{reference}</Text> : null}
        <Text numberOfLines={2} style={[styles.description, { color: palette.mutedStrong }]}>{description}</Text>
        {paymentMethod || counterparty ? (
          <Text numberOfLines={1} style={[styles.meta, { color: palette.muted }]}>
            {[paymentMethod, counterparty].filter(Boolean).join(" · ")}
          </Text>
        ) : null}
        <Text style={[styles.meta, { color: palette.muted }]}>{formatDate(occurredAt)}</Text>
      </View>
      <View style={styles.right}>
        <Text style={[styles.amount, { color: successfulMovement && direction === "credit" ? palette.success : palette.ink }]}>
          {sign}{money(amount, currency)}
        </Text>
        <TransactionStatusPill status={rawStatus} />
      </View>
    </View>
  );
}

function activityPresentation(type: string, direction: string) {
  switch (type) {
    case "wallet_top_up":
      return { title: "Wallet top up", soft: "success" as const, icon: (color: string) => <ArrowDownLeft color={color} size={20} /> };
    case "withdrawal":
      return { title: "Withdrawal", soft: "brand" as const, icon: (color: string) => <ArrowUpRight color={color} size={20} /> };
    case "utility_payment":
      return { title: "Utility payment", soft: "brand" as const, icon: (color: string) => <Zap color={color} size={20} /> };
    case "escrow_hold":
      return { title: "LPG payment reserved", soft: "brand" as const, icon: (color: string) => <LockKeyhole color={color} size={20} /> };
    case "driver_earnings":
      return { title: "Delivery earnings", soft: "success" as const, icon: (color: string) => <Banknote color={color} size={20} /> };
    case "earnings":
      return { title: "Earnings released", soft: "success" as const, icon: (color: string) => <Banknote color={color} size={20} /> };
    case "refund":
      return { title: "Refund", soft: "success" as const, icon: (color: string) => <RotateCcw color={color} size={20} /> };
    case "reversal":
      return { title: "Reversal", soft: "brand" as const, icon: (color: string) => <RotateCcw color={color} size={20} /> };
    case "payment":
      return { title: direction === "credit" ? "Payment received" : "Payment", soft: direction === "credit" ? "success" as const : "brand" as const, icon: (color: string) => <WalletCards color={color} size={20} /> };
    default:
      return { title: friendly(type), soft: direction === "credit" ? "success" as const : "brand" as const, icon: (color: string) => <ReceiptText color={color} size={20} /> };
  }
}

function friendly(value: string) {
  return value.replace(/[_.-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
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
  row: { minHeight: 94, flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: 13 },
  icon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  title: { ...typography.bodyStrong, fontSize: 13 },
  reference: { ...typography.caption, fontSize: 10 },
  description: { ...typography.caption, fontSize: 10, lineHeight: 14 },
  meta: { ...typography.caption, fontSize: 9 },
  right: { alignItems: "flex-end", gap: 7, maxWidth: "38%" },
  amount: { ...typography.bodyStrong, fontSize: 13, textAlign: "right" },
});
