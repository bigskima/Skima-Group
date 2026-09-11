import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Compass,
  Map,
  MapPinned,
  Plus,
  RefreshCcw,
  ShieldCheck,
  SlidersHorizontal,
  UsersRound,
  Wrench,
} from "lucide-react";
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
import "./coverage-v2.css";

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
  id: z.string().uuid(),
  parent_id: z.string().uuid().nullable(),
  geography_level_id: z.string().uuid(),
  canonical_name: z.string(),
  country_code: z.string(),
  status: z.enum(["draft", "active", "inactive", "retired"]),
  geography_levels: z.object({
    display_name: z.string(),
    specificity_rank: z.coerce.number(),
  }).nullable(),
});

const PolicySchema = z.object({
  id: z.string().uuid(),
  service_key: z.string(),
  capability_key: z.string(),
  target_geography_id: z.string().uuid(),
  effect: z.enum(["ALLOW", "DENY"]),
  priority: z.coerce.number(),
  status: z.enum(["draft", "active", "paused", "retired"]),
  starts_at: z.string().nullable(),
  ends_at: z.string().nullable(),
  reason: z.string().nullable(),
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

const ProductionReadinessSchema = z.object({
  ready: z.boolean(),
  checkedAt: z.string(),
  configuration: z.record(z.unknown()),
  alerts: z.array(z.object({
    code: z.string(),
    severity: z.enum(["BLOCKER", "WARNING"]),
    count: z.coerce.number().optional(),
  })),
  metrics: z.record(z.unknown()),
});

const PolicyPreviewItemSchema = z.object({
  policyId: z.string().uuid(),
  geographyId: z.string().uuid(),
  geographyName: z.string(),
  effect: z.enum(["ALLOW", "DENY"]),
  priority: z.coerce.number(),
});

const PolicyPreviewSchema = z.object({
  canActivate: z.boolean(),
  target: z.object({
    geographyId: z.string().uuid(),
    geographyName: z.string(),
    specificity: z.coerce.number(),
  }),
  conflicts: z.array(PolicyPreviewItemSchema),
  broaderPolicies: z.array(PolicyPreviewItemSchema),
  narrowerPolicies: z.array(PolicyPreviewItemSchema),
});

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
type CoverageSection = "overview" | "availability" | "partners" | "map" | "diagnostics" | "maintenance";

interface GeographyForm {
  readonly name: string;
  readonly countryCode: string;
  readonly levelId: string;
  readonly parentId: string;
  readonly boundary: string;
  readonly source: string;
  readonly externalReference: string;
}

interface PolicyForm {
  readonly serviceKey: string;
  readonly capabilityKey: string;
  readonly geographyId: string;
  readonly effect: "ALLOW" | "DENY";
  readonly priority: string;
  readonly status: "draft" | "active";
  readonly startsAt: string;
  readonly endsAt: string;
  readonly reason: string;
}

const EMPTY_GEOGRAPHY: GeographyForm = {
  name: "",
  countryCode: "",
  levelId: "",
  parentId: "",
  boundary: "",
  source: "maps.provider",
  externalReference: "",
};

const EMPTY_POLICY: PolicyForm = {
  serviceKey: "lpg",
  capabilityKey: "",
  geographyId: "",
  effect: "ALLOW",
  priority: "0",
  status: "draft",
  startsAt: "",
  endsAt: "",
  reason: "",
};

const coverageSections: readonly {
  key: CoverageSection;
  label: string;
  description: string;
  icon: typeof MapPinned;
}[] = [
  { key: "overview", label: "Overview", description: "Readiness and what needs attention", icon: Compass },
  { key: "availability", label: "Availability", description: "Mapped areas and service rules", icon: ShieldCheck },
  { key: "partners", label: "Partner coverage", description: "Driver and station operating areas", icon: UsersRound },
  { key: "map", label: "Map", description: "Visual coverage layers", icon: Map },
  { key: "diagnostics", label: "Diagnostics", description: "Check a point or assignment", icon: SlidersHorizontal },
  { key: "maintenance", label: "Maintenance", description: "Drafts, retention and expansion", icon: Wrench },
];

export function CoverageWorkspaceV2(props: {
  readonly route: string;
  readonly onNavigate: (href: string) => void;
  readonly renderLegacySection: (section: Exclude<CoverageSection, "overview" | "availability">) => React.ReactNode;
}) {
  const section = sectionFromRoute(props.route);

  return (
    <div className="coverage-v2">
      <nav className="coverage-v2__section-nav" aria-label="Service coverage screens">
        {coverageSections.map((item) => {
          const Icon = item.icon;
          const active = item.key === section;
          return (
            <button
              key={item.key}
              type="button"
              className={active ? "is-active" : undefined}
              aria-current={active ? "page" : undefined}
              onClick={() => props.onNavigate(coverageSectionHref(item.key))}
            >
              <Icon aria-hidden="true" />
              <span>
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </span>
              <ArrowRight aria-hidden="true" />
            </button>
          );
        })}
      </nav>

      {section === "overview" ? <CoverageOverview onNavigate={props.onNavigate} /> : null}
      {section === "availability" ? <CoverageAvailability /> : null}
      {section !== "overview" && section !== "availability"
        ? props.renderLegacySection(section)
        : null}
    </div>
  );
}

function CoverageOverview(props: { readonly onNavigate: (href: string) => void }) {
  const { supabase, status } = useSessionState();
  const enabled = status === "authenticated";
  const setup = useQuery({
    queryKey: ["coverage-v2", "admin-setup"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_geography_admin_setup");
      if (error) throw error;
      return GeographyAdminSetupSchema.parse(data);
    },
  });
  const production = useQuery({
    queryKey: ["coverage-v2", "production-readiness"],
    enabled,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_location_platform_production_readiness");
      if (error) throw error;
      return ProductionReadinessSchema.parse(data);
    },
  });

  if (setup.isLoading) return <LoadingState label="Loading service coverage" />;
  if (setup.error) {
    return <ErrorState title="Service coverage unavailable" message={readError(setup.error)} onRetry={() => void setup.refetch()} />;
  }

  const data = setup.data;
  const readiness = data?.readiness;
  const blockers = production.data?.alerts.filter((alert) => alert.severity === "BLOCKER") ?? [];
  const warnings = production.data?.alerts.filter((alert) => alert.severity === "WARNING") ?? [];

  return (
    <div className="coverage-v2__screen">
      <AdminV2PageHeader
        eyebrow="Operations · Service coverage"
        title="Coverage overview"
        description="See whether SKIMA's map-based availability is healthy, then open only the task you need."
        actions={<Button icon={RefreshCcw} variant="outline" onClick={() => void Promise.all([setup.refetch(), production.refetch()])}>Refresh</Button>}
      />

      <section className="skima-grid skima-grid--compact">
        <MetricTile label="Mapped service areas" value={data?.geographies.length ?? 0} icon={MapPinned} tone="info" />
        <MetricTile label="Active service rules" value={data?.policies.filter((policy) => policy.status === "active").length ?? 0} icon={ShieldCheck} tone="success" />
        <MetricTile label="Areas needing attention" value={readiness?.blockedCount ?? 0} icon={ShieldCheck} tone={(readiness?.blockedCount ?? 0) > 0 ? "warning" : "success"} />
        <MetricTile label="Coverage authority" value={readiness?.authorityMode === "universal" ? "Active" : "Setup in progress"} icon={MapPinned} tone={readiness?.ready ? "success" : "warning"} />
      </section>

      <section className="coverage-v2__status-card">
        <div>
          <span className={`coverage-v2__status-dot ${production.data?.ready ? "is-ready" : ""}`} />
          <div>
            <small>Production readiness</small>
            <strong>{production.data?.ready ? "Location system ready" : "Location system needs attention"}</strong>
            <p>{blockers.length} blocking issue{blockers.length === 1 ? "" : "s"} · {warnings.length} warning{warnings.length === 1 ? "" : "s"}</p>
          </div>
        </div>
        <StatusBadge tone={production.data?.ready ? "success" : blockers.length ? "danger" : "warning"}>
          {production.data?.ready ? "Ready" : blockers.length ? "Blocked" : "Review"}
        </StatusBadge>
      </section>

      {production.error ? <StatusBadge tone="danger">Location readiness check failed: {readError(production.error)}</StatusBadge> : null}
      {production.data?.alerts.length ? (
        <section className="coverage-v2__attention-list">
          <h2>Needs attention</h2>
          {production.data.alerts.map((alert) => (
            <div key={alert.code}>
              <StatusBadge tone={alert.severity === "BLOCKER" ? "danger" : "warning"}>
                {alert.severity === "BLOCKER" ? "Action required" : "Check"}
              </StatusBadge>
              <span>{friendlyCode(alert.code)}</span>
              {alert.count !== undefined ? <strong>{alert.count}</strong> : null}
            </div>
          ))}
        </section>
      ) : null}

      <section className="coverage-v2__task-grid">
        {coverageSections.filter((item) => item.key !== "overview").map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.key} type="button" onClick={() => props.onNavigate(coverageSectionHref(item.key))}>
              <span><Icon aria-hidden="true" /></span>
              <div><strong>{item.label}</strong><small>{item.description}</small></div>
              <ArrowRight aria-hidden="true" />
            </button>
          );
        })}
      </section>
    </div>
  );
}

