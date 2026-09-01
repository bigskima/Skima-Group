import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Database, Gauge, RefreshCcw, Save, Settings2, Warehouse } from "lucide-react";
import { z } from "zod";

import { createClientIdempotencyKey } from "@skima/frontend-core";
import { Button, ErrorState, LoadingState, PageHeader, StatusBadge, TextInput } from "@skima/ui";
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
    publicReference: z.string().nullable(), providerName: z.string(), displayName: z.string(),
    status: z.string(), healthStatus: z.string(), lastSuccessfulSyncAt: z.string().nullable(),
    syncFailureCount: z.coerce.number().int().nonnegative(), lastErrorCode: z.string().nullable(),
  }).passthrough()),
  devices: z.array(z.object({
    publicReference: z.string().nullable(), displayName: z.string(), healthStatus: z.string(),
    lastReadingAt: z.string().nullable(), tankPublicReference: z.string().nullable(),
  }).passthrough()),
  tanks: z.array(z.object({ publicReference: z.string().nullable(), name: z.string(), status: z.string() }).passthrough()),
  reconciliationCases: z.array(z.object({
    publicReference: z.string().nullable(), status: z.string(), severity: z.string(), summary: z.string(),
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
    if (!selectedId && query.data?.stations[0]) setSelectedId(query.data.stations[0].stationBranchId);
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

  return (
    <>
      <PageHeader
        eyebrow="Station operations"
        title="Station Inventory Operations"
        description="Monitor physical stock, SKIMA allocation, reservations, source health and station processing capacity."
        actions={<Button icon={RefreshCcw} variant="outline" onClick={() => void query.refetch()}>Refresh</Button>}
      />
      {query.isLoading ? <LoadingState label="Loading station inventory" /> : null}
      {query.error ? <ErrorState title="Inventory operations unavailable" message={readError(query.error)} onRetry={() => void query.refetch()} /> : null}
      {query.data && !query.error ? (
        <div style={{ display: "grid", gap: "1rem" }}>
          <section className="sk-panel">
            <div className="sk-panel__header">
              <div><p className="admin-section-kicker">Live operations</p><h2>Stations</h2></div>
              <StatusBadge>{query.data.stations.length} stations</StatusBadge>
            </div>
            {query.data.stations.length ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "0.8rem" }}>
                {query.data.stations.map((station) => (
                  <button
                    type="button"
                    key={station.stationBranchId}
                    aria-pressed={selectedId === station.stationBranchId}
                    onClick={() => setSelectedId(station.stationBranchId)}
                    style={{ textAlign: "left", cursor: "pointer", color: "inherit", background: selectedId === station.stationBranchId ? "rgba(15, 157, 138, 0.08)" : "var(--sk-surface, white)", border: selectedId === station.stationBranchId ? "2px solid var(--sk-brand, #0f9d8a)" : "1px solid var(--sk-border, #d0d5dd)", borderRadius: 14, padding: "1rem" }}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.8rem" }}>
                      <div><strong>{station.stationName}</strong><p className="skima-muted" style={{ margin: "0.25rem 0 0" }}>{kg(station.dispatchableKg)} available for SKIMA</p></div>
                      <StatusBadge tone={station.dispatchEligible ? "success" : station.lowStockState === "NORMAL" ? "warning" : "danger"}>{friendly(station.lowStockState)}</StatusBadge>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.65rem", marginTop: "0.9rem" }}>
                      <SmallMetric label="Physical" value={kg(station.physicalStockKg)} />
                      <SmallMetric label="Reserved" value={kg(station.reservedKg)} />
                      <SmallMetric label="Source" value={friendly(station.activeSource ?? station.primarySource)} />
                      <SmallMetric label="Freshness" value={friendly(station.freshness)} />
                    </div>
                  </button>
                ))}
              </div>
            ) : <p className="skima-muted">No station inventory runtimes are available.</p>}
          </section>

          {selected ? <StationInventoryDetail key={selected.stationBranchId} station={selected} runtime={selectedQuery.data ?? null} policy={query.data.policy} /> : null}

          <section className="sk-panel">
            <div className="sk-panel__header">
              <div><p className="admin-section-kicker">Inventory policy</p><h2>Operational thresholds</h2><p className="skima-muted">Friendly platform-wide controls. Every save creates a new audited version.</p></div>
              <Button icon={Settings2} variant="outline" onClick={() => setEditingPolicy((value) => !value)}>{editingPolicy ? "Close" : "Edit policy"}</Button>
            </div>
            {editingPolicy ? <InventoryPolicyEditor policy={query.data.policy} onSaved={() => { setEditingPolicy(false); void query.refetch(); }} /> : <PolicySummary policy={query.data.policy} />}
          </section>
        </div>
      ) : null}
    </>
  );
}

