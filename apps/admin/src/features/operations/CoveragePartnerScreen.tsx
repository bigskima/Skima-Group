import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPinned, Plus, RefreshCcw, ShieldCheck, UsersRound } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { z } from "zod";

import {
  Button,
  DataTable,
  Dialog,
  ErrorState,
  LoadingState,
  MetricTile,
  SelectInput,
  StatusBadge,
  TextAreaInput,
  TextInput,
  type TableColumn,
} from "@skima/ui";

import { AdminGeometryEditor } from "../../admin-geometry-editor";
import { useSessionState } from "../../session";
import {
  AdminFormSection,
  AdminTaskFlow,
  AdminV2PageHeader,
  type AdminTaskFlowStep,
} from "../../shared/patterns/AdminV2Patterns";

const GeographySchema = z.object({
  id: z.string().uuid(),
  canonical_name: z.string(),
  status: z.string(),
});
const GeographySetupSchema = z.object({ geographies: z.array(GeographySchema) }).passthrough();
const DriverSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  public_driver_id: z.string().nullable().optional(),
  driver_display_name: z.string().nullable().optional(),
  operational_status: z.string().nullable().optional(),
  verification_status: z.string().nullable().optional(),
});
const StationSchema = z.object({
  stationBranchId: z.string().uuid(),
  stationName: z.string(),
  organizationName: z.string(),
  approvalStatus: z.string(),
  complianceStatus: z.string(),
}).passthrough();
const ProfileSchema = z.object({
  id: z.string().uuid(),
  display_name: z.string().nullable().optional(),
});
const CoverageRequestSchema = z.object({
  id: z.string().uuid(),
  application_id: z.string().uuid(),
  application_version_id: z.string().uuid(),
  applicant_user_id: z.string().uuid(),
  entity_type: z.enum(["DRIVER", "STATION"]),
  service_key: z.string(),
  coverage_type: z.enum(["ADMIN_GEOGRAPHY", "RADIUS", "CUSTOM_ZONE"]),
  status: z.enum(["REQUESTED", "APPROVED", "REJECTED", "WITHDRAWN"]),
  radius_meters: z.coerce.number().nullable(),
  center_longitude: z.coerce.number().nullable(),
  center_latitude: z.coerce.number().nullable(),
  geography_name: z.string().nullable(),
  location_verification_status: z.string().nullable(),
  formatted_address: z.string().nullable(),
  created_at: z.string(),
});
const OperationalCoverageSchema = z.object({
  id: z.string().uuid(),
  entity_type: z.string(),
  entity_id: z.string().uuid(),
  service_key: z.string(),
  coverage_type: z.enum(["ADMIN_GEOGRAPHY", "RADIUS", "CUSTOM_ZONE"]),
  geography_id: z.string().uuid().nullable(),
  geography_name: z.string().nullable(),
  center_longitude: z.coerce.number().nullable(),
  center_latitude: z.coerce.number().nullable(),
  radius_meters: z.coerce.number().nullable(),
  coverage_geojson: z.unknown().nullable(),
  status: z.enum(["requested", "approved", "active", "paused", "rejected", "expired", "retired"]),
  valid_from: z.string().nullable(),
  valid_to: z.string().nullable(),
  approved_at: z.string().nullable(),
  updated_at: z.string(),
});

type Geography = z.infer<typeof GeographySchema>;
type Driver = z.infer<typeof DriverSchema>;
type Station = z.infer<typeof StationSchema>;
type CoverageRequest = z.infer<typeof CoverageRequestSchema>;
type OperationalCoverage = z.infer<typeof OperationalCoverageSchema>;

interface CoverageForm {
  entityType: "DRIVER" | "STATION";
  entityId: string;
  serviceKey: string;
  coverageType: "ADMIN_GEOGRAPHY" | "RADIUS" | "CUSTOM_ZONE";
  geographyId: string;
  longitude: string;
  latitude: string;
  radius: string;
  geometry: string;
  status: "active" | "paused" | "retired";
  validFrom: string;
  validTo: string;
  reason: string;
}

const EMPTY_COVERAGE: CoverageForm = {
  entityType: "DRIVER",
  entityId: "",
  serviceKey: "lpg",
  coverageType: "ADMIN_GEOGRAPHY",
  geographyId: "",
  longitude: "",
  latitude: "",
  radius: "",
  geometry: "",
  status: "active",
  validFrom: "",
  validTo: "",
  reason: "",
};

