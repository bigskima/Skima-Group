import { CheckCircle2, CircleAlert, FileImage, Gauge, MapPin, Phone, QrCode, RefreshCw, ShieldCheck, Truck, WalletCards } from "lucide-react";
import { type FormEvent, useState } from "react";

import { PermissionGuard } from "@lpg/app/guards/PermissionGuard";
import { useSession } from "@lpg/app/providers/SessionProvider";
import { useDeviceLocation } from "@lpg/features/location/useDeviceLocation";
import { firstMediaAssetId, RuntimeMediaImage } from "@lpg/features/media/RuntimeMediaImage";
import { uploadRuntimeMedia } from "@lpg/features/media/uploadRuntimeMedia";
import { useJobDetailsQuery, useOrderFinancialSummaryQuery, useScansQuery } from "@lpg/features/orders/api";
import { BarcodeScannerInput } from "@lpg/features/scanning/BarcodeScannerInput";
import { useInspectionsQuery } from "@lpg/features/stations/api";
import {
  ActionResponseSchema,
  createLpgIdempotencyKey,
  displayReference,
  findRecordById,
  formatStatus,
  getActionResultId,
  getFirstRecordNumber,
  getFirstRecordString,
  getRecordArray,
  getRecordId,
  getRecordObject,
  getStatus,
  statusTone,
  type ActionResult,
  type PlatformRecord,
} from "@lpg/shared/api/records";
import { mutationErrorMessage, useGatewayCommandMutation, useGatewayMutation } from "@lpg/shared/api/useGatewayMutation";
import { QueryState } from "@lpg/shared/ui/QueryState";
import { InfoTile, PolishedEmpty, StatusChip } from "@lpg/shared/ui/lpgComponents";
import { OrderDetailsSkeleton, WorkflowFormSkeleton } from "@lpg/shared/ui/ScreenSkeletons";
import { RecordField, WorkflowForm, WorkflowHeader } from "@lpg/shared/ui/WorkflowScreen";
import { displayMoney } from "@lpg/shared/utilities/display";
import type { StationRoute, StationScreenProps } from "../../navigation/stationRoutes";

export function StationDriverArrivalScreen(props: StationScreenProps) {
  const orderId = props.navigation.params.jobId ?? null;
  const detail = useJobDetailsQuery(orderId);
  const order = getRecordObject(detail.data, "order");
  const driver = getRecordObject(detail.data, "driver");
  const vehicle = getRecordObject(detail.data, "vehicle");
  const pickup = getRecordObject(detail.data, "pickupLocation");
  const status = getStatus(order);
  const scanReady = ["pickup_verified", "station_en_route"].includes(status);
  const alreadyReceived = ["station_verified", "refill_in_progress", "refill_confirmed", "station_settled"].includes(status);

  return <QueryState loading={detail.isLoading} error={detail.error} skeleton={<OrderDetailsSkeleton />}>
    <WorkflowHeader title="Driver Arrival" subtitle={displayReference(order, "Station job")} onBack={props.navigation.goBack} />
    <section className="verification-banner"><Truck aria-hidden="true" /><div><strong>{getFirstRecordString(driver, ["displayName"]) ?? "Assigned driver"}</strong><span>{getFirstRecordString(vehicle, ["typeName"]) ?? "Approved vehicle"}</span></div><StatusChip tone={statusTone(status)} label={formatStatus(status)} /></section>
    <section className="panel-card"><RecordField label="Pickup contact" value={getFirstRecordString(pickup, ["contactName"]) ?? "Not shared"} /><RecordField label="Cylinder" value={`${getFirstRecordNumber(getRecordObject(detail.data, "cylinder"), ["sizeKg"]) ?? "Configured"} kg`} /><RecordField label="Requested refill" value={`${getFirstRecordNumber(order, ["requestedKg"]) ?? "Pending"} kg`} /></section>
    {getFirstRecordString(pickup, ["contactPhone"]) ? <a className="secondary-button" href={`tel:${getFirstRecordString(pickup, ["contactPhone"])?.replace(/[^+0-9]/g, "")}`}><Phone aria-hidden="true" />Call Pickup Contact</a> : null}
    <button type="button" className="primary-button" disabled={!scanReady && !alreadyReceived} onClick={() => props.navigation.navigate(alreadyReceived ? "inspection" : "scan-result", { jobId: orderId ?? "" })}><QrCode aria-hidden="true" />{alreadyReceived ? "Open Inspection" : "Receive Cylinder"}</button>
  </QueryState>;
}

