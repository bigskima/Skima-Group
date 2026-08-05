import { MapPin, QrCode, Truck, UserRound } from "lucide-react";

import { firstMediaAssetId, RuntimeMediaImage } from "@lpg/features/media/RuntimeMediaImage";
import { useJobDetailsQuery } from "@lpg/features/orders/api";
import { displayReference, formatStatus, getFirstRecordNumber, getFirstRecordString, getRecordArray, getRecordObject, getStatus, statusTone } from "@lpg/shared/api/records";
import { InfoTile, PolishedEmpty, StatusChip } from "@lpg/shared/ui/lpgComponents";
import { QueryState } from "@lpg/shared/ui/QueryState";
import { OrderDetailsSkeleton } from "@lpg/shared/ui/ScreenSkeletons";
import { WorkflowHeader } from "@lpg/shared/ui/WorkflowScreen";
import type { StationScreenProps } from "../../navigation/stationRoutes";
import { stationNextRoute, StationJobTimeline } from "./StationWorkflowScreens";

export function StationJobDetailsScreen(props: StationScreenProps) {
  const orderId = props.navigation.params.jobId ?? null;
  const detail = useJobDetailsQuery(orderId);
  const order = getRecordObject(detail.data, "order");
  const cylinder = getRecordObject(detail.data, "cylinder");
  const driver = getRecordObject(detail.data, "driver");
  const vehicle = getRecordObject(detail.data, "vehicle");
  const customer = getRecordObject(detail.data, "customer");
  const status = getStatus(order, "pending");

  return (
    <QueryState loading={detail.isLoading} error={detail.error} skeleton={<OrderDetailsSkeleton />}>
      <WorkflowHeader title={displayReference(order, "Station Job")} subtitle={formatStatus(status)} onBack={props.navigation.goBack} />
      {order ? (
        <section className="order-detail-card">
          <StatusChip tone={statusTone(status)} label={formatStatus(status)} />
          <div className="station-cylinder-identity"><RuntimeMediaImage assetId={firstMediaAssetId(cylinder)} alt="Customer cylinder" /><div><h2>{getFirstRecordNumber(cylinder, ["sizeKg"]) ?? "Configured"} kg cylinder</h2><p>{displayReference(cylinder, "Cylinder reference pending")}</p></div></div>
          <div className="arrival-grid">
            <InfoTile icon={<QrCode />} title="Requested" text={`${getFirstRecordNumber(order, ["requestedKg"]) ?? "Pending"} kg`} />
            <InfoTile icon={<Truck />} title="Driver" text={getFirstRecordString(driver, ["displayName"]) ?? "Pending"} />
            <InfoTile icon={<UserRound />} title="Customer" text={getFirstRecordString(customer, ["displayName"]) ?? "Verified customer"} />
            <InfoTile icon={<MapPin />} title="Vehicle" text={getFirstRecordString(vehicle, ["typeName"]) ?? "Pending"} />
          </div>
          <StationJobTimeline events={getRecordArray(detail.data, "events")} />
          <button type="button" className="primary-button" onClick={() => props.navigation.navigate(stationNextRoute(status), { jobId: orderId ?? "" })}>Continue Job</button>
        </section>
      ) : <PolishedEmpty icon={<QrCode />} title="Job unavailable" message="No branch-scoped LPG job was returned." />}
    </QueryState>
  );
}
