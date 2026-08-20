import { AlertCircle, ArrowUpRight, Building2, CheckCircle2, ShieldCheck, X } from "lucide-react-native";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { AppButton } from "./AppButton";

export interface WithdrawalModalProps {
  visible: boolean;
  amount: number;
  feeAmount: number;
  totalDebitAmount: number;
  currency: string;
  accountName: string;
  accountNumber: string;
  bankName: string;
  isSubmitting: boolean;
  submittedResult: { id?: string; reference?: string; status?: string } | null;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

export function WithdrawalModal({
  visible,
  amount,
  feeAmount,
  totalDebitAmount,
  currency,
  accountName,
  accountNumber,
  bankName,
  isSubmitting,
  submittedResult,
  error,
  onConfirm,
  onClose,
}: WithdrawalModalProps) {
  const { palette } = useAppTheme();
  if (!visible) return null;

  const formattedAmount = money(amount, currency);
  const formattedFee = money(feeAmount, currency);
  const formattedTotal = money(totalDebitAmount, currency);
  const maskedAccount = accountNumber.length >= 4 ? `•••• ${accountNumber.slice(-4)}` : accountNumber;
  const isSuccess = Boolean(submittedResult);

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <View style={[styles.overlay, { backgroundColor: palette.overlay }]}>
        <View style={[styles.container, shadows.raised, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <View style={[styles.headerIcon, { backgroundColor: palette.brandSoft }]}>
                <ArrowUpRight color={palette.brand} size={20} />
              </View>
              <View>
                <Text style={[styles.headerTitle, { color: palette.ink }]}>
                  {isSuccess ? "Withdrawal submitted" : "Confirm withdrawal"}
                </Text>
                <Text style={[styles.headerSub, { color: palette.muted }]}>Secure SKIMA payout request</Text>
              </View>
            </View>
            <Pressable accessibilityRole="button" onPress={onClose} style={[styles.closeBtn, { backgroundColor: palette.soft }]}>
              <X color={palette.ink} size={19} />
            </Pressable>
          </View>

          {isSuccess ? (
            <View style={styles.successContainer}>
              <View style={[styles.iconCircle, { backgroundColor: palette.success }]}>
                <CheckCircle2 color="#FFFFFF" size={42} />
              </View>
              <Text style={[styles.successTitle, { color: palette.ink }]}>Request received</Text>
              <Text style={[styles.successSub, { color: palette.muted }]}>
                <Text style={{ fontWeight: "900", color: palette.ink }}>{formattedAmount}</Text> is being sent to your payout account. Your wallet was debited {formattedTotal}, including the {formattedFee} SKIMA fee shown before confirmation.
              </Text>

              <View style={[styles.receiptCard, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
                <ReceiptRow label="Amount to bank" value={formattedAmount} />
                <ReceiptRow label="SKIMA fee" value={formattedFee} />
                <ReceiptRow label="Wallet debit" value={formattedTotal} />
                <ReceiptRow label="Destination" value={accountName || "Payout account"} />
                <ReceiptRow label="Institution" value={bankName || "Bank / institution"} />
                <ReceiptRow label="Account" value={maskedAccount} />
                {submittedResult?.reference || submittedResult?.id ? (
                  <ReceiptRow label="Reference" value={submittedResult.reference ?? submittedResult.id ?? ""} />
                ) : null}
              </View>

              <AppButton label="Done" fullWidth onPress={onClose} />
            </View>
          ) : (
            <View style={styles.confirmContainer}>
              <View style={[styles.amountBox, { backgroundColor: palette.brandSofter, borderColor: palette.brandSoft }]}>
                <Text style={[styles.amountLabel, { color: palette.muted }]}>AMOUNT SENT TO BANK</Text>
                <Text style={[styles.amountValue, { color: palette.brand }]}>{formattedAmount}</Text>
              </View>

              <View style={[styles.breakdownBox, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
                <ReceiptRow label="Withdrawal amount" value={formattedAmount} />
                <ReceiptRow label="SKIMA fee" value={formattedFee} />
                <View style={[styles.divider, { borderTopColor: palette.border }]} />
                <ReceiptRow label="Total wallet debit" value={formattedTotal} />
              </View>

              <View style={[styles.detailsBox, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
                <View style={styles.detailRow}>
                  <View style={[styles.bankIcon, { backgroundColor: palette.brandSoft }]}>
                    <Building2 color={palette.brand} size={19} />
                  </View>
                  <View style={styles.bankCopy}>
                    <Text style={[styles.detailTitle, { color: palette.ink }]}>{accountName || "Payout account"}</Text>
                    <Text style={[styles.detailSub, { color: palette.muted }]}>{bankName || "Bank / institution"} · {maskedAccount}</Text>
                  </View>
                </View>
                <View style={[styles.securityRow, { borderTopColor: palette.border }]}>
                  <ShieldCheck color={palette.success} size={16} />
                  <Text style={[styles.securityText, { color: palette.muted }]}>The amount sent to your bank never includes the SKIMA fee. The fee remains separate in the ledger and becomes SKIMA revenue only after the provider confirms payout success.</Text>
                </View>
              </View>

              {error ? (
                <View style={[styles.errorBox, { backgroundColor: palette.dangerSoft }]}>
                  <AlertCircle color={palette.danger} size={18} />
                  <Text style={[styles.errorText, { color: palette.danger }]}>{error}</Text>
                </View>
              ) : null}

              <Pressable
                accessibilityRole="button"
                disabled={isSubmitting}
                onPress={onConfirm}
                style={({ pressed }) => [
                  styles.confirmButton,
                  { backgroundColor: palette.brand, opacity: isSubmitting ? 0.5 : pressed ? 0.82 : 1 },
                ]}
              >
                {isSubmitting ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.confirmButtonText}>Confirm withdrawal</Text>}
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

function ReceiptRow({ label, value }: { label: string; value: string }) {
  const { palette } = useAppTheme();
  return (
    <View style={styles.receiptRow}>
      <Text style={[styles.receiptLabel, { color: palette.muted }]}>{label}</Text>
      <Text numberOfLines={1} style={[styles.receiptValue, { color: palette.ink }]}>{value}</Text>
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
  overlay: { flex: 1, justifyContent: "center", alignItems: "center", padding: spacing.md },
  container: { width: "100%", maxWidth: 480, borderRadius: radii.xl, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg, gap: spacing.lg },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md },
  headerTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm + 2, flex: 1 },
  headerIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  headerTitle: { ...typography.subheading, fontSize: 16 },
  headerSub: { ...typography.caption, fontSize: 11, marginTop: 2 },
  closeBtn: { width: 36, height: 36, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  confirmContainer: { gap: spacing.md },
  amountBox: { padding: spacing.lg, borderRadius: radii.lg, alignItems: "center", borderWidth: StyleSheet.hairlineWidth },
  amountLabel: { ...typography.eyebrow, fontSize: 9 },
  amountValue: { fontSize: 32, lineHeight: 39, fontWeight: "900", letterSpacing: -0.7, marginTop: 3 },
  breakdownBox: { padding: spacing.md, borderRadius: radii.lg, borderWidth: StyleSheet.hairlineWidth, gap: spacing.sm },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, marginVertical: 2 },
  detailsBox: { padding: spacing.md, borderRadius: radii.lg, borderWidth: StyleSheet.hairlineWidth, gap: spacing.md },
  detailRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm + 2 },
  bankIcon: { width: 40, height: 40, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  bankCopy: { flex: 1, gap: 2 },
  detailTitle: { ...typography.bodyStrong, fontSize: 14 },
  detailSub: { ...typography.caption },
  securityRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.md },
  securityText: { ...typography.caption, flex: 1, lineHeight: 17 },
  errorBox: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, padding: spacing.md, borderRadius: radii.md },
  errorText: { ...typography.caption, fontWeight: "700", flex: 1, lineHeight: 17 },
  confirmButton: { minHeight: 52, borderRadius: radii.md, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.md },
  confirmButtonText: { color: "#FFFFFF", ...typography.bodyStrong, fontSize: 15 },
  successContainer: { alignItems: "center", gap: spacing.md, paddingVertical: spacing.xs },
  iconCircle: { width: 70, height: 70, borderRadius: 35, alignItems: "center", justifyContent: "center" },
  successTitle: { ...typography.heading },
  successSub: { ...typography.body, textAlign: "center", lineHeight: 21 },
  receiptCard: { width: "100%", padding: spacing.md, borderRadius: radii.lg, borderWidth: StyleSheet.hairlineWidth, gap: spacing.sm },
  receiptRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: spacing.md },
  receiptLabel: { ...typography.caption, flex: 0.42 },
  receiptValue: { ...typography.caption, fontWeight: "800", textAlign: "right", flex: 0.58 },
});