export function StationScanResultScreen(props: StationScreenProps) {
  const orderId = props.navigation.params.jobId ?? null;
  const detail = useJobDetailsQuery(orderId);
  const location = useDeviceLocation();
  const [scannedToken, setScannedToken] = useState("");
  const [localError, setLocalError] = useState<Error | null>(null);
  const mutation = useGatewayMutation<ActionResult, Record<string, unknown>>({
    invalidate: [["jobs"], ["station-runtime"], ["scans"], ["orders"]],
    path: "/lpg/scans",
    schema: ActionResponseSchema,
  });
  const order = getRecordObject(detail.data, "order");
  const cylinder = getRecordObject(detail.data, "cylinder");
  const status = getStatus(order);
  const scanType = resolveStationScanType(status);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLocalError(null);
    try {
      if (!orderId || !scanType || !scannedToken.trim()) throw new Error("Scan or enter the cylinder code.");
      const point = await location.request();
      const result = await mutation.mutateAsync({
        accuracyMeters: point.accuracyMeters,
        idempotencyKey: createLpgIdempotencyKey(`station-${scanType}`, orderId),
        latitude: point.latitude,
        longitude: point.longitude,
        lpgOrderId: orderId,
        payload: { scannedCylinderId: getRecordId(cylinder), scannedToken: scannedToken.trim() },
        scanType,
        source: "skima.lpg.mobile",
      });
      const scanId = getActionResultId(result);
      props.navigation.replace(scanType === "station_receipt" ? "inspection" : "order-delivered", { jobId: orderId, scanId: scanId ?? "" });
    } catch (error) {
      setLocalError(error instanceof Error ? error : new Error("Cylinder verification failed."));
    }
  };

  return <PermissionGuard context={props.context} permissions={["lpg.stations.scan"]} fallback={<RestrictedStationAction onBack={props.navigation.goBack} />}>
    <QueryState loading={detail.isLoading} error={detail.error} skeleton={<OrderDetailsSkeleton />}>
      <WorkflowHeader title={scanType === "station_release" ? "Release Cylinder" : "Receive Cylinder"} subtitle={displayReference(order)} onBack={props.navigation.goBack} />
      {scanType ? <>
        <section className="station-cylinder-identity"><RuntimeMediaImage assetId={firstMediaAssetId(cylinder)} alt="Customer cylinder" /><div><StatusChip tone={statusTone(getFirstRecordString(cylinder, ["status"]))} label={formatStatus(getFirstRecordString(cylinder, ["status"]))} /><h2>{getFirstRecordNumber(cylinder, ["sizeKg"]) ?? "Configured"} kg cylinder</h2><p>{displayReference(cylinder, "Cylinder reference pending")}</p></div></section>
        <WorkflowForm error={localError ?? mutation.error ?? (location.error ? new Error(location.error) : undefined)} isPending={mutation.isPending || location.isLocating} onSubmit={(event) => void submit(event)} submitLabel={scanType === "station_release" ? "Verify And Release" : "Verify Station Receipt"}>
          <BarcodeScannerInput value={scannedToken} onChange={setScannedToken} disabled={mutation.isPending} />
        </WorkflowForm>
      </> : <PolishedEmpty icon={<QrCode />} title="No station scan is due" message={`This order is currently ${formatStatus(status).toLowerCase()}.`} />}
    </QueryState>
  </PermissionGuard>;
}

