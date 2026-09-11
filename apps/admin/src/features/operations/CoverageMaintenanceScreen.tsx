import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArchiveRestore, MapPinned, RefreshCcw, ShieldCheck, TrendingUp, Wrench } from "lucide-react";
import { useMemo, useState } from "react";
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
  type TableColumn,
} from "@skima/ui";

import { useSessionState } from "../../session";
import { AdminV2PageHeader } from "../../shared/patterns/AdminV2Patterns";

const ReadinessSchema = z.object({
  authorityMode: z.enum(["preparing", "universal", "retired"]),
  legacyAreaCount: z.coerce.number(), mappedCount: z.coerce.number(), verifiedCount: z.coerce.number(), blockedCount: z.coerce.number(), activeUniversalPolicyCount: z.coerce.number(),
  approvedDriversWithoutCoverage: z.coerce.number().default(0), approvedStationsWithoutCoverage: z.coerce.number().default(0), ready: z.boolean(),
});
const GeographySchema = z.object({ id: z.string().uuid(), canonical_name: z.string(), status: z.string() }).passthrough();
const SetupSchema = z.object({ readiness: ReadinessSchema, geographies: z.array(GeographySchema) }).passthrough();
const GeographyMigrationSchema = z.object({
  id: z.string().uuid(), legacy_source: z.string(), legacy_id: z.string().uuid(), legacy_display_name: z.string(), legacy_area_type: z.string().nullable(), geography_id: z.string().uuid().nullable(), geography_name: z.string().nullable(), geography_country_code: z.string().nullable(), migration_status: z.enum(["pending", "migrated", "blocked", "verified", "retired"]), validation_code: z.string(), geometry_source: z.string().nullable(), boundary_ready: z.boolean(), verified_at: z.string().nullable(), details: z.record(z.unknown()),
});
const GeometryDraftSchema = z.object({ id: z.string().uuid(), draft_type: z.enum(["GEOGRAPHY_BOUNDARY", "OPERATIONAL_COVERAGE"]), target_id: z.string().uuid().nullable(), parent_geography_id: z.string().uuid().nullable(), status: z.enum(["DRAFT", "PREVIEWED"]), geometry_geojson: z.record(z.unknown()), validation_snapshot: z.record(z.unknown()), created_at: z.string(), updated_at: z.string() });
const RetentionHealthSchema = z.object({ healthy: z.boolean(), activePolicies: z.coerce.number(), lastCompletedAt: z.string().nullable(), lastDeletedCounts: z.record(z.unknown()).nullable(), queuedJobs: z.coerce.number(), runningJobs: z.coerce.number(), failedJobs: z.coerce.number(), overdue: z.boolean() });
const ExpansionDemandSchema = z.object({ service_key: z.string(), interest_type: z.enum(["CUSTOMER", "DRIVER", "STATION"]), geography_id: z.string().uuid().nullable(), geography_name: z.string(), request_count: z.coerce.number(), distinct_user_count: z.coerce.number(), last_requested_at: z.string() });

type MaintenanceMode = "migration" | "drafts" | "health" | "demand";
type GeographyMigration = z.infer<typeof GeographyMigrationSchema>;
type GeometryDraft = z.infer<typeof GeometryDraftSchema>;
type ExpansionDemand = z.infer<typeof ExpansionDemandSchema>;

const modes: readonly { key: MaintenanceMode; label: string; description: string; icon: typeof Wrench }[] = [
  { key: "migration", label: "Coverage migration", description: "Review older area records and authority cutover", icon: ArchiveRestore },
  { key: "drafts", label: "Unfinished areas", description: "Recover or discard incomplete geometry", icon: MapPinned },
  { key: "health", label: "Retention health", description: "Check scheduled location cleanup", icon: ShieldCheck },
  { key: "demand", label: "Expansion demand", description: "See where customers and partners are waiting", icon: TrendingUp },
];

