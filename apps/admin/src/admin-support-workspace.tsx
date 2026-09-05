import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LifeBuoy, RefreshCcw, Send } from "lucide-react";
import { useMemo, useState } from "react";
import { z } from "zod";

import { createClientIdempotencyKey, normalizeStatusLabel } from "@skima/frontend-core";
import { Button, DataTable, Dialog, ErrorState, LoadingState, MetricTile, PageHeader, SelectInput, StatusBadge, TextAreaInput, type TableColumn } from "@skima/ui";
import { useSessionState } from "./session";

const MessageSchema = z.object({ id: z.string().uuid(), authorKind: z.enum(["requester", "admin"]), body: z.string(), createdAt: z.string() });
const ThreadSchema = z.object({
  id: z.string().uuid(), requester_user_id: z.string().uuid(), requester_name: z.string().nullable(),
  workspace: z.string(), category: z.string(), priority: z.enum(["low", "normal", "high", "urgent"]),
  subject: z.string(), status: z.enum(["open", "in_progress", "waiting_for_requester", "resolved", "closed"]),
  last_message_at: z.string(), created_at: z.string(), messages: z.array(MessageSchema),
});
const ThreadsSchema = z.array(ThreadSchema);
type Thread = z.infer<typeof ThreadSchema>;

export function AdminSupportWorkspace() {
  const { api, status } = useSessionState();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("active");
  const [selected, setSelected] = useState<Thread | null>(null);
  const queue = useQuery({
    queryKey: ["admin-support", filter],
    enabled: status === "authenticated",
    queryFn: async () => {
      const rows = await api.get("/admin/support/threads?limit=200", ThreadsSchema);
      return filter === "active" ? rows.filter((row) => !["resolved", "closed"].includes(row.status)) : rows.filter((row) => row.status === filter);
    },
  });
  const respond = useMutation({
    mutationFn: (input: { threadId: string; message: string; status: string }) => api.post("/admin/support/respond", {
      ...input, source: "skima.admin.support", idempotencyKey: createClientIdempotencyKey("admin.support.reply", input.threadId),
    }, z.union([z.string(), z.record(z.unknown()), z.null()])),
    onSuccess: async () => { setSelected(null); await queryClient.invalidateQueries({ queryKey: ["admin-support"] }); },
  });
  const rows = queue.data ?? [];
  const columns = useMemo<TableColumn<Thread>[]>(() => [
    { key: "requester", header: "Requester", render: (row) => <span><strong>{row.requester_name ?? "SKIMA user"}</strong><br/><small>{normalizeStatusLabel(row.workspace)}</small></span> },
    { key: "issue", header: "Conversation", render: (row) => <span><strong>{row.subject}</strong><br/><small>{normalizeStatusLabel(row.category)}</small></span> },
    { key: "priority", header: "Priority", render: (row) => <StatusBadge tone={row.priority === "urgent" ? "danger" : row.priority === "high" ? "warning" : "neutral"}>{normalizeStatusLabel(row.priority)}</StatusBadge> },
    { key: "status", header: "Status", render: (row) => <StatusBadge>{normalizeStatusLabel(row.status)}</StatusBadge> },
    { key: "action", header: "", render: (row) => <Button size="sm" variant="outline" onClick={() => setSelected(row)}>Open</Button> },
  ], []);
  return <>
    <PageHeader eyebrow="Customer care" title="Support inbox" description="Receive, inspect, answer, and resolve support requests from every SKIMA workspace." actions={<Button icon={RefreshCcw} variant="outline" onClick={() => void queue.refetch()}>Refresh</Button>} />
    <section className="skima-grid skima-grid--compact">
      <MetricTile label="Needs attention" value={rows.length} icon={LifeBuoy} tone={rows.some((row) => row.priority === "urgent") ? "warning" : "info"} />
    </section>
    <SelectInput label="Queue" value={filter} onChange={(event) => setFilter(event.currentTarget.value)} options={[{label:"Active",value:"active"},{label:"Open",value:"open"},{label:"In progress",value:"in_progress"},{label:"Waiting",value:"waiting_for_requester"},{label:"Resolved",value:"resolved"}]} />
    {queue.isLoading ? <LoadingState label="Loading support inbox" /> : queue.error ? <ErrorState title="Support inbox unavailable" message={String(queue.error)} onRetry={() => void queue.refetch()} /> :
      <DataTable caption="Support conversations" columns={columns} records={rows} getRowKey={(row) => row.id} emptyTitle="Inbox clear" emptyMessage="No support conversations match this queue." />}
    {selected ? <ResponseDialog thread={selected} busy={respond.isPending} error={respond.error} onClose={() => setSelected(null)} onSubmit={(message, nextStatus) => respond.mutate({ threadId: selected.id, message, status: nextStatus })} /> : null}
  </>;
}

function ResponseDialog({ thread, busy, error, onClose, onSubmit }: { thread: Thread; busy: boolean; error: Error | null; onClose(): void; onSubmit(message: string, status: string): void }) {
  const [message, setMessage] = useState("");
  const [nextStatus, setNextStatus] = useState("in_progress");
  return <Dialog isOpen title={thread.subject} onClose={onClose}>
    <div className="skima-form">
      <div className="admin-notice">{thread.messages.map((entry) => <p key={entry.id}><strong>{entry.authorKind === "admin" ? "SKIMA" : "Requester"}:</strong> {entry.body}</p>)}</div>
      <TextAreaInput label="Reply" value={message} onChange={(event) => setMessage(event.currentTarget.value)} rows={5} required />
      <SelectInput label="Set status" value={nextStatus} onChange={(event) => setNextStatus(event.currentTarget.value)} options={[{label:"In progress",value:"in_progress"},{label:"Waiting for requester",value:"waiting_for_requester"},{label:"Resolved",value:"resolved"}]} />
      {error ? <div className="admin-notice is-error" role="alert">{error.message}</div> : null}
      <Button icon={Send} isLoading={busy} disabled={!message.trim()} onClick={() => onSubmit(message.trim(), nextStatus)}>Send response</Button>
    </div>
  </Dialog>;
}
