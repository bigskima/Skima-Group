import * as Linking from "expo-linking";
import { AlertCircle, CheckCircle2, RefreshCw, ShieldCheck, X } from "lucide-react-native";
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
          firstString(item, ["id", "public_reference", "publicReference"]) === depositId,
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

  const openCheckoutWindow = async () => {
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
              <Text style={styles.headerTitle}>Secure Payment</Text>
            </View>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <X color={colors.ink} size={20} />
            </Pressable>
          </View>

          {/* Amount Badge */}
          <View style={styles.amountBox}>
            <Text style={styles.amountLabel}>AMOUNT TO ADD</Text>
            <Text style={styles.amountValue}>{formattedAmount}</Text>
          </View>

          {/* Content Body */}
          {isSuccess ? (
            <View style={styles.statusBoxSuccess}>
              <CheckCircle2 color="white" size={48} />
              <Text style={styles.statusTitleSuccess}>Payment Successful</Text>
              <Text style={styles.statusSubSuccess}>
                Your wallet balance has been credited successfully. Returning to your wallet...
              </Text>
            </View>
          ) : isFailed ? (
            <View style={styles.statusBoxFailed}>
              <AlertCircle color={colors.danger} size={48} />
              <Text style={styles.statusTitleFailed}>Payment Failed</Text>
              <Text style={styles.statusSubFailed}>
                The payment could not be completed. You can try again.
              </Text>
              <Pressable onPress={onClose} style={styles.primaryBtn}>
                <Text style={styles.primaryBtnText}>Try Again</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.activeContent}>
              {Platform.OS === "web" && checkoutUrl ? (
                <View style={styles.iframeContainer}>
                  <iframe
                    src={checkoutUrl}
                    style={{
                      width: "100%",
                      height: 480,
                      border: "none",
                      borderRadius: radii.md,
                    }}
                    title="SKIMA Payment Checkout"
                  />
                </View>
              ) : (
                <View style={styles.nativePrompt}>
                  <Text style={styles.nativeTitle}>Complete Your Payment</Text>
                  <Text style={styles.nativeSub}>
                    Tap below to choose your preferred payment option (Bank Transfer, Card, USSD). Your wallet updates automatically once confirmed.
                  </Text>
                  <Pressable onPress={() => void openCheckoutWindow()} style={styles.primaryBtn}>
                    <Text style={styles.primaryBtnText}>Open Payment Window</Text>
                  </Pressable>
                </View>
              )}

              {/* Status Verification Bar */}
              <View style={styles.pollingBar}>
                <ActivityIndicator size="small" color={colors.brand} />
                <Text style={styles.pollingText}>
                  Waiting for confirmation from your bank...
                </Text>
                <Pressable onPress={() => void handleManualCheck()} style={styles.refreshBtn}>
                  {checking ? (
                    <ActivityIndicator size="small" color={colors.ink} />
                  ) : (
                    <RefreshCw size={16} color={colors.ink} />
                  )}
                </Pressable>
              </View>
            </View>
          )}

          {/* Footer Action */}
          <View style={styles.footer}>
            <Pressable onPress={onClose} style={styles.cancelBtn}>
              <Text style={styles.cancelBtnText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  container: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: spacing.lg,
    maxHeight: "92%",
    gap: spacing.md,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: colors.ink,
  },
  closeBtn: {
    padding: 6,
    borderRadius: radii.pill,
    backgroundColor: "#F3F4F6",
  },
  amountBox: {
    backgroundColor: "#FFF0F1",
    padding: spacing.md,
    borderRadius: radii.md,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#FEE2E2",
  },
  amountLabel: {
    fontSize: 11,
    fontWeight: "900",
    color: colors.brandDark,
    letterSpacing: 1.1,
  },
  amountValue: {
    fontSize: 28,
    fontWeight: "900",
    color: colors.brand,
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
  nativePrompt: {
    padding: spacing.lg,
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: "#FAFAFA",
    borderRadius: radii.lg,
  },
  nativeTitle: {
    fontSize: 17,
    fontWeight: "900",
    color: colors.ink,
  },
  nativeSub: {
    fontSize: 13,
    color: colors.muted,
    textAlign: "center",
    lineHeight: 19,
  },
  statusBoxSuccess: {
    backgroundColor: colors.success,
    padding: spacing.xl,
    borderRadius: radii.lg,
    alignItems: "center",
    gap: spacing.sm,
  },
  statusTitleSuccess: {
    fontSize: 22,
    fontWeight: "900",
    color: "white",
  },
  statusSubSuccess: {
    fontSize: 14,
    color: "rgba(255,255,255,0.9)",
    textAlign: "center",
    lineHeight: 20,
  },
  statusBoxFailed: {
    backgroundColor: "#FEF2F2",
    padding: spacing.xl,
    borderRadius: radii.lg,
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: "#FCA5A5",
  },
  statusTitleFailed: {
    fontSize: 20,
    fontWeight: "900",
    color: colors.danger,
  },
  statusSubFailed: {
    fontSize: 13,
    color: colors.muted,
    textAlign: "center",
    lineHeight: 18,
  },
  pollingBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: "#F9FAFB",
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pollingText: {
    flex: 1,
    fontSize: 12,
    color: colors.muted,
    fontWeight: "600",
  },
  refreshBtn: {
    padding: 6,
    borderRadius: radii.pill,
    backgroundColor: "#E5E7EB",
  },
  primaryBtn: {
    backgroundColor: colors.brand,
    paddingVertical: 14,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.md,
    alignItems: "center",
    width: "100%",
  },
  primaryBtnText: {
    color: "white",
    fontSize: 15,
    fontWeight: "900",
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    alignItems: "center",
  },
  cancelBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  cancelBtnText: {
    color: colors.muted,
    fontWeight: "800",
    fontSize: 14,
  },
});
