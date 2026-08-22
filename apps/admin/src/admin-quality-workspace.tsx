import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, MessageSquareWarning, RefreshCcw, Star } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { z } from "zod";

import { createClientIdempotencyKey, normalizeStatusLabel } from "@skima/frontend-core";
import {
  Button,
  DataTable,
  Dialog,
  ErrorState,
  LoadingState,
  MetricTile,
  PageHeader,
  SelectInput,
  StatusBadge,
  TextAreaInput,
  TextInput,
  type TableColumn,
} from "@skima/ui";

import { useSessionState } from "./session";

const ComplaintSchema = z.object({
  complaintId: z.string().uuid(),
  orderId: z.string().uuid(),
  orderReference: z.string().nullable(),
  customerUserId: z.string().uuid(),
  subjectType: z.enum(["driver", "station", "order", "payment", "cylinder"]),
  driverProfileId: z.string().uuid().nullable(),
  stationBranchId: z.string().uuid().nullable(),
  category: z.string(),
  severity: z.enum(["standard", "high", "critical"]),
  description: z.string(),
  status: z.enum(["open", "triaged", "under_review", "resolved", "dismissed"]),
  resolutionCode: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  publicHistory: z.array(z.object({
    eventType: z.string(),
    fromStatus: z.string().nullable(),
    toStatus: z.string().nullable(),
    publicMessage: z.string().nullable(),
    createdAt: z.string(),
  })),
});

const MetricsSchema = z.object({
  openComplaints: z.coerce.number(),
  criticalOpenComplaints: z.coerce.number(),
  resolvedComplaints: z.coerce.number(),
  ratingEvents: z.coerce.number(),
  driverRelationships: z.coerce.number(),
  stationRelationships: z.coerce.number(),
  averageDriverRating: z.coerce.number().nullable(),
  averageStationRating: z.coerce.number().nullable(),
});

type Complaint = z.infer<typeof ComplaintSchema>;

