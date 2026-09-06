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
  const { supabase, status } = useSessionState();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("active");
  const [selected, setSelected] = useState<Thread | null>(null);
  const queue = useQuery({
    queryKey: ["admin-support", filter],
    enabled: status === "authenticated",
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_support_admin_queue", {
        target_status: filter === "active" ? null : filter,
        target_limit: 200,
      });
      if (error) throw error;
      const rows = ThreadsSchema.parse(data ?? []);
      return filter === "active" ? rows.filter((row) => !["resolved", "closed"].includes(row.status)) : rows;
    },
  });
  const respond = useMutation({
    mutationFn: async (input: { threadId: string; message: string; status: string }) => {
      const { data, error } = await supabase.rpc("respond_to_support_thread", {
        target_thread_id: input.threadId,
        target_body: input.message,
        target_status: input.status,
        target_source: "skima.admin.support",
        target_idempotency_key: createClientIdempotencyKey("admin.support.reply", input.threadId),
        target_metadata: { surface: "admin.support" },
      });
      if (error) throw error;
      return data;
    },
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
    <PageHeader eyebrow="Customer care" title="Support inbox" description="See messages from customers, drivers, and stations, reply to them, and close issues when they are resolved." actions={<Button icon={RefreshCcw} variant="outline" onClick={() => void queue.refetch()}>Refresh</Button>} />
    <section className="skima-grid skima-grid--compact">
      <MetricTile label="Needs attention" value={rows.length} icon={LifeBuoy} tone={rows.some((row) => row.priority === "urgent") ? "warning" : "info"} />
    </section>
    <SelectInput label="Queue" value={filter} onChange={(event) => setFilter(event.currentTarget.value)} options={[{label:"Active",value:"active"},{label:"Open",value:"open"},{label:"In progress",value:"in_progress"},{label:"Waiting",value:"waiting_for_requester"},{label:"Resolved",value:"resolved"}]} />
    {queue.isLoading ? <LoadingState label="Loading support inbox" /> : queue.error ? <ErrorState title="Support messages unavailable" message={readSupportError(queue.error)} onRetry={() => void queue.refetch()} /> :
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


function readSupportError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    for (const key of ["message", "details", "hint", "code"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value;
    }
  }
  return "We could not load support messages. Refresh the page or ask a platform administrator to check the support database migration.";
}
