import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPinned, Plus, RefreshCcw, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { z } from "zod";

import {
  Button, DataTable, Dialog, ErrorState, LoadingState, MetricTile, PageHeader, SelectInput,
  StatusBadge, TextAreaInput, TextInput, type TableColumn,
} from "@skima/ui";
import { useSessionState } from "./session";
import { AdminGeometryEditor } from "./admin-geometry-editor";

const LevelSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  country_code: z.string().nullable(),
  display_name: z.string(),
  depth: z.coerce.number(),
  specificity_rank: z.coerce.number(),
  parent_level_id: z.string().uuid().nullable(),
});
const GeographySchema = z.object({
  id: z.string().uuid(), parent_id: z.string().uuid().nullable(), geography_level_id: z.string().uuid(),
  canonical_name: z.string(), country_code: z.string(), status: z.enum(["draft", "active", "inactive", "retired"]),
  geography_levels: z.object({ display_name: z.string(), specificity_rank: z.coerce.number() }).nullable(),
});
const PolicySchema = z.object({
  id: z.string().uuid(), service_key: z.string(), capability_key: z.string(), target_geography_id: z.string().uuid(),
  effect: z.enum(["ALLOW", "DENY"]), priority: z.coerce.number(), status: z.enum(["draft", "active", "paused", "retired"]),
  starts_at: z.string().nullable(), ends_at: z.string().nullable(), reason: z.string().nullable(),
  geographies: z.object({ canonical_name: z.string() }).nullable(),
});
const ReadinessSchema = z.object({
  authorityMode: z.enum(["preparing", "universal", "retired"]), legacyAreaCount: z.coerce.number(), mappedCount: z.coerce.number(),
  verifiedCount: z.coerce.number(), blockedCount: z.coerce.number(), activeUniversalPolicyCount: z.coerce.number(), ready: z.boolean(),
});
const GeographyAdminSetupSchema = z.object({
  levels: z.array(LevelSchema),
  geographies: z.array(GeographySchema),
  policies: z.array(PolicySchema),
  readiness: ReadinessSchema,
  defaultCountryCode: z.string().nullable().optional(),
  permissions: z.object({
    canManageGeographies: z.boolean(),
    canManageCoverage: z.boolean(),
  }),
  setup: z.object({
    hasConfiguredLevels: z.boolean(),
    hasCanonicalGeographies: z.boolean(),
    hasActivePolicies: z.boolean(),
    authorityCanBeActivated: z.boolean(),
  }),
});
const GeographyMigrationSchema = z.object({
  id: z.string().uuid(),
  legacy_source: z.string(),
  legacy_id: z.string().uuid(),
  legacy_display_name: z.string(),
  legacy_area_type: z.string().nullable(),
  geography_id: z.string().uuid().nullable(),
  geography_name: z.string().nullable(),
  geography_country_code: z.string().nullable(),
  migration_status: z.enum(["pending", "migrated", "blocked", "verified", "retired"]),
  validation_code: z.string(),
  geometry_source: z.string().nullable(),
  boundary_ready: z.boolean(),
  verified_at: z.string().nullable(),
  details: z.record(z.unknown()),
});
const ExpansionDemandSchema = z.object({
  service_key: z.string(), interest_type: z.enum(["CUSTOMER", "DRIVER", "STATION"]),
  geography_id: z.string().uuid().nullable(), geography_name: z.string(), request_count: z.coerce.number(),
  distinct_user_count: z.coerce.number(), last_requested_at: z.string(),
});
const PolicyPreviewItemSchema = z.object({ policyId: z.string().uuid(), geographyId: z.string().uuid(), geographyName: z.string(), effect: z.enum(["ALLOW", "DENY"]), priority: z.coerce.number() });
const PolicyPreviewSchema = z.object({
  canActivate: z.boolean(), target: z.object({ geographyId: z.string().uuid(), geographyName: z.string(), specificity: z.coerce.number() }),
  conflicts: z.array(PolicyPreviewItemSchema), broaderPolicies: z.array(PolicyPreviewItemSchema), narrowerPolicies: z.array(PolicyPreviewItemSchema),
});
const OperationalCoverageSchema = z.object({
  id: z.string().uuid(), entity_type: z.string(), entity_id: z.string().uuid(), service_key: z.string(),
  coverage_type: z.enum(["ADMIN_GEOGRAPHY", "RADIUS", "CUSTOM_ZONE"]), geography_id: z.string().uuid().nullable(),
  geography_name: z.string().nullable(), center_longitude: z.coerce.number().nullable(), center_latitude: z.coerce.number().nullable(),
  radius_meters: z.coerce.number().nullable(), coverage_geojson: z.unknown().nullable(), status: z.enum(["requested", "approved", "active", "paused", "rejected", "expired", "retired"]),
  valid_from: z.string().nullable(), valid_to: z.string().nullable(), approved_at: z.string().nullable(), updated_at: z.string(),
});
const CoverageMapFeatureSchema = z.object({ id: z.string(), type: z.literal("Feature"), geometry: z.object({ type: z.enum(["Point", "Polygon", "MultiPolygon"]), coordinates: z.unknown() }), properties: z.object({ layer: z.enum(["SERVICE_POLICY", "OPERATIONAL_COVERAGE", "REQUESTED_COVERAGE", "OPERATING_BASE", "STATION_PHYSICAL", "APPLICATION_SUBMISSION", "LOCATION_EVIDENCE", "LIVE_LOCATION"]), name: z.string(), effect: z.enum(["ALLOW", "DENY"]).optional(), coverageType: z.string().optional(), status: z.string() }).passthrough() });
const CoverageMapSchema = z.object({ type: z.literal("FeatureCollection"), generatedAt: z.string(), truncated: z.boolean(), features: z.array(CoverageMapFeatureSchema) });
const PointDiagnosticSchema = z.object({ point: z.object({ longitude: z.coerce.number(), latitude: z.coerce.number() }), availability: z.record(z.unknown()), matchedGeographies: z.array(z.record(z.unknown())), approvedAssignments: z.array(z.record(z.unknown())), requestedCoverage: z.array(z.record(z.unknown())), currentLocationEvidence: z.array(z.record(z.unknown())), boundaryStrategy: z.string() });
const DispatchDiagnosticSchema=z.object({id:z.string().uuid(),dispatch_request_id:z.string().uuid(),subject_type:z.string(),subject_id:z.string().uuid(),service_key:z.string(),pickup_geojson:z.record(z.unknown()),selected_entity_type:z.string(),selected_entity_id:z.string().uuid(),selected_entity_geojson:z.record(z.unknown()),distance_meters:z.coerce.number(),authority_mode:z.string(),service_policy_snapshot:z.record(z.unknown()),coverage_assignment_snapshots:z.array(z.record(z.unknown())),candidate_decision_snapshots:z.array(z.record(z.unknown())),decision_metadata:z.record(z.unknown()),decided_at:z.string()});
const RetentionHealthSchema=z.object({healthy:z.boolean(),activePolicies:z.coerce.number(),lastCompletedAt:z.string().nullable(),lastDeletedCounts:z.record(z.unknown()).nullable(),queuedJobs:z.coerce.number(),runningJobs:z.coerce.number(),failedJobs:z.coerce.number(),overdue:z.boolean()});
const ProductionReadinessSchema=z.object({ready:z.boolean(),checkedAt:z.string(),configuration:z.record(z.unknown()),alerts:z.array(z.object({code:z.string(),severity:z.enum(["BLOCKER","WARNING"]),count:z.coerce.number().optional()})),metrics:z.record(z.unknown())});
const GeometryDraftSchema=z.object({id:z.string().uuid(),draft_type:z.enum(["GEOGRAPHY_BOUNDARY","OPERATIONAL_COVERAGE"]),target_id:z.string().uuid().nullable(),parent_geography_id:z.string().uuid().nullable(),status:z.enum(["DRAFT","PREVIEWED"]),geometry_geojson:z.record(z.unknown()),validation_snapshot:z.record(z.unknown()),created_at:z.string(),updated_at:z.string()});
type Geography = z.infer<typeof GeographySchema>;
type Policy = z.infer<typeof PolicySchema>;