export function CoverageMaintenanceScreen() {
  const [mode, setMode] = useState<MaintenanceMode>("migration");
  return (
    <div className="coverage-v2__screen">
      <AdminV2PageHeader eyebrow="Service coverage · Maintenance" title="Coverage maintenance" description="Keep migration, unfinished geometry, retention and expansion evidence away from everyday availability work. Open only the maintenance job you need." />
      <div className="coverage-v2__maintenance-switch" role="tablist" aria-label="Coverage maintenance tools">
        {modes.map((item) => { const Icon = item.icon; const active = item.key === mode; return <button key={item.key} type="button" role="tab" aria-selected={active} className={active ? "is-active" : undefined} onClick={() => setMode(item.key)}><Icon aria-hidden="true" /><span><strong>{item.label}</strong><small>{item.description}</small></span></button>; })}
      </div>
      {mode === "migration" ? <MigrationMaintenance /> : null}
      {mode === "drafts" ? <DraftMaintenance /> : null}
      {mode === "health" ? <RetentionMaintenance /> : null}
      {mode === "demand" ? <ExpansionDemand /> : null}
    </div>
  );
}

function MigrationMaintenance() {
  const { supabase, status } = useSessionState();
  const client = useQueryClient();
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [linkTargets, setLinkTargets] = useState<Record<string, string>>({});
  const enabled = status === "authenticated";
  const setup = useQuery({ queryKey: ["coverage-v2", "maintenance-setup"], enabled, queryFn: async () => { const { data, error } = await supabase.rpc("read_geography_admin_setup"); if (error) throw error; return SetupSchema.parse(data); } });
  const mappings = useQuery({ queryKey: ["coverage-v2", "migration-review"], enabled, queryFn: async () => { const { data, error } = await supabase.rpc("read_geography_migration_review_queue"); if (error) throw error; return z.array(GeographyMigrationSchema).parse(data ?? []); } });
  const refresh = async () => { await client.invalidateQueries({ queryKey: ["coverage-v2"] }); await Promise.all([setup.refetch(), mappings.refetch()]); };

  const importLegacy = useMutation({ mutationFn: async () => { const { data, error } = await supabase.rpc("import_legacy_spatial_geographies"); if (error) throw error; return data as { imported?: number; blocked?: number } | null; }, onSuccess: async (result) => { setNotice(`Existing areas checked: ${result?.imported ?? 0} ready to review, ${result?.blocked ?? 0} need correction.`); await refresh(); } });
  const linkMapping = useMutation({ mutationFn: async (mappingId: string) => { const geographyId = linkTargets[mappingId]; if (!geographyId) throw new Error("Choose the mapped service area first."); if (!reason.trim()) throw new Error("Enter a reason before linking this area."); const { error } = await supabase.rpc("link_geography_migration_mapping", { p_mapping_id: mappingId, p_geography_id: geographyId, p_reason: reason.trim() }); if (error) throw error; }, onSuccess: async (_data, mappingId) => { setLinkTargets((current) => { const next = { ...current }; delete next[mappingId]; return next; }); setNotice("Older area linked. Review and confirm it next."); await refresh(); } });
  const verifyMapping = useMutation({ mutationFn: async (mappingId: string) => { if (!reason.trim()) throw new Error("Enter a reason before confirming this area link."); const { error } = await supabase.rpc("verify_geography_migration_mapping", { p_mapping_id: mappingId, p_reason: reason.trim() }); if (error) throw error; }, onSuccess: async () => { setNotice("Service area link confirmed."); await refresh(); } });
  const migratePolicies = useMutation({ mutationFn: async () => { const { data, error } = await supabase.rpc("migrate_verified_legacy_lpg_coverage_policies"); if (error) throw error; return data as { inserted?: number } | null; }, onSuccess: async (result) => { setNotice(`${result?.inserted ?? 0} verified LPG rule(s) moved to map-based coverage.`); await refresh(); } });
  const migratePartners = useMutation({ mutationFn: async () => { const { data, error } = await supabase.rpc("migrate_verified_operational_coverage"); if (error) throw error; return data as { driverAssignmentsMigrated?: number; stationAssignmentsMigrated?: number } | null; }, onSuccess: async (result) => { setNotice(`${result?.driverAssignmentsMigrated ?? 0} driver and ${result?.stationAssignmentsMigrated ?? 0} station area(s) moved.`); await refresh(); } });
  const activateAuthority = useMutation({ mutationFn: async () => { if (!reason.trim()) throw new Error("Enter a reason before activating map-based coverage."); const { error } = await supabase.rpc("set_universal_geography_authority", { p_mode: "universal", p_reason: reason.trim() }); if (error) throw error; }, onSuccess: async () => { setNotice("Map-based service coverage is now authoritative."); await refresh(); } });

  const records = mappings.data ?? [];
  const readiness = setup.data?.readiness;
  const geographies = (setup.data?.geographies ?? []).filter((item) => item.status === "active");
  const columns: TableColumn<GeographyMigration>[] = [
    { key: "legacy", header: "Existing area", render: (item) => <><strong>{item.legacy_display_name}</strong><br /><small>{item.legacy_area_type ?? item.legacy_source}</small></> },
    { key: "mapped", header: "Mapped area", render: (item) => item.geography_name ?? "Not linked" },
    { key: "state", header: "Review state", render: (item) => <><StatusBadge tone={item.migration_status === "verified" ? "success" : item.migration_status === "blocked" ? "danger" : "warning"}>{friendly(item.migration_status)}</StatusBadge><br /><small>{friendlyCheck(item.validation_code)}</small></> },
    { key: "action", header: "Action", render: (item) => item.migration_status === "migrated" ? <Button size="sm" variant="outline" disabled={!item.boundary_ready || !reason.trim()} onClick={() => verifyMapping.mutate(item.id)}>Confirm link</Button> : item.migration_status === "blocked" || item.migration_status === "pending" ? <div className="coverage-v2__migration-action"><SelectInput label="Mapped service area" value={linkTargets[item.id] ?? ""} onChange={(event) => setLinkTargets((current) => ({ ...current, [item.id]: event.currentTarget.value }))} options={[{ label: "Choose area", value: "" }, ...geographies.map((area) => ({ label: area.canonical_name, value: area.id }))]} /><Button size="sm" variant="outline" disabled={!linkTargets[item.id] || !reason.trim()} onClick={() => linkMapping.mutate(item.id)}>Link</Button></div> : <small>{item.migration_status === "verified" ? "Confirmed" : "No action"}</small> },
  ];
  const actionError = setup.error ?? mappings.error ?? importLegacy.error ?? linkMapping.error ?? verifyMapping.error ?? migratePolicies.error ?? migratePartners.error ?? activateAuthority.error;

  return <section className="sk-panel">
    <div className="sk-panel__header"><div><h2>Coverage migration & cutover</h2><p className="skima-muted">This is a maintenance workflow for older geography records. It is intentionally separate from normal service-area editing.</p></div><Button icon={RefreshCcw} variant="outline" onClick={() => void refresh()}>Refresh</Button></div>
    <section className="skima-grid skima-grid--compact"><MetricTile label="Ready to review" value={records.filter((item) => item.migration_status === "migrated").length} icon={MapPinned} tone="warning" /><MetricTile label="Needs correction" value={records.filter((item) => item.migration_status === "blocked").length} icon={ShieldCheck} tone="warning" /><MetricTile label="Verified links" value={readiness?.verifiedCount ?? 0} icon={ShieldCheck} tone="success" /><MetricTile label="Coverage authority" value={readiness?.authorityMode === "universal" ? "Active" : "Preparing"} icon={MapPinned} tone={readiness?.authorityMode === "universal" ? "success" : "warning"} /></section>
    <div className="coverage-v2__maintenance-actions"><Button variant="outline" onClick={() => importLegacy.mutate()} isLoading={importLegacy.isPending}>Import existing areas</Button><Button variant="outline" disabled={(readiness?.verifiedCount ?? 0) === 0} onClick={() => migratePolicies.mutate()} isLoading={migratePolicies.isPending}>Move verified LPG rules</Button><Button variant="outline" onClick={() => migratePartners.mutate()} isLoading={migratePartners.isPending}>Move partner areas</Button>{readiness?.authorityMode === "preparing" ? <Button disabled={!readiness.ready || !reason.trim()} onClick={() => activateAuthority.mutate()} isLoading={activateAuthority.isPending}>Activate map coverage</Button> : null}</div>
    <TextAreaInput label="Change reason" helperText="Required for linking, confirming or activating coverage. SKIMA retains this in change history." value={reason} onChange={(event) => setReason(event.currentTarget.value)} />
    {notice ? <StatusBadge tone="success">{notice}</StatusBadge> : null}{actionError ? <StatusBadge tone="danger">{readError(actionError)}</StatusBadge> : null}
    {mappings.isLoading ? <LoadingState label="Loading migration review" /> : <DataTable caption="Existing service-area migration review" columns={columns} records={records} getRowKey={(item) => item.id} emptyTitle="No older service areas to review" emptyMessage="Import existing areas if legacy records remain." />}
  </section>;
}

