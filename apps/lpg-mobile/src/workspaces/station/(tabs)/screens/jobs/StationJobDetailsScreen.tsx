import { MapPin, QrCode, Truck } from "lucide-react";

import { useJobsQuery } from "@lpg/features/orders/api";
import { displayReference, findRecordById, formatStatus, getFirstRecordNumber, getStatus, statusTone } from "@lpg/shared/api/records";
import { InfoTile, PageHeading, StatusChip } from "@lpg/shared/ui/lpgComponents";
import { QueryState } from "@lpg/shared/ui/QueryState";
import type { StationScreenProps } from "../../navigation/stationRoutes";

export function StationJobDetailsScreen(props: StationScreenProps) {
  const jobs = useJobsQuery("station");
  const job = findRecordById(jobs.data ?? [], props.navigation.params.jobId) ?? jobs.data?.[0] ?? null;
  const status = getStatus(job, "pending");

  return (
    <QueryState loading={jobs.isLoading} error={jobs.error}>
      <PageHeading title={displayReference(job, "Station Job")} subtitle={formatStatus(status)} />
      {job ? (
        <section className="order-detail-card">
          <StatusChip tone={statusTone(status)} label={formatStatus(status)} />
          <div className="arrival-grid">
            <InfoTile icon={<QrCode />} title="Requested" text={`${getFirstRecordNumber(job, ["requestedKg", "requested_kg"]) ?? "Pending"} kg`} />
            <InfoTile icon={<Truck />} title="Driver" text={job.driverProfileId ? "Assigned" : "Pending"} />
            <InfoTile icon={<MapPin />} title="Branch" text={job.stationBranchId ? "Matched" : "Pending"} />
          </div>
          <button type="button" className="primary-button" onClick={() => props.navigation.navigate("driver-arrival", { jobId: props.navigation.params.jobId ?? "" })}>Open Arrival</button>
        </section>
      ) : null}
    </QueryState>
  );
}