interface GeographyForm { name: string; countryCode: string; levelId: string; parentId: string; boundary: string; source: string }
interface PolicyForm { serviceKey: string; capabilityKey: string; geographyId: string; effect: "ALLOW" | "DENY"; priority: string; status: "draft" | "active"; startsAt: string; endsAt: string; reason: string }
const EMPTY_GEOGRAPHY: GeographyForm = { name: "", countryCode: "", levelId: "", parentId: "", boundary: "", source: "admin.boundary" };
const EMPTY_POLICY: PolicyForm = { serviceKey: "", capabilityKey: "", geographyId: "", effect: "ALLOW", priority: "0", status: "draft", startsAt: "", endsAt: "", reason: "" };

export function AdminServiceCoverageWorkspace() {
  const { supabase, status } = useSessionState();
  const queryClient = useQueryClient();
  const [geographyOpen, setGeographyOpen] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const enabled = status === "authenticated";
  const adminSetup = useQuery({
    queryKey: ["universal-geography-admin-setup"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_geography_admin_setup");
      if (error) throw error;
      return GeographyAdminSetupSchema.parse(data);
    },
  });
  const productionReadiness=useQuery({queryKey:["location-production-readiness"],enabled,refetchInterval:60_000,queryFn:async()=>{const{data,error}=await supabase.rpc("read_location_platform_production_readiness");if(error)throw error;return ProductionReadinessSchema.parse(data);}});
  const levels = adminSetup.data?.levels ?? [];
  const geographies = adminSetup.data?.geographies ?? [];
  const records = adminSetup.data?.policies ?? [];
  const readiness = adminSetup.data?.readiness;
  const refresh = async () => {
    setNotice(null);
    await queryClient.invalidateQueries({ queryKey: ["universal"] });
    await Promise.all([adminSetup.refetch(), productionReadiness.refetch()]);
  };
  const columns = useMemo<TableColumn<Policy>[]>(() => [
    { key: "geography", header: "Geography", render: (p) => p.geographies?.canonical_name ?? "Unavailable geography" },
    { key: "capability", header: "Service / capability", render: (p) => <><strong>{p.service_key}</strong><br /><small>{p.capability_key}</small></> },
    { key: "effect", header: "Decision", render: (p) => <StatusBadge tone={p.effect === "ALLOW" ? "success" : "danger"}>{p.effect}</StatusBadge> },
    { key: "priority", header: "Priority", render: (p) => p.priority },
    { key: "status", header: "Status", render: (p) => <StatusBadge tone={p.status === "active" ? "success" : "warning"}>{p.status}</StatusBadge> },
  ], []);
  const loading = adminSetup.isLoading;
  const error = adminSetup.error;
  return <>
    <PageHeader eyebrow="Platform geography" title="Geography & Service Coverage" description="Manage canonical boundaries and capability-specific policies. Coordinates and PostGIS boundaries—not place names—determine availability." actions={<div className="skima-action-row"><Button icon={RefreshCcw} variant="outline" onClick={() => void refresh()}>Refresh</Button><Button icon={MapPinned} disabled={!adminSetup.data?.permissions.canManageGeographies} onClick={() => setGeographyOpen(true)}>Add geography</Button><Button icon={Plus} disabled={!adminSetup.data?.permissions.canManageCoverage} onClick={() => setPolicyOpen(true)}>Add policy</Button></div>} />
    <ProductionReadinessAlerts readiness={productionReadiness.data} error={productionReadiness.error}/>
    {notice ? <StatusBadge tone="success">{notice}</StatusBadge> : null}
    <section className="skima-grid skima-grid--compact">
      <MetricTile label="Canonical geographies" value={geographies.length} icon={MapPinned} tone="info" />
      <MetricTile label="Active policies" value={records.filter((p) => p.status === "active").length} icon={ShieldCheck} tone="success" />
      <MetricTile label="Blocked legacy areas" value={readiness?.blockedCount ?? 0} icon={ShieldCheck} tone={(readiness?.blockedCount ?? 0) > 0 ? "warning" : "success"} />
      <MetricTile label="Authority mode" value={readiness?.authorityMode ?? "Loading"} icon={MapPinned} tone={readiness?.ready ? "success" : "warning"} />
    </section>
    <GeographyCutoverPanel readiness={readiness} />
    {loading ? <LoadingState label="Loading universal geography" /> : null}
    {error ? <ErrorState title="Geography unavailable" message={readError(error)} onRetry={() => void refresh()} /> : null}
    {!loading && !error ? <section className="sk-panel"><div className="sk-panel__header"><div><h2>Service policies</h2><p className="skima-muted">More-specific configured levels override broader levels. Equal specificity and priority fail closed as a conflict.</p></div></div><DataTable caption="Universal service coverage policies" columns={columns} records={records} getRowKey={(p) => p.id} emptyTitle="No universal policies" emptyMessage="Import or draw a bounded geography, then add a capability policy." /></section> : null}
    <CoverageRequestsPanel />
    <OperationalCoveragePanel geographies={geographies} />
    <CoverageMapPanel />
    <PointDiagnosticPanel />
    <DispatchDiagnosticPanel />
    <RetentionHealthPanel />
    <GeometryDraftRecoveryPanel />
    <ExpansionDemandPanel />
    <GeographyDialog open={geographyOpen} levels={levels} geographies={geographies} defaultCountryCode={adminSetup.data?.defaultCountryCode ?? ""} onClose={() => setGeographyOpen(false)} onSaved={async () => { setGeographyOpen(false); setNotice("Canonical geography saved."); await refresh(); }} />
    <PolicyDialog open={policyOpen} geographies={geographies.filter((g) => g.status === "active")} onClose={() => setPolicyOpen(false)} onSaved={async () => { setPolicyOpen(false); setNotice("Coverage policy saved."); await refresh(); }} />
  </>;
}