function StationInventoryDetail({ station, runtime, policy }: { readonly station: InventoryStation; readonly runtime: SelectedInventory | null; readonly policy: InventoryPolicy }) {
  const attention = station.rolloutStatus !== "active" || station.openReconciliationCases > 0 || !station.dispatchEligible;
  return (
    <section className="sk-panel">
      <div className="sk-panel__header">
        <div><p className="admin-section-kicker">Selected station</p><h2>{station.stationName}</h2></div>
        <StatusBadge tone={station.dispatchEligible ? "success" : "warning"}>{station.dispatchEligible ? "Dispatch eligible" : "Not dispatch eligible"}</StatusBadge>
      </div>
      {attention ? (
        <div role="status" style={{ display: "flex", gap: "0.7rem", alignItems: "flex-start", background: "rgba(245, 158, 11, 0.10)", borderRadius: 12, padding: "0.85rem", marginBottom: "1rem" }}>
          <AlertTriangle aria-hidden="true" size={20} />
          <div><strong>Operational attention required</strong><p style={{ margin: "0.2rem 0 0" }}>Check stock confirmation, source health, processing capacity and open reconciliation cases before restoring dispatch.</p></div>
        </div>
      ) : null}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.75rem" }}>
        <Metric icon={Warehouse} label="Installed capacity" value={kg(station.installedCapacityKg)} />
        <Metric icon={Database} label="Current physical stock" value={kg(station.physicalStockKg)} />
        <Metric icon={Gauge} label="SKIMA allocation" value={kg(station.skimaAllocationKg)} />
        <Metric icon={Gauge} label="Reserved stock" value={kg(station.reservedKg)} />
        <Metric icon={Gauge} label="Dispatchable stock" value={kg(station.dispatchableKg)} />
        <Metric icon={RefreshCcw} label="Last update" value={station.lastUpdateAt ? new Date(station.lastUpdateAt).toLocaleString() : "Not confirmed"} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.75rem", marginTop: "1rem" }}>
        <DetailCard title="Source health" rows={[["Primary", friendly(station.primarySource)], ["Active", friendly(station.activeSource ?? "Not active")], ["Freshness", friendly(station.freshness)], ["Confidence", friendly(station.confidence)], ["Provider health", friendly(station.providerHealth)]]} />
        <DetailCard title="Processing capacity" rows={[["Active refill jobs", String(station.activeJobs)], ["Concurrent limit", String(station.maximumConcurrentJobs)], ["Workload", friendly(station.congestionStatus)], ["Inventory reliability", `${station.inventoryReliability.toFixed(1)} / 100`], ["Open discrepancies", String(station.openReconciliationCases)], ["Rollout", friendly(station.rolloutStatus)]]} />
        <DetailCard title="Dispatch control" rows={[["Block reason", friendly(station.dispatchBlockReason ?? "None")], ["Blocked until", station.dispatchBlockedUntil ? new Date(station.dispatchBlockedUntil).toLocaleString() : "Not blocked"], ["Manual fallback", station.manualFallbackUntil ? `Until ${new Date(station.manualFallbackUntil).toLocaleString()}` : "Inactive"], ["Configuration", friendly(station.configurationStatus)]]} />
      </div>
      {runtime ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "0.75rem", marginTop: "1rem" }}>
            <RuntimeList title="Provider connections" empty="No inventory provider is connected." items={runtime.connections.map((connection) => ({ key: connection.publicReference ?? connection.displayName, title: connection.displayName, detail: `${connection.providerName} · ${friendly(connection.status)} · ${friendly(connection.healthStatus)} · ${connection.syncFailureCount} recent failures` }))} />
            <RuntimeList title="Telemetry devices" empty="No tank telemetry device is mapped." items={runtime.devices.map((device) => ({ key: device.publicReference ?? device.displayName, title: device.displayName, detail: `${friendly(device.healthStatus)} · last reading ${device.lastReadingAt ? new Date(device.lastReadingAt).toLocaleString() : "not received"}` }))} />
          </div>
          <InventoryOverridePanel station={station} maximumPauseHours={policy.maximumAvailabilityPauseHours} />
          {runtime.reconciliationCases.length ? <ReconciliationPanel cases={runtime.reconciliationCases} /> : null}
        </>
      ) : <p className="skima-muted" style={{ marginTop: "1rem" }}>Loading source, device and reconciliation details…</p>}
    </section>
  );
}

