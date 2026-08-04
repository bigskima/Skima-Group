import { ClipboardList, ImageOff } from "lucide-react";

import { useCurrenciesQuery } from "@lpg/features/config/api";
import { useJobsQuery } from "@lpg/features/orders/api";
import { displayReference, formatStatus, getFirstRecordNumber, getRecordId, getStatus, recordKey, statusTone } from "@lpg/shared/api/records";
import { PageHeading, PolishedEmpty, StatusChip } from "@lpg/shared/ui/lpgComponents";
import { QueryState } from "@lpg/shared/ui/QueryState";
import { displayMoney, resolveCurrencyCode } from "@lpg/shared/utilities/display";
import type { StationScreenProps } from "../../navigation/stationRoutes";

export function StationJobsScreen(props: StationScreenProps) {
  const jobs = useJobsQuery("station");
  const currencies = useCurrenciesQuery();

  return (
    <QueryState loading={jobs.isLoading} error={jobs.error} onRetry={() => void jobs.refetch()}>
      <PageHeading title="Station Jobs" subtitle="Branch-scoped LPG refill work" />
      <div className="station-order-list">
        {(jobs.data ?? []).map((job, index) => {
          const status = getStatus(job, "pending");
          return (
            <article key={recordKey(job, `station-job-${index}`)} className="station-order-card">
              <StatusChip tone={statusTone(status)} label={formatStatus(status)} />
              <span className="runtime-media-placeholder" aria-label="Cylinder image unavailable">
                <ImageOff aria-hidden="true" />
              </span>
              <div><h2>{displayReference(job)}</h2><p>{getFirstRecordNumber(job, ["requestedKg", "requested_kg"]) ?? "Pending"} kg requested</p></div>
              <aside>
                <strong>{displayMoney(getFirstRecordNumber(job, ["station_amount", "total_amount"]), resolveCurrencyCode(currencies.data ?? [], job))}</strong>
                <button type="button" className="primary-button" onClick={() => props.navigation.navigate("job-details", { jobId: getRecordId(job) ?? "" })}>View Job</button>
              </aside>
            </article>
          );
        })}
        {(jobs.data ?? []).length === 0 ? <PolishedEmpty icon={<ClipboardList />} title="No station jobs" message="Paid and dispatched branch work will appear here." /> : null}
      </div>
    </QueryState>
  );
}