export function AdminQualityWorkspace() {
  const { supabase, status, context } = useSessionState();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Complaint | null>(null);
  const canManage = context?.platformAdmin?.admin_kind === "super_admin" || context?.permissions.includes("lpg.quality.manage") || false;

  const metrics = useQuery({
    queryKey: ["lpg-quality-metrics"],
    enabled: status === "authenticated",
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_lpg_quality_metrics");
      if (error) throw error;
      return MetricsSchema.parse(data);
    },
  });

  const queue = useQuery({
    queryKey: ["lpg-quality-queue", statusFilter, severityFilter],
    enabled: status === "authenticated",
    retry: false,
    queryFn: async () => {
      const targetStatus = statusFilter === "all" || statusFilter === "active" ? null : statusFilter;
      const { data, error } = await supabase.rpc("read_lpg_quality_admin_queue", {
        target_status: targetStatus,
        target_severity: severityFilter === "all" ? null : severityFilter,
        target_limit: 200,
      });
      if (error) throw error;
      const parsed = z.array(ComplaintSchema).parse(data ?? []);
      return statusFilter === "active" ? parsed.filter((item) => !["resolved", "dismissed"].includes(item.status)) : parsed;
    },
  });

  const review = useMutation({
    mutationFn: async ({ complaint, nextStatus, resolutionCode, publicMessage, internalNote }: {
      complaint: Complaint;
      nextStatus: "triaged" | "under_review" | "resolved" | "dismissed";
      resolutionCode: string;
      publicMessage: string;
      internalNote: string;
    }) => {
      const { data, error } = await supabase.rpc("review_lpg_service_complaint", {
        target_complaint_id: complaint.complaintId,
        target_status: nextStatus,
        target_resolution_code: resolutionCode.trim() || null,
        target_public_message: publicMessage.trim() || null,
        target_internal_note: internalNote.trim() || null,
        target_idempotency_key: createClientIdempotencyKey("admin.quality.review", `${complaint.complaintId}:${nextStatus}`),
        target_metadata: { surface: "admin_quality_workspace" },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      setSelected(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["lpg-quality-queue"] }),
        queryClient.invalidateQueries({ queryKey: ["lpg-quality-metrics"] }),
      ]);
    },
  });

  const columns = useMemo<TableColumn<Complaint>[]>(() => [
    {
      key: "order",
      header: "Order",
      render: (record) => <span><strong>{record.orderReference ?? "Refill order"}</strong><br /><small>{formatDate(record.createdAt)}</small></span>,
    },
    {
      key: "issue",
      header: "Issue",
      render: (record) => <span><strong>{friendlyCategory(record.category)}</strong><br /><small>{normalizeStatusLabel(record.subjectType)}</small></span>,
    },
    {
      key: "severity",
      header: "Severity",
      render: (record) => <StatusBadge tone={record.severity === "critical" ? "danger" : record.severity === "high" ? "warning" : "neutral"}>{normalizeStatusLabel(record.severity)}</StatusBadge>,
    },
    {
      key: "status",
      header: "Status",
      render: (record) => <StatusBadge tone={record.status === "resolved" ? "success" : record.status === "dismissed" ? "neutral" : record.status === "under_review" ? "warning" : "brand"}>{normalizeStatusLabel(record.status)}</StatusBadge>,
    },
    {
      key: "actions",
      header: "Actions",
      render: (record) => <Button size="sm" variant="outline" onClick={() => setSelected(record)}>Review</Button>,
    },
  ], []);

  const data = metrics.data;
  return (
    <>
      <PageHeader
        eyebrow="LPG quality"
        title="Quality & Complaints"
        description="Review service-quality reports separately from star ratings. Serious quantity, custody, safety, fraud and payment issues keep their own evidence and resolution history."
        actions={<Button icon={RefreshCcw} variant="outline" onClick={() => { void metrics.refetch(); void queue.refetch(); }}>Refresh</Button>}
      />

      <section className="skima-grid skima-grid--compact">
        <MetricTile label="Open complaints" value={data?.openComplaints ?? 0} icon={MessageSquareWarning} tone={(data?.openComplaints ?? 0) > 0 ? "warning" : "info"} />
        <MetricTile label="Critical open" value={data?.criticalOpenComplaints ?? 0} icon={AlertTriangle} tone={(data?.criticalOpenComplaints ?? 0) > 0 ? "danger" : "success"} />
        <MetricTile label="Driver rating avg." value={formatRating(data?.averageDriverRating)} icon={Star} tone="info" />
        <MetricTile label="Station rating avg." value={formatRating(data?.averageStationRating)} icon={Star} tone="info" />
        <MetricTile label="Rating events" value={data?.ratingEvents ?? 0} icon={Star} tone="success" />
        <MetricTile label="Resolved" value={data?.resolvedComplaints ?? 0} icon={CheckCircle2} tone="success" />
      </section>

      <section className="sk-panel">
        <div className="sk-panel__header">
          <div><h2>Complaint queue</h2><p className="skima-muted">Customer star ratings are service feedback. This queue is for issues that may require evidence, support action or an operational decision.</p></div>
        </div>
        <div className="skima-filter-row">
          <SelectInput
            label="Status"
            value={statusFilter}
            options={[
              { label: "Active", value: "active" },
              { label: "All", value: "all" },
              { label: "Open", value: "open" },
              { label: "Triaged", value: "triaged" },
              { label: "Under review", value: "under_review" },
              { label: "Resolved", value: "resolved" },
              { label: "Dismissed", value: "dismissed" },
            ]}
            onChange={(event) => setStatusFilter(event.currentTarget.value)}
          />
          <SelectInput
            label="Severity"
            value={severityFilter}
            options={[
              { label: "All", value: "all" },
              { label: "Standard", value: "standard" },
              { label: "High", value: "high" },
              { label: "Critical", value: "critical" },
            ]}
            onChange={(event) => setSeverityFilter(event.currentTarget.value)}
          />
        </div>

        {queue.isLoading || metrics.isLoading ? <LoadingState label="Loading quality records" /> : null}
        {queue.error ? <ErrorState title="Quality queue unavailable" message={readError(queue.error)} onRetry={() => void queue.refetch()} /> : null}
        {!queue.isLoading && !queue.error ? (
          <DataTable
            caption="LPG service complaints"
            columns={columns}
            records={queue.data ?? []}
            getRowKey={(record) => record.complaintId}
            emptyTitle="No complaints in this view"
            emptyMessage="There are no LPG service complaints matching the selected filters."
          />
        ) : null}
      </section>

      <ReviewDialog
        complaint={selected}
        canManage={canManage}
        pending={review.isPending}
        error={review.error}
        onClose={() => { if (!review.isPending) { review.reset(); setSelected(null); } }}
        onSubmit={(payload) => { if (selected) review.mutate({ complaint: selected, ...payload }); }}
      />
    </>
  );
}

