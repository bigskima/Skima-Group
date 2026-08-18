import * as Linking from "expo-linking";
import { CheckCircle2, ShieldCheck, X, ExternalLink, AlertCircle, RefreshCw } from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useGatewayQuery } from "../api/gateway";
import { RecordArraySchema, displayStatus, firstString, recordId } from "../api/records";
import { colors, radii, spacing } from "../theme/tokens";

const SUCCESS_STATUSES = new Set(["completed", "confirmed", "credited", "succeeded", "successful"]);
const FAILED_STATUSES = new Set(["cancelled", "failed", "rejected", "expired"]);

export interface PaystackPaymentModalProps {
  visible: boolean;
  checkoutUrl: string | null;
  depositId: string | null;
  amount: number | null;
  currency: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function PaystackPaymentModal({
  visible,
  checkoutUrl,
  depositId,
  amount,
  currency,
  onClose,
  onSuccess,
}: PaystackPaymentModalProps) {
  const [checking, setChecking] = useState(false);

  // Poll deposits to verify payment status automatically
  const deposits = useGatewayQuery({
    key: ["deposits", "paystack-modal"],
    path: "/runtime/payments/deposits",
    schema: RecordArraySchema,
    enabled: visible && Boolean(depositId),
    refetchInterval: visible ? 3000 : undefined,
  });

  const currentDeposit = depositId
    ? (deposits.data ?? []).find(
        (item) =>
          recordId(item) === depositId ||
          firstString(item, ["id", "public_reference", "publicReference"]) === depositId
      )
    : deposits.data?.[0];

  const status = currentDeposit
    ? (displayStatus(currentDeposit) ?? "pending").toLowerCase()
    : "pending";

  const isSuccess = SUCCESS_STATUSES.has(status);
  const isFailed = FAILED_STATUSES.has(status);

  useEffect(() => {
    if (isSuccess) {
      const timer = setTimeout(() => {
        onSuccess();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [isSuccess, onSuccess]);

  if (!visible) return null;

  const formattedAmount = amount
    ? new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount)
    : `${currency} ${amount ?? 0}`;

  const openExternalPaystack = async () => {
    if (checkoutUrl) {
      if (Platform.OS === "web") {
        window.open(checkoutUrl, "_blank", "noopener,noreferrer");
      } else if (await Linking.canOpenURL(checkoutUrl)) {
        await Linking.openURL(checkoutUrl);
      }
    }
  };

  const handleManualCheck = async () => {
    setChecking(true);
    await deposits.refetch();
    setChecking(false);
  };

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
              <ShieldCheck color={colors.brand} size={22} />
              <Text style={styles.headerTitle}>Paystack Secure Checkout</Text>
            </View>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <X color={colors.ink} size={20} />
            </Pressable>
          </View>

          {/* Amount Badge */}
          <View style={styles.amountBox}>
            <Text style={styles.amountLabel}>AMOUNT TO TOP UP</Text>
            <Text style={styles.amountValue}>{formattedAmount}</Text>
          </View>

          {/* Content Body */}
          {isSuccess ? (
            <View style={styles.statusBoxSuccess}>
              <CheckCircle2 color="white" size={48} />
              <Text style={styles.statusTitleSuccess}>Payment Confirmed!</Text>
              <Text style={styles.statusSubSuccess}>
                Your wallet balance has been updated successfully. Returning to your wallet...
              </Text>
            </View>
          ) : isFailed ? (
            <View style={styles.statusBoxFailed}>
              <AlertCircle color={colors.danger} size={48} />
              <Text style={styles.statusTitleFailed}>Payment Not Completed</Text>
              <Text style={styles.statusSubFailed}>
                The payment session was cancelled or could not be completed. You can try again.
              </Text>
              <Pressable onPress={onClose} style={styles.primaryBtn}>
                <Text style={styles.primaryBtnText}>Try Again</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.activeContent}>
              {/* Web Frame or Portal Link */}
              {Platform.OS === "web" && checkoutUrl ? (
                <View style={styles.iframeContainer}>
                  <iframe
                    src={checkoutUrl}
                    style={{
                      width: "100%",
                      height: 380,
                      border: "none",
                      borderRadius: 12,
                      backgroundColor: "#FAFAFA",
                    }}
                    title="Paystack Payment Portal"
                  />
                </View>
              ) : null}

              {/* Secure Portal Link Button */}
              {checkoutUrl ? (
                <Pressable onPress={() => void openExternalPaystack()} style={styles.portalLinkBtn}>
                  <ExternalLink color="white" size={18} />
                  <Text style={styles.portalLinkText}>
                    {Platform.OS === "web" ? "Open Paystack in New Tab" : "Open Paystack Secure Portal"}
                  </Text>
                </Pressable>
              ) : null}

              {/* Status Indicator */}
              <View style={styles.pollingCard}>
                {deposits.isFetching || checking ? (
                  <ActivityIndicator color={colors.brand} size="small" />
                ) : (
                  <View style={styles.pulseDot} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.pollingTitle}>Awaiting Payment Confirmation</Text>
                  <Text style={styles.pollingSub}>
                    Complete your payment on Paystack. This view will automatically update once verified.
                  </Text>
                </View>
              </View>

              {/* Bottom Actions */}
              <View style={styles.actionsRow}>
                <Pressable
                  disabled={checking}
                  onPress={() => void handleManualCheck()}
                  style={styles.verifyBtn}
                >
                  <RefreshCw color={colors.brand} size={16} />
                  <Text style={styles.verifyBtnText}>I've Completed Payment</Text>
                </Pressable>
                <Pressable onPress={onClose} style={styles.cancelBtn}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </Pressable>
              </View>
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
    maxWidth: 500,
    maxHeight: "92%",
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
    fontSize: 17,
    fontWeight: "900",
  },
  closeBtn: {
    padding: 6,
    borderRadius: radii.pill,
    backgroundColor: "#F3F4F6",
  },
  amountBox: {
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: "#FFF0F1",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(225, 29, 72, 0.15)",
  },
  amountLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
  },
  amountValue: {
    color: colors.brand,
    fontSize: 28,
    fontWeight: "900",
    marginTop: 2,
  },
  activeContent: {
    gap: spacing.md,
  },
  iframeContainer: {
    borderRadius: radii.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
  },
  portalLinkBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingVertical: 14,
    borderRadius: radii.md,
    backgroundColor: colors.brand,
  },
  portalLinkText: {
    color: "white",
    fontWeight: "900",
    fontSize: 15,
  },
  pollingCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: "#F9FAFB",
    borderWidth: 1,
    borderColor: colors.border,
  },
  pulseDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.brand,
  },
  pollingTitle: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: "800",
  },
  pollingSub: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },
  actionsRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  verifyBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.brand,
    backgroundColor: "#FFF0F1",
  },
  verifyBtnText: {
    color: colors.brand,
    fontWeight: "900",
    fontSize: 13,
  },
  cancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: "#F3F4F6",
  },
  cancelBtnText: {
    color: colors.ink,
    fontWeight: "800",
    fontSize: 13,
  },
  statusBoxSuccess: {
    padding: spacing.xl,
    borderRadius: radii.lg,
    backgroundColor: colors.success,
    alignItems: "center",
    gap: spacing.sm,
  },
  statusTitleSuccess: {
    color: "white",
    fontSize: 22,
    fontWeight: "900",
  },
  statusSubSuccess: {
    color: "white",
    textAlign: "center",
    fontSize: 14,
    lineHeight: 20,
  },
  statusBoxFailed: {
    padding: spacing.xl,
    borderRadius: radii.lg,
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FCA5A5",
    alignItems: "center",
    gap: spacing.sm,
  },
  statusTitleFailed: {
    color: colors.danger,
    fontSize: 20,
    fontWeight: "900",
  },
  statusSubFailed: {
    color: colors.ink,
    textAlign: "center",
    fontSize: 14,
    lineHeight: 20,
  },
  primaryBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: radii.md,
    backgroundColor: colors.brand,
    marginTop: spacing.sm,
  },
  primaryBtnText: {
    color: "white",
    fontWeight: "900",
  },
});