function InventoryOverridePanel({ station, maximumPauseHours }: { readonly station: InventoryStation; readonly maximumPauseHours: number }) {
  const { supabase } = useSessionState();
  const queryClient = useQueryClient();
  const [action, setAction] = useState<"temporarily_unavailable" | "out_of_stock" | "restore" | "require_reconciliation">("temporarily_unavailable");
  const [durationHours, setDurationHours] = useState("2");
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<ActionNotice | null>(null);
  const mutation = useMutation({
    mutationFn: async () => {
      if (reason.trim().length < 5) throw new Error("Add a short reason for this exceptional action.");
      const hours = Number(durationHours);
      if (action === "temporarily_unavailable" && (!Number.isFinite(hours) || hours <= 0 || hours > maximumPauseHours)) throw new Error(`Choose a pause between 1 and ${maximumPauseHours} hours.`);
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
      setNotice({ message: "The audited inventory control was applied.", tone: "success" });
      setReason("");
      await queryClient.invalidateQueries({ queryKey: ["admin-station-inventory"] });
    },
    onError: (error) => setNotice({ message: readError(error), tone: "error" }),
  });
  const actions = [
    ["temporarily_unavailable", "Pause dispatch"], ["out_of_stock", "Mark out of stock"],
    ["require_reconciliation", "Require reconciliation"], ["restore", "Restore verified dispatch"],
  ] as const;
  return <div style={{ border: "1px solid var(--sk-border, #d0d5dd)", borderRadius: 14, padding: "1rem", marginTop: "1rem", display: "grid", gap: "0.8rem" }}>
    <div><p className="admin-section-kicker">Audited controls</p><h3 style={{ margin: 0 }}>Exceptional inventory action</h3><p className="skima-muted">These controls pause or restore dispatch without changing measured stock.</p></div>
    <div role="group" aria-label="Inventory action" style={{ display: "flex", flexWrap: "wrap", gap: "0.55rem" }}>{actions.map(([key, label]) => <Button key={key} aria-pressed={action === key} variant={action === key ? "primary" : "outline"} onClick={() => setAction(key)}>{label}</Button>)}</div>
    {action === "temporarily_unavailable" ? <TextInput label="Pause duration (hours)" type="number" value={durationHours} onChange={(event) => setDurationHours(event.currentTarget.value)} /> : null}
    <TextInput label="Reason for this action" value={reason} onChange={(event) => setReason(event.currentTarget.value)} />
    {notice ? <div role={notice.tone === "error" ? "alert" : "status"} style={{ background: notice.tone === "error" ? "rgba(239, 68, 68, 0.10)" : "rgba(15, 157, 138, 0.08)", borderRadius: 10, padding: "0.7rem" }}>{notice.message}</div> : null}
    <Button icon={Save} isLoading={mutation.isPending} onClick={() => { setNotice(null); mutation.mutate(); }}>Apply audited action</Button>
  </div>;
}

