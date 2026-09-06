import { useNetInfo } from "@react-native-community/netinfo";
import { router, useLocalSearchParams } from "expo-router";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Gauge,
  MapPin,
  Navigation,
  PackageCheck,
  ScanLine,
  ShieldCheck,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
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
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { operationIdempotencyKey } from "../utilities/idempotency";
import { AiContextAction } from "./AiContextAction";
import { AppButton } from "./AppButton";
import { EmptyState } from "./EmptyState";
import { EvidenceCapture } from "./EvidenceCapture";
import { Screen } from "./Screen";
import { ScreenSkeleton } from "./ScreenSkeleton";
import { StatusPill } from "./StatusPill";

export function JobDetailScreen({ workspace }: { workspace: "driver" | "station" }) {
  const params = useLocalSearchParams<{ id?: string; scannedToken?: string }>();
  const id = params.id ?? null;
  const session = useSession();
  const network = useNetInfo();
  const { palette } = useAppTheme();
  const draftOwner = session.context?.profile?.id ?? session.context?.user.id ?? session.session?.user.id ?? "";
  const detail = useJobDetails(id);
  const inspections = domainQueries.inspections();
  const [token, setToken] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeSuccess, setNoticeSuccess] = useState(false);
  const [actualKg, setActualKg] = useState("");
  const [inspectionResult, setInspectionResult] = useState("");
  const [inspectionNotes, setInspectionNotes] = useState("");

  useEffect(() => {
    if (params.scannedToken) setToken(params.scannedToken);
  }, [params.scannedToken]);

  useEffect(() => {
    if (!draftOwner || !id || workspace !== "station") return;
    void draftStore.load(draftOwner, `station-refill-${id}`).then((draft) => {
      setActualKg(String(draft?.values.actualKg ?? ""));
      setInspectionResult(String(draft?.values.inspectionResult ?? ""));
      setInspectionNotes(String(draft?.values.inspectionNotes ?? ""));
    });
  }, [draftOwner, id, workspace]);

  useEffect(() => {
    if (!draftOwner || !id || workspace !== "station" || (!actualKg && !inspectionResult && !inspectionNotes)) return;
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
    invalidate: [["jobs"], ["orders"], ["scans"], ["station-runtime"]],
  });
  const inspection = useGatewayMutation({
    path: "/lpg/inspections",
    schema: ActionResponseSchema,
    invalidate: [["jobs"], ["inspections"], ["station-runtime"]],
  });
  const action = useGatewayMutation({
    path: "/lpg/orders/actions",
    schema: ActionResponseSchema,
    invalidate: [["jobs"], ["orders"], ["station-runtime"]],
  });
  const confirmRefill = useGatewayMutation({
    path: "/lpg/refills/confirm",
    schema: ActionResponseSchema,
    invalidate: [["jobs"], ["orders"], ["station-runtime"], ["settlements"], ["wallets"]],
  });

  const root = detail.data;
  const order = nestedRecord(root, "order") ?? root;
  const cylinder = nestedRecord(root, "cylinder") ?? nestedRecord(order, "cylinder");
  const driver = nestedRecord(root, "driver") ?? nestedRecord(order, "driver");
  const station = nestedRecord(root, "station") ?? nestedRecord(order, "station") ?? nestedRecord(order, "stationBranch");
  const pickup = nestedRecord(root, "pickupLocation") ?? nestedRecord(root, "pickup_location") ?? nestedRecord(order, "pickupLocation") ?? nestedRecord(order, "pickup_location");
  const delivery = nestedRecord(root, "deliveryLocation") ?? nestedRecord(root, "delivery_location") ?? nestedRecord(order, "deliveryLocation") ?? nestedRecord(order, "delivery_location");
  const customer = nestedRecord(root, "customer") ?? nestedRecord(order, "customer");
  const latestDriver = nestedRecord(root, "latestDriverLocation") ?? nestedRecord(root, "driverLocation");

  const routePoints = [
    locationPoint(pickup, "Customer"),
    locationPoint(station, "Station"),
    locationPoint(delivery, "Delivery"),
    locationPoint(latestDriver, "Driver"),
  ].filter((point): point is MapPoint => Boolean(point));

  const routeDistance = firstNumber(root, ["routeDistanceMeters", "route_distance_meters", "distanceMeters"]);
  const routeDuration = firstNumber(root, ["routeDurationSeconds", "route_duration_seconds", "durationSeconds"]);
  const status = displayStatus(order ?? {}) ?? "unknown";
  const requestedKg = firstNumber(order, ["requestedKg", "requested_kg"]);
  const filledKg = firstNumber(order, ["actualKg", "actual_kg"]);
  const existingInspection = (inspections.data ?? []).find(
    (item) => firstString(item, ["lpg_order_id", "lpgOrderId"]) === id,
  );
  const existingInspectionResult = firstString(existingInspection, ["result"]);
  const safeInspection = existingInspectionResult === "safe";

  const permissions = new Set([
    ...(session.context?.permissions ?? []),
    ...(session.context?.roles.flatMap((role) => role.permissions) ?? []),
  ]);
  const stationCanInspect = Boolean(
    session.context?.platformAdmin || permissions.has("lpg.stations.scan") || permissions.has("lpg.stations.pump"),
  );
  const stationCanPump = Boolean(session.context?.platformAdmin || permissions.has("lpg.stations.pump"));

  const driverScanType = driverScanTypeForStatus(status);
  const stationScanType = stationScanTypeForStatus(status);
  const canDriverScan = workspace === "driver" && Boolean(driverScanType);
  const canStationScan = workspace === "station" && stationCanInspect && Boolean(stationScanType);
  const driverAction = workspace === "driver" ? driverActionForStatus(status) : null;
  const navigationTarget = workspace === "driver" ? navigationPointForStatus(status, routePoints) : null;
  const stationWaitingForDriverScan = workspace === "station" && ["pickup_verified", "station_en_route"].includes(status);
  const refillActive = ["station_verified", "refill_in_progress", "refill_started"].includes(status);
  const releaseReady = ["refill_confirmed", "station_settled"].includes(status);
  const aiJobReference = firstString(order, ["public_reference", "reference", "id"]) ?? id ?? "this LPG job";

  const submitDriverScan = async () => {
    if (!id || !token || !driverScanType) return;
    if (network.isConnected === false) {
      setNoticeSuccess(false);
      setNotice("Waiting for connection. The scanned code is still on this device and has not been confirmed by SKIMA.");
      return;
    }
    setNotice(null);
    try {
      const location = await readOperationalLocation().catch(() => null);
      await scan.mutateAsync({
        ...(location ?? {}),
        idempotencyKey: operationIdempotencyKey(`driver-${driverScanType}`, id),
        lpgOrderId: id,
        scanType: driverScanType,
        source: "skima.lpg.mobile",
        payload: {
          scannedCylinderId: recordId(cylinder ?? {}),
          scannedToken: token,
        },
      });
      setToken("");
      setNoticeSuccess(true);
      setNotice(driverScanSuccess(driverScanType));
    } catch (cause) {
      setNoticeSuccess(false);
      setNotice(friendlyError(cause, "SKIMA could not verify this cylinder. Scan the code again."));
    }
  };

  const submitStationScan = async () => {
    if (!id || !token || !stationScanType) return;
    setNotice(null);
    try {
      await scan.mutateAsync({
        idempotencyKey: operationIdempotencyKey(`station-${stationScanType}`, id),
        lpgOrderId: id,
        scanType: stationScanType,
        source: "skima.lpg.mobile",
        payload: { scannedCylinderId: recordId(cylinder ?? {}), scannedToken: token },
      });
      setToken("");
      setNoticeSuccess(true);
      setNotice("Cylinder release verified. The filled cylinder is ready for the assigned driver.");
    } catch (cause) {
      setNoticeSuccess(false);
      setNotice(friendlyError(cause, "SKIMA could not verify this cylinder release. Scan the code again."));
    }
  };

  const submitInspection = async (mediaAssetId?: string) => {
    if (!id) return;
    if (!inspectionResult) {
      setNoticeSuccess(false);
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
      setNoticeSuccess(inspectionResult === "safe");
      setNotice(
        inspectionResult === "safe"
          ? "Safety check saved. The refill can continue."
          : "Safety check saved. This cylinder is paused for review and must not be filled.",
      );
    } catch (cause) {
      setNoticeSuccess(false);
      setNotice(friendlyError(cause, "The safety check could not be saved."));
      throw cause;
    }
  };

  const runDriverAction = async (actionKey: string) => {
    if (!id) return;
    setNotice(null);
    try {
      await action.mutateAsync({
        actionKey,
        lpgOrderId: id,
        source: "skima.lpg.mobile",
        idempotencyKey: operationIdempotencyKey(actionKey, id),
      });
      setNoticeSuccess(true);
      setNotice(driverActionSuccess(actionKey));
    } catch (cause) {
      setNoticeSuccess(false);
      setNotice(friendlyError(cause, "The job could not be updated. Please try again."));
    }
  };

  const confirmStationRefill = async () => {
    const kg = Number(actualKg);
    if (!id || !Number.isFinite(kg) || kg <= 0) {
      setNoticeSuccess(false);
      setNotice("Enter the quantity actually filled, in kilograms.");
      return;
    }
    if (!safeInspection) {
      setNoticeSuccess(false);
      setNotice("A saved 'Safe to fill' inspection is required before refill confirmation.");
      return;
    }
    if (network.isConnected === false) {
      setNoticeSuccess(false);
      setNotice("Waiting for connection. The entered quantity is saved locally, but the refill has not been confirmed.");
      return;
    }

    try {
      if (status === "station_verified") {
        await action.mutateAsync({
          actionKey: "lpg.refill.start",
          lpgOrderId: id,
          source: "skima.lpg.mobile",
          idempotencyKey: operationIdempotencyKey("lpg.refill.start", id),
        });
      }
      await confirmRefill.mutateAsync({
        lpgOrderId: id,
        actualKg: kg,
        safetyObservations: {
          result: "safe",
          notes: inspectionNotes.trim() || undefined,
        },
        source: "skima.lpg.mobile",
        idempotencyKey: operationIdempotencyKey("station-refill-confirm", id),
      });
      await draftStore.clear(draftOwner, `station-refill-${id}`);
      setNoticeSuccess(true);
      setNotice("Refill confirmed. The cylinder is ready for the assigned driver, and station earnings will update automatically.");
    } catch (cause) {
      setNoticeSuccess(false);
      setNotice(friendlyError(cause, "The refill could not be confirmed. Your entered quantity remains saved on this device."));
    }
  };

  return (
    <Screen
      eyebrow={workspace === "station" ? "Station order" : "Delivery job"}
      title={order ? displayTitle(order) : "Job details"}
      subtitle={workspace === "station" ? "Verify the matched arrival, complete safety checks and record the actual refill." : "Follow the assigned route, scan the SKIMA cylinder at required hand-offs and complete delivery."}
      action={<AppButton label="Back" variant="ghost" size="sm" onPress={() => router.back()} />}
    >
      {detail.isPending || (workspace === "station" && inspections.isPending) ? (
        <ScreenSkeleton cards={4} />
      ) : detail.error || (workspace === "station" && inspections.error) || !order ? (
        <EmptyState
          icon={<PackageCheck color={palette.brand} size={27} />}
          title="Job could not be loaded"
          description={friendlyError(detail.error ?? inspections.error, "This job is unavailable or could not be refreshed.")}
          action={<AppButton label="Retry" onPress={() => void Promise.all([detail.refetch(), workspace === "station" ? inspections.refetch() : Promise.resolve()])} />}
        />
      ) : (
        <>
          <View style={[styles.hero, shadows.raised, { backgroundColor: palette.brand }]}>
            <View style={styles.heroCopy}>
              <Text style={styles.heroEyebrow}>CURRENT STAGE</Text>
              <Text style={styles.heroTitle}>{friendlyJobStatus(status)}</Text>
              <Text style={styles.heroBody}>{workspace === "driver" ? driverStageDescription(status) : stationStageDescription(status)}</Text>
            </View>
            <StatusPill label={friendlyJobStatus(status)} tone={statusTone(status)} />
          </View>

          <AiContextAction
            workspace={workspace}
            label={workspace === "driver" ? "What should I do next?" : "Explain this station job"}
            prompt={
              workspace === "driver"
                ? `Explain my assigned SKIMA driver job ${aiJobReference}. The current workflow stage is ${friendlyJobStatus(status)}. Tell me the next normal action I should take and any required scan or hand-off. Do not accept, cancel, scan, complete or change the job.`
                : `Explain this SKIMA station refill job ${aiJobReference}. The current workflow stage is ${friendlyJobStatus(status)}. Tell me what the station should check or do next. Do not record an inspection, refill, scan, settlement or other action.`
            }
          />

          {workspace === "driver" && routePoints.length ? (
            <View style={[styles.mapShell, shadows.soft]}>
              <OperationalMap points={routePoints} height={390} />
            </View>
          ) : null}

          {workspace === "station" ? <StationProgress status={status} /> : null}

          <View style={[styles.summaryCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <SummaryField label="Cylinder" value={cylinder ? displayTitle(cylinder) : "Not available"} />
            <Divider />
            <SummaryField label="Reference" value={firstString(order, ["public_reference", "reference", "id"]) ?? "Not available"} />
            {requestedKg !== null ? <><Divider /><SummaryField label="Requested refill" value={`${requestedKg} kg`} /></> : null}
            {filledKg !== null ? <><Divider /><SummaryField label="Actual refill" value={`${filledKg} kg`} /></> : null}
            {workspace === "station" && driver ? <><Divider /><SummaryField label="Assigned driver" value={firstString(driver, ["displayName", "display_name", "name"]) ?? displayTitle(driver)} /></> : null}
            {workspace === "driver" && customer ? <><Divider /><SummaryField label="Customer" value={firstString(customer, ["displayName", "display_name"]) ?? "Customer"} /></> : null}
            {workspace === "driver" && firstString(pickup, ["contactPhone", "contact_phone"]) ? <><Divider /><SummaryField label="Customer phone" value={firstString(pickup, ["contactPhone", "contact_phone"]) ?? "Not available"} /></> : null}
            {workspace === "driver" && firstString(customer, ["email"]) ? <><Divider /><SummaryField label="Customer email" value={firstString(customer, ["email"]) ?? "Not available"} /></> : null}
          </View>

          {workspace === "driver" && (routeDistance !== null || routeDuration !== null) ? (
            <View style={styles.metricGrid}>
              <Metric icon={<MapPin color={palette.brand} size={19} />} label="Route distance" value={routeDistance !== null ? `${(routeDistance / 1000).toFixed(1)} km` : "Unavailable"} />
              <Metric icon={<Clock3 color={palette.brand} size={19} />} label="Estimated time" value={routeDuration !== null ? `${Math.ceil(routeDuration / 60)} min` : "Unavailable"} />
            </View>
          ) : null}

          {workspace === "driver" && navigationTarget ? (
            <AppButton
              label={`Navigate to ${navigationTarget.label.toLowerCase()}`}
              fullWidth
              size="lg"
              icon={<Navigation color="#FFFFFF" size={18} />}
              onPress={() => void openDeviceNavigation(navigationTarget).catch((cause) => {
                setNoticeSuccess(false);
                setNotice(friendlyError(cause, "Navigation could not be opened."));
              })}
            />
          ) : null}

          {workspace === "driver" && driverAction ? (
            <AppButton
              label={driverActionLabel(driverAction)}
              fullWidth
              size="lg"
              loading={action.isPending}
              onPress={() => void runDriverAction(driverAction)}
            />
          ) : null}

          {canDriverScan && driverScanType ? (
            <View style={[styles.scanCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <View style={styles.sectionLead}>
                <View style={[styles.sectionIcon, { backgroundColor: palette.brandSoft }]}><ScanLine color={palette.brand} size={22} /></View>
                <View style={styles.sectionCopy}>
                  <Text style={[styles.sectionTitle, { color: palette.ink }]}>{driverScanTitle(driverScanType)}</Text>
                  <Text style={[styles.sectionBody, { color: palette.muted }]}>{driverScanDescription(driverScanType)}</Text>
                </View>
              </View>
              <Scanner enabled onDetected={setToken} />
              {token ? (
                <AppButton
                  label={driverScanButton(driverScanType)}
                  fullWidth
                  loading={scan.isPending}
                  icon={<CheckCircle2 color="#FFFFFF" size={17} />}
                  onPress={() => void submitDriverScan()}
                />
              ) : (
                <Text style={[styles.scannerHint, { color: palette.muted }]}>Align the SKIMA cylinder code inside the scanner to continue.</Text>
              )}
            </View>
          ) : null}

          {canStationScan && stationScanType ? (
            <View style={[styles.scanCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <View style={styles.sectionLead}>
                <View style={[styles.sectionIcon, { backgroundColor: palette.brandSoft }]}><ScanLine color={palette.brand} size={22} /></View>
                <View style={styles.sectionCopy}>
                  <Text style={[styles.sectionTitle, { color: palette.ink }]}>Verify cylinder release</Text>
                  <Text style={[styles.sectionBody, { color: palette.muted }]}>Scan the filled cylinder before handing it back to the assigned driver.</Text>
                </View>
              </View>
              {!token ? <Scanner enabled onDetected={setToken} /> : null}
              {token ? <AppButton label="Confirm cylinder release" fullWidth loading={scan.isPending} onPress={() => void submitStationScan()} /> : null}
            </View>
          ) : null}

          {workspace === "driver" && status === "driver_offered" ? (
            <InfoNotice
              icon={<ShieldCheck color={palette.brand} size={19} />}
              text="SKIMA is finalising this automatic assignment. No driver acceptance action is required."
            />
          ) : null}

          {workspace === "station" && stationWaitingForDriverScan ? (
            <InfoNotice
              icon={<ScanLine color={palette.brand} size={19} />}
              text="Waiting for the assigned driver to scan the cylinder at reception. After SKIMA confirms it, you can complete the safety check."
            />
          ) : null}

          {workspace === "station" && status === "station_verified" && !existingInspection && stationCanInspect ? (
            <View style={[styles.operationCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <View style={styles.sectionLead}>
                <View style={[styles.sectionIcon, { backgroundColor: palette.warningSoft }]}><ShieldCheck color={palette.warning} size={22} /></View>
                <View style={styles.sectionCopy}>
                  <Text style={[styles.sectionTitle, { color: palette.ink }]}>Cylinder safety check</Text>
                  <Text style={[styles.sectionBody, { color: palette.muted }]}>Record the condition observed at reception before the cylinder is filled.</Text>
                </View>
              </View>

              <View style={styles.options}>
                {["safe", "unsafe", "manual_review", "rejected"].map((result) => (
                  <AppButton
                    key={result}
                    label={inspectionLabel(result)}
                    size="sm"
                    variant={inspectionResult === result ? "primary" : result === "unsafe" || result === "rejected" ? "danger" : "secondary"}
                    onPress={() => setInspectionResult(result)}
                  />
                ))}
              </View>

              <TextInput
                value={inspectionNotes}
                onChangeText={setInspectionNotes}
                placeholder="Add a safety note if needed"
                placeholderTextColor={palette.muted}
                multiline
                style={[styles.input, styles.notes, { backgroundColor: palette.input, borderColor: palette.borderStrong, color: palette.ink }]}
              />

              {inspectionResult ? (
                <EvidenceCapture
                  assetTypeKey="media.lpg.inspection_evidence"
                  label="Add a safety photo (optional)"
                  draftType={`station-inspection-${id ?? "unknown"}`}
                  onUploaded={(assetId) => submitInspection(assetId)}
                />
              ) : null}

              <AppButton
                label="Save safety check"
                fullWidth
                loading={inspection.isPending}
                disabled={!inspectionResult}
                onPress={() => void submitInspection()}
              />
            </View>
          ) : null}

          {workspace === "station" && existingInspection ? (
            <View style={[styles.inspectionSummary, { backgroundColor: existingInspectionResult === "safe" ? palette.successSoft : palette.dangerSoft }]}>
              {existingInspectionResult === "safe" ? <CheckCircle2 color={palette.success} size={21} /> : <AlertTriangle color={palette.danger} size={21} />}
              <View style={styles.inspectionCopy}>
                <Text style={[styles.inspectionTitle, { color: palette.ink }]}>Safety check: {inspectionLabel(existingInspectionResult ?? "recorded")}</Text>
                <Text style={[styles.inspectionBody, { color: palette.muted }]}>{existingInspectionResult === "safe" ? "This cylinder can proceed to refill." : "Do not fill this cylinder. Contact SKIMA support for the next step."}</Text>
              </View>
            </View>
          ) : null}

          {workspace === "station" && stationCanPump && (refillActive || releaseReady) && safeInspection ? (
            <View style={[styles.operationCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <View style={styles.sectionLead}>
                <View style={[styles.sectionIcon, { backgroundColor: palette.brandSoft }]}><Gauge color={palette.brand} size={22} /></View>
                <View style={styles.sectionCopy}>
                  <Text style={[styles.sectionTitle, { color: palette.ink }]}>{releaseReady ? "Refill confirmed" : "Record actual refill"}</Text>
                  <Text style={[styles.sectionBody, { color: palette.muted }]}>{releaseReady ? "The refill is confirmed. The assigned driver can begin the return journey." : `Customer requested ${requestedKg ?? "—"} kg. Enter only what was actually filled.`}</Text>
                </View>
              </View>

              {!releaseReady ? (
                <>
                  <View style={styles.fieldGroup}>
                    <Text style={[styles.fieldLabel, { color: palette.ink }]}>Actual kilograms filled</Text>
                    <TextInput
                      value={actualKg}
                      onChangeText={setActualKg}
                      keyboardType="decimal-pad"
                      placeholder="e.g. 6"
                      placeholderTextColor={palette.muted}
                      style={[styles.input, { backgroundColor: palette.input, borderColor: palette.borderStrong, color: palette.ink }]}
                    />
                  </View>
                  <AppButton
                    label="Confirm refill"
                    fullWidth
                    size="lg"
                    loading={confirmRefill.isPending || action.isPending}
                    icon={<CheckCircle2 color="#FFFFFF" size={18} />}
                    onPress={() => void confirmStationRefill()}
                  />
                </>
              ) : (
                <InfoNotice
                  icon={<CheckCircle2 color={palette.success} size={19} />}
                  text="No payment action is needed. Station earnings update automatically after the refill is confirmed."
                />
              )}
            </View>
          ) : null}

          {workspace === "station" && !stationCanInspect ? (
            <InfoNotice
              icon={<ShieldCheck color={palette.mutedStrong} size={19} />}
              text="You can view this order, but your team role does not allow safety checks or refill updates."
            />
          ) : null}

          {workspace === "driver" && ["delivered", "completed"].includes(status) ? (
            <InfoNotice
              icon={<CheckCircle2 color={palette.success} size={19} />}
              text="Delivery is confirmed. Your earnings will be added automatically; no further action is needed."
            />
          ) : null}

          {notice ? (
            <View style={[styles.notice, { backgroundColor: noticeSuccess ? palette.successSoft : palette.dangerSoft }]}>
              <Text accessibilityRole="alert" style={[styles.noticeText, { color: noticeSuccess ? palette.success : palette.danger }]}>{notice}</Text>
            </View>
          ) : null}
        </>
      )}
    </Screen>
  );
}

function StationProgress({ status }: { status: string }) {
  const { palette } = useAppTheme();
  const receiptComplete = ["station_verified", "refill_in_progress", "refill_confirmed", "station_settled", "return_en_route", "delivery_verification_pending", "delivered", "completed"].includes(status);
  const refillComplete = ["refill_confirmed", "station_settled", "return_en_route", "delivery_verification_pending", "delivered", "completed"].includes(status);
  const readyComplete = ["station_settled", "return_en_route", "delivery_verification_pending", "delivered", "completed"].includes(status);
  return (
    <View style={[styles.progressCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <ProgressStep number="1" label="Driver checked in" complete={receiptComplete} active={!receiptComplete} />
      <View style={[styles.progressLine, { backgroundColor: palette.border }]} />
      <ProgressStep number="2" label="Safety & refill" complete={refillComplete} active={receiptComplete && !refillComplete} />
      <View style={[styles.progressLine, { backgroundColor: palette.border }]} />
      <ProgressStep number="3" label="Ready for driver" complete={readyComplete} active={refillComplete && !readyComplete} />
    </View>
  );
}

function ProgressStep({ number, label, complete, active }: { number: string; label: string; complete: boolean; active: boolean }) {
  const { palette } = useAppTheme();
  return (
    <View style={styles.progressStep}>
      <View style={[styles.progressNode, { backgroundColor: complete ? palette.success : active ? palette.brand : palette.surfaceSubtle }]}>
        {complete ? <CheckCircle2 color="#FFFFFF" size={16} /> : <Text style={[styles.progressNumber, { color: active ? "#FFFFFF" : palette.muted }]}>{number}</Text>}
      </View>
      <Text style={[styles.progressLabel, { color: active || complete ? palette.ink : palette.muted }]}>{label}</Text>
    </View>
  );
}

function SummaryField({ label, value }: { label: string; value: string }) {
  const { palette } = useAppTheme();
  return (
    <View style={styles.summaryRow}>
      <Text style={[styles.summaryLabel, { color: palette.muted }]}>{label}</Text>
      <Text style={[styles.summaryValue, { color: palette.ink }]}>{value}</Text>
    </View>
  );
}

function Divider() {
  const { palette } = useAppTheme();
  return <View style={[styles.divider, { backgroundColor: palette.border }]} />;
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  const { palette } = useAppTheme();
  return (
    <View style={[styles.metric, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <View style={[styles.metricIcon, { backgroundColor: palette.brandSoft }]}>{icon}</View>
      <Text style={[styles.metricValue, { color: palette.ink }]}>{value}</Text>
      <Text style={[styles.metricLabel, { color: palette.muted }]}>{label}</Text>
    </View>
  );
}

function InfoNotice({ icon, text }: { icon: React.ReactNode; text: string }) {
  const { palette } = useAppTheme();
  return (
    <View style={[styles.infoNotice, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
      {icon}
      <Text style={[styles.infoNoticeText, { color: palette.muted }]}>{text}</Text>
    </View>
  );
}

function locationPoint(record: ReturnType<typeof nestedRecord>, label: string): MapPoint | null {
  const latitude = firstNumber(record, ["latitude", "lat"]);
  const longitude = firstNumber(record, ["longitude", "lng", "lon"]);
  return latitude !== null && longitude !== null ? { latitude, longitude, label } : null;
}

function navigationPointForStatus(status: string, points: MapPoint[]) {
  if (["pickup_verified", "station_en_route"].includes(status)) return points.find((point) => point.label === "Station") ?? null;
  if (["refill_confirmed", "station_settled", "return_en_route", "delivery_verification_pending"].includes(status)) return points.find((point) => point.label === "Delivery") ?? null;
  return points.find((point) => point.label === "Customer") ?? null;
}

function driverScanTypeForStatus(status: string): "customer_pickup" | "station_receipt" | "customer_delivery" | null {
  if (["driver_accepted", "pickup_en_route"].includes(status)) return "customer_pickup";
  if (["pickup_verified", "station_en_route"].includes(status)) return "station_receipt";
  if (["return_en_route", "delivery_verification_pending"].includes(status)) return "customer_delivery";
  return null;
}

function stationScanTypeForStatus(status: string): "station_release" | null {
  return ["refill_confirmed", "station_settled"].includes(status) ? "station_release" : null;
}

function driverActionForStatus(status: string) {
  if (status === "driver_accepted") return "lpg.pickup.start";
  if (status === "pickup_verified") return "lpg.station.start";
  if (["refill_confirmed", "station_settled"].includes(status)) return "lpg.return.start";
  if (status === "return_en_route") return "lpg.delivery.pending";
  return null;
}

function driverScanTitle(type: "customer_pickup" | "station_receipt" | "customer_delivery") {
  if (type === "station_receipt") return "Verify cylinder at the station";
  if (type === "customer_delivery") return "Verify the final hand-over";
  return "Verify customer pickup";
}

function driverScanDescription(type: "customer_pickup" | "station_receipt" | "customer_delivery") {
  if (type === "station_receipt") return "Scan the SKIMA cylinder code at reception so station staff can confirm the order and begin the refill.";
  if (type === "customer_delivery") return "After the customer confirms delivery, scan the same cylinder code to complete the hand-over.";
  return "Scan the customer's SKIMA cylinder code before collecting it.";
}

function driverScanButton(type: "customer_pickup" | "station_receipt" | "customer_delivery") {
  if (type === "station_receipt") return "Confirm station arrival";
  if (type === "customer_delivery") return "Complete hand-over";
  return "Confirm cylinder pickup";
}

function driverScanSuccess(type: "customer_pickup" | "station_receipt" | "customer_delivery") {
  if (type === "station_receipt") return "Station arrival confirmed. The station can now begin the refill.";
  if (type === "customer_delivery") return "Delivery verified. SKIMA is completing the order and releasing your payout automatically.";
  return "Cylinder pickup confirmed.";
}

function driverActionLabel(actionKey: string) {
  const labels: Record<string, string> = {
    "lpg.pickup.start": "Start pickup route",
    "lpg.station.start": "Head to refill station",
    "lpg.return.start": "Start return delivery",
    "lpg.delivery.pending": "Arrived for hand-over",
  };
  return labels[actionKey] ?? "Continue job";
}

function driverActionSuccess(actionKey: string) {
  const labels: Record<string, string> = {
    "lpg.pickup.start": "Pickup journey started.",
    "lpg.station.start": "Station journey started.",
    "lpg.return.start": "Return journey started.",
    "lpg.delivery.pending": "Arrival recorded. The customer can complete delivery verification.",
  };
  return labels[actionKey] ?? "Job updated.";
}

function friendlyJobStatus(value: string) {
  const normalized = value.toLowerCase().replace(/[\s-]+/g, "_");
  const labels: Record<string, string> = {
    driver_offered: "Assigning driver",
    driver_accepted: "Driver assigned",
    pickup_en_route: "Heading to pickup",
    pickup_verified: "Cylinder collected",
    station_en_route: "Heading to station",
    station_verified: "Verified at station",
    refill_started: "Refill started",
    refill_in_progress: "Refill in progress",
    refill_confirmed: "Refill confirmed",
    station_settled: "Ready for return",
    return_en_route: "Returning to customer",
    delivery_verification_pending: "Ready for hand-over",
    delivered: "Delivered",
    completed: "Completed",
    cancelled: "Cancelled",
  };
  return labels[normalized] ?? normalized.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

function driverStageDescription(status: string) {
  if (["driver_offered", "driver_accepted"].includes(status)) return "This order has been assigned to you.";
  if (["pickup_en_route"].includes(status)) return "Navigate to the customer and verify the cylinder before taking custody.";
  if (["pickup_verified", "station_en_route"].includes(status)) return "Take the verified cylinder to the assigned station and scan it at reception.";
  if (["station_verified", "refill_started", "refill_in_progress"].includes(status)) return "The station is processing the verified refill.";
  if (["refill_confirmed", "station_settled", "return_en_route"].includes(status)) return "The filled cylinder is ready to return to the customer.";
  if (status === "delivery_verification_pending") return "The customer must complete delivery verification before the final cylinder scan.";
  if (["delivered", "completed"].includes(status)) return "The hand-over is confirmed and payment processing continues automatically.";
  return "Follow the next available action for this assigned job.";
}

function stationStageDescription(status: string) {
  if (["pickup_verified", "station_en_route"].includes(status)) return "The assigned driver is bringing the verified cylinder to this station.";
  if (status === "station_verified") return "The assigned driver scanned the cylinder at reception. Complete the safety check before filling.";
  if (["refill_started", "refill_in_progress"].includes(status)) return "Record the actual kilograms filled after the safety-approved refill.";
  if (["refill_confirmed", "station_settled"].includes(status)) return "The refill is confirmed. The driver can continue the return journey.";
  if (["return_en_route", "delivery_verification_pending", "delivered", "completed"].includes(status)) return "This cylinder has left the station and is progressing through customer return.";
  return "Review the order and complete the next available step.";
}

function inspectionLabel(value: string) {
  const labels: Record<string, string> = {
    safe: "Safe to fill",
    unsafe: "Unsafe",
    manual_review: "Needs supervisor",
    rejected: "Reject cylinder",
    recorded: "Saved",
  };
  return labels[value] ?? value.replace(/_/g, " ");
}

function statusTone(status: string): "neutral" | "brand" | "success" | "warning" | "danger" {
  if (["completed", "delivered", "station_settled", "refill_confirmed"].includes(status)) return "success";
  if (["cancelled", "disputed"].includes(status)) return "danger";
  if (["driver_offered", "delivery_verification_pending"].includes(status)) return "warning";
  return "brand";
}

const styles = StyleSheet.create({
  hero: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md, padding: spacing.lg, borderRadius: radii.xl },
  heroCopy: { flex: 1, gap: 3 },
  heroEyebrow: { color: "rgba(255,255,255,.72)", ...typography.eyebrow, fontSize: 9 },
  heroTitle: { color: "#FFFFFF", ...typography.heading, fontSize: 21 },
  heroBody: { color: "rgba(255,255,255,.84)", ...typography.caption, lineHeight: 18 },
  mapShell: { borderRadius: radii.xl, overflow: "hidden" },
  progressCard: { minHeight: 88, flexDirection: "row", alignItems: "flex-start", borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.md },
  progressStep: { width: 92, alignItems: "center", gap: 7 },
  progressNode: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  progressNumber: { ...typography.bodyStrong, fontSize: 12 },
  progressLabel: { ...typography.caption, fontSize: 10, textAlign: "center", lineHeight: 14 },
  progressLine: { flex: 1, height: 2, marginTop: 16 },
  summaryCard: { gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.lg },
  summaryRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md },
  summaryLabel: { ...typography.caption, flex: 0.42 },
  summaryValue: { ...typography.bodyStrong, fontSize: 14, flex: 0.58, textAlign: "right" },
  divider: { height: StyleSheet.hairlineWidth },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  metric: { flex: 1, minWidth: 130, gap: 5, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  metricIcon: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  metricValue: { ...typography.heading, fontSize: 19 },
  metricLabel: { ...typography.caption },
  scanCard: { gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.md },
  operationCard: { gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.lg },
  sectionLead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  sectionIcon: { width: 46, height: 46, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  sectionCopy: { flex: 1, gap: 3 },
  sectionTitle: { ...typography.subheading, fontSize: 15 },
  sectionBody: { ...typography.caption, lineHeight: 18 },
  scannerHint: { ...typography.caption, textAlign: "center" },
  options: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  input: { minHeight: 54, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.md, fontSize: 15 },
  notes: { minHeight: 92, paddingTop: spacing.md, textAlignVertical: "top" },
  fieldGroup: { gap: spacing.sm },
  fieldLabel: { ...typography.caption, fontSize: 13, fontWeight: "900" },
  inspectionSummary: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, borderRadius: radii.lg, padding: spacing.md },
  inspectionCopy: { flex: 1, gap: 3 },
  inspectionTitle: { ...typography.bodyStrong, fontSize: 14 },
  inspectionBody: { ...typography.caption, lineHeight: 18 },
  infoNotice: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm + 2, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  infoNoticeText: { flex: 1, ...typography.caption, lineHeight: 18 },
  notice: { borderRadius: radii.md, padding: spacing.md },
  noticeText: { ...typography.caption, fontWeight: "800", textAlign: "center" },
});