export function StationInspectionScreen(props: StationScreenProps) {
  const session = useSession();
  const orderId = props.navigation.params.jobId ?? null;
  const detail = useJobDetailsQuery(orderId);
  const inspections = useInspectionsQuery(Boolean(orderId));
  const order = getRecordObject(detail.data, "order");
  const station = getRecordObject(detail.data, "station");
  const existing = (inspections.data ?? []).find((record) => getFirstRecordString(record, ["lpg_order_id", "lpgOrderId"]) === orderId) ?? null;
  const [result, setResult] = useState("safe");
  const [observations, setObservations] = useState("");
  const [evidence, setEvidence] = useState<File | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [localError, setLocalError] = useState<Error | null>(null);
  const mutation = useGatewayMutation<ActionResult, Record<string, unknown>>({ invalidate: [["inspections"], ["jobs"], ["station-runtime"]], path: "/lpg/inspections", schema: ActionResponseSchema });

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLocalError(null);
    try {
      if (!orderId || !evidence) throw new Error("Inspection evidence is required.");
      const mediaAssetId = await uploadRuntimeMedia({
        api: session.api,
        assetTypeKey: "media.lpg.inspection_evidence",
        file: evidence,
        organizationId: getFirstRecordString(station, ["organizationId"]),
        ownerUserId: props.context.user.id,
      });
      await mutation.mutateAsync({
        evidenceMediaAssetIds: [mediaAssetId],
        idempotencyKey: createLpgIdempotencyKey("station-inspection", orderId),
        lpgOrderId: orderId,
        observations: { notes: observations.trim(), result },
        result,
        source: "skima.lpg.mobile",
      });
      setNotice(result === "safe" ? "Safe inspection recorded." : "Inspection outcome recorded for review.");
      await Promise.all([detail.refetch(), inspections.refetch()]);
    } catch (error) {
      setLocalError(error instanceof Error ? error : new Error("The inspection could not be recorded."));
    }
  };

  const existingResult = getFirstRecordString(existing, ["result"]);
  return <PermissionGuard context={props.context} permissions={["lpg.stations.scan", "lpg.stations.pump"]} fallback={<RestrictedStationAction onBack={props.navigation.goBack} />}>
    <QueryState loading={detail.isLoading || inspections.isLoading} error={detail.error ?? inspections.error} skeleton={<WorkflowFormSkeleton />}>
      <WorkflowHeader title="Cylinder Inspection" subtitle={displayReference(order)} onBack={props.navigation.goBack} />
      {existing ? <section className="panel-card"><StatusChip tone={statusTone(existingResult)} label={formatStatus(existingResult)} /><h2>Inspection recorded</h2><p>{getFirstRecordString(getRecordObject(existing, "observations"), ["notes"]) ?? "Evidence is stored securely with this job."}</p>{existingResult === "safe" ? <button type="button" className="primary-button" onClick={() => props.navigation.replace("refill-in-progress", { jobId: orderId ?? "" })}>Continue To Refill</button> : null}</section> : <WorkflowForm error={localError ?? mutation.error} isPending={mutation.isPending} notice={notice} onSubmit={(event) => void submit(event)} submitLabel="Record Inspection">
        <label>Inspection result<select value={result} onChange={(event) => setResult(event.currentTarget.value)}><option value="safe">Safe for refill</option><option value="manual_review">Requires manual review</option><option value="unsafe">Unsafe</option><option value="rejected">Reject cylinder</option></select></label>
        <label>Observations<textarea value={observations} onChange={(event) => setObservations(event.currentTarget.value)} required /></label>
        <label>Inspection evidence<span className="file-field"><FileImage aria-hidden="true" /><input type="file" accept="image/*" capture="environment" onChange={(event) => setEvidence(event.currentTarget.files?.[0] ?? null)} required /></span></label>
      </WorkflowForm>}
    </QueryState>
  </PermissionGuard>;
}

export function StationRefillInProgressScreen(props: StationScreenProps) {
  const orderId = props.navigation.params.jobId ?? null;
  const detail = useJobDetailsQuery(orderId);
  const inspections = useInspectionsQuery(Boolean(orderId));
  const command = useGatewayCommandMutation({ onSuccess: () => detail.refetch().then(() => undefined) });
  const order = getRecordObject(detail.data, "order");
  const cylinder = getRecordObject(detail.data, "cylinder");
  const status = getStatus(order);
  const safeInspection = (inspections.data ?? []).some((record) => getFirstRecordString(record, ["lpg_order_id", "lpgOrderId"]) === orderId && getFirstRecordString(record, ["result"]) === "safe");
  const start = () => orderId && command.mutate({ path: "/lpg/orders/actions", payload: { actionKey: "lpg.refill.start", idempotencyKey: `frontend:lpg-order-action:${orderId}:lpg.refill.start`, lpgOrderId: orderId } });
  const started = ["refill_in_progress", "refill_confirmed", "station_settled"].includes(status);

  return <PermissionGuard context={props.context} permissions={["lpg.stations.pump"]} fallback={<RestrictedStationAction onBack={props.navigation.goBack} />}>
    <QueryState loading={detail.isLoading || inspections.isLoading} error={detail.error ?? inspections.error} skeleton={<OrderDetailsSkeleton />}>
      <WorkflowHeader title="Refill In Progress" subtitle={displayReference(order)} onBack={props.navigation.goBack} />
      <section className="refill-progress-panel"><RuntimeMediaImage assetId={firstMediaAssetId(cylinder)} alt="Cylinder being refilled" /><StatusChip tone={started ? "success" : "warning"} label={formatStatus(status)} /><h2>{getFirstRecordNumber(order, ["requestedKg"]) ?? "Configured"} kg requested</h2><p>Only the pump operator can advance this verified branch job.</p></section>
      {!safeInspection ? <p className="form-message is-error"><CircleAlert aria-hidden="true" />A safe inspection must be recorded first.</p> : null}
      {command.error ? <p className="form-message is-error">{mutationErrorMessage(command.error)}</p> : null}
      {!started ? <button type="button" className="primary-button" disabled={!safeInspection || command.isPending} onClick={start}><Gauge aria-hidden="true" />Start Refill</button> : <button type="button" className="primary-button" onClick={() => props.navigation.navigate(status === "refill_in_progress" ? "actual-kilograms" : "refill-completion", { jobId: orderId ?? "" })}>{status === "refill_in_progress" ? "Enter Actual Kilograms" : "View Refill Completion"}</button>}
    </QueryState>
  </PermissionGuard>;
}

