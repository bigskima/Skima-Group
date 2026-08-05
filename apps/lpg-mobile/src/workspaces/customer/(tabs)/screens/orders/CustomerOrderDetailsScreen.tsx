import { Building2, Truck } from "lucide-react";

import { useCylindersQuery } from "@lpg/features/cylinders/api";
import { useOrdersQuery } from "@lpg/features/orders/api";
import { useStationsQuery } from "@lpg/features/stations/api";
import {
  displayReference,
  findRecordById,
  formatStatus,
  getFirstRecordNumber,
  getRecordId,
  getStatus,
  lpgOrderSteps,
  orderProgressIndex,
  statusTone,
} from "@lpg/shared/api/records";
import { InfoTile, PageHeading, ProgressStepper, StatusChip, Timeline } from "@lpg/shared/ui/lpgComponents";
import { QueryState } from "@lpg/shared/ui/QueryState";
import { OrderDetailsSkeleton } from "@lpg/shared/ui/ScreenSkeletons";
import { cylinderForOrder, formatCylinderTitle, orderTimelineItems, stationForOrder } from "@lpg/shared/utilities/lpgFormat";
import type { CustomerScreenProps } from "../../navigation/customerRoutes";

export function CustomerOrderDetailsScreen(props: CustomerScreenProps) {
  const orders = useOrdersQuery();
  const cylinders = useCylindersQuery();
  const stations = useStationsQuery();
  const selected = findRecordById(orders.data ?? [], props.navigation.params.orderId) ?? orders.data?.[0] ?? null;
  const cylinder = cylinderForOrder(cylinders.data ?? [], selected);
  const station = stationForOrder(stations.data ?? [], selected);
  const status = getStatus(selected, "pending");

  return (
    <QueryState loading={orders.isLoading || cylinders.isLoading} error={orders.error ?? cylinders.error} skeleton={<OrderDetailsSkeleton />}>
      <PageHeading title={displayReference(selected, "Order details")} subtitle={formatStatus(status)} />
      {selected ? (
        <section className="order-detail-card">
          <StatusChip tone={statusTone(status)} label={formatStatus(status)} />
          <h2>{formatCylinderTitle(cylinder)}</h2>
          <p>{getFirstRecordNumber(selected, ["requested_kg", "requestedKg"]) ?? "Requested"} kg refill</p>
          <ProgressStepper steps={lpgOrderSteps} activeIndex={orderProgressIndex(status)} />
          <div className="driver-station-grid">
            <InfoTile icon={<Building2 />} title="Station" text={String(station?.display_name ?? "Assignment pending")} />
            <InfoTile icon={<Truck />} title="Driver" text={getRecordId(selected) ? String(selected.assignment_status ?? "Dispatch pending") : "Dispatch pending"} />
          </div>
          <Timeline items={orderTimelineItems(selected)} />
          <button type="button" className="primary-button" onClick={() => props.navigation.navigate("order-tracking", { orderId: getRecordId(selected) ?? "" })}>
            Open Tracking
          </button>
        </section>
      ) : null}
    </QueryState>
  );
}