function CoverageAvailability() {
  const { supabase, status } = useSessionState();
  const queryClient = useQueryClient();
  const [geographyOpen, setGeographyOpen] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const enabled = status === "authenticated";
  const setup = useQuery({
    queryKey: ["coverage-v2", "admin-setup"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_geography_admin_setup");
      if (error) throw error;
      return GeographyAdminSetupSchema.parse(data);
    },
  });
  const refresh = async () => {
    setNotice(null);
    await queryClient.invalidateQueries({ queryKey: ["universal"] });
    await setup.refetch();
  };
  const columns = useMemo<TableColumn<Policy>[]>(() => [
    { key: "geography", header: "Service area", render: (policy) => policy.geographies?.canonical_name ?? "Area unavailable" },
    { key: "capability", header: "Activity", render: (policy) => <><strong>{friendlyServiceName(policy.service_key)}</strong><br /><small>{friendlyCapabilityName(policy.capability_key)}</small></> },
    { key: "effect", header: "Availability", render: (policy) => <StatusBadge tone={policy.effect === "ALLOW" ? "success" : "danger"}>{policy.effect === "ALLOW" ? "Allowed" : "Blocked"}</StatusBadge> },
    { key: "status", header: "Status", render: (policy) => <StatusBadge tone={policy.status === "active" ? "success" : "warning"}>{friendlyCode(policy.status)}</StatusBadge> },
    { key: "schedule", header: "Schedule", render: (policy) => scheduleLabel(policy.starts_at, policy.ends_at) },
  ], []);

  if (setup.isLoading) return <LoadingState label="Loading availability rules" />;
  if (setup.error) return <ErrorState title="Availability unavailable" message={readError(setup.error)} onRetry={() => void setup.refetch()} />;

  const data = setup.data;
  const activeGeographies = data?.geographies.filter((geography) => geography.status === "active") ?? [];

  return (
    <div className="coverage-v2__screen">
      <AdminV2PageHeader
        eyebrow="Service coverage · Availability"
        title="Areas & availability"
        description="Define real map areas first, then decide what SKIMA can do inside each area. Advanced priority and scheduling stay out of the way until needed."
        actions={<>
          <Button icon={RefreshCcw} variant="outline" onClick={() => void refresh()}>Refresh</Button>
          <Button icon={MapPinned} disabled={!data?.permissions.canManageGeographies} onClick={() => setGeographyOpen(true)}>Add service area</Button>
          <Button icon={Plus} disabled={!data?.permissions.canManageCoverage} onClick={() => setPolicyOpen(true)}>Add availability rule</Button>
        </>}
      />

      {notice ? <StatusBadge tone="success">{notice}</StatusBadge> : null}

      <section className="skima-grid skima-grid--compact">
        <MetricTile label="Mapped areas" value={data?.geographies.length ?? 0} icon={MapPinned} tone="info" />
        <MetricTile label="Active areas" value={activeGeographies.length} icon={MapPinned} tone="success" />
        <MetricTile label="Availability rules" value={data?.policies.length ?? 0} icon={ShieldCheck} />
        <MetricTile label="Active rules" value={data?.policies.filter((policy) => policy.status === "active").length ?? 0} icon={ShieldCheck} tone="success" />
      </section>

      <section className="coverage-v2__area-strip" aria-label="Mapped service areas">
        <div><strong>Mapped service areas</strong><small>These are the geographic building blocks used by availability and partner coverage.</small></div>
        <div className="coverage-v2__chips">
          {activeGeographies.slice(0, 12).map((area) => <span key={area.id}>{area.canonical_name}</span>)}
          {activeGeographies.length > 12 ? <span>+{activeGeographies.length - 12} more</span> : null}
          {activeGeographies.length === 0 ? <span>No active areas yet</span> : null}
        </div>
      </section>

      <section className="sk-panel">
        <div className="sk-panel__header">
          <div><h2>Availability rules</h2><p className="skima-muted">A smaller mapped area can override a broader area. Operators see the human-readable area and activity; internal IDs stay hidden.</p></div>
        </div>
        <DataTable
          caption="Service availability rules"
          columns={columns}
          records={data?.policies ?? []}
          getRowKey={(policy) => policy.id}
          emptyTitle="No service rules yet"
          emptyMessage="Add a mapped service area, then choose which SKIMA activity is allowed there."
        />
      </section>

      <GeographyFlowDialog
        open={geographyOpen}
        levels={data?.levels ?? []}
        geographies={data?.geographies ?? []}
        defaultCountryCode={data?.defaultCountryCode ?? ""}
        onClose={() => setGeographyOpen(false)}
        onSaved={async () => {
          setGeographyOpen(false);
          setNotice("Service area saved.");
          await refresh();
        }}
      />
      <PolicyFlowDialog
        open={policyOpen}
        geographies={activeGeographies}
        onClose={() => setPolicyOpen(false)}
        onSaved={async () => {
          setPolicyOpen(false);
          setNotice("Availability rule saved.");
          await refresh();
        }}
      />
    </div>
  );
}

