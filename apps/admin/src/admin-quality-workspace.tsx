import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, RefreshCcw, ShieldAlert, Star } from "lucide-react";
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
  subjectType: z.enum(["driver", "station", "order", "payment", "cylinder"]),
  driverProfileId: z.string().uuid().nullable(),
  stationBranchId: z.string().uuid().nullable(),
  category: z.string(),
  severity: z.enum(["standard", "high", "critical"]),
  description: z.string(),
  status: z.enum(["open", "triaged", "under_review", "resolved", "dismissed"]),
  resolutionCode: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const QueueSchema = z.array(ComplaintSchema);
const SupportTriageSchema = z.object({
  complaintId: z.string().uuid(),
  priorityScore: z.number(),
  priorityLevel: z.enum(["routine", "elevated", "urgent", "critical"]),
  slaStatus: z.enum(["on_track", "due_soon", "overdue"]),
  attentionBy: z.string(),
  relatedOpenCases: z.number().int().nonnegative(),
  recommendedAction: z.string(),
  generatedAt: z.string(),
  validUntil: z.string(),
});
const SupportTriageQueueSchema = z.array(SupportTriageSchema);
type Complaint = z.infer<typeof ComplaintSchema>;
type SupportTriage = z.infer<typeof SupportTriageSchema>;

