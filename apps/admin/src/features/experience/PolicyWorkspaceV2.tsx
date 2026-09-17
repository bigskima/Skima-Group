import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileCheck2, FileText, RefreshCcw, Send, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
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

import { AdminWorkspaceIntro, AdminWorkspaceSections } from "../../admin-workspace-sections";
import { useSessionState } from "../../session";

const VersionSchema = z.object({
  versionId: z.string().uuid(),
  versionLabel: z.string(),
  status: z.enum(["draft", "published", "superseded", "retired"]),
  summary: z.string(),
  content: z.string(),
  contentFormat: z.enum(["markdown", "plain_text", "html"]),
  contentHash: z.string().nullable(),
  effectiveFrom: z.string().nullable(),
  effectiveUntil: z.string().nullable(),
  publishedAt: z.string().nullable(),
  requiresReacceptance: z.boolean(),
  sourceUrl: z.string().nullable(),
  sourceReference: z.string().nullable(),
  sourceUpdatedAt: z.string().nullable(),
  supersedesVersionId: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const DocumentSchema = z.object({
  documentId: z.string().uuid(),
  key: z.string(),
  title: z.string(),
  audience: z.enum(["customer", "partner", "public"]),
  serviceScope: z.string(),
  summary: z.string(),
  sourceUrl: z.string().nullable(),
  sourceReference: z.string().nullable(),
  acceptanceStatement: z.string(),
  isRequired: z.boolean(),
  status: z.string(),
  metadata: z.record(z.unknown()),
  versions: z.array(VersionSchema),
  acceptanceCount: z.coerce.number(),
  latestAcceptanceAt: z.string().nullable(),
});

const CatalogSchema = z.array(DocumentSchema);
type PolicyDocument = z.infer<typeof DocumentSchema>;
type PolicyVersion = z.infer<typeof VersionSchema>;
type PolicySection = "documents" | "versions" | "acceptance";

interface DraftForm {
  versionLabel: string;
  summary: string;
  content: string;
  contentFormat: "markdown" | "plain_text" | "html";
  sourceUrl: string;
  sourceReference: string;
  sourceUpdatedAt: string;
  requiresReacceptance: boolean;
}

const EMPTY_DRAFT: DraftForm = {
  versionLabel: "1.0",
  summary: "",
  content: "",
  contentFormat: "markdown",
  sourceUrl: "",
  sourceReference: "",
  sourceUpdatedAt: "",
  requiresReacceptance: false,
};

export function PolicyWorkspaceV2() {
  const { supabase, status, context } = useSessionState();
  const queryClient = useQueryClient();
  const [section, setSection] = useState<PolicySection>("documents");
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [draftTarget, setDraftTarget] = useState<{ document: PolicyDocument; version: PolicyVersion | null } | null>(null);
  const [publishTarget, setPublishTarget] = useState<{ document: PolicyDocument; version: PolicyVersion } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canDraft = context?.platformAdmin?.admin_kind === "super_admin" || context?.permissions.includes("platform.policy.draft") || false;
  const canPublish = context?.platformAdmin?.admin_kind === "super_admin" || context?.permissions.includes("platform.policy.publish") || false;

  const query = useQuery({
    queryKey: ["policy-admin-catalog"],
    enabled: status === "authenticated",
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_policy_admin_catalog");
      if (error) throw error;
      return CatalogSchema.parse(data ?? []);
    },
  });

  const documents = query.data ?? [];
  const selected = documents.find((item) => item.documentId === selectedDocumentId) ?? documents[0] ?? null;
  const publishedCount = documents.filter((doc) => doc.versions.some((version) => version.status === "published")).length;
  const draftCount = documents.reduce((sum, doc) => sum + doc.versions.filter((version) => version.status === "draft").length, 0);
  const acceptanceCount = documents.reduce((sum, doc) => sum + doc.acceptanceCount, 0);

  useEffect(() => {
    if (selectedDocumentId && documents.some((document) => document.documentId === selectedDocumentId)) return;
    setSelectedDocumentId(documents[0]?.documentId ?? null);
  }, [documents, selectedDocumentId]);

  const draftMutation = useMutation({
    mutationFn: async ({ document, version, form }: { document: PolicyDocument; version: PolicyVersion | null; form: DraftForm }) => {
      if (version) {
        const { data, error } = await supabase.rpc("update_policy_draft", {
          target_policy_version_id: version.versionId,
          target_summary_content: form.summary,
          target_full_content: form.content,
          target_content_format: form.contentFormat,
          target_source_url: nullable(form.sourceUrl),
          target_source_reference: nullable(form.sourceReference),
          target_source_updated_at: isoOrNull(form.sourceUpdatedAt),
          target_requires_reacceptance: form.requiresReacceptance,
          target_metadata: { sourceSurface: "policy_workspace_v2" },
          target_idempotency_key: createClientIdempotencyKey("admin.policy.update", version.versionId),
        });
        if (error) throw error;
        return data;
      }

      const { data, error } = await supabase.rpc("create_policy_version", {
        target_policy_key: document.key,
        target_version_label: form.versionLabel.trim(),
        target_summary_content: form.summary,
        target_full_content: form.content,
        target_content_format: form.contentFormat,
        target_source_url: nullable(form.sourceUrl) ?? document.sourceUrl,
        target_source_reference: nullable(form.sourceReference) ?? document.sourceReference,
        target_source_updated_at: isoOrNull(form.sourceUpdatedAt),
        target_requires_reacceptance: form.requiresReacceptance,
        target_metadata: { sourceSurface: "policy_workspace_v2" },
        target_idempotency_key: createClientIdempotencyKey("admin.policy.create", `${document.key}:${form.versionLabel.trim()}`),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async (_data, variables) => {
      setDraftTarget(null);
      setNotice(variables.version ? "Policy draft updated." : "Policy draft created.");
      await queryClient.invalidateQueries({ queryKey: ["policy-admin-catalog"] });
    },
  });

  const publishMutation = useMutation({
    mutationFn: async ({
      version,
      effectiveFrom,
      reason,
      requiresReacceptance,
    }: {
      version: PolicyVersion;
      effectiveFrom: string;
      reason: string;
      requiresReacceptance: boolean;
    }) => {
      const { data, error } = await supabase.rpc("publish_policy_version", {
        target_policy_version_id: version.versionId,
        target_effective_from: isoOrNull(effectiveFrom),
        target_requires_reacceptance: requiresReacceptance,
        target_reason: reason.trim(),
        target_idempotency_key: createClientIdempotencyKey("admin.policy.publish", version.versionId),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      setPublishTarget(null);
      setNotice("Policy version published. The previous published version remains preserved as history.");
      await queryClient.invalidateQueries({ queryKey: ["policy-admin-catalog"] });
    },
  });

  const columns = useMemo<TableColumn<PolicyDocument>[]>(() => [
    {
      key: "title",
      header: "Policy",
      render: (record) => (
        <span>
          <strong>{record.title}</strong><br />
          <small>{normalizeStatusLabel(record.audience)} · {record.serviceScope.toUpperCase()}</small>
        </span>
      ),
    },
    {
      key: "published",
      header: "Current version",
      render: (record) => {
        const current = record.versions.find((version) => version.status === "published");
        return current ? <StatusBadge tone="success">Version {current.versionLabel}</StatusBadge> : <StatusBadge tone="warning">Not published</StatusBadge>;
      },
    },
    {
      key: "drafts",
      header: "Drafts",
      render: (record) => String(record.versions.filter((version) => version.status === "draft").length),
    },
    {
      key: "action",
      header: "Action",
      render: (record) => (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setSelectedDocumentId(record.documentId);
            setSection("versions");
          }}
        >
          Open versions
        </Button>
      ),
    },
  ], []);

  if (query.isLoading) return <LoadingState label="Loading policies" />;
  if (query.error) return <ErrorState title="Policies unavailable" message={readError(query.error)} onRetry={() => void query.refetch()} />;

  return (
    <>
      <PageHeader
        eyebrow="Experience · Terms & Policies"
        title="Terms & Policies"
        description="Work through policy documents, versions and acceptance status one layer at a time instead of managing everything on one long page."
        actions={<Button icon={RefreshCcw} variant="outline" onClick={() => void query.refetch()}>Refresh</Button>}
      />

      <AdminWorkspaceSections
        compact
        label="Policy management sections"
        activeKey={section}
        onChange={(key) => setSection(key as PolicySection)}
        sections={[
          { key: "documents", label: "Documents", description: "Choose the policy you want to manage.", icon: FileText, badge: documents.length },
          { key: "versions", label: "Versions & publishing", description: "Draft, review and publish one policy.", icon: FileCheck2, badge: draftCount || null },
          { key: "acceptance", label: "Acceptance status", description: "See which policies users have accepted.", icon: ShieldCheck, badge: acceptanceCount || null },
        ]}
      />

      {notice ? <StatusBadge tone="success" className="skima-status-note">{notice}</StatusBadge> : null}

      {section === "documents" ? (
        <>
          <section className="skima-grid skima-grid--compact">
            <MetricTile label="Policy documents" value={documents.length} icon={FileText} tone="info" />
            <MetricTile label="Published" value={publishedCount} icon={FileCheck2} tone={publishedCount === documents.length && documents.length ? "success" : "warning"} />
            <MetricTile label="Draft versions" value={draftCount} icon={FileText} tone={draftCount ? "warning" : "info"} />
            <MetricTile label="Recorded acceptances" value={acceptanceCount} icon={ShieldCheck} tone="success" />
          </section>
          <section className="sk-panel">
            <AdminWorkspaceIntro
              kicker="Step 1"
              title="Choose a policy document"
              description="Open only the policy you want to draft or publish. Version editing stays in the next section."
            />
            <DataTable
              caption="SKIMA policy documents"
              columns={columns}
              records={documents}
              getRowKey={(record) => record.documentId}
              emptyTitle="No policy documents"
              emptyMessage="No policy document definitions are configured."
            />
          </section>
        </>
      ) : null}

      {section === "versions" ? (
        <PolicyVersionsSection
          documents={documents}
          selectedDocumentId={selected?.documentId ?? ""}
          onChoose={(id) => setSelectedDocumentId(id)}
          canDraft={canDraft}
          canPublish={canPublish}
          onCreate={(document) => setDraftTarget({ document, version: null })}
          onEdit={(document, version) => setDraftTarget({ document, version })}
          onPublish={(document, version) => setPublishTarget({ document, version })}
        />
      ) : null}

      {section === "acceptance" ? <AcceptanceSection documents={documents} /> : null}

      <DraftDialog
        target={draftTarget}
        isSubmitting={draftMutation.isPending}
        error={draftMutation.error}
        onClose={() => {
          if (draftMutation.isPending) return;
          draftMutation.reset();
          setDraftTarget(null);
        }}
        onSubmit={(form) => {
          if (draftTarget) draftMutation.mutate({ ...draftTarget, form });
        }}
      />
      <PublishDialog
        target={publishTarget}
        isSubmitting={publishMutation.isPending}
        error={publishMutation.error}
        onClose={() => {
          if (publishMutation.isPending) return;
          publishMutation.reset();
          setPublishTarget(null);
        }}
        onSubmit={(payload) => {
          if (publishTarget) publishMutation.mutate({ version: publishTarget.version, ...payload });
        }}
      />
    </>
  );
}

function PolicyVersionsSection(props: {
  readonly documents: readonly PolicyDocument[];
  readonly selectedDocumentId: string;
  readonly onChoose: (id: string) => void;
  readonly canDraft: boolean;
  readonly canPublish: boolean;
  readonly onCreate: (document: PolicyDocument) => void;
  readonly onEdit: (document: PolicyDocument, version: PolicyVersion) => void;
  readonly onPublish: (document: PolicyDocument, version: PolicyVersion) => void;
}) {
  const selected = props.documents.find((document) => document.documentId === props.selectedDocumentId) ?? props.documents[0] ?? null;

  if (!selected) {
    return <section className="sk-panel"><p className="skima-muted">No policy document is available yet.</p></section>;
  }

  return (
    <section className="sk-panel stack-md">
      <div className="sk-panel__header">
        <AdminWorkspaceIntro
          kicker="Step 2"
          title="Versions & publishing"
          description="Choose one policy, then work only with its version history. Published text remains immutable."
        />
        {props.canDraft ? <Button onClick={() => props.onCreate(selected)}>Create version</Button> : null}
      </div>

      <SelectInput
        label="Policy document"
        value={selected.documentId}
        options={props.documents.map((document) => ({ label: document.title, value: document.documentId }))}
        onChange={(event) => props.onChoose(event.currentTarget.value)}
      />

      <div className="sk-panel stack-sm">
        <strong>{selected.title}</strong>
        <p className="skima-muted">{selected.summary}</p>
        <small>Acceptance statement: “{selected.acceptanceStatement}”</small>
      </div>

      <div className="skima-stack">
        {selected.versions.length === 0 ? <p className="skima-muted">No complete in-app version exists yet.</p> : null}
        {selected.versions.map((version) => (
          <div className="skima-record-card" key={version.versionId}>
            <div>
              <strong>Version {version.versionLabel}</strong>{" "}
              <StatusBadge tone={version.status === "published" ? "success" : version.status === "draft" ? "warning" : "neutral"}>
                {normalizeStatusLabel(version.status)}
              </StatusBadge>
              <p className="skima-muted">
                {version.content.length.toLocaleString()} characters · {normalizeStatusLabel(version.contentFormat)}
                {version.publishedAt ? ` · published ${formatDate(version.publishedAt)}` : ""}
              </p>
            </div>
            <div className="skima-action-row">
              {version.status === "draft" && props.canDraft ? (
                <Button size="sm" variant="outline" onClick={() => props.onEdit(selected, version)}>Edit draft</Button>
              ) : null}
              {version.status === "draft" && props.canPublish ? (
                <Button size="sm" icon={Send} onClick={() => props.onPublish(selected, version)}>Publish</Button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function AcceptanceSection(props: { readonly documents: readonly PolicyDocument[] }) {
  return (
    <section className="sk-panel stack-md">
      <AdminWorkspaceIntro
        kicker="Step 3"
        title="Acceptance status"
        description="Review adoption without opening the drafting controls. Acceptance counts remain tied to the exact published policy versions."
      />
      <div className="admin-compact-card-grid">
        {props.documents.map((document) => {
          const current = document.versions.find((version) => version.status === "published");
          return (
            <div className="sk-panel stack-sm" key={document.documentId}>
              <div className="sk-panel__header">
                <strong>{document.title}</strong>
                <StatusBadge tone={current ? "success" : "warning"}>{current ? `v${current.versionLabel}` : "Not published"}</StatusBadge>
              </div>
              <div className="skima-grid skima-grid--compact">
                <div><small>Recorded acceptances</small><h3>{document.acceptanceCount.toLocaleString()}</h3></div>
                <div><small>Latest acceptance</small><h3>{document.latestAcceptanceAt ? formatDate(document.latestAcceptanceAt) : "None yet"}</h3></div>
              </div>
              <p className="skima-muted">Audience: {normalizeStatusLabel(document.audience)} · {document.serviceScope.toUpperCase()}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function DraftDialog({
  target,
  isSubmitting,
  error,
  onClose,
  onSubmit,
}: {
  target: { document: PolicyDocument; version: PolicyVersion | null } | null;
  isSubmitting: boolean;
  error: unknown;
  onClose: () => void;
  onSubmit: (form: DraftForm) => void;
}) {
  const [step, setStep] = useState<"content" | "source">("content");
  const [form, setForm] = useState<DraftForm>(EMPTY_DRAFT);
  const targetKey = target ? `${target.document.documentId}:${target.version?.versionId ?? "new"}` : "closed";

  useEffect(() => {
    setStep("content");
    if (!target) {
      setForm(EMPTY_DRAFT);
      return;
    }
    const version = target.version;
    setForm(version ? {
      versionLabel: version.versionLabel,
      summary: version.summary || target.document.summary,
      content: version.content,
      contentFormat: version.contentFormat,
      sourceUrl: version.sourceUrl ?? target.document.sourceUrl ?? "",
      sourceReference: version.sourceReference ?? target.document.sourceReference ?? "",
      sourceUpdatedAt: dateTimeInput(version.sourceUpdatedAt),
      requiresReacceptance: version.requiresReacceptance,
    } : {
      ...EMPTY_DRAFT,
      versionLabel: String(target.document.metadata.canonicalVersion ?? "1.0"),
      summary: target.document.summary,
      sourceUrl: target.document.sourceUrl ?? "",
      sourceReference: target.document.sourceReference ?? "",
    });
  }, [targetKey, target]);

  if (!target) return null;
  const update = (patch: Partial<DraftForm>) => setForm((current) => ({ ...current, ...patch }));
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.versionLabel.trim()) return;
    onSubmit(form);
  };

  return (
    <Dialog
      title={target.version ? `Edit version ${target.version.versionLabel}` : `Create ${target.document.title} version`}
      isOpen
      onClose={onClose}
      footer={(
        <>
          <Button variant="ghost" disabled={isSubmitting} onClick={onClose}>Cancel</Button>
          {step === "source" ? <Button variant="outline" disabled={isSubmitting} onClick={() => setStep("content")}>Back</Button> : null}
          {step === "content" ? (
            <Button disabled={!form.versionLabel.trim() || !form.summary.trim() || !form.content.trim()} onClick={() => setStep("source")}>Next</Button>
          ) : (
            <Button type="submit" form="policy-draft-form" isLoading={isSubmitting}>Save draft</Button>
          )}
        </>
      )}
    >
      <form id="policy-draft-form" className="skima-form-grid" onSubmit={submit}>
        {step === "content" ? (
          <>
            <p className="admin-dialog-guidance">Step 1 of 2 · Enter the policy content. Source/reference fields are kept out of this first step to make editing manageable on mobile.</p>
            <TextInput label="Version" value={form.versionLabel} disabled={Boolean(target.version)} onChange={(event) => update({ versionLabel: event.currentTarget.value })} required />
            <SelectInput label="Content format" value={form.contentFormat} options={[{ label: "Markdown", value: "markdown" }, { label: "Plain text", value: "plain_text" }, { label: "HTML", value: "html" }]} onChange={(event) => update({ contentFormat: event.currentTarget.value as DraftForm["contentFormat"] })} />
            <TextAreaInput label="Short summary" helperText="Shown before users tap Learn more." value={form.summary} onChange={(event) => update({ summary: event.currentTarget.value })} required />
            <TextAreaInput label="Complete in-app policy text" helperText="Rendered by SKIMA's in-app policy reader." value={form.content} onChange={(event) => update({ content: event.currentTarget.value })} required />
          </>
        ) : (
          <>
            <p className="admin-dialog-guidance">Step 2 of 2 · Add optional source information and choose whether this version requires users to accept it again.</p>
            <TextInput label="Fallback source URL" value={form.sourceUrl} onChange={(event) => update({ sourceUrl: event.currentTarget.value })} />
            <TextInput label="Source reference" value={form.sourceReference} onChange={(event) => update({ sourceReference: event.currentTarget.value })} />
            <TextInput label="Source updated at" type="datetime-local" value={form.sourceUpdatedAt} onChange={(event) => update({ sourceUpdatedAt: event.currentTarget.value })} />
            <label className="skima-checkbox-row"><input type="checkbox" checked={form.requiresReacceptance} onChange={(event) => update({ requiresReacceptance: event.currentTarget.checked })} /><span>Require users to accept this version when it becomes current</span></label>
          </>
        )}
        {error ? <StatusBadge tone="danger">{readError(error)}</StatusBadge> : null}
      </form>
    </Dialog>
  );
}

function PublishDialog({
  target,
  isSubmitting,
  error,
  onClose,
  onSubmit,
}: {
  target: { document: PolicyDocument; version: PolicyVersion } | null;
  isSubmitting: boolean;
  error: unknown;
  onClose: () => void;
  onSubmit: (payload: { effectiveFrom: string; reason: string; requiresReacceptance: boolean }) => void;
}) {
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [reason, setReason] = useState("");
  const [requiresReacceptance, setRequiresReacceptance] = useState(false);

  useEffect(() => {
    if (!target) {
      setEffectiveFrom("");
      setReason("");
      setRequiresReacceptance(false);
      return;
    }
    setEffectiveFrom("");
    setReason("");
    setRequiresReacceptance(target.version.requiresReacceptance);
  }, [target]);

  if (!target) return null;

  return (
    <Dialog
      title={`Publish version ${target.version.versionLabel}`}
      isOpen
      onClose={onClose}
      footer={(
        <>
          <Button variant="ghost" disabled={isSubmitting} onClick={onClose}>Cancel</Button>
          <Button type="submit" form="policy-publish-form" isLoading={isSubmitting}>Publish version</Button>
        </>
      )}
    >
      <form
        id="policy-publish-form"
        className="skima-form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({ effectiveFrom, reason, requiresReacceptance });
        }}
      >
        <p className="admin-dialog-guidance">Publishing makes this exact text the current SKIMA in-app policy. Older versions remain preserved for audit and acceptance history.</p>
        <TextInput label="Effective from" type="datetime-local" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.currentTarget.value)} />
        <TextAreaInput label="Publication reason" value={reason} onChange={(event) => setReason(event.currentTarget.value)} required />
        <label className="skima-checkbox-row"><input type="checkbox" checked={requiresReacceptance} onChange={(event) => setRequiresReacceptance(event.currentTarget.checked)} /><span>Require re-acceptance for this published version</span></label>
        <p className="skima-muted">Content length: {target.version.content.length.toLocaleString()} characters.</p>
        {error ? <StatusBadge tone="danger">{readError(error)}</StatusBadge> : null}
      </form>
    </Dialog>
  );
}

function nullable(value: string) {
  const trimmed = value.trim();
  return trimmed || null;
}

function isoOrNull(value: string) {
  if (!value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Enter a valid date and time.");
  return date.toISOString();
}

function dateTimeInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString();
}

function readError(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object" && typeof (error as Record<string, unknown>).message === "string") {
    return String((error as Record<string, unknown>).message);
  }
  return "The policy action could not be completed. Please try again.";
}
