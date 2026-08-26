import * as Clipboard from "expo-clipboard";
import * as Linking from "expo-linking";
import { CheckCircle2, ShieldCheck, X, Copy, Landmark, RefreshCw, Check, ExternalLink } from "lucide-react-native";
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

export interface BankTransferModalProps {
  visible: boolean;
  depositId: string | null;
  checkoutUrl?: string | null;
  amount: number | null;
  currency: string;
  bankName?: string;
  accountNumber?: string;
  accountName?: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function BankTransferModal({
  visible,
  depositId,
  checkoutUrl,
  amount,
  currency,
  bankName = "Guaranty Trust Bank",
  accountNumber = "0123456789",
  accountName = "Skima LPG Operations",
  onClose,
  onSuccess,
}: BankTransferModalProps) {
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);

  // Poll deposit status automatically
  const deposits = useGatewayQuery({
    key: ["deposits", "bank-transfer-modal"],
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

  // Extract account details from deposit metadata or backend if available
  const activeBankName = firstString(currentDeposit, ["bank_name", "bankName"]) ?? bankName;
  const activeAccNumber = firstString(currentDeposit, ["account_number", "accountNumber"]) ?? accountNumber;
  const activeAccName = firstString(currentDeposit, ["account_name", "accountName"]) ?? accountName;

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

  const copyToClipboard = async () => {
    await Clipboard.setStringAsync(activeAccNumber);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  const handleManualCheck = async () => {
    setChecking(true);
    await deposits.refetch();
    setChecking(false);
  };

  const openExternalPaystack = async () => {
    if (checkoutUrl) {
      if (Platform.OS === "web") {
        window.open(checkoutUrl, "_blank", "noopener,noreferrer");
      } else if (await Linking.canOpenURL(checkoutUrl)) {
        await Linking.openURL(checkoutUrl);
      }
    }
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
              <Landmark color={colors.brand} size={22} />
              <Text style={styles.headerTitle}>Bank Transfer Payment</Text>
            </View>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <X color={colors.ink} size={20} />
            </Pressable>
          </View>

          {isSuccess ? (
            <View style={styles.statusBoxSuccess}>
              <CheckCircle2 color="white" size={48} />
              <Text style={styles.statusTitleSuccess}>Deposit Received!</Text>
              <Text style={styles.statusSubSuccess}>
                Your bank transfer was detected and your wallet balance has been credited. Returning to your wallet...
              </Text>
            </View>
          ) : (
            <View style={styles.activeContent}>
              {/* Amount Header */}
              <View style={styles.amountBox}>
                <Text style={styles.amountLabel}>AMOUNT TO TRANSFER</Text>
                <Text style={styles.amountValue}>{formattedAmount}</Text>
              </View>

              {/* Virtual Account Card */}
              <View style={styles.accountCard}>
                <Text style={styles.cardHeaderLabel}>TRANSFER DETAILS</Text>
                
                <View style={styles.accountRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.detailLabel}>Bank Name</Text>
                    <Text style={styles.detailValue}>{activeBankName}</Text>
                  </View>
                </View>

                <View style={styles.accountRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.detailLabel}>Account Number</Text>
                    <Text style={styles.accountNumberText}>{activeAccNumber}</Text>
                  </View>
                  <Pressable onPress={() => void copyToClipboard()} style={[styles.copyBtn, copied && styles.copiedBtn]}>
                    {copied ? <Check color="white" size={16} /> : <Copy color={colors.brand} size={16} />}
                    <Text style={[styles.copyBtnText, copied && styles.copiedBtnText]}>
                      {copied ? "Copied" : "Copy"}
                    </Text>
                  </Pressable>
                </View>

                <View style={styles.accountRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.detailLabel}>Account Name</Text>
                    <Text style={styles.detailValue}>{activeAccName}</Text>
                  </View>
                </View>
              </View>

              {/* Instructions */}
              <View style={styles.instructionsBox}>
                <Text style={styles.instructionStep}>1. Copy the account number above.</Text>
                <Text style={styles.instructionStep}>
                  2. Open your bank app & send <Text style={{ fontWeight: "900", color: colors.brand }}>{formattedAmount}</Text>.
                </Text>
                <Text style={styles.instructionStep}>3. Transfer is detected automatically in seconds.</Text>
              </View>

              {/* Paystack Virtual Account Button */}
              {checkoutUrl ? (
                <Pressable onPress={() => void openExternalPaystack()} style={styles.portalLinkBtn}>
                  <ExternalLink color="white" size={18} />
                  <Text style={styles.portalLinkText}>
                    {Platform.OS === "web" ? "Open Paystack Virtual Account Portal" : "Generate Paystack Virtual Account"}
                  </Text>
                </Pressable>
              ) : null}

              {/* Live Polling Card */}
              <View style={styles.pollingCard}>
                {deposits.isFetching || checking ? (
                  <ActivityIndicator color={colors.brand} size="small" />
                ) : (
                  <View style={styles.pulseDot} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.pollingTitle}>Waiting for your bank transfer</Text>
                  <Text style={styles.pollingSub}>
                    We are checking for your transfer. Your balance will update as soon as it is confirmed.
                  </Text>
                </View>
              </View>

              {/* Actions */}
              <View style={styles.actionsRow}>
                <Pressable
                  disabled={checking}
                  onPress={() => void handleManualCheck()}
                  style={styles.verifyBtn}
                >
                  <RefreshCw color={colors.brand} size={16} />
                  <Text style={styles.verifyBtnText}>I've Sent the Money</Text>
                </Pressable>
                <Pressable onPress={onClose} style={styles.cancelBtn}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </Pressable>
              </View>

              <Text style={styles.securityNote}>
                <ShieldCheck color={colors.muted} size={14} /> Secure bank transfer powered by Paystack
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
    fontWeight: "900",
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
  accountCard: {
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: "#F9FAFB",
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  cardHeaderLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
  },
  accountRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  detailLabel: {
    color: colors.muted,
    fontSize: 12,
  },
  detailValue: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "800",
    marginTop: 2,
  },
  accountNumberText: {
    color: colors.brand,
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: 1.5,
    marginTop: 2,
  },
  copyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.pill,
    backgroundColor: "#FFF0F1",
    borderWidth: 1,
    borderColor: colors.brand,
  },
  copiedBtn: {
    backgroundColor: colors.success,
    borderColor: colors.success,
  },
  copyBtnText: {
    color: colors.brand,
    fontWeight: "900",
    fontSize: 13,
  },
  copiedBtnText: {
    color: "white",
  },
  instructionsBox: {
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: "#F3F4F6",
    gap: 4,
  },
  instructionStep: {
    color: colors.ink,
    fontSize: 13,
    lineHeight: 18,
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
  portalLinkBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: radii.md,
    backgroundColor: colors.brand,
    marginVertical: 4,
  },
  portalLinkText: {
    color: "white",
    fontWeight: "900",
    fontSize: 14,
  },
  securityNote: {
    color: colors.muted,
    fontSize: 11,
    textAlign: "center",
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
});