function ReconciliationPanel({ cases }: { readonly cases: SelectedInventory["reconciliationCases"] }) {
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
      if (!selectedReference) throw new Error("Choose a reconciliation case.");
      if (resolution.trim().length < 5) throw new Error("Explain the reconciliation decision.");
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
      setNotice({ message: "Reconciliation decision was recorded.", tone: "success" });
      setResolution("");
      await queryClient.invalidateQueries({ queryKey: ["admin-station-inventory"] });
    },
    onError: (error) => setNotice({ message: readError(error), tone: "error" }),
  });
  return <div style={{ border: "1px solid var(--sk-border, #d0d5dd)", borderRadius: 14, padding: "1rem", marginTop: "1rem", display: "grid", gap: "0.8rem" }}>
    <div><p className="admin-section-kicker">Evidence review</p><h3 style={{ margin: 0 }}>Open reconciliation cases</h3></div>
    <div style={{ display: "grid", gap: "0.55rem" }}>{cases.map((item) => <button key={item.publicReference ?? item.summary} type="button" aria-pressed={selectedReference === item.publicReference} onClick={() => setSelectedReference(item.publicReference ?? "")} style={{ textAlign: "left", cursor: "pointer", border: selectedReference === item.publicReference ? "2px solid var(--sk-brand, #0f9d8a)" : "1px solid var(--sk-border, #d0d5dd)", background: "transparent", color: "inherit", padding: "0.75rem", borderRadius: 10 }}><strong>{item.summary}</strong><div className="skima-muted">{friendly(item.severity)} · {friendly(item.status)} · {item.publicReference ?? "Reference pending"}</div></button>)}</div>
    <TextInput label="Decision notes" value={resolution} onChange={(event) => setResolution(event.currentTarget.value)} />
    {notice ? <div role={notice.tone === "error" ? "alert" : "status"} style={{ borderRadius: 10, padding: "0.7rem", background: notice.tone === "error" ? "rgba(239, 68, 68, 0.10)" : "rgba(15, 157, 138, 0.08)" }}>{notice.message}</div> : null}
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.55rem" }}><Button isLoading={mutation.isPending} onClick={() => mutation.mutate("resolved")}>Resolve</Button><Button variant="outline" isLoading={mutation.isPending} onClick={() => mutation.mutate("dismissed")}>Dismiss</Button><Button variant="outline" isLoading={mutation.isPending} onClick={() => mutation.mutate("escalated")}>Escalate</Button></div>
  </div>;
}

function RuntimeList({ title, items, empty }: { readonly title: string; readonly items: readonly { key: string; title: string; detail: string }[]; readonly empty: string }) {
  return <div style={{ border: "1px solid var(--sk-border, #d0d5dd)", borderRadius: 14, padding: "1rem" }}><h3 style={{ marginTop: 0 }}>{title}</h3>{items.length ? <div style={{ display: "grid", gap: "0.65rem" }}>{items.map((item) => <div key={item.key}><strong>{item.title}</strong><div className="skima-muted" style={{ marginTop: "0.15rem" }}>{item.detail}</div></div>)}</div> : <p className="skima-muted">{empty}</p>}</div>;
}

