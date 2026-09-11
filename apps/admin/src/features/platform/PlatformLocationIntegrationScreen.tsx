import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock3, MapPinned, RefreshCcw, Route, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { z } from "zod";

import { createClientIdempotencyKey } from "@skima/frontend-core";
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
import { PlatformMutationSchema, formatDate, friendly, readError, statusTone } from "./platform-v2-shared";

const ProviderSchema = z.object({
  key: z.string(),
  displayName: z.string(),
  status: z.string(),
  active: z.boolean().default(false),
  preserved: z.boolean().default(false),
  runtimeSupported: z.boolean().default(false),
  supports: z.array(z.string()).default([]),
  attribution: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
}).passthrough();
const ChangeSchema = z.object({
  action: z.string().optional(),
  changedBy: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  fromProviderKey: z.string().nullable().optional(),
  toProviderKey: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
}).passthrough();
const MapStatusSchema = z.object({
  activeGeocoderKey: z.string().nullable().optional(),
  activeRouterKey: z.string().nullable().optional(),
  automaticPaidFallback: z.boolean().default(false),
  attribution: z.string().nullable().optional(),
  providers: z.array(ProviderSchema).default([]),
  health: z.record(z.unknown()).nullable().optional(),
  metrics: z.record(z.unknown()).default({}),
  cache: z.record(z.unknown()).default({}),
  recentChanges: z.array(ChangeSchema).default([]),
}).passthrough();

type Provider = z.infer<typeof ProviderSchema>;
type Change = z.infer<typeof ChangeSchema>;

