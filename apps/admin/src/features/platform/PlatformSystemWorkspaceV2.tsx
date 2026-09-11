import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  CircleAlert,
  FileClock,
  HeartPulse,
  History,
  RefreshCcw,
  RotateCcw,
  ScanLine,
  ServerCog,
  Settings2,
} from "lucide-react";
import { useMemo } from "react";

import { createClientIdempotencyKey, normalizeStatusLabel } from "@skima/frontend-core";
import {
  Button,
  DataTable,
  ErrorState,
  LoadingState,
  MetricTile,
  StatusBadge,
  type TableColumn,
} from "@skima/ui";

import { AdminCylinderIdentityWorkspace } from "../../admin-cylinder-identity-workspace";
import { AdminSystemWorkspace } from "../../admin-system-workspace";
import { useSessionState } from "../../session";
import { AdminV2PageHeader } from "../../shared/patterns/AdminV2Patterns";
import { WorkspaceLanding } from "../../shared/patterns/WorkspaceLanding";
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
import "./platform-v2.css";

const SYSTEM_BASE = "/platform/system";

type SystemAreaKey = "health" | "jobs" | "incidents" | "activity" | "audit";

interface SystemAreaDefinition {
  readonly key: SystemAreaKey;
  readonly title: string;
  readonly eyebrow: string;
  readonly description: string;
  readonly path: string;
  readonly preferredKeys: readonly string[];
  readonly icon: typeof HeartPulse;
}

const areas: Readonly<Record<SystemAreaKey, SystemAreaDefinition>> = {
  health: {
    key: "health",
    title: "Service health",
    eyebrow: "System health · Services",
    description: "Review whether core SKIMA runtime services are healthy or degraded without mixing logs and background jobs into the same table.",
    path: "/admin/system/health",
    preferredKeys: ["key", "status", "checked_at", "updated_at"],
    icon: HeartPulse,
  },
  jobs: {
    key: "jobs",
    title: "Background work",
    eyebrow: "System health · Background work",
    description: "Review scheduled and asynchronous jobs. Retry failed work or cancel work that is still eligible for cancellation.",
    path: "/admin/system/jobs",
    preferredKeys: ["job_type_key", "status", "attempts", "run_at", "last_error"],
    icon: FileClock,
  },
  incidents: {
    key: "incidents",
    title: "Incidents",
    eyebrow: "System health · Incidents",
    description: "See current runtime errors and operational incidents separately from routine service activity.",
    path: "/admin/system/errors",
    preferredKeys: ["severity", "source", "message", "status", "last_seen_at"],
    icon: CircleAlert,
  },
  activity: {
    key: "activity",
    title: "Service activity",
    eyebrow: "System health · Activity",
    description: "Inspect recent service activity and log messages for support and runtime troubleshooting.",
    path: "/admin/system/logs",
    preferredKeys: ["severity", "source", "message", "created_at"],
    icon: ServerCog,
  },
  audit: {
    key: "audit",
    title: "Change history",
    eyebrow: "System health · Change history",
    description: "Review audited platform changes, who performed them and when they occurred.",
    path: "/admin/system/audit",
    preferredKeys: ["action", "entity_type", "actor_display_name", "created_at"],
    icon: History,
  },
};

export function PlatformSystemWorkspaceV2(props: {
  readonly route: string;
  readonly onNavigate: (href: string) => void;
}) {
  if (props.route === SYSTEM_BASE) return <SystemOverview onNavigate={props.onNavigate} />;
  if (props.route === `${SYSTEM_BASE}/health`) return <SystemAreaScreen definition={areas.health} />;
  if (props.route === `${SYSTEM_BASE}/jobs`) return <SystemAreaScreen definition={areas.jobs} />;
  if (props.route === `${SYSTEM_BASE}/incidents`) return <SystemAreaScreen definition={areas.incidents} />;
  if (props.route === `${SYSTEM_BASE}/activity`) return <SystemAreaScreen definition={areas.activity} />;
  if (props.route === `${SYSTEM_BASE}/audit`) return <SystemAreaScreen definition={areas.audit} />;
  if (props.route === `${SYSTEM_BASE}/cylinder-identity`) return <AdminCylinderIdentityWorkspace />;
  if (props.route === `${SYSTEM_BASE}/advanced`) return <AdminSystemWorkspace />;

  return (
    <WorkspaceLanding
      eyebrow="System health"
      title="System page not found"
      description="This system route is not part of the current Admin V2 workspace."
      onNavigate={props.onNavigate}
      actions={[{
        key: "system-home",
        title: "Back to system health",
        description: "Return to the supported system health and audit tasks.",
        href: SYSTEM_BASE,
        icon: ServerCog,
        meta: "Health & diagnostics",
        permissionKey: "system",
      }]}
    />
  );
}

