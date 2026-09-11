import { useQuery } from "@tanstack/react-query";
import { ClipboardList, MapPinCheck, RefreshCcw, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { z } from "zod";

import {
  Button,
  DataTable,
  ErrorState,
  LoadingState,
  MetricTile,
  SelectInput,
  StatusBadge,
  TextInput,
  type TableColumn,
} from "@skima/ui";

import { AdminGeometryEditor } from "../../admin-geometry-editor";
import { useSessionState } from "../../session";
import { AdminV2PageHeader } from "../../shared/patterns/AdminV2Patterns";

const PointDiagnosticSchema = z.object({
  point: z.object({ longitude: z.coerce.number(), latitude: z.coerce.number() }),
  availability: z.record(z.unknown()),
  matchedGeographies: z.array(z.record(z.unknown())),
  approvedAssignments: z.array(z.record(z.unknown())),
  requestedCoverage: z.array(z.record(z.unknown())),
  currentLocationEvidence: z.array(z.record(z.unknown())),
  boundaryStrategy: z.string(),
});
const DispatchDiagnosticSchema = z.object({
  id: z.string().uuid(),
  dispatch_request_id: z.string().uuid(),
  subject_type: z.string(),
  subject_id: z.string().uuid(),
  service_key: z.string(),
  pickup_geojson: z.record(z.unknown()),
  selected_entity_type: z.string(),
  selected_entity_id: z.string().uuid(),
  selected_entity_geojson: z.record(z.unknown()),
  distance_meters: z.coerce.number(),
  authority_mode: z.string(),
  service_policy_snapshot: z.record(z.unknown()),
  coverage_assignment_snapshots: z.array(z.record(z.unknown())),
  candidate_decision_snapshots: z.array(z.record(z.unknown())),
  decision_metadata: z.record(z.unknown()),
  decided_at: z.string(),
});

type DiagnosticMode = "location" | "dispatch";
type DispatchDiagnostic = z.infer<typeof DispatchDiagnosticSchema>;

export function CoverageDiagnosticsScreen() {
  const [mode, setMode] = useState<DiagnosticMode>("location");

  return (
    <div className="coverage-v2__screen">
      <AdminV2PageHeader
        eyebrow="Service coverage · Diagnostics"
        title="Coverage diagnostics"
        description="Choose the troubleshooting job you need. Everyday coverage management stays separate from technical evidence."
      />
      <div className="coverage-v2__diagnostic-switch" role="tablist" aria-label="Coverage diagnostic tools">
        <button type="button" role="tab" aria-selected={mode === "location"} className={mode === "location" ? "is-active" : undefined} onClick={() => setMode("location")}>
          <MapPinCheck aria-hidden="true" /><span><strong>Check a location</strong><small>Why is an activity allowed or unavailable here?</small></span>
        </button>
        <button type="button" role="tab" aria-selected={mode === "dispatch"} className={mode === "dispatch" ? "is-active" : undefined} onClick={() => setMode("dispatch")}>
          <ClipboardList aria-hidden="true" /><span><strong>Explain a dispatch</strong><small>Inspect the recorded evidence behind an assignment.</small></span>
        </button>
      </div>
      {mode === "location" ? <LocationDiagnostic /> : <DispatchDiagnosticTool />}
    </div>
  );
}

function LocationDiagnostic() {
  const { supabase } = useSessionState();
  const [serviceKey, setServiceKey] = useState("lpg");
  const [capabilityKey, setCapabilityKey] = useState("customer_ordering");
  const [longitude, setLongitude] = useState("");
  const [latitude, setLatitude] = useState("");
  const [entityType, setEntityType] = useState("");
  const [entityId, setEntityId] = useState("");
  const [result, setResult] = useState<z.infer<typeof PointDiagnosticSchema> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const point = longitude && latitude ? [Number(longitude), Number(latitude)] as const : null;

  const diagnose = async (event: FormEvent) => {
    event.preventDefault();
    if (!longitude || !latitude) {
      setError("Tap the map to choose the location you want to check.");
      return;
    }
    if (entityId.trim() && !isUuid(entityId)) {
      setError("The optional partner record ID is incomplete. Paste the full ID or clear the field.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc("diagnose_coverage_point", {
        p_service_key: serviceKey.trim(),
        p_capability_key: capabilityKey.trim(),
        p_longitude: Number(longitude),
        p_latitude: Number(latitude),
        p_entity_type: entityType.trim().toUpperCase() || null,
        p_entity_id: entityId.trim() || null,
        p_at: new Date().toISOString(),
      });
      if (rpcError) throw rpcError;
      setResult(PointDiagnosticSchema.parse(data));
    } catch (cause) {
      setResult(null);
      setError(readError(cause));
    } finally {
      setLoading(false);
    }
  };

  const available = result?.availability.available === true;
  return (
    <section className="sk-panel">
      <div className="sk-panel__header"><div><h2>Check a location</h2><p className="skima-muted">Tap the exact map point. SKIMA explains the service-area rules and approved partner coverage that affected the result.</p></div></div>
      <form className="skima-form-grid" onSubmit={(event) => void diagnose(event)}>
        <SelectInput label="SKIMA service" value={serviceKey} onChange={(event) => setServiceKey(event.currentTarget.value)} options={[{ label: "LPG refill service", value: "lpg" }]} required />
        <SelectInput label="What do you want to check?" value={capabilityKey} onChange={(event) => setCapabilityKey(event.currentTarget.value)} options={[{ label: "Can customers place refill orders here?", value: "customer_ordering" }, { label: "Can drivers register and operate here?", value: "driver_onboarding" }, { label: "Can stations register and operate here?", value: "station_onboarding" }]} required />
        <div data-form-span="full"><AdminGeometryEditor mode="point" point={point} onPointChange={([nextLongitude, nextLatitude]) => { setLongitude(String(nextLongitude)); setLatitude(String(nextLatitude)); }} /></div>
        <details className="coverage-v2__advanced" data-form-span="full">
          <summary>Optional partner-specific check</summary>
          <div className="skima-form-grid">
            <SelectInput label="Partner type" value={entityType} onChange={(event) => setEntityType(event.currentTarget.value)} options={[{ label: "No specific partner", value: "" }, { label: "Driver", value: "DRIVER" }, { label: "Station", value: "STATION" }]} />
            <TextInput label="Partner record ID" helperText="Only use this when support needs one specific partner checked." value={entityId} onChange={(event) => setEntityId(event.currentTarget.value)} />
          </div>
        </details>
        <Button type="submit" isLoading={loading}>Check this location</Button>
      </form>
      {error ? <StatusBadge tone="danger">{error}</StatusBadge> : null}
      {result ? (
        <div className="coverage-v2__diagnostic-result">
          <section className="skima-grid skima-grid--compact">
            <MetricTile label="Availability" value={available ? "Allowed" : "Not allowed"} icon={ShieldCheck} tone={available ? "success" : "warning"} />
            <MetricTile label="Mapped areas" value={result.matchedGeographies.length} icon={MapPinCheck} tone="info" />
            <MetricTile label="Approved partner areas" value={result.approvedAssignments.length} icon={ShieldCheck} tone="success" />
            <MetricTile label="Pending partner requests" value={result.requestedCoverage.length} icon={MapPinCheck} tone="warning" />
          </section>
          <details className="coverage-v2__advanced"><summary>Technical evidence for support</summary><pre>{JSON.stringify({ matchedAreas: result.matchedGeographies, approvedPartnerAreas: result.approvedAssignments, requestedPartnerAreas: result.requestedCoverage, currentLocationEvidence: result.currentLocationEvidence, boundaryStrategy: result.boundaryStrategy }, null, 2)}</pre></details>
        </div>
      ) : null}
    </section>
  );
}

