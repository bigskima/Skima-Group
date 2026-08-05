import { CalendarDays, ImagePlus, QrCode, ShieldCheck } from "lucide-react";

import { useCylinderHistoryQuery, useCylindersQuery } from "@lpg/features/cylinders/api";
import { firstMediaAssetId, RuntimeMediaImage } from "@lpg/features/media/RuntimeMediaImage";
import {
  displayReference,
  findRecordById,
  formatStatus,
  getFirstRecordNumber,
  getFirstRecordString,
  getRecordId,
  getStatus,
  recordKey,
  statusTone,
} from "@lpg/shared/api/records";
import { PolishedEmpty, StatusChip } from "@lpg/shared/ui/lpgComponents";
import { QueryState } from "@lpg/shared/ui/QueryState";
import { CylinderDetailsSkeleton } from "@lpg/shared/ui/ScreenSkeletons";
import { RecordField, WorkflowHeader } from "@lpg/shared/ui/WorkflowScreen";
import { formatDate, formatDateValue } from "@lpg/shared/utilities/lpgFormat";
import type { CustomerScreenProps } from "../../navigation/customerRoutes";

export function CylinderDetailsScreen(props: CustomerScreenProps) {
  const cylinders = useCylindersQuery();
  const selected = findRecordById(cylinders.data ?? [], props.navigation.params.cylinderId) ?? null;
  const history = useCylinderHistoryQuery(getRecordId(selected));

  return (
    <QueryState loading={cylinders.isLoading || history.isLoading} error={cylinders.error ?? history.error} skeleton={<CylinderDetailsSkeleton />}>
      <WorkflowHeader title="Cylinder Details" subtitle={displayReference(selected)} onBack={props.navigation.goBack} />
      {selected ? (
        <>
          <section className="asset-detail">
            <RuntimeMediaImage alt="Registered LPG cylinder" assetId={firstMediaAssetId(selected)} />
            <div>
              <StatusChip tone={statusTone(getStatus(selected))} label={formatStatus(getStatus(selected))} />
              <h2>{getFirstRecordNumber(selected, ["size_kg", "sizeKg"]) ?? "Configured"} kg cylinder</h2>
              <p>{getFirstRecordString(selected, ["cylinder_identifier", "cylinderIdentifier"]) ?? "Identifier unavailable"}</p>
            </div>
          </section>
          <section className="panel-card">
            <RecordField label="Brand" value={getFirstRecordString(selected, ["brand", "manufacturer"]) ?? "Not recorded"} />
            <RecordField label="Colour" value={getFirstRecordString(selected, ["colour", "color"]) ?? "Not recorded"} />
            <RecordField label="Serial number" value={getFirstRecordString(selected, ["serial_number", "serialNumber"]) ?? "Not recorded"} />
            <RecordField label="Condition" value={formatStatus(getFirstRecordString(selected, ["condition_status", "conditionStatus"]))} />
            <RecordField label="Last inspection" value={formatDate(selected, "last_inspection_at")} />
            <RecordField label="Next inspection" value={formatDate(selected, "next_inspection_at")} />
          </section>
          <button type="button" className="outline-button" onClick={() => props.navigation.navigate("cylinder-photo", { cylinderId: getRecordId(selected) ?? "" })}>
            <ImagePlus aria-hidden="true" /> Add Cylinder Photo
          </button>
          <section className="record-list-section">
            <h2>Verified History</h2>
            {(history.data ?? []).map((event, index) => (
              <article key={recordKey(event, `cylinder-history-${index}`)} className="timeline-row">
                <span><CalendarDays aria-hidden="true" /></span>
                <div>
                  <strong>{formatStatus(getFirstRecordString(event, ["event_type", "eventType"]))}</strong>
                  <small>{formatDateValue(getFirstRecordString(event, ["created_at", "createdAt"]) ?? "")}</small>
                </div>
              </article>
            ))}
            {(history.data ?? []).length === 0 ? <PolishedEmpty icon={<ShieldCheck />} title="No history recorded" message="Verified refill and inspection events will appear here." /> : null}
          </section>
        </>
      ) : <PolishedEmpty icon={<QrCode />} title="Cylinder unavailable" message="This cylinder is not available to the current account." />}
    </QueryState>
  );
}
