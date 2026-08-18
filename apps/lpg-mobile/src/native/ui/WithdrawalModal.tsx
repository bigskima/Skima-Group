import { CheckCircle2, ShieldCheck, X, ArrowUpRight, Building2, AlertCircle } from "lucide-react-native";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { colors, radii, spacing } from "../theme/tokens";

export interface WithdrawalModalProps {
  visible: boolean;
  amount: number;
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
  if (!visible) return null;

  const formattedAmount = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(amount);

  const maskedAccount = accountNumber.length >= 4
    ? `•••• ${accountNumber.slice(-4)}`
    : accountNumber;

  const isSuccess = Boolean(submittedResult);

  return (
    <Modal
      animationType="slide"
      transparent={true}
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <ArrowUpRight color={colors.brand} size={22} />
              <Text style={styles.headerTitle}>
                {isSuccess ? "Withdrawal Submitted" : "Confirm Payout"}
              </Text>
            </View>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <X color={colors.ink} size={20} />
            </Pressable>
          </View>

          {isSuccess ? (
            <View style={styles.successContainer}>
              <View style={styles.iconCircle}>
                <CheckCircle2 color="white" size={48} />
              </View>
              <Text style={styles.successTitle}>Transfer In Progress</Text>
              <Text style={styles.successSub}>
                Your withdrawal request of <Text style={{ fontWeight: "900" }}>{formattedAmount}</Text> has been submitted to Paystack for automated bank transfer.
              </Text>

              {/* Receipt Card */}
              <View style={styles.receiptCard}>
                <View style={styles.receiptRow}>
                  <Text style={styles.receiptLabel}>Destination Account</Text>
                  <Text style={styles.receiptValue}>{accountName}</Text>
                </View>
                <View style={styles.receiptRow}>
                  <Text style={styles.receiptLabel}>Bank / Institution</Text>
                  <Text style={styles.receiptValue}>{bankName}</Text>
                </View>
                <View style={styles.receiptRow}>
                  <Text style={styles.receiptLabel}>Account Number</Text>
                  <Text style={styles.receiptValue}>{maskedAccount}</Text>
                </View>
                <View style={styles.receiptRow}>
                  <Text style={styles.receiptLabel}>Transfer Channel</Text>
                  <Text style={styles.receiptValue}>Paystack Transfer</Text>
                </View>
                {submittedResult?.id || submittedResult?.reference ? (
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptLabel}>Reference ID</Text>
                    <Text style={[styles.receiptValue, { fontSize: 12 }]}>
                      {submittedResult.reference ?? submittedResult.id}
                    </Text>
                  </View>
                ) : null}
              </View>

              <Pressable onPress={onClose} style={styles.primaryBtn}>
                <Text style={styles.primaryBtnText}>Done / Return to Wallet</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.confirmContainer}>
              <View style={styles.amountBox}>
                <Text style={styles.amountLabel}>WITHDRAWAL AMOUNT</Text>
                <Text style={styles.amountValue}>{formattedAmount}</Text>
              </View>

              {/* Account Details Box */}
              <View style={styles.detailsBox}>
                <View style={styles.detailRow}>
                  <Building2 color={colors.brand} size={20} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.detailTitle}>{accountName || "Bank Account"}</Text>
                    <Text style={styles.detailSub}>
                      {bankName} · {maskedAccount}
                    </Text>
                  </View>
                </View>
                <View style={styles.divider} />
                <View style={styles.detailRowBetween}>
                  <Text style={styles.metaLabel}>Payout Fee</Text>
                  <Text style={styles.metaValueFree}>FREE (₦0.00)</Text>
                </View>
                <View style={styles.detailRowBetween}>
                  <Text style={styles.metaLabel}>Processing Channel</Text>
                  <Text style={styles.metaValue}>Paystack Automated Transfer</Text>
                </View>
                <View style={styles.detailRowBetween}>
                  <Text style={styles.metaLabel}>Estimated Payout Speed</Text>
                  <Text style={styles.metaValueSpeed}>Instant to 5 mins</Text>
                </View>
              </View>

              {error ? (
                <View style={styles.errorBox}>
                  <AlertCircle color={colors.danger} size={18} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              <Pressable
                disabled={isSubmitting}
                onPress={onConfirm}
                style={styles.primaryBtn}
              >
                {isSubmitting ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text style={styles.primaryBtnText}>Confirm Withdrawal</Text>
                )}
              </Pressable>

              <Text style={styles.securityNote}>
                <ShieldCheck color={colors.muted} size={14} /> Payouts are protected by end-to-end security policy verification.
              </Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.65)",
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.md,
  },
  container: {
    width: "100%",
    maxWidth: 480,
    backgroundColor: colors.surface,
    borderRadius: 24,
    padding: spacing.lg,
    gap: spacing.md,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  headerTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: "900",
  },
  closeBtn: {
    padding: 6,
    borderRadius: radii.pill,
    backgroundColor: "#F3F4F6",
  },
  confirmContainer: {
    gap: spacing.md,
  },
  amountBox: {
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: "#FFF0F1",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(225, 29, 72, 0.15)",
  },
  amountLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
  },
  amountValue: {
    color: colors.brand,
    fontSize: 32,
    fontWeight: "900",
    marginTop: 4,
  },
  detailsBox: {
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: "#F9FAFB",
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  detailTitle: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "800",
  },
  detailSub: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 4,
  },
  detailRowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  metaLabel: {
    color: colors.muted,
    fontSize: 13,
  },
  metaValue: {
    color: colors.ink,
    fontWeight: "800",
    fontSize: 13,
  },
  metaValueFree: {
    color: colors.success,
    fontWeight: "900",
    fontSize: 13,
  },
  metaValueSpeed: {
    color: colors.brand,
    fontWeight: "900",
    fontSize: 13,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: "#FEF2F2",
  },
  errorText: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: "700",
    flex: 1,
  },
  primaryBtn: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: colors.brand,
  },
  primaryBtnText: {
    color: "white",
    fontWeight: "900",
    fontSize: 15,
  },
  securityNote: {
    color: colors.muted,
    fontSize: 12,
    textAlign: "center",
    marginTop: 4,
  },
  successContainer: {
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.success,
    alignItems: "center",
    justifyContent: "center",
  },
  successTitle: {
    color: colors.ink,
    fontSize: 22,
    fontWeight: "900",
  },
  successSub: {
    color: colors.muted,
    textAlign: "center",
    lineHeight: 20,
    fontSize: 14,
  },
  receiptCard: {
    width: "100%",
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: "#F9FAFB",
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  receiptRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  receiptLabel: {
    color: colors.muted,
    fontSize: 13,
  },
  receiptValue: {
    color: colors.ink,
    fontWeight: "800",
    fontSize: 13,
  },
});
