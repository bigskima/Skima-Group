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
  authorityMode: z.enum(["preparing", "universal", "retired"]),
  legacyAreaCount: z.coerce.number(),
  mappedCount: z.coerce.number(),
  verifiedCount: z.coerce.number(),
  blockedCount: z.coerce.number(),
  activeUniversalPolicyCount: z.coerce.number(),
  approvedDriversWithoutCoverage: z.coerce.number().default(0),
  approvedStationsWithoutCoverage: z.coerce.number().default(0),
  ready: z.boolean(),
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
const PlaceSearchSchema = z.object({
  provider: z.string(),
  predictions: z.array(z.object({
    description: z.string(),
    placeId: z.string().nullable().optional(),
    addressComponents: z.record(z.unknown()).nullable().optional(),
    structuredFormatting: z.object({
      mainText: z.string().optional(),
      secondaryText: z.string().optional(),
    }).partial().optional(),
  }).passthrough()),
}).passthrough();
type Geography = z.infer<typeof GeographySchema>;
type Policy = z.infer<typeof PolicySchema>;

interface GeographyForm { name: string; countryCode: string; levelId: string; parentId: string; boundary: string; source: string; externalReference: string }
interface PolicyForm { serviceKey: string; capabilityKey: string; geographyId: string; effect: "ALLOW" | "DENY"; priority: string; status: "draft" | "active"; startsAt: string; endsAt: string; reason: string }
const EMPTY_GEOGRAPHY: GeographyForm = { name: "", countryCode: "", levelId: "", parentId: "", boundary: "", source: "maps.provider", externalReference: "" };
const EMPTY_POLICY: PolicyForm = { serviceKey: "lpg", capabilityKey: "", geographyId: "", effect: "ALLOW", priority: "0", status: "draft", startsAt: "", endsAt: "", reason: "" };

export function AdminServiceCoverageWorkspace() {
  const { supabase, status } = useSessionState();
  const queryClient = useQueryClient();
  const [geographyOpen, setGeographyOpen] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [linkTargets, setLinkTargets] = useState<Record<string, string>>({});
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
    { key: "geography", header: "Service area", render: (p) => p.geographies?.canonical_name ?? "Area unavailable" },
    { key: "capability", header: "What this rule controls", render: (p) => <><strong>{friendlyServiceName(p.service_key)}</strong><br /><small>{friendlyCapabilityName(p.capability_key)}</small></> },
    { key: "effect", header: "Availability", render: (p) => <StatusBadge tone={p.effect === "ALLOW" ? "success" : "danger"}>{p.effect === "ALLOW" ? "Allowed" : "Blocked"}</StatusBadge> },
    { key: "priority", header: "Priority", render: (p) => p.priority },
    { key: "status", header: "Status", render: (p) => <StatusBadge tone={p.status === "active" ? "success" : "warning"}>{p.status}</StatusBadge> },
  ], []);
  const loading = adminSetup.isLoading;
  const error = adminSetup.error;
  return <>
    <PageHeader eyebrow="Service availability" title="Service Areas & Availability" description="Choose where SKIMA can operate. Areas are checked by their real map boundary, so customers, drivers, stations and refill orders use the same location rules." actions={<div className="skima-action-row"><Button icon={RefreshCcw} variant="outline" onClick={() => void refresh()}>Refresh</Button><Button icon={MapPinned} disabled={!adminSetup.data?.permissions.canManageGeographies} onClick={() => setGeographyOpen(true)}>Add service area</Button><Button icon={Plus} disabled={!adminSetup.data?.permissions.canManageCoverage} onClick={() => setPolicyOpen(true)}>Add availability rule</Button></div>} />
    <ProductionReadinessAlerts readiness={productionReadiness.data} error={productionReadiness.error}/>
    {notice ? <StatusBadge tone="success">{notice}</StatusBadge> : null}
    <section className="skima-grid skima-grid--compact">
      <MetricTile label="Mapped service areas" value={geographies.length} icon={MapPinned} tone="info" />
      <MetricTile label="Active service rules" value={records.filter((p) => p.status === "active").length} icon={ShieldCheck} tone="success" />
      <MetricTile label="Existing areas needing attention" value={readiness?.blockedCount ?? 0} icon={ShieldCheck} tone={(readiness?.blockedCount ?? 0) > 0 ? "warning" : "success"} />
      <MetricTile label="Coverage setup" value={readiness?.authorityMode === "universal" ? "Active" : readiness?.authorityMode === "preparing" ? "Setup in progress" : readiness?.authorityMode ?? "Loading"} icon={MapPinned} tone={readiness?.ready ? "success" : "warning"} />
    </section>
    <GeographyCutoverPanel readiness={readiness} geographies={geographies.filter((geography) => geography.status === "active")} />
    {loading ? <LoadingState label="Loading service areas" /> : null}
    {error ? <ErrorState title="Service areas unavailable" message={readError(error)} onRetry={() => void refresh()} /> : null}
    {!loading && !error ? <section className="sk-panel"><div className="sk-panel__header"><div><h2>Availability rules</h2><p className="skima-muted">These rules decide which SKIMA service is allowed or blocked inside each mapped area. A smaller local area can override a broader area.</p></div></div><DataTable caption="Service availability rules" columns={columns} records={records} getRowKey={(p) => p.id} emptyTitle="No service rules yet" emptyMessage="Add or import a mapped service area, then choose which SKIMA services are allowed there." /></section> : null}
    <CoverageRequestsPanel />
    <OperationalCoveragePanel geographies={geographies} />
    <CoverageMapPanel />
    <PointDiagnosticPanel />
    <DispatchDiagnosticPanel />
    <RetentionHealthPanel />
    <GeometryDraftRecoveryPanel />
    <ExpansionDemandPanel />
    <GeographyDialog open={geographyOpen} levels={levels} geographies={geographies} defaultCountryCode={adminSetup.data?.defaultCountryCode ?? ""} onClose={() => setGeographyOpen(false)} onSaved={async () => { setGeographyOpen(false); setNotice("Service area saved."); await refresh(); }} />
    <PolicyDialog open={policyOpen} geographies={geographies.filter((g) => g.status === "active")} onClose={() => setPolicyOpen(false)} onSaved={async () => { setPolicyOpen(false); setNotice("Availability rule saved."); await refresh(); }} />
  </>;
}

