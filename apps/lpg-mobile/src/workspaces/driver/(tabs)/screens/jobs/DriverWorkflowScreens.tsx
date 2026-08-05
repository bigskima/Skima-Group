import { CheckCircle2, MapPin, Navigation, Phone, RefreshCw, ShieldCheck, Truck, WalletCards } from "lucide-react";
import { type FormEvent, useState } from "react";

import { useSession } from "@lpg/app/providers/SessionProvider";
import { useDeviceLocation } from "@lpg/features/location/useDeviceLocation";
import { useJobDetailsQuery, useOrderFinancialSummaryQuery, useScansQuery } from "@lpg/features/orders/api";
import { BarcodeScannerInput } from "@lpg/features/scanning/BarcodeScannerInput";
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
  type ActionResult,
  type PlatformRecord,
} from "@lpg/shared/api/records";
import { mutationErrorMessage, useGatewayCommandMutation, useGatewayMutation } from "@lpg/shared/api/useGatewayMutation";
import { QueryState } from "@lpg/shared/ui/QueryState";
import { InfoTile, PolishedEmpty, StatusChip } from "@lpg/shared/ui/lpgComponents";
import { OrderDetailsSkeleton } from "@lpg/shared/ui/ScreenSkeletons";
import { RecordField, WorkflowForm, WorkflowHeader } from "@lpg/shared/ui/WorkflowScreen";
import { displayMoney } from "@lpg/shared/utilities/display";
import type { DriverRoute, DriverScreenProps } from "../../navigation/driverRoutes";

export function CustomerRouteScreen(props: DriverScreenProps) {
  return <DriverRouteStageScreen {...props} actionKey="lpg.pickup.start" destinationKey="pickupLocation" nextRoute="customer-arrival" title="Route To Customer" actionLabel="Start Pickup Trip" />;
}

export function StationRouteScreen(props: DriverScreenProps) {
  return <DriverRouteStageScreen {...props} actionKey="lpg.station.start" destinationKey="station" nextRoute="station-handoff" title="Route To Station" actionLabel="Start Station Trip" />;
}

export function ReturnRouteScreen(props: DriverScreenProps) {
  return <DriverRouteStageScreen {...props} actionKey="lpg.return.start" destinationKey="deliveryLocation" nextRoute="delivery-verification" title="Return To Customer" actionLabel="Start Return Trip" />;
}

function DriverRouteStageScreen(props: DriverScreenProps & {
  readonly actionKey: string;
  readonly actionLabel: string;
  readonly destinationKey: "deliveryLocation" | "pickupLocation" | "station";
  readonly nextRoute: DriverRoute;
  readonly title: string;
}) {
  const session = useSession();
  const orderId = props.navigation.params.jobId ?? null;
  const detail = useJobDetailsQuery(orderId);
  const command = useGatewayCommandMutation();
  const location = useDeviceLocation();
  const destination = getRecordObject(detail.data, props.destinationKey);
  const order = getRecordObject(detail.data, "order");
  const driver = getRecordObject(detail.data, "driver");
  const [localError, setLocalError] = useState<Error | null>(null);

  const proceed = async () => {
    setLocalError(null);
    try {
      if (!orderId) throw new Error("The job identifier is missing.");
      const driverId = getRecordId(driver);
      if (!driverId) throw new Error("The assigned driver profile is missing.");
      const point = await location.request();
      await session.api.post("/lpg/driver-locations", {
        accuracyMeters: point.accuracyMeters,
        driverProfileId: driverId,
        headingDegrees: point.headingDegrees,
        idempotencyKey: createLpgIdempotencyKey("driver-route", point.recordedAt),
        latitude: point.latitude,
        longitude: point.longitude,
        lpgOrderId: orderId,
        onlineStatus: "busy",
        recordedAt: point.recordedAt,
        source: "skima.lpg.mobile",
        speedMetersPerSecond: point.speedMetersPerSecond,
      }, ActionResponseSchema);
      await command.mutateAsync({
        path: "/lpg/orders/actions",
        payload: {
          actionKey: props.actionKey,
          idempotencyKey: `frontend:lpg-order-action:${orderId}:${props.actionKey}`,
          lpgOrderId: orderId,
          payload: { locationRecordedAt: point.recordedAt },
        },
      });
      props.navigation.replace(props.nextRoute, { jobId: orderId });
    } catch (error) {
      setLocalError(error instanceof Error ? error : new Error("The route could not be started."));
    }
  };

  return <QueryState loading={detail.isLoading} error={detail.error} skeleton={<OrderDetailsSkeleton />}>
    <WorkflowHeader title={props.title} subtitle={displayReference(order, "Assigned LPG job")} onBack={props.navigation.goBack} />
    <DestinationPanel destination={destination} />
    <section className="route-coordinate-panel">
      <Navigation aria-hidden="true" />
      <div><strong>Backend destination</strong><span>{formatCoordinate(destination)}</span></div>
    </section>
    {localError ?? command.error ? <p className="form-message is-error">{mutationErrorMessage(localError ?? command.error)}</p> : null}
    <button type="button" className="primary-button" disabled={command.isPending || location.isLocating || !destination} onClick={() => void proceed()}><Navigation aria-hidden="true" />{location.isLocating ? "Getting Location" : props.actionLabel}</button>
  </QueryState>;
}

