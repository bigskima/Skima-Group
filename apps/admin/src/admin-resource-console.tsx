import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { z } from "zod";

import {
  createClientIdempotencyKey,
  formatMoney,
  normalizeStatusLabel,
} from "@skima/frontend-core";
import {
  Button,
  CheckboxField,
  DataTable,
  Dialog,
  ErrorState,
  LoadingState,
  MoneyDisplay,
  PageHeader,
  SelectInput,
  StatusBadge,
  type TableColumn,
  TextAreaInput,
  TextInput,
} from "@skima/ui";
import { RefreshCcw } from "lucide-react";

import { useSessionState } from "./session";

const RecordSchema = z.record(z.unknown());
const RecordArraySchema = z.array(RecordSchema);
const MutationResponseSchema = z.unknown();

export type AdminFieldType =
  | "boolean"
  | "datetime"
  | "json"
  | "number"
  | "select"
  | "stringArray"
  | "text";

export interface AdminActionField {
  readonly key: string;
  readonly label: string;
  readonly type?: AdminFieldType;
  readonly required?: boolean;
  readonly helperText?: string;
  readonly placeholder?: string;
  readonly defaultValue?: unknown;
  readonly options?: readonly { readonly label: string; readonly value: string }[];
  readonly includeInPayload?: boolean;
}

export interface AdminActionDefinition {
  readonly key: string;
  readonly label: string;
  readonly path: string;
  readonly requiredPermission?: string;
  readonly idempotencyScope?: string;
  readonly tone?: "neutral" | "danger" | "primary";
  readonly submitLabel?: string;
  readonly fields: readonly AdminActionField[];
}

export interface AdminResourceDefinition {
  readonly key: string;
  readonly title: string;
  readonly path: string;
  readonly description?: string;
  readonly preferredKeys: readonly string[];
}

export interface AdminResourceGroup {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly resources: readonly AdminResourceDefinition[];
  readonly actions: readonly AdminActionDefinition[];
}

export interface AdminResourceConsoleConfig {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly groups: readonly AdminResourceGroup[];
}

type PlatformRecord = Readonly<Record<string, unknown>>;

