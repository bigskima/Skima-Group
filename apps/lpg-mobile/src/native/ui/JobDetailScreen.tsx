import { useNetInfo } from "@react-native-community/netinfo";
import { useLocalSearchParams, router } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { domainQueries, useJobDetails } from "../api/domains";
import { useGatewayMutation } from "../api/gateway";
import {
  ActionResponseSchema,
  displayStatus,
  displayTitle,
  firstNumber,
  firstString,
  nestedRecord,
  recordId,
} from "../api/records";
import { readOperationalLocation } from "../device/location";
import { openDeviceNavigation } from "../device/navigation";
import { Scanner } from "../device/Scanner";
import { OperationalMap, type MapPoint } from "../maps/OperationalMap";
import { useSession } from "../session/SessionProvider";
import { draftStore } from "../storage/drafts";
import { useAppTheme } from "../theme/ThemeProvider";
import { colors, radii, spacing } from "../theme/tokens";
import { operationIdempotencyKey } from "../utilities/idempotency";
import { friendlyError } from "../utilities/friendlyError";
import { Card } from "./Card";
import { EvidenceCapture } from "./EvidenceCapture";
import { Screen } from "./Screen";

export function JobDetailScreen({
  workspace,
}: {
  workspace: "driver" | "station";
}) {
  const params = useLocalSearchParams<{ id?: string; scannedToken?: string }>();
  const id = params.id ?? null;
  const session = useSession();
  const network = useNetInfo();
  const { palette } = useAppTheme();
  const draftOwner =
    session.context?.profile?.id ?? session.context?.user.id ?? session.session?.user.id ?? "";
  const detail = useJobDetails(id);
  const inspections = domainQueries.inspections();
  const [token, setToken] = useState("");
  useEffect(() => {
    if (params.scannedToken) setToken(params.scannedToken);
  }, [params.scannedToken]);
  const [notice, setNotice] = useState<string | null>(null);
  const [actualKg, setActualKg] = useState("");
  const [acceptedToken, setAcceptedToken] = useState("");
  const [inspectionResult, setInspectionResult] = useState("");
  const [inspectionNotes, setInspectionNotes] = useState("");
  useEffect(() => {
    if (!draftOwner || !id || workspace !== "station") return;
    void draftStore.load(draftOwner, `station-refill-${id}`).then((draft) => {
      setActualKg(String(draft?.values.actualKg ?? ""));
      setAcceptedToken(String(draft?.values.acceptedToken ?? ""));
      setInspectionResult(String(draft?.values.inspectionResult ?? ""));
      setInspectionNotes(String(draft?.values.inspectionNotes ?? ""));
    });
  }, [draftOwner, id, workspace]);
  useEffect(() => {
    if (
      !draftOwner ||
      !id ||
      workspace !== "station" ||
      (!actualKg && !acceptedToken && !inspectionResult && !inspectionNotes)
    )
      return;
    const now = new Date().toISOString();
    void draftStore.save({
      version: 1,
      type: `station-refill-${id}`,
      ownerProfileId: draftOwner,
      step: actualKg ? "actual-kilograms" : "inspection",
      values: { actualKg, acceptedToken, inspectionResult, inspectionNotes },
      pendingMedia: [],
      createdAt: now,
      updatedAt: now,
    });
  }, [acceptedToken, actualKg, draftOwner, id, inspectionNotes, inspectionResult, workspace]);
  const scan = useGatewayMutation({
    path: "/lpg/scans",
    schema: ActionResponseSchema,
    invalidate: [["jobs"], ["orders"], ["scans"]],
  });
  const inspection = useGatewayMutation({
    path: "/lpg/inspections",
    schema: ActionResponseSchema,
    invalidate: [["jobs"], ["inspections"]],
  });
  const action = useGatewayMutation({
    path: "/lpg/orders/actions",
    schema: ActionResponseSchema,
    invalidate: [["jobs"], ["orders"]],
  });
  const accept = useGatewayMutation({
    path: "/lpg/orders/accept-assignment",
    schema: ActionResponseSchema,
    invalidate: [["jobs"], ["orders"]],
  });
  const confirmRefill = useGatewayMutation({
    path: "/lpg/refills/confirm",
    schema: ActionResponseSchema,
    invalidate: [["jobs"], ["orders"]],
  });
  const settleStation = useGatewayMutation({
    path: "/lpg/orders/settle-station",
    schema: ActionResponseSchema,
    invalidate: [["jobs"], ["orders"], ["settlements"], ["wallets"]],
  });
  const executeCommission = useGatewayMutation({
    path: "/lpg/orders/execute-driver-commission",
    schema: ActionResponseSchema,
    invalidate: [["jobs"], ["orders"], ["commissions"], ["wallets"]],
  });
  const root = detail.data;
  const order = nestedRecord(root, "order") ?? root;
  const cylinder = nestedRecord(root, "cylinder");
  const routePoints = [
    locationPoint(
      nestedRecord(order, "pickupLocation") ??
        nestedRecord(order, "pickup_location"),
      "Customer",
    ),
    locationPoint(
      nestedRecord(order, "station") ?? nestedRecord(order, "stationBranch"),
      "Station",
    ),
    locationPoint(
      nestedRecord(order, "deliveryLocation") ??
        nestedRecord(order, "delivery_location"),
      "Delivery",
    ),
    locationPoint(
      nestedRecord(root, "latestDriverLocation") ??
        nestedRecord(root, "driverLocation"),
      "Driver",
    ),
  ].filter((point): point is MapPoint => Boolean(point));
  const routeDistance = firstNumber(root, [
    "routeDistanceMeters",
    "route_distance_meters",
    "distanceMeters",
  ]);
  const routeDuration = firstNumber(root, [
    "routeDurationSeconds",
    "route_duration_seconds",
    "durationSeconds",
  ]);
  const status = displayStatus(order ?? {}) ?? "unknown";
  const requestedKg = firstNumber(order, ["requestedKg", "requested_kg"]);
  const filledKg = firstNumber(order, ["actualKg", "actual_kg"]);
  const navigationTarget =
    status.includes("station") && !status.includes("released")
      ? routePoints.find((point) => point.label === "Station")
      : status.includes("return") ||
          status.includes("delivery") ||
          status === "station_released"
        ? routePoints.find((point) => point.label === "Delivery")
        : routePoints.find((point) => point.label === "Customer");
  const existingInspection = (inspections.data ?? []).find(
    (item) => firstString(item, ["lpg_order_id", "lpgOrderId"]) === id,
  );
  const existingInspectionResult = firstString(existingInspection, ["result"]);
  const safeInspection = existingInspectionResult === "safe";
  const permissions = new Set([
    ...(session.context?.permissions ?? []),
    ...(session.context?.roles.flatMap((role) => role.permissions) ?? []),
  ]);
  const stationCanScan = Boolean(
    session.context?.platformAdmin ||
    permissions.has("lpg.stations.scan") ||
    permissions.has("lpg.stations.pump"),
  );
  const stationCanPump = Boolean(
    session.context?.platformAdmin || permissions.has("lpg.stations.pump"),
  );
  const stationCanSettle = Boolean(
    session.context?.platformAdmin ||
      permissions.has("lpg.orders.finance"),
  );
  const scanType =
    workspace === "driver"
      ? status.includes("delivery") || status.includes("return")
        ? "customer_delivery"
        : "customer_pickup"
      : ["refill_confirmed", "station_settled"].includes(status)
        ? "station_release"
        : "station_receipt";
  const assignmentStatus = firstString(order, [
    "assignmentStatus",
    "assignment_status",
  ]);
  const canScanByState =
    workspace === "driver"
      ? [
          "assigned",
          "pickup_pending",
          "pickup_arrived",
          "pickup_en_route",
          "delivery_verification_pending",
          "return_en_route",
        ].some((value) => status.includes(value))
      : [
          "pickup_verified",
          "station_en_route",
          "station_arrived",
          "station_verified",
          "refill_started",
          "refill_in_progress",
          "refill_confirmed",
          "station_settled",
        ].some((value) => status.includes(value));
  const canScan = canScanByState && (workspace === "driver" || stationCanScan);
  const submit = async () => {
    if (!id || !token) return;
    if (network.isConnected === false) {
      setNotice("Waiting for connection. The code is saved on this device and has not been confirmed by SKIMA yet.");
      return;
    }
    setNotice(null);
    try {
      const scannedToken = token;
      const location = await readOperationalLocation().catch(() => null);
      await scan.mutateAsync({
        ...(location ?? {}),
        idempotencyKey: operationIdempotencyKey(`${workspace}-${scanType}`, id),
        lpgOrderId: id,
        scanType,
        source: "skima.lpg.mobile",
        payload: {
          scannedCylinderId: recordId(cylinder ?? {}),
          scannedToken,
        },
      });
      if (workspace === "station" && scanType === "station_receipt")
        setAcceptedToken(scannedToken);
      setNotice(
        workspace === "station" && scanType === "station_receipt"
          ? "Cylinder accepted by SKIMA. It can now move to filling."
          : workspace === "station"
            ? "Cylinder released to the assigned driver."
            : "Cylinder confirmed by SKIMA.",
      );
      setToken("");
    } catch (cause) {
      setNotice(friendlyError(cause, "We couldn't confirm this cylinder. Scan the SKIMA code again."));
    }
  };
  const submitInspection = async (mediaAssetId?: string) => {
    if (!id) return;
    if (!inspectionResult) {
      setNotice("Choose the cylinder condition before continuing.");
      return;
    }
    try {
      await inspection.mutateAsync({
        lpgOrderId: id,
        result: inspectionResult,
        observations: {
          notes: inspectionNotes.trim() || undefined,
          recordedBy: "station_operator",
        },
        evidenceMediaAssetIds: mediaAssetId ? [mediaAssetId] : [],
        source: "skima.lpg.mobile",
        idempotencyKey: operationIdempotencyKey("station-inspection", id),
      });
      setNotice(
        inspectionResult === "safe"
          ? "Safety check saved. Record the amount filled when the cylinder returns to reception."
          : "Safety check saved. This cylinder is paused for review.",
      );
    } catch (cause) {
      setNotice(friendlyError(cause, "We couldn't save the safety check. Please try again."));
      throw cause;
    }
  };
  const runAction = async (actionKey: string) => {
    if (!id) return;
    setNotice(null);
    try {
      await action.mutateAsync({
        actionKey,
        lpgOrderId: id,
        source: "skima.lpg.mobile",
        idempotencyKey: operationIdempotencyKey(actionKey, id),
      });
      setNotice("Job updated.");
    } catch (cause) {
      setNotice(
        friendlyError(cause, "The job could not be updated. Please try again."),
      );
    }
  };
  const acceptAssignment = async () => {
    if (!id) return;
    try {
      await accept.mutateAsync({
        lpgOrderId: id,
        source: "skima.lpg.mobile",
        idempotencyKey: operationIdempotencyKey("driver-accept", id),
      });
      setNotice("Assignment accepted.");
    } catch (cause) {
      setNotice(
        cause instanceof Error
          ? cause.message
          : "Assignment could not be accepted.",
      );
    }
  };
  const confirmAndRelease = async () => {
    const kg = Number(actualKg);
    const alreadyFilled = status === "refill_confirmed" || status === "station_settled";
    if (!id || (!alreadyFilled && (!Number.isFinite(kg) || kg <= 0))) {
      setNotice("Enter the quantity actually filled, in kilograms.");
      return;
    }
    if (!acceptedToken && !token) {
      setNotice("Scan the SKIMA cylinder code again before releasing it to the driver.");
      return;
    }
    if (network.isConnected === false) {
      setNotice("Waiting for connection. Your entered quantity is saved, but the refill is not confirmed yet.");
      return;
    }
    const releaseToken = acceptedToken || token;
    try {
      if (status === "station_verified")
        await action.mutateAsync({
          actionKey: "lpg.refill.start",
          lpgOrderId: id,
          source: "skima.lpg.mobile",
          idempotencyKey: operationIdempotencyKey("lpg.refill.start", id),
        });
      if (!alreadyFilled) {
        await confirmRefill.mutateAsync({
          lpgOrderId: id,
          actualKg: kg,
          safetyObservations: { notes: inspectionNotes.trim() || undefined },
          source: "skima.lpg.mobile",
          idempotencyKey: operationIdempotencyKey("station-refill-confirm", id),
        });
      }
      if (stationCanSettle && status !== "station_settled")
        await settleStation.mutateAsync({
          lpgOrderId: id,
          source: "skima.lpg.mobile",
          idempotencyKey: operationIdempotencyKey("station-settlement", id),
        });
      const location = await readOperationalLocation().catch(() => null);
      await scan.mutateAsync({
        ...(location ?? {}),
        idempotencyKey: operationIdempotencyKey("station-station_release", id),
        lpgOrderId: id,
        scanType: "station_release",
        source: "skima.lpg.mobile",
        payload: {
          scannedCylinderId: recordId(cylinder ?? {}),
          scannedToken: releaseToken,
        },
      });
      await draftStore.clear(draftOwner, `station-refill-${id}`);
      setAcceptedToken("");
      setToken("");
      setNotice("Confirmed by SKIMA and released to the assigned driver.");
    } catch (cause) {
      setNotice(
        friendlyError(cause, "We couldn't confirm and release this refill. Your entered quantity is still saved."),
      );
    }
  };
  const postCommission = async () => {
    if (!id) return;
    try {
      await executeCommission.mutateAsync({
        lpgOrderId: id,
        source: "skima.lpg.mobile",
        idempotencyKey: operationIdempotencyKey("driver-commission", id),
      });
      setNotice("Driver earnings recorded.");
    } catch (cause) {
      setNotice(
        cause instanceof Error
          ? cause.message
          : "Driver earnings could not be posted.",
      );
    }
  };
  const driverAction =
    assignmentStatus === "offered"
      ? null
      : status.includes("driver_accepted") || status.includes("assigned")
        ? "lpg.pickup.start"
        : status.includes("pickup_verified")
          ? "lpg.station.start"
          : status.includes("refill_confirmed") ||
              status.includes("station_released")
            ? "lpg.return.start"
            : status.includes("return_en_route")
              ? "lpg.delivery.pending"
              : null;
  const releaseReady = status === "refill_confirmed" || status === "station_settled";
  const refillActive =
    status === "station_verified" ||
    status.includes("refill_started") ||
    status.includes("refill_in_progress") ||
    releaseReady;
  const successNotice = Boolean(
    notice && /confirmed|accepted|saved|updated|released|earnings/i.test(notice),
  );
  return (
    <Screen
      eyebrow={workspace === "station" ? "Station reception" : "Current delivery"}
      title={order ? displayTitle(order) : "Job details"}
      action={
        <Pressable onPress={() => router.back()}>
          <Text style={styles.back}>Back</Text>
        </Pressable>
      }
    >
      {detail.isPending ||
      (workspace === "station" && inspections.isPending) ? (
        <ActivityIndicator color={colors.brand} />
      ) : detail.error || (workspace === "station" && inspections.error) ? (
        <Text style={styles.error}>
          {friendlyError(
            detail.error ?? inspections.error,
            "This job could not be loaded. Please try again.",
          )}
        </Text>
      ) : (
        <>
          {workspace === "driver" && routePoints.length ? (
            <OperationalMap points={routePoints} height={380} />
          ) : null}
          {workspace === "station" ? (
            <View style={styles.stationSteps}>
              <StationStep number="1" label="Scan & accept" active={["pickup_verified", "station_en_route", "station_arrived"].some((value) => status.includes(value))} complete={!['pickup_verified', 'station_en_route', 'station_arrived'].some((value) => status.includes(value))} />
              <View style={[styles.stepLine, { backgroundColor: palette.border }]} />
              <StationStep number="2" label="Confirm & release" active={refillActive} complete={status.includes("return") || status.includes("delivered")} />
            </View>
          ) : null}
          <View style={[styles.summary, { borderColor: palette.border }]}>
            <Field
              label="Now"
              value={friendlyJobStatus(status)}
            />
            <Field
              label="Cylinder"
              value={cylinder ? displayTitle(cylinder) : "Not available"}
            />
            <Field
              label="Reference"
              value={
                firstString(order, ["public_reference", "reference", "id"]) ??
                "Not available"
              }
            />
            {requestedKg !== null ? <Field label="Requested" value={`${requestedKg} kg`} /> : null}
            {filledKg !== null ? <Field label="Filled" value={`${filledKg} kg`} /> : null}
          </View>
          {routeDistance !== null || routeDuration !== null ? (
            <View style={[styles.routeFacts, { borderColor: palette.border }]}>
              <Field
                label="Distance"
                value={
                  routeDistance !== null
                    ? `${(routeDistance / 1000).toFixed(1)} km`
                    : "Unavailable"
                }
              />
              <Field
                label="Estimated time"
                value={
                  routeDuration !== null
                    ? `${Math.ceil(routeDuration / 60)} min`
                    : "Unavailable"
                }
              />
            </View>
          ) : null}
          {workspace === "driver" && navigationTarget ? (
            <ActionButton
              pending={false}
              label={`Navigate to ${navigationTarget.label.toLowerCase()}`}
              onPress={() =>
                void openDeviceNavigation(navigationTarget).catch((cause) =>
                  setNotice(
                    cause instanceof Error
                      ? cause.message
                      : "Navigation could not be opened.",
                  ),
                )
              }
            />
          ) : null}
          {workspace === "driver" && assignmentStatus === "offered" ? (
            <ActionButton
              pending={accept.isPending}
              label="Accept assignment"
              onPress={() => void acceptAssignment()}
            />
          ) : null}
          {workspace === "driver" && driverAction ? (
            <ActionButton
              pending={action.isPending}
              label={driverActionLabel(driverAction)}
              onPress={() => void runAction(driverAction)}
            />
          ) : null}
          {workspace === "driver" && status === "delivered" ? (
            <ActionButton
              pending={executeCommission.isPending}
              label="Complete delivery earnings"
              onPress={() => void postCommission()}
            />
          ) : null}
          {workspace === "station" &&
          stationCanPump &&
          refillActive &&
          (safeInspection || releaseReady) ? (
            <View style={[styles.refillForm, { backgroundColor: palette.surface }]}>
              <View style={styles.formHeading}>
                <Text style={[styles.formTitle, { color: palette.ink }]}>{releaseReady ? "Ready for driver" : "Record the actual fill"}</Text>
                <Text style={[styles.formBody, { color: palette.muted }]}>{releaseReady ? "Confirm the SKIMA code and hand this cylinder back to the assigned driver." : `Requested ${requestedKg ?? "—"} kg. Enter what was actually filled.`}</Text>
              </View>
              {!releaseReady ? <TextInput
                accessibilityLabel="Actual quantity filled in kilograms"
                value={actualKg}
                onChangeText={setActualKg}
                keyboardType="decimal-pad"
                placeholder="Actual quantity (kg)"
                placeholderTextColor={palette.muted}
                style={[styles.input, { backgroundColor: palette.input, borderColor: palette.border, color: palette.ink }]}
              /> : null}
              {!acceptedToken && !token ? <Text style={[styles.formBody, { color: palette.muted }]}>Scan the cylinder once more before release.</Text> : null}
              <ActionButton
                pending={confirmRefill.isPending || action.isPending || settleStation.isPending || scan.isPending}
                label={releaseReady ? "Release to driver" : "Confirm & release"}
                onPress={() => void confirmAndRelease()}
              />
            </View>
          ) : null}
          {canScan && !(workspace === "station" && acceptedToken && !releaseReady) ? (
            <View style={styles.scanSection}>
              <Text style={[styles.formTitle, { color: palette.ink }]}>{workspace === "station" && releaseReady ? "Scan before release" : workspace === "station" ? "Scan & accept" : "Confirm the cylinder"}</Text>
              <Scanner enabled onDetected={setToken} />
            </View>
          ) : null}
          {token && (workspace === "driver" || ["pickup_verified", "station_en_route", "station_arrived"].some((value) => status.includes(value))) ? (
            <Pressable
              disabled={scan.isPending}
              onPress={() => void submit()}
              style={styles.submit}
            >
              {scan.isPending ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={styles.submitText}>{workspace === "station" && scanType === "station_receipt" ? "Accept this cylinder" : "Confirm cylinder"}</Text>
              )}
            </Pressable>
          ) : null}
          {workspace === "station" &&
          stationCanScan &&
          status === "station_verified" &&
          !existingInspection ? (
            <View style={styles.inspectionForm}>
              <Text style={[styles.formTitle, { color: palette.ink }]}>Quick safety check</Text>
              <Text style={[styles.formBody, { color: palette.muted }]}>
                Choose the condition observed at reception. Anything unsafe pauses the refill automatically.
              </Text>
              <View style={styles.resultOptions}>
                {["safe", "unsafe", "manual_review", "rejected"].map(
                  (result) => (
                    <Pressable
                      key={result}
                      onPress={() => setInspectionResult(result)}
                      style={[
                        styles.resultOption,
                        inspectionResult === result && styles.resultSelected,
                      ]}
                    >
                      <Text
                        style={[
                          styles.resultText,
                          inspectionResult === result &&
                            styles.resultTextSelected,
                        ]}
                      >
                        {inspectionLabel(result)}
                      </Text>
                    </Pressable>
                  ),
                )}
              </View>
              <TextInput
                value={inspectionNotes}
                onChangeText={setInspectionNotes}
                placeholder="Add a note if needed"
                placeholderTextColor={palette.muted}
                multiline
                style={[styles.input, styles.notes, { backgroundColor: palette.input, borderColor: palette.border, color: palette.ink }]}
              />
              {inspectionResult ? (
                <EvidenceCapture
                  assetTypeKey="media.lpg.inspection_evidence"
                  label="Add a safety photo (optional)"
                  draftType={`station-inspection-${id ?? "unknown"}`}
                  onUploaded={(assetId) => submitInspection(assetId)}
                />
              ) : (
                <Text style={styles.formBody}>
                  Choose the cylinder condition to continue.
                </Text>
              )}
              {inspectionResult ? <ActionButton pending={inspection.isPending} label="Save safety check" onPress={() => void submitInspection()} /> : null}
            </View>
          ) : null}
          {workspace === "station" && !stationCanScan ? (
            <Card>
              <Text style={styles.formTitle}>
                Action unavailable
              </Text>
              <Text style={styles.formBody}>
                Ask your station manager to enable reception access for your account.
              </Text>
            </Card>
          ) : null}
          {workspace === "station" && existingInspection ? (
            <Card>
              <Field
                label="Safety check"
                value={inspectionLabel(existingInspectionResult ?? "recorded")}
              />
              {existingInspectionResult !== "safe" ? (
                <Text style={styles.error}>
                  This cylinder is paused. A station supervisor must review it before filling.
                </Text>
              ) : null}
            </Card>
          ) : null}
          {notice ? (
            <Text
              accessibilityRole="alert"
              style={successNotice ? styles.success : styles.error}
            >
              {notice}
            </Text>
          ) : null}
        </>
      )}
    </Screen>
  );
}
function locationPoint(
  record: ReturnType<typeof nestedRecord>,
  label: string,
): MapPoint | null {
  const latitude = firstNumber(record, ["latitude", "lat"]);
  const longitude = firstNumber(record, ["longitude", "lng", "lon"]);
  return latitude !== null && longitude !== null
    ? { latitude, longitude, label }
    : null;
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
function StationStep({ number, label, active, complete }: { number: string; label: string; active: boolean; complete: boolean }) {
  const { palette } = useAppTheme();
  return (
    <View style={styles.stationStep}>
      <View style={[styles.stepNumber, { backgroundColor: complete ? colors.success : active ? colors.brand : palette.soft }]}>
        <Text style={[styles.stepNumberText, { color: complete || active ? "white" : palette.muted }]}>{complete ? "✓" : number}</Text>
      </View>
      <Text style={[styles.stepLabel, { color: active ? palette.ink : palette.muted }]}>{label}</Text>
    </View>
  );
}
function friendlyJobStatus(value: string) {
  const normalized = value.toLowerCase().replace(/[\s-]+/g, "_");
  const labels: Record<string, string> = {
    assigned: "Driver assigned",
    driver_offered: "Waiting for driver",
    driver_accepted: "Driver accepted",
    pickup_en_route: "Heading to pickup",
    pickup_verified: "Cylinder collected",
    station_en_route: "Heading to station",
    station_arrived: "At the station",
    station_verified: "Accepted at reception",
    refill_started: "Filling in progress",
    refill_in_progress: "Filling in progress",
    refill_confirmed: "Fill confirmed",
    station_settled: "Ready for driver",
    station_released: "Returning to customer",
    return_en_route: "Returning to customer",
    delivery_verification_pending: "Ready for handover",
    delivered: "Delivered",
    completed: "Completed",
    cancelled: "Cancelled",
  };
  return labels[normalized] ?? "In progress";
}
function driverActionLabel(actionKey: string) {
  const labels: Record<string, string> = {
    "lpg.pickup.start": "Start pickup route",
    "lpg.station.start": "Navigate to refill station",
    "lpg.return.start": "Start return delivery",
    "lpg.delivery.pending": "Arrived for handover",
  };
  return labels[actionKey] ?? "Continue delivery";
}
function inspectionLabel(value: string) {
  const labels: Record<string, string> = {
    safe: "Safe to fill",
    unsafe: "Unsafe",
    manual_review: "Needs supervisor",
    rejected: "Reject cylinder",
    recorded: "Saved",
  };
  return labels[value] ?? "Saved";
}
function ActionButton({
  label,
  pending,
  onPress,
}: {
  label: string;
  pending: boolean;
  onPress(): void;
}) {
  return (
    <Pressable disabled={pending} onPress={onPress} style={styles.submit}>
      {pending ? (
        <ActivityIndicator color="white" />
      ) : (
        <Text style={styles.submitText}>{label}</Text>
      )}
    </Pressable>
  );
}
const styles = StyleSheet.create({
  back: { color: colors.brand, fontWeight: "800" },
  field: { gap: 4 },
  label: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  value: {
    fontSize: 17,
    fontWeight: "700",
    textTransform: "capitalize",
  },
  submit: {
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
  },
  submitText: { color: "white", fontWeight: "800" },
  error: { color: colors.danger, padding: spacing.md },
  success: {
    color: colors.success,
    backgroundColor: "#DDF3E5",
    padding: spacing.md,
    borderRadius: radii.md,
    fontWeight: "700",
  },
  refillForm: { gap: spacing.md, padding: spacing.md, borderRadius: radii.lg },
  inspectionForm: { gap: spacing.md, paddingVertical: spacing.sm },
  formHeading: { gap: 4 },
  formTitle: { fontSize: 19, fontWeight: "900" },
  formBody: { lineHeight: 21 },
  resultOptions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  resultOption: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
  },
  resultSelected: { borderColor: colors.brand, backgroundColor: "#FFF0F1" },
  resultText: {
    color: colors.muted,
    fontWeight: "800",
    textTransform: "capitalize",
  },
  resultTextSelected: { color: colors.brandDark },
  input: {
    minHeight: 54,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    color: colors.ink,
  },
  notes: { minHeight: 90, paddingTop: spacing.md, textAlignVertical: "top" },
  summary: { flexDirection: "row", flexWrap: "wrap", gap: spacing.lg, paddingVertical: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  routeFacts: { flexDirection: "row", gap: spacing.xl, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  stationSteps: { minHeight: 70, flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.sm },
  stationStep: { alignItems: "center", gap: 6 },
  stepNumber: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 17 },
  stepNumberText: { fontWeight: "900" },
  stepLabel: { fontSize: 11, fontWeight: "800" },
  stepLine: { flex: 1, height: 2, marginHorizontal: spacing.sm, marginBottom: 20 },
  scanSection: { gap: spacing.sm },
});
