import * as Linking from "expo-linking";
import { AlertCircle, CheckCircle2, RefreshCw, ShieldCheck, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useGatewayQuery } from "../api/gateway";
import { RecordArraySchema, displayStatus, firstString, recordId } from "../api/records";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { AppButton } from "./AppButton";

const SUCCESS_STATUSES = new Set(["completed", "confirmed", "credited", "succeeded", "successful"]);
const FAILED_STATUSES = new Set(["cancelled", "failed", "rejected", "expired"]);

export interface PaymentCheckoutModalProps {
  visible: boolean;
  checkoutUrl: string | null;
  depositId: string | null;
  amount: number | null;
  currency: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function PaymentCheckoutModal({
  visible,
  checkoutUrl,
  depositId,
  amount,
  currency,
  onClose,
  onSuccess,
}: PaymentCheckoutModalProps) {
  const { palette, scheme } = useAppTheme();
  const [checking, setChecking] = useState(false);
  const deposits = useGatewayQuery({
    key: ["deposits", "checkout-modal", depositId],
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
  const status = currentDeposit ? (displayStatus(currentDeposit) ?? "pending").toLowerCase() : "pending";
  const isSuccess = SUCCESS_STATUSES.has(status);
  const isFailed = FAILED_STATUSES.has(status);

  useEffect(() => {
    if (!isSuccess) return;
    const timer = setTimeout(onSuccess, 1200);
    return () => clearTimeout(timer);
  }, [isSuccess, onSuccess]);

  if (!visible) return null;

  const formattedAmount = new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount ?? 0);

  const openCheckoutWindow = async () => {
    if (!checkoutUrl) return;
    if (Platform.OS === "web") {
      window.open(checkoutUrl, "_blank", "noopener,noreferrer");
    } else if (await Linking.canOpenURL(checkoutUrl)) {
      await Linking.openURL(checkoutUrl);
    }
  };

  const manualCheck = async () => {
    setChecking(true);
    await deposits.refetch();
    setChecking(false);
  };

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <View style={[styles.overlay, { backgroundColor: palette.overlay }]}> 
        <View style={[styles.container, shadows.raised, { backgroundColor: palette.surface, borderColor: palette.border }]}> 
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <View style={[styles.headerIcon, { backgroundColor: palette.brandSoft }]}>
                <ShieldCheck color={palette.brand} size={20} />
              </View>
              <View>
                <Text style={[styles.headerTitle, { color: palette.ink }]}>Secure payment</Text>
                <Text style={[styles.headerSub, { color: palette.muted }]}>Protected SKIMA checkout</Text>
              </View>
            </View>
            <Pressable accessibilityRole="button" onPress={onClose} style={[styles.closeBtn, { backgroundColor: palette.soft }]}>
              <X color={palette.ink} size={19} />
            </Pressable>
          </View>

          <View style={[styles.amountBox, { backgroundColor: palette.brandSofter, borderColor: palette.brandSoft }]}> 
            <Text style={[styles.amountLabel, { color: palette.muted }]}>AMOUNT TO ADD</Text>
            <Text style={[styles.amountValue, { color: palette.brand }]}>{formattedAmount}</Text>
          </View>

          {isSuccess ? (
            <View style={[styles.statusPanel, { backgroundColor: palette.successSoft }]}> 
              <CheckCircle2 color={palette.success} size={46} />
              <Text style={[styles.statusTitle, { color: palette.success }]}>Payment confirmed</Text>
              <Text style={[styles.statusBody, { color: palette.ink }]}>Your SKIMA Wallet is being refreshed with the confirmed payment.</Text>
            </View>
          ) : isFailed ? (
            <View style={[styles.statusPanel, { backgroundColor: palette.dangerSoft }]}> 
              <AlertCircle color={palette.danger} size={46} />
              <Text style={[styles.statusTitle, { color: palette.danger }]}>Payment not completed</Text>
              <Text style={[styles.statusBody, { color: palette.ink }]}>The payment session was not completed successfully. You can close this window and try again.</Text>
              <AppButton label="Close" variant="secondary" fullWidth onPress={onClose} />
            </View>
          ) : (
            <View style={styles.activeContent}>
              {Platform.OS === "web" && checkoutUrl ? (
                <View style={[styles.iframeContainer, { borderColor: palette.border, backgroundColor: palette.surfaceSubtle }]}> 
                  <iframe
                    src={checkoutUrl}
                    style={{ width: "100%", height: 480, border: "none", borderRadius: radii.md, colorScheme: scheme }}
                    title="SKIMA Payment Checkout"
                  />
                </View>
              ) : (
                <View style={[styles.nativePrompt, { backgroundColor: palette.surfaceSubtle }]}> 
                  <Text style={[styles.nativeTitle, { color: palette.ink }]}>Choose a secure payment option</Text>
                  <Text style={[styles.nativeSub, { color: palette.muted }]}>Continue to the secure payment window to use available card, bank transfer, or USSD options.</Text>
                  <AppButton label="Open payment window" fullWidth onPress={() => void openCheckoutWindow()} />
                </View>
              )}

              <View style={[styles.pollingBar, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}> 
                <ActivityIndicator size="small" color={palette.brand} />
                <Text style={[styles.pollingText, { color: palette.muted }]}>Waiting for payment confirmation…</Text>
                <Pressable accessibilityRole="button" onPress={() => void manualCheck()} style={[styles.refreshBtn, { backgroundColor: palette.soft }]}>
                  {checking ? <ActivityIndicator size="small" color={palette.ink} /> : <RefreshCw size={16} color={palette.ink} />}
                </Pressable>
              </View>
            </View>
          )}

          {!isSuccess ? <AppButton label="Done" variant="ghost" fullWidth onPress={onClose} /> : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  container: { borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg, maxHeight: "92%", gap: spacing.md },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md },
  headerTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm + 2 },
  headerIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  headerTitle: { ...typography.subheading, fontSize: 16 },
  headerSub: { ...typography.caption, fontSize: 11, marginTop: 2 },
  closeBtn: { width: 36, height: 36, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  amountBox: { padding: spacing.md, borderRadius: radii.lg, alignItems: "center", borderWidth: StyleSheet.hairlineWidth },
  amountLabel: { ...typography.eyebrow, fontSize: 9 },
  amountValue: { fontSize: 29, lineHeight: 36, fontWeight: "900", marginTop: 3 },
  activeContent: { gap: spacing.md },
  iframeContainer: { borderRadius: radii.md, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth },
  nativePrompt: { padding: spacing.lg, alignItems: "center", gap: spacing.md, borderRadius: radii.lg },
  nativeTitle: { ...typography.subheading, fontSize: 16, textAlign: "center" },
  nativeSub: { ...typography.caption, textAlign: "center", lineHeight: 18, maxWidth: 400 },
  statusPanel: { padding: spacing.xl, borderRadius: radii.lg, alignItems: "center", gap: spacing.sm },
  statusTitle: { ...typography.heading, fontSize: 19 },
  statusBody: { ...typography.body, textAlign: "center", lineHeight: 21, maxWidth: 390 },
  pollingBar: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radii.md, borderWidth: StyleSheet.hairlineWidth },
  pollingText: { ...typography.caption, flex: 1 },
  refreshBtn: { width: 34, height: 34, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});
