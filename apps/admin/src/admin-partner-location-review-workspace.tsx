import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, MapPinned, RefreshCcw, ShieldCheck, XCircle } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { z } from "zod";

import { createClientIdempotencyKey, normalizeStatusLabel } from "@skima/frontend-core";
import {
  Button,
  DataTable,
  DetailList,
  Dialog,
  ErrorState,
  LoadingState,
  MetricTile,
  PageHeader,
  StatusBadge,
  TextAreaInput,
  type TableColumn,
} from "@skima/ui";

import { useSessionState } from "./session";

const ServiceAreaSchema = z.object({
  areaId: z.string().uuid(),
  displayName: z.string(),
  areaType: z.string(),
  isPrimary: z.boolean(),
  stateName: z.string().nullable().optional(),
  lgaName: z.string().nullable().optional(),
  cityName: z.string().nullable().optional(),
  townName: z.string().nullable().optional(),
  localityName: z.string().nullable().optional(),
});

const LocationReviewSchema = z.object({
  application_id: z.string().uuid(),
  application_version_id: z.string().uuid(),
  application_type_key: z.string(),
  workspace: z.enum(["driver", "station"]),
  applicant_user_id: z.string().uuid(),
  applicant_display_name: z.string().nullable(),
  application_status: z.string(),
  operational_status: z.string(),
  location_purpose: z.string().nullable(),
  formatted_address: z.string().nullable(),
  latitude: z.coerce.number().nullable(),
  longitude: z.coerce.number().nullable(),
  accuracy_meters: z.coerce.number().nullable(),
  provider_source: z.string().nullable(),
  provider_place_id: z.string().nullable(),
  recorded_at: z.string().nullable(),
  verification_status: z.enum(["pending", "verified", "rejected"]).nullable(),
  reviewer_user_id: z.string().uuid().nullable(),
  reviewed_at: z.string().nullable(),
  review_reason: z.string().nullable(),
  service_areas: z.array(ServiceAreaSchema),
  submitted_at: z.string().nullable(),
  updated_at: z.string(),
});

const LocationReviewsSchema = z.array(LocationReviewSchema);
type LocationReview = z.infer<typeof LocationReviewSchema>;
type LocationDecision = "verified" | "rejected";

