import { ClipboardList, QrCode } from "lucide-react";

import { useJobsQuery } from "@lpg/features/orders/api";
import { displayReference, getRecordId, getStatus } from "@lpg/shared/api/records";
import type { DriverRoute } from "../../navigation/driverRoutes";
import { PageHeading, PolishedEmpty } from "@lpg/shared/ui/lpgComponents";
import { QueryState } from "@lpg/shared/ui/QueryState";
import { OrderDetailsSkeleton } from "@lpg/shared/ui/ScreenSkeletons";
import type { DriverScreenProps } from "../../navigation/driverRoutes";

export function DriverScanScreen(props: DriverScreenProps) {
  const jobs = useJobsQuery("driver");
  const active = jobs.data?.[0] ?? null;
  const targetRoute = scanRouteForStatus(getStatus(active));

  return (
    <QueryState loading={jobs.isLoading} error={jobs.error} skeleton={<OrderDetailsSkeleton />}>
      <PageHeading title="Scan" subtitle="Pickup and delivery verification" icon={<QrCode />} />
      {active ? (
        <section className="scanner-card">
          <strong>{displayReference(active)}</strong>
          <div className="scan-frame"><QrCode aria-hidden="true" /><span /></div>
          <p>The backend validates the actor, order, cylinder, location, and workflow step.</p>
          <button type="button" className="primary-button" onClick={() => props.navigation.navigate(targetRoute, { jobId: getRecordId(active) ?? "" })}>
            Open Verification
          </button>
        </section>
      ) : <PolishedEmpty icon={<ClipboardList />} title="No active scan" message="A scan becomes available from an assigned job at the correct workflow step." />}
    </QueryState>
  );
}

function scanRouteForStatus(status: string): DriverRoute {
  if (["return_en_route", "delivery_verification_pending"].includes(status)) return "delivery-verification";
  if (["pickup_verified", "station_en_route", "station_verified", "refill_in_progress", "refill_confirmed", "station_settled"].includes(status)) return "station-handoff";
  return "pickup-verification";
}