type GeographyMigration = z.infer<typeof GeographyMigrationSchema>;
function GeographyCutoverPanel({ readiness, geographies }: { readiness: z.infer<typeof ReadinessSchema> | undefined; geographies: Geography[] }) {
  const { supabase, status } = useSessionState();
  const client = useQueryClient();
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [linkTargets, setLinkTargets] = useState<Record<string, string>>({});
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

  const linkMapping = useMutation({
    mutationFn: async (mappingId: string) => {
      const geographyId = linkTargets[mappingId];
      if (!geographyId) throw new Error("Choose the mapped service area that replaces this older area.");
      if (!reason.trim()) throw new Error("Enter a review reason before linking a legacy area.");
      const { data, error } = await supabase.rpc("link_geography_migration_mapping", {
        p_mapping_id: mappingId,
        p_geography_id: geographyId,
        p_reason: reason.trim(),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async (_data, mappingId) => {
      setLinkTargets((current) => {
        const next = { ...current };
        delete next[mappingId];
        return next;
      });
      setNotice("Older area linked to a mapped service area. Review and verify it next.");
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

  const migratePolicies = useMutation({
    mutationFn: async () => {
      setNotice(null);
      const { data, error } = await supabase.rpc("migrate_verified_legacy_lpg_coverage_policies");
      if (error) throw error;
      return data as { inserted?: number } | null;
    },
    onSuccess: async (result) => {
      setNotice(`Verified LPG coverage migrated: ${result?.inserted ?? 0} new universal policy record(s).`);
      await refresh();
    },
  });

  const migrateOperationalCoverage = useMutation({
    mutationFn: async () => {
      setNotice(null);
      const { data, error } = await supabase.rpc("migrate_verified_operational_coverage");
      if (error) throw error;
      return data as { driverAssignmentsMigrated?: number; stationAssignmentsMigrated?: number } | null;
    },
    onSuccess: async (result) => {
      setNotice(
        `Operational coverage migrated: ${result?.driverAssignmentsMigrated ?? 0} driver assignment(s), ${result?.stationAssignmentsMigrated ?? 0} station assignment(s).`,
      );
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
    { key: "canonical", header: "Mapped service area", render: (item) => item.geography_name ?? "Not imported" },
    { key: "state", header: "Review state", render: (item) => <><StatusBadge tone={item.migration_status === "verified" ? "success" : item.migration_status === "blocked" ? "danger" : "warning"}>{item.migration_status}</StatusBadge><br /><small>{item.validation_code}</small></> },
    { key: "boundary", header: "Boundary", render: (item) => <StatusBadge tone={item.boundary_ready ? "success" : "danger"}>{item.boundary_ready ? "Valid" : "Needs correction"}</StatusBadge> },
    { key: "action", header: "Review", render: (item) => item.migration_status === "migrated"
      ? <Button size="sm" variant="outline" disabled={!item.boundary_ready || !reason.trim()} isLoading={verifyMapping.isPending && verifyMapping.variables === item.id} onClick={() => verifyMapping.mutate(item.id)}>Verify mapping</Button>
      : item.migration_status === "verified"
        ? <small>Reviewed</small>
        : item.migration_status === "blocked" || item.migration_status === "pending"
          ? <div className="skima-form-grid">
              <SelectInput
                label="Mapped service area"
                value={linkTargets[item.id] ?? ""}
                onChange={(event) => {
                  const nextValue = event.currentTarget.value;
                  setLinkTargets((current) => ({ ...current, [item.id]: nextValue }));
                }}
                options={[{ label: "Choose mapped service area", value: "" }, ...geographies.map((geography) => ({ label: geography.canonical_name, value: geography.id }))]}
              />
              <Button size="sm" variant="outline" disabled={!linkTargets[item.id] || !reason.trim()} isLoading={linkMapping.isPending && linkMapping.variables === item.id} onClick={() => linkMapping.mutate(item.id)}>Link for review</Button>
            </div>
          : <small>Retired</small> },
  ];

  const actionError =
    mappings.error ??
    importLegacy.error ??
    linkMapping.error ??
    verifyMapping.error ??
    migratePolicies.error ??
    migrateOperationalCoverage.error ??
    activateAuthority.error;
  return (
    <section className="sk-panel">
      <div className="sk-panel__header">
        <div>
          <h2>Existing location setup</h2>
          <p className="skima-muted">Bring older service-area records into the new map-based location system. Review anything that cannot be matched safely, then activate the new coverage system only when every required check passes.</p>
        </div>
        <div className="skima-action-row">
          <Button variant="outline" icon={RefreshCcw} disabled={importLegacy.isPending} onClick={() => importLegacy.mutate()}>Import existing areas</Button>
          <Button
            variant="outline"
            icon={ShieldCheck}
            disabled={migratePolicies.isPending || (readiness?.verifiedCount ?? 0) === 0}
            isLoading={migratePolicies.isPending}
            onClick={() => migratePolicies.mutate()}
          >
            Move verified LPG rules
          </Button>
          <Button
            variant="outline"
            icon={MapPinned}
            disabled={migrateOperationalCoverage.isPending}
            isLoading={migrateOperationalCoverage.isPending}
            onClick={() => migrateOperationalCoverage.mutate()}
          >
            Move driver & station areas
          </Button>
          {readiness?.authorityMode === "preparing"
            ? <Button icon={ShieldCheck} disabled={!readiness.ready || !reason.trim()} isLoading={activateAuthority.isPending} onClick={() => activateAuthority.mutate()}>Activate map-based coverage</Button>
            : null}
        </div>
      </div>
      <div className="skima-grid skima-grid--compact">
        <MetricTile label="Awaiting review" value={needsReview} icon={MapPinned} tone={needsReview ? "warning" : "success"} />
        <MetricTile label="Blocked imports" value={blocked} icon={ShieldCheck} tone={blocked ? "warning" : "success"} />
        <MetricTile label="Verified area links" value={readiness?.verifiedCount ?? 0} icon={ShieldCheck} tone="success" />
        <MetricTile label="Active service rules" value={readiness?.activeUniversalPolicyCount ?? 0} icon={ShieldCheck} tone={(readiness?.activeUniversalPolicyCount ?? 0) > 0 ? "success" : "warning"} />
        <MetricTile label="Approved drivers missing coverage" value={readiness?.approvedDriversWithoutCoverage ?? 0} icon={MapPinned} tone={(readiness?.approvedDriversWithoutCoverage ?? 0) > 0 ? "warning" : "success"} />
        <MetricTile label="Approved stations missing coverage" value={readiness?.approvedStationsWithoutCoverage ?? 0} icon={MapPinned} tone={(readiness?.approvedStationsWithoutCoverage ?? 0) > 0 ? "warning" : "success"} />
      </div>
      <TextAreaInput label="Reason for this change" helperText="Explain why you are making this change. SKIMA keeps this note in the audit history." value={reason} onChange={(event) => setReason(event.currentTarget.value)} />
      {notice ? <StatusBadge tone="success">{notice}</StatusBadge> : null}
      {actionError ? <StatusBadge tone="danger">{readError(actionError)}</StatusBadge> : null}
      {mappings.isLoading
        ? <LoadingState label="Loading geography migration review" />
        : <DataTable caption="Existing service-area review" columns={columns} records={records} getRowKey={(item) => item.id} emptyTitle="No older service areas to review" emptyMessage="Import older areas if they exist, or add a new mapped service area." />}
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
  return <section className="sk-panel"><div className="sk-panel__header"><div><h2>Expansion demand</h2><p className="skima-muted">Customer and partner interest is grouped by the mapped area that contains their location.</p></div></div>{query.isLoading ? <LoadingState label="Loading expansion demand" /> : query.error ? <ErrorState title="Expansion demand unavailable" message={readError(query.error)} onRetry={() => void query.refetch()} /> : <DataTable caption="Expansion demand by mapped service area" columns={columns} records={query.data ?? []} getRowKey={(item) => `${item.service_key}:${item.interest_type}:${item.geography_id ?? "unmapped"}`} emptyTitle="No expansion demand yet" emptyMessage="Launch notification and partner-interest requests will appear here." />}</section>;
}

function GeographyDialog({ open, levels, geographies, defaultCountryCode, onClose, onSaved }: { open: boolean; levels: z.infer<typeof LevelSchema>[]; geographies: Geography[]; defaultCountryCode: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const { supabase, api } = useSessionState();
  const [form, setForm] = useState(EMPTY_GEOGRAPHY);
  const [searchTerm, setSearchTerm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [draftId,setDraftId]=useState<string|null>(null);
  const placeSearch = useMutation({
    mutationFn: (input: string) => api.post(
      "/lpg/maps/autocomplete",
      { input },
      PlaceSearchSchema,
    ),
  });

  useEffect(() => {
    if (!open) return;
    setForm((current) => current.countryCode ? current : { ...current, countryCode: defaultCountryCode || "NG" });
  }, [open, defaultCountryCode]);

  if (!open) return null;
  const selectedLevel = levels.find((level) => level.id === form.levelId);
  const requiredParentLevelId = selectedLevel?.parent_level_id ?? null;
  const parentOptions = requiredParentLevelId
    ? geographies.filter((geography) => geography.status === "active" && geography.geography_level_id === requiredParentLevelId)
    : [];

  const selectPlace = (prediction: z.infer<typeof PlaceSearchSchema>["predictions"][number]) => {
    const name = placeNameForLevel(prediction, selectedLevel?.key);
    const countryCode = readRecordString(prediction.addressComponents, "countryCode")?.toUpperCase() || form.countryCode || "NG";
    setForm({
      ...form,
      name,
      countryCode,
      source: `maps.${placeSearch.data?.provider ?? "provider"}`,
      externalReference: prediction.placeId ?? "",
    });
    setSearchTerm(prediction.description);
    setError(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.name.trim()) {
      setError("Search for the place and choose the correct result before saving.");
      return;
    }
    if (requiredParentLevelId && !form.parentId) {
      setError("Choose the larger area this place belongs to first.");
      return;
    }
    if (!form.boundary.trim()) {
      setError("Draw or import the real map boundary before saving this service area.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const boundary = JSON.parse(form.boundary) as unknown;
      const { data:savedDraft,error:draftError}=await supabase.rpc("save_coverage_geometry_draft",{p_draft_id:draftId,p_draft_type:"GEOGRAPHY_BOUNDARY",p_target_id:null,p_parent_geography_id:form.parentId||null,p_geojson:boundary});
      if(draftError)throw draftError;
      setDraftId(savedDraft as string);
      const { data:geographyId,error: rpcError } = await supabase.rpc("configure_universal_geography", {
        p_geography_id: null,
        p_parent_id: form.parentId || null,
        p_level_id: form.levelId,
        p_canonical_name: form.name.trim(),
        p_country_code: form.countryCode.trim().toUpperCase(),
        p_boundary_geojson: boundary,
        p_source: form.source.trim(),
        p_external_reference: form.externalReference || null,
        p_status: "active",
        p_aliases: [],
        p_metadata: { sourceSurface: "admin_geography", geometryDraftId:savedDraft, operatorSelectedPlace: searchTerm },
      });
      if (rpcError) throw rpcError;
      const{error:activationError}=await supabase.rpc("activate_coverage_geometry_draft",{p_draft_id:savedDraft,p_target_id:geographyId,p_reason:`Activated mapped service area: ${form.name.trim()}`});
      if(activationError)throw activationError;
      setForm(EMPTY_GEOGRAPHY);
      setSearchTerm("");
      setDraftId(null);
      await onSaved();
    } catch (cause) {
      setError(readError(cause));
    } finally {
      setSaving(false);
    }
  };

  return <Dialog
    isOpen
    title="Add service area"
    onClose={onClose}
    footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" form="geography-form" isLoading={saving}>Save service area</Button></>}
  >
    <form id="geography-form" className="skima-form-grid" onSubmit={(e) => void submit(e)}>
      <div className="skima-form-help">
        <strong>1. Choose the kind of area</strong>
        <p>For Nigeria, use State for Anambra, LGA for Awka South, and City / town for a specific town. You do not need to know database terms.</p>
      </div>
      <TextInput label="Country" value={countryDisplayName(form.countryCode)} disabled />
      <SelectInput
        label="Area type"
        value={form.levelId}
        onChange={(e) => {
          const levelId=e.currentTarget.value;
          const nextLevel=levels.find((level)=>level.id===levelId);
          const requiredParent=nextLevel?.parent_level_id ?? null;
          const parentStillValid=Boolean(requiredParent && geographies.some((geography)=>geography.id===form.parentId && geography.geography_level_id===requiredParent));
          setForm({ ...form, levelId, parentId: parentStillValid ? form.parentId : "", name: "", externalReference: "" });
          setSearchTerm("");
          placeSearch.reset();
        }}
        options={[{ label: "Choose area type", value: "" }, ...levels.map((level) => ({ label: operatorLevelName(level, form.countryCode), value: level.id }))]}
        required
      />
      {requiredParentLevelId ? <SelectInput
        label="Inside"
        value={form.parentId}
        onChange={(e) => setForm({ ...form, parentId: e.currentTarget.value })}
        options={[{ label: parentOptions.length ? "Choose the larger area" : "Add the larger area first", value: "" }, ...parentOptions.map((geography) => ({ label: geography.canonical_name, value: geography.id }))]}
        required
        disabled={!parentOptions.length}
      /> : null}
      {requiredParentLevelId && parentOptions.length === 0 ? <StatusBadge tone="warning">This area needs its larger parent area first. For example: add Nigeria before Anambra, then Anambra before Awka South.</StatusBadge> : null}

      <div className="skima-form-help">
        <strong>2. Find the place</strong>
        <p>Search and select a result. SKIMA fills the official place name for you; operators do not type an internal name.</p>
      </div>
      <div className="skima-inline-search">
        <TextInput
          label="Search place"
          placeholder={selectedLevel ? "Example: Awka South, Anambra" : "Choose an area type first"}
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.currentTarget.value)}
          disabled={!selectedLevel}
        />
        <Button
          type="button"
          variant="outline"
          disabled={!selectedLevel || searchTerm.trim().length < 3}
          isLoading={placeSearch.isPending}
          onClick={() => placeSearch.mutate(searchTerm.trim())}
        >
          Search map
        </Button>
      </div>
      {placeSearch.error ? <StatusBadge tone="danger">{readError(placeSearch.error)}</StatusBadge> : null}
      {placeSearch.data?.predictions.length ? <div className="skima-place-results" role="list">
        {placeSearch.data.predictions.slice(0, 6).map((prediction) => <button
          type="button"
          key={prediction.placeId ?? prediction.description}
          onClick={() => selectPlace(prediction)}
        >
          <strong>{prediction.structuredFormatting?.mainText ?? prediction.description.split(",")[0]}</strong>
          <span>{prediction.structuredFormatting?.secondaryText ?? prediction.description}</span>
        </button>)}
      </div> : null}
      <div className="skima-selected-place">
        <small>Selected place</small>
        <strong>{form.name || "No place selected yet"}</strong>
        {form.name ? <span>{searchTerm}</span> : null}
      </div>

      <div className="skima-form-help">
        <strong>3. Confirm the real boundary</strong>
        <p>Use the map to outline the service area. This boundary—not the typed address—is what SKIMA uses to decide availability.</p>
      </div>
      <AdminGeometryEditor mode="polygon" value={form.boundary} onChange={(boundary)=>setForm({...form,boundary})}/>
      {draftId?<StatusBadge tone="info">Your boundary draft is saved while you finish.</StatusBadge>:null}
      {error ? <StatusBadge tone="danger">{error}</StatusBadge> : null}
    </form>
  </Dialog>;
}

function PolicyDialog({ open, geographies, onClose, onSaved }: { open: boolean; geographies: Geography[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const { supabase } = useSessionState(); const [form, setForm] = useState(EMPTY_POLICY); const [error, setError] = useState<string | null>(null); const [saving, setSaving] = useState(false); const [preview, setPreview] = useState<{ signature: string; result: z.infer<typeof PolicyPreviewSchema> } | null>(null);
  if (!open) return null;
  const signature = JSON.stringify(form);
  const submit = async (event: FormEvent) => { event.preventDefault(); setSaving(true); setError(null); try { if (form.status === "active" && preview?.signature !== signature) { const { data, error: previewError } = await supabase.rpc("preview_universal_service_policy", { p_policy_id: null, p_service_key: form.serviceKey.trim(), p_capability_key: form.capabilityKey.trim(), p_geography_id: form.geographyId, p_priority: Number(form.priority), p_starts_at: form.startsAt || null, p_ends_at: form.endsAt || null }); if (previewError) throw previewError; const result = PolicyPreviewSchema.parse(data); setPreview({ signature, result }); if (!result.canActivate) { setError("This rule conflicts with another rule for the same area. Change the rule strength or review the existing rule first."); } return; } const { error: rpcError } = await supabase.rpc("configure_universal_service_policy", { p_policy_id: null, p_service_key: form.serviceKey.trim(), p_capability_key: form.capabilityKey.trim(), p_geography_id: form.geographyId, p_effect: form.effect, p_priority: Number(form.priority), p_status: form.status, p_starts_at: form.startsAt || null, p_ends_at: form.endsAt || null, p_reason: form.reason.trim(), p_configuration: { sourceSurface: "admin_coverage", activationPreviewed: form.status === "active" } }); if (rpcError) throw rpcError; setForm(EMPTY_POLICY); setPreview(null); await onSaved(); } catch (cause) { setError(readError(cause)); } finally { setSaving(false); } };
  const reviewed = form.status !== "active" || preview?.signature === signature;
  return <Dialog isOpen title="Add availability rule" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" form="policy-form" isLoading={saving} disabled={Boolean(preview?.signature === signature && !preview.result.canActivate)}>{form.status === "active" && !reviewed ? "Check this rule" : "Save rule"}</Button></>}><form id="policy-form" className="skima-form-grid" onSubmit={(e) => void submit(e)}>
    <div className="skima-form-help"><strong>Choose what SKIMA should allow in this area</strong><p>For the LPG service, pick the customer, driver, or station action this rule controls.</p></div>
    <SelectInput label="SKIMA service" value={form.serviceKey} onChange={(e) => setForm({ ...form, serviceKey: e.currentTarget.value })} options={[{ label: "LPG refill service", value: "lpg" }]} required />
    <SelectInput label="Who / what can use this area?" value={form.capabilityKey} onChange={(e) => setForm({ ...form, capabilityKey: e.currentTarget.value })} options={[
      { label: "Choose what this rule controls", value: "" },
      { label: "Customers can place refill orders", value: "customer_ordering" },
      { label: "Drivers can register and operate", value: "driver_onboarding" },
      { label: "Stations can register and operate", value: "station_onboarding" },
    ]} required />
    <SelectInput label="Service area" value={form.geographyId} onChange={(e) => setForm({ ...form, geographyId: e.currentTarget.value })} options={[{ label: "Choose service area", value: "" }, ...geographies.map((g) => ({ label: g.canonical_name, value: g.id }))]} required />
    <SelectInput label="Availability" value={form.effect} onChange={(e) => setForm({ ...form, effect: e.currentTarget.value as "ALLOW" | "DENY" })} options={[{ label: "Allow this service here", value: "ALLOW" }, { label: "Block this service here", value: "DENY" }]} />
    <TextInput label="Rule strength (advanced)" helperText="Leave this at 0 unless you intentionally need one rule to win over another at the same map level." type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.currentTarget.value })} />
    <SelectInput label="Turn this rule on?" value={form.status} onChange={(e) => setForm({ ...form, status: e.currentTarget.value as "draft" | "active" })} options={[{ label: "Save for review", value: "draft" }, { label: "Turn on now", value: "active" }]} />
    <TextInput label="Starts on (optional)" type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.currentTarget.value })} />
    <TextInput label="Ends on (optional)" type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.currentTarget.value })} />
    <TextAreaInput label="Why are you making this change?" helperText="Required when turning the rule on. SKIMA keeps this note in the audit history." value={form.reason} onChange={(e) => setForm({ ...form, reason: e.currentTarget.value })} required={form.status === "active"} />
    {preview?.signature === signature ? <PolicyPreview result={preview.result} /> : null}
    {error ? <StatusBadge tone="danger">{error}</StatusBadge> : null}
  </form></Dialog>;
}
function PolicyPreview({ result }: { result: z.infer<typeof PolicyPreviewSchema> }) { return <section className="sk-panel"><h3>Rule check</h3><p className="skima-muted">Area: {result.target.geographyName}. Broader rules: {result.broaderPolicies.length}. Smaller-area overrides: {result.narrowerPolicies.length}.</p><StatusBadge tone={result.canActivate ? "success" : "danger"}>{result.canActivate ? "This rule can be turned on safely" : `${result.conflicts.length} conflicting rule(s) need attention`}</StatusBadge>{result.conflicts.map((item) => <p key={item.policyId}><strong>{item.geographyName}</strong> — {item.effect === "ALLOW" ? "Allowed" : "Blocked"}, rule strength {item.priority}</p>)}</section>; }
function readError(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const message = [record.message, record.details, record.hint, record.code]
      .find((value) => typeof value === "string" && value.trim());
    if (typeof message === "string") return message;
  }
  return "The service-area action could not be completed. Refresh and try again.";
}
function readRecordString(record: Record<string, unknown> | null | undefined, key: string) {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function placeNameForLevel(prediction: z.infer<typeof PlaceSearchSchema>["predictions"][number], levelKey?: string) {
  const address = prediction.addressComponents;
  const byLevel: Record<string, string | null> = {
    country: readRecordString(address, "country"),
    admin_level_1: readRecordString(address, "state") ?? readRecordString(address, "region"),
    admin_level_2: readRecordString(address, "lga") ?? readRecordString(address, "district"),
    locality: readRecordString(address, "city") ?? readRecordString(address, "town") ?? readRecordString(address, "locality"),
    sublocality: readRecordString(address, "subLocality") ?? readRecordString(address, "neighbourhood"),
  };
  return (levelKey ? byLevel[levelKey] : null)
    ?? prediction.structuredFormatting?.mainText?.trim()
    ?? prediction.description.split(",")[0]?.trim()
    ?? prediction.description;
}
function operatorLevelName(level: z.infer<typeof LevelSchema>, countryCode: string) {
  if ((countryCode || "NG").toUpperCase() === "NG") {
    if (level.key === "country") return "Country";
    if (level.key === "admin_level_1") return "State";
    if (level.key === "admin_level_2") return "Local Government Area (LGA)";
    if (level.key === "locality") return "City / town";
    if (level.key === "sublocality") return "Community / neighbourhood";
    if (level.key === "custom_zone") return "Custom service area";
  }
  return level.display_name;
}
function countryDisplayName(code: string) {
  return code.toUpperCase() === "NG" ? "Nigeria" : code || "Set by map search";
}
function friendlyServiceName(key: string) {
  return key === "lpg" ? "LPG refill service" : key.replaceAll("_", " ");
}
function friendlyCapabilityName(key: string) {
  const labels: Record<string, string> = {
    customer_ordering: "Customers can place refill orders",
    driver_onboarding: "Drivers can register and operate",
    station_onboarding: "Stations can register and operate",
  };
  return labels[key] ?? key.replaceAll("_", " ");
}

type OperationalCoverage = z.infer<typeof OperationalCoverageSchema>;
interface OperationalCoverageForm { entityType: string; entityId: string; serviceKey: string; coverageType: "ADMIN_GEOGRAPHY" | "RADIUS" | "CUSTOM_ZONE"; geographyId: string; longitude: string; latitude: string; radius: string; geometry: string; status: "active" | "paused" | "retired"; validFrom: string; validTo: string; reason: string }
const EMPTY_OPERATIONAL_COVERAGE: OperationalCoverageForm = { entityType: "DRIVER", entityId: "", serviceKey: "lpg", coverageType: "ADMIN_GEOGRAPHY", geographyId: "", longitude: "", latitude: "", radius: "", geometry: "", status: "active", validFrom: "", validTo: "", reason: "" };
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
  return <section className="sk-panel"><div className="sk-panel__header"><div><h2>Driver & station operating areas</h2><p className="skima-muted">Control where an approved driver or station is allowed to operate. Choose a mapped service area, a distance around a point, or draw a custom area on the map.</p></div><Button icon={Plus} onClick={() => setEditing("new")}>Add operating area</Button></div>{query.isLoading ? <LoadingState label="Loading approved operational coverage" /> : query.error ? <ErrorState title="Operational coverage unavailable" message={readError(query.error)} onRetry={() => void query.refetch()} /> : <DataTable caption="Driver and station operating areas" columns={columns} records={query.data ?? []} getRowKey={(item) => item.id} emptyTitle="No operating areas yet" emptyMessage="Approved driver and station operating areas will appear here after you add them." />}<OperationalCoverageDialog record={editing} geographies={geographies} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await client.invalidateQueries({ queryKey: ["universal-operational-coverage"] }); }} /></section>;
}
function OperationalCoverageDialog({ record, geographies, onClose, onSaved }: { record: OperationalCoverage | "new" | null; geographies: Geography[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const { supabase } = useSessionState();
  const [form, setForm] = useState(EMPTY_OPERATIONAL_COVERAGE);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(record && record !== "new" ? operationalCoverageForm(record) : EMPTY_OPERATIONAL_COVERAGE);
    setError(null);
  }, [record]);

  if (!record) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (!form.entityId.trim()) throw new Error("Choose or enter the driver or station record this operating area belongs to.");
      if (form.coverageType === "ADMIN_GEOGRAPHY" && !form.geographyId) {
        throw new Error("Choose a mapped service area.");
      }
      if (form.coverageType === "RADIUS" && (!form.longitude || !form.latitude || !form.radius || Number(form.radius) <= 0)) {
        throw new Error("Tap the map to choose the centre point, then enter how far this operating area should extend.");
      }
      if (form.coverageType === "CUSTOM_ZONE" && !form.geometry.trim()) {
        throw new Error("Draw the custom operating area on the map before saving.");
      }

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
        p_entity_type: form.entityType.trim().toUpperCase(),
        p_entity_id: form.entityId.trim(),
        p_service_key: form.serviceKey.trim(),
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
        p_metadata: { sourceSurface: "admin_operational_coverage", geometryDraftId },
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
      await onSaved();
    } catch (cause) {
      setError(readError(cause));
    } finally {
      setSaving(false);
    }
  };

  const radiusPoint = form.longitude && form.latitude
    ? [Number(form.longitude), Number(form.latitude)] as const
    : null;

  return <Dialog
    isOpen
    title={record === "new" ? "Add driver or station operating area" : "Edit operating area"}
    onClose={onClose}
    footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" form="operational-coverage-form" isLoading={saving}>Save operating area</Button></>}
  >
    <form id="operational-coverage-form" className="skima-form-grid" onSubmit={(event) => void submit(event)}>
      <div className="skima-form-help">
        <strong>Who is this operating area for?</strong>
        <p>Choose whether this belongs to a driver or station, then enter the record ID shown on that partner's admin profile.</p>
      </div>
      <SelectInput
        label="Partner type"
        value={form.entityType}
        onChange={(event) => setForm({ ...form, entityType: event.currentTarget.value })}
        options={[{ label: "Driver", value: "DRIVER" }, { label: "Station", value: "STATION" }]}
        required
      />
      <TextInput
        label={form.entityType === "STATION" ? "Station record ID" : "Driver record ID"}
        helperText="Copy this from the partner's admin details. SKIMA uses it to attach the area to the correct account."
        value={form.entityId}
        onChange={(event) => setForm({ ...form, entityId: event.currentTarget.value })}
        required
      />
      <SelectInput
        label="SKIMA service"
        value={form.serviceKey}
        onChange={(event) => setForm({ ...form, serviceKey: event.currentTarget.value })}
        options={[{ label: "LPG refill service", value: "lpg" }]}
        required
      />

      <div className="skima-form-help">
        <strong>How should the area be defined?</strong>
        <p>Use a mapped service area when possible. Use a distance for nearby coverage, or draw a custom area only when the operating boundary crosses normal map areas.</p>
      </div>
      <SelectInput
        label="Area method"
        value={form.coverageType}
        onChange={(event) => setForm({ ...form, coverageType: event.currentTarget.value as OperationalCoverageForm["coverageType"] })}
        options={[
          { label: "Use a mapped service area", value: "ADMIN_GEOGRAPHY" },
          { label: "Use a distance around a point", value: "RADIUS" },
          { label: "Draw a custom area", value: "CUSTOM_ZONE" },
        ]}
      />

      {form.coverageType === "ADMIN_GEOGRAPHY" ? <SelectInput
        label="Mapped service area"
        value={form.geographyId}
        onChange={(event) => setForm({ ...form, geographyId: event.currentTarget.value })}
        options={[{ label: "Choose service area", value: "" }, ...geographies.filter((item) => item.status === "active").map((item) => ({ label: item.canonical_name, value: item.id }))]}
        required
      /> : null}

      {form.coverageType === "RADIUS" ? <>
        <div className="skima-form-help">
          <strong>Tap the map to set the centre</strong>
          <p>Then enter the distance from that point. You do not need to type latitude or longitude.</p>
        </div>
        <AdminGeometryEditor
          mode="point"
          point={radiusPoint}
          onPointChange={([longitude, latitude]) => setForm({ ...form, longitude: String(longitude), latitude: String(latitude) })}
        />
        <TextInput
          label="Distance from the centre (metres)"
          type="number"
          value={form.radius}
          onChange={(event) => setForm({ ...form, radius: event.currentTarget.value })}
          required
        />
      </> : null}

      {form.coverageType === "CUSTOM_ZONE" ? <>
        <div className="skima-form-help">
          <strong>Draw the operating boundary</strong>
          <p>Click the map to outline the area. SKIMA stores the map shape automatically; no map code needs to be typed.</p>
        </div>
        <AdminGeometryEditor mode="polygon" value={form.geometry} onChange={(geometry) => setForm({ ...form, geometry })} />
      </> : null}

      <SelectInput
        label="Operating status"
        value={form.status}
        onChange={(event) => setForm({ ...form, status: event.currentTarget.value as OperationalCoverageForm["status"] })}
        options={[
          { label: "Active — can operate now", value: "active" },
          { label: "Paused — temporarily unavailable", value: "paused" },
          { label: "Retired — no longer used", value: "retired" },
        ]}
      />
      <TextInput label="Starts on (optional)" type="datetime-local" value={form.validFrom} onChange={(event) => setForm({ ...form, validFrom: event.currentTarget.value })} />
      <TextInput label="Ends on (optional)" type="datetime-local" value={form.validTo} onChange={(event) => setForm({ ...form, validTo: event.currentTarget.value })} />
      <TextAreaInput
        label="Why are you making this change?"
        helperText="Required. SKIMA keeps this note in the permanent change history."
        value={form.reason}
        onChange={(event) => setForm({ ...form, reason: event.currentTarget.value })}
        required
      />
      {error ? <StatusBadge tone="danger">{error}</StatusBadge> : null}
    </form>
  </Dialog>;
}