const coverageSteps: readonly AdminTaskFlowStep[] = [
  { key: "partner", label: "Partner", description: "Choose driver or station" },
  { key: "area", label: "Operating area", description: "Mapped, radius or custom" },
  { key: "review", label: "Review", description: "Status, reason and save" },
];

export function CoveragePartnerScreen() {
  const { supabase, status } = useSessionState();
  const queryClient = useQueryClient();
  const enabled = status === "authenticated";
  const [editing, setEditing] = useState<OperationalCoverage | "new" | null>(null);
  const [review, setReview] = useState<{ request: CoverageRequest; decision: "APPROVED" | "REJECTED" } | null>(null);
  const [reviewReason, setReviewReason] = useState("");

  const geographies = useQuery({
    queryKey: ["coverage-v2", "partner-geographies"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_geography_admin_setup");
      if (error) throw error;
      return GeographySetupSchema.parse(data).geographies.filter((item) => item.status === "active");
    },
  });
  const assignments = useQuery({
    queryKey: ["coverage-v2", "partner-assignments"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_operational_coverage_admin", {
        p_entity_type: null,
        p_entity_id: null,
        p_service_key: null,
      });
      if (error) throw error;
      return z.array(OperationalCoverageSchema).parse(data ?? []);
    },
  });
  const requests = useQuery({
    queryKey: ["coverage-v2", "partner-requests"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_application_coverage_requests_admin", { p_status: "REQUESTED" });
      if (error) throw error;
      return z.array(CoverageRequestSchema).parse(data ?? []);
    },
  });
  const drivers = useQuery({
    queryKey: ["coverage-v2", "drivers"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("driver_profiles")
        .select("id,user_id,public_driver_id,driver_display_name,operational_status,verification_status")
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return z.array(DriverSchema).parse(data ?? []);
    },
  });
  const stations = useQuery({
    queryKey: ["coverage-v2", "stations"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_lpg_admin_station_pricing", { target_station_branch_id: null });
      if (error) throw error;
      return z.array(StationSchema).parse(data ?? []);
    },
  });

  const applicantIds = useMemo(
    () => [...new Set((requests.data ?? []).map((item) => item.applicant_user_id))],
    [requests.data],
  );
  const profiles = useQuery({
    queryKey: ["coverage-v2", "request-profiles", applicantIds.join(":")],
    enabled: enabled && applicantIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id,display_name").in("id", applicantIds);
      if (error) throw error;
      return z.array(ProfileSchema).parse(data ?? []);
    },
  });

  const profileNames = useMemo(
    () => new Map((profiles.data ?? []).map((profile) => [profile.id, profile.display_name ?? "Applicant"])),
    [profiles.data],
  );
  const driverNames = useMemo(
    () => new Map((drivers.data ?? []).map((driver) => [driver.id, driverLabel(driver)])),
    [drivers.data],
  );
  const stationNames = useMemo(
    () => new Map((stations.data ?? []).map((station) => [station.stationBranchId, stationLabel(station)])),
    [stations.data],
  );

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["coverage-v2"] });
    await Promise.all([
      geographies.refetch(),
      assignments.refetch(),
      requests.refetch(),
      drivers.refetch(),
      stations.refetch(),
      profiles.refetch(),
    ]);
  };

  const reviewMutation = useMutation({
    mutationFn: async () => {
      if (!review || !reviewReason.trim()) throw new Error("A review reason is required.");
      const { error } = await supabase.rpc("review_application_coverage_request", {
        p_request_id: review.request.id,
        p_decision: review.decision,
        p_reason: reviewReason.trim(),
        p_valid_from: null,
        p_valid_to: null,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setReview(null);
      setReviewReason("");
      await refresh();
    },
  });

  const assignmentColumns: TableColumn<OperationalCoverage>[] = [
    {
      key: "partner",
      header: "Partner",
      render: (item) => <><strong>{partnerName(item.entity_type, item.entity_id, driverNames, stationNames)}</strong><br /><small>{item.entity_type === "DRIVER" ? "Driver" : "Station"}</small></>,
    },
    { key: "coverage", header: "Operating area", render: coverageLabel },
    { key: "status", header: "Status", render: (item) => <StatusBadge tone={item.status === "active" ? "success" : "warning"}>{friendly(item.status)}</StatusBadge> },
    { key: "updated", header: "Updated", render: (item) => new Date(item.updated_at).toLocaleDateString() },
    { key: "action", header: "Action", render: (item) => <Button size="sm" variant="outline" onClick={() => setEditing(item)}>Edit</Button> },
  ];
  const requestColumns: TableColumn<CoverageRequest>[] = [
    {
      key: "applicant",
      header: "Applicant",
      render: (item) => <><strong>{profileNames.get(item.applicant_user_id) ?? `${friendly(item.entity_type)} applicant`}</strong><br /><small>{friendly(item.entity_type)}</small></>,
    },
    { key: "coverage", header: "Requested area", render: requestCoverageLabel },
    {
      key: "evidence",
      header: "Location check",
      render: (item) => <><StatusBadge tone={item.location_verification_status === "verified" ? "success" : "warning"}>{friendly(item.location_verification_status ?? "not reviewed")}</StatusBadge>{item.formatted_address ? <><br /><small>{item.formatted_address}</small></> : null}</>,
    },
    { key: "action", header: "Review", render: (item) => <div className="skima-action-row"><Button size="sm" onClick={() => setReview({ request: item, decision: "APPROVED" })}>Approve</Button><Button size="sm" variant="destructive" onClick={() => setReview({ request: item, decision: "REJECTED" })}>Reject</Button></div> },
  ];

  const blockingError = geographies.error ?? assignments.error ?? requests.error ?? drivers.error ?? stations.error;
  const loading = geographies.isLoading || assignments.isLoading || requests.isLoading || drivers.isLoading || stations.isLoading;
  if (loading) return <LoadingState label="Loading partner coverage" />;
  if (blockingError) return <ErrorState title="Partner coverage unavailable" message={readError(blockingError)} onRetry={() => void refresh()} />;

  return (
    <div className="coverage-v2__screen">
      <AdminV2PageHeader
        eyebrow="Service coverage · Partners"
        title="Partner operating areas"
        description="Review coverage requested during onboarding and manage where approved drivers and stations may operate. Internal IDs stay behind the interface."
        actions={<><Button icon={RefreshCcw} variant="outline" onClick={() => void refresh()}>Refresh</Button><Button icon={Plus} onClick={() => setEditing("new")}>Add operating area</Button></>}
      />

      <section className="skima-grid skima-grid--compact">
        <MetricTile label="Pending requests" value={requests.data?.length ?? 0} icon={MapPinned} tone={(requests.data?.length ?? 0) > 0 ? "warning" : "success"} />
        <MetricTile label="Active operating areas" value={(assignments.data ?? []).filter((item) => item.status === "active").length} icon={ShieldCheck} tone="success" />
        <MetricTile label="Known drivers" value={drivers.data?.length ?? 0} icon={UsersRound} />
        <MetricTile label="Known stations" value={stations.data?.length ?? 0} icon={UsersRound} />
      </section>

      <section className="sk-panel">
        <div className="sk-panel__header"><div><h2>Coverage requests</h2><p className="skima-muted">Application requests do not become dispatch eligibility until an authorized review approves them.</p></div><StatusBadge>{requests.data?.length ?? 0} pending</StatusBadge></div>
        <DataTable caption="Requested partner coverage" columns={requestColumns} records={requests.data ?? []} getRowKey={(item) => item.id} emptyTitle="No pending requests" emptyMessage="Submitted driver and station coverage requests will appear here." />
      </section>

      <section className="sk-panel">
        <div className="sk-panel__header"><div><h2>Approved operating areas</h2><p className="skima-muted">These assignments are the partner coverage records used by SKIMA operations and dispatch eligibility.</p></div></div>
        <DataTable caption="Approved driver and station operating areas" columns={assignmentColumns} records={assignments.data ?? []} getRowKey={(item) => item.id} emptyTitle="No operating areas yet" emptyMessage="Add an operating area or approve an onboarding coverage request." />
      </section>

      <PartnerCoverageDialog
        record={editing}
        geographies={geographies.data ?? []}
        drivers={drivers.data ?? []}
        stations={stations.data ?? []}
        onClose={() => setEditing(null)}
        onSaved={async () => { setEditing(null); await refresh(); }}
      />

      <Dialog
        isOpen={Boolean(review)}
        title={`${review?.decision === "APPROVED" ? "Approve" : "Reject"} requested coverage`}
        onClose={() => setReview(null)}
        footer={<><Button variant="ghost" onClick={() => setReview(null)}>Cancel</Button><Button variant={review?.decision === "REJECTED" ? "destructive" : "primary"} isLoading={reviewMutation.isPending} onClick={() => reviewMutation.mutate()}>Confirm decision</Button></>}
      >
        {review ? <div className="coverage-v2__review-grid"><div><small>Applicant</small><strong>{profileNames.get(review.request.applicant_user_id) ?? friendly(review.request.entity_type)}</strong></div><div><small>Requested area</small><strong>{requestCoverageText(review.request)}</strong></div></div> : null}
        <TextAreaInput label="Decision reason" value={reviewReason} onChange={(event) => setReviewReason(event.currentTarget.value)} required />
        {reviewMutation.error ? <StatusBadge tone="danger">{readError(reviewMutation.error)}</StatusBadge> : null}
      </Dialog>
    </div>
  );
}

function PartnerCoverageDialog(props: {
  record: OperationalCoverage | "new" | null;
  geographies: Geography[];
  drivers: Driver[];
  stations: Station[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { supabase } = useSessionState();
  const [step, setStep] = useState("partner");
  const [form, setForm] = useState<CoverageForm>(EMPTY_COVERAGE);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(props.record && props.record !== "new" ? formFromRecord(props.record) : EMPTY_COVERAGE);
    setStep("partner");
    setError(null);
  }, [props.record]);

  const record = props.record;
  if (!record) return null;

  const partnerOptions = form.entityType === "DRIVER"
    ? props.drivers.map((driver) => ({ label: driverLabel(driver), value: driver.id }))
    : props.stations.map((station) => ({ label: stationLabel(station), value: station.stationBranchId }));
  const partnerDisplay = form.entityType === "DRIVER"
    ? driverLabel(props.drivers.find((driver) => driver.id === form.entityId))
    : stationLabel(props.stations.find((station) => station.stationBranchId === form.entityId));
  const areaDisplay = form.coverageType === "ADMIN_GEOGRAPHY"
    ? props.geographies.find((area) => area.id === form.geographyId)?.canonical_name ?? "Not selected"
    : form.coverageType === "RADIUS"
      ? form.radius ? `${form.radius} m radius` : "Radius not completed"
      : "Custom drawn area";
  const radiusPoint = form.longitude && form.latitude
    ? [Number(form.longitude), Number(form.latitude)] as const
    : null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.entityId) { setError("Choose the driver or station first."); setStep("partner"); return; }
    if (form.coverageType === "ADMIN_GEOGRAPHY" && !form.geographyId) { setError("Choose a mapped service area."); setStep("area"); return; }
    if (form.coverageType === "RADIUS" && (!form.longitude || !form.latitude || !form.radius || Number(form.radius) <= 0)) { setError("Choose the centre point and distance."); setStep("area"); return; }
    if (form.coverageType === "CUSTOM_ZONE" && !form.geometry.trim()) { setError("Draw the custom operating area."); setStep("area"); return; }
    if (!form.reason.trim()) { setError("Explain why this operating area is changing."); setStep("review"); return; }

    setSaving(true);
    setError(null);
    try {
      let geometry: unknown = null;
      let geometryDraftId: string | null = null;
      if (form.coverageType === "CUSTOM_ZONE") {
        geometry = JSON.parse(form.geometry);
        const { data, error: draftError } = await supabase.rpc("save_coverage_geometry_draft", {
          p_draft_id: null,
          p_draft_type: "OPERATIONAL_COVERAGE",
          p_target_id: record === "new" ? null : record.id,
          p_parent_geography_id: null,
          p_geojson: geometry,
        });
        if (draftError) throw draftError;
        geometryDraftId = data as string;
      }

      const { data: assignmentId, error: rpcError } = await supabase.rpc("configure_operational_coverage_assignment", {
        p_assignment_id: record === "new" ? null : record.id,
        p_entity_type: form.entityType,
        p_entity_id: form.entityId,
        p_service_key: form.serviceKey,
        p_coverage_type: form.coverageType,
        p_geography_id: form.coverageType === "ADMIN_GEOGRAPHY" ? form.geographyId : null,
        p_center_longitude: form.coverageType === "RADIUS" ? Number(form.longitude) : null,
        p_center_latitude: form.coverageType === "RADIUS" ? Number(form.latitude) : null,
        p_radius_meters: form.coverageType === "RADIUS" ? Number(form.radius) : null,
        p_coverage_geojson: geometry,
        p_status: form.status,
        p_valid_from: form.validFrom || null,
        p_valid_to: form.validTo || null,
        p_reason: form.reason.trim(),
        p_metadata: { sourceSurface: "admin_operational_coverage_v2", geometryDraftId },
      });
      if (rpcError) throw rpcError;

      if (geometryDraftId) {
        const { error: activationError } = await supabase.rpc("activate_coverage_geometry_draft", {
          p_draft_id: geometryDraftId,
          p_target_id: assignmentId,
          p_reason: form.reason.trim(),
        });
        if (activationError) throw activationError;
      }

      await props.onSaved();
    } catch (cause) {
      setError(readError(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      isOpen
      title={record === "new" ? "Add partner operating area" : "Edit partner operating area"}
      onClose={props.onClose}
      footer={<Button variant="ghost" onClick={props.onClose}>Cancel</Button>}
    >
      <form onSubmit={(event) => void submit(event)}>
        <AdminTaskFlow
          steps={coverageSteps}
          activeStep={step}
          onStepChange={(next) => { setError(null); setStep(next); }}
          footer={step === "review" ? <Button type="submit" isLoading={saving}>Save operating area</Button> : undefined}
        >
          {step === "partner" ? (
            <AdminFormSection title="Choose the partner" description="Select the readable SKIMA partner identity instead of copying a database ID.">
              <div className="skima-form-grid">
                <SelectInput
                  label="Partner type"
                  value={form.entityType}
                  onChange={(event) => setForm({ ...form, entityType: event.currentTarget.value as CoverageForm["entityType"], entityId: "" })}
                  options={[{ label: "Driver", value: "DRIVER" }, { label: "Station", value: "STATION" }]}
                  disabled={record !== "new"}
                />
                <SelectInput
                  label={form.entityType === "DRIVER" ? "Driver" : "Station"}
                  value={form.entityId}
                  onChange={(event) => setForm({ ...form, entityId: event.currentTarget.value })}
                  options={[{ label: `Choose ${form.entityType === "DRIVER" ? "driver" : "station"}`, value: "" }, ...partnerOptions]}
                  required
                  disabled={record !== "new"}
                />
              </div>
            </AdminFormSection>
          ) : null}

          {step === "area" ? (
            <AdminFormSection title="Define the operating area" description="Use a mapped service area when possible. Radius and custom drawing handle exceptions.">
              <SelectInput
                label="Area method"
                value={form.coverageType}
                onChange={(event) => setForm({ ...form, coverageType: event.currentTarget.value as CoverageForm["coverageType"] })}
                options={[
                  { label: "Use a mapped service area", value: "ADMIN_GEOGRAPHY" },
                  { label: "Use a distance around a point", value: "RADIUS" },
                  { label: "Draw a custom area", value: "CUSTOM_ZONE" },
                ]}
              />
              {form.coverageType === "ADMIN_GEOGRAPHY" ? (
                <SelectInput
                  label="Mapped service area"
                  value={form.geographyId}
                  onChange={(event) => setForm({ ...form, geographyId: event.currentTarget.value })}
                  options={[{ label: "Choose service area", value: "" }, ...props.geographies.map((area) => ({ label: area.canonical_name, value: area.id }))]}
                  required
                />
              ) : null}
              {form.coverageType === "RADIUS" ? (
                <>
                  <AdminGeometryEditor
                    mode="point"
                    point={radiusPoint}
                    onPointChange={([longitude, latitude]) => setForm({ ...form, longitude: String(longitude), latitude: String(latitude) })}
                  />
                  <TextInput
                    label="Distance from centre (metres)"
                    type="number"
                    value={form.radius}
                    onChange={(event) => setForm({ ...form, radius: event.currentTarget.value })}
                    required
                  />
                </>
              ) : null}
              {form.coverageType === "CUSTOM_ZONE" ? (
                <AdminGeometryEditor mode="polygon" value={form.geometry} onChange={(geometry) => setForm({ ...form, geometry })} />
              ) : null}
            </AdminFormSection>
          ) : null}

          {step === "review" ? (
            <AdminFormSection title="Review and save" description="Confirm the assignment and leave an auditable reason for the change.">
              <div className="coverage-v2__review-grid">
                <div><small>Partner</small><strong>{partnerDisplay}</strong></div>
                <div><small>Operating area</small><strong>{areaDisplay}</strong></div>
                <div><small>Service</small><strong>LPG refill service</strong></div>
                <div><small>Status</small><strong>{friendly(form.status)}</strong></div>
              </div>
              <SelectInput
                label="Operating status"
                value={form.status}
                onChange={(event) => setForm({ ...form, status: event.currentTarget.value as CoverageForm["status"] })}
                options={[
                  { label: "Active — can operate now", value: "active" },
                  { label: "Paused — temporarily unavailable", value: "paused" },
                  { label: "Retired — no longer used", value: "retired" },
                ]}
              />
              <TextAreaInput
                label="Reason"
                helperText="Required. SKIMA keeps this note in the permanent change history."
                value={form.reason}
                onChange={(event) => setForm({ ...form, reason: event.currentTarget.value })}
                required
              />
              <details className="coverage-v2__advanced">
                <summary>Advanced schedule</summary>
                <div className="skima-form-grid">
                  <TextInput label="Starts on" type="datetime-local" value={form.validFrom} onChange={(event) => setForm({ ...form, validFrom: event.currentTarget.value })} />
                  <TextInput label="Ends on" type="datetime-local" value={form.validTo} onChange={(event) => setForm({ ...form, validTo: event.currentTarget.value })} />
                </div>
              </details>
            </AdminFormSection>
          ) : null}

          {error ? <StatusBadge tone="danger">{error}</StatusBadge> : null}
        </AdminTaskFlow>
      </form>
    </Dialog>
  );
}

function driverLabel(driver: Driver | undefined) {
  if (!driver) return "Unknown driver";
  const name = driver.driver_display_name?.trim() || "Driver";
  const publicId = driver.public_driver_id?.trim();
  return publicId ? `${name} · ${publicId}` : name;
}

function stationLabel(station: Station | undefined) {
  if (!station) return "Unknown station";
  return `${station.stationName} · ${station.organizationName}`;
}

function partnerName(entityType: string, entityId: string, driverNames: Map<string, string>, stationNames: Map<string, string>) {
  return entityType === "DRIVER" ? driverNames.get(entityId) ?? "Driver" : stationNames.get(entityId) ?? "Station";
}

function coverageLabel(item: OperationalCoverage) {
  if (item.geography_name) return item.geography_name;
  if (item.coverage_type === "RADIUS") return `${Math.round(item.radius_meters ?? 0)} m radius`;
  return item.coverage_type === "CUSTOM_ZONE" ? "Custom drawn area" : "Mapped service area";
}

function requestCoverageLabel(item: CoverageRequest) {
  if (item.geography_name) return item.geography_name;
  if (item.coverage_type === "RADIUS") {
    const radius = item.radius_meters ?? 0;
    const label = radius >= 1000
      ? `${(radius / 1000).toFixed(radius % 1000 === 0 ? 0 : 1)} km radius`
      : `${Math.round(radius)} m radius`;
    return <><strong>{label}</strong>{item.formatted_address ? <><br /><small>{item.formatted_address}</small></> : null}</>;
  }
  return "Custom drawn area";
}

function requestCoverageText(item: CoverageRequest) {
  if (item.geography_name) return item.geography_name;
  if (item.coverage_type === "RADIUS") return `${Math.round(item.radius_meters ?? 0)} m radius`;
  return "Custom drawn area";
}

function formFromRecord(record: OperationalCoverage): CoverageForm {
  return {
    entityType: record.entity_type === "STATION" ? "STATION" : "DRIVER",
    entityId: record.entity_id,
    serviceKey: record.service_key,
    coverageType: record.coverage_type,
    geographyId: record.geography_id ?? "",
    longitude: record.center_longitude?.toString() ?? "",
    latitude: record.center_latitude?.toString() ?? "",
    radius: record.radius_meters?.toString() ?? "",
    geometry: record.coverage_geojson ? JSON.stringify(record.coverage_geojson, null, 2) : "",
    status: record.status === "paused" || record.status === "retired" ? record.status : "active",
    validFrom: toLocalDateTime(record.valid_from),
    validTo: toLocalDateTime(record.valid_to),
    reason: "",
  };
}

function toLocalDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function friendly(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function readError(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const message = [record.message, record.details, record.hint, record.code]
      .find((value) => typeof value === "string" && value.trim());
    if (typeof message === "string") return message;
  }
  return "Partner coverage could not be loaded or saved. Refresh and try again.";
}