export function StationActualKilogramsScreen(props: StationScreenProps) {
  const orderId = props.navigation.params.jobId ?? null;
  const detail = useJobDetailsQuery(orderId);
  const order = getRecordObject(detail.data, "order");
  const requestedKg = getFirstRecordNumber(order, ["requestedKg"]);
  const [actualKg, setActualKg] = useState("");
  const [observations, setObservations] = useState("");
  const mutation = useGatewayMutation<ActionResult, Record<string, unknown>>({ invalidate: [["jobs"], ["station-runtime"]], path: "/lpg/refills/confirm", schema: ActionResponseSchema, onSuccess: () => props.navigation.replace("refill-completion", { jobId: orderId ?? "" }) });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!orderId) return;
    mutation.mutate({ actualKg: Number(actualKg), idempotencyKey: createLpgIdempotencyKey("station-refill-confirm", orderId), lpgOrderId: orderId, safetyObservations: { notes: observations.trim(), result: "safe" }, source: "skima.lpg.mobile" });
  };

  return <PermissionGuard context={props.context} permissions={["lpg.stations.pump"]} fallback={<RestrictedStationAction onBack={props.navigation.goBack} />}>
    <QueryState loading={detail.isLoading} error={detail.error} skeleton={<WorkflowFormSkeleton />}>
      <WorkflowHeader title="Actual Kilograms" subtitle={displayReference(order)} onBack={props.navigation.goBack} />
      <section className="metric-grid"><InfoTile icon={<Gauge />} title="Requested" text={`${requestedKg ?? "Pending"} kg`} /><InfoTile icon={<ShieldCheck />} title="Tolerance" text="Backend policy enforced" /></section>
      <WorkflowForm error={mutation.error} isPending={mutation.isPending} onSubmit={submit} submitLabel="Confirm Refill">
        <label>Actual kilograms filled<input type="number" min="0.001" max={requestedKg ?? undefined} step="0.001" value={actualKg} onChange={(event) => setActualKg(event.currentTarget.value)} required /></label>
        <label>Safety notes<textarea value={observations} onChange={(event) => setObservations(event.currentTarget.value)} /></label>
        <p className="action-copy"><ShieldCheck aria-hidden="true" />Underfill is reconciled automatically. Overfill is blocked for review.</p>
      </WorkflowForm>
    </QueryState>
  </PermissionGuard>;
}