function DraftMaintenance() {
  const { supabase, status } = useSessionState();
  const client = useQueryClient();
  const [abandoning, setAbandoning] = useState<GeometryDraft | null>(null);
  const [reason, setReason] = useState("");
  const query = useQuery({ queryKey: ["coverage-v2", "recoverable-drafts"], enabled: status === "authenticated", queryFn: async () => { const { data, error } = await supabase.rpc("read_recoverable_geometry_drafts", { p_limit: 100 }); if (error) throw error; return z.array(GeometryDraftSchema).parse(data ?? []); } });
  const abandon = useMutation({ mutationFn: async () => { if (!abandoning || !reason.trim()) throw new Error("Explain why this unfinished map area should be discarded."); const { error } = await supabase.rpc("abandon_coverage_geometry_draft", { p_draft_id: abandoning.id, p_reason: reason.trim() }); if (error) throw error; }, onSuccess: async () => { setAbandoning(null); setReason(""); await client.invalidateQueries({ queryKey: ["coverage-v2", "recoverable-drafts"] }); } });
  const columns: TableColumn<GeometryDraft>[] = [
    { key: "type", header: "Area being edited", render: (item) => item.draft_type === "GEOGRAPHY_BOUNDARY" ? "Service area boundary" : "Partner operating area" },
    { key: "check", header: "Map check", render: (item) => friendlyGeometryCheck(String(item.validation_snapshot.code ?? "UNKNOWN")) },
    { key: "updated", header: "Last edited", render: (item) => new Date(item.updated_at).toLocaleString() },
    { key: "action", header: "Action", render: (item) => <div className="skima-action-row"><Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(JSON.stringify(item.geometry_geojson, null, 2))}>Copy map data</Button><Button size="sm" variant="destructive" onClick={() => setAbandoning(item)}>Discard</Button></div> },
  ];
  return <section className="sk-panel"><div className="sk-panel__header"><div><h2>Unfinished map areas</h2><p className="skima-muted">Incomplete boundary work is preserved so it can be recovered or intentionally discarded.</p></div><StatusBadge>{query.data?.length ?? 0} drafts</StatusBadge></div>{query.isLoading ? <LoadingState label="Loading unfinished areas" /> : query.error ? <ErrorState title="Unfinished areas unavailable" message={readError(query.error)} onRetry={() => void query.refetch()} /> : <DataTable caption="Unfinished map areas" columns={columns} records={query.data ?? []} getRowKey={(item) => item.id} emptyTitle="No unfinished map areas" emptyMessage="There is no abandoned boundary work right now." />}<Dialog isOpen={Boolean(abandoning)} title="Discard unfinished map area?" onClose={() => setAbandoning(null)} footer={<><Button variant="ghost" onClick={() => setAbandoning(null)}>Keep it</Button><Button variant="destructive" isLoading={abandon.isPending} onClick={() => abandon.mutate()}>Discard area</Button></>}><TextAreaInput label="Reason" value={reason} onChange={(event) => setReason(event.currentTarget.value)} required />{abandon.error ? <StatusBadge tone="danger">{readError(abandon.error)}</StatusBadge> : null}</Dialog></section>;
}

