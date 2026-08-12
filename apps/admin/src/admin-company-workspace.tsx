import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, type LucideIcon, MapPinned, Plus, RefreshCcw, UsersRound } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { z } from "zod";

import { createClientIdempotencyKey, normalizeStatusLabel } from "@skima/frontend-core";
import {
  Button,
  DetailList,
  Dialog,
  ErrorState,
  LoadingState,
  MetricTile,
  PageHeader,
  SelectInput,
  StatusBadge,
  TextInput,
} from "@skima/ui";

import { useSessionState } from "./session";

const RecordSchema = z.record(z.unknown());
const RecordsSchema = z.array(RecordSchema);
const MutationSchema = z.union([z.string(), z.record(z.unknown()), z.null()]);

type PlatformRecord = Readonly<Record<string, unknown>>;

interface CompanyFormState {
  readonly displayName: string;
  readonly legalName: string;
  readonly slug: string;
  readonly status: string;
}

const emptyCompany: CompanyFormState = {
  displayName: "",
  legalName: "",
  slug: "",
  status: "active",
};

export function AdminCompanyWorkspace() {
  const { api, status } = useSessionState();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [form, setForm] = useState<CompanyFormState>(emptyCompany);
  const [formError, setFormError] = useState<string | null>(null);

  const organizations = useQuery({
    queryKey: ["admin-company", "organizations"],
    queryFn: () => api.get("/admin/organizations", RecordsSchema),
    enabled: status === "authenticated",
  });
  const branches = useQuery({
    queryKey: ["admin-company", "branches"],
    queryFn: () => api.get("/runtime/organization-branches", RecordsSchema),
    enabled: status === "authenticated",
  });
  const memberships = useQuery({
    queryKey: ["admin-company", "memberships"],
    queryFn: () => api.get("/runtime/organization-memberships", RecordsSchema),
    enabled: status === "authenticated",
  });

  const organizationRecords = organizations.data ?? [];
  const selected = useMemo(
    () => organizationRecords.find((record) => recordString(record, "id") === selectedId) ??
      organizationRecords[0] ?? null,
    [organizationRecords, selectedId],
  );
  const selectedOrganizationId = recordString(selected, "id");
  const selectedBranches = (branches.data ?? []).filter((record) =>
    recordString(record, "organization_id") === selectedOrganizationId
  );
  const selectedMemberships = (memberships.data ?? []).filter((record) =>
    recordString(record, "organization_id") === selectedOrganizationId
  );

  useEffect(() => {
    if (!selectedId && organizationRecords[0]) {
      setSelectedId(recordString(organizationRecords[0], "id"));
    }
  }, [organizationRecords, selectedId]);

  const saveCompany = useMutation({
    mutationFn: () =>
      api.post(
        "/admin/organizations",
        {
          organizationId: editingId,
          displayName: form.displayName.trim(),
          legalName: optionalText(form.legalName),
          slug: form.slug.trim().toLowerCase(),
          status: form.status,
          metadata: {},
          idempotencyKey: createClientIdempotencyKey(
            editingId ? "admin.organization.update" : "admin.organization.create",
            editingId ?? undefined,
          ),
        },
        MutationSchema,
      ),
    onSuccess: async () => {
      setEditorOpen(false);
      setFormError(null);
      await queryClient.invalidateQueries({ queryKey: ["admin-company"] });
    },
  });

  const openCreate = () => {
    setForm(emptyCompany);
    setFormError(null);
    setEditingId(null);
    setEditorOpen(true);
  };

  const openEdit = () => {
    if (!selected) return;
    setEditingId(selectedOrganizationId);
    setForm({
      displayName: recordString(selected, "display_name") ?? "",
      legalName: recordString(selected, "legal_name") ?? "",
      slug: recordString(selected, "slug") ?? "",
      status: recordString(selected, "status") ?? "active",
    });
    setFormError(null);
    setEditorOpen(true);
  };

  const refreshAll = () => void queryClient.invalidateQueries({ queryKey: ["admin-company"] });

  if (organizations.isLoading) return <LoadingState label="Loading companies" />;
  if (organizations.error) {
    return (
      <ErrorState
        title="Company directory unavailable"
        message={readError(organizations.error)}
        onRetry={() => void organizations.refetch()}
      />
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Company control"
        title="Companies & locations"
        description="Manage every company, branch, operating status, and team from one governed directory."
        actions={
          <>
            <Button icon={RefreshCcw} variant="outline" onClick={refreshAll}>Refresh</Button>
            <Button
              icon={Plus}
              requiredPermission="platform.organizations.manage"
              onClick={openCreate}
            >
              Add company
            </Button>
          </>
        }
      />

      <section className="skima-grid skima-grid--compact">
        <MetricTile label="Companies" value={organizationRecords.length} icon={Building2} />
        <MetricTile
          label="Active"
          value={organizationRecords.filter((record) => recordString(record, "status") === "active").length}
          icon={Building2}
          tone="success"
        />
        <MetricTile label="Locations" value={(branches.data ?? []).length} icon={MapPinned} tone="info" />
        <MetricTile label="Company users" value={(memberships.data ?? []).length} icon={UsersRound} tone="warning" />
      </section>

      <div className="admin-master-detail">
        <section className="sk-panel admin-directory-panel">
          <div className="sk-panel__header">
            <div>
              <p className="admin-section-kicker">Directory</p>
              <h2>All companies</h2>
            </div>
            <StatusBadge>{String(organizationRecords.length)}</StatusBadge>
          </div>
          <div className="admin-directory-list">
            {organizationRecords.map((organization) => {
              const id = recordString(organization, "id");
              const isSelected = id === selectedOrganizationId;
              return (
                <button
                  className={`admin-directory-item${isSelected ? " is-active" : ""}`}
                  key={id ?? JSON.stringify(organization)}
                  type="button"
                  onClick={() => setSelectedId(id)}
                >
                  <span className="admin-avatar-mark" aria-hidden="true">
                    {(recordString(organization, "display_name") ?? "C").slice(0, 1).toUpperCase()}
                  </span>
                  <span>
                    <strong>{recordString(organization, "display_name") ?? "Unnamed company"}</strong>
                    <small>{recordString(organization, "slug") ?? "No company key"}</small>
                  </span>
                  <StatusBadge tone={statusTone(recordString(organization, "status"))}>
                    {normalizeStatusLabel(recordString(organization, "status") ?? "unknown")}
                  </StatusBadge>
                </button>
              );
            })}
            {organizationRecords.length === 0
              ? <div className="admin-empty-compact">No companies have been created yet.</div>
              : null}
          </div>
        </section>

        <section className="sk-panel admin-company-detail">
          {selected
            ? (
              <>
                <div className="sk-panel__header">
                  <div>
                    <p className="admin-section-kicker">Selected company</p>
                    <h2>{recordString(selected, "display_name") ?? "Company"}</h2>
                  </div>
                  <Button
                    variant="outline"
                    requiredPermission="platform.organizations.manage"
                    onClick={openEdit}
                  >
                    Edit company
                  </Button>
                </div>
                <DetailList items={[
                  { label: "Legal name", value: recordString(selected, "legal_name") ?? "Not set" },
                  { label: "Company key", value: recordString(selected, "slug") ?? "Not set" },
                  {
                    label: "Status",
                    value: (
                      <StatusBadge tone={statusTone(recordString(selected, "status"))}>
                        {normalizeStatusLabel(recordString(selected, "status") ?? "unknown")}
                      </StatusBadge>
                    ),
                  },
                  { label: "Locations", value: selectedBranches.length },
                  { label: "Team members", value: selectedMemberships.length },
                  { label: "Created", value: formatDate(recordString(selected, "created_at")) },
                ]} />
                <div className="admin-company-summary-grid">
                  <CompanySummary
                    icon={MapPinned}
                    label="Locations"
                    value={String(selectedBranches.length)}
                    supporting="Branches connected to this company"
                  />
                  <CompanySummary
                    icon={UsersRound}
                    label="Team"
                    value={String(selectedMemberships.length)}
                    supporting="Active and invited company users"
                  />
                </div>
              </>
            )
            : <div className="admin-empty-compact">Choose a company to view its operating profile.</div>}
        </section>
      </div>

      <Dialog
        title={editingId ? "Edit company" : "Add company"}
        isOpen={editorOpen}
        onClose={() => setEditorOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditorOpen(false)}>Cancel</Button>
            <Button
              form="admin-company-form"
              type="submit"
              isLoading={saveCompany.isPending}
              requiredPermission="platform.organizations.manage"
            >
              Save company
            </Button>
          </>
        }
      >
        <form
          id="admin-company-form"
          className="skima-form"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            if (!form.displayName.trim() || !form.slug.trim()) {
              setFormError("Company name and company key are required.");
              return;
            }
            setFormError(null);
            saveCompany.mutate();
          }}
        >
          <div className="admin-form-grid">
            <TextInput
              label="Company name"
              name="displayName"
              value={form.displayName}
              onChange={(event) => setForm({ ...form, displayName: event.currentTarget.value })}
              required
            />
            <TextInput
              label="Company key"
              name="slug"
              helperText="Lowercase letters, numbers, and hyphens."
              value={form.slug}
              onChange={(event) => setForm({ ...form, slug: event.currentTarget.value })}
              required
            />
          </div>
          <TextInput
            label="Legal name"
            name="legalName"
            value={form.legalName}
            onChange={(event) => setForm({ ...form, legalName: event.currentTarget.value })}
          />
          <SelectInput
            label="Operating status"
            name="status"
            value={form.status}
            options={[
              { label: "Active", value: "active" },
              { label: "Pending", value: "pending" },
              { label: "Suspended", value: "suspended" },
              { label: "Archived", value: "archived" },
            ]}
            onChange={(event) => setForm({ ...form, status: event.currentTarget.value })}
          />
          {formError || saveCompany.error
            ? <p className="admin-form-error">{formError ?? readError(saveCompany.error)}</p>
            : null}
        </form>
      </Dialog>
    </>
  );
}

function CompanySummary(props: {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly value: string;
  readonly supporting: string;
}) {
  const Icon = props.icon;
  return (
    <div className="admin-summary-card">
      <Icon aria-hidden="true" />
      <span>{props.label}</span>
      <strong>{props.value}</strong>
      <small>{props.supporting}</small>
    </div>
  );
}

function recordString(record: PlatformRecord | null | undefined, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function optionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function formatDate(value: string | null): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function statusTone(status: string | null): "neutral" | "success" | "warning" | "danger" {
  if (status === "active") return "success";
  if (status === "pending") return "warning";
  if (status === "suspended") return "danger";
  return "neutral";
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : "The request could not be completed.";
}
