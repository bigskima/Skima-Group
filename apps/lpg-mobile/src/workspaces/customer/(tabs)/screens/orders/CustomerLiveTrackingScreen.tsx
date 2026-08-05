import { Clock3, MapPin, Navigation, Radio } from "lucide-react";

import { useOrdersQuery } from "@lpg/features/orders/api";
import { useTrackingPointsQuery } from "@lpg/features/tracking/api";
import {
  displayReference,
  findRecordById,
  formatStatus,
  getFirstRecordNumber,
  getFirstRecordString,
  getStatus,
  recordKey,
  statusTone,
} from "@lpg/shared/api/records";
import { PolishedEmpty, StatusChip } from "@lpg/shared/ui/lpgComponents";
import { QueryState } from "@lpg/shared/ui/QueryState";
import { OrderDetailsSkeleton } from "@lpg/shared/ui/ScreenSkeletons";
import { RecordField, WorkflowHeader } from "@lpg/shared/ui/WorkflowScreen";
import { formatTimeValue } from "@lpg/shared/utilities/lpgFormat";
import type { CustomerScreenProps } from "../../navigation/customerRoutes";

export function CustomerLiveTrackingScreen(props: CustomerScreenProps) {
  const orders = useOrdersQuery();
  const order = findRecordById(orders.data ?? [], props.navigation.params.orderId) ?? null;
  const trackingSessionId = getFirstRecordString(order, ["tracking_session_id", "trackingSessionId"]);
  const points = useTrackingPointsQuery(trackingSessionId);
  const latest = points.data?.[0] ?? null;
  const status = getStatus(order, "pending");

  return (
    <QueryState loading={orders.isLoading || points.isLoading} error={orders.error ?? points.error} skeleton={<OrderDetailsSkeleton />}>
      <WorkflowHeader title="Live Tracking" subtitle={displayReference(order)} onBack={props.navigation.goBack} />
      {order ? (
        <>
          <section className="tracking-live-panel">
            <div><Radio aria-hidden="true" /><span>Order status</span><StatusChip tone={statusTone(status)} label={formatStatus(status)} /></div>
            {latest ? (
              <div className="tracking-coordinate-grid">
                <RecordField label="Latitude" value={getFirstRecordNumber(latest, ["latitude"])?.toFixed(6) ?? "Unavailable"} />
                <RecordField label="Longitude" value={getFirstRecordNumber(latest, ["longitude"])?.toFixed(6) ?? "Unavailable"} />
                <RecordField label="Accuracy" value={formatMeters(getFirstRecordNumber(latest, ["accuracy_meters", "accuracyMeters"]))} />
                <RecordField label="Updated" value={formatTimeValue(getFirstRecordString(latest, ["recorded_at", "recordedAt"]))} />
              </div>
            ) : <PolishedEmpty icon={<Navigation />} title="Waiting for live location" message="Tracking begins after the assigned driver accepts the order." />}
          </section>
          <section className="record-list-section">
            <h2>Location Updates</h2>
            {(points.data ?? []).slice(0, 20).map((point, index) => (
              <article className="timeline-row" key={recordKey(point, `tracking-point-${index}`)}>
                <span><MapPin aria-hidden="true" /></span>
                <div><strong>{formatMeters(getFirstRecordNumber(point, ["accuracy_meters", "accuracyMeters"]))} accuracy</strong><small>{formatTimeValue(getFirstRecordString(point, ["recorded_at", "recordedAt"]))}</small></div>
              </article>
            ))}
          </section>
          {status.includes("delivery") || status.includes("return") ? <button type="button" className="primary-button" onClick={() => props.navigation.navigate("delivery-verification", { orderId: props.navigation.params.orderId ?? "" })}><Clock3 aria-hidden="true" />Delivery Verification</button> : null}
        </>
      ) : <PolishedEmpty icon={<MapPin />} title="Order unavailable" message="This order is not available to the current account." />}
    </QueryState>
  );
}

function formatMeters(value: number | null): string {
  return value === null ? "Unavailable" : `${Math.round(value)} m`;
}