export function CustomerArrivalScreen(props: DriverScreenProps) {
  const orderId = props.navigation.params.jobId ?? null;
  const detail = useJobDetailsQuery(orderId);
  const order = getRecordObject(detail.data, "order");
  const customer = getRecordObject(detail.data, "customer");
  const pickup = getRecordObject(detail.data, "pickupLocation");
  const phone = getFirstRecordString(pickup, ["contactPhone"]);
  return <QueryState loading={detail.isLoading} error={detail.error} skeleton={<OrderDetailsSkeleton />}>
    <WorkflowHeader title="Customer Arrival" subtitle={displayReference(order)} onBack={props.navigation.goBack} />
    <section className="panel-card driver-contact-panel">
      <StatusChip tone="success" label="Pickup location" />
      <RecordField label="Customer" value={getFirstRecordString(pickup, ["contactName"]) ?? getFirstRecordString(customer, ["displayName"]) ?? "Customer"} />
      <RecordField label="Address" value={getFirstRecordString(pickup, ["formattedAddress"]) ?? "Address unavailable"} />
      {phone ? <a className="secondary-button" href={`tel:${phone.replace(/[^+0-9]/g, "")}`}><Phone aria-hidden="true" />Call Customer</a> : null}
    </section>
    <button type="button" className="primary-button" onClick={() => props.navigation.navigate("pickup-verification", { jobId: orderId ?? "" })}><ShieldCheck aria-hidden="true" />Verify Pickup Cylinder</button>
  </QueryState>;
}

export function PickupVerificationScreen(props: DriverScreenProps) {
  return <DriverScanVerificationScreen {...props} scanType="customer_pickup" title="Pickup Verification" />;
}

function DriverScanVerificationScreen(props: DriverScreenProps & { readonly scanType: "customer_delivery" | "customer_pickup"; readonly title: string }) {
  const orderId = props.navigation.params.jobId ?? null;
  const detail = useJobDetailsQuery(orderId);
  const location = useDeviceLocation();
  const [scannedToken, setScannedToken] = useState("");
  const [localError, setLocalError] = useState<Error | null>(null);
  const mutation = useGatewayMutation<ActionResult, Record<string, unknown>>({
    invalidate: [["jobs"], ["orders"], ["scans"]],
    path: "/lpg/scans",
    schema: ActionResponseSchema,
  });
  const order = getRecordObject(detail.data, "order");
  const cylinder = getRecordObject(detail.data, "cylinder");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLocalError(null);
    try {
      if (!orderId || !scannedToken.trim()) throw new Error("Scan or enter the cylinder code.");
      const point = await location.request();
      const result = await mutation.mutateAsync({
        accuracyMeters: point.accuracyMeters,
        idempotencyKey: createLpgIdempotencyKey(`driver-${props.scanType}`, orderId),
        latitude: point.latitude,
        longitude: point.longitude,
        lpgOrderId: orderId,
        payload: {
          deliveryChallengeId: props.scanType === "customer_delivery" ? getFirstRecordString(order, ["deliveryChallengeId"]) : undefined,
          scannedCylinderId: getRecordId(cylinder),
          scannedToken: scannedToken.trim(),
        },
        scanType: props.scanType,
        source: "skima.lpg.mobile",
      });
      const scanId = getActionResultId(result);
      props.navigation.replace("scan-result", { jobId: orderId, scanId: scanId ?? "" });
    } catch (error) {
      setLocalError(error instanceof Error ? error : new Error("Cylinder verification failed."));
    }
  };

  return <QueryState loading={detail.isLoading} error={detail.error} skeleton={<OrderDetailsSkeleton />}>
    <WorkflowHeader title={props.title} subtitle={displayReference(order)} onBack={props.navigation.goBack} />
    <section className="verification-banner"><Truck aria-hidden="true" /><div><strong>{getFirstRecordNumber(cylinder, ["sizeKg"]) ?? "Configured"} kg cylinder</strong><span>The scanned identity must match this order.</span></div></section>
    <WorkflowForm error={localError ?? mutation.error ?? (location.error ? new Error(location.error) : undefined)} isPending={mutation.isPending || location.isLocating} onSubmit={(event) => void submit(event)} submitLabel="Verify Cylinder">
      <BarcodeScannerInput value={scannedToken} onChange={setScannedToken} disabled={mutation.isPending} />
    </WorkflowForm>
  </QueryState>;
}

