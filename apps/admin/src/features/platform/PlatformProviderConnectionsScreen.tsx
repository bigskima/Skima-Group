import { useQuery } from "@tanstack/react-query";
import { Bot, CreditCard, MapPinned, PlugZap, RefreshCcw, Send } from "lucide-react";
import { useMemo, useState } from "react";

import {
  Button,
  DataTable,
  ErrorState,
  LoadingState,
  MetricTile,
  SelectInput,
  StatusBadge,
  type TableColumn,
} from "@skima/ui";

import { useSessionState } from "../../session";
import { AdminV2PageHeader } from "../../shared/patterns/AdminV2Patterns";
import {
  PlatformRowsSchema,
  type PlatformRow,
  firstText,
  formatDate,
  friendly,
  readError,
  rowId,
  rowLabel,
  statusTone,
  text,
} from "./platform-v2-shared";

export function PlatformProviderConnectionsScreen() {
  const { api, status } = useSessionState();
  const [kindFilter, setKindFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const providers = useQuery({
    queryKey: ["platform-v2", "provider-adapters"],
    queryFn: () => api.get("/engines/provider-adapters", PlatformRowsSchema),
    enabled: status === "authenticated",
  });

  const rows = providers.data ?? [];
  const kinds = useMemo(
    () => Array.from(new Set(rows.map((row) => text(row, "provider_kind")).filter(Boolean))).sort(),
    [rows],
  );
  const filtered = rows.filter((row) => {
    const kind = text(row, "provider_kind");
    const state = text(row, "status");
    return (kindFilter === "all" || kind === kindFilter) && (statusFilter === "all" || state === statusFilter);
  });

  const columns: TableColumn<PlatformRow>[] = [
    {
      key: "provider",
      header: "Provider connection",
      render: (row) => <><strong>{rowLabel(row, "Provider")}</strong><br /><small>{friendly(text(row, "provider_kind") || "service")}</small></>,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => {
        const value = text(row, "status") || "configured";
        return <StatusBadge tone={statusTone(value)}>{friendly(value)}</StatusBadge>;
      },
    },
    {
      key: "capability",
      header: "Runtime posture",
      render: (row) => {
        const config = row.config && typeof row.config === "object" && !Array.isArray(row.config) ? row.config as Record<string, unknown> : null;
        const runtime = config?.runtime_supported;
        if (runtime === true) return <StatusBadge tone="success">Runtime supported</StatusBadge>;
        if (runtime === false) return <StatusBadge tone="warning">Preserved only</StatusBadge>;
        return "Configured";
      },
    },
    { key: "updated", header: "Updated", render: (row) => formatDate(firstText(row, ["updated_at", "created_at"])) },
  ];

  if (providers.isLoading) return <LoadingState label="Loading provider connections" />;
  if (providers.error) return <ErrorState title="Provider connections unavailable" message={readError(providers.error)} onRetry={() => void providers.refetch()} />;

  const active = rows.filter((row) => text(row, "status") === "active").length;
  const payments = rows.filter((row) => text(row, "provider_kind") === "payment").length;
  const maps = rows.filter((row) => text(row, "provider_kind") === "maps").length;
  const ai = rows.filter((row) => ["ai", "artificial_intelligence"].includes(text(row, "provider_kind"))).length;
  const communications = rows.filter((row) => ["sms", "email", "notification", "communications"].includes(text(row, "provider_kind"))).length;

  return (
    <div className="platform-integration-v2">
      <AdminV2PageHeader
        eyebrow="Integrations · Provider connections"
        title="Provider connections"
        description="Inspect SKIMA's swappable provider adapters by job and runtime posture. Provider-specific credentials and low-level engine policies are intentionally not exposed on this normal operations screen."
        actions={<Button icon={RefreshCcw} variant="outline" onClick={() => void providers.refetch()}>Refresh</Button>}
      />

      <section className="skima-grid skima-grid--compact">
        <MetricTile label="Connections" value={rows.length} icon={PlugZap} tone="info" />
        <MetricTile label="Active" value={active} icon={PlugZap} tone={active ? "success" : "warning"} />
        <MetricTile label="Payments" value={payments} icon={CreditCard} />
        <MetricTile label="Maps" value={maps} icon={MapPinned} />
        <MetricTile label="AI" value={ai} icon={Bot} />
        <MetricTile label="Communications" value={communications} icon={Send} />
      </section>

      <section className="sk-panel">
        <div className="sk-panel__header"><div><h2>Adapter directory</h2><p className="skima-muted">Filter by the work the provider performs. Advanced engine definitions remain under Advanced integrations.</p></div></div>
        <div className="skima-form-grid">
          <SelectInput label="Provider type" value={kindFilter} onChange={(event) => setKindFilter(event.currentTarget.value)} options={[{ label: "All provider types", value: "all" }, ...kinds.map((kind) => ({ label: friendly(kind), value: kind }))]} />
          <SelectInput label="Status" value={statusFilter} onChange={(event) => setStatusFilter(event.currentTarget.value)} options={[{ label: "All statuses", value: "all" }, { label: "Active", value: "active" }, { label: "Inactive", value: "inactive" }, { label: "Draft", value: "draft" }, { label: "Disabled", value: "disabled" }]} />
        </div>
        <DataTable caption="Provider connections" columns={columns} records={filtered} getRowKey={rowId} emptyTitle="No provider connections" emptyMessage="No provider records match the selected filters." />
      </section>
    </div>
  );
}
