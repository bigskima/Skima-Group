import { MapPin, QrCode, Truck, WalletCards } from "lucide-react";

import { RuntimeMediaImage, firstMediaAssetId } from "@lpg/features/media/RuntimeMediaImage";
import { useJobDetailsQuery } from "@lpg/features/orders/api";
import { displayReference, formatStatus, getFirstRecordNumber, getFirstRecordString, getRecordObject, getStatus, statusTone } from "@lpg/shared/api/records";
import { mutationErrorMessage, useGatewayCommandMutation } from "@lpg/shared/api/useGatewayMutation";
import { InfoTile, PageHeading, StatusChip } from "@lpg/shared/ui/lpgComponents";
import { QueryState } from "@lpg/shared/ui/QueryState";
import { OrderDetailsSkeleton } from "@lpg/shared/ui/ScreenSkeletons";
import type { DriverScreenProps } from "../../navigation/driverRoutes";

export function DriverJobDetailsScreen(props: DriverScreenProps) {
  const orderId = props.navigation.params.jobId ?? null;
  const detail = useJobDetailsQuery(orderId);
  const order = getRecordObject(detail.data, "order");
  const cylinder = getRecordObject(detail.data, "cylinder");
  const pickup = getRecordObject(detail.data, "pickupLocation");
  const delivery = getRecordObject(detail.data, "deliveryLocation");
  const station = getRecordObject(detail.data, "station");
  const status = getStatus(order, "pending");
  const assignmentStatus = getFirstRecordString(order, ["assignmentStatus"]) ?? "pending";
  const accept = useGatewayCommandMutation({ onSuccess: () => detail.refetch().then(() => undefined) });
  const acceptJob = () => orderId && accept.mutate({ path: "/lpg/orders/accept-assignment", payload: { idempotencyKey: `frontend:lpg-driver-accept:${orderId}`, lpgOrderId: orderId } });

  return (
    <QueryState loading={detail.isLoading} error={detail.error} skeleton={<OrderDetailsSkeleton />}>
      <PageHeading title={displayReference(order, "Job Details")} subtitle={formatStatus(status)} />
      {order ? (
        <section className="order-detail-card">
          <StatusChip tone={statusTone(status)} label={formatStatus(status)} />
          <div className="job-cylinder-summary"><RuntimeMediaImage assetId={firstMediaAssetId(cylinder)} alt="Customer cylinder" /><div><strong>{getFirstRecordNumber(cylinder, ["sizeKg"]) ?? "Configured"} kg cylinder</strong><span>{displayReference(cylinder)}</span></div></div>
          <div className="arrival-grid">
            <InfoTile icon={<QrCode />} title="Requested" text={`${getFirstRecordNumber(order, ["requestedKg"]) ?? "Pending"} kg`} />
            <InfoTile icon={<MapPin />} title="Pickup" text={getFirstRecordString(pickup, ["formattedAddress"]) ?? "Pending"} />
            <InfoTile icon={<MapPin />} title="Delivery" text={getFirstRecordString(delivery, ["formattedAddress"]) ?? "Pending"} />
            <InfoTile icon={<Truck />} title="Station" text={getFirstRecordString(station, ["displayName"]) ?? "Pending"} />
            <InfoTile icon={<WalletCards />} title="Commission" text={`${getFirstRecordString(order, ["currencyCode"]) ?? ""} ${getFirstRecordNumber(order, ["driverCommissionAmount"]) ?? "Pending"}`} />
            <InfoTile icon={<Truck />} title="Assignment" text={formatStatus(assignmentStatus)} />
          </div>
          {accept.error ? <p className="form-message is-error">{mutationErrorMessage(accept.error)}</p> : null}
          {assignmentStatus === "offered" ? <button type="button" className="primary-button" disabled={accept.isPending} onClick={acceptJob}>Accept Job</button> : <button type="button" className="primary-button" onClick={() => props.navigation.navigate("customer-route", { jobId: orderId ?? "" })}>Continue Job</button>}
        </section>
      ) : null}
    </QueryState>
  );
}
