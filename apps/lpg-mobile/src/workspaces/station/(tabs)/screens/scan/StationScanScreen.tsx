import { ClipboardList, QrCode } from "lucide-react";

import { useJobsQuery } from "@lpg/features/orders/api";
import { displayReference, formatStatus, getRecordId, getStatus, statusTone } from "@lpg/shared/api/records";
import { PageHeading, PolishedEmpty, StatusChip } from "@lpg/shared/ui/lpgComponents";
import { QueryState } from "@lpg/shared/ui/QueryState";
import { OrderDetailsSkeleton } from "@lpg/shared/ui/ScreenSkeletons";
import type { StationScreenProps } from "../../navigation/stationRoutes";

export function StationScanScreen(props: StationScreenProps) {
  const jobs = useJobsQuery("station");
  const active = jobs.data?.find((job) => ["pickup_verified", "station_en_route", "refill_confirmed", "station_settled"].includes(getStatus(job))) ?? null;

  return (
    <QueryState loading={jobs.isLoading} error={jobs.error} skeleton={<OrderDetailsSkeleton />}>
      <PageHeading title="Scan Cylinder" subtitle="Branch-scoped verification" icon={<QrCode />} />
      {active ? (
        <section className="scanner-card">
          <strong>{displayReference(active)}</strong>
          <StatusChip tone={statusTone(getStatus(active))} label={formatStatus(getStatus(active))} />
          <div className="scan-frame"><QrCode aria-hidden="true" /><span /></div>
          <p>{["refill_confirmed", "station_settled"].includes(getStatus(active)) ? "Verify the cylinder before releasing it to the assigned driver." : "Verify the arriving cylinder before inspection and refill."}</p>
          <button type="button" className="primary-button" onClick={() => props.navigation.navigate("scan-result", { jobId: getRecordId(active) ?? "" })}>Start Scan</button>
        </section>
      ) : <PolishedEmpty icon={<ClipboardList />} title="No cylinder waiting" message="The current branch job appears here when its station scan is ready." />}
    </QueryState>
  );
}
