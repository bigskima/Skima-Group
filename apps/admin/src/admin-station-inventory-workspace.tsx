import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Database,
  Gauge,
  ListFilter,
  PackageSearch,
  PlugZap,
  RefreshCcw,
  Save,
  Settings2,
  ShieldAlert,
  SlidersHorizontal,
  Warehouse,
  Wrench,
} from "lucide-react";
import { z } from "zod";

import { createClientIdempotencyKey } from "@skima/frontend-core";
import { Button, ErrorState, LoadingState, PageHeader, StatusBadge, TextInput } from "@skima/ui";
import { AdminWorkspaceIntro, AdminWorkspaceSections } from "./admin-workspace-sections";
import { useSessionState } from "./session";

const InventoryStationSchema = z.object({
  stationBranchId: z.string().uuid(),
  stationName: z.string().min(1),
  installedCapacityKg: z.coerce.number().nonnegative(),
  installedUsableCapacityKg: z.coerce.number().nonnegative(),
  physicalStockKg: z.coerce.number().nonnegative().nullable(),
  skimaAllocationKg: z.coerce.number().nonnegative(),
  reservedKg: z.coerce.number().nonnegative(),
  dispatchableKg: z.coerce.number().nonnegative(),
  primarySource: z.string(),
  secondarySource: z.string().nullable(),
  fallbackSource: z.string().nullable(),
  activeSource: z.string().nullable(),
  freshness: z.string(),
  confidence: z.string(),
  providerHealth: z.string(),
  lastUpdateAt: z.string().nullable(),
  lowStockState: z.string(),
  reconciliationState: z.string(),
  inventoryReliability: z.coerce.number(),
  rolloutStatus: z.string(),
  dispatchEligible: z.boolean(),
  activeJobs: z.coerce.number().int().nonnegative(),
  maximumConcurrentJobs: z.coerce.number().int().positive(),
  openReconciliationCases: z.coerce.number().int().nonnegative(),
  dispatchBlockedUntil: z.string().nullable(),
  dispatchBlockReason: z.string().nullable(),
  configurationVersion: z.coerce.number().int().positive(),
  inventoryVersion: z.coerce.number().int().positive(),
  operationalCapacityVersion: z.coerce.number().int().positive(),
  manualFallbackUntil: z.string().nullable(),
  configurationStatus: z.string(),
  congestionStatus: z.string(),
});

const InventoryPolicySchema = z.object({
  configurationVersion: z.coerce.number().int().positive(),
  manualConfirmationIntervalMinutes: z.coerce.number().int().positive(),
  manualWarningIntervalMinutes: z.coerce.number().int().positive(),
  manualStaleIntervalMinutes: z.coerce.number().int().positive(),
  dispatchBlockingIntervalMinutes: z.coerce.number().int().positive(),
  safetyReserveMode: z.enum(["fixed_kg", "percentage"]),
  safetyReserveValue: z.coerce.number().nonnegative(),
  lowStockPercentage: z.coerce.number().min(0).max(100),
  criticalStockPercentage: z.coerce.number().min(0).max(100),
  reservationExpiryMinutes: z.coerce.number().int().positive(),
  discrepancyToleranceKg: z.coerce.number().nonnegative(),
  manualFallbackMaximumHours: z.coerce.number().positive(),
  minimumDispatchConfidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  providerSyncIntervalMinutes: z.coerce.number().int().positive(),
  providerHealthCheckIntervalMinutes: z.coerce.number().int().positive(),
  providerDegradedIntervalMinutes: z.coerce.number().int().positive(),
  providerOfflineIntervalMinutes: z.coerce.number().int().positive(),
  providerRetryMaximumAttempts: z.coerce.number().int().positive(),
  providerRetryBaseSeconds: z.coerce.number().int().positive(),
  telemetryWarningIntervalMinutes: z.coerce.number().int().positive(),
  telemetryStaleIntervalMinutes: z.coerce.number().int().positive(),
  alertReminderIntervalMinutes: z.coerce.number().int().positive(),
  maximumAvailabilityPauseHours: z.coerce.number().int().positive(),
  sourceDisagreementWarningPercentage: z.coerce.number().positive(),
  sourceDisagreementCriticalPercentage: z.coerce.number().positive(),
  actualFillToleranceKg: z.coerce.number().nonnegative(),
  maximumActualFillOverageKg: z.coerce.number().nonnegative(),
  unexpectedStockoutReliabilityPenalty: z.coerce.number().min(0).max(100),
});

const SelectedInventorySchema = z.object({
  inventory: z.object({
    dispatchBlockedUntil: z.string().nullable(),
    dispatchBlockReason: z.string().nullable(),
    version: z.coerce.number().int().positive(),
  }).passthrough(),
  configuration: z.object({ manualFallbackUntil: z.string().nullable(), status: z.string() }).passthrough(),
  operationalCapacity: z.object({ version: z.coerce.number().int().positive() }).passthrough(),
  connections: z.array(z.object({
    publicReference: z.string().nullable(),
    providerName: z.string(),
    displayName: z.string(),
    status: z.string(),
    healthStatus: z.string(),
    lastSuccessfulSyncAt: z.string().nullable(),
    syncFailureCount: z.coerce.number().int().nonnegative(),
    lastErrorCode: z.string().nullable(),
  }).passthrough()),
  devices: z.array(z.object({
    publicReference: z.string().nullable(),
    displayName: z.string(),
    healthStatus: z.string(),
    lastReadingAt: z.string().nullable(),
    tankPublicReference: z.string().nullable(),
  }).passthrough()),
  tanks: z.array(z.object({
    publicReference: z.string().nullable(),
    name: z.string(),
    status: z.string(),
  }).passthrough()),
  reconciliationCases: z.array(z.object({
    publicReference: z.string().nullable(),
    status: z.string(),
    severity: z.string(),
    summary: z.string(),
  }).passthrough()),
}).passthrough();

