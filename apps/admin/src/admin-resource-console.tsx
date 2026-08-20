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
import { ChevronDown, RefreshCcw, Search } from "lucide-react";

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

interface LookupDefinition {
  readonly path: string;
  readonly valueKey: string;
  readonly labelKeys: readonly string[];
  readonly secondaryKeys?: readonly string[];
  readonly noun: string;
}

const LOOKUP_BY_FIELD_KEY: Readonly<Record<string, LookupDefinition>> = {
  userId: {
    path: "/admin/profiles",
    valueKey: "id",
    labelKeys: ["display_name", "email"],
    secondaryKeys: ["status"],
    noun: "user",
  },
  fromUserId: {
    path: "/admin/profiles",
    valueKey: "id",
    labelKeys: ["display_name", "email"],
    secondaryKeys: ["status"],
    noun: "current owner",
  },
  toUserId: {
    path: "/admin/profiles",
    valueKey: "id",
    labelKeys: ["display_name", "email"],
    secondaryKeys: ["status"],
    noun: "new owner",
  },
  reviewerUserId: {
    path: "/admin/profiles",
    valueKey: "id",
    labelKeys: ["display_name", "email"],
    secondaryKeys: ["status"],
    noun: "reviewer",
  },
  organizationId: {
    path: "/admin/organizations",
    valueKey: "id",
    labelKeys: ["display_name", "legal_name", "slug"],
    secondaryKeys: ["status"],
    noun: "company",
  },
  branchId: {
    path: "/runtime/organization-branches",
    valueKey: "id",
    labelKeys: ["display_name", "name", "key"],
    secondaryKeys: ["status"],
    noun: "location",
  },
  stationBranchId: {
    path: "/runtime/organization-branches",
    valueKey: "id",
    labelKeys: ["display_name", "name", "key"],
    secondaryKeys: ["status"],
    noun: "station location",
  },
  roleKey: {
    path: "/admin/role-templates",
    valueKey: "key",
    labelKeys: ["display_name", "key"],
    secondaryKeys: ["status"],
    noun: "role",
  },
  moduleKey: {
    path: "/modules",
    valueKey: "key",
    labelKeys: ["display_name", "key"],
    secondaryKeys: ["status"],
    noun: "business line",
  },
  itemId: {
    path: "/runtime/catalog/items",
    valueKey: "id",
    labelKeys: ["display_name", "name", "key"],
    secondaryKeys: ["status"],
    noun: "service or item",
  },
  variantId: {
    path: "/runtime/catalog/variants",
    valueKey: "id",
    labelKeys: ["display_name", "name", "key"],
    secondaryKeys: ["status"],
    noun: "variant",
  },
  applicationId: {
    path: "/runtime/applications",
    valueKey: "id",
    labelKeys: ["application_subject_name", "applicant_display_name", "applicant_email"],
    secondaryKeys: ["status"],
    noun: "application",
  },
};

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
            <p>What would you like to do?</p>
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
          <p className="skima-muted">This area is for viewing information only.</p>
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
  const [showAdvanced, setShowAdvanced] = useState(false);
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
      setShowAdvanced(false);
      mutation.reset();
      return;
    }

    setFormValues(
      Object.fromEntries(
        action.fields.map((field) => [field.key, stringifyFieldValue(field.defaultValue)]),
      ),
    );
    setFormError(null);
    setShowAdvanced(false);
    mutation.reset();
  }, [action?.key]);

  if (!action) {
    return null;
  }

  const standardFields = action.fields.filter((field) => !isAdvancedOptionalField(field));
  const advancedFields = action.fields.filter(isAdvancedOptionalField);

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
          Choose people, companies and records by name where available. Skima keeps internal references behind the scenes.
        </p>
        {standardFields.map((field) => (
          <AdminActionFieldInput
            key={field.key}
            field={field}
            value={formValues[field.key] ?? ""}
            onChange={(value) => setFormValues((current) => ({ ...current, [field.key]: value }))}
          />
        ))}
        {advancedFields.length > 0 ? (
          <section className="admin-dialog-advanced">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              trailingIcon={ChevronDown}
              onClick={() => setShowAdvanced((current) => !current)}
            >
              {showAdvanced ? "Hide advanced settings" : "Advanced settings"}
            </Button>
            {showAdvanced ? (
              <>
                <p className="skima-muted">
                  These settings are optional. Leave them unchanged unless you know they are needed for this action.
                </p>
                {advancedFields.map((field) => (
                  <AdminActionFieldInput
                    key={field.key}
                    field={field}
                    value={formValues[field.key] ?? ""}
                    onChange={(value) => setFormValues((current) => ({ ...current, [field.key]: value }))}
                  />
                ))}
              </>
            ) : null}
          </section>
        ) : null}
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
  const lookup = LOOKUP_BY_FIELD_KEY[props.field.key];

  if (lookup && fieldType === "text") {
    return (
      <AdminLookupField
        field={props.field}
        lookup={lookup}
        value={props.value}
        onChange={props.onChange}
      />
    );
  }

  if (fieldType === "boolean") {
    return (
      <CheckboxField
        id={fieldId}
        label={friendlyFieldLabel(props.field)}
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
        label={friendlyFieldLabel(props.field)}
        helperText={friendlyHelperText(props.field)}
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
        label={friendlyFieldLabel(props.field)}
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
      label={friendlyFieldLabel(props.field)}
      helperText={friendlyHelperText(props.field)}
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

function AdminLookupField(props: {
  readonly field: AdminActionField;
  readonly lookup: LookupDefinition;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const { api, status } = useSessionState();
  const [search, setSearch] = useState("");
  const query = useQuery({
    queryKey: ["admin-human-lookup", props.lookup.path],
    queryFn: () => api.get(props.lookup.path, RecordArraySchema),
    enabled: status === "authenticated",
    retry: false,
  });

  const records = query.data ?? [];
  const normalizedSearch = search.trim().toLowerCase();
  const filtered = normalizedSearch
    ? records.filter((record) => lookupSearchText(record, props.lookup).includes(normalizedSearch))
    : records;
  const options = filtered
    .map((record) => toLookupOption(record, props.lookup))
    .filter((option): option is { readonly label: string; readonly value: string } => Boolean(option));
  const hasCurrent = props.value && options.some((option) => option.value === props.value);
  const currentOption = props.value && !hasCurrent
    ? { label: `Current selection (${shortReference(props.value)})`, value: props.value }
    : null;
  const selectOptions = [
    {
      label: props.field.required
        ? `Choose ${articleFor(props.lookup.noun)} ${props.lookup.noun}`
        : `No ${props.lookup.noun} selected`,
      value: "",
    },
    ...(currentOption ? [currentOption] : []),
    ...options,
  ];

  if (query.isLoading) {
    return <LoadingState label={`Loading ${props.lookup.noun} choices`} />;
  }

  if (query.error || records.length === 0) {
    return (
      <TextInput
        id={`admin-action-${props.field.key}`}
        label={friendlyFieldLabel(props.field)}
        helperText={
          query.error
            ? `The ${props.lookup.noun} list could not be loaded. Paste the internal reference only if you already have it.`
            : `No ${props.lookup.noun} records are available yet.`
        }
        value={props.value}
        required={props.field.required}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      />
    );
  }

  return (
    <div className="admin-human-lookup">
      {records.length > 12 ? (
        <TextInput
          label={`Find ${props.lookup.noun}`}
          value={search}
          placeholder={`Search ${props.lookup.noun} records`}
          onChange={(event) => setSearch(event.currentTarget.value)}
        />
      ) : null}
      <SelectInput
        id={`admin-action-${props.field.key}`}
        label={friendlyFieldLabel(props.field)}
        helperText={`Select the ${props.lookup.noun}; Skima will use the correct internal reference automatically.`}
        value={props.value}
        required={props.field.required}
        options={selectOptions}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      />
      {normalizedSearch && options.length === 0 ? (
        <p className="skima-muted"><Search aria-hidden="true" /> No matching {props.lookup.noun} found.</p>
      ) : null}
    </div>
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
      throw new Error(`${friendlyFieldLabel(field)} must be a number.`);
    }

    return parsed;
  }

  if (fieldType === "json") {
    try {
      return trimmed.length > 0 ? JSON.parse(trimmed) : {};
    } catch {
      throw new Error(`${friendlyFieldLabel(field)} contains information in an invalid format. Check it and try again.`);
    }
  }

  if (fieldType === "stringArray") {
    if (trimmed.startsWith("[")) {
      const parsed = JSON.parse(trimmed);

      if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string")) {
        throw new Error(`${friendlyFieldLabel(field)} must contain a list of text values.`);
      }

      return parsed;
    }

    return trimmed.split(",").map((value) => value.trim()).filter(Boolean);
  }

  if (fieldType === "datetime") {
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`${friendlyFieldLabel(field)} must be a valid date and time.`);
    }
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
    header: friendlyColumnHeader(key),
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

    if (looksLikeIdentifierKey(key) && looksLikeUuid(value)) {
      return <span title={value}>{shortReference(value)}</span>;
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

  if (Array.isArray(value)) {
    return value.length === 1 ? "1 item" : `${value.length} items`;
  }

  if (typeof value === "object") {
    return "Configured";
  }

  return String(value);
}

function friendlyFieldLabel(field: AdminActionField): string {
  const overrides: Readonly<Record<string, string>> = {
    userId: "User",
    fromUserId: "Current owner",
    toUserId: "New owner",
    reviewerUserId: "Reviewer",
    organizationId: "Company",
    branchId: "Location",
    stationBranchId: "Station location",
    roleKey: "Role",
    moduleKey: "Business line",
    itemId: "Service or item",
    variantId: "Variant",
    applicationId: "Application",
    invitedEmail: "Email address",
    expiresAt: "Invitation expires",
    metadata: "Additional system details",
    config: "Advanced configuration",
  };

  return overrides[field.key] ?? field.label;
}

function friendlyHelperText(field: AdminActionField): string | undefined {
  if (field.type === "stringArray") {
    return field.helperText?.replace("Use comma-separated values or a JSON array.", "Enter one or more values separated by commas.") ??
      "Enter one or more values separated by commas.";
  }

  if (field.type === "json") {
    return field.helperText?.replace("Use a valid JSON value.", "Only change this structured setting when required.") ??
      "Only change this structured setting when required.";
  }

  return field.helperText;
}

function friendlyColumnHeader(key: string): string {
  const overrides: Readonly<Record<string, string>> = {
    id: "Reference",
    user_id: "User reference",
    organization_id: "Company reference",
    branch_id: "Location reference",
    item_id: "Item reference",
    variant_id: "Variant reference",
    application_id: "Application reference",
    module_id: "Business line reference",
    media_asset_id: "Media reference",
    permission_keys: "Permissions",
    event_type_keys: "Events",
  };

  return overrides[key] ?? normalizeStatusLabel(key);
}

function isAdvancedOptionalField(field: AdminActionField): boolean {
  return field.type === "json" && !field.required;
}

function toLookupOption(
  record: PlatformRecord,
  lookup: LookupDefinition,
): { readonly label: string; readonly value: string } | null {
  const value = readRecordText(record, lookup.valueKey);
  if (!value) return null;

  const primary = firstRecordText(record, lookup.labelKeys) ?? shortReference(value);
  const secondary = firstRecordText(record, lookup.secondaryKeys ?? []);
  const secondaryLabel = secondary && secondary !== primary
    ? normalizeLookupSecondary(secondary)
    : null;

  return {
    label: secondaryLabel ? `${primary} — ${secondaryLabel}` : primary,
    value,
  };
}

function lookupSearchText(record: PlatformRecord, lookup: LookupDefinition): string {
  return [
    readRecordText(record, lookup.valueKey),
    ...lookup.labelKeys.map((key) => readRecordText(record, key)),
    ...(lookup.secondaryKeys ?? []).map((key) => readRecordText(record, key)),
  ].filter(Boolean).join(" ").toLowerCase();
}

function firstRecordText(record: PlatformRecord, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = readRecordText(record, key);
    if (value) return value;
  }
  return null;
}

function readRecordText(record: PlatformRecord, key: string): string | null {
  const value = record[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return null;
}

function normalizeLookupSecondary(value: string): string {
  if (/^[a-z0-9_ -]+$/i.test(value)) return normalizeStatusLabel(value);
  return value;
}

function articleFor(noun: string): "a" | "an" {
  return /^[aeiou]/i.test(noun) ? "an" : "a";
}

function looksLikeIdentifierKey(key: string): boolean {
  return key === "id" || /_id$/i.test(key) || /Id$/.test(key);
}

function looksLikeUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function shortReference(value: string): string {
  return value.length > 12 ? `Ref ${value.slice(0, 6)}…${value.slice(-4)}` : value;
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
  if (/network|fetch|timeout|timed out/i.test(error.message)) {
    return "Skima could not reach the service. Check your connection and try again.";
  }
  return error.message;
}
