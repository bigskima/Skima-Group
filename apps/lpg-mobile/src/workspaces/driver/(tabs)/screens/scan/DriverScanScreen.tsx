import { ClipboardList, QrCode } from "lucide-react";

import { useJobsQuery } from "@lpg/features/orders/api";
import { displayReference, getRecordId } from "@lpg/shared/api/records";
import { PageHeading, PolishedEmpty } from "@lpg/shared/ui/lpgComponents";
import { QueryState } from "@lpg/shared/ui/QueryState";
import type { DriverScreenProps } from "../../navigation/driverRoutes";

export function DriverScanScreen(props: DriverScreenProps) {
  const jobs = useJobsQuery("driver");
  const active = jobs.data?.[0] ?? null;

  return (
    <QueryState loading={jobs.isLoading} error={jobs.error}>
      <PageHeading title="Scan" subtitle="Pickup and delivery verification" icon={<QrCode />} />
      {active ? (
        <section className="scanner-card">
          <strong>{displayReference(active)}</strong>
          <div className="scan-frame"><QrCode aria-hidden="true" /><span /></div>
          <p>The backend validates the actor, order, cylinder, location, and workflow step.</p>
          <button type="button" className="primary-button" onClick={() => props.navigation.navigate("pickup-verification", { jobId: getRecordId(active) ?? "" })}>
            Open Verification
          </button>
        </section>
      ) : <PolishedEmpty icon={<ClipboardList />} title="No active scan" message="A scan becomes available from an assigned job at the correct workflow step." />}
    </QueryState>
  );
}