function operationalCoverageForm(record: OperationalCoverage): OperationalCoverageForm { return { entityType: record.entity_type, entityId: record.entity_id, serviceKey: record.service_key, coverageType: record.coverage_type, geographyId: record.geography_id ?? "", longitude: record.center_longitude?.toString() ?? "", latitude: record.center_latitude?.toString() ?? "", radius: record.radius_meters?.toString() ?? "", geometry: record.coverage_geojson ? JSON.stringify(record.coverage_geojson, null, 2) : "", status: record.status === "paused" || record.status === "retired" ? record.status : "active", validFrom: toLocalDateTime(record.valid_from), validTo: toLocalDateTime(record.valid_to), reason: "" }; }
function toLocalDateTime(value: string | null) { if (!value) return ""; const date = new Date(value); if (Number.isNaN(date.getTime())) return ""; const offset = date.getTimezoneOffset() * 60_000; return new Date(date.getTime() - offset).toISOString().slice(0, 16); }

type CoverageMapFeature = z.infer<typeof CoverageMapFeatureSchema>;
function CoverageMapPanel() {
  const { supabase, status } = useSessionState(); const [serviceKey, setServiceKey] = useState(""); const [capabilityKey, setCapabilityKey] = useState(""); const [entityType,setEntityType]=useState(""); const [entityId,setEntityId]=useState(""); const [applicationId,setApplicationId]=useState("");
  const filters=[serviceKey,capabilityKey,entityType,entityId,applicationId] as const;
  const validFilters=(!entityId.trim()||isUuid(entityId))&&(!applicationId.trim()||isUuid(applicationId));
  const query = useQuery({ queryKey: ["universal-coverage-map", ...filters], enabled: status === "authenticated"&&validFilters, queryFn: async () => { const now=new Date().toISOString(); const [{data,error},{data:evidenceData,error:evidenceError}]=await Promise.all([supabase.rpc("read_coverage_map_features", { p_service_key: serviceKey.trim() || null, p_capability_key: capabilityKey.trim() || null, p_entity_type: entityType.trim().toUpperCase()||null, p_entity_id: uuidOrNull(entityId), p_at: now, p_limit: 500, p_simplify_tolerance: 0.00001 }),supabase.rpc("read_coverage_evidence_map_features",{p_service_key:serviceKey.trim()||null,p_entity_type:entityType.trim().toUpperCase()||null,p_entity_id:uuidOrNull(entityId),p_application_id:uuidOrNull(applicationId),p_at:now,p_limit:500,p_simplify_tolerance:0.00001})]); if (error) throw error;if(evidenceError)throw evidenceError;const effective=CoverageMapSchema.parse(data),evidence=CoverageMapSchema.parse(evidenceData);return{...effective,truncated:effective.truncated||evidence.truncated,features:[...effective.features,...evidence.features]}; }});
  return <section className="sk-panel"><div className="sk-panel__header"><div><h2>Coverage map</h2><p className="skima-muted">See service rules, approved partner areas, requested partner areas, operating bases, application locations, and recent authorized live locations as separate map layers.</p></div><Button variant="outline" disabled={!validFilters} onClick={() => void query.refetch()}>Refresh map</Button></div><div className="skima-form-grid"><TextInput label="SKIMA service filter" helperText="Leave empty to show every configured service." value={serviceKey} onChange={(event) => setServiceKey(event.currentTarget.value)} /><TextInput label="Activity filter (advanced)" value={capabilityKey} onChange={(event) => setCapabilityKey(event.currentTarget.value)} /><TextInput label="Partner type" value={entityType} onChange={(event)=>setEntityType(event.currentTarget.value)}/><TextInput label="Partner record ID" value={entityId} onChange={(event)=>setEntityId(event.currentTarget.value)}/><TextInput label="Application record ID" value={applicationId} onChange={(event)=>setApplicationId(event.currentTarget.value)}/></div>{!validFilters?<StatusBadge tone="warning">Partner and application record IDs are incomplete. Copy the full ID from the relevant admin record.</StatusBadge>:query.isLoading ? <LoadingState label="Loading coverage map" /> : query.error ? <ErrorState title="Coverage map unavailable" message={readError(query.error)} onRetry={() => void query.refetch()} /> : <CoverageGeometryMap features={query.data?.features ?? []} truncated={query.data?.truncated ?? false} />}</section>;
}
function CoverageGeometryMap({ features, truncated }: { features: CoverageMapFeature[]; truncated: boolean }) {
  const layerNames=[...new Set(features.map((feature)=>feature.properties.layer))];const[hiddenLayers,setHiddenLayers]=useState<string[]>([]);const visibleFeatures=features.filter((feature)=>!hiddenLayers.includes(feature.properties.layer));
  const points = visibleFeatures.flatMap((feature) => geometryPoints(feature.geometry.coordinates));
  if (features.length === 0) return <ErrorState title="No coverage found" message="No active service rules or approved partner operating areas match these filters." />;
  if (points.length === 0) return <div><div className="skima-action-row">{layerNames.map((layer)=><Button key={layer} size="sm" variant="outline" aria-pressed={false} onClick={()=>setHiddenLayers((current)=>current.filter((item)=>item!==layer))}>{layer.replaceAll("_"," ")}</Button>)}</div><p className="skima-muted">All map layers are hidden. Select a layer to show it.</p></div>;
  const longitudes = points.map(([longitude]) => longitude); const latitudes = points.map(([, latitude]) => latitude); const minLongitude = Math.min(...longitudes); const maxLongitude = Math.max(...longitudes); const minLatitude = Math.min(...latitudes); const maxLatitude = Math.max(...latitudes); const longitudeSpan = Math.max(maxLongitude - minLongitude, 0.001); const latitudeSpan = Math.max(maxLatitude - minLatitude, 0.001); const project = ([longitude, latitude]: [number, number]) => [24 + ((longitude - minLongitude) / longitudeSpan) * 852, 436 - ((latitude - minLatitude) / latitudeSpan) * 412] as const;
  return <div><div className="skima-action-row">{layerNames.map((layer)=><Button key={layer} size="sm" variant={hiddenLayers.includes(layer)?"outline":"primary"} aria-pressed={!hiddenLayers.includes(layer)} onClick={()=>setHiddenLayers((current)=>current.includes(layer)?current.filter((item)=>item!==layer):[...current,layer])}>{layer.replaceAll("_"," ")}</Button>)}{truncated ? <StatusBadge tone="warning">Too many map items — narrow the filters</StatusBadge> : null}</div><svg role="img" aria-label="Effective service and operational coverage geometry" viewBox="0 0 900 460" style={{ width: "100%", minHeight: 360, background: "#f5f7f8", border: "1px solid #d9e0e3", borderRadius: 16 }}><defs><pattern id="coverage-grid" width="45" height="45" patternUnits="userSpaceOnUse"><path d="M 45 0 L 0 0 0 45" fill="none" stroke="#dce4e7" strokeWidth="1" /></pattern></defs><rect width="900" height="460" fill="url(#coverage-grid)" />{visibleFeatures.map((feature) => feature.geometry.type==="Point"?<MapEvidencePoint key={`${feature.properties.layer}:${feature.id}`} feature={feature} project={project}/>:<path key={`${feature.properties.layer}:${feature.id}`} d={geometryPath(feature.geometry.coordinates, project)} fill={feature.properties.layer === "OPERATIONAL_COVERAGE" ? "#246bdb55" : feature.properties.layer==="REQUESTED_COVERAGE"?"#d98b2455":feature.properties.effect === "DENY" ? "#d9383855" : "#1d9b6255"} stroke={feature.properties.layer === "OPERATIONAL_COVERAGE" ? "#246bdb" : feature.properties.layer==="REQUESTED_COVERAGE"?"#b86a10":feature.properties.effect === "DENY" ? "#b42323" : "#157a4c"} strokeWidth="2" strokeDasharray={feature.properties.layer==="REQUESTED_COVERAGE"?"8 5":undefined} fillRule="evenodd"><title>{feature.properties.name} — {feature.properties.layer}</title></path>)}</svg><p className="skima-muted">Use the buttons above to show or hide map layers. Recent driver locations appear only for admins with tracking permission.</p></div>;
}
function MapEvidencePoint({feature,project}:{feature:CoverageMapFeature;project:(point:[number,number])=>readonly[number,number]}){const points=geometryPoints(feature.geometry.coordinates);if(!points[0])return null;const[x,y]=project(points[0]);const color=feature.properties.layer==="LIVE_LOCATION"?"#d93838":feature.properties.layer==="OPERATING_BASE"?"#6b3fd1":"#334e68";return <g><circle cx={x} cy={y} r={feature.properties.layer==="LIVE_LOCATION"?9:7} fill={color} stroke="white" strokeWidth="3"/><title>{feature.properties.name} — {feature.properties.layer}</title></g>;}
function isUuid(value:string){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());}
function uuidOrNull(value:string){return isUuid(value)?value.trim():null;}
function geometryPoints(value: unknown): [number, number][] { if (!Array.isArray(value)) return []; if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number" && Number.isFinite(value[0]) && Number.isFinite(value[1])) return [[value[0], value[1]]]; return value.flatMap(geometryPoints); }
function geometryPath(value: unknown, project: (point: [number, number]) => readonly [number, number]): string { if (!Array.isArray(value)) return ""; if (value.length > 0 && Array.isArray(value[0]) && typeof value[0][0] === "number") { const ring = geometryPoints(value); return ring.map((point, index) => { const [x, y] = project(point); return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`; }).join(" ") + " Z"; } return value.map((part) => geometryPath(part, project)).join(" "); }

function PointDiagnosticPanel() {
  const { supabase } = useSessionState();
  const [serviceKey,setServiceKey]=useState("lpg");
  const [capabilityKey,setCapabilityKey]=useState("customer_ordering");
  const [longitude,setLongitude]=useState("");
  const [latitude,setLatitude]=useState("");
  const [entityType,setEntityType]=useState("");
  const [entityId,setEntityId]=useState("");
  const [result,setResult]=useState<z.infer<typeof PointDiagnosticSchema>|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [loading,setLoading]=useState(false);
  const point = longitude && latitude ? [Number(longitude), Number(latitude)] as const : null;

  const diagnose=async(event:FormEvent)=>{
    event.preventDefault();
    if (!longitude || !latitude) {
      setError("Tap the map to choose the location you want to check.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const{data,error:rpcError}=await supabase.rpc("diagnose_coverage_point",{
        p_service_key:serviceKey.trim(),
        p_capability_key:capabilityKey.trim(),
        p_longitude:Number(longitude),
        p_latitude:Number(latitude),
        p_entity_type:entityType.trim().toUpperCase()||null,
        p_entity_id:entityId.trim()||null,
        p_at:new Date().toISOString()
      });
      if(rpcError)throw rpcError;
      setResult(PointDiagnosticSchema.parse(data));
    } catch(cause) {
      setError(readError(cause));
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const available=result?.availability.available===true;
  return <section className="sk-panel">
    <div className="sk-panel__header">
      <div>
        <h2>Check a location</h2>
        <p className="skima-muted">Tap an exact point on the map to see whether the selected SKIMA activity is allowed there and which mapped area or partner coverage affected the result.</p>
      </div>
    </div>
    <form className="skima-form-grid" onSubmit={(event)=>void diagnose(event)}>
      <SelectInput
        label="SKIMA service"
        value={serviceKey}
        onChange={(event)=>setServiceKey(event.currentTarget.value)}
        options={[{label:"LPG refill service",value:"lpg"}]}
        required
      />
      <SelectInput
        label="What do you want to check?"
        value={capabilityKey}
        onChange={(event)=>setCapabilityKey(event.currentTarget.value)}
        options={[
          {label:"Can customers place refill orders here?",value:"customer_ordering"},
          {label:"Can drivers register and operate here?",value:"driver_onboarding"},
          {label:"Can stations register and operate here?",value:"station_onboarding"},
        ]}
        required
      />
      <div className="skima-form-help">
        <strong>Choose the test location</strong>
        <p>Click the map. SKIMA will use the exact map point automatically; you do not need to type coordinates.</p>
      </div>
      <AdminGeometryEditor
        mode="point"
        point={point}
        onPointChange={([nextLongitude,nextLatitude])=>{
          setLongitude(String(nextLongitude));
          setLatitude(String(nextLatitude));
        }}
      />
      <details className="skima-advanced-options">
        <summary>Optional partner-specific check</summary>
        <div className="skima-form-grid">
          <SelectInput
            label="Partner type"
            value={entityType}
            onChange={(event)=>setEntityType(event.currentTarget.value)}
            options={[{label:"No specific partner",value:""},{label:"Driver",value:"DRIVER"},{label:"Station",value:"STATION"}]}
          />
          <TextInput
            label="Partner record ID"
            helperText="Only use this when you need to test one specific driver or station."
            value={entityId}
            onChange={(event)=>setEntityId(event.currentTarget.value)}
          />
        </div>
      </details>
      <Button type="submit" isLoading={loading}>Check this location</Button>
    </form>
    {error?<StatusBadge tone="danger">{error}</StatusBadge>:null}
    {result?<div className="skima-grid skima-grid--compact">
      <MetricTile label="Availability" value={available?"Allowed":"Not allowed"} icon={ShieldCheck} tone={available?"success":"warning"}/>
      <MetricTile label="Mapped areas found" value={result.matchedGeographies.length} icon={MapPinned} tone="info"/>
      <MetricTile label="Approved partner areas" value={result.approvedAssignments.length} icon={ShieldCheck} tone="success"/>
      <MetricTile label="Partner requests waiting" value={result.requestedCoverage.length} icon={MapPinned} tone="warning"/>
      <section className="sk-panel">
        <h3>How the boundary was handled</h3>
        <p className="skima-muted">A point exactly on the edge of a mapped area is treated consistently as part of that area.</p>
      </section>
      <details className="sk-panel">
        <summary><strong>Technical evidence</strong></summary>
        <p className="skima-muted">Use this only when an engineer or support specialist asks for the detailed location evidence.</p>
        <pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{JSON.stringify({
          matchedAreas:result.matchedGeographies,
          approvedPartnerAreas:result.approvedAssignments,
          requestedPartnerAreas:result.requestedCoverage,
          currentLocationEvidence:result.currentLocationEvidence,
          boundaryStrategy:result.boundaryStrategy
        },null,2)}</pre>
      </details>
    </div>:null}
  </section>;
}

type DispatchDiagnostic=z.infer<typeof DispatchDiagnosticSchema>;
function DispatchDiagnosticPanel(){const{supabase,status}=useSessionState();const[dispatchId,setDispatchId]=useState("");const[subjectType,setSubjectType]=useState("");const[subjectId,setSubjectId]=useState("");const valid=(!dispatchId.trim()||isUuid(dispatchId))&&(!subjectId.trim()||isUuid(subjectId));const query=useQuery({queryKey:["dispatch-location-diagnostics",dispatchId,subjectType,subjectId],enabled:status==="authenticated"&&valid,queryFn:async()=>{const{data,error}=await supabase.rpc("read_dispatch_location_diagnostics",{p_dispatch_request_id:uuidOrNull(dispatchId),p_subject_type:subjectType.trim()||null,p_subject_id:uuidOrNull(subjectId),p_limit:100});if(error)throw error;return z.array(DispatchDiagnosticSchema).parse(data??[]);}});const columns:TableColumn<DispatchDiagnostic>[]=[{key:"decision",header:"Dispatch decision",render:(item)=><><strong>{item.subject_type}</strong><br/><small>{item.dispatch_request_id}</small></>},{key:"selected",header:"Selected entity",render:(item)=><><strong>{item.selected_entity_type}</strong><br/><small>{item.selected_entity_id}</small></>},{key:"distance",header:"Distance",render:(item)=>`${Math.round(item.distance_meters)} m`},{key:"evidence",header:"Recorded evidence",render:(item)=>`${item.coverage_assignment_snapshots.length} coverage · ${item.candidate_decision_snapshots.length} candidates`},{key:"time",header:"Decided",render:(item)=>new Date(item.decided_at).toLocaleString()}];return <section className="sk-panel"><div className="sk-panel__header"><div><h2>Why a driver was assigned</h2><p className="skima-muted">Review the service rules, partner coverage, pickup location and driver information SKIMA used at the moment an assignment was made.</p></div><Button variant="outline" disabled={!valid} onClick={()=>void query.refetch()}>Refresh records</Button></div><div className="skima-form-grid"><TextInput label="Dispatch request ID" value={dispatchId} onChange={(event)=>setDispatchId(event.currentTarget.value)}/><TextInput label="Subject type" value={subjectType} onChange={(event)=>setSubjectType(event.currentTarget.value)}/><TextInput label="Subject ID" value={subjectId} onChange={(event)=>setSubjectId(event.currentTarget.value)}/></div>{!valid?<StatusBadge tone="warning">The dispatch or record ID is incomplete. Copy the full ID from the related admin record.</StatusBadge>:query.isLoading?<LoadingState label="Loading dispatch records"/>:query.error?<ErrorState title="Dispatch audit unavailable" message={readError(query.error)} onRetry={()=>void query.refetch()}/>:<><DataTable caption="Recorded dispatch location decisions" columns={columns} records={query.data??[]} getRowKey={(item)=>item.id} emptyTitle="No dispatch decisions found" emptyMessage="Assignment-time location snapshots will appear here after dispatch."/>{(query.data??[]).map((item)=><details key={`${item.id}:detail`}><summary>{item.dispatch_request_id} evidence detail</summary><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{JSON.stringify({pickup:item.pickup_geojson,selectedEntityPoint:item.selected_entity_geojson,servicePolicy:item.service_policy_snapshot,coverageAssignments:item.coverage_assignment_snapshots,candidates:item.candidate_decision_snapshots,decision:item.decision_metadata},null,2)}</pre></details>)}</>}</section>;}
function RetentionHealthPanel(){const{supabase,status}=useSessionState();const query=useQuery({queryKey:["location-retention-health"],enabled:status==="authenticated",refetchInterval:60_000,queryFn:async()=>{const{data,error}=await supabase.rpc("read_location_retention_health");if(error)throw error;return RetentionHealthSchema.parse(data);}});if(query.isLoading)return <LoadingState label="Checking location retention operations"/>;if(query.error)return <ErrorState title="Retention health unavailable" message={readError(query.error)} onRetry={()=>void query.refetch()}/>;const health=query.data;return <section className="sk-panel"><div className="sk-panel__header"><div><h2>Location retention operations</h2><p className="skima-muted">Scheduled service-authority cleanup limits driver sample growth and removes abandoned geometry drafts without deleting activated evidence.</p></div><StatusBadge tone={health?.healthy?"success":"danger"}>{health?.healthy?"Healthy":"Action required"}</StatusBadge></div><div className="skima-grid skima-grid--compact"><MetricTile label="Active policies" value={health?.activePolicies??0} icon={ShieldCheck} tone="info"/><MetricTile label="Queued / running" value={`${health?.queuedJobs??0} / ${health?.runningJobs??0}`} icon={RefreshCcw} tone="info"/><MetricTile label="Failed jobs" value={health?.failedJobs??0} icon={ShieldCheck} tone={(health?.failedJobs??0)>0?"warning":"success"}/><MetricTile label="Last completed" value={health?.lastCompletedAt?new Date(health.lastCompletedAt).toLocaleString():"Awaiting first run"} icon={RefreshCcw} tone={health?.overdue?"warning":"success"}/></div>{health?.lastDeletedCounts?<p className="skima-muted">Last cleanup: {JSON.stringify(health.lastDeletedCounts)}</p>:null}</section>;}
function ProductionReadinessAlerts({readiness,error}:{readiness:z.infer<typeof ProductionReadinessSchema>|undefined;error:unknown}) {
  if (error) return <StatusBadge tone="danger">Location system check failed: {readError(error)}</StatusBadge>;
  if (!readiness) return <LoadingState label="Checking the location system"/>;
  return <section className="sk-panel">
    <div className="sk-panel__header">
      <div>
        <h2>Location system check</h2>
        <p className="skima-muted">SKIMA checks map boundaries, service rules, partner coverage and cleanup jobs before the location system is treated as fully ready.</p>
      </div>
      <StatusBadge tone={readiness.ready?"success":"warning"}>{readiness.ready?"Ready":"Needs attention"}</StatusBadge>
    </div>
    {readiness.alerts.length===0
      ? <p>All location checks passed.</p>
      : readiness.alerts.map((alert)=><p key={alert.code}>
          <StatusBadge tone={alert.severity==="BLOCKER"?"danger":"warning"}>{alert.severity==="BLOCKER"?"Action required":"Check"}</StatusBadge>{" "}
          <strong>{alert.code.replaceAll("_"," ").toLowerCase()}</strong>{alert.count!==undefined?` — ${alert.count}`:""}
        </p>)}
  </section>;
}
function GeometryDraftRecoveryPanel(){const{supabase,status}=useSessionState();const client=useQueryClient();const[abandoning,setAbandoning]=useState<z.infer<typeof GeometryDraftSchema>|null>(null);const[reason,setReason]=useState("");const query=useQuery({queryKey:["recoverable-geometry-drafts"],enabled:status==="authenticated",queryFn:async()=>{const{data,error}=await supabase.rpc("read_recoverable_geometry_drafts",{p_limit:100});if(error)throw error;return z.array(GeometryDraftSchema).parse(data??[]);}});const abandon=useMutation({mutationFn:async()=>{if(!abandoning||!reason.trim())throw new Error("An abandonment reason is required.");const{error}=await supabase.rpc("abandon_coverage_geometry_draft",{p_draft_id:abandoning.id,p_reason:reason.trim()});if(error)throw error;},onSuccess:async()=>{setAbandoning(null);setReason("");await client.invalidateQueries({queryKey:["recoverable-geometry-drafts"]});}});const columns:TableColumn<z.infer<typeof GeometryDraftSchema>>[]=[{key:"type",header:"Draft type",render:(item)=>item.draft_type.replaceAll("_"," ")},{key:"status",header:"Status",render:(item)=><StatusBadge tone="warning">{item.status}</StatusBadge>},{key:"validation",header:"Validation",render:(item)=>String(item.validation_snapshot.code??"UNKNOWN")},{key:"updated",header:"Updated",render:(item)=>new Date(item.updated_at).toLocaleString()},{key:"actions",header:"Recovery",render:(item)=><div className="skima-action-row"><Button size="sm" variant="outline" onClick={()=>navigator.clipboard.writeText(JSON.stringify(item.geometry_geojson,null,2))}>Copy geometry</Button><Button size="sm" variant="destructive" onClick={()=>setAbandoning(item)}>Abandon</Button></div>}];return <section className="sk-panel"><div className="sk-panel__header"><div><h2>Recoverable geometry drafts</h2><p className="skima-muted">Resume a preserved boundary by copying its validated GeoJSON into the editor, or explicitly abandon it with an audited reason.</p></div></div>{query.isLoading?<LoadingState label="Loading geometry drafts"/>:query.error?<ErrorState title="Geometry drafts unavailable" message={readError(query.error)} onRetry={()=>void query.refetch()}/>:<DataTable caption="Recoverable geometry drafts" columns={columns} records={query.data??[]} getRowKey={(item)=>item.id} emptyTitle="No recoverable drafts" emptyMessage="Previewed and unfinished geometry will appear here."/>}<Dialog isOpen={Boolean(abandoning)} title="Abandon geometry draft" onClose={()=>setAbandoning(null)} footer={<><Button variant="ghost" onClick={()=>setAbandoning(null)}>Cancel</Button><Button variant="destructive" isLoading={abandon.isPending} onClick={()=>abandon.mutate()}>Abandon draft</Button></>}><TextAreaInput label="Abandonment reason" value={reason} onChange={(event)=>setReason(event.currentTarget.value)} required/>{abandon.error?<StatusBadge tone="danger">{readError(abandon.error)}</StatusBadge>:null}</Dialog></section>;}


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
type CoverageRequest = z.infer<typeof CoverageRequestSchema>;

function CoverageRequestsPanel() {
  const { supabase, status } = useSessionState();
  const client = useQueryClient();
  const [review, setReview] = useState<{ request: CoverageRequest; decision: "APPROVED" | "REJECTED" } | null>(null);
  const [reason, setReason] = useState("");
  const query = useQuery({
    queryKey: ["universal-coverage-requests"],
    enabled: status === "authenticated",
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_application_coverage_requests_admin", {
        p_status: "REQUESTED",
      });
      if (error) throw error;
      return z.array(CoverageRequestSchema).parse(data ?? []);
    },
  });
  const mutation = useMutation({
    mutationFn: async () => {
      if (!review || !reason.trim()) throw new Error("A review reason is required.");
      const { error } = await supabase.rpc("review_application_coverage_request", {
        p_request_id: review.request.id,
        p_decision: review.decision,
        p_reason: reason.trim(),
        p_valid_from: null,
        p_valid_to: null,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setReview(null);
      setReason("");
      await client.invalidateQueries({ queryKey: ["universal-coverage-requests"] });
    },
  });
  const columns: TableColumn<CoverageRequest>[] = [
    {
      key: "entity",
      header: "Applicant",
      render: (item) => <><strong>{item.entity_type}</strong><br /><small>{item.applicant_user_id}</small><br /><small>App {item.application_id}</small></>,
    },
    {
      key: "coverage",
      header: "Requested coverage",
      render: (item) => {
        if (item.geography_name) return item.geography_name;
        if (item.coverage_type === "RADIUS") {
          const radius = item.radius_meters ?? 0;
          const radiusLabel = radius >= 1000 ? `${(radius / 1000).toFixed(radius % 1000 === 0 ? 0 : 1)} km radius` : `${Math.round(radius)} m radius`;
          const point = item.center_latitude !== null && item.center_longitude !== null
            ? `${item.center_latitude.toFixed(5)}, ${item.center_longitude.toFixed(5)}`
            : "Center unavailable";
          return <><strong>{radiusLabel}</strong><br /><small>{point}</small></>;
        }
        return item.coverage_type;
      },
    },
    {
      key: "evidence",
      header: "Location evidence",
      render: (item) => <><StatusBadge tone={item.location_verification_status === "verified" ? "success" : "warning"}>{item.location_verification_status ?? "not reviewed"}</StatusBadge>{item.formatted_address ? <><br /><small>{item.formatted_address}</small></> : null}</>,
    },
    { key: "service", header: "Service", render: (item) => item.service_key },
    { key: "actions", header: "Review", render: (item) => <div className="skima-action-row"><Button size="sm" onClick={() => setReview({ request: item, decision: "APPROVED" })}>Approve</Button><Button size="sm" variant="destructive" onClick={() => setReview({ request: item, decision: "REJECTED" })}>Reject</Button></div> },
  ];
  const reviewSummary = review?.request.coverage_type === "RADIUS"
    ? `${review.request.radius_meters ?? 0} m radius at ${review.request.center_latitude?.toFixed(5) ?? "?"}, ${review.request.center_longitude?.toFixed(5) ?? "?"}`
    : review?.request.geography_name ?? review?.request.coverage_type ?? "";
  return <section className="sk-panel"><div className="sk-panel__header"><div><h2>Requested operating coverage</h2><p className="skima-muted">Application requests never grant dispatch eligibility until an authorized review creates approved coverage. Radius requests show their exact center and location-verification state before approval.</p></div><StatusBadge>{query.data?.length ?? 0} pending</StatusBadge></div>{query.isLoading ? <LoadingState label="Loading coverage requests" /> : query.error ? <ErrorState title="Coverage requests unavailable" message={readError(query.error)} onRetry={() => void query.refetch()} /> : <DataTable caption="Requested operating coverage" columns={columns} records={query.data ?? []} getRowKey={(item) => item.id} emptyTitle="No pending requests" emptyMessage="Submitted driver and station coverage requests will appear here." />}<Dialog isOpen={Boolean(review)} title={`${review?.decision === "APPROVED" ? "Approve" : "Reject"} requested coverage`} onClose={() => setReview(null)} footer={<><Button variant="ghost" onClick={() => setReview(null)}>Cancel</Button><Button variant={review?.decision === "REJECTED" ? "destructive" : "primary"} isLoading={mutation.isPending} onClick={() => mutation.mutate()}>Confirm decision</Button></>}><p><strong>{reviewSummary}</strong></p>{review?.request.formatted_address ? <p className="skima-muted">{review.request.formatted_address}</p> : null}<TextAreaInput label="Decision reason" value={reason} onChange={(event) => setReason(event.currentTarget.value)} required />{mutation.error ? <StatusBadge tone="danger">{readError(mutation.error)}</StatusBadge> : null}</Dialog></section>;
}
