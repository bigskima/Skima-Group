import { MapPin, QrCode, Truck } from "lucide-react";

import { useJobsQuery } from "@lpg/features/orders/api";
import { displayReference, findRecordById, formatStatus, getFirstRecordNumber, getStatus, statusTone } from "@lpg/shared/api/records";
import { InfoTile, PageHeading, StatusChip } from "@lpg/shared/ui/lpgComponents";
import { QueryState } from "@lpg/shared/ui/QueryState";
import type { DriverScreenProps } from "../../navigation/driverRoutes";

export function DriverJobDetailsScreen(props: DriverScreenProps) {
  const jobs = useJobsQuery("driver");
  const job = findRecordById(jobs.data ?? [], props.navigation.params.jobId) ?? jobs.data?.[0] ?? null;
  const status = getStatus(job, "pending");

  return (
    <QueryState loading={jobs.isLoading} error={jobs.error}>
      <PageHeading title={displayReference(job, "Job Details")} subtitle={formatStatus(status)} />
      {job ? (
        <section className="order-detail-card">
          <StatusChip tone={statusTone(status)} label={formatStatus(status)} />
          <div className="arrival-grid">
            <InfoTile icon={<QrCode />} title="Requested" text={`${getFirstRecordNumber(job, ["requestedKg", "requested_kg"]) ?? "Pending"} kg`} />
            <InfoTile icon={<MapPin />} title="Station" text={job.stationBranchId ? "Assigned" : "Pending"} />
            <InfoTile icon={<Truck />} title="Assignment" text={formatStatus(String(job.assignmentStatus ?? "pending"))} />
          </div>
          <button type="button" className="primary-button" onClick={() => props.navigation.navigate("customer-route", { jobId: props.navigation.params.jobId ?? "" })}>
            Continue Job
          </button>
        </section>
      ) : null}
    </QueryState>
  );
}