function ReviewDialog({ complaint, canManage, pending, error, onClose, onSubmit }: {
  complaint: Complaint | null;
  canManage: boolean;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSubmit: (payload: { nextStatus: "triaged" | "under_review" | "resolved" | "dismissed"; resolutionCode: string; publicMessage: string; internalNote: string }) => void;
}) {
  const [nextStatus, setNextStatus] = useState<"triaged" | "under_review" | "resolved" | "dismissed">("under_review");
  const [resolutionCode, setResolutionCode] = useState("");
  const [publicMessage, setPublicMessage] = useState("");
  const [internalNote, setInternalNote] = useState("");

  if (!complaint) return null;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit({ nextStatus, resolutionCode, publicMessage, internalNote });
  };

  return (
    <Dialog
      title={`Review ${friendlyCategory(complaint.category)}`}
      isOpen
      onClose={onClose}
      footer={canManage ? <><Button variant="ghost" disabled={pending} onClick={onClose}>Cancel</Button><Button type="submit" form="quality-review-form" isLoading={pending}>Save review</Button></> : <Button variant="outline" onClick={onClose}>Close</Button>}
    >
      <div className="skima-stack">
        <div className="skima-record-card">
          <strong>{complaint.orderReference ?? "Refill order"}</strong>
          <p>{complaint.description}</p>
          <p className="skima-muted">{normalizeStatusLabel(complaint.subjectType)} • {normalizeStatusLabel(complaint.severity)} • {formatDate(complaint.createdAt)}</p>
        </div>

        {complaint.publicHistory.length > 0 ? (
          <div>
            <h3>Customer-visible history</h3>
            <div className="skima-stack">
              {complaint.publicHistory.map((event, index) => (
                <div className="skima-record-card" key={`${event.createdAt}-${index}`}>
                  <strong>{normalizeStatusLabel(event.toStatus ?? event.eventType)}</strong>
                  {event.publicMessage ? <p>{event.publicMessage}</p> : null}
                  <small>{formatDate(event.createdAt)}</small>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {canManage ? (
          <form id="quality-review-form" className="skima-form-grid" onSubmit={submit}>
            <SelectInput
              label="Next status"
              value={nextStatus}
              options={[
                { label: "Triaged", value: "triaged" },
                { label: "Under review", value: "under_review" },
                { label: "Resolved", value: "resolved" },
                { label: "Dismissed", value: "dismissed" },
              ]}
              onChange={(event) => setNextStatus(event.currentTarget.value as typeof nextStatus)}
            />
            {(nextStatus === "resolved" || nextStatus === "dismissed") ? <TextInput label="Resolution code" value={resolutionCode} onChange={(event) => setResolutionCode(event.currentTarget.value)} /> : null}
            <TextAreaInput label="Customer update" helperText="This message is safe to show to the customer. Do not put internal investigation notes here." value={publicMessage} onChange={(event) => setPublicMessage(event.currentTarget.value)} />
            <TextAreaInput label="Internal review note" helperText="For authorized SKIMA staff only." value={internalNote} onChange={(event) => setInternalNote(event.currentTarget.value)} />
            {error ? <StatusBadge tone="danger">{readError(error)}</StatusBadge> : null}
          </form>
        ) : null}
      </div>
    </Dialog>
  );
}

function friendlyCategory(value: string) {
  const labels: Record<string, string> = {
    underfill: "Possible underfill",
    safety: "Safety concern",
    lost_cylinder: "Cylinder missing",
    switched_cylinder: "Wrong cylinder returned",
    damaged_cylinder: "Cylinder damaged",
    delivery: "Delivery problem",
    payment: "Payment or refund problem",
    conduct: "Conduct concern",
    fraud: "Suspected fraud",
    pricing: "Pricing concern",
    other: "Other issue",
  };
  return labels[value] ?? normalizeStatusLabel(value);
}

function formatRating(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : `${value.toFixed(2)} / 5`;
}
function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
function readError(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object" && typeof (error as Record<string, unknown>).message === "string") return String((error as Record<string, unknown>).message);
  return "This quality action could not be completed. Please try again.";
}
