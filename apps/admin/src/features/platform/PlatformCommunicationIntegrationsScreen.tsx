import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MailCheck, MessageSquareMore, RefreshCcw, Settings2, Send } from "lucide-react";
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
  PlatformMutationSchema,
  PlatformRowsSchema,
  type PlatformRow,
  firstText,
  formatDate,
  friendly,
  readError,
  rowId,
  statusTone,
  text,
} from "./platform-v2-shared";

export function PlatformCommunicationIntegrationsScreen(props: { readonly onNavigate: (href: string) => void }) {
  const { api, status } = useSessionState();
  const client = useQueryClient();
  const [channelFilter, setChannelFilter] = useState("all");

  const messages = useQuery({
    queryKey: ["platform-v2", "communications-messages"],
    queryFn: () => api.get("/runtime/communications/messages", PlatformRowsSchema),
    enabled: status === "authenticated",
  });

  const sync = useMutation({
    mutationFn: () => api.post("/runtime/communications/sync", { limit: 100 }, PlatformMutationSchema),
    onSuccess: async () => client.invalidateQueries({ queryKey: ["platform-v2", "communications-messages"] }),
  });

  const rows = messages.data ?? [];
  const channels = useMemo(
    () => Array.from(new Set(rows.map((row) => text(row, "channel")).filter(Boolean))).sort(),
    [rows],
  );
  const filtered = channelFilter === "all" ? rows : rows.filter((row) => text(row, "channel") === channelFilter);
  const pending = rows.filter((row) => ["queued", "pending", "processing", "sent"].includes(text(row, "status"))).length;
  const failed = rows.filter((row) => ["failed", "undelivered", "error"].includes(text(row, "status"))).length;
  const delivered = rows.filter((row) => ["delivered", "success", "completed"].includes(text(row, "status"))).length;

  const columns: TableColumn<PlatformRow>[] = [
    {
      key: "message",
      header: "Message",
      render: (row) => <><strong>{friendly(text(row, "purpose") || "Platform communication")}</strong><br /><small>{friendly(text(row, "channel") || "channel")}</small></>,
    },
    { key: "recipient", header: "Recipient", render: (row) => firstText(row, ["recipient_address", "recipient_display_name", "recipient_entity_type"]) || "Platform recipient" },
    {
      key: "status",
      header: "Status",
      render: (row) => {
        const value = text(row, "status") || "queued";
        return <StatusBadge tone={statusTone(value)}>{friendly(value)}</StatusBadge>;
      },
    },
    { key: "updated", header: "Updated", render: (row) => formatDate(firstText(row, ["updated_at", "sent_at", "created_at"])) },
  ];

  if (messages.isLoading) return <LoadingState label="Loading communication delivery status" />;
  if (messages.error) return <ErrorState title="Communications unavailable" message={readError(messages.error)} onRetry={() => void messages.refetch()} />;

  return (
    <div className="platform-integration-v2">
      <AdminV2PageHeader
        eyebrow="Integrations · Communications"
        title="Communication delivery"
        description="Review outbound message delivery across configured channels and synchronize pending provider outcomes. Manual message construction and specialist verification delivery tools stay in Advanced integrations."
        actions={<><Button icon={RefreshCcw} variant="outline" onClick={() => void messages.refetch()}>Refresh</Button><Button icon={MailCheck} requiredPermission="platform.events.manage" isLoading={sync.isPending} onClick={() => sync.mutate()}>Sync delivery status</Button><Button icon={Settings2} variant="outline" requiredPermission="platform.providers.manage" onClick={() => props.onNavigate("/platform/integrations/advanced")}>Advanced tools</Button></>}
      />

      <section className="skima-grid skima-grid--compact">
        <MetricTile label="Recent messages" value={rows.length} icon={MessageSquareMore} tone="info" />
        <MetricTile label="Delivered" value={delivered} icon={MailCheck} tone="success" />
        <MetricTile label="Pending" value={pending} icon={Send} tone={pending ? "warning" : "neutral"} />
        <MetricTile label="Failed" value={failed} icon={MessageSquareMore} tone={failed ? "warning" : "success"} />
      </section>

      {sync.error ? <div className="admin-notice is-error" role="alert">{readError(sync.error)}</div> : null}
      {sync.isSuccess ? <div className="admin-notice" role="status">Provider delivery statuses were synchronized.</div> : null}

      <section className="sk-panel">
        <div className="sk-panel__header"><div><h2>Delivery queue</h2><p className="skima-muted">This screen is for operational delivery health, not composing arbitrary provider payloads.</p></div></div>
        <SelectInput label="Channel" value={channelFilter} onChange={(event) => setChannelFilter(event.currentTarget.value)} options={[{ label: "All channels", value: "all" }, ...channels.map((channel) => ({ label: friendly(channel), value: channel }))]} />
        <DataTable caption="Communication deliveries" columns={columns} records={filtered.slice(0, 100)} getRowKey={rowId} emptyTitle="No communications" emptyMessage="No communication records match the selected channel." />
      </section>
    </div>
  );
}
