import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  CircleAlert,
  FileClock,
  HeartPulse,
  RefreshCcw,
  RotateCcw,
  ServerCog,
} from "lucide-react";
import { useMemo, useState } from "react";
import { z } from "zod";

import { createClientIdempotencyKey, normalizeStatusLabel } from "@skima/frontend-core";
import {
  Button,
  DataTable,
  ErrorState,
  LoadingState,
  MetricTile,
  PageHeader,
  StatusBadge,
  type TableColumn,
} from "@skima/ui";

import { useSessionState } from "./session";

const RecordSchema = z.record(z.unknown());
const RecordsSchema = z.array(RecordSchema);
const MutationSchema = z.union([z.string(), z.record(z.unknown()), z.null()]);
type PlatformRecord = Readonly<Record<string, unknown>>;
type SystemArea = "health" | "jobs" | "errors" | "logs" | "audit";

const systemAreas: readonly { readonly key: SystemArea; readonly label: string }[] = [
  { key: "health", label: "Health" },
  { key: "jobs", label: "Background jobs" },
  { key: "errors", label: "Incidents" },
  { key: "logs", label: "Service logs" },
  { key: "audit", label: "Audit trail" },
];

export function AdminSystemWorkspace() {
  const { api, status } = useSessionState();
  const queryClient = useQueryClient();
  const [activeArea, setActiveArea] = useState<SystemArea>("health");
  const [notice, setNotice] = useState<string | null>(null);

  const health = useSystemRecords("health", "/admin/system/health");
  const jobs = useSystemRecords("jobs", "/admin/system/jobs");
  const errors = useSystemRecords("errors", "/admin/system/errors");
  const logs = useSystemRecords("logs", "/admin/system/logs");
  const audit = useSystemRecords("audit", "/admin/system/audit");
  const queries = { health, jobs, errors, logs, audit } as const;
  const activeQuery = queries[activeArea];

  const jobAction = useMutation({
    mutationFn: (input: { readonly jobId: string; readonly action: "retry" | "cancel" }) =>
      api.post(
        "/admin/system/jobs/action",
        {
          ...input,
          reason: input.action === "retry" ? "Manual retry from the admin command center." :
            "Manual cancellation from the admin command center.",
          idempotencyKey: createClientIdempotencyKey(`admin.job.${input.action}`, input.jobId),
        },
        MutationSchema,
      ),
    onSuccess: async (_data, variables) => {
      setNotice(variables.action === "retry" ? "Job returned to the queue." : "Job cancelled.");
      await queryClient.invalidateQueries({ queryKey: ["admin-system"] });
    },
  });

  const unhealthy = (health.data ?? []).filter((record) => {
    const state = recordString(record, "status");
    return state && !["healthy", "ok", "active"].includes(state);
  }).length;
  const failedJobs = (jobs.data ?? []).filter((record) => recordString(record, "status") === "failed").length;
  const openErrors = (errors.data ?? []).filter((record) =>
    ["open", "acknowledged"].includes(recordString(record, "status") ?? "")
  ).length;

  const columns = useMemo(
    () => buildSystemColumns(activeArea, activeQuery.data ?? [], jobAction.mutate),
    [activeArea, activeQuery.data, jobAction.mutate],
  );

  const refreshAll = () => {
    setNotice(null);
    void queryClient.invalidateQueries({ queryKey: ["admin-system"] });
  };

  return (
    <>
      <PageHeader
        eyebrow="Platform control"
        title="Systems & audit"
        description="Monitor platform health, govern background work, investigate incidents, and review every sensitive change."
        actions={<Button icon={RefreshCcw} variant="outline" onClick={refreshAll}>Refresh all</Button>}
      />

      <div className={`admin-system-posture${unhealthy + openErrors > 0 ? " is-warning" : ""}`}>
        <span className="admin-system-posture__icon">
          {unhealthy + openErrors > 0 ? <CircleAlert aria-hidden="true" /> : <HeartPulse aria-hidden="true" />}
        </span>
        <div>
          <strong>{unhealthy + openErrors > 0 ? "Attention required" : "Platform controls are reporting normally"}</strong>
          <p>
            {unhealthy + openErrors > 0
              ? `${unhealthy} health checks and ${openErrors} incidents need review.`
              : "Health, queue, and incident signals are available from this command center."}
          </p>
        </div>
        <StatusBadge tone={unhealthy + openErrors > 0 ? "warning" : "success"}>
          {unhealthy + openErrors > 0 ? "Review" : "Operational"}
        </StatusBadge>
      </div>

      <section className="skima-grid skima-grid--compact">
        <MetricTile label="Health checks" value={(health.data ?? []).length} icon={HeartPulse} tone="success" />
        <MetricTile label="Failed jobs" value={failedJobs} icon={FileClock} tone={failedJobs ? "warning" : "neutral"} />
        <MetricTile label="Open incidents" value={openErrors} icon={CircleAlert} tone={openErrors ? "warning" : "neutral"} />
        <MetricTile label="Audit events" value={(audit.data ?? []).length} icon={ServerCog} tone="info" />
      </section>

      {notice ? <div className="admin-notice" role="status">{notice}</div> : null}
      {jobAction.error ? <div className="admin-notice is-error" role="alert">{readError(jobAction.error)}</div> : null}

      <section className="sk-panel admin-system-console">
        <div className="skima-resource-tabs" role="tablist" aria-label="System areas">
          {systemAreas.map((area) => (
            <button
              key={area.key}
              type="button"
              role="tab"
              aria-selected={activeArea === area.key}
              className={activeArea === area.key ? "is-active" : undefined}
              onClick={() => setActiveArea(area.key)}
            >
              {area.label}
            </button>
          ))}
        </div>
        <div className="sk-panel__header">
          <div>
            <p className="admin-section-kicker">Live platform record</p>
            <h2>{systemAreas.find((area) => area.key === activeArea)?.label}</h2>
          </div>
          <StatusBadge>{String((activeQuery.data ?? []).length)}</StatusBadge>
        </div>
        {activeQuery.isLoading
          ? <LoadingState label={`Loading ${activeArea}`} />
          : activeQuery.error
          ? (
            <ErrorState
              title={`${normalizeStatusLabel(activeArea)} unavailable`}
              message={readError(activeQuery.error)}
              onRetry={() => void activeQuery.refetch()}
            />
          )
          : (
            <DataTable
              caption={systemAreas.find((area) => area.key === activeArea)?.label ?? activeArea}
              columns={columns}
              records={activeQuery.data ?? []}
              getRowKey={(record) => recordString(record, "id") ?? JSON.stringify(record)}
              emptyTitle={`No ${normalizeStatusLabel(activeArea).toLowerCase()}`}
              emptyMessage="There are no records in this control area."
            />
          )}
      </section>
    </>
  );

  function useSystemRecords(key: SystemArea, path: string) {
    return useQuery({
      queryKey: ["admin-system", key],
      queryFn: () => api.get(path, RecordsSchema),
      enabled: status === "authenticated",
    });
  }
}