function SystemOverview(props: { readonly onNavigate: (href: string) => void }) {
  return (
    <WorkspaceLanding
      eyebrow="Platform system"
      title="System health & history"
      description="Choose one operational job at a time instead of loading health, jobs, incidents, logs, audit history and LPG identity controls into one command-center page."
      onNavigate={props.onNavigate}
      actions={[
        { key: "health", title: "Service health", description: "See core runtime health checks and degraded services.", href: `${SYSTEM_BASE}/health`, icon: HeartPulse, meta: "Runtime posture", requiredPermissions: ["platform.health.read"] },
        { key: "jobs", title: "Background work", description: "Review queued, running and failed jobs and retry eligible failures.", href: `${SYSTEM_BASE}/jobs`, icon: FileClock, meta: "Async work", requiredPermissions: ["platform.health.read"] },
        { key: "incidents", title: "Incidents", description: "Investigate open errors and runtime incidents that require attention.", href: `${SYSTEM_BASE}/incidents`, icon: CircleAlert, meta: "Attention required", requiredPermissions: ["platform.health.read"] },
        { key: "activity", title: "Service activity", description: "Inspect recent service logs without mixing them into incident triage.", href: `${SYSTEM_BASE}/activity`, icon: ServerCog, meta: "Operational logs", requiredPermissions: ["platform.health.read"] },
        { key: "audit", title: "Change history", description: "Review audited platform changes and responsible administrators.", href: `${SYSTEM_BASE}/audit`, icon: History, meta: "Audit trail", requiredPermissions: ["platform.health.read"] },
        { key: "cylinder", title: "Cylinder identity", description: "Open LPG cylinder identity controls as a separate bounded operational tool.", href: `${SYSTEM_BASE}/cylinder-identity`, icon: ScanLine, meta: "LPG identity", anyOfPermissions: ["lpg.cylinders.manage", "lpg.operations.manage"] },
        { key: "advanced", title: "Advanced system console", description: "Keep the previous combined command center available for specialist troubleshooting during V2 cutover.", href: `${SYSTEM_BASE}/advanced`, icon: Settings2, meta: "Specialist tools", requiredPermissions: ["platform.health.read"] },
      ]}
    />
  );
}