export function AdminPartnerLocationReviewWorkspace() {
  const { supabase, status } = useSessionState();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialogDecision, setDialogDecision] = useState<LocationDecision | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reviewsQuery = useQuery({
    queryKey: ["partner-location-reviews"],
    enabled: status === "authenticated",
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_partner_application_location_reviews");
      if (error) throw error;
      return LocationReviewsSchema.parse(data ?? []);
    },
  });

  const records = reviewsQuery.data ?? [];
  const selected = useMemo(
    () => records.find((record) => record.application_id === selectedId) ?? records[0] ?? null,
    [records, selectedId],
  );
  const pending = records.filter((record) => record.verification_status === "pending").length;
  const verified = records.filter((record) => record.verification_status === "verified").length;
  const rejected = records.filter((record) => record.verification_status === "rejected").length;
  const missingEvidence = records.filter((record) => !hasCoordinates(record)).length;

  const reviewMutation = useMutation({
    mutationFn: async ({
      record,
      decision,
      reason,
    }: {
      readonly record: LocationReview;
      readonly decision: LocationDecision;
      readonly reason: string;
    }) => {
      if (!record.location_purpose || !hasCoordinates(record)) {
        throw new Error("This application version does not contain detected location evidence.");
      }
      const { data, error } = await supabase.rpc("review_application_location", {
        target_application_id: record.application_id,
        target_application_version_id: record.application_version_id,
        target_decision: decision,
        target_reason: reason.trim() || null,
        target_idempotency_key: createClientIdempotencyKey(
          `admin.application-location.${decision}`,
          record.application_version_id,
        ),
        target_metadata: { sourceSurface: "partner_location_review" },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async (_data, variables) => {
      setDialogDecision(null);
      setNotice(
        variables.decision === "verified"
          ? "Location evidence verified for this application version."
          : "Location evidence rejected. The application cannot be approved until corrected and re-verified.",
      );
      await queryClient.invalidateQueries({ queryKey: ["partner-location-reviews"] });
      await queryClient.invalidateQueries({ queryKey: ["gateway", "applications"] });
    },
  });

  const columns = useMemo<TableColumn<LocationReview>[]>(() => [
    {
      key: "applicant",
      header: "Applicant",
      render: (record) => (
        <span>
          <strong>{record.applicant_display_name ?? "Applicant"}</strong>
          <br />
          <small>{record.workspace === "driver" ? "Driver application" : "Station application"}</small>
        </span>
      ),
    },
    {
      key: "address",
      header: "Detected location",
      render: (record) => record.formatted_address ?? (hasCoordinates(record) ? "GPS location captured" : "Not captured"),
    },
    {
      key: "accuracy",
      header: "GPS accuracy",
      render: (record) => formatAccuracy(record.accuracy_meters),
    },
    {
      key: "verification",
      header: "Verification",
      render: (record) => (
        <StatusBadge tone={verificationTone(record.verification_status)}>
          {record.verification_status ? normalizeStatusLabel(record.verification_status) : "Evidence missing"}
        </StatusBadge>
      ),
    },
    {
      key: "application",
      header: "Application",
      render: (record) => (
        <StatusBadge tone={applicationTone(record.application_status)}>
          {normalizeStatusLabel(record.application_status)}
        </StatusBadge>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (record) => (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setNotice(null);
            setSelectedId(record.application_id);
          }}
        >
          Review location
        </Button>
      ),
    },
  ], []);

  return (
    <>
      <PageHeader
        eyebrow="Partner approvals"
        title="Location Review"
        description="Verify the detected operating location submitted with a driver or station application before final approval. Each decision is tied to the exact application version reviewed."
        actions={
          <Button
            icon={RefreshCcw}
            variant="outline"
            onClick={() => {
              setNotice(null);
              void reviewsQuery.refetch();
            }}
          >
            Refresh locations
          </Button>
        }
      />

      {notice ? <StatusBadge tone="success" className="skima-status-note">{notice}</StatusBadge> : null}

      <section className="skima-grid skima-grid--compact">
        <MetricTile label="Waiting for review" value={pending} icon={MapPinned} tone={pending ? "warning" : "success"} />
        <MetricTile label="Verified locations" value={verified} icon={CheckCircle2} tone="success" />
        <MetricTile label="Rejected locations" value={rejected} icon={XCircle} tone={rejected ? "danger" : "neutral"} />
        <MetricTile label="Evidence missing" value={missingEvidence} icon={ShieldCheck} tone={missingEvidence ? "warning" : "success"} />
      </section>

      {reviewsQuery.isLoading ? <LoadingState label="Loading partner location evidence" /> : null}
      {reviewsQuery.error ? (
        <ErrorState
          title="Location reviews unavailable"
          message={readError(reviewsQuery.error)}
          onRetry={() => void reviewsQuery.refetch()}
        />
      ) : null}

      {!reviewsQuery.isLoading && !reviewsQuery.error ? (
        <section className="sk-panel">
          <div className="sk-panel__header">
            <div>
              <h2>Applications</h2>
              <p className="skima-muted">Open an application to compare its GPS evidence with the map before approving it.</p>
            </div>
            <StatusBadge>{records.length === 1 ? "1 application" : `${records.length} applications`}</StatusBadge>
          </div>
          <DataTable
            caption="Partner application location evidence"
            columns={columns}
            records={records}
            getRowKey={(record) => record.application_id}
            emptyTitle="No partner applications"
            emptyMessage="Driver and station applications will appear here when they are created."
          />
        </section>
      ) : null}

      {selected ? (
        <LocationEvidencePanel
          record={selected}
          isSubmitting={reviewMutation.isPending}
          onVerify={() => {
            reviewMutation.reset();
            setDialogDecision("verified");
          }}
          onReject={() => {
            reviewMutation.reset();
            setDialogDecision("rejected");
          }}
        />
      ) : null}

      <LocationDecisionDialog
        record={selected}
        decision={dialogDecision}
        error={reviewMutation.error}
        isSubmitting={reviewMutation.isPending}
        onClose={() => {
          if (!reviewMutation.isPending) {
            setDialogDecision(null);
            reviewMutation.reset();
          }
        }}
        onSubmit={(reason) => {
          if (selected && dialogDecision) {
            reviewMutation.mutate({ record: selected, decision: dialogDecision, reason });
          }
        }}
      />
    </>
  );
}

function LocationEvidencePanel(props: {
  readonly record: LocationReview;
  readonly isSubmitting: boolean;
  readonly onVerify: () => void;
  readonly onReject: () => void;
}) {
  const record = props.record;
  const canReview = hasCoordinates(record) && Boolean(record.location_purpose);

  return (
    <section className="sk-panel">
      <div className="sk-panel__header">
        <div>
          <p className="admin-section-kicker">Location evidence</p>
          <h2>{record.applicant_display_name ?? "Applicant"}</h2>
          <p className="skima-muted">
            {record.workspace === "driver" ? "Driver operating base" : "Station facility location"}
          </p>
        </div>
        <StatusBadge tone={verificationTone(record.verification_status)}>
          {record.verification_status ? normalizeStatusLabel(record.verification_status) : "Evidence missing"}
        </StatusBadge>
      </div>

      {hasCoordinates(record) ? (
        <div style={{ display: "grid", gap: 20, gridTemplateColumns: "minmax(0, 1.4fr) minmax(280px, 0.6fr)" }}>
          <div style={{ minWidth: 0 }}>
            <iframe
              title={`Map showing ${record.formatted_address ?? "submitted partner location"}`}
              src={openStreetMapEmbedUrl(record.latitude as number, record.longitude as number)}
              loading="lazy"
              referrerPolicy="no-referrer"
              style={{ width: "100%", minHeight: 360, border: 0, borderRadius: 16 }}
            />
            <p className="skima-muted" style={{ marginTop: 10 }}>
              Map preview uses the submitted GPS point. Final verification should also consider the address, GPS accuracy, submitted documents, and any visible station evidence where applicable.
            </p>
          </div>
          <div>
            <DetailList
              items={[
                { label: "Detected address", value: record.formatted_address ?? "Address not resolved" },
                { label: "Coordinates", value: `${record.latitude?.toFixed(6)}, ${record.longitude?.toFixed(6)}` },
                { label: "GPS accuracy", value: formatAccuracy(record.accuracy_meters) },
                { label: "Captured", value: formatDate(record.recorded_at) },
                { label: "Location source", value: locationSourceLabel(record.provider_source) },
                { label: "Application status", value: normalizeStatusLabel(record.application_status) },
                { label: "Last reviewed", value: formatDate(record.reviewed_at) },
                { label: "Review note", value: record.review_reason ?? "No review note" },
              ]}
            />
          </div>
        </div>
      ) : (
        <ErrorState
          title="Detected location missing"
          message="This application version does not contain GPS evidence yet. Ask the applicant to update the application before approval."
        />
      )}

      {record.workspace === "driver" ? (
        <section style={{ marginTop: 22 }}>
          <h3>Requested service areas</h3>
          <p className="skima-muted">A driver may cover several nearby areas. The primary area is marked separately.</p>
          <div className="skima-action-row" style={{ marginTop: 10 }}>
            {record.service_areas.length > 0 ? record.service_areas.map((area) => (
              <StatusBadge key={area.areaId} tone={area.isPrimary ? "info" : "neutral"}>
                {area.displayName}{area.isPrimary ? " · Primary" : ""}
              </StatusBadge>
            )) : <StatusBadge tone="warning">No service areas selected</StatusBadge>}
          </div>
        </section>
      ) : null}

      <div className="skima-action-row" style={{ marginTop: 22 }}>
        <Button
          icon={CheckCircle2}
          requiredPermission="platform.applications.review"
          disabled={!canReview || props.isSubmitting}
          onClick={props.onVerify}
        >
          Verify location
        </Button>
        <Button
          icon={XCircle}
          variant="destructive"
          requiredPermission="platform.applications.review"
          disabled={!canReview || props.isSubmitting}
          onClick={props.onReject}
        >
          Reject location
        </Button>
      </div>
    </section>
  );
}

function LocationDecisionDialog(props: {
  readonly record: LocationReview | null;
  readonly decision: LocationDecision | null;
  readonly error: unknown;
  readonly isSubmitting: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const open = Boolean(props.record && props.decision);
  if (!open || !props.record || !props.decision) return null;

  const rejecting = props.decision === "rejected";
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (rejecting && !reason.trim()) return;
    props.onSubmit(reason.trim());
  };

  return (
    <Dialog
      title={rejecting ? "Reject submitted location" : "Verify submitted location"}
      isOpen={open}
      onClose={props.onClose}
      footer={
        <>
          <Button variant="ghost" disabled={props.isSubmitting} onClick={props.onClose}>Cancel</Button>
          <Button
            type="submit"
            form="location-review-form"
            variant={rejecting ? "destructive" : "primary"}
            icon={rejecting ? XCircle : CheckCircle2}
            isLoading={props.isSubmitting}
            disabled={rejecting && !reason.trim()}
          >
            {rejecting ? "Reject location" : "Verify location"}
          </Button>
        </>
      }
    >
      <form id="location-review-form" className="skima-form-grid" onSubmit={submit}>
        <p className="admin-dialog-guidance">
          {rejecting
            ? "Explain what is wrong with the submitted location so the application can be corrected and re-verified."
            : "Confirm that you reviewed the submitted GPS point against the map and available application evidence."}
        </p>
        <TextAreaInput
          label={rejecting ? "Reason for rejection" : "Verification note (optional)"}
          value={reason}
          onChange={(event) => setReason(event.currentTarget.value)}
          required={rejecting}
        />
        {props.error ? <StatusBadge tone="danger">{readError(props.error)}</StatusBadge> : null}
      </form>
    </Dialog>
  );
}

function hasCoordinates(record: LocationReview): boolean {
  return typeof record.latitude === "number" && Number.isFinite(record.latitude) &&
    typeof record.longitude === "number" && Number.isFinite(record.longitude);
}

function openStreetMapEmbedUrl(latitude: number, longitude: number): string {
  const latitudeSpan = 0.008;
  const longitudeSpan = 0.01;
  const bbox = [
    longitude - longitudeSpan,
    latitude - latitudeSpan,
    longitude + longitudeSpan,
    latitude + latitudeSpan,
  ].join("%2C");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${latitude}%2C${longitude}`;
}

function formatAccuracy(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "Not reported";
  return `About ${Math.round(value)} m`;
}

function formatDate(value: string | null): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function locationSourceLabel(source: string | null): string {
  if (!source) return "Device location";
  if (source === "device_geocoder") return "Device GPS + address lookup";
  if (source === "device_coordinates") return "Device GPS";
  if (source === "maps_adapter") return "Map selection";
  if (source === "manual_pin") return "Map pin";
  return normalizeStatusLabel(source);
}

function verificationTone(status: LocationReview["verification_status"]): "neutral" | "success" | "warning" | "danger" {
  if (status === "verified") return "success";
  if (status === "rejected") return "danger";
  if (status === "pending") return "warning";
  return "neutral";
}

function applicationTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (["approved", "active"].includes(status)) return "success";
  if (["rejected", "suspended"].includes(status)) return "danger";
  if (["submitted", "under_review", "additional_info_required", "resubmitted"].includes(status)) return "warning";
  if (["draft", "incomplete"].includes(status)) return "info";
  return "neutral";
}

function readError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (typeof record.message === "string" && record.message.trim()) return record.message;
  }
  return "The location review action could not be completed. Please try again.";
}