export function StationHandoffScreen(props: DriverScreenProps) {
  const orderId = props.navigation.params.jobId ?? null;
  const detail = useJobDetailsQuery(orderId);
  const order = getRecordObject(detail.data, "order");
  const status = getStatus(order);
  const events = getRecordArray(detail.data, "events");
  const canReturn = ["refill_confirmed", "station_settled", "return_en_route"].includes(status);
  return <QueryState loading={detail.isLoading} error={detail.error} skeleton={<OrderDetailsSkeleton />}>
    <WorkflowHeader title="Station Handoff" subtitle={displayReference(order)} onBack={props.navigation.goBack} />
    <section className="panel-card"><StatusChip tone={canReturn ? "success" : "warning"} label={formatStatus(status)} /><h2>Station verification</h2><p>The station scanner and pump operator control receipt, inspection, and refill confirmation.</p></section>
    <EventTimeline events={events} />
    <button type="button" className="secondary-button" onClick={() => void detail.refetch()}><RefreshCw aria-hidden="true" />Refresh Status</button>
    <button type="button" className="primary-button" disabled={!canReturn} onClick={() => props.navigation.navigate("return-route", { jobId: orderId ?? "" })}>Continue Return</button>
  </QueryState>;
}

export function DriverDeliveryVerificationScreen(props: DriverScreenProps) {
  const orderId = props.navigation.params.jobId ?? null;
  const detail = useJobDetailsQuery(orderId);
  const order = getRecordObject(detail.data, "order");
  const status = getStatus(order);
  const command = useGatewayCommandMutation();
  const [localError, setLocalError] = useState<Error | null>(null);
  const requestVerification = async () => {
    setLocalError(null);
    try {
      if (!orderId) throw new Error("The job identifier is missing.");
      await command.mutateAsync({ path: "/lpg/orders/actions", payload: { actionKey: "lpg.delivery.pending", idempotencyKey: `frontend:lpg-order-action:${orderId}:lpg.delivery.pending`, lpgOrderId: orderId } });
      await detail.refetch();
    } catch (error) { setLocalError(error instanceof Error ? error : new Error("Delivery verification could not start.")); }
  };
  const challengeId = getFirstRecordString(order, ["deliveryChallengeId"]);
  if (status !== "delivery_verification_pending" && !challengeId) {
    return <QueryState loading={detail.isLoading} error={detail.error} skeleton={<OrderDetailsSkeleton />}><WorkflowHeader title="Delivery Verification" subtitle={displayReference(order)} onBack={props.navigation.goBack} /><section className="panel-card"><h2>Customer verification</h2><p>Start the delivery challenge when you are with the customer and cylinder.</p></section>{localError ?? command.error ? <p className="form-message is-error">{mutationErrorMessage(localError ?? command.error)}</p> : null}<button type="button" className="primary-button" disabled={command.isPending} onClick={() => void requestVerification()}>Start Delivery Verification</button></QueryState>;
  }
  return <DriverScanVerificationScreen {...props} scanType="customer_delivery" title="Delivery Cylinder Scan" />;
}

