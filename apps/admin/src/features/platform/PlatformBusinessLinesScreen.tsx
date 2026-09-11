import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Blocks, History, Plus, RefreshCcw, Rocket, Settings2 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";

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
  TextInput,
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
  rowLabel,
  slug,
  statusTone,
  text,
} from "./platform-v2-shared";

export function PlatformBusinessLinesScreen() {
  const { api, status } = useSessionState();
  const client = useQueryClient();
  const enabled = status === "authenticated";
  const [moduleDialog, setModuleDialog] = useState(false);
  const [versionDialog, setVersionDialog] = useState(false);
  const [moduleName, setModuleName] = useState("");
  const [moduleDescription, setModuleDescription] = useState("");
  const [moduleStatus, setModuleStatus] = useState("active");
  const [moduleKeyOverride, setModuleKeyOverride] = useState("");
  const [versionModuleKey, setVersionModuleKey] = useState("");
  const [versionNumber, setVersionNumber] = useState("1");
  const [releaseNotes, setReleaseNotes] = useState("");

  const modules = useQuery({
    queryKey: ["platform-v2", "modules"],
    queryFn: () => api.get("/modules", PlatformRowsSchema),
    enabled,
  });
  const versions = useQuery({
    queryKey: ["platform-v2", "module-versions"],
    queryFn: () => api.get("/modules/versions", PlatformRowsSchema),
    enabled,
  });
  const components = useQuery({
    queryKey: ["platform-v2", "module-components"],
    queryFn: () => api.get("/modules/components", PlatformRowsSchema),
    enabled,
    retry: false,
  });

  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ["platform-v2"] });
  };

  const saveModule = useMutation({
    mutationFn: () => {
      const moduleKey = (moduleKeyOverride.trim() || slug(moduleName)).trim();
      if (moduleKey.length < 3) throw new Error("Enter a business-line name long enough to create a stable key.");
      return api.post("/modules", {
        moduleKey,
        displayName: moduleName.trim(),
        description: moduleDescription.trim() || undefined,
        status: moduleStatus,
        metadata: { sourceSurface: "admin_platform_configuration_v2" },
        idempotencyKey: createClientIdempotencyKey("admin.platform.module", moduleKey),
      }, PlatformMutationSchema);
    },
    onSuccess: async () => {
      setModuleDialog(false);
      setModuleName("");
      setModuleDescription("");
      setModuleKeyOverride("");
      await refresh();
    },
  });

  const saveVersion = useMutation({
    mutationFn: () => {
      const version = Number(versionNumber);
      if (!versionModuleKey) throw new Error("Choose a business line.");
      if (!Number.isInteger(version) || version <= 0) throw new Error("Version must be a positive whole number.");
      return api.post("/modules/versions", {
        moduleKey: versionModuleKey,
        version,
        manifest: {
          releaseNotes: releaseNotes.trim() || null,
          sourceSurface: "admin_platform_configuration_v2",
        },
        idempotencyKey: createClientIdempotencyKey("admin.platform.module-version", `${versionModuleKey}:${version}`),
      }, PlatformMutationSchema);
    },
    onSuccess: async () => {
      setVersionDialog(false);
      setReleaseNotes("");
      await refresh();
    },
  });

  const activateVersion = useMutation({
    mutationFn: (input: { moduleKey: string; version: number }) => api.post("/modules/versions/activate", {
      moduleKey: input.moduleKey,
      version: input.version,
      idempotencyKey: createClientIdempotencyKey("admin.platform.module-version.activate", `${input.moduleKey}:${input.version}`),
    }, PlatformMutationSchema),
    onSuccess: refresh,
  });

  const moduleRows = modules.data ?? [];
  const versionRows = versions.data ?? [];
  const componentRows = components.data ?? [];
  const moduleById = useMemo(
    () => new Map(moduleRows.flatMap((row) => {
      const id = text(row, "id");
      return id ? [[id, row] as const] : [];
    })),
    [moduleRows],
  );

  const moduleColumns: TableColumn<PlatformRow>[] = [
    {
      key: "name",
      header: "Business line",
      render: (row) => <><strong>{rowLabel(row, "Business line")}</strong><br /><small>{text(row, "description") || "Reusable SKIMA business capability"}</small></>,
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
      key: "versions",
      header: "Versions",
      render: (row) => {
        const key = text(row, "key");
        const id = text(row, "id");
        return String(versionRows.filter((version) => text(version, "module_key") === key || text(version, "module_id") === id).length);
      },
    },
    {
      key: "components",
      header: "Components",
      render: (row) => {
        const id = text(row, "id");
        return String(componentRows.filter((component) => text(component, "module_id") === id).length);
      },
    },
  ];

  const versionColumns: TableColumn<PlatformRow>[] = [
    {
      key: "module",
      header: "Business line",
      render: (row) => {
        const moduleId = text(row, "module_id");
        const related = moduleById.get(moduleId);
        return related ? rowLabel(related, "Business line") : firstText(row, ["module_display_name", "module_key"]) || "Business line";
      },
    },
    { key: "version", header: "Version", render: (row) => String(row.version ?? "-") },
    {
      key: "status",
      header: "Status",
      render: (row) => {
        const value = text(row, "status") || "draft";
        return <StatusBadge tone={statusTone(value)}>{friendly(value)}</StatusBadge>;
      },
    },
    { key: "activated", header: "Activated", render: (row) => formatDate(firstText(row, ["activated_at", "updated_at"])) },
    {
      key: "action",
      header: "Action",
      render: (row) => {
        const state = text(row, "status");
        const version = Number(row.version);
        const moduleId = text(row, "module_id");
        const moduleKey = firstText(row, ["module_key"]) || text(moduleById.get(moduleId), "key");
        if (state === "active") return "Active";
        if (!moduleKey || !Number.isInteger(version)) return "-";
        return (
          <Button
            size="sm"
            variant="outline"
            requiredPermission="platform.configuration.manage"
            isLoading={activateVersion.isPending}
            onClick={() => activateVersion.mutate({ moduleKey, version })}
          >
            Activate
          </Button>
        );
      },
    },
  ];

  const blockingError = modules.error ?? versions.error;
  if (modules.isLoading || versions.isLoading) return <LoadingState label="Loading business-line configuration" />;
  if (blockingError) return <ErrorState title="Business lines unavailable" message={readError(blockingError)} onRetry={() => void refresh()} />;

  return (
    <div className="platform-v2">
      <AdminV2PageHeader
        eyebrow="Platform configuration · Business lines"
        title="Business lines"
        description="Create reusable SKIMA capabilities and release controlled versions. Low-level component wiring stays in Advanced configuration."
        actions={
          <>
            <Button icon={RefreshCcw} variant="outline" onClick={() => void refresh()}>Refresh</Button>
            <Button icon={Plus} variant="outline" requiredPermission="platform.configuration.manage" onClick={() => setVersionDialog(true)}>New version</Button>
            <Button icon={Plus} requiredPermission="platform.configuration.manage" onClick={() => setModuleDialog(true)}>New business line</Button>
          </>
        }
      />

      <section className="skima-grid skima-grid--compact">
        <MetricTile label="Business lines" value={moduleRows.length} icon={Blocks} tone="info" />
        <MetricTile label="Active lines" value={moduleRows.filter((row) => text(row, "status") === "active").length} icon={Rocket} tone="success" />
        <MetricTile label="Versions" value={versionRows.length} icon={History} />
        <MetricTile label="Technical components" value={componentRows.length} icon={Settings2} />
      </section>

      <section className="sk-panel">
        <div className="sk-panel__header"><div><h2>Configured business lines</h2><p className="skima-muted">The operator-facing record of SKIMA modules. Internal component references are intentionally hidden here.</p></div></div>
        <DataTable caption="Business lines" columns={moduleColumns} records={moduleRows} getRowKey={rowId} emptyTitle="No business lines" emptyMessage="Create the first reusable SKIMA business line." />
      </section>

      <section className="sk-panel">
        <div className="sk-panel__header"><div><h2>Release versions</h2><p className="skima-muted">Only activate a version after its required components have been prepared in the advanced configuration layer.</p></div></div>
        <DataTable caption="Business-line versions" columns={versionColumns} records={versionRows} getRowKey={rowId} emptyTitle="No versions" emptyMessage="Create a version when a business line is ready to be configured for release." />
      </section>

      <Dialog
        isOpen={moduleDialog}
        title="Create business line"
        onClose={() => setModuleDialog(false)}
        footer={<><Button variant="ghost" onClick={() => setModuleDialog(false)}>Cancel</Button><Button form="platform-v2-module" type="submit" isLoading={saveModule.isPending} requiredPermission="platform.configuration.manage">Save business line</Button></>}
      >
        <form id="platform-v2-module" className="skima-form-grid" onSubmit={(event: FormEvent) => { event.preventDefault(); if (!moduleName.trim()) return; saveModule.mutate(); }}>
          <TextInput label="Business-line name" value={moduleName} onChange={(event) => setModuleName(event.currentTarget.value)} placeholder="Marketplace" required />
          <TextAreaInput label="Purpose" value={moduleDescription} onChange={(event) => setModuleDescription(event.currentTarget.value)} placeholder="What this SKIMA business line provides." />
          <SelectInput label="Status" value={moduleStatus} onChange={(event) => setModuleStatus(event.currentTarget.value)} options={[{ label: "Active", value: "active" }, { label: "Draft", value: "draft" }, { label: "Paused", value: "paused" }]} />
          <details className="platform-v2__advanced"><summary>Advanced key override</summary><TextInput label="Internal business-line key" helperText="Leave blank to generate it from the name." value={moduleKeyOverride} onChange={(event) => setModuleKeyOverride(event.currentTarget.value)} /></details>
          {saveModule.error ? <StatusBadge tone="danger">{readError(saveModule.error)}</StatusBadge> : null}
        </form>
      </Dialog>

      <Dialog
        isOpen={versionDialog}
        title="Create business-line version"
        onClose={() => setVersionDialog(false)}
        footer={<><Button variant="ghost" onClick={() => setVersionDialog(false)}>Cancel</Button><Button form="platform-v2-version" type="submit" isLoading={saveVersion.isPending} requiredPermission="platform.configuration.manage">Create version</Button></>}
      >
        <form id="platform-v2-version" className="skima-form-grid" onSubmit={(event: FormEvent) => { event.preventDefault(); saveVersion.mutate(); }}>
          <SelectInput label="Business line" value={versionModuleKey} onChange={(event) => setVersionModuleKey(event.currentTarget.value)} options={[{ label: "Choose business line", value: "" }, ...moduleRows.flatMap((row) => { const key = text(row, "key"); return key ? [{ label: rowLabel(row, key), value: key }] : []; })]} required />
          <TextInput label="Version" type="number" value={versionNumber} onChange={(event) => setVersionNumber(event.currentTarget.value)} required />
          <TextAreaInput label="Release notes" value={releaseNotes} onChange={(event) => setReleaseNotes(event.currentTarget.value)} placeholder="What changes in this version?" />
          {saveVersion.error ? <StatusBadge tone="danger">{readError(saveVersion.error)}</StatusBadge> : null}
        </form>
      </Dialog>
    </div>
  );
}