export function PlatformLocationIntegrationScreen() {
  const { api, status } = useSessionState();
  const client = useQueryClient();
  const [changeOpen, setChangeOpen] = useState(false);
  const [providerKey, setProviderKey] = useState("");
  const [reason, setReason] = useState("");

  const query = useQuery({
    queryKey: ["platform-v2", "maps-location-status"],
    queryFn: () => api.get("/admin/maps/location/status", MapStatusSchema),
    enabled: status === "authenticated",
  });

  const changeProvider = useMutation({
    mutationFn: () => {
      if (!providerKey) throw new Error("Choose a runtime-supported location provider.");
      if (reason.trim().length < 10) throw new Error("Explain the operational reason in at least 10 characters.");
      return api.post("/admin/maps/location/provider", {
        providerKey,
        reason: reason.trim(),
        idempotencyKey: createClientIdempotencyKey("admin.maps.provider", providerKey),
      }, PlatformMutationSchema);
    },
    onSuccess: async () => {
      setChangeOpen(false);
      setProviderKey("");
      setReason("");
      await client.invalidateQueries({ queryKey: ["platform-v2", "maps-location-status"] });
    },
  });

  if (query.isLoading) return <LoadingState label="Loading maps and location status" />;
  if (query.error || !query.data) return <ErrorState title="Maps and location unavailable" message={readError(query.error)} onRetry={() => void query.refetch()} />;

  const data = query.data;
  const metrics = data.metrics;
  const cache = data.cache;
  const healthStatus = typeof data.health?.status === "string" ? data.health.status : "unknown";
  const requests24h = numeric(metrics.requests24h);
  const failed24h = numeric(metrics.failed24h);
  const cacheHits24h = numeric(metrics.cacheHits24h);
  const activeEntries = numeric(cache.activeEntries);
  const activeProvider = data.providers.find((provider) => provider.active) ?? null;
  const switchableProviders = data.providers.filter((provider) => provider.runtimeSupported && !provider.active);

  const providerColumns: TableColumn<Provider>[] = [
    { key: "provider", header: "Provider", render: (provider) => <><strong>{provider.displayName}</strong><br /><small>{provider.supports.length ? provider.supports.map(friendly).join(" · ") : "Preserved provider adapter"}</small></> },
    { key: "role", header: "Role", render: (provider) => provider.active ? <StatusBadge tone="success">Active</StatusBadge> : provider.runtimeSupported ? <StatusBadge tone="info">Runtime ready</StatusBadge> : <StatusBadge>Preserved</StatusBadge> },
    { key: "status", header: "Record status", render: (provider) => <StatusBadge tone={statusTone(provider.status)}>{friendly(provider.status)}</StatusBadge> },
    { key: "updated", header: "Updated", render: (provider) => formatDate(provider.updatedAt ?? "") },
  ];
  const changeColumns: TableColumn<Change>[] = [
    { key: "change", header: "Change", render: (change) => <><strong>{providerName(data.providers, change.toProviderKey)}</strong><br /><small>from {providerName(data.providers, change.fromProviderKey)}</small></> },
    { key: "reason", header: "Reason", render: (change) => change.reason || "No reason recorded" },
    { key: "person", header: "Changed by", render: (change) => change.changedBy || "Platform administrator" },
    { key: "date", header: "Changed", render: (change) => formatDate(change.createdAt ?? "") },
  ];

  return (
    <div className="platform-integration-v2">
      <AdminV2PageHeader
        eyebrow="Integrations · Maps & location"
        title="Maps & location"
        description="See the active geocoder and router, recent reliability and cache posture. Provider changes are explicit and audited; SKIMA never automatically falls back to a paid provider."
        actions={<><Button icon={RefreshCcw} variant="outline" onClick={() => void query.refetch()}>Refresh</Button><Button icon={MapPinned} requiredPermission="platform.providers.manage" disabled={switchableProviders.length === 0} onClick={() => setChangeOpen(true)}>Change provider</Button></>}
      />

      <section className="skima-grid skima-grid--compact">
        <MetricTile label="Active provider" value={activeProvider?.displayName ?? "Not configured"} icon={MapPinned} tone={activeProvider ? "success" : "warning"} />
        <MetricTile label="Requests · 24h" value={requests24h} icon={Route} tone="info" />
        <MetricTile label="Provider failures · 24h" value={failed24h} icon={ShieldCheck} tone={failed24h ? "warning" : "success"} />
        <MetricTile label="Cache hits · 24h" value={cacheHits24h} icon={Clock3} />
      </section>

      <section className="sk-panel">
        <div className="sk-panel__header"><div><h2>Location posture</h2><p className="skima-muted">Health: {friendly(healthStatus)} · {activeEntries} active cached location records · automatic paid fallback {data.automaticPaidFallback ? "enabled" : "disabled"}.</p></div><StatusBadge tone={statusTone(healthStatus)}>{friendly(healthStatus)}</StatusBadge></div>
        <DataTable caption="Location providers" columns={providerColumns} records={data.providers} getRowKey={(provider) => provider.key} emptyTitle="No location providers" emptyMessage="Location provider records are not configured yet." />
      </section>

      <section className="sk-panel">
        <div className="sk-panel__header"><div><h2>Provider change history</h2><p className="skima-muted">Every active-provider change is recorded with the responsible administrator and reason.</p></div></div>
        <DataTable caption="Location provider changes" columns={changeColumns} records={data.recentChanges} getRowKey={(change) => `${change.createdAt ?? "change"}:${change.toProviderKey ?? "provider"}`} emptyTitle="No provider changes" emptyMessage="The active location provider has not been changed through this control yet." />
      </section>

      <Dialog
        isOpen={changeOpen}
        title="Change active location provider"
        onClose={() => setChangeOpen(false)}
        footer={<><Button variant="ghost" onClick={() => setChangeOpen(false)}>Cancel</Button><Button form="platform-v2-location-provider" type="submit" isLoading={changeProvider.isPending} requiredPermission="platform.providers.manage">Confirm provider change</Button></>}
      >
        <form id="platform-v2-location-provider" className="skima-form-grid" onSubmit={(event: FormEvent) => { event.preventDefault(); changeProvider.mutate(); }}>
          <div className="admin-notice"><strong>Super Admin control</strong><p>The backend only accepts providers that are registered and runtime-supported. Preserved providers remain unavailable until their runtime path is deliberately enabled.</p></div>
          <SelectInput label="New location provider" value={providerKey} onChange={(event) => setProviderKey(event.currentTarget.value)} options={[{ label: "Choose provider", value: "" }, ...switchableProviders.map((provider) => ({ label: provider.displayName, value: provider.key }))]} required />
          <TextAreaInput label="Operational reason" helperText="Required and permanently recorded in the provider-change history." value={reason} onChange={(event) => setReason(event.currentTarget.value)} required />
          {changeProvider.error ? <StatusBadge tone="danger">{readError(changeProvider.error)}</StatusBadge> : null}
        </form>
      </Dialog>
    </div>
  );
}

function numeric(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function providerName(providers: readonly Provider[], key: string | null | undefined): string {
  if (!key) return "Previous provider";
  return providers.find((provider) => provider.key === key)?.displayName ?? friendly(key.replace("provider.maps.", ""));
}