export function ScanResultScreen(props: DriverScreenProps) {
  const orderId = props.navigation.params.jobId ?? null;
  const scans = useScansQuery(orderId);
  const scan = findRecordById(scans.data ?? [], props.navigation.params.scanId) ?? scans.data?.[0] ?? null;
  const scanType = getFirstRecordString(scan, ["scan_type", "scanType"]);
  const nextRoute: DriverRoute = scanType === "customer_delivery" ? "job-completed" : "station-route";
  return <QueryState loading={scans.isLoading} error={scans.error} skeleton={<OrderDetailsSkeleton />}>
    {scan ? <section className="order-confirmation"><span className="confirmation-icon"><CheckCircle2 aria-hidden="true" /></span><h1>Cylinder Verified</h1><p>{displayReference(scan, "Verification recorded")}</p><StatusChip tone="success" label={formatStatus(getFirstRecordString(scan, ["result"]))} /><button type="button" className="primary-button" onClick={() => props.navigation.replace(nextRoute, { jobId: orderId ?? "" })}>Continue Job</button></section> : <PolishedEmpty icon={<ShieldCheck />} title="Scan unavailable" message="No accessible verification record was returned." />}
  </QueryState>;
}

export function JobCompletedScreen(props: DriverScreenProps) {
  const orderId = props.navigation.params.jobId ?? null;
  const detail = useJobDetailsQuery(orderId);
  const financials = useOrderFinancialSummaryQuery(orderId);
  const commission = useGatewayCommandMutation();
  const order = getRecordObject(detail.data, "order");
  const execute = () => orderId && commission.mutate({ path: "/lpg/orders/execute-driver-commission", payload: { idempotencyKey: `frontend:lpg-driver-commission:${orderId}`, lpgOrderId: orderId } });
  return <QueryState loading={detail.isLoading || financials.isLoading} error={detail.error ?? financials.error} skeleton={<OrderDetailsSkeleton />}>
    <section className="order-confirmation"><span className="confirmation-icon"><CheckCircle2 aria-hidden="true" /></span><h1>Delivery Complete</h1><p>{displayReference(order)}</p><div className="panel-card"><RecordField label="Status" value={formatStatus(getStatus(order))} /><RecordField label="Commission" value={displayMoney(getFirstRecordNumber(order, ["driverCommissionAmount"]), getFirstRecordString(order, ["currencyCode"]))} /><RecordField label="Reconciliation" value={formatStatus(getFirstRecordString(financials.data, ["reconciliationStatus", "status"]))} /></div>{commission.error ? <p className="form-message is-error">{mutationErrorMessage(commission.error)}</p> : null}<button type="button" className="primary-button" disabled={commission.isPending} onClick={execute}><WalletCards aria-hidden="true" />Confirm Earnings</button><button type="button" className="outline-button" onClick={() => props.navigation.replace("home")}>Back To Driver Home</button></section>
  </QueryState>;
}

function DestinationPanel(props: { readonly destination: PlatformRecord | null }) {
  return <section className="panel-card destination-panel"><MapPin aria-hidden="true" /><div><strong>{getFirstRecordString(props.destination, ["displayName", "label"]) ?? "Destination"}</strong><p>{getFirstRecordString(props.destination, ["formattedAddress"]) ?? "Address unavailable"}</p></div></section>;
}

function EventTimeline(props: { readonly events: readonly PlatformRecord[] }) {
  return <section className="job-timeline"><h2>Job Timeline</h2>{props.events.map((event, index) => <div className="timeline-row" key={getRecordId(event) ?? String(index)}><span /><div><strong>{formatStatus(getFirstRecordString(event, ["eventType", "event_type"]))}</strong><p>{new Date(getFirstRecordString(event, ["createdAt", "created_at"]) ?? "").toLocaleString()}</p></div></div>)}</section>;
}

function formatCoordinate(record: PlatformRecord | null): string {
  const latitude = getFirstRecordNumber(record, ["latitude"]);
  const longitude = getFirstRecordNumber(record, ["longitude"]);
  return latitude === null || longitude === null ? "Coordinates unavailable" : `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}