function RetentionMaintenance() {
  const { supabase, status } = useSessionState();
  const query = useQuery({ queryKey: ["coverage-v2", "retention-health"], enabled: status === "authenticated", refetchInterval: 60_000, queryFn: async () => { const { data, error } = await supabase.rpc("read_location_retention_health"); if (error) throw error; return RetentionHealthSchema.parse(data); } });
  if (query.isLoading) return <LoadingState label="Checking location retention" />;
  if (query.error) return <ErrorState title="Retention health unavailable" message={readError(query.error)} onRetry={() => void query.refetch()} />;
  const health = query.data;
  return <section className="sk-panel"><div className="sk-panel__header"><div><h2>Location retention health</h2><p className="skima-muted">Scheduled cleanup limits driver sample growth and removes abandoned drafts without deleting activated evidence.</p></div><StatusBadge tone={health?.healthy ? "success" : "danger"}>{health?.healthy ? "Healthy" : "Action required"}</StatusBadge></div><section className="skima-grid skima-grid--compact"><MetricTile label="Active policies" value={health?.activePolicies ?? 0} icon={ShieldCheck} tone="info" /><MetricTile label="Queued / running" value={`${health?.queuedJobs ?? 0} / ${health?.runningJobs ?? 0}`} icon={RefreshCcw} tone="info" /><MetricTile label="Failed jobs" value={health?.failedJobs ?? 0} icon={ShieldCheck} tone={(health?.failedJobs ?? 0) > 0 ? "warning" : "success"} /><MetricTile label="Last completed" value={health?.lastCompletedAt ? new Date(health.lastCompletedAt).toLocaleString() : "Awaiting first run"} icon={RefreshCcw} tone={health?.overdue ? "warning" : "success"} /></section>{health?.lastDeletedCounts ? <details className="coverage-v2__advanced"><summary>Last cleanup detail</summary><pre>{JSON.stringify(health.lastDeletedCounts, null, 2)}</pre></details> : null}</section>;
}

