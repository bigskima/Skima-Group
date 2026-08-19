import * as Print from "expo-print";
import { router, useLocalSearchParams } from "expo-router";
import * as Sharing from "expo-sharing";
import { CheckCircle2, ReceiptText, Share2, ShieldCheck } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";
import { domainQueries } from "../api/domains";
import { displayReference, displayStatus, firstNumber, firstString, recordId } from "../api/records";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { AppButton } from "./AppButton";
import { EmptyState } from "./EmptyState";
import { Screen } from "./Screen";
import { ScreenSkeleton } from "./ScreenSkeleton";
import { StatusPill } from "./StatusPill";

export function ReceiptScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { palette } = useAppTheme();
  const orders = domainQueries.orders();
  const order = orders.data?.find((item) => recordId(item) === id || displayReference(item) === id);
  const currency = firstString(order, ["currency_code", "currencyCode"]) ?? "NGN";
  const total = firstNumber(order, ["total_amount", "totalAmount", "quoted_total", "quotedTotal"]);
  const status = order ? displayStatus(order) ?? "recorded" : "";
  const paymentStatus = firstString(order, ["payment_status", "paymentStatus"]) ?? "confirmed";
  const reference = order ? displayReference(order) ?? recordId(order) ?? "SKIMA LPG order" : "";
  const timestamp = firstString(order, ["updated_at", "updatedAt", "created_at", "createdAt"]);

  const share = async () => {
    if (!order) return;
    const file = await Print.printToFileAsync({
      html: receiptHtml({
        reference,
        status: friendly(status),
        paymentStatus: friendly(paymentStatus),
        total: money(total, currency),
        date: formatDate(timestamp),
      }),
    });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, {
        mimeType: "application/pdf",
        dialogTitle: "Share SKIMA LPG receipt",
      });
    }
  };

  return (
    <Screen
      eyebrow="Order payment"
      title="Receipt"
      subtitle="A clean record of the payment currently confirmed for this SKIMA refill."
      action={<AppButton label="Back" variant="ghost" size="sm" onPress={() => router.back()} />}
    >
      {orders.isPending ? (
        <ScreenSkeleton cards={2} />
      ) : !order ? (
        <EmptyState
          icon={<ReceiptText color={palette.brand} size={27} />}
          title="Receipt not available yet"
          description="A receipt becomes available after this order has a confirmed payment record."
          action={<AppButton label="Back to orders" onPress={() => router.replace("/(customer)/orders")} />}
        />
      ) : (
        <>
          <View style={[styles.hero, shadows.raised, { backgroundColor: palette.brand }]}>
            <View style={styles.heroIcon}><ReceiptText color="#FFFFFF" size={29} /></View>
            <View style={styles.heroCopy}>
              <Text style={styles.heroEyebrow}>SKIMA LPG RECEIPT</Text>
              <Text adjustsFontSizeToFit numberOfLines={1} style={styles.heroValue}>{money(total, currency)}</Text>
              <Text style={styles.heroReference}>{reference}</Text>
            </View>
          </View>

          <View style={[styles.receiptCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <View style={styles.receiptHead}>
              <View>
                <Text style={[styles.receiptTitle, { color: palette.ink }]}>Payment record</Text>
                <Text style={[styles.receiptSub, { color: palette.muted }]}>{formatDate(timestamp)}</Text>
              </View>
              <StatusPill label={friendly(paymentStatus)} tone={paymentTone(paymentStatus)} />
            </View>
            <View style={[styles.divider, { backgroundColor: palette.border }]} />
            <Field label="Order reference" value={reference} />
            <Field label="Order status" value={friendly(status)} />
            <Field label="Payment status" value={friendly(paymentStatus)} />
            <View style={[styles.totalRow, { backgroundColor: palette.surfaceSubtle }]}>
              <Text style={[styles.totalLabel, { color: palette.muted }]}>TOTAL PAID / RECORDED</Text>
              <Text style={[styles.totalValue, { color: palette.ink }]}>{money(total, currency)}</Text>
            </View>
          </View>

          <View style={[styles.verified, { backgroundColor: palette.successSoft, borderColor: palette.success }]}>
            <CheckCircle2 color={palette.success} size={21} />
            <View style={styles.verifiedCopy}>
              <Text style={[styles.verifiedTitle, { color: palette.ink }]}>SKIMA payment record</Text>
              <Text style={[styles.verifiedBody, { color: palette.muted }]}>This receipt reflects the payment information currently confirmed for this order in SKIMA.</Text>
            </View>
          </View>

          <AppButton
            label="Download or share receipt"
            fullWidth
            size="lg"
            icon={<Share2 color="#FFFFFF" size={18} />}
            onPress={() => void share()}
          />

          <View style={[styles.security, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
            <ShieldCheck color={palette.mutedStrong} size={18} />
            <Text style={[styles.securityText, { color: palette.muted }]}>Use the order reference above when contacting SKIMA about this payment or refill.</Text>
          </View>
        </>
      )}
    </Screen>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  const { palette } = useAppTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: palette.muted }]}>{label}</Text>
      <Text style={[styles.value, { color: palette.ink }]}>{value}</Text>
    </View>
  );
}

