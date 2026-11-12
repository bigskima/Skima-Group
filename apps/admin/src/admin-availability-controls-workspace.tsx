import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Globe2, MapPinned, Plus, RefreshCcw, ShieldAlert, Wrench } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { z } from "zod";

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

const AccessRuleSchema = z.object({
  id: z.string().uuid(),
  applicationKey: z.enum(["driver", "station"]),
  scopeType: z.enum(["global", "geography"]),
  geographyId: z.string().uuid().nullable(),
  geographyName: z.string().nullable(),
  countryCode: z.string().nullable(),
  accessEffect: z.enum(["block", "allow"]),
  title: z.string(),
  message: z.string(),
  status: z.enum(["active", "paused", "retired"]),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  updatedAt: z.string(),
});
const MaintenanceSchema = z.object({
  id: z.string().uuid(),
  serviceKey: z.string(),
  scopeType: z.enum(["global", "geography"]),
  geographyId: z.string().uuid().nullable(),
  geographyName: z.string().nullable(),
  countryCode: z.string().nullable(),
  isEnabled: z.boolean(),
  impact: z.enum(["notice", "degraded", "unavailable"]),
  title: z.string(),
  message: z.string(),
  status: z.enum(["active", "paused", "retired"]),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  updatedAt: z.string(),
});
const GeographySchema = z.object({
  id: z.string().uuid(),
  canonical_name: z.string(),
  country_code: z.string(),
  geography_level_name: z.string(),
  parent_name: z.string().nullable(),
  status: z.string(),
});
const ControlsSchema = z.object({
  applicationAccessRules: z.array(AccessRuleSchema),
  maintenanceNotices: z.array(MaintenanceSchema),
  geographies: z.array(GeographySchema),
  canManage: z.boolean(),
});
type AccessRule = z.infer<typeof AccessRuleSchema>;
type MaintenanceNotice = z.infer<typeof MaintenanceSchema>;
type Geography = z.infer<typeof GeographySchema>;
type AccessForm = {
  id: string | null;
  applicationKey: "driver" | "station";
  scopeType: "global" | "geography";
  geographyId: string;
  accessEffect: "block" | "allow";
  title: string;
  message: string;
  status: "active" | "paused";
  startsAt: string;
  endsAt: string;
};
type MaintenanceForm = {
  id: string | null;
  serviceKey: string;
  scopeType: "global" | "geography";
  geographyId: string;
  isEnabled: boolean;
  impact: "notice" | "degraded" | "unavailable";
  title: string;
  message: string;
  status: "active" | "paused";
  startsAt: string;
  endsAt: string;
};
type Editor = { kind: "access"; form: AccessForm } | { kind: "maintenance"; form: MaintenanceForm } | null;

const EMPTY_ACCESS: AccessForm = {
  id: null, applicationKey: "driver", scopeType: "global", geographyId: "",
  accessEffect: "block", title: "Applications temporarily unavailable",
  message: "We are not accepting new applications in this area at the moment. Please check again later.",
  status: "active", startsAt: "", endsAt: "",
};
const EMPTY_MAINTENANCE: MaintenanceForm = {
  id: null, serviceKey: "lpg", scopeType: "global", geographyId: "",
  isEnabled: true, impact: "degraded", title: "Service update",
  message: "Some service features may be temporarily unavailable while we carry out maintenance.",
  status: "active", startsAt: "", endsAt: "",
};
const SERVICE_OPTIONS = [
  { label: "LPG refill", value: "lpg" },
  { label: "Fuel", value: "fuel" },
  { label: "Bills", value: "bills" },
  { label: "Store", value: "store" },
  { label: "Logistics", value: "logistics" },
  { label: "Payments", value: "payments" },
  { label: "Wallets", value: "wallets" },
  { label: "Notifications", value: "notifications" },
  { label: "Customer support", value: "support" },
];

function dateInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
function dateValue(value: string) {
  return value.trim() ? new Date(value).toISOString() : null;
}
function labelScope(scope: string, geographyName: string | null) {
  return scope === "global" ? "Everywhere" : geographyName ?? "Selected geography";
}
function friendlyError(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object") {
    const row = error as Record<string, unknown>;
    for (const key of ["message", "details", "hint", "code"]) {
      const value = row[key];
      if (typeof value === "string" && value.trim()) return value;
    }
  }
  return "The change could not be saved. Refresh and try again.";
}
function accessTitle(key: string) {
  return key === "driver" ? "Driver applications" : "Station applications";
}
function serviceTitle(key: string) {
  return SERVICE_OPTIONS.find((item) => item.value === key)?.label ?? key;
}

export function AdminAvailabilityControlsWorkspace() {
  const { supabase, status } = useSessionState();
  const client = useQueryClient();
  const [editor, setEditor] = useState<Editor>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const enabled = status === "authenticated";
  const controls = useQuery({
    queryKey: ["platform-availability-controls"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_platform_availability_controls");
      if (error) throw error;
      return ControlsSchema.parse(data);
    },
    refetchInterval: 60_000,
  });
  const saveAccess = useMutation({
    mutationFn: async (form: AccessForm) => {
      const { error } = await supabase.rpc("save_platform_application_access_rule", {
        target_rule_id: form.id,
        target_application_key: form.applicationKey,
        target_scope_type: form.scopeType,
        target_geography_id: form.scopeType === "geography" ? form.geographyId : null,
        target_access_effect: form.accessEffect,
        target_title: form.title.trim(),
        target_message: form.message.trim(),
        target_status: form.status,
        target_starts_at: dateValue(form.startsAt),
        target_ends_at: dateValue(form.endsAt),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setEditor(null);
      setNotice("Application access rule saved.");
      await client.invalidateQueries({ queryKey: ["platform-availability-controls"] });
    },
  });
  const saveMaintenance = useMutation({
    mutationFn: async (form: MaintenanceForm) => {
      const { error } = await supabase.rpc("save_platform_service_maintenance_notice", {
        target_notice_id: form.id,
        target_service_key: form.serviceKey,
        target_scope_type: form.scopeType,
        target_geography_id: form.scopeType === "geography" ? form.geographyId : null,
        target_is_enabled: form.isEnabled,
        target_impact: form.impact,
        target_title: form.title.trim(),
        target_message: form.message.trim(),
        target_status: form.status,
        target_starts_at: dateValue(form.startsAt),
        target_ends_at: dateValue(form.endsAt),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setEditor(null);
      setNotice("Service maintenance notice saved.");
      await client.invalidateQueries({ queryKey: ["platform-availability-controls"] });
    },
  });

  const accessRules = controls.data?.applicationAccessRules ?? [];
  const maintenanceNotices = controls.data?.maintenanceNotices ?? [];
  const geographies = useMemo(
    () => (controls.data?.geographies ?? []).filter((item) => item.status === "active"),
    [controls.data?.geographies],
  );
  const geographyOptions = [
    { label: "Choose a geography", value: "" },
    ...geographies.map((geography) => ({
      label: [
        geography.canonical_name,
        geography.geography_level_name,
        geography.parent_name,
      ].filter(Boolean).join(" · "),
      value: geography.id,
    })),
  ];
  const isLoading = controls.isLoading;
  const loadError = controls.error;

  const refresh = async () => {
    setNotice(null);
    await controls.refetch();
  };

  const accessColumns = useMemo<TableColumn<AccessRule>[]>(() => [
    {
      key: "application",
      header: "Application",
      render: (item) => <strong>{accessTitle(item.applicationKey)}</strong>,
    },
    {
      key: "scope",
      header: "Where",
      render: (item) => labelScope(item.scopeType, item.geographyName),
    },
    {
      key: "effect",
      header: "Override",
      render: (item) => <StatusBadge tone={item.accessEffect === "block" ? "danger" : "success"}>{item.accessEffect === "block" ? "Blocked" : "Allowed"}</StatusBadge>,
    },
    {
      key: "status",
      header: "Control",
      render: (item) => <StatusBadge tone={item.status === "active" ? "success" : "neutral"}>{item.status === "active" ? "On" : item.status}</StatusBadge>,
    },
    {
      key: "message",
      header: "Applicant message",
      render: (item) => <span title={item.message}>{item.message.length > 80 ? item.message.slice(0, 77) + "…" : item.message}</span>,
    },
    {
      key: "actions",
      header: "Manage",
      render: (item) => (
        <div className="skima-action-row">
          <Button size="sm" variant="outline" requiredPermission="platform.configuration.manage" onClick={() => setEditor({ kind: "access", form: {
            id: item.id, applicationKey: item.applicationKey, scopeType: item.scopeType,
            geographyId: item.geographyId ?? "", accessEffect: item.accessEffect,
            title: item.title, message: item.message, status: item.status === "retired" ? "paused" : item.status,
            startsAt: dateInput(item.startsAt), endsAt: dateInput(item.endsAt),
          } })}>Edit</Button>
          <Button size="sm" variant="ghost" disabled={item.status === "retired"} requiredPermission="platform.configuration.manage" onClick={() => saveAccess.mutate({
            id: item.id, applicationKey: item.applicationKey, scopeType: item.scopeType,
            geographyId: item.geographyId ?? "", accessEffect: item.accessEffect,
            title: item.title, message: item.message, status: item.status === "active" ? "paused" : "active",
            startsAt: dateInput(item.startsAt), endsAt: dateInput(item.endsAt),
          })}>{item.status === "active" ? "Pause" : "Turn on"}</Button>
        </div>
      ),
    },
  ], [saveAccess]);

  const maintenanceColumns = useMemo<TableColumn<MaintenanceNotice>[]>(() => [
    { key: "service", header: "Service", render: (item) => <strong>{serviceTitle(item.serviceKey)}</strong> },
    { key: "scope", header: "Where", render: (item) => labelScope(item.scopeType, item.geographyName) },
    {
      key: "impact", header: "Customer impact",
      render: (item) => <StatusBadge tone={item.impact === "unavailable" ? "danger" : item.impact === "degraded" ? "warning" : "info"}>{item.impact}</StatusBadge>,
    },
    {
      key: "enabled", header: "Notice",
      render: (item) => <StatusBadge tone={item.status === "active" && item.isEnabled ? "success" : "neutral"}>{item.status === "active" ? (item.isEnabled ? "Visible" : "Suppressed") : "Paused"}</StatusBadge>,
    },
    {
      key: "message", header: "Customer message",
      render: (item) => <span title={item.message}>{item.message.length > 72 ? item.message.slice(0, 69) + "…" : item.message}</span>,
    },
    {
      key: "actions", header: "Manage",
      render: (item) => (
        <div className="skima-action-row">
          <Button size="sm" variant="outline" requiredPermission="platform.configuration.manage" onClick={() => setEditor({ kind: "maintenance", form: {
            id: item.id, serviceKey: item.serviceKey, scopeType: item.scopeType,
            geographyId: item.geographyId ?? "", isEnabled: item.isEnabled,
            impact: item.impact, title: item.title, message: item.message,
            status: item.status === "retired" ? "paused" : item.status,
            startsAt: dateInput(item.startsAt), endsAt: dateInput(item.endsAt),
          } })}>Edit</Button>
          <Button size="sm" variant="ghost" requiredPermission="platform.configuration.manage" disabled={item.status === "retired"} onClick={() => saveMaintenance.mutate({
            id: item.id, serviceKey: item.serviceKey, scopeType: item.scopeType,
            geographyId: item.geographyId ?? "", isEnabled: !item.isEnabled,
            impact: item.impact, title: item.title, message: item.message,
            status: "active", startsAt: dateInput(item.startsAt), endsAt: dateInput(item.endsAt),
          })}>{item.isEnabled ? "Hide notice" : "Show notice"}</Button>
        </div>
      ),
    },
  ], [saveMaintenance]);

  return (
    <>
      <PageHeader
        eyebrow="Platform controls"
        title="Application Access & Maintenance"
        description="Control where new driver and station applications are accepted, and publish clear service notices when one part of SKIMA may be interrupted."
        actions={<Button icon={RefreshCcw} variant="outline" onClick={() => void refresh()}>Refresh</Button>}
      />

      <div className="admin-system-posture">
        <span className="admin-system-posture__icon"><ShieldAlert aria-hidden="true" /></span>
        <div>
          <strong>Geographic overrides are resolved from the most specific area</strong>
          <p>A global rule applies everywhere. A State, LGA, city or town rule can make an exception for that location without changing the rest of the platform.</p>
        </div>
        <StatusBadge tone={controls.data?.canManage ? "success" : "warning"}>{controls.data?.canManage ? "Management enabled" : "Read only"}</StatusBadge>
      </div>

      <section className="skima-grid skima-grid--compact">
        <MetricTile label="Application access rules" value={accessRules.length} icon={Globe2} tone="info" />
        <MetricTile label="Active blocks" value={accessRules.filter((item) => item.status === "active" && item.accessEffect === "block").length} icon={ShieldAlert} tone="warning" />
        <MetricTile label="Maintenance notices" value={maintenanceNotices.filter((item) => item.status === "active" && item.isEnabled).length} icon={BellRing} tone="info" />
        <MetricTile label="Mapped locations" value={geographies.length} icon={MapPinned} tone="neutral" />
      </section>

      {notice ? <div className="admin-notice" role="status">{notice}</div> : null}
      {saveAccess.error ? <div className="admin-notice is-error" role="alert">{friendlyError(saveAccess.error)}</div> : null}
      {saveMaintenance.error ? <div className="admin-notice is-error" role="alert">{friendlyError(saveMaintenance.error)}</div> : null}

      {isLoading ? <LoadingState label="Loading application and maintenance controls" /> : null}
      {loadError ? <ErrorState title="Availability controls unavailable" message={friendlyError(loadError)} onRetry={() => void refresh()} /> : null}

      {!isLoading && !loadError ? (
        <>
          <section className="sk-panel">
            <div className="sk-panel__header">
              <div>
                <h2>Driver & station application access</h2>
                <p className="skima-muted">Block new applications globally or by geography. Create an Allow exception inside a blocked region, or a Block exception inside an otherwise open region.</p>
              </div>
              <Button icon={Plus} requiredPermission="platform.configuration.manage" onClick={() => setEditor({ kind: "access", form: { ...EMPTY_ACCESS } })}>Add access rule</Button>
            </div>
            <div className="admin-workspace-intro__grid">
              {(["driver", "station"] as const).map((key) => {
                const globalRule = accessRules.find((item) => item.applicationKey === key && item.scopeType === "global" && item.status !== "retired");
                return (
                  <article className="sk-panel" key={key}>
                    <div className="sk-panel__header">
                      <div><h3>{accessTitle(key)}</h3><p className="skima-muted">Global control</p></div>
                      <StatusBadge tone={globalRule?.status === "active" ? (globalRule.accessEffect === "block" ? "danger" : "success") : "neutral"}>
                        {globalRule?.status === "active" ? (globalRule.accessEffect === "block" ? "Blocked globally" : "Allowed globally") : "No global override"}
                      </StatusBadge>
                    </div>
                    <p className="skima-muted">{globalRule?.message ?? "The standard application availability rules apply everywhere."}</p>
                    <Button size="sm" variant="outline" requiredPermission="platform.configuration.manage" onClick={() => setEditor({ kind: "access", form: globalRule ? {
                      id: globalRule.id, applicationKey: key, scopeType: "global", geographyId: "",
                      accessEffect: globalRule.accessEffect, title: globalRule.title, message: globalRule.message,
                      status: globalRule.status === "retired" ? "paused" : globalRule.status,
                      startsAt: dateInput(globalRule.startsAt), endsAt: dateInput(globalRule.endsAt),
                    } : { ...EMPTY_ACCESS, applicationKey: key } })}>
                      {globalRule ? "Configure global control" : "Set global control"}
                    </Button>
                  </article>
                );
              })}
            </div>
            <DataTable caption="Driver and station application access rules" columns={accessColumns} records={accessRules} getRowKey={(item) => item.id} emptyTitle="No application overrides" emptyMessage="Applications follow normal availability until you create a global or geographic override." />
          </section>

          <section className="sk-panel">
            <div className="sk-panel__header">
              <div>
                <h2>Service maintenance notices</h2>
                <p className="skima-muted">Choose the service affected, the customer-visible message, and whether it applies everywhere or only within selected geography. These notices do not disable unrelated app sections.</p>
              </div>
              <Button icon={Plus} requiredPermission="platform.configuration.manage" onClick={() => setEditor({ kind: "maintenance", form: { ...EMPTY_MAINTENANCE } })}>Add service notice</Button>
            </div>
            <DataTable caption="Customer service maintenance notices" columns={maintenanceColumns} records={maintenanceNotices} getRowKey={(item) => item.id} emptyTitle="No maintenance notices" emptyMessage="There are no active service notices. Create one when a specific service may be interrupted." />
          </section>
        </>
      ) : null}

      {editor?.kind === "access" ? (
        <Dialog isOpen title={editor.form.id ? "Edit application access rule" : "Create application access rule"} onClose={() => setEditor(null)} footer={<><Button variant="ghost" onClick={() => setEditor(null)}>Cancel</Button><Button type="submit" form="application-access-rule-form" isLoading={saveAccess.isPending} requiredPermission="platform.configuration.manage">Save access rule</Button></>}>
          <form id="application-access-rule-form" className="skima-form-grid" onSubmit={(event: FormEvent) => { event.preventDefault(); saveAccess.mutate(editor.form); }}>
            <p className="skima-muted">Only new application entry is affected. Existing submitted applications and status/review access remain available.</p>
            <SelectInput label="Application" value={editor.form.applicationKey} options={[{ label: "Driver application", value: "driver" }, { label: "Station application", value: "station" }]} onChange={(event) => setEditor({ ...editor, form: { ...editor.form, applicationKey: event.currentTarget.value as "driver" | "station" } })} />
            <SelectInput label="Where should this rule apply?" value={editor.form.scopeType} options={[{ label: "Everywhere (global)", value: "global" }, { label: "One geography", value: "geography" }]} onChange={(event) => setEditor({ ...editor, form: { ...editor.form, scopeType: event.currentTarget.value as "global" | "geography", geographyId: "" } })} />
            {editor.form.scopeType === "geography" ? <SelectInput label="Select country, state, LGA, city or town" value={editor.form.geographyId} options={geographyOptions} onChange={(event) => setEditor({ ...editor, form: { ...editor.form, geographyId: event.currentTarget.value } })} required /> : null}
            <SelectInput label="Access decision" value={editor.form.accessEffect} options={[{ label: "Block applications here", value: "block" }, { label: "Allow applications here (exception)", value: "allow" }]} onChange={(event) => setEditor({ ...editor, form: { ...editor.form, accessEffect: event.currentTarget.value as "block" | "allow" } })} />
            <SelectInput label="Control status" value={editor.form.status} options={[{ label: "On", value: "active" }, { label: "Paused", value: "paused" }]} onChange={(event) => setEditor({ ...editor, form: { ...editor.form, status: event.currentTarget.value as "active" | "paused" } })} />
            <TextInput label="Heading shown to applicant" value={editor.form.title} onChange={(event) => setEditor({ ...editor, form: { ...editor.form, title: event.currentTarget.value } })} required />
            <TextAreaInput label="Message shown to applicant" value={editor.form.message} onChange={(event) => setEditor({ ...editor, form: { ...editor.form, message: event.currentTarget.value } })} required />
            <TextInput label="Starts at (optional)" type="datetime-local" value={editor.form.startsAt} onChange={(event) => setEditor({ ...editor, form: { ...editor.form, startsAt: event.currentTarget.value } })} />
            <TextInput label="Ends at (optional)" type="datetime-local" value={editor.form.endsAt} onChange={(event) => setEditor({ ...editor, form: { ...editor.form, endsAt: event.currentTarget.value } })} />
          </form>
          {saveAccess.error ? <StatusBadge tone="danger">{friendlyError(saveAccess.error)}</StatusBadge> : null}
        </Dialog>
      ) : null}

      {editor?.kind === "maintenance" ? (
        <Dialog isOpen title={editor.form.id ? "Edit service maintenance notice" : "Create service maintenance notice"} onClose={() => setEditor(null)} footer={<><Button variant="ghost" onClick={() => setEditor(null)}>Cancel</Button><Button type="submit" form="service-maintenance-form" isLoading={saveMaintenance.isPending} requiredPermission="platform.configuration.manage">Save notice</Button></>}>
          <form id="service-maintenance-form" className="skima-form-grid" onSubmit={(event: FormEvent) => { event.preventDefault(); saveMaintenance.mutate(editor.form); }}>
            <SelectInput label="Affected service" value={editor.form.serviceKey} options={SERVICE_OPTIONS} onChange={(event) => setEditor({ ...editor, form: { ...editor.form, serviceKey: event.currentTarget.value } })} />
            <SelectInput label="Where should customers see it?" value={editor.form.scopeType} options={[{ label: "Everywhere (global)", value: "global" }, { label: "One geography", value: "geography" }]} onChange={(event) => setEditor({ ...editor, form: { ...editor.form, scopeType: event.currentTarget.value as "global" | "geography", geographyId: "" } })} />
            {editor.form.scopeType === "geography" ? <SelectInput label="Select geography" value={editor.form.geographyId} options={geographyOptions} onChange={(event) => setEditor({ ...editor, form: { ...editor.form, geographyId: event.currentTarget.value } })} required /> : null}
            <SelectInput label="Customer impact" value={editor.form.impact} options={[{ label: "Service update (informational)", value: "notice" }, { label: "Service may be interrupted", value: "degraded" }, { label: "Service temporarily unavailable", value: "unavailable" }]} onChange={(event) => setEditor({ ...editor, form: { ...editor.form, impact: event.currentTarget.value as MaintenanceForm["impact"] } })} />
            <SelectInput label="Notice visibility" value={editor.form.isEnabled ? "visible" : "hidden"} options={[{ label: "Show notice", value: "visible" }, { label: "Hide notice / suppress broader notice in this area", value: "hidden" }]} onChange={(event) => setEditor({ ...editor, form: { ...editor.form, isEnabled: event.currentTarget.value === "visible" } })} />
            <SelectInput label="Notice status" value={editor.form.status} options={[{ label: "Active", value: "active" }, { label: "Paused", value: "paused" }]} onChange={(event) => setEditor({ ...editor, form: { ...editor.form, status: event.currentTarget.value as "active" | "paused" } })} />
            <TextInput label="Heading shown to customer" value={editor.form.title} onChange={(event) => setEditor({ ...editor, form: { ...editor.form, title: event.currentTarget.value } })} required />
            <TextAreaInput label="Customer message" value={editor.form.message} onChange={(event) => setEditor({ ...editor, form: { ...editor.form, message: event.currentTarget.value } })} required />
            <TextInput label="Starts at (optional)" type="datetime-local" value={editor.form.startsAt} onChange={(event) => setEditor({ ...editor, form: { ...editor.form, startsAt: event.currentTarget.value } })} />
            <TextInput label="Ends at (optional)" type="datetime-local" value={editor.form.endsAt} onChange={(event) => setEditor({ ...editor, form: { ...editor.form, endsAt: event.currentTarget.value } })} />
          </form>
          {saveMaintenance.error ? <StatusBadge tone="danger">{friendlyError(saveMaintenance.error)}</StatusBadge> : null}
        </Dialog>
      ) : null}
    </>
  );
}