function ExpansionDemand() {
  const { supabase, status } = useSessionState();
  const query = useQuery({ queryKey: ["coverage-v2", "expansion-demand"], enabled: status === "authenticated", queryFn: async () => { const { data, error } = await supabase.rpc("read_expansion_demand", { p_service_key: null, p_interest_type: null }); if (error) throw error; return z.array(ExpansionDemandSchema).parse(data ?? []); } });
  const columns = useMemo<TableColumn<ExpansionDemand>[]>(() => [
    { key: "area", header: "Demand area", render: (item) => item.geography_name },
    { key: "audience", header: "Who is asking", render: (item) => <><strong>{item.service_key === "lpg" ? "LPG refill service" : friendly(item.service_key)}</strong><br /><small>{friendly(item.interest_type)}</small></> },
    { key: "requests", header: "Requests", render: (item) => item.request_count },
    { key: "people", header: "People", render: (item) => item.distinct_user_count },
    { key: "latest", header: "Latest", render: (item) => new Date(item.last_requested_at).toLocaleString() },
  ], []);
  return <section className="sk-panel"><div className="sk-panel__header"><div><h2>Expansion demand</h2><p className="skima-muted">Interest from customers, drivers and stations is grouped by mapped area to support expansion decisions.</p></div><Button icon={RefreshCcw} variant="outline" onClick={() => void query.refetch()}>Refresh</Button></div>{query.isLoading ? <LoadingState label="Loading expansion demand" /> : query.error ? <ErrorState title="Expansion demand unavailable" message={readError(query.error)} onRetry={() => void query.refetch()} /> : <DataTable caption="Expansion demand by area" columns={columns} records={query.data ?? []} getRowKey={(item) => `${item.service_key}:${item.interest_type}:${item.geography_id ?? "unmapped"}`} emptyTitle="No expansion demand yet" emptyMessage="Launch notification and partner-interest requests will appear here." />}</section>;
}

function friendly(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase()); }
function friendlyCheck(code: string) { const value = code.toUpperCase(); if (value.includes("VALID") || value.includes("READY")) return "Map boundary is ready"; if (value.includes("BOUNDARY")) return "Map boundary needs attention"; if (value.includes("MISSING")) return "Required information is missing"; if (value.includes("MATCH")) return "Area match needs review"; return friendly(code); }
function friendlyGeometryCheck(code: string) { const value = code.toUpperCase(); if (value.includes("VALID")) return "Ready"; if (value.includes("EMPTY")) return "No boundary drawn"; if (value.includes("PARENT")) return "Outside its larger area"; if (value.includes("SELF")) return "Boundary crosses itself"; return value === "UNKNOWN" ? "Needs checking" : "Needs attention"; }
function readError(error: unknown) { if (error instanceof Error && error.message.trim()) return error.message; if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") return String((error as { message: string }).message); return "Coverage maintenance could not be completed. Refresh and try again."; }
