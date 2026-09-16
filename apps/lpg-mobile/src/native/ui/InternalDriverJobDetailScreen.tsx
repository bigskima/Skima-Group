import { useNetInfo } from "@react-native-community/netinfo";
import { router, useLocalSearchParams } from "expo-router";
import { CheckCircle2, MapPin, Navigation, PackageCheck, ReceiptText, ScanLine, ShieldCheck, Store } from "lucide-react-native";
import { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useJobDetails } from "../api/domains";
import { useGatewayMutation } from "../api/gateway";
import { ActionResponseSchema, displayStatus, displayTitle, firstNumber, firstString, nestedRecord, recordId } from "../api/records";
import { readOperationalLocation } from "../device/location";
import { openDeviceNavigation } from "../device/navigation";
import { Scanner } from "../device/Scanner";
import { OperationalMap, type MapPoint } from "../maps/OperationalMap";
import { useSession } from "../session/SessionProvider";
import { draftStore } from "../storage/drafts";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { operationIdempotencyKey } from "../utilities/idempotency";
import { AppButton } from "./AppButton";
import { EmptyState } from "./EmptyState";
import { EvidenceCapture } from "./EvidenceCapture";
import { Screen } from "./Screen";
import { ScreenSkeleton } from "./ScreenSkeleton";
import { StatusPill } from "./StatusPill";