function DispatchDiagnosticTool() {
  const { supabase, status } = useSessionState();
  const [dispatchId, setDispatchId] = useState("");
  const [subjectType, setSubjectType] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const valid = (!dispatchId.trim() || isUuid(dispatchId)) && (!subjectId.trim() || isUuid(subjectId));
  const query = useQuery({
    queryKey: ["coverage-v2", "dispatch-diagnostics", dispatchId, subjectType, subjectId],
    enabled: status === "authenticated" && valid,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_dispatch_location_diagnostics", {
        p_dispatch_request_id: uuidOrNull(dispatchId),
        p_subject_type: subjectType.trim() || null,
        p_subject_id: uuidOrNull(subjectId),
        p_limit: 100,
      });
      if (error) throw error;
      return z.array(DispatchDiagnosticSchema).parse(data ?? []);
    },
  });
  const columns: TableColumn<DispatchDiagnostic>[] = [
    { key: "decision", header: "Decision", render: (item) => <><strong>{friendly(item.subject_type)}</strong><br /><small>{new Date(item.decided_at).toLocaleString()}</small></> },
    { key: "selected", header: "Selected", render: (item) => friendly(item.selected_entity_type) },
    { key: "distance", header: "Distance", render: (item) => `${Math.round(item.distance_meters)} m` },
    { key: "evidence", header: "Evidence", render: (item) => `${item.coverage_assignment_snapshots.length} coverage · ${item.candidate_decision_snapshots.length} candidates` },
    { key: "authority", header: "Coverage mode", render: (item) => friendly(item.authority_mode) },
  ];

  return (
    <section className="sk-panel">
      <div className="sk-panel__header"><div><h2>Explain a dispatch assignment</h2><p className="skima-muted">This is an audit/support tool. Normal operations should use Orders & Dispatch instead of searching internal dispatch records here.</p></div><Button icon={RefreshCcw} variant="outline" disabled={!valid} onClick={() => void query.refetch()}>Refresh</Button></div>
      <details className="coverage-v2__advanced" open>
        <summary>Dispatch audit filters</summary>
        <div className="skima-form-grid">
          <TextInput label="Dispatch request ID" value={dispatchId} onChange={(event) => setDispatchId(event.currentTarget.value)} placeholder="Optional UUID" />
          <SelectInput label="Subject type" value={subjectType} onChange={(event) => setSubjectType(event.currentTarget.value)} options={[{ label: "All subjects", value: "" }, { label: "LPG order", value: "lpg_order" }, { label: "Service request", value: "service_request" }]} />
          <TextInput label="Subject record ID" value={subjectId} onChange={(event) => setSubjectId(event.currentTarget.value)} placeholder="Optional UUID" />
        </div>
      </details>
      {!valid ? <StatusBadge tone="warning">One of the record IDs is incomplete.</StatusBadge> : query.isLoading ? <LoadingState label="Loading dispatch evidence" /> : query.error ? <ErrorState title="Dispatch evidence unavailable" message={readError(query.error)} onRetry={() => void query.refetch()} /> : <DataTable caption="Recorded dispatch location decisions" columns={columns} records={query.data ?? []} getRowKey={(item) => item.id} emptyTitle="No dispatch decisions found" emptyMessage="Assignment-time location evidence appears here after dispatch." />}
      {(query.data ?? []).map((item) => (
        <details key={`${item.id}:evidence`} className="coverage-v2__advanced">
          <summary>{new Date(item.decided_at).toLocaleString()} · technical evidence</summary>
          <pre>{JSON.stringify({ pickup: item.pickup_geojson, selectedEntityPoint: item.selected_entity_geojson, servicePolicy: item.service_policy_snapshot, coverageAssignments: item.coverage_assignment_snapshots, candidates: item.candidate_decision_snapshots, decision: item.decision_metadata }, null, 2)}</pre>
        </details>
      ))}
    </section>
  );
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}
function uuidOrNull(value: string) { return isUuid(value) ? value.trim() : null; }
function friendly(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase()); }
function readError(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") return String((error as { message: string }).message);
  return "The coverage diagnostic could not be completed. Refresh and try again.";
}