export function AdminResourceConsole(props: { readonly config: AdminResourceConsoleConfig }) {
  const [activeGroupKey, setActiveGroupKey] = useState(props.config.groups[0]?.key ?? "");
  const [activeAction, setActiveAction] = useState<AdminActionDefinition | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const activeGroup = props.config.groups.find((group) => group.key === activeGroupKey) ??
    props.config.groups[0];

  const refreshAll = () => {
    setNotice(null);
    void queryClient.invalidateQueries({ queryKey: ["admin-resource"] });
  };

  if (!activeGroup) {
    return (
      <ErrorState
        title={`${props.config.title} unavailable`}
        message="No management areas have been configured for this workspace yet."
      />
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={props.config.eyebrow}
        title={props.config.title}
        description={props.config.description}
        actions={
          <Button icon={RefreshCcw} variant="outline" onClick={refreshAll}>
            Refresh data
          </Button>
        }
      />

      <div
        className="skima-resource-tabs admin-resource-tabs"
        role="tablist"
        aria-label={`${props.config.title} sections`}
      >
        {props.config.groups.map((group) => (
          <button
            key={group.key}
            type="button"
            role="tab"
            aria-selected={group.key === activeGroup.key}
            className={group.key === activeGroup.key ? "is-active" : undefined}
            onClick={() => {
              setNotice(null);
              setActiveGroupKey(group.key);
            }}
          >
            {group.label}
          </button>
        ))}
      </div>

      {notice ? <StatusBadge tone="success" className="skima-status-note">{notice}</StatusBadge> : null}

      <section className="sk-panel admin-resource-summary">
        <div className="sk-panel__header">
          <div>
            <h2>{activeGroup.label}</h2>
            <p className="skima-muted">{activeGroup.description}</p>
          </div>
        </div>
        {activeGroup.actions.length ? (
          <div className="admin-resource-action-block">
            <p>Available actions</p>
            <div className="skima-resource-actions">
              {activeGroup.actions.map((action) => (
                <Button
                  key={action.key}
                  variant={action.tone === "danger" ? "destructive" : "outline"}
                  requiredPermission={action.requiredPermission}
                  onClick={() => {
                    setNotice(null);
                    setActiveAction(action);
                  }}
                >
                  {action.label}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <p className="skima-muted">This section is read-only from the administration dashboard.</p>
        )}
      </section>

      <div className="skima-resource-grid admin-resource-grid">
        {activeGroup.resources.map((resource) => (
          <AdminResourcePanel key={resource.key} resource={resource} />
        ))}
      </div>

      <AdminActionDialog
        action={activeAction}
        onClose={() => setActiveAction(null)}
        onComplete={(label) => {
          setActiveAction(null);
          setNotice(`${label} completed successfully.`);
        }}
      />
    </>
  );
}

function AdminResourcePanel(props: { readonly resource: AdminResourceDefinition }) {
  const query = useAdminRecords(props.resource.key, props.resource.path);
  const records = query.data ?? [];
  const columns = useMemo(
    () => buildColumns(records, props.resource.preferredKeys),
    [props.resource.preferredKeys, records],
  );

  if (query.isLoading) {
    return <LoadingState label={`Loading ${props.resource.title}`} />;
  }

  if (query.error) {
    return (
      <ErrorState
        title={`${props.resource.title} unavailable`}
        message={readErrorMessage(query.error)}
        onRetry={() => void query.refetch()}
      />
    );
  }

  return (
    <section className="sk-panel admin-resource-panel">
      <div className="sk-panel__header">
        <div>
          <h2>{props.resource.title}</h2>
          {props.resource.description
            ? <p className="skima-muted">{props.resource.description}</p>
            : null}
        </div>
        <StatusBadge>{records.length === 1 ? "1 item" : `${records.length} items`}</StatusBadge>
      </div>
      <DataTable
        caption={props.resource.title}
        columns={columns}
        records={records}
        getRowKey={(record) => String(record.id ?? record.key ?? JSON.stringify(record))}
        emptyTitle={`No ${props.resource.title.toLowerCase()} yet`}
        emptyMessage="There is nothing to show in this section right now."
      />
    </section>
  );
}

function AdminActionDialog(props: {
  readonly action: AdminActionDefinition | null;
  readonly onClose: () => void;
  readonly onComplete: (label: string) => void;
}) {
  const { api } = useSessionState();
  const queryClient = useQueryClient();
  const [formValues, setFormValues] = useState<Readonly<Record<string, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const action = props.action;
  const mutation = useMutation({
    mutationFn: (payload: Readonly<Record<string, unknown>>) => {
      if (!action) {
        throw new Error("Choose an action before submitting.");
      }

      return api.post(action.path, payload, MutationResponseSchema);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-resource"] });
      if (action) props.onComplete(action.label);
    },
  });

  useEffect(() => {
    if (!action) {
      setFormValues({});
      setFormError(null);
      mutation.reset();
      return;
    }

    setFormValues(
      Object.fromEntries(
        action.fields.map((field) => [field.key, stringifyFieldValue(field.defaultValue)]),
      ),
    );
    setFormError(null);
    mutation.reset();
  }, [action?.key]);

  if (!action) {
    return null;
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    try {
      setFormError(null);
      const payload = buildPayload(action, formValues);
      mutation.mutate(payload);
    } catch (error) {
      setFormError(readErrorMessage(error));
    }
  };

  return (
    <Dialog
      title={action.label}
      isOpen={Boolean(action)}
      onClose={props.onClose}
      footer={
        <>
          <Button variant="ghost" disabled={mutation.isPending} onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="admin-action-form"
            isLoading={mutation.isPending}
            variant={action.tone === "danger" ? "destructive" : "primary"}
          >
            {action.submitLabel ?? action.label}
          </Button>
        </>
      }
    >
      <form id="admin-action-form" className="skima-form-grid" onSubmit={submit}>
        <p className="admin-dialog-guidance">
          Review the details below before continuing. Required fields are marked by your browser; optional technical fields can be left unchanged when they are not needed.
        </p>
        {action.fields.map((field) => (
          <AdminActionFieldInput
            key={field.key}
            field={field}
            value={formValues[field.key] ?? ""}
            onChange={(value) => setFormValues((current) => ({ ...current, [field.key]: value }))}
          />
        ))}
        {formError ? <StatusBadge tone="danger">{formError}</StatusBadge> : null}
        {mutation.error
          ? <StatusBadge tone="danger">{readErrorMessage(mutation.error)}</StatusBadge>
          : null}
      </form>
    </Dialog>
  );
}

function AdminActionFieldInput(props: {
  readonly field: AdminActionField;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const fieldType = props.field.type ?? "text";
  const fieldId = `admin-action-${props.field.key}`;

  if (fieldType === "boolean") {
    return (
      <CheckboxField
        id={fieldId}
        label={props.field.label}
        helperText={props.field.helperText}
        checked={props.value === "true"}
        onChange={(event) => props.onChange(event.currentTarget.checked ? "true" : "false")}
      />
    );
  }

  if (fieldType === "json" || fieldType === "stringArray") {
    return (
      <TextAreaInput
        id={fieldId}
        label={props.field.label}
        helperText={props.field.helperText}
        value={props.value}
        placeholder={props.field.placeholder}
        required={props.field.required}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      />
    );
  }

  if (fieldType === "select") {
    return (
      <SelectInput
        id={fieldId}
        label={props.field.label}
        helperText={props.field.helperText}
        value={props.value}
        required={props.field.required}
        options={props.field.options ?? []}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      />
    );
  }

  return (
    <TextInput
      id={fieldId}
      label={props.field.label}
      helperText={props.field.helperText}
      value={props.value}
      placeholder={props.field.placeholder}
      type={fieldType === "number"
        ? "number"
        : fieldType === "datetime"
        ? "datetime-local"
        : "text"}
      required={props.field.required}
      onChange={(event) => props.onChange(event.currentTarget.value)}
    />
  );
}

function useAdminRecords(queryKey: string, path: string) {
  const { api, status } = useSessionState();

  return useQuery({
    queryKey: ["admin-resource", queryKey, path],
    queryFn: () => api.get(path, RecordArraySchema),
    enabled: status === "authenticated",
  });
}

function buildPayload(
  action: AdminActionDefinition,
  formValues: Readonly<Record<string, string>>,
): Readonly<Record<string, unknown>> {
  const payload: Record<string, unknown> = {};

  for (const field of action.fields) {
    if (field.includeInPayload === false) {
      continue;
    }

    const rawValue = formValues[field.key] ?? "";
    const value = parseFieldValue(field, rawValue);

    if (value !== undefined) {
      payload[field.key] = value;
    }
  }

  if (!("idempotencyKey" in payload)) {
    payload.idempotencyKey = createClientIdempotencyKey(action.idempotencyScope ?? action.key);
  }

  return payload;
}

function parseFieldValue(field: AdminActionField, rawValue: string): unknown {
  const fieldType = field.type ?? "text";
  const trimmed = rawValue.trim();

  if (!field.required && trimmed.length === 0) {
    return undefined;
  }

  if (fieldType === "boolean") {
    return rawValue === "true";
  }

  if (fieldType === "number") {
    const parsed = Number(trimmed);

    if (Number.isNaN(parsed)) {
      throw new Error(`${field.label} must be a number.`);
    }

    return parsed;
  }

  if (fieldType === "json") {
    try {
      return trimmed.length > 0 ? JSON.parse(trimmed) : {};
    } catch {
      throw new Error(`${field.label} contains invalid structured data. Check the formatting and try again.`);
    }
  }

  if (fieldType === "stringArray") {
    if (trimmed.startsWith("[")) {
      const parsed = JSON.parse(trimmed);

      if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string")) {
        throw new Error(`${field.label} must contain a list of text values.`);
      }

      return parsed;
    }

    return trimmed.split(",").map((value) => value.trim()).filter(Boolean);
  }

  if (fieldType === "datetime") {
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) throw new Error(`${field.label} must be a valid date and time.`);
    return parsed.toISOString();
  }

  return trimmed;
}

function stringifyFieldValue(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }

  return JSON.stringify(value, null, 2);
}

function buildColumns(
  records: readonly PlatformRecord[],
  preferredKeys: readonly string[],
): TableColumn<PlatformRecord>[] {
  const keys = new Set(preferredKeys);

  for (const record of records.slice(0, 4)) {
    for (const key of Object.keys(record).slice(0, 5)) {
      keys.add(key);
    }
  }

  return Array.from(keys).slice(0, 7).map((key) => ({
    key,
    header: normalizeStatusLabel(key),
    render: (record) => renderRecordValue(key, record[key], record),
  }));
}

function renderRecordValue(
  key: string,
  value: unknown,
  record: PlatformRecord,
): ReactNode {
  if (typeof value === "string") {
    if (/status|state|decision|kind|type/i.exec(key)) {
      return <StatusBadge tone={toneFromValue(value)}>{normalizeStatusLabel(value)}</StatusBadge>;
    }

    if (/created_at|updated_at|expires_at|submitted_at|requested_at|approved_at/i.exec(key)) {
      return formatDate(value);
    }

    return value.length > 48 ? `${value.slice(0, 45)}...` : value;
  }

  if (typeof value === "number") {
    if (/_minor$/i.test(key)) {
      return <MoneyDisplay value={formatMoney(value, String(record.currency_code ?? "NGN"))} />;
    }

    if (/amount|balance/i.exec(key)) {
      return <MoneyDisplay value={formatMajorMoney(value, String(record.currency_code ?? "NGN"))} />;
    }

    return String(value);
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (value === null || value === undefined) {
    return "Not set";
  }

  return JSON.stringify(value);
}

function formatMajorMoney(
  amount: number,
  currencyCode: string,
  locale = "en-NG",
): string {
  return new Intl.NumberFormat(locale, {
    currency: currencyCode,
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(amount);
}

function formatDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function toneFromValue(value: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (/active|approved|complete|completed|success|paid|verified|delivered/i.exec(value)) {
    return "success";
  }

  if (/failed|rejected|revoked|suspended|cancelled|error|blocked|quarantined/i.exec(value)) {
    return "danger";
  }

  if (/pending|queued|review|draft|submitted|processing|requested/i.exec(value)) {
    return "warning";
  }

  if (/new|uploaded|incomplete|info/i.exec(value)) {
    return "info";
  }

  return "neutral";
}

function readErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "The action could not be completed. Please try again.";
  if (/requested resource was not found|route_not_found/i.test(error.message)) {
    return "This action is temporarily unavailable. Refresh the page and try again.";
  }
  if (/permission|required/i.test(error.message) && /permission/i.test(error.message)) {
    return "Your administrator account does not have permission to complete this action.";
  }
  return error.message;
}