export function InternalDriverJobDetailScreen() {
  const params = useLocalSearchParams<{ id?: string; scannedToken?: string }>();
  const id = params.id ?? null;
  const session = useSession();
  const network = useNetInfo();
  const { palette } = useAppTheme();
  const detail = useJobDetails(id);
  const draftOwner = session.context?.profile?.id ?? session.context?.user.id ?? session.session?.user.id ?? "";
  const [token, setToken] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeSuccess, setNoticeSuccess] = useState(false);
  const [supplierName, setSupplierName] = useState("");
  const [supplierAddress, setSupplierAddress] = useState("");
  const [supplierPricePerKg, setSupplierPricePerKg] = useState("");
  const [actualKg, setActualKg] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"skima_operational_fund" | "driver_personal_reimbursement" | "other">("skima_operational_fund");
  const [receiptMediaAssetId, setReceiptMediaAssetId] = useState<string | null>(null);
  const [safetyConfirmed, setSafetyConfirmed] = useState(false);
  const [safetyNotes, setSafetyNotes] = useState("");
  const [confirmingRefill, setConfirmingRefill] = useState(false);

  useEffect(() => {
    if (params.scannedToken) setToken(params.scannedToken);
  }, [params.scannedToken]);

  useEffect(() => {
    if (!draftOwner || !id) return;
    void draftStore.load(draftOwner, `internal-refill-${id}`).then((draft) => {
      if (!draft) return;
      setSupplierName(String(draft.values.supplierName ?? ""));
      setSupplierAddress(String(draft.values.supplierAddress ?? ""));
      setSupplierPricePerKg(String(draft.values.supplierPricePerKg ?? ""));
      setActualKg(String(draft.values.actualKg ?? ""));
      setSafetyNotes(String(draft.values.safetyNotes ?? ""));
      setSafetyConfirmed(draft.values.safetyConfirmed === true);
      setReceiptMediaAssetId(typeof draft.values.receiptMediaAssetId === "string" ? draft.values.receiptMediaAssetId : null);
      const savedMethod = draft.values.paymentMethod;
      if (savedMethod === "driver_personal_reimbursement" || savedMethod === "other" || savedMethod === "skima_operational_fund") {
        setPaymentMethod(savedMethod);
      }
    });
  }, [draftOwner, id]);

  useEffect(() => {
    if (!draftOwner || !id) return;
    const now = new Date().toISOString();
    void draftStore.save({
      version: 1,
      type: `internal-refill-${id}`,
      ownerProfileId: draftOwner,
      step: receiptMediaAssetId ? "supplier-receipt-ready" : "supplier-details",
      values: {
        supplierName,
        supplierAddress,
        supplierPricePerKg,
        actualKg,
        paymentMethod,
        safetyConfirmed,
        safetyNotes,
        receiptMediaAssetId,
      },
      pendingMedia: [],
      createdAt: now,
      updatedAt: now,
    });
  }, [actualKg, draftOwner, id, paymentMethod, receiptMediaAssetId, safetyConfirmed, safetyNotes, supplierAddress, supplierName, supplierPricePerKg]);

  const scan = useGatewayMutation({
    path: "/lpg/scans",
    schema: ActionResponseSchema,
    invalidate: [["jobs"], ["orders"], ["scans"]],
  });
  const action = useGatewayMutation({
    path: "/lpg/orders/actions",
    schema: ActionResponseSchema,
    invalidate: [["jobs"], ["orders"]],
  });

  const root = detail.data;
  const order = nestedRecord(root, "order") ?? root;
  const cylinder = nestedRecord(root, "cylinder") ?? nestedRecord(order, "cylinder");
  const pickup = nestedRecord(root, "pickupLocation") ?? nestedRecord(order, "pickupLocation");
  const delivery = nestedRecord(root, "deliveryLocation") ?? nestedRecord(order, "deliveryLocation");
  const latestDriver = nestedRecord(root, "latestDriverLocation") ?? nestedRecord(root, "driverLocation");
  const status = displayStatus(order ?? {}) ?? "unknown";
  const requestedKg = firstNumber(order, ["requestedKg", "requested_kg"]);
  const earningAmount = firstNumber(order, ["driverCommissionAmount", "driver_commission_amount"]);
  const currencyCode = firstString(order, ["currencyCode", "currency_code"]) ?? "NGN";
  const routePoints = [
    locationPoint(pickup, "Pickup"),
    locationPoint(delivery, "Return"),
    locationPoint(latestDriver, "Driver"),
  ].filter((point): point is MapPoint => Boolean(point));
  const navigationTarget = ["refill_confirmed", "return_en_route", "delivery_verification_pending"].includes(status)
    ? locationPoint(delivery, "customer")
    : ["driver_accepted", "pickup_en_route"].includes(status)
      ? locationPoint(pickup, "customer")
      : null;
  const scanType = driverScanTypeForStatus(status);
  const actionKey = driverActionForStatus(status);
  const supplierFormReady = status === "station_verified" || status === "refill_in_progress";

  useEffect(() => {
    if (!actualKg && requestedKg !== null) setActualKg(String(requestedKg));
  }, [actualKg, requestedKg]);

  const runAction = async (key: string) => {
    if (!id) return;
    setNotice(null);
    try {
      await action.mutateAsync({
        actionKey: key,
        lpgOrderId: id,
        source: "skima.lpg.internal_mobile",
        idempotencyKey: operationIdempotencyKey(key, id),
      });
      setNoticeSuccess(true);
      setNotice(actionSuccess(key));
      await detail.refetch();
    } catch (cause) {
      setNoticeSuccess(false);
      setNotice(friendlyError(cause, "The job could not be updated."));
    }
  };

  const submitScan = async () => {
    if (!id || !token || !scanType) return;
    if (network.isConnected === false) {
      setNoticeSuccess(false);
      setNotice("Waiting for connection. The scan has not been submitted to SKIMA yet.");
      return;
    }
    setNotice(null);
    try {
      const location = await readOperationalLocation().catch(() => null);
      await scan.mutateAsync({
        ...(location ?? {}),
        idempotencyKey: operationIdempotencyKey(`internal-${scanType}`, id),
        lpgOrderId: id,
        scanType,
        source: "skima.lpg.internal_mobile",
        payload: {
          scannedCylinderId: recordId(cylinder ?? {}),
          scannedToken: token,
          fulfillmentChannel: "skima_internal",
        },
      });
      setToken("");
      setNoticeSuccess(true);
      setNotice(scanSuccess(scanType));
      await detail.refetch();
    } catch (cause) {
      setNoticeSuccess(false);
      setNotice(friendlyError(cause, "SKIMA could not verify this cylinder scan."));
    }
  };

  const confirmInternalRefill = async () => {
    if (!id) return;
    const kg = Number(actualKg);
    const price = Number(supplierPricePerKg);
    if (!supplierName.trim()) {
      setNoticeSuccess(false);
      setNotice("Enter the LPG supplier name.");
      return;
    }
    if (!Number.isFinite(kg) || kg <= 0 || !Number.isFinite(price) || price <= 0) {
      setNoticeSuccess(false);
      setNotice("Enter valid actual kilograms and supplier price per kg.");
      return;
    }
    if (!receiptMediaAssetId) {
      setNoticeSuccess(false);
      setNotice("Upload the supplier receipt before confirming the refill.");
      return;
    }
    if (!safetyConfirmed) {
      setNoticeSuccess(false);
      setNotice("Confirm that the cylinder is safe to fill before continuing.");
      return;
    }
    if (network.isConnected === false) {
      setNoticeSuccess(false);
      setNotice("Waiting for connection. Supplier details remain saved on this device.");
      return;
    }

    setConfirmingRefill(true);
    setNotice(null);
    try {
      const location = await readOperationalLocation().catch(() => null);
      const result = await session.supabase.rpc("confirm_lpg_internal_refill", {
        target_actual_kg: kg,
        target_evidence_media_asset_ids: [],
        target_idempotency_key: operationIdempotencyKey("internal-refill-confirm", id),
        target_lpg_order_id: id,
        target_metadata: { app: "lpg-mobile", fulfillmentChannel: "skima_internal" },
        target_override_reason: null,
        target_payment_method: paymentMethod,
        target_receipt_media_asset_id: receiptMediaAssetId,
        target_safety_observations: { result: "safe", notes: safetyNotes.trim() || undefined },
        target_source: "lpg.internal_mobile",
        target_supplier_address: supplierAddress.trim() || null,
        target_supplier_latitude: location?.latitude ?? null,
        target_supplier_longitude: location?.longitude ?? null,
        target_supplier_name: supplierName.trim(),
        target_supplier_price_per_kg: price,
      });
      if (result.error) throw result.error;
      await draftStore.clear(draftOwner, `internal-refill-${id}`);
      setNoticeSuccess(true);
      setNotice("Supplier refill recorded. Your SKIMA earning is accrued and the cylinder can now be returned to the customer.");
      await detail.refetch();
    } catch (cause) {
      setNoticeSuccess(false);
      setNotice(friendlyError(cause, "The supplier refill could not be confirmed. Your entries remain saved."));
    } finally {
      setConfirmingRefill(false);
    }
  };

  return (
    <Screen
      eyebrow="SKIMA fulfillment"
      title={order ? displayTitle(order) : "Internal delivery job"}
      subtitle="Pickup, source a safe LPG refill, record the supplier receipt and return the verified cylinder."
      action={<AppButton label="Back" variant="ghost" size="sm" onPress={() => router.back()} />}
    >
      {detail.isPending ? (
        <ScreenSkeleton cards={4} />
      ) : detail.error || !order ? (
        <EmptyState
          icon={<PackageCheck color={palette.brand} size={28} />}
          title="Internal job could not be loaded"
          description={friendlyError(detail.error, "Refresh the job and try again.")}
          action={<AppButton label="Retry" onPress={() => void detail.refetch()} />}
        />
      ) : (
        <>
          <View style={[styles.hero, shadows.raised, { backgroundColor: palette.brand }]}>
            <View style={styles.heroCopy}>
              <Text style={styles.heroEyebrow}>SKIMA MANAGED JOB</Text>
              <Text style={styles.heroTitle}>{friendlyStatus(status)}</Text>
              <Text style={styles.heroBody}>{stageDescription(status)}</Text>
            </View>
            <StatusPill label={friendlyStatus(status)} tone={["completed", "delivered"].includes(status) ? "success" : "info"} />
          </View>

          <View style={[styles.noticeCard, { backgroundColor: palette.brandSoft, borderColor: palette.border }]}>
            <ShieldCheck color={palette.brand} size={22} />
            <Text style={[styles.noticeBody, { color: palette.ink }]}>This is a SKIMA-managed fulfillment. Do not ask a marketplace Station to process it in the Station app. Use a suitable supplier and record the real purchase below.</Text>
          </View>

          {routePoints.length ? <View style={[styles.mapShell, shadows.soft]}><OperationalMap points={routePoints} height={330} /></View> : null}

          <View style={[styles.card, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <Field label="Cylinder" value={cylinder ? displayTitle(cylinder) : "Not available"} />
            <Field label="Requested refill" value={requestedKg === null ? "Not available" : `${requestedKg} kg`} />
            <Field label="Internal earning" value={earningAmount === null ? "Calculated by policy" : `${currencyCode} ${earningAmount.toLocaleString()}`} />
            <Text style={[styles.helper, { color: palette.muted }]}>Internal earnings accrue separately and are not added to the self-withdrawable marketplace Driver wallet.</Text>
          </View>

          {navigationTarget ? (
            <AppButton
              label={`Navigate to ${navigationTarget.label}`}
              fullWidth
              size="lg"
              icon={<Navigation color="#FFFFFF" size={18} />}
              onPress={() => void openDeviceNavigation(navigationTarget).catch((cause) => {
                setNoticeSuccess(false);
                setNotice(friendlyError(cause, "Navigation could not be opened."));
              })}
            />
          ) : null}

          {actionKey ? (
            <AppButton
              label={actionLabel(actionKey)}
              fullWidth
              size="lg"
              loading={action.isPending}
              onPress={() => void runAction(actionKey)}
            />
          ) : null}

          {scanType ? (
            <View style={[styles.card, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <View style={styles.sectionLead}>
                <ScanLine color={palette.brand} size={22} />
                <View style={styles.sectionCopy}>
                  <Text style={[styles.sectionTitle, { color: palette.ink }]}>{scanTitle(scanType)}</Text>
                  <Text style={[styles.helper, { color: palette.muted }]}>{scanDescription(scanType)}</Text>
                </View>
              </View>
              <Scanner enabled onDetected={setToken} />
              {token ? <AppButton label={scanButton(scanType)} fullWidth loading={scan.isPending} onPress={() => void submitScan()} /> : null}
            </View>
          ) : null}

          {supplierFormReady ? (
            <View style={[styles.card, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <View style={styles.sectionLead}>
                <Store color={palette.brand} size={22} />
                <View style={styles.sectionCopy}>
                  <Text style={[styles.sectionTitle, { color: palette.ink }]}>Record supplier refill</Text>
                  <Text style={[styles.helper, { color: palette.muted }]}>Use the real supplier name, actual kg and actual price. SKIMA blocks prices above the configured procurement ceiling unless Operations approves an override.</Text>
                </View>
              </View>

              <Input label="Supplier name" value={supplierName} onChangeText={setSupplierName} placeholder="Supplier or station name" />
              <Input label="Supplier address (optional)" value={supplierAddress} onChangeText={setSupplierAddress} placeholder="Road, town or landmark" />
              <Input label="Actual kilograms filled" value={actualKg} onChangeText={setActualKg} placeholder="e.g. 6" numeric />
              <Input label="Supplier price per kg" value={supplierPricePerKg} onChangeText={setSupplierPricePerKg} placeholder="e.g. 950" numeric />

              <Text style={[styles.fieldLabel, { color: palette.ink }]}>How was the supplier paid?</Text>
              <View style={styles.buttonRow}>
                <AppButton label="SKIMA fund" size="sm" variant={paymentMethod === "skima_operational_fund" ? "primary" : "secondary"} onPress={() => setPaymentMethod("skima_operational_fund")} />
                <AppButton label="I paid" size="sm" variant={paymentMethod === "driver_personal_reimbursement" ? "primary" : "secondary"} onPress={() => setPaymentMethod("driver_personal_reimbursement")} />
                <AppButton label="Other" size="sm" variant={paymentMethod === "other" ? "primary" : "secondary"} onPress={() => setPaymentMethod("other")} />
              </View>

              <AppButton
                label={safetyConfirmed ? "Cylinder confirmed safe" : "Confirm cylinder is safe to fill"}
                fullWidth
                variant={safetyConfirmed ? "secondary" : "primary"}
                icon={<ShieldCheck color={safetyConfirmed ? palette.brand : "#FFFFFF"} size={18} />}
                onPress={() => setSafetyConfirmed((value) => !value)}
              />
              <Input label="Safety / supplier note (optional)" value={safetyNotes} onChangeText={setSafetyNotes} placeholder="Add any relevant observation" multiline />

              <EvidenceCapture
                assetTypeKey="media.lpg.procurement_receipt"
                label={receiptMediaAssetId ? "Supplier receipt uploaded" : "Upload supplier receipt"}
                draftType={`internal-procurement-receipt-${id ?? "unknown"}`}
                onUploaded={async (assetId) => {
                  setReceiptMediaAssetId(assetId);
                  setNoticeSuccess(true);
                  setNotice("Supplier receipt uploaded. You can confirm the refill when the other details are complete.");
                }}
              />

              <AppButton
                label="Confirm supplier refill"
                fullWidth
                size="lg"
                loading={confirmingRefill}
                disabled={!receiptMediaAssetId || !safetyConfirmed}
                icon={<ReceiptText color="#FFFFFF" size={18} />}
                onPress={() => void confirmInternalRefill()}
              />
            </View>
          ) : null}

          {["delivered", "completed"].includes(status) ? (
            <View style={[styles.noticeCard, { backgroundColor: palette.successSoft, borderColor: palette.border }]}>
              <CheckCircle2 color={palette.success} size={22} />
              <Text style={[styles.noticeBody, { color: palette.ink }]}>Delivery is verified. Your internal earning is recorded separately for SKIMA Operations approval/payment; no marketplace wallet withdrawal is created.</Text>
            </View>
          ) : null}

          {notice ? (
            <View style={[styles.message, { backgroundColor: noticeSuccess ? palette.successSoft : palette.dangerSoft }]}>
              <Text accessibilityRole="alert" style={{ color: noticeSuccess ? palette.success : palette.danger, fontWeight: "700" }}>{notice}</Text>
            </View>
          ) : null}
        </>
      )}
    </Screen>
  );
}

function Input({ label, value, onChangeText, placeholder, numeric = false, multiline = false }: {
  label: string;
  value: string;
  onChangeText(value: string): void;
  placeholder: string;
  numeric?: boolean;
  multiline?: boolean;
}) {
  const { palette } = useAppTheme();
  return (
    <View style={styles.fieldGroup}>
      <Text style={[styles.fieldLabel, { color: palette.ink }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType={numeric ? "decimal-pad" : "default"}
        multiline={multiline}
        placeholder={placeholder}
        placeholderTextColor={palette.muted}
        style={[styles.input, multiline && styles.multiline, { backgroundColor: palette.input, borderColor: palette.borderStrong, color: palette.ink }]}
      />
    </View>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  const { palette } = useAppTheme();
  return <View style={styles.fieldRow}><Text style={[styles.fieldLabelSmall, { color: palette.muted }]}>{label}</Text><Text style={[styles.fieldValue, { color: palette.ink }]}>{value}</Text></View>;
}

function locationPoint(record: ReturnType<typeof nestedRecord>, label: string): MapPoint | null {
  const latitude = firstNumber(record, ["latitude", "lat"]);
  const longitude = firstNumber(record, ["longitude", "lng", "lon"]);
  return latitude !== null && longitude !== null ? { latitude, longitude, label } : null;
}

function driverScanTypeForStatus(status: string): "customer_pickup" | "station_receipt" | "customer_delivery" | null {
  if (["driver_accepted", "pickup_en_route"].includes(status)) return "customer_pickup";
  if (["pickup_verified", "station_en_route"].includes(status)) return "station_receipt";
  if (["return_en_route", "delivery_verification_pending"].includes(status)) return "customer_delivery";
  return null;
}

function driverActionForStatus(status: string) {
  if (status === "driver_accepted") return "lpg.pickup.start";
  if (status === "pickup_verified") return "lpg.station.start";
  if (status === "refill_confirmed") return "lpg.return.start";
  if (status === "return_en_route") return "lpg.delivery.pending";
  return null;
}

function actionLabel(key: string) {
  if (key === "lpg.pickup.start") return "Start customer pickup";
  if (key === "lpg.station.start") return "Continue to LPG supplier";
  if (key === "lpg.return.start") return "Start return delivery";
  if (key === "lpg.delivery.pending") return "Arrived for customer hand-over";
  return "Continue job";
}

function actionSuccess(key: string) {
  if (key === "lpg.station.start") return "Supplier leg started. Choose a suitable LPG supplier and verify the cylinder on arrival.";
  if (key === "lpg.return.start") return "Return delivery started.";
  if (key === "lpg.delivery.pending") return "Arrival recorded. Complete the customer verification and final cylinder scan.";
  return "Job updated.";
}

function scanTitle(type: "customer_pickup" | "station_receipt" | "customer_delivery") {
  if (type === "station_receipt") return "Verify cylinder at supplier";
  if (type === "customer_delivery") return "Verify final customer hand-over";
  return "Verify customer pickup";
}

function scanDescription(type: "customer_pickup" | "station_receipt" | "customer_delivery") {
  if (type === "station_receipt") return "At the supplier, scan the same SKIMA cylinder before recording the purchase and refill.";
  if (type === "customer_delivery") return "The customer delivery challenge must be verified before this final cylinder scan can close the order.";
  return "Scan the customer's registered SKIMA cylinder before taking custody.";
}

function scanButton(type: "customer_pickup" | "station_receipt" | "customer_delivery") {
  if (type === "station_receipt") return "Confirm supplier arrival";
  if (type === "customer_delivery") return "Complete hand-over";
  return "Confirm pickup";
}

function scanSuccess(type: "customer_pickup" | "station_receipt" | "customer_delivery") {
  if (type === "station_receipt") return "Supplier arrival verified. Record the real refill and supplier receipt next.";
  if (type === "customer_delivery") return "Delivery verified. SKIMA is closing the internal settlement and approving your accrued earning.";
  return "Cylinder pickup verified.";
}

function friendlyStatus(status: string) {
  const labels: Record<string, string> = {
    driver_offered: "Assigning SKIMA driver",
    driver_accepted: "Internal job assigned",
    pickup_en_route: "Heading to customer",
    pickup_verified: "Cylinder collected",
    station_en_route: "Source refill from supplier",
    station_verified: "Supplier arrival verified",
    refill_in_progress: "Recording supplier refill",
    refill_confirmed: "Supplier refill confirmed",
    return_en_route: "Returning to customer",
    delivery_verification_pending: "Customer hand-over",
    delivered: "Delivery verified",
    completed: "Internal job completed",
  };
  return labels[status] ?? status.replace(/_/g, " ");
}

function stageDescription(status: string) {
  if (["driver_offered", "driver_accepted"].includes(status)) return "This job is reserved for a managed SKIMA fulfillment driver.";
  if (status === "pickup_en_route") return "Collect and verify the customer's registered cylinder.";
  if (status === "pickup_verified") return "Continue to a suitable LPG supplier for the requested refill.";
  if (status === "station_en_route") return "Choose a safe supplier, then scan the cylinder when you arrive.";
  if (["station_verified", "refill_in_progress"].includes(status)) return "Record the supplier, actual price, actual kilograms, safety check and receipt.";
  if (["refill_confirmed", "return_en_route"].includes(status)) return "Return the filled cylinder to the customer.";
  if (status === "delivery_verification_pending") return "Complete customer delivery verification and the final cylinder scan.";
  return "Follow the SKIMA-managed fulfillment workflow.";
}

const styles = StyleSheet.create({
  hero: { borderRadius: radii.xl, padding: spacing.xl, gap: spacing.md },
  heroCopy: { gap: 6 },
  heroEyebrow: { color: "rgba(255,255,255,0.72)", fontSize: 12, fontWeight: "900", letterSpacing: 1 },
  heroTitle: { color: "#FFFFFF", fontSize: typography.title.fontSize, fontWeight: "900" },
  heroBody: { color: "rgba(255,255,255,0.88)", lineHeight: 21 },
  card: { borderWidth: 1, borderRadius: radii.xl, padding: spacing.lg, gap: spacing.md },
  noticeCard: { borderWidth: 1, borderRadius: radii.lg, padding: spacing.lg, flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  noticeBody: { flex: 1, lineHeight: 21, fontWeight: "600" },
  mapShell: { borderRadius: radii.xl, overflow: "hidden" },
  sectionLead: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  sectionCopy: { flex: 1, gap: 4 },
  sectionTitle: { fontSize: 18, fontWeight: "900" },
  helper: { lineHeight: 20 },
  fieldGroup: { gap: spacing.xs },
  fieldLabel: { fontWeight: "800" },
  input: { minHeight: 50, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  multiline: { minHeight: 90, textAlignVertical: "top" },
  buttonRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  fieldRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  fieldLabelSmall: { flex: 1, fontWeight: "700" },
  fieldValue: { flex: 1, textAlign: "right", fontWeight: "800" },
  message: { borderRadius: radii.md, padding: spacing.md },
});
