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
import { colors, radii, spacing } from "../theme/tokens";
import { idempotencyKey } from "../utilities/idempotency";
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
  const draftOwner =
    session.context?.profile?.id ?? session.context?.user.id ?? "";
  const detail = useJobDetails(id);
  const inspections = domainQueries.inspections();
  const [token, setToken] = useState("");
  useEffect(() => {
    if (params.scannedToken) setToken(params.scannedToken);
  }, [params.scannedToken]);
  const [notice, setNotice] = useState<string | null>(null);
  const [actualKg, setActualKg] = useState("");
  const [inspectionResult, setInspectionResult] = useState("");
  const [inspectionNotes, setInspectionNotes] = useState("");
  useEffect(() => {
    if (!draftOwner || !id || workspace !== "station") return;
    void draftStore.load(draftOwner, `station-refill-${id}`).then((draft) => {
      setActualKg(String(draft?.values.actualKg ?? ""));
      setInspectionResult(String(draft?.values.inspectionResult ?? ""));
      setInspectionNotes(String(draft?.values.inspectionNotes ?? ""));
    });
  }, [draftOwner, id, workspace]);
  useEffect(() => {
    if (
      !draftOwner ||
      !id ||
      workspace !== "station" ||
      (!actualKg && !inspectionResult && !inspectionNotes)
    )
      return;
    const now = new Date().toISOString();
    void draftStore.save({
      version: 1,
      type: `station-refill-${id}`,
      ownerProfileId: draftOwner,
      step: actualKg ? "actual-kilograms" : "inspection",
      values: { actualKg, inspectionResult, inspectionNotes },
      pendingMedia: [],
      createdAt: now,
      updatedAt: now,
    });
  }, [actualKg, draftOwner, id, inspectionNotes, inspectionResult, workspace]);
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
          "refill_confirmed",
          "station_settled",
        ].some((value) => status.includes(value));
  const canScan = canScanByState && (workspace === "driver" || stationCanScan);
  const submit = async () => {
    if (!id || !token) return;
    setNotice(null);
    try {
      const location = await readOperationalLocation();
      await scan.mutateAsync({
        ...location,
        idempotencyKey: idempotencyKey(`${workspace}-${scanType}`, id),
        lpgOrderId: id,
        scanType,
        source: "skima.lpg.mobile",
        payload: {
          scannedCylinderId: recordId(cylinder ?? {}),
          scannedToken: token,
        },
      });
      setNotice("Backend verification recorded successfully.");
      setToken("");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Verification failed.",
      );
    }
  };
  const submitEvidence = async (mediaAssetId: string) => {
    if (!id) return;
    if (!inspectionResult) {
      setNotice(
        "Select the observed inspection result before submitting evidence.",
      );
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
        evidenceMediaAssetIds: [mediaAssetId],
        source: "skima.lpg.mobile",
        idempotencyKey: idempotencyKey("station-inspection", id),
      });
      setNotice("Inspection evidence saved.");
    } catch (cause) {
      setNotice(
        cause instanceof Error
          ? cause.message
          : "Inspection evidence could not be recorded.",
      );
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
        idempotencyKey: idempotencyKey(actionKey, id),
      });
      setNotice("Job updated successfully.");
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
        idempotencyKey: idempotencyKey("driver-accept", id),
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
  const refill = async () => {
    const kg = Number(actualKg);
    if (!id || !Number.isFinite(kg) || kg <= 0) {
      setNotice("Enter the actual refill kilograms.");
      return;
    }
    try {
      await confirmRefill.mutateAsync({
        lpgOrderId: id,
        actualKg: kg,
        safetyObservations: { notes: inspectionNotes.trim() || undefined },
        source: "skima.lpg.mobile",
        idempotencyKey: idempotencyKey("station-refill-confirm", id),
      });
      await draftStore.clear(draftOwner, `station-refill-${id}`);
      setNotice("Refill confirmed successfully.");
    } catch (cause) {
      setNotice(
        friendlyError(cause, "The refill could not be confirmed. Please try again."),
      );
    }
  };
  const settle = async () => {
    if (!id) return;
    try {
      await settleStation.mutateAsync({
        lpgOrderId: id,
        source: "skima.lpg.mobile",
        idempotencyKey: idempotencyKey("station-settlement", id),
      });
      setNotice("Station settlement recorded.");
    } catch (cause) {
      setNotice(
        cause instanceof Error
          ? cause.message
          : "Station settlement could not be posted.",
      );
    }
  };
  const postCommission = async () => {
    if (!id) return;
    try {
      await executeCommission.mutateAsync({
        lpgOrderId: id,
        source: "skima.lpg.mobile",
        idempotencyKey: idempotencyKey("driver-commission", id),
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
  return (
    <Screen
      eyebrow={`${workspace} job`}
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
          {routePoints.length ? <OperationalMap points={routePoints} /> : null}
          <Card>
            <Field
              label="Job status"
              value={status.replace(/[_-]/g, " ")}
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
          </Card>
          {routeDistance !== null || routeDuration !== null ? (
            <Card>
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
            </Card>
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
              label="Continue workflow"
              onPress={() => void runAction(driverAction)}
            />
          ) : null}
          {workspace === "driver" && status === "delivered" ? (
            <ActionButton
              pending={executeCommission.isPending}
              label="Post verified delivery earnings"
              onPress={() => void postCommission()}
            />
          ) : null}
          {workspace === "station" &&
          stationCanPump &&
          status === "station_verified" &&
          safeInspection ? (
            <ActionButton
              pending={action.isPending}
              label="Start refill"
              onPress={() => void runAction("lpg.refill.start")}
            />
          ) : null}
          {workspace === "station" &&
          stationCanSettle &&
          status === "refill_confirmed" ? (
            <ActionButton
              pending={settleStation.isPending}
              label="Post station settlement"
              onPress={() => void settle()}
            />
          ) : null}
          {workspace === "station" &&
          stationCanPump &&
          (status.includes("refill_started") ||
            status.includes("refill_in_progress")) ? (
            <View style={styles.refillForm}>
              <TextInput
                value={actualKg}
                onChangeText={setActualKg}
                keyboardType="decimal-pad"
                placeholder="Actual kilograms refilled"
                placeholderTextColor={colors.muted}
                style={styles.input}
              />
              <ActionButton
                pending={confirmRefill.isPending}
                label="Confirm refill"
                onPress={() => void refill()}
              />
            </View>
          ) : null}
          <Scanner enabled={canScan} onDetected={setToken} />
          {token ? (
            <Pressable
              disabled={scan.isPending}
              onPress={() => void submit()}
              style={styles.submit}
            >
              {scan.isPending ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={styles.submitText}>Check cylinder code</Text>
              )}
            </Pressable>
          ) : null}
          {workspace === "station" &&
          stationCanScan &&
          status === "station_verified" &&
          !existingInspection ? (
            <View style={styles.inspectionForm}>
              <Text style={styles.formTitle}>Operator inspection result</Text>
              <Text style={styles.formBody}>
                Record what you actually observed. Unsafe or rejected results
                will pause this refill for the appropriate safety review.
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
                        {result.replace(/_/g, " ")}
                      </Text>
                    </Pressable>
                  ),
                )}
              </View>
              <TextInput
                value={inspectionNotes}
                onChangeText={setInspectionNotes}
                placeholder="Inspection observations (optional)"
                placeholderTextColor={colors.muted}
                multiline
                style={[styles.input, styles.notes]}
              />
              {inspectionResult ? (
                <EvidenceCapture
                  assetTypeKey="media.lpg.inspection_evidence"
                  label="Inspection evidence"
                  draftType={`station-inspection-${id ?? "unknown"}`}
                  onUploaded={submitEvidence}
                />
              ) : (
                <Text style={styles.formBody}>
                  Choose the observed result to continue to evidence capture.
                </Text>
              )}
            </View>
          ) : null}
          {workspace === "station" && !stationCanScan ? (
            <Card>
              <Text style={styles.formTitle}>
                Action unavailable
              </Text>
              <Text style={styles.formBody}>
                Your station access lets you view this job, but it does not
                include cylinder scanning or refill actions.
              </Text>
            </Card>
          ) : null}
          {workspace === "station" && existingInspection ? (
            <Card>
              <Field
                label="Recorded inspection"
                value={(existingInspectionResult ?? "recorded").replace(
                  /_/g,
                  " ",
                )}
              />
              {existingInspectionResult !== "safe" ? (
                <Text style={styles.error}>
                  This inspection cannot proceed to refill until the safety
                  issue has been reviewed.
                </Text>
              ) : null}
            </Card>
          ) : null}
          {notice ? (
            <Text
              accessibilityRole="alert"
              style={
                notice.includes("successfully") ||
                notice.includes("recorded") ||
                notice.includes("accepted") ||
                notice.includes("updated") ||
                notice.includes("confirmed")
                  ? styles.success
                  : styles.error
              }
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
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
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
    color: colors.ink,
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
  refillForm: { gap: spacing.md },
  inspectionForm: { gap: spacing.md },
  formTitle: { color: colors.ink, fontSize: 19, fontWeight: "900" },
  formBody: { color: colors.muted, lineHeight: 21 },
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
});