export function StationRefillCompletionScreen(props: StationScreenProps) {
  const orderId = props.navigation.params.jobId ?? null;
  const detail = useJobDetailsQuery(orderId);
  const financials = useOrderFinancialSummaryQuery(orderId);
  const settlement = useGatewayCommandMutation({ onSuccess: () => detail.refetch().then(() => undefined) });
  const order = getRecordObject(detail.data, "order");
  const canSettle = props.context.platformAdmin || props.context.permissions.some((permission) => ["lpg.orders.finance", "business.finance.read", "business.settlements.read"].includes(permission));
  const settle = () => orderId && settlement.mutate({ path: "/lpg/orders/settle-station", payload: { idempotencyKey: `frontend:lpg-station-settlement:${orderId}`, lpgOrderId: orderId, source: "skima.lpg.mobile" } });

  return <QueryState loading={detail.isLoading || financials.isLoading} error={detail.error ?? financials.error} skeleton={<OrderDetailsSkeleton />}>
    <section className="order-confirmation"><span className="confirmation-icon"><CheckCircle2 aria-hidden="true" /></span><h1>Refill Confirmed</h1><p>{displayReference(order)}</p><div className="panel-card"><RecordField label="Actual refill" value={`${getFirstRecordNumber(order, ["actualKg"]) ?? "Pending"} kg`} /><RecordField label="Station amount" value={displayMoney(getFirstRecordNumber(order, ["stationAmount"]), getFirstRecordString(order, ["currencyCode"]))} /><RecordField label="Reconciliation" value={formatStatus(getFirstRecordString(financials.data, ["reconciliationStatus", "status"]))} /></div>{settlement.error ? <p className="form-message is-error">{mutationErrorMessage(settlement.error)}</p> : null}{canSettle && getStatus(order) === "refill_confirmed" ? <button type="button" className="secondary-button" disabled={settlement.isPending} onClick={settle}><WalletCards aria-hidden="true" />Settle Station</button> : null}<button type="button" className="primary-button" onClick={() => props.navigation.replace("scan-result", { jobId: orderId ?? "" })}><QrCode aria-hidden="true" />Release To Driver</button></section>
  </QueryState>;
}

export function StationOrderReleasedScreen(props: StationScreenProps) {
  const orderId = props.navigation.params.jobId ?? null;
  const detail = useJobDetailsQuery(orderId);
  const scans = useScansQuery(orderId);
  const order = getRecordObject(detail.data, "order");
  const scan = findRecordById(scans.data ?? [], props.navigation.params.scanId) ?? scans.data?.find((record) => getFirstRecordString(record, ["scan_type", "scanType"]) === "station_release") ?? null;
  return <QueryState loading={detail.isLoading || scans.isLoading} error={detail.error ?? scans.error} skeleton={<OrderDetailsSkeleton />}>
    {scan ? <section className="order-confirmation"><span className="confirmation-icon"><CheckCircle2 aria-hidden="true" /></span><h1>Released To Driver</h1><p>{displayReference(order)}</p><StatusChip tone="success" label={formatStatus(getStatus(order))} /><div className="panel-card"><RecordField label="Verification" value={displayReference(scan)} /><RecordField label="Actual refill" value={`${getFirstRecordNumber(order, ["actualKg"]) ?? "Pending"} kg`} /><RecordField label="Next phase" value="Driver return and customer verification" /></div><button type="button" className="primary-button" onClick={() => props.navigation.replace("jobs")}>Back To Jobs</button></section> : <PolishedEmpty icon={<RefreshCw />} title="Release verification pending" message="Refresh the job after the release scan is recorded." />}
  </QueryState>;
}

function resolveStationScanType(status: string): "station_receipt" | "station_release" | null {
  if (["pickup_verified", "station_en_route"].includes(status)) return "station_receipt";
  if (["refill_confirmed", "station_settled"].includes(status)) return "station_release";
  return null;
}

function RestrictedStationAction(props: { readonly onBack: () => void }) {
  return <section><WorkflowHeader title="Restricted Station Action" onBack={props.onBack} /><PolishedEmpty icon={<ShieldCheck />} title="Permission required" message="Your current branch role does not permit this operation." /></section>;
}

export function stationNextRoute(status: string): StationRoute {
  if (["pickup_verified", "station_en_route"].includes(status)) return "driver-arrival";
  if (status === "station_verified") return "inspection";
  if (status === "refill_in_progress") return "actual-kilograms";
  if (["refill_confirmed", "station_settled"].includes(status)) return "refill-completion";
  if (status === "return_en_route") return "order-delivered";
  return "job-details";
}

export function StationJobTimeline(props: { readonly events: readonly PlatformRecord[] }) {
  return <section className="job-timeline"><h2>Job Timeline</h2>{props.events.map((event, index) => <div className="timeline-row" key={getRecordId(event) ?? String(index)}><span /><div><strong>{formatStatus(getFirstRecordString(event, ["eventType", "event_type"]))}</strong><p>{new Date(getFirstRecordString(event, ["createdAt", "created_at"]) ?? "").toLocaleString()}</p></div></div>)}</section>;
}
