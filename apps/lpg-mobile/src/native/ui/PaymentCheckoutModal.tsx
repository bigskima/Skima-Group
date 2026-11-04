import * as Linking from "expo-linking";
import { AlertCircle, CheckCircle2, RefreshCw, ShieldCheck, X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useGatewayQuery } from "../api/gateway";
import { RecordArraySchema, displayStatus, firstString, recordId } from "../api/records";
import { useAppTheme } from "../theme/ThemeProvider";
import { spacing, typography } from "../theme/tokens";
import { AppButton } from "./AppButton";

const SUCCESS_STATUSES = new Set(["completed", "confirmed", "credited", "settled", "paid", "succeeded", "successful"]);
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
  const insets = useSafeAreaInsets();
  const webView = useRef<WebView>(null);
  const [checking, setChecking] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const deposits = useGatewayQuery({
    key: ["deposits", "checkout-modal", depositId],
    path: "/runtime/payments/deposits?scope=customer",
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

  useEffect(() => {
    if (visible) setCheckoutError(null);
  }, [visible, checkoutUrl]);

  if (!visible) return null;

  const formattedAmount = new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount ?? 0);

  const manualCheck = async () => {
    setChecking(true);
    try {
      await deposits.refetch();
    } finally {
      setChecking(false);
    }
  };

  return (
    <Modal
      animationType="slide"
      transparent={false}
      visible={visible}
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={[styles.fullscreen, { backgroundColor: palette.canvas }]}>
        <View style={[styles.header, { paddingTop: Math.max(12, insets.top + 6), borderBottomColor: palette.border }]}>
          <View style={styles.headerTitleRow}>
            <View style={[styles.headerIcon, { backgroundColor: palette.brandSoft }]}>
              <ShieldCheck color={palette.brand} size={20} />
            </View>
            <View style={styles.headerCopy}>
              <Text style={[styles.headerTitle, { color: palette.ink }]}>Secure payment</Text>
              <Text style={[styles.headerSub, { color: palette.muted }]}>Protected SKIMA checkout</Text>
            </View>
          </View>
          <Pressable accessibilityRole="button" onPress={onClose} style={[styles.closeBtn, { backgroundColor: palette.soft }]}>
            <X color={palette.ink} size={19} />
          </Pressable>
        </View>

        <View style={[styles.amountBar, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <View style={styles.amountCopy}>
            <Text style={[styles.amountLabel, { color: palette.muted }]}>AMOUNT TO PAY</Text>
            <Text adjustsFontSizeToFit minimumFontScale={0.65} numberOfLines={1} style={[styles.amountValue, { color: palette.brand }]}>{formattedAmount}</Text>
          </View>
          <View style={[styles.secureBadge, { backgroundColor: palette.successSoft }]}>
            <ShieldCheck color={palette.success} size={15} />
            <Text style={[styles.secureText, { color: palette.success }]}>Secure</Text>
          </View>
        </View>

        <View style={styles.webViewArea}>
          {isSuccess ? (
            <View style={[styles.statusPanel, { backgroundColor: palette.successSoft }]}>
              <CheckCircle2 color={palette.success} size={48} />
              <Text style={[styles.statusTitle, { color: palette.success }]}>Payment confirmed</Text>
              <Text style={[styles.statusBody, { color: palette.ink }]}>Your SKIMA Wallet is being refreshed with the confirmed payment.</Text>
            </View>
          ) : isFailed ? (
            <View style={[styles.statusPanel, { backgroundColor: palette.dangerSoft }]}>
              <AlertCircle color={palette.danger} size={48} />
              <Text style={[styles.statusTitle, { color: palette.danger }]}>Payment not completed</Text>
              <Text style={[styles.statusBody, { color: palette.ink }]}>The payment session was not completed successfully. You can close this screen and try again.</Text>
              <AppButton label="Close" variant="secondary" fullWidth onPress={onClose} />
            </View>
          ) : checkoutError ? (
            <View style={[styles.errorPanel, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <AlertCircle color={palette.danger} size={34} />
              <Text style={[styles.statusTitle, { color: palette.ink }]}>Checkout could not load</Text>
              <Text style={[styles.statusBody, { color: palette.muted }]}>{checkoutError}</Text>
              <AppButton label="Reload checkout" fullWidth onPress={() => { setCheckoutError(null); webView.current?.reload(); }} />
            </View>
          ) : checkoutUrl && Platform.OS === "web" ? (
            <iframe
              src={checkoutUrl}
              title="SKIMA secure payment checkout"
              style={{ width: "100%", height: "100%", minHeight: 420, border: "none", background: "#FFFFFF", colorScheme: scheme }}
            />
          ) : checkoutUrl ? (
            <WebView
              ref={webView}
              source={{ uri: checkoutUrl }}
              style={styles.webView}
              originWhitelist={["*"]}
              onShouldStartLoadWithRequest={(request) => {
                if (request.url.startsWith(Linking.createURL("payment-return"))) {
                  void manualCheck();
                  return false;
                }
                return request.url.startsWith("https://") || request.url.startsWith("http://");
              }}
              javaScriptEnabled
              domStorageEnabled
              sharedCookiesEnabled
              thirdPartyCookiesEnabled
              allowsBackForwardNavigationGestures
              setSupportMultipleWindows={false}
              startInLoadingState
              renderLoading={() => (
                <View style={[styles.webLoading, { backgroundColor: palette.surface }]}>
                  <ActivityIndicator size="large" color={palette.brand} />
                  <Text style={[styles.webLoadingText, { color: palette.muted }]}>Opening secure Paystack checkout…</Text>
                </View>
              )}
              onError={(event) => setCheckoutError(event.nativeEvent.description || "Check your connection and reload the payment page.")}
              onHttpError={(event) => {
                if (event.nativeEvent.statusCode >= 500) setCheckoutError("The payment provider is temporarily unavailable. Please retry.");
              }}
            />
          ) : (
            <View style={[styles.waitingPanel, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <ActivityIndicator size="large" color={palette.brand} />
              <Text style={[styles.statusTitle, { color: palette.ink }]}>Preparing payment</Text>
              <Text style={[styles.statusBody, { color: palette.muted }]}>Your deposit reference is saved. We are waiting for the payment provider to confirm the session.</Text>
            </View>
          )}
        </View>

        {!isSuccess ? (
          <View style={[styles.footer, { backgroundColor: palette.surface, borderTopColor: palette.border, paddingBottom: Math.max(12, insets.bottom + 8) }]}>
            <View style={styles.footerStatus}>
              <ActivityIndicator size="small" color={palette.brand} />
              <Text style={[styles.footerHint, { color: palette.muted }]}>{isFailed ? "Payment failed" : "Waiting for payment confirmation"}</Text>
              <Pressable accessibilityRole="button" onPress={() => void manualCheck()} style={[styles.refreshBtn, { backgroundColor: palette.soft }]}>
                {checking ? <ActivityIndicator size="small" color={palette.ink} /> : <RefreshCw size={16} color={palette.ink} />}
              </Pressable>
            </View>
            <AppButton label="Close checkout" variant="ghost" fullWidth onPress={onClose} />
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fullscreen: { flex: 1 },
  header: { minHeight: 60, paddingHorizontal: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  headerTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm + 2, flex: 1, minWidth: 0 },
  headerCopy: { flex: 1, minWidth: 0 },
  headerIcon: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  headerTitle: { ...typography.subheading, fontSize: 16 },
  headerSub: { ...typography.caption, fontSize: 11, marginTop: 2 },
  closeBtn: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  amountBar: { minHeight: 64, marginHorizontal: spacing.md, marginVertical: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  amountCopy: { flex: 1, minWidth: 0, gap: 2 },
  amountLabel: { ...typography.eyebrow, fontSize: 8 },
  amountValue: { fontSize: 20, lineHeight: 24, fontWeight: "900" },
  secureBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 99 },
  secureText: { fontSize: 10, fontWeight: "900" },
  webViewArea: { flex: 1, minHeight: 0, overflow: "hidden" },
  webView: { flex: 1, backgroundColor: "#FFFFFF" },
  webLoading: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", gap: 10 },
  webLoadingText: { ...typography.caption },
  waitingPanel: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl, borderWidth: StyleSheet.hairlineWidth, margin: spacing.md, borderRadius: 18 },
  statusPanel: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl },
  errorPanel: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl, borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, margin: spacing.md },
  statusTitle: { ...typography.heading, fontSize: 19, textAlign: "center" },
  statusBody: { ...typography.body, textAlign: "center", lineHeight: 21, maxWidth: 420 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.md, paddingTop: spacing.sm, gap: spacing.xs },
  footerStatus: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  footerHint: { ...typography.caption, flex: 1 },
  refreshBtn: { width: 34, height: 34, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});