const InventoryOperationsSchema = z.object({
  stations: z.array(InventoryStationSchema),
  policy: InventoryPolicySchema,
  selectedStation: SelectedInventorySchema.nullable().optional(),
});

type InventoryStation = z.infer<typeof InventoryStationSchema>;
type InventoryPolicy = z.infer<typeof InventoryPolicySchema>;
type SelectedInventory = z.infer<typeof SelectedInventorySchema>;
type ActionNotice = { readonly message: string; readonly tone: "success" | "error" };
type WorkspaceLayer = "stations" | "station" | "settings";
type StationLayer = "stock" | "connections" | "controls";
type SettingsLayer = "stock" | "connections" | "safety";

export function AdminStationInventoryWorkspace() {
  const { status, supabase } = useSessionState();
  const query = useQuery({
    queryKey: ["admin-station-inventory"],
    enabled: status === "authenticated",
    queryFn: async () => {
      const result = await supabase.rpc("read_lpg_admin_inventory_operations", {
        target_station_branch_id: null,
        target_limit: 250,
      });
      if (result.error) throw result.error;
      return InventoryOperationsSchema.parse(result.data);
    },
    refetchInterval: 30_000,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [layer, setLayer] = useState<WorkspaceLayer>("stations");
  const [editingPolicy, setEditingPolicy] = useState(false);
  const selected = query.data?.stations.find((station) => station.stationBranchId === selectedId) ?? null;
  const selectedQuery = useQuery({
    queryKey: ["admin-station-inventory", "selected", selectedId],
    enabled: status === "authenticated" && Boolean(selectedId),
    queryFn: async () => {
      const result = await supabase.rpc("read_lpg_admin_inventory_operations", {
        target_station_branch_id: selectedId,
        target_limit: 100,
      });
      if (result.error) throw result.error;
      return InventoryOperationsSchema.parse(result.data).selectedStation ?? null;
    },
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (!selectedId && query.data?.stations[0]) {
      setSelectedId(query.data.stations[0].stationBranchId);
    }
  }, [query.data?.stations, selectedId]);

  useEffect(() => {
    if (status !== "authenticated") return;
    const invalidate = () => {
      void query.refetch();
      if (selectedId) void selectedQuery.refetch();
    };
    let channel = supabase.channel("admin-station-inventory-live");
    for (const table of [
      "station_lpg_inventory_state",
      "station_inventory_reconciliation_cases",
      "station_inventory_provider_connections",
      "station_inventory_telemetry_devices",
      "station_inventory_operational_capacity",
      "station_inventory_alert_states",
    ]) {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table }, invalidate);
    }
    channel.subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [query.refetch, selectedId, selectedQuery.refetch, status, supabase]);

  const stationNeedsAttention = (query.data?.stations ?? []).filter((station) =>
    !station.dispatchEligible || station.openReconciliationCases > 0 || station.lowStockState !== "NORMAL"
  ).length;

  return (
    <>
      <PageHeader
        eyebrow="Station stock"
        title="Station Stock"
        description="See what each station has available, review stock issues, and manage the rules that control order availability."
        actions={
          <Button icon={RefreshCcw} variant="outline" onClick={() => void query.refetch()}>
            Refresh
          </Button>
        }
      />

      <AdminWorkspaceSections
        label="Station stock sections"
        activeKey={layer}
        onChange={(key) => setLayer(key as WorkspaceLayer)}
        sections={[
          {
            key: "stations",
            label: "All stations",
            description: "Choose a station and see its current stock position.",
            icon: Warehouse,
            badge: query.data?.stations.length ?? 0,
          },
          {
            key: "station",
            label: selected?.stationName ?? "Station details",
            description: selected ? "Stock, connected sources and order controls." : "Select a station first.",
            icon: PackageSearch,
            badge: selected?.openReconciliationCases || null,
          },
          {
            key: "settings",
            label: "Stock settings",
            description: "Platform-wide stock, source and safety rules.",
            icon: Settings2,
            badge: stationNeedsAttention || null,
          },
        ]}
      />

      {query.isLoading ? <LoadingState label="Loading station stock" /> : null}
      {query.error ? (
        <ErrorState
          title="Station stock unavailable"
          message={readError(query.error)}
          onRetry={() => void query.refetch()}
        />
      ) : null}

      {query.data && !query.error ? (
        <div className="admin-layer-grid">
          {layer === "stations" ? (
            <StationDirectory
              stations={query.data.stations}
              selectedId={selectedId}
              onSelect={(stationId) => {
                setSelectedId(stationId);
                setLayer("station");
              }}
            />
          ) : null}

          {layer === "station" ? (
            selected ? (
              <StationInventoryDetail
                key={selected.stationBranchId}
                station={selected}
                runtime={selectedQuery.data ?? null}
                policy={query.data.policy}
              />
            ) : (
              <section className="sk-panel">
                <AdminWorkspaceIntro
                  kicker="Station details"
                  title="Choose a station first"
                  description="Open All stations and choose the station you want to review."
                />
                <Button variant="outline" onClick={() => setLayer("stations")}>Choose a station</Button>
              </section>
            )
          ) : null}

          {layer === "settings" ? (
            <section className="sk-panel">
              <div className="sk-panel__header">
                <AdminWorkspaceIntro
                  kicker="Platform rules"
                  title="Stock settings"
                  description="These settings apply across station inventory. Changes are recorded automatically for audit history."
                />
                <Button
                  icon={SlidersHorizontal}
                  variant="outline"
                  onClick={() => setEditingPolicy((value) => !value)}
                >
                  {editingPolicy ? "Close editor" : "Change settings"}
                </Button>
              </div>
              {editingPolicy ? (
                <InventoryPolicyEditor
                  policy={query.data.policy}
                  onSaved={() => {
                    setEditingPolicy(false);
                    void query.refetch();
                  }}
                />
              ) : (
                <PolicySummary policy={query.data.policy} />
              )}
            </section>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function StationDirectory(props: {
  readonly stations: readonly InventoryStation[];
  readonly selectedId: string | null;
  readonly onSelect: (stationId: string) => void;
}) {
  const ready = props.stations.filter((station) => station.dispatchEligible).length;
  const attention = props.stations.length - ready;

  return (
    <section className="sk-panel">
      <div className="sk-panel__header">
        <AdminWorkspaceIntro
          kicker="Live stock"
          title="Choose a station"
          description="Cards show only the information needed to decide which station needs attention. Open a station for the full details."
        />
        <StatusBadge tone={attention ? "warning" : "success"}>
          {attention ? `${attention} need attention` : "All ready"}
        </StatusBadge>
      </div>

      {props.stations.length ? (
        <div className="admin-compact-card-grid">
          {props.stations.map((station) => (
            <button
              type="button"
              key={station.stationBranchId}
              aria-pressed={props.selectedId === station.stationBranchId}
              className={`admin-compact-select-card${props.selectedId === station.stationBranchId ? " is-active" : ""}`}
              onClick={() => props.onSelect(station.stationBranchId)}
            >
              <span className="admin-compact-select-card__header">
                <div>
                  <strong>{station.stationName}</strong>
                  <p>{kg(station.dispatchableKg)} ready for SKIMA orders</p>
                </div>
                <StatusBadge tone={station.dispatchEligible ? "success" : "warning"}>
                  {station.dispatchEligible ? "Ready" : "Check"}
                </StatusBadge>
              </span>
              <span className="admin-compact-metrics">
                <CompactMetric label="Physical stock" value={kg(station.physicalStockKg)} />
                <CompactMetric label="Reserved" value={kg(station.reservedKg)} />
                <CompactMetric label="Stock source" value={friendly(station.activeSource ?? station.primarySource)} />
                <CompactMetric label="Updated" value={shortFreshness(station.lastUpdateAt, station.freshness)} />
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="skima-muted">No station stock records are available yet.</p>
      )}
    </section>
  );
}

function StationInventoryDetail(props: {
  readonly station: InventoryStation;
  readonly runtime: SelectedInventory | null;
  readonly policy: InventoryPolicy;
}) {
  const { station, runtime, policy } = props;
  const [section, setSection] = useState<StationLayer>("stock");
  const attention = station.rolloutStatus !== "active" || station.openReconciliationCases > 0 || !station.dispatchEligible;

  return (
    <section className="sk-panel">
      <div className="sk-panel__header">
        <AdminWorkspaceIntro
          kicker="Station details"
          title={station.stationName}
          description="Review one area at a time instead of scrolling through the entire station operation."
        />
        <StatusBadge tone={station.dispatchEligible ? "success" : "warning"}>
          {station.dispatchEligible ? "Ready for orders" : "Orders paused"}
        </StatusBadge>
      </div>

      {attention ? (
        <div className="admin-inline-warning" role="status">
          <strong>Something needs attention.</strong> Check the highlighted stock, connection or control section before restoring orders.
        </div>
      ) : null}

      <AdminWorkspaceSections
        compact
        label={`${station.stationName} stock sections`}
        activeKey={section}
        onChange={(key) => setSection(key as StationLayer)}
        sections={[
          { key: "stock", label: "Stock", description: "What is available now", icon: Database },
          { key: "connections", label: "Sources & capacity", description: "Connected stock sources and station workload", icon: PlugZap },
          { key: "controls", label: "Order controls", description: "Pause, restore or review stock differences", icon: Wrench, badge: station.openReconciliationCases || null },
        ]}
      />

      {section === "stock" ? (
        <div className="admin-layer-grid">
          <div className="admin-detail-grid">
            <Metric icon={Warehouse} label="Installed capacity" value={kg(station.installedCapacityKg)} />
            <Metric icon={Database} label="Current physical stock" value={kg(station.physicalStockKg)} />
            <Metric icon={Gauge} label="Available to SKIMA" value={kg(station.skimaAllocationKg)} />
            <Metric icon={Gauge} label="Reserved for orders" value={kg(station.reservedKg)} />
            <Metric icon={Gauge} label="Ready for new orders" value={kg(station.dispatchableKg)} />
            <Metric icon={RefreshCcw} label="Last stock update" value={station.lastUpdateAt ? new Date(station.lastUpdateAt).toLocaleString() : "Not confirmed"} />
          </div>
          <div className="admin-detail-grid">
            <DetailCard title="Stock status" rows={[
              ["Stock level", friendly(station.lowStockState)],
              ["Stock confidence", friendly(station.confidence)],
              ["Confidence score", `${station.inventoryReliability.toFixed(1)} / 100`],
              ["Difference review", friendly(station.reconciliationState)],
            ]} />
            <DetailCard title="Order readiness" rows={[
              ["Can receive new orders", station.dispatchEligible ? "Yes" : "No"],
              ["Current refill jobs", String(station.activeJobs)],
              ["Maximum at once", String(station.maximumConcurrentJobs)],
              ["Current workload", friendly(station.congestionStatus)],
            ]} />
          </div>
        </div>
      ) : null}

      {section === "connections" ? (
        runtime ? (
          <div className="admin-layer-grid">
            <div className="admin-detail-grid">
              <DetailCard title="Stock source" rows={[
                ["Main source", friendly(station.primarySource)],
                ["Source in use", friendly(station.activeSource ?? "Not active")],
                ["Data freshness", friendly(station.freshness)],
                ["Connection health", friendly(station.providerHealth)],
              ]} />
              <DetailCard title="Station capacity" rows={[
                ["Current refill jobs", String(station.activeJobs)],
                ["Maximum at once", String(station.maximumConcurrentJobs)],
                ["Workload", friendly(station.congestionStatus)],
                ["Station availability", friendly(station.rolloutStatus)],
              ]} />
            </div>
            <div className="admin-detail-grid">
              <RuntimeList
                title="Connected stock sources"
                empty="No stock source is connected."
                items={runtime.connections.map((connection) => ({
                  key: connection.publicReference ?? connection.displayName,
                  title: connection.displayName,
                  detail: `${connection.providerName} · ${friendly(connection.healthStatus)}${connection.lastSuccessfulSyncAt ? ` · updated ${new Date(connection.lastSuccessfulSyncAt).toLocaleString()}` : ""}`,
                }))}
              />
              <RuntimeList
                title="Tank sensors"
                empty="No tank sensor is connected."
                items={runtime.devices.map((device) => ({
                  key: device.publicReference ?? device.displayName,
                  title: device.displayName,
                  detail: `${friendly(device.healthStatus)} · last reading ${device.lastReadingAt ? new Date(device.lastReadingAt).toLocaleString() : "not received"}`,
                }))}
              />
            </div>
          </div>
        ) : (
          <LoadingState label="Loading station connections" />
        )
      ) : null}

      {section === "controls" ? (
        <div className="admin-layer-grid">
          <div className="admin-detail-grid">
            <DetailCard title="Order availability" rows={[
              ["Current state", station.dispatchEligible ? "Accepting orders" : "Paused"],
              ["Reason", friendly(station.dispatchBlockReason ?? "No block")],
              ["Paused until", station.dispatchBlockedUntil ? new Date(station.dispatchBlockedUntil).toLocaleString() : "Not paused"],
              ["Temporary manual mode", station.manualFallbackUntil ? `Until ${new Date(station.manualFallbackUntil).toLocaleString()}` : "Off"],
            ]} />
            <DetailCard title="Stock checks" rows={[
              ["Open stock differences", String(station.openReconciliationCases)],
              ["Station setup", friendly(station.configurationStatus)],
              ["Stock confidence score", `${station.inventoryReliability.toFixed(1)} / 100`],
            ]} />
          </div>
          <InventoryOverridePanel station={station} maximumPauseHours={policy.maximumAvailabilityPauseHours} />
          {runtime?.reconciliationCases.length ? <ReconciliationPanel cases={runtime.reconciliationCases} /> : (
            <div className="admin-setting-section">
              <h3>No stock differences waiting</h3>
              <p>This station has no open stock difference review at the moment.</p>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

function InventoryOverridePanel(props: {
  readonly station: InventoryStation;
  readonly maximumPauseHours: number;
}) {
  const { station, maximumPauseHours } = props;
  const { supabase } = useSessionState();
  const queryClient = useQueryClient();
  const [action, setAction] = useState<"temporarily_unavailable" | "out_of_stock" | "restore" | "require_reconciliation">("temporarily_unavailable");
  const [durationHours, setDurationHours] = useState("2");
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<ActionNotice | null>(null);
  const mutation = useMutation({
    mutationFn: async () => {
      if (reason.trim().length < 5) throw new Error("Add a short reason for this change.");
      const hours = Number(durationHours);
      if (action === "temporarily_unavailable" && (!Number.isFinite(hours) || hours <= 0 || hours > maximumPauseHours)) {
        throw new Error(`Choose a pause between 1 and ${maximumPauseHours} hours.`);
      }
      const result = await supabase.rpc("apply_lpg_inventory_admin_override", {
        target_action: action,
        target_expected_version: station.inventoryVersion,
        target_idempotency_key: createClientIdempotencyKey(`admin.inventory-${action}`, station.stationBranchId),
        target_metadata: {},
        target_reason: reason.trim(),
        target_source: "skima.admin.inventory.override",
        target_station_branch_id: station.stationBranchId,
        target_until: action === "temporarily_unavailable" ? new Date(Date.now() + hours * 3_600_000).toISOString() : null,
      });
      if (result.error) throw result.error;
    },
    onSuccess: async () => {
      setNotice({ message: "Order availability has been updated.", tone: "success" });
      setReason("");
      await queryClient.invalidateQueries({ queryKey: ["admin-station-inventory"] });
    },
    onError: (error) => setNotice({ message: readError(error), tone: "error" }),
  });
  const actions = [
    ["temporarily_unavailable", "Pause orders"],
    ["out_of_stock", "Mark out of stock"],
    ["require_reconciliation", "Review stock difference"],
    ["restore", "Resume orders"],
  ] as const;

  return (
    <div className="admin-setting-section">
      <h3>Change order availability</h3>
      <p>Use this only when the station should temporarily stop or resume receiving LPG orders. It does not change the measured stock amount.</p>
      <div role="group" aria-label="Order availability action" className="skima-action-row" style={{ marginTop: 12 }}>
        {actions.map(([key, label]) => (
          <Button
            key={key}
            aria-pressed={action === key}
            variant={action === key ? "primary" : "outline"}
            onClick={() => setAction(key)}
          >
            {label}
          </Button>
        ))}
      </div>
      <div className="admin-field-grid" style={{ marginTop: 12 }}>
        {action === "temporarily_unavailable" ? (
          <TextInput
            label="How long should orders be paused? (hours)"
            type="number"
            value={durationHours}
            onChange={(event) => setDurationHours(event.currentTarget.value)}
          />
        ) : null}
        <TextInput
          label="Reason"
          value={reason}
          onChange={(event) => setReason(event.currentTarget.value)}
        />
      </div>
      {notice ? (
        <div
          role={notice.tone === "error" ? "alert" : "status"}
          className={notice.tone === "error" ? "admin-inline-warning" : "skima-status-note"}
          style={{ marginTop: 12 }}
        >
          {notice.message}
        </div>
      ) : null}
      <Button
        icon={Save}
        isLoading={mutation.isPending}
        style={{ marginTop: 12 }}
        onClick={() => {
          setNotice(null);
          mutation.mutate();
        }}
      >
        Apply change
      </Button>
    </div>
  );
}

function ReconciliationPanel(props: { readonly cases: SelectedInventory["reconciliationCases"] }) {
  const { cases } = props;
  const { supabase } = useSessionState();
  const queryClient = useQueryClient();
  const [selectedReference, setSelectedReference] = useState(cases[0]?.publicReference ?? "");
  const [resolution, setResolution] = useState("");
  const [notice, setNotice] = useState<ActionNotice | null>(null);

  useEffect(() => {
    if (cases.some((item) => item.publicReference === selectedReference)) return;
    setSelectedReference(cases[0]?.publicReference ?? "");
    setResolution("");
    setNotice(null);
  }, [cases, selectedReference]);

  const mutation = useMutation({
    mutationFn: async (status: "resolved" | "dismissed" | "escalated") => {
      if (!selectedReference) throw new Error("Choose a stock difference to review.");
      if (resolution.trim().length < 5) throw new Error("Add a short note explaining your decision.");
      const result = await supabase.rpc("resolve_lpg_inventory_reconciliation_case", {
        target_idempotency_key: createClientIdempotencyKey(`admin.inventory-reconciliation-${status}`, selectedReference),
        target_metadata: {},
        target_reconciliation_public_reference: selectedReference,
        target_resolution: resolution.trim(),
        target_source: "skima.admin.inventory.reconciliation",
        target_status: status,
      });
      if (result.error) throw result.error;
    },
    onSuccess: async () => {
      setNotice({ message: "The stock review decision was saved.", tone: "success" });
      setResolution("");
      await queryClient.invalidateQueries({ queryKey: ["admin-station-inventory"] });
    },
    onError: (error) => setNotice({ message: readError(error), tone: "error" }),
  });

  return (
    <div className="admin-setting-section">
      <h3>Stock differences to review</h3>
      <p>Choose one item, add a decision note, and resolve it without leaving this section.</p>
      <div className="admin-layer-grid" style={{ marginTop: 12 }}>
        {cases.map((item) => (
          <button
            key={item.publicReference ?? item.summary}
            type="button"
            aria-pressed={selectedReference === item.publicReference}
            className={`admin-compact-select-card${selectedReference === item.publicReference ? " is-active" : ""}`}
            onClick={() => setSelectedReference(item.publicReference ?? "")}
          >
            <span className="admin-compact-select-card__header">
              <div>
                <strong>{item.summary}</strong>
                <p>{friendly(item.severity)} priority · {friendly(item.status)}</p>
              </div>
              <ShieldAlert aria-hidden="true" size={18} />
            </span>
          </button>
        ))}
      </div>
      <div className="admin-field-grid" style={{ marginTop: 12 }}>
        <TextInput
          label="Decision note"
          value={resolution}
          onChange={(event) => setResolution(event.currentTarget.value)}
        />
      </div>
      {notice ? (
        <div
          role={notice.tone === "error" ? "alert" : "status"}
          className={notice.tone === "error" ? "admin-inline-warning" : "skima-status-note"}
          style={{ marginTop: 12 }}
        >
          {notice.message}
        </div>
      ) : null}
      <div className="skima-action-row" style={{ marginTop: 12 }}>
        <Button isLoading={mutation.isPending} onClick={() => mutation.mutate("resolved")}>Resolve</Button>
        <Button variant="outline" isLoading={mutation.isPending} onClick={() => mutation.mutate("dismissed")}>Dismiss</Button>
        <Button variant="outline" isLoading={mutation.isPending} onClick={() => mutation.mutate("escalated")}>Escalate</Button>
      </div>
    </div>
  );
}

function RuntimeList(props: {
  readonly title: string;
  readonly items: readonly { key: string; title: string; detail: string }[];
  readonly empty: string;
}) {
  return (
    <div className="admin-detail-card">
      <h3>{props.title}</h3>
      {props.items.length ? (
        <div className="admin-detail-card__rows">
          {props.items.map((item) => (
            <div key={item.key}>
              <strong style={{ fontSize: 12 }}>{item.title}</strong>
              <div className="skima-muted" style={{ marginTop: 2, fontSize: 11 }}>{item.detail}</div>
            </div>
          ))}
        </div>
      ) : (
        <p className="skima-muted">{props.empty}</p>
      )}
    </div>
  );
}

function InventoryPolicyEditor(props: {
  readonly policy: InventoryPolicy;
  readonly onSaved: () => void;
}) {
  const { policy, onSaved } = props;
  const { supabase } = useSessionState();
  const queryClient = useQueryClient();
  const [values, setValues] = useState(() => policyToStrings(policy));
  const [expectedVersion] = useState(policy.configurationVersion);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [section, setSection] = useState<SettingsLayer>("stock");
  const policyChangedWhileEditing = policy.configurationVersion !== expectedVersion;

  const mutation = useMutation({
    mutationFn: async () => {
      const parsed = InventoryPolicySchema.parse({
        configurationVersion: expectedVersion,
        manualConfirmationIntervalMinutes: values.manualConfirmationIntervalMinutes,
        manualWarningIntervalMinutes: values.manualWarningIntervalMinutes,
        manualStaleIntervalMinutes: values.manualStaleIntervalMinutes,
        dispatchBlockingIntervalMinutes: values.dispatchBlockingIntervalMinutes,
        safetyReserveMode: values.safetyReserveMode,
        safetyReserveValue: values.safetyReserveValue,
        lowStockPercentage: values.lowStockPercentage,
        criticalStockPercentage: values.criticalStockPercentage,
        reservationExpiryMinutes: values.reservationExpiryMinutes,
        discrepancyToleranceKg: values.discrepancyToleranceKg,
        manualFallbackMaximumHours: values.manualFallbackMaximumHours,
        minimumDispatchConfidence: values.minimumDispatchConfidence,
        providerSyncIntervalMinutes: values.providerSyncIntervalMinutes,
        providerHealthCheckIntervalMinutes: values.providerHealthCheckIntervalMinutes,
        providerDegradedIntervalMinutes: values.providerDegradedIntervalMinutes,
        providerOfflineIntervalMinutes: values.providerOfflineIntervalMinutes,
        providerRetryMaximumAttempts: values.providerRetryMaximumAttempts,
        providerRetryBaseSeconds: values.providerRetryBaseSeconds,
        telemetryWarningIntervalMinutes: values.telemetryWarningIntervalMinutes,
        telemetryStaleIntervalMinutes: values.telemetryStaleIntervalMinutes,
        alertReminderIntervalMinutes: values.alertReminderIntervalMinutes,
        maximumAvailabilityPauseHours: values.maximumAvailabilityPauseHours,
        sourceDisagreementWarningPercentage: values.sourceDisagreementWarningPercentage,
        sourceDisagreementCriticalPercentage: values.sourceDisagreementCriticalPercentage,
        actualFillToleranceKg: values.actualFillToleranceKg,
        maximumActualFillOverageKg: values.maximumActualFillOverageKg,
        unexpectedStockoutReliabilityPenalty: values.unexpectedStockoutReliabilityPenalty,
      });
      if (reason.trim().length < 5) throw new Error("Add a short reason for the settings change.");
      const result = await supabase.rpc("configure_inventory_control_policy", {
        target_actual_fill_tolerance_kg: parsed.actualFillToleranceKg,
        target_alert_reminder_interval_minutes: parsed.alertReminderIntervalMinutes,
        target_change_reason: reason.trim(),
        target_critical_stock_percentage: parsed.criticalStockPercentage,
        target_discrepancy_tolerance_kg: parsed.discrepancyToleranceKg,
        target_dispatch_blocking_interval_minutes: parsed.dispatchBlockingIntervalMinutes,
        target_expected_version: expectedVersion,
        target_idempotency_key: createClientIdempotencyKey("admin.inventory-policy", "global"),
        target_low_stock_percentage: parsed.lowStockPercentage,
        target_manual_confirmation_interval_minutes: parsed.manualConfirmationIntervalMinutes,
        target_manual_fallback_maximum_hours: parsed.manualFallbackMaximumHours,
        target_manual_stale_interval_minutes: parsed.manualStaleIntervalMinutes,
        target_manual_warning_interval_minutes: parsed.manualWarningIntervalMinutes,
        target_maximum_actual_fill_overage_kg: parsed.maximumActualFillOverageKg,
        target_maximum_availability_pause_hours: parsed.maximumAvailabilityPauseHours,
        target_minimum_dispatch_confidence: parsed.minimumDispatchConfidence,
        target_provider_degraded_interval_minutes: parsed.providerDegradedIntervalMinutes,
        target_provider_health_check_interval_minutes: parsed.providerHealthCheckIntervalMinutes,
        target_provider_offline_interval_minutes: parsed.providerOfflineIntervalMinutes,
        target_provider_retry_base_seconds: parsed.providerRetryBaseSeconds,
        target_provider_retry_maximum_attempts: parsed.providerRetryMaximumAttempts,
        target_provider_sync_interval_minutes: parsed.providerSyncIntervalMinutes,
        target_reservation_expiry_minutes: parsed.reservationExpiryMinutes,
        target_safety_reserve_mode: parsed.safetyReserveMode,
        target_safety_reserve_value: parsed.safetyReserveValue,
        target_source_disagreement_critical_percentage: parsed.sourceDisagreementCriticalPercentage,
        target_source_disagreement_warning_percentage: parsed.sourceDisagreementWarningPercentage,
        target_telemetry_stale_interval_minutes: parsed.telemetryStaleIntervalMinutes,
        target_telemetry_warning_interval_minutes: parsed.telemetryWarningIntervalMinutes,
        target_unexpected_stockout_reliability_penalty: parsed.unexpectedStockoutReliabilityPenalty,
      });
      if (result.error) throw result.error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-station-inventory"] });
      onSaved();
    },
    onError: (error) => setNotice(readError(error)),
  });

  const set = (key: keyof typeof values, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  return (
    <div className="admin-layer-grid">
      <AdminWorkspaceSections
        compact
        label="Stock settings sections"
        activeKey={section}
        onChange={(key) => setSection(key as SettingsLayer)}
        sections={[
          { key: "stock", label: "Stock rules", description: "Freshness, reserve and low-stock rules", icon: ListFilter },
          { key: "connections", label: "Sources & sensors", description: "Sync timing and sensor health", icon: PlugZap },
          { key: "safety", label: "Safety & exceptions", description: "Pause limits and stock difference rules", icon: ShieldAlert },
        ]}
      />

      {section === "stock" ? (
        <div className="admin-setting-section">
          <h3>Stock timing and reserve</h3>
          <p>Control how quickly manually confirmed stock becomes old, and when SKIMA should stop accepting new orders.</p>
          <div className="admin-field-grid">
            <TextInput label="Ask for stock confirmation every (minutes)" type="number" value={values.manualConfirmationIntervalMinutes} onChange={(event) => set("manualConfirmationIntervalMinutes", event.currentTarget.value)} />
            <TextInput label="Show a warning after (minutes)" type="number" value={values.manualWarningIntervalMinutes} onChange={(event) => set("manualWarningIntervalMinutes", event.currentTarget.value)} />
            <TextInput label="Treat stock as old after (minutes)" type="number" value={values.manualStaleIntervalMinutes} onChange={(event) => set("manualStaleIntervalMinutes", event.currentTarget.value)} />
            <TextInput label="Stop new orders after (minutes)" type="number" value={values.dispatchBlockingIntervalMinutes} onChange={(event) => set("dispatchBlockingIntervalMinutes", event.currentTarget.value)} />
            <TextInput label="Safety reserve" type="number" value={values.safetyReserveValue} onChange={(event) => set("safetyReserveValue", event.currentTarget.value)} />
            <TextInput label="Low stock warning (%)" type="number" value={values.lowStockPercentage} onChange={(event) => set("lowStockPercentage", event.currentTarget.value)} />
            <TextInput label="Critical stock warning (%)" type="number" value={values.criticalStockPercentage} onChange={(event) => set("criticalStockPercentage", event.currentTarget.value)} />
            <TextInput label="Release unused reservation after (minutes)" type="number" value={values.reservationExpiryMinutes} onChange={(event) => set("reservationExpiryMinutes", event.currentTarget.value)} />
            <TextInput label="Allowed stock difference (kg)" type="number" value={values.discrepancyToleranceKg} onChange={(event) => set("discrepancyToleranceKg", event.currentTarget.value)} />
            <TextInput label="Maximum temporary manual mode (hours)" type="number" value={values.manualFallbackMaximumHours} onChange={(event) => set("manualFallbackMaximumHours", event.currentTarget.value)} />
          </div>
          <div className="skima-action-row" style={{ marginTop: 12 }}>
            {(["percentage", "fixed_kg"] as const).map((mode) => (
              <Button
                key={mode}
                aria-pressed={values.safetyReserveMode === mode}
                variant={values.safetyReserveMode === mode ? "primary" : "outline"}
                onClick={() => set("safetyReserveMode", mode)}
              >
                {mode === "percentage" ? "Reserve as percentage" : "Reserve fixed kg"}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      {section === "connections" ? (
        <div className="admin-setting-section">
          <h3>Connected stock sources and tank sensors</h3>
          <p>Set how often SKIMA checks connected stock systems and how quickly a silent connection should be treated as unhealthy.</p>
          <div className="admin-field-grid">
            <TextInput label="Sync connected stock every (minutes)" type="number" value={values.providerSyncIntervalMinutes} onChange={(event) => set("providerSyncIntervalMinutes", event.currentTarget.value)} />
            <TextInput label="Check connection health every (minutes)" type="number" value={values.providerHealthCheckIntervalMinutes} onChange={(event) => set("providerHealthCheckIntervalMinutes", event.currentTarget.value)} />
            <TextInput label="Mark connection as weak after (minutes)" type="number" value={values.providerDegradedIntervalMinutes} onChange={(event) => set("providerDegradedIntervalMinutes", event.currentTarget.value)} />
            <TextInput label="Mark connection as offline after (minutes)" type="number" value={values.providerOfflineIntervalMinutes} onChange={(event) => set("providerOfflineIntervalMinutes", event.currentTarget.value)} />
            <TextInput label="Retry failed connection this many times" type="number" value={values.providerRetryMaximumAttempts} onChange={(event) => set("providerRetryMaximumAttempts", event.currentTarget.value)} />
            <TextInput label="First retry delay (seconds)" type="number" value={values.providerRetryBaseSeconds} onChange={(event) => set("providerRetryBaseSeconds", event.currentTarget.value)} />
            <TextInput label="Sensor warning after (minutes)" type="number" value={values.telemetryWarningIntervalMinutes} onChange={(event) => set("telemetryWarningIntervalMinutes", event.currentTarget.value)} />
            <TextInput label="Treat sensor reading as old after (minutes)" type="number" value={values.telemetryStaleIntervalMinutes} onChange={(event) => set("telemetryStaleIntervalMinutes", event.currentTarget.value)} />
          </div>
        </div>
      ) : null}

      {section === "safety" ? (
        <div className="admin-setting-section">
          <h3>Safety and exception handling</h3>
          <p>Control how long an admin can pause orders and when conflicting stock information should require a review.</p>
          <div className="admin-field-grid">
            <TextInput label="Repeat stock warning every (minutes)" type="number" value={values.alertReminderIntervalMinutes} onChange={(event) => set("alertReminderIntervalMinutes", event.currentTarget.value)} />
            <TextInput label="Maximum admin order pause (hours)" type="number" value={values.maximumAvailabilityPauseHours} onChange={(event) => set("maximumAvailabilityPauseHours", event.currentTarget.value)} />
            <TextInput label="Warn when stock sources differ by (%)" type="number" value={values.sourceDisagreementWarningPercentage} onChange={(event) => set("sourceDisagreementWarningPercentage", event.currentTarget.value)} />
            <TextInput label="Require review when sources differ by (%)" type="number" value={values.sourceDisagreementCriticalPercentage} onChange={(event) => set("sourceDisagreementCriticalPercentage", event.currentTarget.value)} />
            <TextInput label="Allowed refill difference (kg)" type="number" value={values.actualFillToleranceKg} onChange={(event) => set("actualFillToleranceKg", event.currentTarget.value)} />
            <TextInput label="Maximum refill overage (kg)" type="number" value={values.maximumActualFillOverageKg} onChange={(event) => set("maximumActualFillOverageKg", event.currentTarget.value)} />
            <TextInput label="Confidence score penalty after unexpected stockout" type="number" value={values.unexpectedStockoutReliabilityPenalty} onChange={(event) => set("unexpectedStockoutReliabilityPenalty", event.currentTarget.value)} />
          </div>
          <div className="skima-action-row" style={{ marginTop: 12 }}>
            {(["HIGH", "MEDIUM", "LOW"] as const).map((confidence) => (
              <Button
                key={confidence}
                aria-pressed={values.minimumDispatchConfidence === confidence}
                variant={values.minimumDispatchConfidence === confidence ? "primary" : "outline"}
                onClick={() => set("minimumDispatchConfidence", confidence)}
              >
                {friendly(confidence)} minimum stock confidence
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="admin-setting-section">
        <h3>Reason for this change</h3>
        <p>Write a short plain-language reason. SKIMA keeps this with the change history.</p>
        <div className="admin-field-grid">
          <TextInput label="Reason" value={reason} onChange={(event) => setReason(event.currentTarget.value)} />
        </div>
      </div>

      {policyChangedWhileEditing ? (
        <div role="alert" className="admin-inline-warning">
          These settings changed while you were editing. Close the editor and review the latest settings before saving.
        </div>
      ) : null}
      {notice ? <div role="alert" className="admin-inline-warning">{notice}</div> : null}

      <div className="admin-sticky-save">
        <div>
          <strong>Save all stock settings</strong>
          <small>Your changes across the three sections will be saved together.</small>
        </div>
        <Button
          icon={Save}
          disabled={policyChangedWhileEditing}
          isLoading={mutation.isPending}
          onClick={() => {
            setNotice(null);
            mutation.mutate();
          }}
        >
          Save changes
        </Button>
      </div>
    </div>
  );
}

function PolicySummary(props: { readonly policy: InventoryPolicy }) {
  const { policy } = props;
  return (
    <div className="admin-detail-grid">
      <DetailCard title="Stock freshness" rows={[
        ["Ask for confirmation", `Every ${policy.manualConfirmationIntervalMinutes} minutes`],
        ["Stock becomes old", `${policy.manualStaleIntervalMinutes} minutes`],
        ["Stop new orders", `${policy.dispatchBlockingIntervalMinutes} minutes`],
        ["Maximum admin pause", `${policy.maximumAvailabilityPauseHours} hours`],
      ]} />
      <DetailCard title="Stock protection" rows={[
        ["Safety reserve", `${policy.safetyReserveValue}${policy.safetyReserveMode === "percentage" ? "%" : " kg"}`],
        ["Low / critical warning", `${policy.lowStockPercentage}% / ${policy.criticalStockPercentage}%`],
        ["Minimum stock confidence", friendly(policy.minimumDispatchConfidence)],
        ["Allowed stock difference", `${policy.discrepancyToleranceKg} kg`],
      ]} />
      <DetailCard title="Connected sources" rows={[
        ["Sync frequency", `Every ${policy.providerSyncIntervalMinutes} minutes`],
        ["Weak / offline", `${policy.providerDegradedIntervalMinutes} / ${policy.providerOfflineIntervalMinutes} minutes`],
        ["Sensor warning / old", `${policy.telemetryWarningIntervalMinutes} / ${policy.telemetryStaleIntervalMinutes} minutes`],
        ["Retry attempts", String(policy.providerRetryMaximumAttempts)],
      ]} />
    </div>
  );
}

function Metric(props: {
  readonly icon: typeof Warehouse;
  readonly label: string;
  readonly value: string;
}) {
  const Icon = props.icon;
  return (
    <div className="admin-detail-card">
      <Icon aria-hidden="true" size={19} />
      <p className="skima-muted" style={{ margin: "8px 0 2px", fontSize: 11 }}>{props.label}</p>
      <strong>{props.value}</strong>
    </div>
  );
}

function CompactMetric(props: { readonly label: string; readonly value: string }) {
  return (
    <span className="admin-compact-metric">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </span>
  );
}

function DetailCard(props: {
  readonly title: string;
  readonly rows: readonly (readonly [string, string])[];
}) {
  return (
    <div className="admin-detail-card">
      <h3>{props.title}</h3>
      <div className="admin-detail-card__rows">
        {props.rows.map(([label, value]) => (
          <div className="admin-detail-card__row" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function policyToStrings(policy: InventoryPolicy) {
  return Object.fromEntries(
    Object.entries(policy).map(([key, value]) => [key, String(value)]),
  ) as { [K in keyof InventoryPolicy]: string };
}

function kg(value: number | null) {
  return value === null
    ? "Not confirmed"
    : `${value.toLocaleString(undefined, { maximumFractionDigits: 3 })} kg`;
}

function shortFreshness(lastUpdateAt: string | null, fallback: string) {
  if (!lastUpdateAt) return friendly(fallback);
  const date = new Date(lastUpdateAt);
  if (Number.isNaN(date.getTime())) return friendly(fallback);
  return new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(date);
}

function friendly(value: string) {
  return value.replace(/[_-]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function readError(error: unknown) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "The station stock action could not be completed.";
}