function SystemAreaScreen(props: { readonly definition: SystemAreaDefinition }) {
  const { api, status } = useSessionState();
  const client = useQueryClient();
  const definition = props.definition;
  const query = useQuery({
    queryKey: ["platform-system-v2", definition.key],
    queryFn: () => api.get(definition.path, PlatformRowsSchema),
    enabled: status === "authenticated",
  });

  const jobAction = useMutation({
    mutationFn: (input: { readonly jobId: string; readonly action: "retry" | "cancel" }) => api.post("/admin/system/jobs/action", {
      ...input,
      reason: input.action === "retry" ? "Manual retry from the Admin V2 background work screen." : "Manual cancellation from the Admin V2 background work screen.",
      idempotencyKey: createClientIdempotencyKey(`admin.job.${input.action}`, input.jobId),
    }, PlatformMutationSchema),
    onSuccess: async () => client.invalidateQueries({ queryKey: ["platform-system-v2", "jobs"] }),
  });

  const rows = query.data ?? [];
  const attentionCount = rows.filter((row) => {
    const value = firstText(row, ["status", "severity"]).toLowerCase();
    return ["failed", "open", "critical", "error", "unhealthy", "degraded", "warning"].includes(value);
  }).length;
  const healthyCount = rows.filter((row) => {
    const value = firstText(row, ["status", "severity"]).toLowerCase();
    return ["healthy", "ok", "active", "completed", "resolved", "success"].includes(value);
  }).length;

  const columns = useMemo(
    () => buildColumns(definition, rows, (input) => jobAction.mutate(input)),
    [definition, rows, jobAction.mutate],
  );

  if (query.isLoading) return <LoadingState label={`Loading ${definition.title.toLowerCase()}`} />;
  if (query.error) return <ErrorState title={`${definition.title} unavailable`} message={readError(query.error)} onRetry={() => void query.refetch()} />;

  const Icon = definition.icon;
  return (
    <div className="platform-v2">
      <AdminV2PageHeader
        eyebrow={definition.eyebrow}
        title={definition.title}
        description={definition.description}
        actions={<Button icon={RefreshCcw} variant="outline" onClick={() => void query.refetch()}>Refresh</Button>}
      />

      <section className="skima-grid skima-grid--compact">
        <MetricTile label="Records" value={rows.length} icon={Icon} tone="info" />
        <MetricTile label="Healthy / resolved" value={healthyCount} icon={HeartPulse} tone="success" />
        <MetricTile label="Needs attention" value={attentionCount} icon={CircleAlert} tone={attentionCount ? "warning" : "success"} />
      </section>

      {jobAction.error ? <div className="admin-notice is-error" role="alert">{readError(jobAction.error)}</div> : null}
      {jobAction.isSuccess ? <div className="admin-notice" role="status">Background work control was accepted.</div> : null}

      <section className="sk-panel">
        <div className="sk-panel__header"><div><h2>{definition.title}</h2><p className="skima-muted">Only the fields useful for this task are shown. Technical record identifiers remain hidden unless an advanced support workflow requires them.</p></div><StatusBadge>{rows.length} records</StatusBadge></div>
        <DataTable caption={definition.title} columns={columns} records={rows} getRowKey={rowId} emptyTitle={`No ${definition.title.toLowerCase()}`} emptyMessage="There are no records in this system area right now." />
      </section>
    </div>
  );
}

function buildColumns(
  definition: SystemAreaDefinition,
  rows: readonly PlatformRow[],
  runJobAction: (input: { readonly jobId: string; readonly action: "retry" | "cancel" }) => void,
): TableColumn<PlatformRow>[] {
  const columns: TableColumn<PlatformRow>[] = definition.preferredKeys.map((key) => ({
    key,
    header: columnLabel(key),
    render: (row) => renderValue(key, row[key], row),
  }));

  if (definition.key === "jobs") {
    columns.push({
      key: "actions",
      header: "Control",
      render: (row) => {
        const id = text(row, "id");
        const state = text(row, "status");
        if (!id || ["completed", "cancelled"].includes(state)) return "-";
        return (
          <div className="admin-inline-actions">
            {state === "failed" ? <Button size="sm" icon={RotateCcw} variant="outline" requiredPermission="platform.jobs.manage" onClick={() => runJobAction({ jobId: id, action: "retry" })}>Retry</Button> : null}
            <Button size="sm" icon={Ban} variant="ghost" requiredPermission="platform.jobs.manage" onClick={() => runJobAction({ jobId: id, action: "cancel" })}>Cancel</Button>
          </div>
        );
      },
    });
  }

  return columns;
}

function renderValue(key: string, value: unknown, row: PlatformRow) {
  if (value === null || value === undefined || value === "") {
    if (key === "actor_display_name") return firstText(row, ["actor_name", "changed_by", "actor_email"]) || "Platform administrator";
    return "-";
  }
  if (typeof value === "string") {
    if (key.includes("status") || key === "severity") return <StatusBadge tone={statusTone(value)}>{friendly(value)}</StatusBadge>;
    if (key.endsWith("_at")) return formatDate(value);
    if (key === "job_type_key" || key === "entity_type" || key === "action") return normalizeStatusLabel(value);
    return value.length > 110 ? `${value.slice(0, 107)}...` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `${value.length} items`;
  return "Configured";
}

function columnLabel(key: string) {
  const labels: Record<string, string> = {
    key: "Service",
    status: "Status",
    checked_at: "Checked",
    updated_at: "Updated",
    job_type_key: "Background task",
    attempts: "Attempts",
    run_at: "Run time",
    last_error: "Last error",
    severity: "Severity",
    source: "Source",
    message: "Message",
    last_seen_at: "Last seen",
    created_at: "Created",
    action: "Change",
    entity_type: "Area",
    actor_display_name: "Changed by",
  };
  return labels[key] ?? friendly(key);
}