function buildSystemColumns(
  area: SystemArea,
  records: readonly PlatformRecord[],
  runJobAction: (input: { readonly jobId: string; readonly action: "retry" | "cancel" }) => void,
): TableColumn<PlatformRecord>[] {
  const preferred: Readonly<Record<SystemArea, readonly string[]>> = {
    health: ["key", "status", "checked_at", "updated_at"],
    jobs: ["job_type_key", "status", "attempts", "run_at", "last_error"],
    errors: ["severity", "source", "message", "status", "last_seen_at"],
    logs: ["severity", "source", "message", "created_at"],
    audit: ["action", "entity_type", "actor_user_id", "created_at"],
  };
  const keys = new Set(preferred[area]);
  for (const record of records.slice(0, 4)) {
    for (const key of Object.keys(record).slice(0, 6)) keys.add(key);
  }
  const columns: TableColumn<PlatformRecord>[] = Array.from(keys).slice(0, 6).map((key) => ({
    key,
    header: normalizeStatusLabel(key),
    render: (record) => renderValue(key, record[key]),
  }));
  if (area === "jobs") {
    columns.push({
      key: "actions",
      header: "Control",
      render: (record) => {
        const id = recordString(record, "id");
        const state = recordString(record, "status");
        if (!id || state === "completed" || state === "cancelled") return "-";
        return (
          <div className="admin-inline-actions">
            {state === "failed"
              ? (
                <Button
                  size="sm"
                  icon={RotateCcw}
                  variant="outline"
                  requiredPermission="platform.jobs.manage"
                  onClick={() => runJobAction({ jobId: id, action: "retry" })}
                >
                  Retry
                </Button>
              )
              : null}
            <Button
              size="sm"
              icon={Ban}
              variant="ghost"
              requiredPermission="platform.jobs.manage"
              onClick={() => runJobAction({ jobId: id, action: "cancel" })}
            >
              Cancel
            </Button>
          </div>
        );
      },
    });
  }
  return columns;
}

function renderValue(key: string, value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "string") {
    if (key.includes("status") || key === "severity") {
      return <StatusBadge tone={valueTone(value)}>{normalizeStatusLabel(value)}</StatusBadge>;
    }
    if (key.endsWith("_at")) return formatDate(value);
    return value.length > 90 ? `${value.slice(0, 87)}...` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function valueTone(value: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (["healthy", "active", "completed", "resolved", "info", "notice"].includes(value)) return "success";
  if (["degraded", "queued", "running", "acknowledged", "warning"].includes(value)) return "warning";
  if (["unhealthy", "failed", "open", "error", "critical"].includes(value)) return "danger";
  return "neutral";
}

function recordString(record: PlatformRecord | null | undefined, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : "The request could not be completed.";
}