export function AdminQualityWorkspace() {
  const { supabase, status, context } = useSessionState();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [reviewTarget, setReviewTarget] = useState<Complaint | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canManage = context?.platformAdmin?.admin_kind === "super_admin" ||
    context?.permissions.includes("lpg.quality.manage") ||
    context?.permissions.includes("lpg.operations.manage") ||
    false;

  const queue = useQuery({
    queryKey: ["lpg-quality-admin", statusFilter],
    enabled: status === "authenticated",
    retry: false,
    queryFn: async () => {
      const rpcStatus = statusFilter === "active" ? null : statusFilter;
      const { data, error } = await supabase.rpc("read_lpg_quality_admin_queue", {
        target_status: rpcStatus,
        target_limit: 200,
      });
      if (error) throw error;
      const parsed = QueueSchema.parse(data ?? []);
      return statusFilter === "active"
        ? parsed.filter((item) => !["resolved", "dismissed"].includes(item.status))
        : parsed;
    },
  });

  const triage = useQuery({
    queryKey: ["lpg-quality-triage"],
    enabled: status === "authenticated",
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_ai_support_triage_assessments", {
        target_minimum_priority: "routine",
        target_limit: 200,
      });
      if (error) throw error;
      return SupportTriageQueueSchema.parse(data ?? []);
    },
  });

  const rows = queue.data ?? [];
  const triageRows = triage.data ?? [];
  const triageByComplaintId = useMemo(
    () => new Map(triageRows.map((item) => [item.complaintId, item] as const)),
    [triageRows],
  );
  const openCount = rows.filter((item) => item.status === "open").length;
  const criticalCount = rows.filter((item) => item.severity === "critical" && !["resolved", "dismissed"].includes(item.status)).length;
  const urgentTriageCount = triageRows.filter((item) => ["urgent", "critical"].includes(item.priorityLevel)).length;
  const overdueTriageCount = triageRows.filter((item) => item.slaStatus === "overdue").length;

  const review = useMutation({
    mutationFn: async ({
      complaint,
      nextStatus,
      resolutionCode,
      publicMessage,
      internalNote,
    }: {
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
        target_idempotency_key: createClientIdempotencyKey(
          "admin.quality.review",
          `${complaint.complaintId}:${nextStatus}`,
        ),
        target_metadata: { surface: "admin_quality_workspace" },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async (_data, variables) => {
      setReviewTarget(null);
      setNotice(`Complaint moved to ${normalizeStatusLabel(variables.nextStatus)}.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["lpg-quality-admin"] }),
        queryClient.invalidateQueries({ queryKey: ["lpg-quality-triage"] }),
      ]);
    },
  });

  const columns = useMemo<TableColumn<Complaint>[]>(() => [
    {
      key: "issue",
      header: "Issue",
      render: (record) => (
        <span>
          <strong>{categoryLabel(record.category)}</strong><br />
          <small>{subjectLabel(record.subjectType)} • {shortId(record.orderId)}</small>
        </span>
      ),
    },
    {
      key: "severity",
      header: "Severity",
      render: (record) => (
        <StatusBadge tone={record.severity === "critical" ? "danger" : record.severity === "high" ? "warning" : "neutral"}>
          {normalizeStatusLabel(record.severity)}
        </StatusBadge>
      ),
    },
    {
      key: "priority",
      header: "Triage",
      render: (record) => {
        const assessment = triageByComplaintId.get(record.complaintId);
        if (!assessment) return <span className="skima-muted">Manual</span>;
        return (
          <span className="admin-quality-triage-cell">
            <StatusBadge tone={triageTone(assessment.priorityLevel)}>
              {normalizeStatusLabel(assessment.priorityLevel)}
            </StatusBadge>
            <small className={assessment.slaStatus === "overdue" ? "is-overdue" : ""}>
              {assessment.slaStatus === "overdue"
                ? "Attention overdue"
                : assessment.slaStatus === "due_soon"
                ? "Due soon"
                : "On track"}
            </small>
          </span>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      render: (record) => (
        <StatusBadge tone={record.status === "resolved" ? "success" : record.status === "dismissed" ? "neutral" : record.status === "under_review" ? "warning" : "info"}>
          {normalizeStatusLabel(record.status)}
        </StatusBadge>
      ),
    },
    {
      key: "description",
      header: "Customer report",
      render: (record) => <span>{record.description}</span>,
    },
    {
      key: "created",
      header: "Received",
      render: (record) => formatDate(record.createdAt),
    },
    {
      key: "actions",
      header: "Actions",
      render: (record) => canManage && !["resolved", "dismissed"].includes(record.status)
        ? <Button size="sm" variant="outline" onClick={() => setReviewTarget(record)}>Review</Button>
        : <span className="skima-muted">Closed</span>,
    },
  ], [canManage, triageByComplaintId]);

  return (
    <>
      <PageHeader
        eyebrow="LPG operations"
        title="Service Quality"
        description="Review customer service reports separately from star ratings. Underfill, safety, custody, payment and conduct reports require evidence-based handling before they affect a partner."
        actions={<Button icon={RefreshCcw} variant="outline" onClick={() => {
          void queue.refetch();
          void triage.refetch();
        }}>Refresh</Button>}
      />

      {notice ? <StatusBadge tone="success" className="skima-status-note">{notice}</StatusBadge> : null}

      <section className="skima-grid skima-grid--compact">
        <MetricTile label="Open reports" value={openCount} icon={AlertTriangle} tone={openCount ? "warning" : "success"} />
        <MetricTile label="Critical active" value={criticalCount} icon={ShieldAlert} tone={criticalCount ? "danger" : "success"} />
        <MetricTile label="Urgent triage" value={urgentTriageCount} icon={Star} tone={urgentTriageCount ? "warning" : "success"} />
        <MetricTile label="Attention overdue" value={overdueTriageCount} icon={CheckCircle2} tone={overdueTriageCount ? "danger" : "success"} />
      </section>

      <section className="sk-panel">
        <div className="sk-panel__header">
          <div>
            <h2>Quality reports</h2>
            <p className="skima-muted">A complaint is an allegation until reviewed. Do not treat a low rating alone as proof of underfilling, fraud or unsafe conduct.</p>
            {triage.error ? (
              <p className="admin-quality-triage-unavailable">
                Triage intelligence is unavailable. The manual quality queue remains fully usable.
              </p>
            ) : (
              <p className="admin-quality-triage-advisory">
                Triage priority is advisory only. It cannot resolve a complaint, suspend a partner, change dispatch or move money.
              </p>
            )}
          </div>
          <SelectInput
            label="Status"
            value={statusFilter}
            options={[
              { label: "Active reports", value: "active" },
              { label: "Open", value: "open" },
              { label: "Triaged", value: "triaged" },
              { label: "Under review", value: "under_review" },
              { label: "Resolved", value: "resolved" },
              { label: "Dismissed", value: "dismissed" },
            ]}
            onChange={(event) => setStatusFilter(event.currentTarget.value)}
          />
        </div>

        {queue.isLoading ? <LoadingState label="Loading service reports" /> : null}
        {queue.error ? <ErrorState title="Service reports unavailable" message={readError(queue.error)} onRetry={() => void queue.refetch()} /> : null}
        {!queue.isLoading && !queue.error ? (
          <DataTable
            caption="LPG service quality reports"
            columns={columns}
            records={rows}
            getRowKey={(record) => record.complaintId}
            emptyTitle="No reports in this view"
            emptyMessage="There are no customer service reports matching the selected status."
          />
        ) : null}
      </section>

      <ReviewDialog
        complaint={reviewTarget}
        triage={reviewTarget ? triageByComplaintId.get(reviewTarget.complaintId) ?? null : null}
        isSubmitting={review.isPending}
        error={review.error}
        onClose={() => {
          if (review.isPending) return;
          review.reset();
          setReviewTarget(null);
        }}
        onSubmit={(payload) => {
          if (!reviewTarget) return;
          review.mutate({ complaint: reviewTarget, ...payload });
        }}
      />
    </>
  );
}

function ReviewDialog({
  complaint,
  triage,
  isSubmitting,
  error,
  onClose,
  onSubmit,
}: {
  complaint: Complaint | null;
  triage: SupportTriage | null;
  isSubmitting: boolean;
  error: unknown;
  onClose: () => void;
  onSubmit: (payload: {
    nextStatus: "triaged" | "under_review" | "resolved" | "dismissed";
    resolutionCode: string;
    publicMessage: string;
    internalNote: string;
  }) => void;
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
      title={`Review ${categoryLabel(complaint.category)}`}
      isOpen
      onClose={onClose}
      footer={(
        <>
          <Button variant="ghost" disabled={isSubmitting} onClick={onClose}>Cancel</Button>
          <Button type="submit" form="quality-review-form" isLoading={isSubmitting}>Save review</Button>
        </>
      )}
    >
      <form id="quality-review-form" className="skima-form-grid" onSubmit={submit}>
        <p className="admin-dialog-guidance">Customer report: {complaint.description}</p>
        {triage ? (
          <div className="admin-quality-triage-note">
            <div>
              <StatusBadge tone={triageTone(triage.priorityLevel)}>
                {normalizeStatusLabel(triage.priorityLevel)} priority
              </StatusBadge>
              <span>{Math.round(triage.priorityScore)} / 100 advisory score</span>
              <span>{triage.slaStatus === "overdue" ? "Attention target overdue" : triage.slaStatus === "due_soon" ? "Attention target due soon" : "Attention target on track"}</span>
            </div>
            <p>{triage.recommendedAction}</p>
            <small>Human review is authoritative. Triage does not change complaint, partner, dispatch or financial state.</small>
          </div>
        ) : null}
        <SelectInput
          label="Review status"
          value={nextStatus}
          options={[
            { label: "Triaged", value: "triaged" },
            { label: "Under review", value: "under_review" },
            { label: "Resolved", value: "resolved" },
            { label: "Dismissed", value: "dismissed" },
          ]}
          onChange={(event) => setNextStatus(event.currentTarget.value as typeof nextStatus)}
        />
        <TextInput
          label="Resolution code"
          helperText="Required only when your internal process needs a concise resolution label."
          value={resolutionCode}
          onChange={(event) => setResolutionCode(event.currentTarget.value)}
        />
        <TextAreaInput
          label="Message to customer"
          helperText="Plain-language update the customer can understand. Do not expose internal investigation notes."
          value={publicMessage}
          onChange={(event) => setPublicMessage(event.currentTarget.value)}
        />
        <TextAreaInput
          label="Internal review note"
          value={internalNote}
          onChange={(event) => setInternalNote(event.currentTarget.value)}
        />
        {error ? <StatusBadge tone="danger">{readError(error)}</StatusBadge> : null}
      </form>
    </Dialog>
  );
}

function triageTone(value: SupportTriage["priorityLevel"]): "neutral" | "info" | "warning" | "danger" {
  if (value === "critical") return "danger";
  if (value === "urgent") return "warning";
  if (value === "elevated") return "info";
  return "neutral";
}

function subjectLabel(value: string) {
  const labels: Record<string, string> = {
    driver: "Driver",
    station: "Station",
    order: "Order",
    payment: "Payment",
    cylinder: "Cylinder",
  };
  return labels[value] ?? normalizeStatusLabel(value);
}

function categoryLabel(value: string) {
  const labels: Record<string, string> = {
    underfill: "Possible underfill",
    safety: "Safety concern",
    lost_cylinder: "Lost cylinder",
    switched_cylinder: "Switched cylinder",
    damaged_cylinder: "Damaged cylinder",
    delivery: "Delivery problem",
    payment: "Payment problem",
    conduct: "Conduct complaint",
    fraud: "Suspected fraud",
    pricing: "Pricing problem",
    other: "Other service problem",
  };
  return labels[value] ?? normalizeStatusLabel(value);
}

function shortId(value: string) {
  return `Order ${value.slice(0, 8).toUpperCase()}`;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function readError(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object" && typeof (error as Record<string, unknown>).message === "string") return String((error as Record<string, unknown>).message);
  return "The service quality action could not be completed. Please try again.";
}