const geographySteps: readonly AdminTaskFlowStep[] = [
  { key: "area", label: "Area", description: "Type and hierarchy" },
  { key: "place", label: "Place", description: "Find the real location" },
  { key: "boundary", label: "Boundary", description: "Draw and save" },
];

function GeographyFlowDialog(props: {
  readonly open: boolean;
  readonly levels: z.infer<typeof LevelSchema>[];
  readonly geographies: Geography[];
  readonly defaultCountryCode: string;
  readonly onClose: () => void;
  readonly onSaved: () => Promise<void>;
}) {
  const { supabase, api } = useSessionState();
  const [step, setStep] = useState("area");
  const [form, setForm] = useState<GeographyForm>(EMPTY_GEOGRAPHY);
  const [searchTerm, setSearchTerm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  const placeSearch = useMutation({
    mutationFn: (input: string) => api.post("/lpg/maps/autocomplete", { input }, PlaceSearchSchema),
  });

  useEffect(() => {
    if (!props.open) return;
    setStep("area");
    setForm((current) => current.countryCode ? current : { ...current, countryCode: props.defaultCountryCode || "NG" });
    setError(null);
  }, [props.open, props.defaultCountryCode]);

  if (!props.open) return null;

  const selectedLevel = props.levels.find((level) => level.id === form.levelId);
  const requiredParentLevelId = selectedLevel?.parent_level_id ?? null;
  const parentOptions = requiredParentLevelId
    ? props.geographies.filter((geography) => geography.status === "active" && geography.geography_level_id === requiredParentLevelId)
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
    setStep("boundary");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.levelId) return setError("Choose the area type first.");
    if (!form.name.trim()) return setError("Search for the place and choose the correct result before saving.");
    if (requiredParentLevelId && !form.parentId) return setError("Choose the larger area this place belongs to first.");
    if (!form.boundary.trim()) return setError("Draw or import the real map boundary before saving this service area.");

    setSaving(true);
    setError(null);
    try {
      const boundary = JSON.parse(form.boundary) as unknown;
      const { data: savedDraft, error: draftError } = await supabase.rpc("save_coverage_geometry_draft", {
        p_draft_id: draftId,
        p_draft_type: "GEOGRAPHY_BOUNDARY",
        p_target_id: null,
        p_parent_geography_id: form.parentId || null,
        p_geojson: boundary,
      });
      if (draftError) throw draftError;
      setDraftId(savedDraft as string);
      const { data: geographyId, error: rpcError } = await supabase.rpc("configure_universal_geography", {
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
        p_metadata: { sourceSurface: "admin_geography_v2", geometryDraftId: savedDraft, operatorSelectedPlace: searchTerm },
      });
      if (rpcError) throw rpcError;
      const { error: activationError } = await supabase.rpc("activate_coverage_geometry_draft", {
        p_draft_id: savedDraft,
        p_target_id: geographyId,
        p_reason: `Activated mapped service area: ${form.name.trim()}`,
      });
      if (activationError) throw activationError;
      setForm(EMPTY_GEOGRAPHY);
      setSearchTerm("");
      setDraftId(null);
      await props.onSaved();
    } catch (cause) {
      setError(readError(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog isOpen title="Add service area" onClose={props.onClose} footer={<Button variant="ghost" onClick={props.onClose}>Cancel</Button>}>
      <form id="coverage-geography-v2-form" onSubmit={(event) => void submit(event)}>
        <AdminTaskFlow
          steps={geographySteps}
          activeStep={step}
          onStepChange={(next) => { setError(null); setStep(next); }}
          footer={step === "boundary" ? <Button type="submit" isLoading={saving}>Save service area</Button> : undefined}
        >
          {step === "area" ? (
            <AdminFormSection title="Choose the area" description="Start with the geographic level and its parent. SKIMA keeps database geography details out of the operator flow.">
              <div className="skima-form-grid">
                <TextInput label="Country" value={countryDisplayName(form.countryCode)} disabled />
                <SelectInput
                  label="Area type"
                  value={form.levelId}
                  onChange={(event) => {
                    const levelId = event.currentTarget.value;
                    const nextLevel = props.levels.find((level) => level.id === levelId);
                    const requiredParent = nextLevel?.parent_level_id ?? null;
                    const parentStillValid = Boolean(requiredParent && props.geographies.some((geography) => geography.id === form.parentId && geography.geography_level_id === requiredParent));
                    setForm({ ...form, levelId, parentId: parentStillValid ? form.parentId : "", name: "", externalReference: "" });
                    setSearchTerm("");
                    placeSearch.reset();
                  }}
                  options={[{ label: "Choose area type", value: "" }, ...props.levels.map((level) => ({ label: operatorLevelName(level, form.countryCode), value: level.id }))]}
                  required
                />
                {requiredParentLevelId ? (
                  <SelectInput
                    label="Inside"
                    value={form.parentId}
                    onChange={(event) => setForm({ ...form, parentId: event.currentTarget.value })}
                    options={[{ label: parentOptions.length ? "Choose the larger area" : "Add the larger area first", value: "" }, ...parentOptions.map((geography) => ({ label: geography.canonical_name, value: geography.id }))]}
                    required
                    disabled={!parentOptions.length}
                  />
                ) : null}
              </div>
              {requiredParentLevelId && parentOptions.length === 0 ? <StatusBadge tone="warning">Add the larger parent area first.</StatusBadge> : null}
            </AdminFormSection>
          ) : null}

          {step === "place" ? (
            <AdminFormSection title="Find the real place" description="Search the map provider and select the correct result. SKIMA fills the canonical name and provider reference automatically.">
              <div className="coverage-v2__search-row">
                <TextInput
                  label="Search place"
                  placeholder={selectedLevel ? "Example: Awka South, Anambra" : "Choose an area type first"}
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.currentTarget.value)}
                  disabled={!selectedLevel}
                />
                <Button type="button" variant="outline" disabled={!selectedLevel || searchTerm.trim().length < 3} isLoading={placeSearch.isPending} onClick={() => placeSearch.mutate(searchTerm.trim())}>Search map</Button>
              </div>
              {placeSearch.error ? <StatusBadge tone="danger">{readError(placeSearch.error)}</StatusBadge> : null}
              {placeSearch.data?.predictions.length ? (
                <div className="coverage-v2__place-results" role="list">
                  {placeSearch.data.predictions.slice(0, 6).map((prediction) => (
                    <button type="button" key={prediction.placeId ?? prediction.description} onClick={() => selectPlace(prediction)}>
                      <strong>{prediction.structuredFormatting?.mainText ?? prediction.description.split(",")[0]}</strong>
                      <span>{prediction.structuredFormatting?.secondaryText ?? prediction.description}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </AdminFormSection>
          ) : null}

          {step === "boundary" ? (
            <AdminFormSection title="Confirm the boundary" description="The drawn boundary—not a typed address—is the source of truth used by availability checks.">
              <div className="coverage-v2__selected-place">
                <small>Selected place</small>
                <strong>{form.name || "No place selected yet"}</strong>
                {searchTerm ? <span>{searchTerm}</span> : null}
              </div>
              <AdminGeometryEditor mode="polygon" value={form.boundary} onChange={(boundary) => setForm({ ...form, boundary })} />
              {draftId ? <StatusBadge tone="info">Boundary draft saved while you finish.</StatusBadge> : null}
            </AdminFormSection>
          ) : null}
          {error ? <StatusBadge tone="danger">{error}</StatusBadge> : null}
        </AdminTaskFlow>
      </form>
    </Dialog>
  );
}

const policySteps: readonly AdminTaskFlowStep[] = [
  { key: "scope", label: "Scope", description: "Service, activity and area" },
  { key: "behavior", label: "Availability", description: "Allow, block or schedule" },
  { key: "review", label: "Review", description: "Check conflicts and save" },
];

function PolicyFlowDialog(props: {
  readonly open: boolean;
  readonly geographies: Geography[];
  readonly onClose: () => void;
  readonly onSaved: () => Promise<void>;
}) {
  const { supabase } = useSessionState();
  const [step, setStep] = useState("scope");
  const [form, setForm] = useState<PolicyForm>(EMPTY_POLICY);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<{ signature: string; result: z.infer<typeof PolicyPreviewSchema> } | null>(null);

  useEffect(() => {
    if (!props.open) return;
    setStep("scope");
    setError(null);
  }, [props.open]);

  if (!props.open) return null;
  const signature = JSON.stringify(form);
  const reviewed = form.status !== "active" || preview?.signature === signature;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.capabilityKey || !form.geographyId) {
      setError("Choose the activity and service area first.");
      setStep("scope");
      return;
    }
    if (form.status === "active" && !form.reason.trim()) {
      setError("Explain why this live availability rule is being changed.");
      setStep("behavior");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (form.status === "active" && preview?.signature !== signature) {
        const { data, error: previewError } = await supabase.rpc("preview_universal_service_policy", {
          p_policy_id: null,
          p_service_key: form.serviceKey.trim(),
          p_capability_key: form.capabilityKey.trim(),
          p_geography_id: form.geographyId,
          p_priority: Number(form.priority),
          p_starts_at: form.startsAt || null,
          p_ends_at: form.endsAt || null,
        });
        if (previewError) throw previewError;
        const result = PolicyPreviewSchema.parse(data);
        setPreview({ signature, result });
        setStep("review");
        if (!result.canActivate) setError("This rule conflicts with another rule. Review the conflict before activation.");
        return;
      }

      const { error: rpcError } = await supabase.rpc("configure_universal_service_policy", {
        p_policy_id: null,
        p_service_key: form.serviceKey.trim(),
        p_capability_key: form.capabilityKey.trim(),
        p_geography_id: form.geographyId,
        p_effect: form.effect,
        p_priority: Number(form.priority),
        p_status: form.status,
        p_starts_at: form.startsAt || null,
        p_ends_at: form.endsAt || null,
        p_reason: form.reason.trim(),
        p_configuration: { sourceSurface: "admin_coverage_v2", activationPreviewed: form.status === "active" },
      });
      if (rpcError) throw rpcError;
      setForm(EMPTY_POLICY);
      setPreview(null);
      await props.onSaved();
    } catch (cause) {
      setError(readError(cause));
    } finally {
      setSaving(false);
    }
  };

  const selectedArea = props.geographies.find((area) => area.id === form.geographyId)?.canonical_name ?? "Not selected";

  return (
    <Dialog isOpen title="Add availability rule" onClose={props.onClose} footer={<Button variant="ghost" onClick={props.onClose}>Cancel</Button>}>
      <form id="coverage-policy-v2-form" onSubmit={(event) => void submit(event)}>
        <AdminTaskFlow
          steps={policySteps}
          activeStep={step}
          onStepChange={(next) => { setError(null); setStep(next); }}
          footer={step === "review" ? (
            <Button type="submit" isLoading={saving} disabled={Boolean(preview?.signature === signature && !preview.result.canActivate)}>
              {form.status === "active" && !reviewed ? "Check rule" : "Save rule"}
            </Button>
          ) : undefined}
        >
          {step === "scope" ? (
            <AdminFormSection title="What should this rule control?" description="Choose the SKIMA activity and the human-readable mapped area.">
              <div className="skima-form-grid">
                <SelectInput label="SKIMA service" value={form.serviceKey} onChange={(event) => setForm({ ...form, serviceKey: event.currentTarget.value })} options={[{ label: "LPG refill service", value: "lpg" }]} required />
                <SelectInput
                  label="Activity"
                  value={form.capabilityKey}
                  onChange={(event) => setForm({ ...form, capabilityKey: event.currentTarget.value })}
                  options={[
                    { label: "Choose what this rule controls", value: "" },
                    { label: "Customers can place refill orders", value: "customer_ordering" },
                    { label: "Drivers can register and operate", value: "driver_onboarding" },
                    { label: "Stations can register and operate", value: "station_onboarding" },
                  ]}
                  required
                />
                <SelectInput label="Service area" value={form.geographyId} onChange={(event) => setForm({ ...form, geographyId: event.currentTarget.value })} options={[{ label: "Choose service area", value: "" }, ...props.geographies.map((area) => ({ label: area.canonical_name, value: area.id }))]} required />
              </div>
            </AdminFormSection>
          ) : null}

          {step === "behavior" ? (
            <AdminFormSection title="Choose availability" description="Most operators only need allow/block and whether the rule should go live now. Scheduling and priority are advanced options.">
              <div className="skima-form-grid">
                <SelectInput label="Availability" value={form.effect} onChange={(event) => setForm({ ...form, effect: event.currentTarget.value as PolicyForm["effect"] })} options={[{ label: "Allow this service here", value: "ALLOW" }, { label: "Block this service here", value: "DENY" }]} />
                <SelectInput label="Publish" value={form.status} onChange={(event) => setForm({ ...form, status: event.currentTarget.value as PolicyForm["status"] })} options={[{ label: "Save for review", value: "draft" }, { label: "Turn on now", value: "active" }]} />
              </div>
              <TextAreaInput label="Reason" helperText={form.status === "active" ? "Required for a live change. SKIMA keeps this in the permanent change history." : "Optional while the rule remains a draft."} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.currentTarget.value })} required={form.status === "active"} />
              <details className="coverage-v2__advanced">
                <summary>Advanced scheduling & priority</summary>
                <div className="skima-form-grid">
                  <TextInput label="Rule priority" helperText="Keep this at 0 unless two rules at the same map level must resolve differently." type="number" value={form.priority} onChange={(event) => setForm({ ...form, priority: event.currentTarget.value })} />
                  <TextInput label="Starts on" type="datetime-local" value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.currentTarget.value })} />
                  <TextInput label="Ends on" type="datetime-local" value={form.endsAt} onChange={(event) => setForm({ ...form, endsAt: event.currentTarget.value })} />
                </div>
              </details>
            </AdminFormSection>
          ) : null}

          {step === "review" ? (
            <AdminFormSection title="Review the rule" description="Confirm the operator-facing meaning before SKIMA checks conflicts and saves it.">
              <div className="coverage-v2__review-grid">
                <div><small>Service</small><strong>{friendlyServiceName(form.serviceKey)}</strong></div>
                <div><small>Activity</small><strong>{friendlyCapabilityName(form.capabilityKey)}</strong></div>
                <div><small>Area</small><strong>{selectedArea}</strong></div>
                <div><small>Result</small><strong>{form.effect === "ALLOW" ? "Allowed" : "Blocked"}</strong></div>
                <div><small>Publish</small><strong>{form.status === "active" ? "Turn on now" : "Save for review"}</strong></div>
              </div>
              {preview?.signature === signature ? <PolicyPreview result={preview.result} /> : form.status === "active" ? <StatusBadge tone="info">Save will run a conflict check before this live rule is activated.</StatusBadge> : null}
            </AdminFormSection>
          ) : null}
          {error ? <StatusBadge tone="danger">{error}</StatusBadge> : null}
        </AdminTaskFlow>
      </form>
    </Dialog>
  );
}

