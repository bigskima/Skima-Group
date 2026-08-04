import { ClipboardList, ImageOff, MapPin } from "lucide-react";

import { useCurrenciesQuery } from "@lpg/features/config/api";
import { useJobsQuery } from "@lpg/features/orders/api";
import { displayReference, formatStatus, getFirstRecordNumber, getRecordId, getStatus, recordKey, statusTone } from "@lpg/shared/api/records";
import { PageHeading, PolishedEmpty, StatusChip } from "@lpg/shared/ui/lpgComponents";
import { QueryState } from "@lpg/shared/ui/QueryState";
import { displayMoney, resolveCurrencyCode } from "@lpg/shared/utilities/display";
import type { DriverScreenProps } from "../../navigation/driverRoutes";

export function DriverJobsScreen(props: DriverScreenProps) {
  const jobs = useJobsQuery("driver");
  const currencies = useCurrenciesQuery();

  return (
    <QueryState loading={jobs.isLoading} error={jobs.error} onRetry={() => void jobs.refetch()}>
      <PageHeading title="Jobs" subtitle="LPG work matched to your approved capability" />
      <div className="job-list">
        {(jobs.data ?? []).map((job, index) => {
          const status = getStatus(job, "pending");
          const currencyCode = resolveCurrencyCode(currencies.data ?? [], job);
          return (
            <article key={recordKey(job, `driver-job-${index}`)} className="job-card">
              <span className="runtime-media-placeholder" aria-label="Cylinder image unavailable">
                <ImageOff aria-hidden="true" />
              </span>
              <div>
                <h2>{getFirstRecordNumber(job, ["requestedKg", "requested_kg"]) ?? "LPG"} kg refill</h2>
                <p><MapPin aria-hidden="true" /> {displayReference(job)}</p>
                <StatusChip tone={statusTone(status)} label={formatStatus(status)} />
              </div>
              <aside>
                <strong>{displayMoney(getFirstRecordNumber(job, ["driver_commission_amount"]), currencyCode)}</strong>
                <button type="button" className="primary-button" onClick={() => props.navigation.navigate("job-details", { jobId: getRecordId(job) ?? "" })}>
                  View Job
                </button>
              </aside>
            </article>
          );
        })}
        {(jobs.data ?? []).length === 0 ? <PolishedEmpty icon={<ClipboardList />} title="No jobs available" message="Qualified offers will appear here when dispatch matches your approved profile." /> : null}
      </div>
    </QueryState>
  );
}
