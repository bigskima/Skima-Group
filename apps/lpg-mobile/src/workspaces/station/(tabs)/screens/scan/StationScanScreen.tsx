import { ClipboardList, QrCode } from "lucide-react";

import { useJobsQuery } from "@lpg/features/orders/api";
import { displayReference, getRecordId } from "@lpg/shared/api/records";
import { PageHeading, PolishedEmpty } from "@lpg/shared/ui/lpgComponents";
import { QueryState } from "@lpg/shared/ui/QueryState";
import type { StationScreenProps } from "../../navigation/stationRoutes";

export function StationScanScreen(props: StationScreenProps) {
  const jobs = useJobsQuery("station");
  const active = jobs.data?.[0] ?? null;

  return (
    <QueryState loading={jobs.isLoading} error={jobs.error}>
      <PageHeading title="Scan Cylinder" subtitle="Branch-scoped verification" icon={<QrCode />} />
      {active ? (
        <section className="scanner-card">
          <strong>{displayReference(active)}</strong>
          <div className="scan-frame"><QrCode aria-hidden="true" /><span /></div>
          <p>Scanning is enabled only for the configured workflow step and authorised station role.</p>
          <button type="button" className="primary-button" onClick={() => props.navigation.navigate("scan-result", { jobId: getRecordId(active) ?? "" })}>Start Scan</button>
        </section>
      ) : <PolishedEmpty icon={<ClipboardList />} title="No cylinder waiting" message="The current branch job appears here when its station scan is ready." />}
    </QueryState>
  );
}
