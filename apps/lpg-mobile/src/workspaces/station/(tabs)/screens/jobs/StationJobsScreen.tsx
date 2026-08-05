import { ClipboardList } from "lucide-react";

import { firstMediaAssetId, RuntimeMediaImage } from "@lpg/features/media/RuntimeMediaImage";
import { useStationRuntimeQuery } from "@lpg/features/stations/api";
import { displayReference, formatStatus, getFirstRecordNumber, getFirstRecordString, getRecordArray, getRecordId, getRecordObject, getStatus, recordKey, statusTone } from "@lpg/shared/api/records";
import { PageHeading, PolishedEmpty, StatusChip } from "@lpg/shared/ui/lpgComponents";
import { QueryState } from "@lpg/shared/ui/QueryState";
import { StationJobsSkeleton } from "@lpg/shared/ui/ScreenSkeletons";
import { displayMoney } from "@lpg/shared/utilities/display";
import type { StationScreenProps } from "../../navigation/stationRoutes";

export function StationJobsScreen(props: StationScreenProps) {
  const runtime = useStationRuntimeQuery();
  const jobs = getRecordArray(runtime.data, "orders");

  return (
    <QueryState loading={runtime.isLoading} error={runtime.error} onRetry={() => void runtime.refetch()} skeleton={<StationJobsSkeleton />}>
      <PageHeading title="Station Jobs" subtitle="Branch-scoped LPG refill work" />
      <div className="station-order-list">
        {jobs.map((job, index) => {
          const status = getStatus(job, "pending");
          const cylinder = getRecordObject(job, "cylinder");
          return (
            <article key={recordKey(job, `station-job-${index}`)} className="station-order-card">
              <StatusChip tone={statusTone(status)} label={formatStatus(status)} />
              <RuntimeMediaImage assetId={firstMediaAssetId(cylinder)} alt="Customer cylinder" />
              <div><h2>{displayReference(job)}</h2><p>{getFirstRecordNumber(job, ["requestedKg"]) ?? "Pending"} kg requested</p></div>
              <aside>
                <strong>{displayMoney(getFirstRecordNumber(job, ["stationAmount"]), getFirstRecordString(job, ["currencyCode"]))}</strong>
                <button type="button" className="primary-button" onClick={() => props.navigation.navigate("job-details", { jobId: getRecordId(job) ?? "" })}>View Job</button>
              </aside>
            </article>
          );
        })}
        {jobs.length === 0 ? <PolishedEmpty icon={<ClipboardList />} title="No station jobs" message="Paid and dispatched branch work will appear here." /> : null}
      </div>
    </QueryState>
  );
}