function InventoryPolicyEditor({ policy, onSaved }: { readonly policy: InventoryPolicy; readonly onSaved: () => void }) {
  const { supabase } = useSessionState();
  const queryClient = useQueryClient();
  const [values, setValues] = useState(() => policyToStrings(policy));
  const [expectedVersion] = useState(policy.configurationVersion);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
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
      if (reason.trim().length < 5) throw new Error("Add a short reason for the policy change.");
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
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["admin-station-inventory"] }); onSaved(); },
    onError: (error) => setNotice(readError(error)),
  });
  const set = (key: keyof typeof values, value: string) => setValues((current) => ({ ...current, [key]: value }));
  return <div style={{ display: "grid", gap: "0.9rem" }}>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.8rem" }}>
      <TextInput label="Confirmation interval (minutes)" type="number" value={values.manualConfirmationIntervalMinutes} onChange={(event) => set("manualConfirmationIntervalMinutes", event.currentTarget.value)} />
      <TextInput label="Warning starts after (minutes)" type="number" value={values.manualWarningIntervalMinutes} onChange={(event) => set("manualWarningIntervalMinutes", event.currentTarget.value)} />
      <TextInput label="Stock becomes stale after (minutes)" type="number" value={values.manualStaleIntervalMinutes} onChange={(event) => set("manualStaleIntervalMinutes", event.currentTarget.value)} />
      <TextInput label="Block dispatch after (minutes)" type="number" value={values.dispatchBlockingIntervalMinutes} onChange={(event) => set("dispatchBlockingIntervalMinutes", event.currentTarget.value)} />
      <TextInput label="Safety reserve value" type="number" value={values.safetyReserveValue} onChange={(event) => set("safetyReserveValue", event.currentTarget.value)} />
      <TextInput label="Low stock threshold (%)" type="number" value={values.lowStockPercentage} onChange={(event) => set("lowStockPercentage", event.currentTarget.value)} />
      <TextInput label="Critical stock threshold (%)" type="number" value={values.criticalStockPercentage} onChange={(event) => set("criticalStockPercentage", event.currentTarget.value)} />
      <TextInput label="Reservation expiry (minutes)" type="number" value={values.reservationExpiryMinutes} onChange={(event) => set("reservationExpiryMinutes", event.currentTarget.value)} />
      <TextInput label="Discrepancy tolerance (kg)" type="number" value={values.discrepancyToleranceKg} onChange={(event) => set("discrepancyToleranceKg", event.currentTarget.value)} />
      <TextInput label="Maximum manual fallback (hours)" type="number" value={values.manualFallbackMaximumHours} onChange={(event) => set("manualFallbackMaximumHours", event.currentTarget.value)} />
      <TextInput label="Provider sync interval (minutes)" type="number" value={values.providerSyncIntervalMinutes} onChange={(event) => set("providerSyncIntervalMinutes", event.currentTarget.value)} />
      <TextInput label="Provider health check (minutes)" type="number" value={values.providerHealthCheckIntervalMinutes} onChange={(event) => set("providerHealthCheckIntervalMinutes", event.currentTarget.value)} />
      <TextInput label="Provider degraded after (minutes)" type="number" value={values.providerDegradedIntervalMinutes} onChange={(event) => set("providerDegradedIntervalMinutes", event.currentTarget.value)} />
      <TextInput label="Provider offline after (minutes)" type="number" value={values.providerOfflineIntervalMinutes} onChange={(event) => set("providerOfflineIntervalMinutes", event.currentTarget.value)} />
      <TextInput label="Provider retry attempts" type="number" value={values.providerRetryMaximumAttempts} onChange={(event) => set("providerRetryMaximumAttempts", event.currentTarget.value)} />
      <TextInput label="First retry delay (seconds)" type="number" value={values.providerRetryBaseSeconds} onChange={(event) => set("providerRetryBaseSeconds", event.currentTarget.value)} />
      <TextInput label="Telemetry warning after (minutes)" type="number" value={values.telemetryWarningIntervalMinutes} onChange={(event) => set("telemetryWarningIntervalMinutes", event.currentTarget.value)} />
      <TextInput label="Telemetry stale after (minutes)" type="number" value={values.telemetryStaleIntervalMinutes} onChange={(event) => set("telemetryStaleIntervalMinutes", event.currentTarget.value)} />
      <TextInput label="Alert reminder interval (minutes)" type="number" value={values.alertReminderIntervalMinutes} onChange={(event) => set("alertReminderIntervalMinutes", event.currentTarget.value)} />
      <TextInput label="Maximum dispatch pause (hours)" type="number" value={values.maximumAvailabilityPauseHours} onChange={(event) => set("maximumAvailabilityPauseHours", event.currentTarget.value)} />
      <TextInput label="Source disagreement warning (%)" type="number" value={values.sourceDisagreementWarningPercentage} onChange={(event) => set("sourceDisagreementWarningPercentage", event.currentTarget.value)} />
      <TextInput label="Source disagreement critical (%)" type="number" value={values.sourceDisagreementCriticalPercentage} onChange={(event) => set("sourceDisagreementCriticalPercentage", event.currentTarget.value)} />
      <TextInput label="Allowed fill difference (kg)" type="number" value={values.actualFillToleranceKg} onChange={(event) => set("actualFillToleranceKg", event.currentTarget.value)} />
      <TextInput label="Maximum fill overage (kg)" type="number" value={values.maximumActualFillOverageKg} onChange={(event) => set("maximumActualFillOverageKg", event.currentTarget.value)} />
      <TextInput label="Unexpected stockout reliability penalty" type="number" value={values.unexpectedStockoutReliabilityPenalty} onChange={(event) => set("unexpectedStockoutReliabilityPenalty", event.currentTarget.value)} />
    </div>
    <div role="group" aria-label="Inventory policy choices" style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem" }}>
      {(["percentage", "fixed_kg"] as const).map((mode) => <Button key={mode} aria-pressed={values.safetyReserveMode === mode} variant={values.safetyReserveMode === mode ? "primary" : "outline"} onClick={() => set("safetyReserveMode", mode)}>{mode === "percentage" ? "Reserve percentage" : "Reserve fixed kg"}</Button>)}
      {(["HIGH", "MEDIUM", "LOW"] as const).map((confidence) => <Button key={confidence} aria-pressed={values.minimumDispatchConfidence === confidence} variant={values.minimumDispatchConfidence === confidence ? "primary" : "outline"} onClick={() => set("minimumDispatchConfidence", confidence)}>{friendly(confidence)} minimum confidence</Button>)}
    </div>
    <TextInput label="Reason for this change" value={reason} onChange={(event) => setReason(event.currentTarget.value)} />
    {policyChangedWhileEditing ? <div role="alert" style={{ background: "rgba(245, 158, 11, 0.12)", padding: "0.8rem", borderRadius: 12 }}>These settings changed while you were editing. Close this form and review the latest policy before saving.</div> : null}
    {notice ? <div role="alert" style={{ background: "rgba(239, 68, 68, 0.10)", padding: "0.8rem", borderRadius: 12 }}>{notice}</div> : null}
    <Button icon={Save} disabled={policyChangedWhileEditing} isLoading={mutation.isPending} onClick={() => { setNotice(null); mutation.mutate(); }}>Save and activate policy</Button>
  </div>;
}

