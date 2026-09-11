import { useQuery, useQueryClient } from "@tanstack/react-query";
import { History, RefreshCcw, Settings2, Webhook } from "lucide-react";

import {
  Button,
  DataTable,
  ErrorState,
  LoadingState,
  MetricTile,
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

export function PlatformWebhookScreen(props: { readonly onNavigate: (href: string) => void }) {
  const { api, status } = useSessionState();
  const client = useQueryClient();
  const enabled = status === "authenticated";

  const endpoints = useQuery({
    queryKey: ["platform-v2", "webhook-endpoints"],
    queryFn: () => api.get("/admin/webhook-endpoints", PlatformRowsSchema),
    enabled,
  });
  const deliveries = useQuery({
    queryKey: ["platform-v2", "webhook-deliveries"],
    queryFn: () => api.get("/admin/webhook-deliveries", PlatformRowsSchema),
    enabled,
    retry: false,
  });
  const attempts = useQuery({
    queryKey: ["platform-v2", "webhook-attempts"],
    queryFn: () => api.get("/admin/webhook-attempts", PlatformRowsSchema),
    enabled,
    retry: false,
  });

  const refresh = async () => client.invalidateQueries({ queryKey: ["platform-v2"] });
  const endpointRows = endpoints.data ?? [];
  const deliveryRows = deliveries.data ?? [];
  const attemptRows = attempts.data ?? [];
  const failedDeliveries = deliveryRows.filter((row) => ["failed", "dead_letter", "exhausted"].includes(text(row, "status"))).length;

  const endpointColumns: TableColumn<PlatformRow>[] = [
    {
      key: "destination",
      header: "Destination",
      render: (row) => (
        <>
          <strong>{text(row, "url") || rowLabel(row, "Webhook")}</strong>
          <br />
          <small>{Array.isArray(row.event_type_keys) ? `${row.event_type_keys.length} event types` : "Configured event delivery"}</small>
        </>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => {
        const value = text(row, "status") || "active";
        return <StatusBadge tone={statusTone(value)}>{friendly(value)}</StatusBadge>;
      },
    },
    { key: "created", header: "Created", render: (row) => formatDate(firstText(row, ["created_at", "updated_at"])) },
  ];

  const deliveryColumns: TableColumn<PlatformRow>[] = [
    {
      key: "status",
      header: "Status",
      render: (row) => {
        const value = text(row, "status") || "queued";
        return <StatusBadge tone={statusTone(value)}>{friendly(value)}</StatusBadge>;
      },
    },
    { key: "attempts", header: "Attempts", render: (row) => String(row.attempt_count ?? 0) },
    { key: "next", header: "Next attempt", render: (row) => formatDate(text(row, "next_attempt_at")) },
    { key: "updated", header: "Updated", render: (row) => formatDate(firstText(row, ["updated_at", "created_at"])) },
  ];

  if (endpoints.isLoading) return <LoadingState label="Loading webhook configuration" />;
  if (endpoints.error) return <ErrorState title="External notifications unavailable" message={readError(endpoints.error)} onRetry={() => void refresh()} />;

  return (
    <div className="platform-v2">
      <AdminV2PageHeader
        eyebrow="Platform configuration · External notifications"
        title="External notification destinations"
        description="Review where SKIMA sends automatic external updates and whether recent deliveries are succeeding. Sensitive delivery configuration remains in the protected advanced layer."
        actions={
          <>
            <Button icon={RefreshCcw} variant="outline" onClick={() => void refresh()}>Refresh</Button>
            <Button icon={Settings2} requiredPermission="platform.providers.manage" onClick={() => props.onNavigate("/platform/configuration/advanced")}>Manage advanced setup</Button>
          </>
        }
      />

      <section className="skima-grid skima-grid--compact">
        <MetricTile label="Destinations" value={endpointRows.length} icon={Webhook} tone="info" />
        <MetricTile label="Active" value={endpointRows.filter((row) => text(row, "status") === "active").length} icon={Webhook} tone="success" />
        <MetricTile label="Recent deliveries" value={deliveryRows.length} icon={History} />
        <MetricTile label="Failed deliveries" value={failedDeliveries} icon={History} tone={failedDeliveries ? "warning" : "success"} />
      </section>

      <section className="sk-panel">
        <div className="sk-panel__header"><div><h2>Webhook destinations</h2><p className="skima-muted">Normal operators see destination and event coverage without delivery credentials or raw configuration fields.</p></div></div>
        <DataTable caption="Webhook destinations" columns={endpointColumns} records={endpointRows} getRowKey={rowId} emptyTitle="No webhook destinations" emptyMessage="External notification destinations will appear here after they are configured." />
      </section>

      <section className="sk-panel">
        <div className="sk-panel__header"><div><h2>Recent delivery health</h2><p className="skima-muted">Retries remain server-controlled. Manual event queueing and specialist delivery settings stay in Advanced configuration.</p></div><StatusBadge>{attemptRows.length} attempts recorded</StatusBadge></div>
        {deliveries.isLoading
          ? <LoadingState label="Loading webhook deliveries" />
          : deliveries.error
          ? <ErrorState title="Webhook deliveries unavailable" message={readError(deliveries.error)} onRetry={() => void deliveries.refetch()} />
          : <DataTable caption="Webhook delivery health" columns={deliveryColumns} records={deliveryRows.slice(0, 50)} getRowKey={rowId} emptyTitle="No webhook deliveries" emptyMessage="Deliveries will appear here after subscribed events occur." />}
      </section>
    </div>
  );
}