function PolicyPreview({ result }: { readonly result: z.infer<typeof PolicyPreviewSchema> }) {
  return (
    <section className="coverage-v2__rule-check">
      <div><strong>Rule check</strong><span>{result.target.geographyName}</span></div>
      <StatusBadge tone={result.canActivate ? "success" : "danger"}>
        {result.canActivate ? "Safe to activate" : `${result.conflicts.length} conflict${result.conflicts.length === 1 ? "" : "s"}`}
      </StatusBadge>
      <p>{result.broaderPolicies.length} broader rule{result.broaderPolicies.length === 1 ? "" : "s"} · {result.narrowerPolicies.length} smaller-area override{result.narrowerPolicies.length === 1 ? "" : "s"}</p>
      {result.conflicts.map((item) => <small key={item.policyId}>{item.geographyName}: {item.effect === "ALLOW" ? "Allowed" : "Blocked"}, priority {item.priority}</small>)}
    </section>
  );
}

function sectionFromRoute(route: string): CoverageSection {
  const child = route.replace(/^\/operations\/coverage\/?/, "").split("/")[0];
  if (coverageSections.some((item) => item.key === child)) return child as CoverageSection;
  return "overview";
}

function coverageSectionHref(section: CoverageSection) {
  return section === "overview" ? "/operations/coverage" : `/operations/coverage/${section}`;
}

function readError(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const message = [record.message, record.details, record.hint, record.code]
      .find((value) => typeof value === "string" && value.trim());
    if (typeof message === "string") return message;
  }
  return "This coverage action could not be completed. Refresh and try again.";
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
  return key === "lpg" ? "LPG refill service" : friendlyCode(key);
}

function friendlyCapabilityName(key: string) {
  const labels: Record<string, string> = {
    customer_ordering: "Customers can place refill orders",
    driver_onboarding: "Drivers can register and operate",
    station_onboarding: "Stations can register and operate",
  };
  return labels[key] ?? friendlyCode(key);
}

function friendlyCode(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function scheduleLabel(startsAt: string | null, endsAt: string | null) {
  if (!startsAt && !endsAt) return "Always";
  if (startsAt && endsAt) return `${new Date(startsAt).toLocaleDateString()} – ${new Date(endsAt).toLocaleDateString()}`;
  if (startsAt) return `From ${new Date(startsAt).toLocaleDateString()}`;
  return `Until ${new Date(endsAt as string).toLocaleDateString()}`;
}
