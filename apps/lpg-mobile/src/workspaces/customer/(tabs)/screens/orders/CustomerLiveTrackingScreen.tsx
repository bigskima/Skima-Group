import { Clock3, Compass, ExternalLink, Gauge, MapPin, Navigation, Radio, RefreshCw } from "lucide-react";

import { useOrdersQuery } from "@lpg/features/orders/api";
import { useTrackingPointsQuery } from "@lpg/features/tracking/api";
import {
  buildTrackingSummary,
  formatTrackingDistance,
  formatTrackingSpeed,
  mapsDirectionsUrl,
  type TrackingCoordinate,
} from "@lpg/features/tracking/trackingPresentation";
import {
  displayReference,
  findRecordById,
  formatStatus,
  getFirstRecordString,
  getStatus,
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
  const tracking = buildTrackingSummary(points.data ?? []);
  const latest = tracking.latest;
  const status = getStatus(order, "pending");
  const directionsUrl = mapsDirectionsUrl(latest);

  return (
    <QueryState loading={orders.isLoading || points.isLoading} error={orders.error ?? points.error} skeleton={<OrderDetailsSkeleton />}>
      <WorkflowHeader title="Live Tracking" subtitle={displayReference(order)} onBack={props.navigation.goBack} />
      {order ? (
        <>
          <section className="tracking-live-panel">
            <div className="tracking-status-row">
              <Radio aria-hidden="true" />
              <span>Order status</span>
              <StatusChip tone={statusTone(status)} label={formatStatus(status)} />
              <button type="button" className="icon-refresh-button" onClick={() => void points.refetch()} aria-label="Refresh live tracking">
                <RefreshCw aria-hidden="true" />
              </button>
            </div>
            {latest ? (
              <>
                <LiveTrackingMap latest={latest} points={tracking.points} isFresh={tracking.isFresh} />
                <div className="tracking-coordinate-grid">
                  <RecordField label="Latitude" value={latest.latitude.toFixed(6)} />
                  <RecordField label="Longitude" value={latest.longitude.toFixed(6)} />
                  <RecordField label="Accuracy" value={formatMeters(latest.accuracyMeters)} />
                  <RecordField label="Updated" value={formatTimeValue(latest.recordedAt)} />
                </div>
                <div className="tracking-insight-grid">
                  <article><Navigation aria-hidden="true" /><span>Route travelled</span><strong>{formatTrackingDistance(tracking.distanceMeters)}</strong></article>
                  <article><Gauge aria-hidden="true" /><span>Driver speed</span><strong>{formatTrackingSpeed(latest.speedMetersPerSecond)}</strong></article>
                  <article><Clock3 aria-hidden="true" /><span>Signal freshness</span><strong>{tracking.isFresh ? "Live now" : staleLabel(tracking.staleMinutes)}</strong></article>
                  <article><Compass aria-hidden="true" /><span>Heading</span><strong>{latest.headingDegrees === null ? "Unavailable" : `${Math.round(latest.headingDegrees)}°`}</strong></article>
                </div>
                {directionsUrl ? (
                  <a className="secondary-button tracking-map-link" href={directionsUrl} target="_blank" rel="noreferrer">
                    <ExternalLink aria-hidden="true" />Open Current Position In Maps
                  </a>
                ) : null}
              </>
            ) : <PolishedEmpty icon={<Navigation />} title="Waiting for live location" message="Tracking begins after the assigned driver accepts the order." />}
          </section>
          <section className="record-list-section">
            <h2>Location Updates</h2>
            {tracking.points.slice(0, 20).map((point, index) => (
              <article className="timeline-row" key={`${point.recordedAt ?? "tracking-point"}-${index}`}>
                <span><MapPin aria-hidden="true" /></span>
                <div>
                  <strong>{formatMeters(point.accuracyMeters)} accuracy</strong>
                  <small>{formatTimeValue(point.recordedAt)} · {point.latitude.toFixed(5)}, {point.longitude.toFixed(5)}</small>
                </div>
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

function staleLabel(minutes: number | null): string {
  if (minutes === null) return "No timestamp";
  if (minutes < 1) return "Less than 1 min old";
  if (minutes === 1) return "1 min old";
  return `${minutes} min old`;
}

function LiveTrackingMap(props: {
  readonly isFresh: boolean;
  readonly latest: TrackingCoordinate;
  readonly points: readonly TrackingCoordinate[];
}) {
  const routePoints = props.points.slice(0, 6);

  return (
    <div className={`live-tracking-map ${props.isFresh ? "is-live" : "is-stale"}`} aria-label="Backend live tracking map preview">
      <span className="live-tracking-map__grid" />
      <span className="live-tracking-map__route" />
      {routePoints.map((point, index) => (
        <i
          key={`${point.recordedAt ?? "point"}-${index}`}
          className={`live-tracking-map__point ${index === 0 ? "is-latest" : ""}`}
          style={{
            left: `${18 + Math.min(index, 5) * 12}%`,
            top: `${62 - Math.min(index, 5) * 8}%`,
          }}
          title={`${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`}
        />
      ))}
      <b className="live-tracking-map__driver">
        <Navigation aria-hidden="true" />
      </b>
      <div>
        <strong>{props.isFresh ? "Live driver signal" : "Last known driver signal"}</strong>
        <span>{props.latest.latitude.toFixed(5)}, {props.latest.longitude.toFixed(5)}</span>
      </div>
    </div>
  );
}