function PolicySummary({ policy }: { readonly policy: InventoryPolicy }) { return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.75rem" }}><SmallMetric label="Confirm every" value={`${policy.manualConfirmationIntervalMinutes} minutes`} /><SmallMetric label="Stale after" value={`${policy.manualStaleIntervalMinutes} minutes`} /><SmallMetric label="Dispatch blocked after" value={`${policy.dispatchBlockingIntervalMinutes} minutes`} /><SmallMetric label="Maximum dispatch pause" value={`${policy.maximumAvailabilityPauseHours} hours`} /><SmallMetric label="Safety reserve" value={`${policy.safetyReserveValue}${policy.safetyReserveMode === "percentage" ? "%" : " kg"}`} /><SmallMetric label="Low / critical" value={`${policy.lowStockPercentage}% / ${policy.criticalStockPercentage}%`} /><SmallMetric label="Minimum confidence" value={friendly(policy.minimumDispatchConfidence)} /><SmallMetric label="Provider sync" value={`Every ${policy.providerSyncIntervalMinutes} minutes`} /><SmallMetric label="Provider degraded / offline" value={`${policy.providerDegradedIntervalMinutes} / ${policy.providerOfflineIntervalMinutes} minutes`} /><SmallMetric label="Telemetry warning / stale" value={`${policy.telemetryWarningIntervalMinutes} / ${policy.telemetryStaleIntervalMinutes} minutes`} /><SmallMetric label="Provider retries" value={`${policy.providerRetryMaximumAttempts} attempts`} /><SmallMetric label="Alert reminders" value={`Every ${policy.alertReminderIntervalMinutes} minutes`} /><SmallMetric label="Source disagreement" value={`${policy.sourceDisagreementWarningPercentage}% / ${policy.sourceDisagreementCriticalPercentage}%`} /></div>; }
function Metric({ icon: Icon, label, value }: { readonly icon: typeof Warehouse; readonly label: string; readonly value: string }) { return <div style={{ border: "1px solid var(--sk-border, #d0d5dd)", borderRadius: 14, padding: "0.9rem" }}><Icon aria-hidden="true" size={19} /><p className="skima-muted" style={{ margin: "0.55rem 0 0.15rem" }}>{label}</p><strong style={{ fontSize: "1.1rem" }}>{value}</strong></div>; }
function SmallMetric({ label, value }: { readonly label: string; readonly value: string }) { return <div><span className="skima-muted" style={{ fontSize: "0.78rem" }}>{label}</span><div style={{ marginTop: "0.15rem", fontWeight: 750 }}>{value}</div></div>; }
function DetailCard({ title, rows }: { readonly title: string; readonly rows: readonly (readonly [string, string])[] }) { return <div style={{ border: "1px solid var(--sk-border, #d0d5dd)", borderRadius: 14, padding: "1rem" }}><h3 style={{ marginTop: 0 }}>{title}</h3><div style={{ display: "grid", gap: "0.55rem" }}>{rows.map(([label, value]) => <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: "1rem" }}><span className="skima-muted">{label}</span><strong style={{ textAlign: "right" }}>{value}</strong></div>)}</div></div>; }
function policyToStrings(policy: InventoryPolicy) { return Object.fromEntries(Object.entries(policy).map(([key, value]) => [key, String(value)])) as { [K in keyof InventoryPolicy]: string }; }
function kg(value: number | null) { return value === null ? "Not confirmed" : `${value.toLocaleString(undefined, { maximumFractionDigits: 3 })} kg`; }
function friendly(value: string) { return value.replace(/[_-]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function readError(error: unknown) { return error instanceof Error && error.message.trim() ? error.message : "The inventory action could not be completed."; }