type GeographyMigration = z.infer<typeof GeographyMigrationSchema>;
function GeographyCutoverPanel({ readiness }: { readiness: z.infer<typeof ReadinessSchema> | undefined }) {
  const { supabase, status } = useSessionState();
  const client = useQueryClient();
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const enabled = status === "authenticated";

  const mappings = useQuery({
    queryKey: ["universal-geography-migration-review"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_geography_migration_review_queue");
      if (error) throw error;
      return z.array(GeographyMigrationSchema).parse(data ?? []);
    },
  });

  const refresh = async () => {
    await Promise.all([
      mappings.refetch(),
      client.invalidateQueries({ queryKey: ["universal-geography-admin-setup"] }),
      client.invalidateQueries({ queryKey: ["location-production-readiness"] }),
    ]);
  };

  const importLegacy = useMutation({
    mutationFn: async () => {
      setNotice(null);
      const { data, error } = await supabase.rpc("import_legacy_spatial_geographies");
      if (error) throw error;
      return data as { imported?: number; blocked?: number } | null;
    },
    onSuccess: async (result) => {
      setNotice(`Spatial import completed: ${result?.imported ?? 0} imported, ${result?.blocked ?? 0} blocked for correction.`);
      await refresh();
    },
  });

  const verifyMapping = useMutation({
    mutationFn: async (mappingId: string) => {
      if (!reason.trim()) throw new Error("Enter a review reason before verifying a geography.");
      const { data, error } = await supabase.rpc("verify_geography_migration_mapping", {
        p_mapping_id: mappingId,
        p_reason: reason.trim(),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      setNotice("Geography mapping verified.");
      await refresh();
    },
  });

  const activateAuthority = useMutation({
    mutationFn: async () => {
      if (!reason.trim()) throw new Error("Enter an activation reason before switching geography authority.");
      const { data, error } = await supabase.rpc("set_universal_geography_authority", {
        p_mode: "universal",
        p_reason: reason.trim(),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      setNotice("Universal geography authority activated.");
      await refresh();
    },
  });

  const records = mappings.data ?? [];
  const needsReview = records.filter((item) => item.migration_status === "migrated").length;
  const blocked = records.filter((item) => item.migration_status === "blocked").length;
  const columns: TableColumn<GeographyMigration>[] = [
    { key: "legacy", header: "Existing area", render: (item) => <><strong>{item.legacy_display_name}</strong><br /><small>{item.legacy_area_type ?? item.legacy_source}</small></> },
    { key: "canonical", header: "Canonical geography", render: (item) => item.geography_name ?? "Not imported" },
    { key: "state", header: "Review state", render: (item) => <><StatusBadge tone={item.migration_status === "verified" ? "success" : item.migration_status === "blocked" ? "danger" : "warning"}>{item.migration_status}</StatusBadge><br /><small>{item.validation_code}</small></> },
    { key: "boundary", header: "Boundary", render: (item) => <StatusBadge tone={item.boundary_ready ? "success" : "danger"}>{item.boundary_ready ? "Valid" : "Needs correction"}</StatusBadge> },
    { key: "action", header: "Review", render: (item) => item.migration_status === "migrated"
      ? <Button size="sm" variant="outline" disabled={!item.boundary_ready || !reason.trim()} isLoading={verifyMapping.isPending && verifyMapping.variables === item.id} onClick={() => verifyMapping.mutate(item.id)}>Verify mapping</Button>
      : item.migration_status === "verified" ? <small>Reviewed</small> : <small>Resolve source data first</small> },
  ];

  const actionError = mappings.error ?? importLegacy.error ?? verifyMapping.error ?? activateAuthority.error;
  return (
    <section className="sk-panel">
      <div className="sk-panel__header">
        <div>
          <h2>Geography cutover setup</h2>
          <p className="skima-muted">Import existing bounded service areas, explicitly verify each canonical mapping, create the required service policies, then switch authority only when the readiness guard passes.</p>
        </div>
        <div className="skima-action-row">
          <Button variant="outline" icon={RefreshCcw} disabled={importLegacy.isPending} onClick={() => importLegacy.mutate()}>Import existing areas</Button>
          {readiness?.authorityMode === "preparing"
            ? <Button icon={ShieldCheck} disabled={!readiness.ready || !reason.trim()} isLoading={activateAuthority.isPending} onClick={() => activateAuthority.mutate()}>Activate universal geography</Button>
            : null}
        </div>
      </div>
      <div className="skima-grid skima-grid--compact">
        <MetricTile label="Awaiting review" value={needsReview} icon={MapPinned} tone={needsReview ? "warning" : "success"} />
        <MetricTile label="Blocked imports" value={blocked} icon={ShieldCheck} tone={blocked ? "warning" : "success"} />
        <MetricTile label="Verified mappings" value={readiness?.verifiedCount ?? 0} icon={ShieldCheck} tone="success" />
        <MetricTile label="Active policies required" value={readiness?.activeUniversalPolicyCount ?? 0} icon={ShieldCheck} tone={(readiness?.activeUniversalPolicyCount ?? 0) > 0 ? "success" : "warning"} />
      </div>
      <TextAreaInput label="Review / activation reason" helperText="Required for mapping verification and the final authority switch. The reason is preserved in audit history." value={reason} onChange={(event) => setReason(event.currentTarget.value)} />
      {notice ? <StatusBadge tone="success">{notice}</StatusBadge> : null}
      {actionError ? <StatusBadge tone="danger">{readError(actionError)}</StatusBadge> : null}
      {mappings.isLoading
        ? <LoadingState label="Loading geography migration review" />
        : <DataTable caption="Legacy geography migration review" columns={columns} records={records} getRowKey={(item) => item.id} emptyTitle="No legacy geography mappings" emptyMessage="Use Import existing areas if legacy service areas exist, or add canonical geographies manually." />}
    </section>
  );
}

type ExpansionDemand = z.infer<typeof ExpansionDemandSchema>;
function ExpansionDemandPanel() {
  const { supabase, status } = useSessionState();
  const query = useQuery({ queryKey: ["universal-expansion-demand"], enabled: status === "authenticated", queryFn: async () => {
    const { data, error } = await supabase.rpc("read_expansion_demand", { p_service_key: null, p_interest_type: null });
    if (error) throw error; return z.array(ExpansionDemandSchema).parse(data ?? []);
  }});
  const columns: TableColumn<ExpansionDemand>[] = [
    { key: "area", header: "Demand area", render: (item) => item.geography_name },
    { key: "service", header: "Service / interest", render: (item) => <><strong>{item.service_key}</strong><br /><small>{item.interest_type}</small></> },
    { key: "requests", header: "Requests", render: (item) => item.request_count },
    { key: "people", header: "People", render: (item) => item.distinct_user_count },
    { key: "latest", header: "Latest", render: (item) => new Date(item.last_requested_at).toLocaleString() },
  ];
  return <section className="sk-panel"><div className="sk-panel__header"><div><h2>Expansion demand</h2><p className="skima-muted">Customer and partner interest is grouped by the most-specific configured boundary containing each canonical point.</p></div></div>{query.isLoading ? <LoadingState label="Loading expansion demand" /> : query.error ? <ErrorState title="Expansion demand unavailable" message={readError(query.error)} onRetry={() => void query.refetch()} /> : <DataTable caption="Expansion demand by canonical geography" columns={columns} records={query.data ?? []} getRowKey={(item) => `${item.service_key}:${item.interest_type}:${item.geography_id ?? "unmapped"}`} emptyTitle="No expansion demand yet" emptyMessage="Launch notification and partner-interest requests will appear here." />}</section>;
}

function GeographyDialog({ open, levels, geographies, defaultCountryCode, onClose, onSaved }: { open: boolean; levels: z.infer<typeof LevelSchema>[]; geographies: Geography[]; defaultCountryCode: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const { supabase } = useSessionState(); const [form, setForm] = useState(EMPTY_GEOGRAPHY); const [error, setError] = useState<string | null>(null); const [saving, setSaving] = useState(false); const [draftId,setDraftId]=useState<string|null>(null);
  useEffect(() => {
    if (!open) return;
    setForm((current) => current.countryCode ? current : { ...current, countryCode: defaultCountryCode });
  }, [open, defaultCountryCode]);
  if (!open) return null;
  const selectedLevel = levels.find((level) => level.id === form.levelId);
  const requiredParentLevelId = selectedLevel?.parent_level_id ?? null;
  const parentOptions = requiredParentLevelId
    ? geographies.filter((geography) => geography.status === "active" && geography.geography_level_id === requiredParentLevelId)
    : [];
  const submit = async (event: FormEvent) => { event.preventDefault(); setSaving(true); setError(null); try { const boundary = JSON.parse(form.boundary) as unknown; const { data:savedDraft,error:draftError}=await supabase.rpc("save_coverage_geometry_draft",{p_draft_id:draftId,p_draft_type:"GEOGRAPHY_BOUNDARY",p_target_id:null,p_parent_geography_id:form.parentId||null,p_geojson:boundary});if(draftError)throw draftError;setDraftId(savedDraft as string); const { data:geographyId,error: rpcError } = await supabase.rpc("configure_universal_geography", { p_geography_id: null, p_parent_id: form.parentId || null, p_level_id: form.levelId, p_canonical_name: form.name.trim(), p_country_code: form.countryCode.trim().toUpperCase(), p_boundary_geojson: boundary, p_source: form.source.trim(), p_external_reference: null, p_status: "active", p_aliases: [], p_metadata: { sourceSurface: "admin_geography",geometryDraftId:savedDraft } }); if (rpcError) throw rpcError; const{error:activationError}=await supabase.rpc("activate_coverage_geometry_draft",{p_draft_id:savedDraft,p_target_id:geographyId,p_reason:`Activated canonical geography: ${form.name.trim()}`});if(activationError)throw activationError; setForm(EMPTY_GEOGRAPHY);setDraftId(null); await onSaved(); } catch (cause) { setError(readError(cause)); } finally { setSaving(false); } };
  return <Dialog isOpen title="Add bounded geography" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" form="geography-form" isLoading={saving}>Preview and activate geography</Button></>}><form id="geography-form" className="skima-form-grid" onSubmit={(e) => void submit(e)}><TextInput label="Canonical name" value={form.name} onChange={(e) => setForm({ ...form, name: e.currentTarget.value })} required /><TextInput label="ISO country code" value={form.countryCode} onChange={(e) => setForm({ ...form, countryCode: e.currentTarget.value })} required /><SelectInput label="Configured level" value={form.levelId} onChange={(e) => { const levelId=e.currentTarget.value; const nextLevel=levels.find((level)=>level.id===levelId); const requiredParent=nextLevel?.parent_level_id ?? null; const parentStillValid=Boolean(requiredParent && geographies.some((geography)=>geography.id===form.parentId && geography.geography_level_id===requiredParent)); setForm({ ...form, levelId, parentId: parentStillValid ? form.parentId : "" }); }} options={[{ label: "Select level", value: "" }, ...levels.map((l) => ({ label: l.display_name, value: l.id }))]} required /><SelectInput label="Parent geography" value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.currentTarget.value })} options={[{ label: requiredParentLevelId ? "Select parent" : "No parent required", value: "" }, ...parentOptions.map((g) => ({ label: g.canonical_name, value: g.id }))]} required={Boolean(requiredParentLevelId)} disabled={!requiredParentLevelId} /><AdminGeometryEditor mode="polygon" value={form.boundary} onChange={(boundary)=>setForm({...form,boundary})}/><TextAreaInput label="Boundary GeoJSON" helperText="Synchronized with the interactive editor for provider imports and diagnostics." value={form.boundary} onChange={(e) => setForm({ ...form, boundary: e.currentTarget.value })} required /><TextInput label="Boundary source" value={form.source} onChange={(e) => setForm({ ...form, source: e.currentTarget.value })} required />{draftId?<StatusBadge tone="info">Geometry draft preserved</StatusBadge>:null}{error ? <StatusBadge tone="danger">{error}</StatusBadge> : null}</form></Dialog>;
}

function PolicyDialog({ open, geographies, onClose, onSaved }: { open: boolean; geographies: Geography[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const { supabase } = useSessionState(); const [form, setForm] = useState(EMPTY_POLICY); const [error, setError] = useState<string | null>(null); const [saving, setSaving] = useState(false); const [preview, setPreview] = useState<{ signature: string; result: z.infer<typeof PolicyPreviewSchema> } | null>(null);
  if (!open) return null;
  const signature = JSON.stringify(form);
  const submit = async (event: FormEvent) => { event.preventDefault(); setSaving(true); setError(null); try { if (form.status === "active" && preview?.signature !== signature) { const { data, error: previewError } = await supabase.rpc("preview_universal_service_policy", { p_policy_id: null, p_service_key: form.serviceKey.trim(), p_capability_key: form.capabilityKey.trim(), p_geography_id: form.geographyId, p_priority: Number(form.priority), p_starts_at: form.startsAt || null, p_ends_at: form.endsAt || null }); if (previewError) throw previewError; const result = PolicyPreviewSchema.parse(data); setPreview({ signature, result }); if (!result.canActivate) { setError("Activation is blocked by an equal-specificity and equal-priority coverage conflict."); } return; } const { error: rpcError } = await supabase.rpc("configure_universal_service_policy", { p_policy_id: null, p_service_key: form.serviceKey.trim(), p_capability_key: form.capabilityKey.trim(), p_geography_id: form.geographyId, p_effect: form.effect, p_priority: Number(form.priority), p_status: form.status, p_starts_at: form.startsAt || null, p_ends_at: form.endsAt || null, p_reason: form.reason.trim(), p_configuration: { sourceSurface: "admin_coverage", activationPreviewed: form.status === "active" } }); if (rpcError) throw rpcError; setForm(EMPTY_POLICY); setPreview(null); await onSaved(); } catch (cause) { setError(readError(cause)); } finally { setSaving(false); } };
  const reviewed = form.status !== "active" || preview?.signature === signature;
  return <Dialog isOpen title="Add service coverage policy" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" form="policy-form" isLoading={saving} disabled={Boolean(preview?.signature === signature && !preview.result.canActivate)}>{form.status === "active" && !reviewed ? "Preview activation" : "Save policy"}</Button></>}><form id="policy-form" className="skima-form-grid" onSubmit={(e) => void submit(e)}><TextInput label="Service key" helperText="A configured platform key, such as a module service key." value={form.serviceKey} onChange={(e) => setForm({ ...form, serviceKey: e.currentTarget.value })} required /><TextInput label="Capability key" value={form.capabilityKey} onChange={(e) => setForm({ ...form, capabilityKey: e.currentTarget.value })} required /><SelectInput label="Geography" value={form.geographyId} onChange={(e) => setForm({ ...form, geographyId: e.currentTarget.value })} options={[{ label: "Select geography", value: "" }, ...geographies.map((g) => ({ label: g.canonical_name, value: g.id }))]} required /><SelectInput label="Effect" value={form.effect} onChange={(e) => setForm({ ...form, effect: e.currentTarget.value as "ALLOW" | "DENY" })} options={[{ label: "Allow", value: "ALLOW" }, { label: "Deny", value: "DENY" }]} /><TextInput label="Priority" type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.currentTarget.value })} /><SelectInput label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.currentTarget.value as "draft" | "active" })} options={[{ label: "Draft", value: "draft" }, { label: "Active", value: "active" }]} /><TextInput label="Starts at" type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.currentTarget.value })} /><TextInput label="Ends at" type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.currentTarget.value })} /><TextAreaInput label="Reason" helperText="Required before activation and written to the immutable audit trail." value={form.reason} onChange={(e) => setForm({ ...form, reason: e.currentTarget.value })} required={form.status === "active"} />{preview?.signature === signature ? <PolicyPreview result={preview.result} /> : null}{error ? <StatusBadge tone="danger">{error}</StatusBadge> : null}</form></Dialog>;
}
function PolicyPreview({ result }: { result: z.infer<typeof PolicyPreviewSchema> }) { return <section className="sk-panel"><h3>Activation preview</h3><p className="skima-muted">Target: {result.target.geographyName}. Broader policies: {result.broaderPolicies.length}. Nested overrides: {result.narrowerPolicies.length}.</p><StatusBadge tone={result.canActivate ? "success" : "danger"}>{result.canActivate ? "No deterministic conflict detected" : `${result.conflicts.length} activation conflict(s)`}</StatusBadge>{result.conflicts.map((item) => <p key={item.policyId}><strong>{item.geographyName}</strong> — {item.effect}, priority {item.priority}</p>)}</section>; }
function readError(error: unknown) { return error instanceof Error && error.message.trim() ? error.message : "The geography action could not be completed."; }

type OperationalCoverage = z.infer<typeof OperationalCoverageSchema>;
interface OperationalCoverageForm { entityType: string; entityId: string; serviceKey: string; coverageType: "ADMIN_GEOGRAPHY" | "RADIUS" | "CUSTOM_ZONE"; geographyId: string; longitude: string; latitude: string; radius: string; geometry: string; status: "active" | "paused" | "retired"; validFrom: string; validTo: string; reason: string }
const EMPTY_OPERATIONAL_COVERAGE: OperationalCoverageForm = { entityType: "DRIVER", entityId: "", serviceKey: "", coverageType: "ADMIN_GEOGRAPHY", geographyId: "", longitude: "", latitude: "", radius: "", geometry: "", status: "active", validFrom: "", validTo: "", reason: "" };
function OperationalCoveragePanel({ geographies }: { geographies: Geography[] }) {
  const { supabase, status } = useSessionState(); const client = useQueryClient(); const [editing, setEditing] = useState<OperationalCoverage | "new" | null>(null);
  const query = useQuery({ queryKey: ["universal-operational-coverage"], enabled: status === "authenticated", queryFn: async () => { const { data, error } = await supabase.rpc("read_operational_coverage_admin", { p_entity_type: null, p_entity_id: null, p_service_key: null }); if (error) throw error; return z.array(OperationalCoverageSchema).parse(data ?? []); }});
  const columns: TableColumn<OperationalCoverage>[] = [
    { key: "entity", header: "Operating entity", render: (item) => <><strong>{item.entity_type}</strong><br /><small>{item.entity_id}</small></> },
    { key: "service", header: "Service", render: (item) => item.service_key },
    { key: "coverage", header: "Approved coverage", render: (item) => item.geography_name ?? (item.coverage_type === "RADIUS" ? `${item.radius_meters ?? 0} m radius` : "Custom mapped zone") },
    { key: "status", header: "Status", render: (item) => <StatusBadge tone={item.status === "active" ? "success" : "warning"}>{item.status}</StatusBadge> },
    { key: "actions", header: "Manage", render: (item) => <Button size="sm" variant="outline" onClick={() => setEditing(item)}>Edit coverage</Button> },
  ];
  return <section className="sk-panel"><div className="sk-panel__header"><div><h2>Approved operational coverage</h2><p className="skima-muted">Multiple administrative areas, radii and cross-boundary custom zones are independent approved assignments.</p></div><Button icon={Plus} onClick={() => setEditing("new")}>Add assignment</Button></div>{query.isLoading ? <LoadingState label="Loading approved operational coverage" /> : query.error ? <ErrorState title="Operational coverage unavailable" message={readError(query.error)} onRetry={() => void query.refetch()} /> : <DataTable caption="Approved operational coverage assignments" columns={columns} records={query.data ?? []} getRowKey={(item) => item.id} emptyTitle="No approved assignments" emptyMessage="Approved driver, station and future operational entities will appear here." />}<OperationalCoverageDialog record={editing} geographies={geographies} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await client.invalidateQueries({ queryKey: ["universal-operational-coverage"] }); }} /></section>;
}
function OperationalCoverageDialog({ record, geographies, onClose, onSaved }: { record: OperationalCoverage | "new" | null; geographies: Geography[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const { supabase } = useSessionState(); const [form, setForm] = useState(EMPTY_OPERATIONAL_COVERAGE); const [error, setError] = useState<string | null>(null); const [saving, setSaving] = useState(false);
  useEffect(() => { setForm(record && record !== "new" ? operationalCoverageForm(record) : EMPTY_OPERATIONAL_COVERAGE); setError(null); }, [record]);
  if (!record) return null;
  const submit = async (event: FormEvent) => { event.preventDefault(); setSaving(true); setError(null); try { let geometry: unknown = null; let geometryDraftId:string|null=null; if (form.coverageType === "CUSTOM_ZONE") { geometry = JSON.parse(form.geometry); const{data,error:draftError}=await supabase.rpc("save_coverage_geometry_draft",{p_draft_id:null,p_draft_type:"OPERATIONAL_COVERAGE",p_target_id:record==="new"?null:record.id,p_parent_geography_id:null,p_geojson:geometry});if(draftError)throw draftError;geometryDraftId=data as string; } const { data:assignmentId,error: rpcError } = await supabase.rpc("configure_operational_coverage_assignment", { p_assignment_id: record === "new" ? null : record.id, p_entity_type: form.entityType.trim().toUpperCase(), p_entity_id: form.entityId, p_service_key: form.serviceKey.trim(), p_coverage_type: form.coverageType, p_geography_id: form.coverageType === "ADMIN_GEOGRAPHY" ? form.geographyId : null, p_center_longitude: form.coverageType === "RADIUS" ? Number(form.longitude) : null, p_center_latitude: form.coverageType === "RADIUS" ? Number(form.latitude) : null, p_radius_meters: form.coverageType === "RADIUS" ? Number(form.radius) : null, p_coverage_geojson: geometry, p_status: form.status, p_valid_from: form.validFrom || null, p_valid_to: form.validTo || null, p_reason: form.reason.trim(), p_metadata: { sourceSurface: "admin_operational_coverage",geometryDraftId } }); if (rpcError) throw rpcError; if(geometryDraftId){const{error:activationError}=await supabase.rpc("activate_coverage_geometry_draft",{p_draft_id:geometryDraftId,p_target_id:assignmentId,p_reason:form.reason.trim()});if(activationError)throw activationError;} await onSaved(); } catch (cause) { setError(readError(cause)); } finally { setSaving(false); } };
  const radiusPoint=form.longitude&&form.latitude?[Number(form.longitude),Number(form.latitude)] as const:null;
  return <Dialog isOpen title={record === "new" ? "Add operational coverage" : "Edit operational coverage"} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" form="operational-coverage-form" isLoading={saving}>Save approved coverage</Button></>}><form id="operational-coverage-form" className="skima-form-grid" onSubmit={(event) => void submit(event)}><TextInput label="Entity type" helperText="A reusable platform entity key, such as DRIVER or STATION." value={form.entityType} onChange={(event) => setForm({ ...form, entityType: event.currentTarget.value })} required /><TextInput label="Entity ID" value={form.entityId} onChange={(event) => setForm({ ...form, entityId: event.currentTarget.value })} required /><TextInput label="Service key" value={form.serviceKey} onChange={(event) => setForm({ ...form, serviceKey: event.currentTarget.value })} required /><SelectInput label="Coverage type" value={form.coverageType} onChange={(event) => setForm({ ...form, coverageType: event.currentTarget.value as OperationalCoverageForm["coverageType"] })} options={[{ label: "Administrative geography", value: "ADMIN_GEOGRAPHY" }, { label: "Radius", value: "RADIUS" }, { label: "Custom mapped zone", value: "CUSTOM_ZONE" }]} />{form.coverageType === "ADMIN_GEOGRAPHY" ? <SelectInput label="Approved geography" value={form.geographyId} onChange={(event) => setForm({ ...form, geographyId: event.currentTarget.value })} options={[{ label: "Select geography", value: "" }, ...geographies.filter((item) => item.status === "active").map((item) => ({ label: item.canonical_name, value: item.id }))]} required /> : null}{form.coverageType === "RADIUS" ? <><AdminGeometryEditor mode="point" point={radiusPoint} onPointChange={([longitude,latitude])=>setForm({...form,longitude:String(longitude),latitude:String(latitude)})}/><TextInput label="Center longitude" type="number" value={form.longitude} onChange={(event) => setForm({ ...form, longitude: event.currentTarget.value })} required /><TextInput label="Center latitude" type="number" value={form.latitude} onChange={(event) => setForm({ ...form, latitude: event.currentTarget.value })} required /><TextInput label="Radius in meters" type="number" value={form.radius} onChange={(event) => setForm({ ...form, radius: event.currentTarget.value })} required /></> : null}{form.coverageType === "CUSTOM_ZONE" ? <><AdminGeometryEditor mode="polygon" value={form.geometry} onChange={(geometry)=>setForm({...form,geometry})}/><TextAreaInput label="Coverage Polygon or MultiPolygon GeoJSON" value={form.geometry} onChange={(event) => setForm({ ...form, geometry: event.currentTarget.value })} required /></> : null}<SelectInput label="Status" value={form.status} onChange={(event) => setForm({ ...form, status: event.currentTarget.value as OperationalCoverageForm["status"] })} options={[{ label: "Active", value: "active" }, { label: "Paused", value: "paused" }, { label: "Retired", value: "retired" }]} /><TextInput label="Valid from" type="datetime-local" value={form.validFrom} onChange={(event) => setForm({ ...form, validFrom: event.currentTarget.value })} /><TextInput label="Valid until" type="datetime-local" value={form.validTo} onChange={(event) => setForm({ ...form, validTo: event.currentTarget.value })} /><TextAreaInput label="Change reason" helperText="Required and preserved in the immutable coverage history." value={form.reason} onChange={(event) => setForm({ ...form, reason: event.currentTarget.value })} required />{error ? <StatusBadge tone="danger">{error}</StatusBadge> : null}</form></Dialog>;
}
function operationalCoverageForm(record: OperationalCoverage): OperationalCoverageForm { return { entityType: record.entity_type, entityId: record.entity_id, serviceKey: record.service_key, coverageType: record.coverage_type, geographyId: record.geography_id ?? "", longitude: record.center_longitude?.toString() ?? "", latitude: record.center_latitude?.toString() ?? "", radius: record.radius_meters?.toString() ?? "", geometry: record.coverage_geojson ? JSON.stringify(record.coverage_geojson, null, 2) : "", status: record.status === "paused" || record.status === "retired" ? record.status : "active", validFrom: toLocalDateTime(record.valid_from), validTo: toLocalDateTime(record.valid_to), reason: "" }; }
function toLocalDateTime(value: string | null) { if (!value) return ""; const date = new Date(value); if (Number.isNaN(date.getTime())) return ""; const offset = date.getTimezoneOffset() * 60_000; return new Date(date.getTime() - offset).toISOString().slice(0, 16); }

type CoverageMapFeature = z.infer<typeof CoverageMapFeatureSchema>;
function CoverageMapPanel() {
  const { supabase, status } = useSessionState(); const [serviceKey, setServiceKey] = useState(""); const [capabilityKey, setCapabilityKey] = useState(""); const [entityType,setEntityType]=useState(""); const [entityId,setEntityId]=useState(""); const [applicationId,setApplicationId]=useState("");
  const filters=[serviceKey,capabilityKey,entityType,entityId,applicationId] as const;
  const validFilters=(!entityId.trim()||isUuid(entityId))&&(!applicationId.trim()||isUuid(applicationId));
  const query = useQuery({ queryKey: ["universal-coverage-map", ...filters], enabled: status === "authenticated"&&validFilters, queryFn: async () => { const now=new Date().toISOString(); const [{data,error},{data:evidenceData,error:evidenceError}]=await Promise.all([supabase.rpc("read_coverage_map_features", { p_service_key: serviceKey.trim() || null, p_capability_key: capabilityKey.trim() || null, p_entity_type: entityType.trim().toUpperCase()||null, p_entity_id: uuidOrNull(entityId), p_at: now, p_limit: 500, p_simplify_tolerance: 0.00001 }),supabase.rpc("read_coverage_evidence_map_features",{p_service_key:serviceKey.trim()||null,p_entity_type:entityType.trim().toUpperCase()||null,p_entity_id:uuidOrNull(entityId),p_application_id:uuidOrNull(applicationId),p_at:now,p_limit:500,p_simplify_tolerance:0.00001})]); if (error) throw error;if(evidenceError)throw evidenceError;const effective=CoverageMapSchema.parse(data),evidence=CoverageMapSchema.parse(evidenceData);return{...effective,truncated:effective.truncated||evidence.truncated,features:[...effective.features,...evidence.features]}; }});
  return <section className="sk-panel"><div className="sk-panel__header"><div><h2>Effective coverage map</h2><p className="skima-muted">Service policy, requested coverage, approved coverage, operating base, application evidence and authorized live location are separate server-controlled layers.</p></div><Button variant="outline" disabled={!validFilters} onClick={() => void query.refetch()}>Refresh map</Button></div><div className="skima-form-grid"><TextInput label="Service filter" helperText="Leave empty to inspect all configured services." value={serviceKey} onChange={(event) => setServiceKey(event.currentTarget.value)} /><TextInput label="Capability filter" value={capabilityKey} onChange={(event) => setCapabilityKey(event.currentTarget.value)} /><TextInput label="Entity type" value={entityType} onChange={(event)=>setEntityType(event.currentTarget.value)}/><TextInput label="Entity ID" value={entityId} onChange={(event)=>setEntityId(event.currentTarget.value)}/><TextInput label="Application ID" value={applicationId} onChange={(event)=>setApplicationId(event.currentTarget.value)}/></div>{!validFilters?<StatusBadge tone="warning">Entity and application filters must be complete UUIDs.</StatusBadge>:query.isLoading ? <LoadingState label="Loading effective coverage geometry" /> : query.error ? <ErrorState title="Coverage map unavailable" message={readError(query.error)} onRetry={() => void query.refetch()} /> : <CoverageGeometryMap features={query.data?.features ?? []} truncated={query.data?.truncated ?? false} />}</section>;
}
function CoverageGeometryMap({ features, truncated }: { features: CoverageMapFeature[]; truncated: boolean }) {
  const layerNames=[...new Set(features.map((feature)=>feature.properties.layer))];const[hiddenLayers,setHiddenLayers]=useState<string[]>([]);const visibleFeatures=features.filter((feature)=>!hiddenLayers.includes(feature.properties.layer));
  const points = visibleFeatures.flatMap((feature) => geometryPoints(feature.geometry.coordinates));
  if (features.length === 0) return <ErrorState title="No mapped coverage" message="No active service policies or approved operational coverage matched these filters." />;
  if (points.length === 0) return <div><div className="skima-action-row">{layerNames.map((layer)=><Button key={layer} size="sm" variant="outline" aria-pressed={false} onClick={()=>setHiddenLayers((current)=>current.filter((item)=>item!==layer))}>{layer.replaceAll("_"," ")}</Button>)}</div><p className="skima-muted">All map layers are hidden. Select a layer to show it.</p></div>;
  const longitudes = points.map(([longitude]) => longitude); const latitudes = points.map(([, latitude]) => latitude); const minLongitude = Math.min(...longitudes); const maxLongitude = Math.max(...longitudes); const minLatitude = Math.min(...latitudes); const maxLatitude = Math.max(...latitudes); const longitudeSpan = Math.max(maxLongitude - minLongitude, 0.001); const latitudeSpan = Math.max(maxLatitude - minLatitude, 0.001); const project = ([longitude, latitude]: [number, number]) => [24 + ((longitude - minLongitude) / longitudeSpan) * 852, 436 - ((latitude - minLatitude) / latitudeSpan) * 412] as const;
  return <div><div className="skima-action-row">{layerNames.map((layer)=><Button key={layer} size="sm" variant={hiddenLayers.includes(layer)?"outline":"primary"} aria-pressed={!hiddenLayers.includes(layer)} onClick={()=>setHiddenLayers((current)=>current.includes(layer)?current.filter((item)=>item!==layer):[...current,layer])}>{layer.replaceAll("_"," ")}</Button>)}{truncated ? <StatusBadge tone="warning">Map feature limit reached—apply filters</StatusBadge> : null}</div><svg role="img" aria-label="Effective service and operational coverage geometry" viewBox="0 0 900 460" style={{ width: "100%", minHeight: 360, background: "#f5f7f8", border: "1px solid #d9e0e3", borderRadius: 16 }}><defs><pattern id="coverage-grid" width="45" height="45" patternUnits="userSpaceOnUse"><path d="M 45 0 L 0 0 0 45" fill="none" stroke="#dce4e7" strokeWidth="1" /></pattern></defs><rect width="900" height="460" fill="url(#coverage-grid)" />{visibleFeatures.map((feature) => feature.geometry.type==="Point"?<MapEvidencePoint key={`${feature.properties.layer}:${feature.id}`} feature={feature} project={project}/>:<path key={`${feature.properties.layer}:${feature.id}`} d={geometryPath(feature.geometry.coordinates, project)} fill={feature.properties.layer === "OPERATIONAL_COVERAGE" ? "#246bdb55" : feature.properties.layer==="REQUESTED_COVERAGE"?"#d98b2455":feature.properties.effect === "DENY" ? "#d9383855" : "#1d9b6255"} stroke={feature.properties.layer === "OPERATIONAL_COVERAGE" ? "#246bdb" : feature.properties.layer==="REQUESTED_COVERAGE"?"#b86a10":feature.properties.effect === "DENY" ? "#b42323" : "#157a4c"} strokeWidth="2" strokeDasharray={feature.properties.layer==="REQUESTED_COVERAGE"?"8 5":undefined} fillRule="evenodd"><title>{feature.properties.name} — {feature.properties.layer}</title></path>)}</svg><p className="skima-muted">Toggle dense layers above. Live driver points appear only with tracking-admin permission and recent operational data.</p></div>;
}
function MapEvidencePoint({feature,project}:{feature:CoverageMapFeature;project:(point:[number,number])=>readonly[number,number]}){const points=geometryPoints(feature.geometry.coordinates);if(!points[0])return null;const[x,y]=project(points[0]);const color=feature.properties.layer==="LIVE_LOCATION"?"#d93838":feature.properties.layer==="OPERATING_BASE"?"#6b3fd1":"#334e68";return <g><circle cx={x} cy={y} r={feature.properties.layer==="LIVE_LOCATION"?9:7} fill={color} stroke="white" strokeWidth="3"/><title>{feature.properties.name} — {feature.properties.layer}</title></g>;}
function isUuid(value:string){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());}
function uuidOrNull(value:string){return isUuid(value)?value.trim():null;}
function geometryPoints(value: unknown): [number, number][] { if (!Array.isArray(value)) return []; if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number" && Number.isFinite(value[0]) && Number.isFinite(value[1])) return [[value[0], value[1]]]; return value.flatMap(geometryPoints); }
function geometryPath(value: unknown, project: (point: [number, number]) => readonly [number, number]): string { if (!Array.isArray(value)) return ""; if (value.length > 0 && Array.isArray(value[0]) && typeof value[0][0] === "number") { const ring = geometryPoints(value); return ring.map((point, index) => { const [x, y] = project(point); return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`; }).join(" ") + " Z"; } return value.map((part) => geometryPath(part, project)).join(" "); }

function PointDiagnosticPanel() {
  const { supabase } = useSessionState(); const [serviceKey,setServiceKey]=useState(""); const [capabilityKey,setCapabilityKey]=useState(""); const [longitude,setLongitude]=useState(""); const [latitude,setLatitude]=useState(""); const [entityType,setEntityType]=useState(""); const [entityId,setEntityId]=useState(""); const [result,setResult]=useState<z.infer<typeof PointDiagnosticSchema>|null>(null); const [error,setError]=useState<string|null>(null); const [loading,setLoading]=useState(false);
  const diagnose=async(event:FormEvent)=>{event.preventDefault();setLoading(true);setError(null);try{const{data,error:rpcError}=await supabase.rpc("diagnose_coverage_point",{p_service_key:serviceKey.trim(),p_capability_key:capabilityKey.trim(),p_longitude:Number(longitude),p_latitude:Number(latitude),p_entity_type:entityType.trim().toUpperCase()||null,p_entity_id:entityId.trim()||null,p_at:new Date().toISOString()});if(rpcError)throw rpcError;setResult(PointDiagnosticSchema.parse(data));}catch(cause){setError(readError(cause));setResult(null);}finally{setLoading(false);}};
  const available=result?.availability.available===true; return <section className="sk-panel"><div className="sk-panel__header"><div><h2>Point coverage diagnostic</h2><p className="skima-muted">Inspect the authoritative result for an exact coordinate, including boundary-edge handling, service policy, approved coverage, requested coverage and current entity evidence.</p></div></div><form className="skima-form-grid" onSubmit={(event)=>void diagnose(event)}><TextInput label="Service key" value={serviceKey} onChange={(event)=>setServiceKey(event.currentTarget.value)} required/><TextInput label="Capability key" value={capabilityKey} onChange={(event)=>setCapabilityKey(event.currentTarget.value)} required/><TextInput label="Longitude" type="number" value={longitude} onChange={(event)=>setLongitude(event.currentTarget.value)} required/><TextInput label="Latitude" type="number" value={latitude} onChange={(event)=>setLatitude(event.currentTarget.value)} required/><TextInput label="Entity type filter" helperText="Optional, such as DRIVER or STATION." value={entityType} onChange={(event)=>setEntityType(event.currentTarget.value)}/><TextInput label="Entity ID filter" value={entityId} onChange={(event)=>setEntityId(event.currentTarget.value)}/><Button type="submit" isLoading={loading}>Run server diagnostic</Button></form>{error?<StatusBadge tone="danger">{error}</StatusBadge>:null}{result?<div className="skima-grid skima-grid--compact"><MetricTile label="Service result" value={available?"AVAILABLE":String(result.availability.reason??"UNAVAILABLE")} icon={ShieldCheck} tone={available?"success":"warning"}/><MetricTile label="Matched geographies" value={result.matchedGeographies.length} icon={MapPinned} tone="info"/><MetricTile label="Approved assignments" value={result.approvedAssignments.length} icon={ShieldCheck} tone="success"/><MetricTile label="Requested assignments" value={result.requestedCoverage.length} icon={MapPinned} tone="warning"/><section className="sk-panel"><h3>Boundary behavior</h3><p>{result.boundaryStrategy}</p><p className="skima-muted">Points on polygon edges are included consistently through PostGIS ST_Covers.</p></section><section className="sk-panel"><h3>Diagnostic evidence</h3><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{JSON.stringify({matchedGeographies:result.matchedGeographies,approvedAssignments:result.approvedAssignments,requestedCoverage:result.requestedCoverage,currentLocationEvidence:result.currentLocationEvidence},null,2)}</pre></section></div>:null}</section>;
}

type DispatchDiagnostic=z.infer<typeof DispatchDiagnosticSchema>;
function DispatchDiagnosticPanel(){const{supabase,status}=useSessionState();const[dispatchId,setDispatchId]=useState("");const[subjectType,setSubjectType]=useState("");const[subjectId,setSubjectId]=useState("");const valid=(!dispatchId.trim()||isUuid(dispatchId))&&(!subjectId.trim()||isUuid(subjectId));const query=useQuery({queryKey:["dispatch-location-diagnostics",dispatchId,subjectType,subjectId],enabled:status==="authenticated"&&valid,queryFn:async()=>{const{data,error}=await supabase.rpc("read_dispatch_location_diagnostics",{p_dispatch_request_id:uuidOrNull(dispatchId),p_subject_type:subjectType.trim()||null,p_subject_id:uuidOrNull(subjectId),p_limit:100});if(error)throw error;return z.array(DispatchDiagnosticSchema).parse(data??[]);}});const columns:TableColumn<DispatchDiagnostic>[]=[{key:"decision",header:"Dispatch decision",render:(item)=><><strong>{item.subject_type}</strong><br/><small>{item.dispatch_request_id}</small></>},{key:"selected",header:"Selected entity",render:(item)=><><strong>{item.selected_entity_type}</strong><br/><small>{item.selected_entity_id}</small></>},{key:"distance",header:"Distance",render:(item)=>`${Math.round(item.distance_meters)} m`},{key:"evidence",header:"Frozen evidence",render:(item)=>`${item.coverage_assignment_snapshots.length} coverage · ${item.candidate_decision_snapshots.length} candidates`},{key:"time",header:"Decided",render:(item)=>new Date(item.decided_at).toLocaleString()}];return <section className="sk-panel"><div className="sk-panel__header"><div><h2>Dispatch location audit</h2><p className="skima-muted">Immutable assignment-time policy, coverage, candidate, pickup and selected-driver evidence explains why a dispatch decision was valid at that time.</p></div><Button variant="outline" disabled={!valid} onClick={()=>void query.refetch()}>Refresh audit</Button></div><div className="skima-form-grid"><TextInput label="Dispatch request ID" value={dispatchId} onChange={(event)=>setDispatchId(event.currentTarget.value)}/><TextInput label="Subject type" value={subjectType} onChange={(event)=>setSubjectType(event.currentTarget.value)}/><TextInput label="Subject ID" value={subjectId} onChange={(event)=>setSubjectId(event.currentTarget.value)}/></div>{!valid?<StatusBadge tone="warning">Dispatch and subject identifiers must be complete UUIDs.</StatusBadge>:query.isLoading?<LoadingState label="Loading dispatch audit evidence"/>:query.error?<ErrorState title="Dispatch audit unavailable" message={readError(query.error)} onRetry={()=>void query.refetch()}/>:<><DataTable caption="Immutable dispatch location decisions" columns={columns} records={query.data??[]} getRowKey={(item)=>item.id} emptyTitle="No dispatch decisions found" emptyMessage="Assignment-time location snapshots will appear here after dispatch."/>{(query.data??[]).map((item)=><details key={`${item.id}:detail`}><summary>{item.dispatch_request_id} evidence detail</summary><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{JSON.stringify({pickup:item.pickup_geojson,selectedEntityPoint:item.selected_entity_geojson,servicePolicy:item.service_policy_snapshot,coverageAssignments:item.coverage_assignment_snapshots,candidates:item.candidate_decision_snapshots,decision:item.decision_metadata},null,2)}</pre></details>)}</>}</section>;}
function RetentionHealthPanel(){const{supabase,status}=useSessionState();const query=useQuery({queryKey:["location-retention-health"],enabled:status==="authenticated",refetchInterval:60_000,queryFn:async()=>{const{data,error}=await supabase.rpc("read_location_retention_health");if(error)throw error;return RetentionHealthSchema.parse(data);}});if(query.isLoading)return <LoadingState label="Checking location retention operations"/>;if(query.error)return <ErrorState title="Retention health unavailable" message={readError(query.error)} onRetry={()=>void query.refetch()}/>;const health=query.data;return <section className="sk-panel"><div className="sk-panel__header"><div><h2>Location retention operations</h2><p className="skima-muted">Scheduled service-authority cleanup limits driver sample growth and removes abandoned geometry drafts without deleting activated evidence.</p></div><StatusBadge tone={health?.healthy?"success":"danger"}>{health?.healthy?"Healthy":"Action required"}</StatusBadge></div><div className="skima-grid skima-grid--compact"><MetricTile label="Active policies" value={health?.activePolicies??0} icon={ShieldCheck} tone="info"/><MetricTile label="Queued / running" value={`${health?.queuedJobs??0} / ${health?.runningJobs??0}`} icon={RefreshCcw} tone="info"/><MetricTile label="Failed jobs" value={health?.failedJobs??0} icon={ShieldCheck} tone={(health?.failedJobs??0)>0?"warning":"success"}/><MetricTile label="Last completed" value={health?.lastCompletedAt?new Date(health.lastCompletedAt).toLocaleString():"Awaiting first run"} icon={RefreshCcw} tone={health?.overdue?"warning":"success"}/></div>{health?.lastDeletedCounts?<p className="skima-muted">Last cleanup: {JSON.stringify(health.lastDeletedCounts)}</p>:null}</section>;}
function ProductionReadinessAlerts({readiness,error}:{readiness:z.infer<typeof ProductionReadinessSchema>|undefined;error:unknown}){if(error)return <StatusBadge tone="danger">Production readiness could not be evaluated: {readError(error)}</StatusBadge>;if(!readiness)return <LoadingState label="Evaluating location production readiness"/>;return <section className="sk-panel"><div className="sk-panel__header"><div><h2>Production readiness gate</h2><p className="skima-muted">Deployment is blocked when authoritative location, policy, coverage or retention invariants fail.</p></div><StatusBadge tone={readiness.ready?"success":"danger"}>{readiness.ready?"READY":"BLOCKED"}</StatusBadge></div>{readiness.alerts.length===0?<p>No readiness alerts.</p>:readiness.alerts.map((alert)=><p key={alert.code}><StatusBadge tone={alert.severity==="BLOCKER"?"danger":"warning"}>{alert.severity}</StatusBadge> <strong>{alert.code.replaceAll("_"," ")}</strong>{alert.count!==undefined?` — ${alert.count}`:""}</p>)}</section>;}
function GeometryDraftRecoveryPanel(){const{supabase,status}=useSessionState();const client=useQueryClient();const[abandoning,setAbandoning]=useState<z.infer<typeof GeometryDraftSchema>|null>(null);const[reason,setReason]=useState("");const query=useQuery({queryKey:["recoverable-geometry-drafts"],enabled:status==="authenticated",queryFn:async()=>{const{data,error}=await supabase.rpc("read_recoverable_geometry_drafts",{p_limit:100});if(error)throw error;return z.array(GeometryDraftSchema).parse(data??[]);}});const abandon=useMutation({mutationFn:async()=>{if(!abandoning||!reason.trim())throw new Error("An abandonment reason is required.");const{error}=await supabase.rpc("abandon_coverage_geometry_draft",{p_draft_id:abandoning.id,p_reason:reason.trim()});if(error)throw error;},onSuccess:async()=>{setAbandoning(null);setReason("");await client.invalidateQueries({queryKey:["recoverable-geometry-drafts"]});}});const columns:TableColumn<z.infer<typeof GeometryDraftSchema>>[]=[{key:"type",header:"Draft type",render:(item)=>item.draft_type.replaceAll("_"," ")},{key:"status",header:"Status",render:(item)=><StatusBadge tone="warning">{item.status}</StatusBadge>},{key:"validation",header:"Validation",render:(item)=>String(item.validation_snapshot.code??"UNKNOWN")},{key:"updated",header:"Updated",render:(item)=>new Date(item.updated_at).toLocaleString()},{key:"actions",header:"Recovery",render:(item)=><div className="skima-action-row"><Button size="sm" variant="outline" onClick={()=>navigator.clipboard.writeText(JSON.stringify(item.geometry_geojson,null,2))}>Copy geometry</Button><Button size="sm" variant="destructive" onClick={()=>setAbandoning(item)}>Abandon</Button></div>}];return <section className="sk-panel"><div className="sk-panel__header"><div><h2>Recoverable geometry drafts</h2><p className="skima-muted">Resume a preserved boundary by copying its validated GeoJSON into the editor, or explicitly abandon it with an audited reason.</p></div></div>{query.isLoading?<LoadingState label="Loading geometry drafts"/>:query.error?<ErrorState title="Geometry drafts unavailable" message={readError(query.error)} onRetry={()=>void query.refetch()}/>:<DataTable caption="Recoverable geometry drafts" columns={columns} records={query.data??[]} getRowKey={(item)=>item.id} emptyTitle="No recoverable drafts" emptyMessage="Previewed and unfinished geometry will appear here."/>}<Dialog isOpen={Boolean(abandoning)} title="Abandon geometry draft" onClose={()=>setAbandoning(null)} footer={<><Button variant="ghost" onClick={()=>setAbandoning(null)}>Cancel</Button><Button variant="destructive" isLoading={abandon.isPending} onClick={()=>abandon.mutate()}>Abandon draft</Button></>}><TextAreaInput label="Abandonment reason" value={reason} onChange={(event)=>setReason(event.currentTarget.value)} required/>{abandon.error?<StatusBadge tone="danger">{readError(abandon.error)}</StatusBadge>:null}</Dialog></section>;}


const CoverageRequestSchema = z.object({
  id: z.string().uuid(), application_id: z.string().uuid(), applicant_user_id: z.string().uuid(),
  entity_type: z.enum(["DRIVER", "STATION"]), service_key: z.string(),
  coverage_type: z.enum(["ADMIN_GEOGRAPHY", "RADIUS", "CUSTOM_ZONE"]), status: z.enum(["REQUESTED", "APPROVED", "REJECTED", "WITHDRAWN"]),
  radius_meters: z.coerce.number().nullable(), geographies: z.object({ canonical_name: z.string() }).nullable(), created_at: z.string(),
});
type CoverageRequest = z.infer<typeof CoverageRequestSchema>;

function CoverageRequestsPanel() {
  const { supabase, status } = useSessionState();
  const client = useQueryClient();
  const [review, setReview] = useState<{ request: CoverageRequest; decision: "APPROVED" | "REJECTED" } | null>(null);
  const [reason, setReason] = useState("");
  const query = useQuery({ queryKey: ["universal-coverage-requests"], enabled: status === "authenticated", queryFn: async () => {
    const { data, error } = await supabase.from("application_operational_coverage_requests").select("id,application_id,applicant_user_id,entity_type,service_key,coverage_type,status,radius_meters,created_at,geographies(canonical_name)").eq("status", "REQUESTED").order("created_at");
    if (error) throw error; return z.array(CoverageRequestSchema).parse(data ?? []);
  }});
  const mutation = useMutation({ mutationFn: async () => {
    if (!review || !reason.trim()) throw new Error("A review reason is required.");
    const { error } = await supabase.rpc("review_application_coverage_request", { p_request_id: review.request.id, p_decision: review.decision, p_reason: reason.trim(), p_valid_from: null, p_valid_to: null });
    if (error) throw error;
  }, onSuccess: async () => { setReview(null); setReason(""); await client.invalidateQueries({ queryKey: ["universal-coverage-requests"] }); } });
  const columns: TableColumn<CoverageRequest>[] = [
    { key: "entity", header: "Applicant", render: (item) => <><strong>{item.entity_type}</strong><br /><small>{item.applicant_user_id}</small></> },
    { key: "coverage", header: "Requested coverage", render: (item) => item.geographies?.canonical_name ?? (item.coverage_type === "RADIUS" ? `${item.radius_meters ?? 0} m radius` : item.coverage_type) },
    { key: "service", header: "Service", render: (item) => item.service_key },
    { key: "actions", header: "Review", render: (item) => <div className="skima-action-row"><Button size="sm" onClick={() => setReview({ request: item, decision: "APPROVED" })}>Approve</Button><Button size="sm" variant="destructive" onClick={() => setReview({ request: item, decision: "REJECTED" })}>Reject</Button></div> },
  ];
  return <section className="sk-panel"><div className="sk-panel__header"><div><h2>Requested operating coverage</h2><p className="skima-muted">Application requests never grant dispatch eligibility until an authorized review creates approved coverage.</p></div><StatusBadge>{query.data?.length ?? 0} pending</StatusBadge></div>{query.isLoading ? <LoadingState label="Loading coverage requests" /> : query.error ? <ErrorState title="Coverage requests unavailable" message={readError(query.error)} onRetry={() => void query.refetch()} /> : <DataTable caption="Requested operating coverage" columns={columns} records={query.data ?? []} getRowKey={(item) => item.id} emptyTitle="No pending requests" emptyMessage="Submitted driver and station coverage requests will appear here." />}<Dialog isOpen={Boolean(review)} title={`${review?.decision === "APPROVED" ? "Approve" : "Reject"} requested coverage`} onClose={() => setReview(null)} footer={<><Button variant="ghost" onClick={() => setReview(null)}>Cancel</Button><Button variant={review?.decision === "REJECTED" ? "destructive" : "primary"} isLoading={mutation.isPending} onClick={() => mutation.mutate()}>Confirm decision</Button></>}><TextAreaInput label="Decision reason" value={reason} onChange={(event) => setReason(event.currentTarget.value)} required />{mutation.error ? <StatusBadge tone="danger">{readError(mutation.error)}</StatusBadge> : null}</Dialog></section>;
}
