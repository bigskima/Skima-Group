import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileCheck2, FileText, RefreshCcw, Send, ShieldCheck } from "lucide-react";
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

export function AdminPolicyWorkspace() {
  const { supabase, status, context } = useSessionState();
  const queryClient = useQueryClient();
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
          target_metadata: { sourceSurface: "admin_policy_workspace" },
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
        target_metadata: { sourceSurface: "admin_policy_workspace" },
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
    mutationFn: async ({ version, effectiveFrom, reason, requiresReacceptance }: { version: PolicyVersion; effectiveFrom: string; reason: string; requiresReacceptance: boolean }) => {
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
      setNotice("Policy version published. The previous published version, if any, remains preserved as superseded history.");
      await queryClient.invalidateQueries({ queryKey: ["policy-admin-catalog"] });
    },
  });

  const columns = useMemo<TableColumn<PolicyDocument>[]>(() => [
    {
      key: "title",
      header: "Policy",
      render: (record) => <span><strong>{record.title}</strong><br /><small>{record.audience === "customer" ? "Customer" : "Partner"} • {record.serviceScope.toUpperCase()}</small></span>,
    },
    {
      key: "published",
      header: "Current version",
      render: (record) => {
        const current = record.versions.find((version) => version.status === "published");
        return current ? <StatusBadge tone="success">Version {current.versionLabel}</StatusBadge> : <StatusBadge tone="warning">Not published</StatusBadge>;
      },
    },
    { key: "drafts", header: "Drafts", render: (record) => String(record.versions.filter((version) => version.status === "draft").length) },
    { key: "acceptances", header: "Acceptances", render: (record) => String(record.acceptanceCount) },
    {
      key: "actions",
      header: "Actions",
      render: (record) => <Button size="sm" variant="outline" onClick={() => setSelectedDocumentId(record.documentId)}>Manage</Button>,
    },
  ], []);

  return (
    <>
      <PageHeader
        eyebrow="Company policy"
        title="Terms & Policies"
        description="Import complete policy text, create immutable versions, publish prospectively and preserve the exact version every customer or partner accepted."
        actions={<Button icon={RefreshCcw} variant="outline" onClick={() => void query.refetch()}>Refresh policies</Button>}
      />

      {notice ? <StatusBadge tone="success" className="skima-status-note">{notice}</StatusBadge> : null}

      <section className="skima-grid skima-grid--compact">
        <MetricTile label="Policy documents" value={documents.length} icon={FileText} tone="info" />
        <MetricTile label="Published" value={publishedCount} icon={FileCheck2} tone={publishedCount === documents.length && documents.length ? "success" : "warning"} />
        <MetricTile label="Draft versions" value={draftCount} icon={FileText} tone={draftCount ? "warning" : "info"} />
        <MetricTile label="Recorded acceptances" value={acceptanceCount} icon={ShieldCheck} tone="success" />
      </section>

      {query.isLoading ? <LoadingState label="Loading policies" /> : null}
      {query.error ? <ErrorState title="Policies unavailable" message={readError(query.error)} onRetry={() => void query.refetch()} /> : null}

      {!query.isLoading && !query.error ? (
        <section className="sk-panel">
          <div className="sk-panel__header">
            <div><h2>Policy documents</h2><p className="skima-muted">The canonical source is recorded separately from the immutable text that is actually published in SKIMA.</p></div>
          </div>
          <DataTable caption="SKIMA policy documents" columns={columns} records={documents} getRowKey={(record) => record.documentId} emptyTitle="No policy documents" emptyMessage="No policy document definitions are configured." />
        </section>
      ) : null}

      {selected ? (
        <section className="sk-panel">
          <div className="sk-panel__header">
            <div>
              <h2>{selected.title}</h2>
              <p className="skima-muted">Acceptance statement: “{selected.acceptanceStatement}”</p>
              {selected.sourceUrl ? <p><a href={selected.sourceUrl} target="_blank" rel="noreferrer">Open canonical source</a></p> : null}
            </div>
            {canDraft ? <Button onClick={() => setDraftTarget({ document: selected, version: null })}>Create version</Button> : null}
          </div>
          <div className="skima-stack">
            {selected.versions.length === 0 ? <p className="skima-muted">No in-app version has been created yet. Import the complete source text before publishing.</p> : null}
            {selected.versions.map((version) => (
              <div className="skima-record-card" key={version.versionId}>
                <div>
                  <strong>Version {version.versionLabel}</strong>{" "}
                  <StatusBadge tone={version.status === "published" ? "success" : version.status === "draft" ? "warning" : "neutral"}>{normalizeStatusLabel(version.status)}</StatusBadge>
                  <p className="skima-muted">{version.content.length.toLocaleString()} characters • {version.contentFormat.replace("_", " ")}{version.contentHash ? ` • ${version.contentHash.slice(0, 12)}…` : ""}</p>
                </div>
                <div className="skima-action-row">
                  {version.status === "draft" && canDraft ? <Button size="sm" variant="outline" onClick={() => setDraftTarget({ document: selected, version })}>Edit draft</Button> : null}
                  {version.status === "draft" && canPublish ? <Button size="sm" icon={Send} onClick={() => setPublishTarget({ document: selected, version })}>Publish</Button> : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <DraftDialog target={draftTarget} isSubmitting={draftMutation.isPending} error={draftMutation.error} onClose={() => { if (!draftMutation.isPending) { draftMutation.reset(); setDraftTarget(null); } }} onSubmit={(form) => { if (draftTarget) draftMutation.mutate({ ...draftTarget, form }); }} />
      <PublishDialog target={publishTarget} isSubmitting={publishMutation.isPending} error={publishMutation.error} onClose={() => { if (!publishMutation.isPending) { publishMutation.reset(); setPublishTarget(null); } }} onSubmit={(payload) => { if (publishTarget) publishMutation.mutate({ version: publishTarget.version, ...payload }); }} />
    </>
  );
}

function DraftDialog({ target, isSubmitting, error, onClose, onSubmit }: { target: { document: PolicyDocument; version: PolicyVersion | null } | null; isSubmitting: boolean; error: unknown; onClose: () => void; onSubmit: (form: DraftForm) => void }) {
  const [form, setForm] = useState<DraftForm>(EMPTY_DRAFT);
  const key = target ? `${target.document.documentId}:${target.version?.versionId ?? "new"}` : "closed";

  useMemo(() => {
    if (!target) return null;
    const version = target.version;
    setForm(version ? {
      versionLabel: version.versionLabel,
      summary: version.summary,
      content: version.content,
      contentFormat: version.contentFormat,
      sourceUrl: version.sourceUrl ?? target.document.sourceUrl ?? "",
      sourceReference: version.sourceReference ?? target.document.sourceReference ?? "",
      sourceUpdatedAt: dateTimeInput(version.sourceUpdatedAt),
      requiresReacceptance: version.requiresReacceptance,
    } : {
      ...EMPTY_DRAFT,
      versionLabel: String(target.document.metadata.canonicalVersion ?? "1.0"),
      sourceUrl: target.document.sourceUrl ?? "",
      sourceReference: target.document.sourceReference ?? "",
    });
    return null;
  }, [key]);

  if (!target) return null;
  const update = (patch: Partial<DraftForm>) => setForm((current) => ({ ...current, ...patch }));
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.versionLabel.trim()) return;
    onSubmit(form);
  };

  return (
    <Dialog title={target.version ? `Edit version ${target.version.versionLabel}` : `Create ${target.document.title} version`} isOpen onClose={onClose} footer={<><Button variant="ghost" disabled={isSubmitting} onClick={onClose}>Cancel</Button><Button type="submit" form="policy-draft-form" isLoading={isSubmitting}>Save draft</Button></>}>
      <form id="policy-draft-form" className="skima-form-grid" onSubmit={submit}>
        <p className="admin-dialog-guidance">Paste the complete canonical policy text. Drafts can be edited; published text cannot be changed.</p>
        <TextInput label="Version" value={form.versionLabel} disabled={Boolean(target.version)} onChange={(event) => update({ versionLabel: event.currentTarget.value })} required />
        <SelectInput label="Content format" value={form.contentFormat} options={[{ label: "Markdown", value: "markdown" }, { label: "Plain text", value: "plain_text" }, { label: "HTML", value: "html" }]} onChange={(event) => update({ contentFormat: event.currentTarget.value as DraftForm["contentFormat"] })} />
        <TextAreaInput label="Quick summary" helperText="Shown before the full terms. It does not replace the complete policy." value={form.summary} onChange={(event) => update({ summary: event.currentTarget.value })} required />
        <TextAreaInput label="Complete policy text" helperText="Publication is blocked until a substantial full document is present." value={form.content} onChange={(event) => update({ content: event.currentTarget.value })} required />
        <TextInput label="Canonical source URL" value={form.sourceUrl} onChange={(event) => update({ sourceUrl: event.currentTarget.value })} />
        <TextInput label="Source reference" value={form.sourceReference} onChange={(event) => update({ sourceReference: event.currentTarget.value })} />
        <TextInput label="Source updated at" type="datetime-local" value={form.sourceUpdatedAt} onChange={(event) => update({ sourceUpdatedAt: event.currentTarget.value })} />
        <label className="skima-checkbox-row"><input type="checkbox" checked={form.requiresReacceptance} onChange={(event) => update({ requiresReacceptance: event.currentTarget.checked })} /><span>Require users to accept this version when it becomes current</span></label>
        {error ? <StatusBadge tone="danger">{readError(error)}</StatusBadge> : null}
      </form>
    </Dialog>
  );
}

function PublishDialog({ target, isSubmitting, error, onClose, onSubmit }: { target: { document: PolicyDocument; version: PolicyVersion } | null; isSubmitting: boolean; error: unknown; onClose: () => void; onSubmit: (payload: { effectiveFrom: string; reason: string; requiresReacceptance: boolean }) => void }) {
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [reason, setReason] = useState("");
  const [requiresReacceptance, setRequiresReacceptance] = useState(false);
  if (!target) return null;
  return (
    <Dialog title={`Publish version ${target.version.versionLabel}`} isOpen onClose={onClose} footer={<><Button variant="ghost" disabled={isSubmitting} onClick={onClose}>Cancel</Button><Button type="submit" form="policy-publish-form" isLoading={isSubmitting}>Publish version</Button></>}>
      <form id="policy-publish-form" className="skima-form-grid" onSubmit={(event) => { event.preventDefault(); onSubmit({ effectiveFrom, reason, requiresReacceptance }); }}>
        <p className="admin-dialog-guidance">Publishing makes this exact text the current in-app policy and preserves any previous published version as immutable history.</p>
        <TextInput label="Effective from" type="datetime-local" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.currentTarget.value)} />
        <TextAreaInput label="Publication reason" value={reason} onChange={(event) => setReason(event.currentTarget.value)} required />
        <label className="skima-checkbox-row"><input type="checkbox" checked={requiresReacceptance} onChange={(event) => setRequiresReacceptance(event.currentTarget.checked)} /><span>Require re-acceptance for this published version</span></label>
        <p className="skima-muted">Content length: {target.version.content.length.toLocaleString()} characters. {target.version.contentHash ? `Draft hash: ${target.version.contentHash}` : "A hash will be calculated at publication."}</p>
        {error ? <StatusBadge tone="danger">{readError(error)}</StatusBadge> : null}
      </form>
    </Dialog>
  );
}

function nullable(value: string) { const trimmed = value.trim(); return trimmed || null; }
function isoOrNull(value: string) { if (!value.trim()) return null; const date = new Date(value); if (Number.isNaN(date.getTime())) throw new Error("Enter a valid date and time."); return date.toISOString(); }
function dateTimeInput(value: string | null) { if (!value) return ""; const date = new Date(value); if (Number.isNaN(date.getTime())) return ""; const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000); return local.toISOString().slice(0, 16); }
function readError(error: unknown) { if (error instanceof Error && error.message.trim()) return error.message; if (error && typeof error === "object" && typeof (error as Record<string, unknown>).message === "string") return String((error as Record<string, unknown>).message); return "The policy action could not be completed. Please try again."; }