function receiptHtml(input: { reference: string; status: string; paymentStatus: string; total: string; date: string }) {
  return `<html><body style="font-family:Arial,sans-serif;padding:48px;color:#17221b"><div style="max-width:640px;margin:auto"><h1 style="color:#d7192d;margin-bottom:4px">SKIMA</h1><div style="color:#6a736e;font-size:12px;font-weight:bold;letter-spacing:1px">LPG ORDER RECEIPT</div><div style="margin:30px 0;padding:24px;background:#fff4f5;border-radius:16px"><div style="color:#6a736e;font-size:12px">TOTAL</div><div style="font-size:32px;font-weight:800;margin-top:6px">${escapeHtml(input.total)}</div></div><table style="width:100%;border-collapse:collapse"><tr><td style="padding:12px 0;color:#6a736e">Order reference</td><td style="padding:12px 0;text-align:right;font-weight:bold">${escapeHtml(input.reference)}</td></tr><tr><td style="padding:12px 0;color:#6a736e">Order status</td><td style="padding:12px 0;text-align:right;font-weight:bold">${escapeHtml(input.status)}</td></tr><tr><td style="padding:12px 0;color:#6a736e">Payment status</td><td style="padding:12px 0;text-align:right;font-weight:bold">${escapeHtml(input.paymentStatus)}</td></tr><tr><td style="padding:12px 0;color:#6a736e">Date</td><td style="padding:12px 0;text-align:right;font-weight:bold">${escapeHtml(input.date)}</td></tr></table><p style="margin-top:40px;color:#6a736e;font-size:12px">Thank you for using SKIMA.</p></div></body></html>`;
}

function money(value: number | null, currency: string) {
  if (value === null) return "Amount unavailable";
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

function friendly(value: string) {
  return value.replace(/[_-]/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

function paymentTone(value: string): "neutral" | "brand" | "success" | "warning" | "danger" {
  const normalized = value.toLowerCase();
  if (["paid", "confirmed", "completed", "successful", "succeeded", "credited"].some((part) => normalized.includes(part))) return "success";
  if (["failed", "rejected", "cancelled", "expired"].some((part) => normalized.includes(part))) return "danger";
  if (["pending", "processing", "reserved"].some((part) => normalized.includes(part))) return "warning";
  return "brand";
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

const styles = StyleSheet.create({
  hero: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderRadius: radii.xl },
  heroIcon: { width: 54, height: 54, borderRadius: 19, backgroundColor: "rgba(255,255,255,.14)", alignItems: "center", justifyContent: "center" },
  heroCopy: { flex: 1, minWidth: 0 },
  heroEyebrow: { color: "rgba(255,255,255,.72)", ...typography.eyebrow, fontSize: 9 },
  heroValue: { color: "#FFFFFF", fontSize: 31, lineHeight: 38, fontWeight: "900", letterSpacing: -0.7, marginTop: 4 },
  heroReference: { color: "rgba(255,255,255,.82)", ...typography.caption, marginTop: 3 },
  receiptCard: { gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.lg },
  receiptHead: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md },
  receiptTitle: { ...typography.subheading },
  receiptSub: { ...typography.caption, marginTop: 3 },
  divider: { height: StyleSheet.hairlineWidth },
  field: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md },
  label: { ...typography.caption, flex: 0.42 },
  value: { ...typography.bodyStrong, fontSize: 14, flex: 0.58, textAlign: "right" },
  totalRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, borderRadius: radii.md, padding: spacing.md },
  totalLabel: { ...typography.eyebrow, fontSize: 9 },
  totalValue: { ...typography.heading, fontSize: 20 },
  verified: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  verifiedCopy: { flex: 1, gap: 3 },
  verifiedTitle: { ...typography.bodyStrong, fontSize: 14 },
  verifiedBody: { ...typography.caption, lineHeight: 18 },
  security: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm + 2, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  securityText: { flex: 1, ...typography.caption, lineHeight: 18 },
});
