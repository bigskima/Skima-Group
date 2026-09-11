import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Megaphone, Pencil, Plus, RefreshCcw, Send, Settings2, Target } from "lucide-react";
import { type ChangeEvent, type FormEvent, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  type ApiGatewayClient,
  createClientIdempotencyKey,
  normalizeStatusLabel,
} from "@skima/frontend-core";
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
import {
  AdminFormSection,
  AdminTaskFlow,
  AdminV2PageHeader,
  type AdminTaskFlowStep,
} from "../../shared/patterns/AdminV2Patterns";
import "./content-workspace-v2.css";

const CONTENT_MANAGE_PERMISSION = "platform.content.manage";

const PlacementSchema = z.object({
  id: z.string(),
  key: z.string(),
  display_name: z.string(),
  surface_key: z.string(),
  content_kind: z.string(),
  allowed_audiences: z.array(z.string()),
  status: z.string(),
}).passthrough();

const PublicationSchema = z.object({
  id: z.string(),
  publication_key: z.string(),
  placement_key: z.string(),
  organization_id: z.string().nullable().optional(),
  module_key: z.string().nullable().optional(),
  audience_keys: z.array(z.string()),
  country_codes: z.array(z.string()),
  regions: z.array(z.string()),
  cities: z.array(z.string()),
  title: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  accessibility_label: z.string().nullable().optional(),
  cta_label: z.string().nullable().optional(),
  cta_action: z.record(z.unknown()).optional(),
  media_asset_id: z.string().nullable().optional(),
  priority: z.coerce.number(),
  revision: z.coerce.number(),
  status: z.string(),
  starts_at: z.string().nullable().optional(),
  ends_at: z.string().nullable().optional(),
  published_at: z.string().nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
}).passthrough();

const UploadSessionSchema = z.object({
  token: z.string(),
  publicUrl: z.string().url(),
  signedUrl: z.string().url(),
  method: z.literal("PUT"),
  storageBucket: z.string(),
  storagePath: z.string(),
});
const MediaReadSessionSchema = z.object({ signedUrl: z.string().url() });
const MutationSchema = z.union([z.string(), z.record(z.unknown()), z.null()]);
const PlacementArraySchema = z.array(PlacementSchema);
const PublicationArraySchema = z.array(PublicationSchema);

type Placement = z.infer<typeof PlacementSchema>;
type Publication = z.infer<typeof PublicationSchema>;
type PlatformRecord = Readonly<Record<string, unknown>>;

interface PublicationForm {
  publicationId: string;
  publicationKey: string;
  placementKey: string;
  organizationId: string;
  moduleKey: string;
  audienceKeys: string;
  countryCodes: string;
  regions: string;
  cities: string;
  title: string;
  body: string;
  accessibilityLabel: string;
  ctaLabel: string;
  ctaType: string;
  ctaTarget: string;
  mediaAssetId: string;
  mediaPublicUrl: string;
  priority: string;
  status: string;
  startsAt: string;
  endsAt: string;
}

const EMPTY_PUBLICATION: PublicationForm = {
  publicationId: "",
  publicationKey: "",
  placementKey: "",
  organizationId: "",
  moduleKey: "",
  audienceKeys: "public",
  countryCodes: "",
  regions: "",
  cities: "",
  title: "",
  body: "",
  accessibilityLabel: "",
  ctaLabel: "",
  ctaType: "",
  ctaTarget: "",
  mediaAssetId: "",
  mediaPublicUrl: "",
  priority: "0",
  status: "draft",
  startsAt: "",
  endsAt: "",
};

const publicationSteps: readonly AdminTaskFlowStep[] = [
  { key: "surface", label: "Surface", description: "Choose where it appears" },
  { key: "creative", label: "Creative", description: "Image and copy" },
  { key: "audience", label: "Audience", description: "Choose who sees it" },
  { key: "action", label: "Action", description: "Optional tap behavior" },
  { key: "publish", label: "Publish", description: "Review and schedule" },
];

const audienceOptions = [
  { label: "Everyone", value: "public" },
  { label: "Customers", value: "customer" },
  { label: "Drivers", value: "driver" },
  { label: "Stations", value: "station" },
  { label: "All signed-in roles", value: "customer, driver, station" },
  { label: "Public + all roles", value: "public, customer, driver, station" },
] as const;

const statusOptions = [
  { label: "Save as draft", value: "draft" },
  { label: "Publish now / on schedule", value: "published" },
  { label: "Pause", value: "paused" },
  { label: "Retire", value: "retired" },
] as const;

const ctaOptions = [
  { label: "No tap action", value: "" },
  { label: "Open an app screen", value: "route" },
  { label: "Open a web link", value: "url" },
  { label: "Open an application flow", value: "application" },
] as const;

export function ContentWorkspaceV2(props: { readonly onNavigate: (href: string) => void }) {
  const { api, context, status, supabase } = useSessionState();
  const queryClient = useQueryClient();
  const [activePlacementKey, setActivePlacementKey] = useState<string | null>(null);
  const [selectedPublicationId, setSelectedPublicationId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Publication | "new" | null>(null);

  const placementsQuery = useQuery({
    queryKey: ["admin-content-v2", "placements"],
    queryFn: () => api.get("/admin/content/placements", PlacementArraySchema),
    enabled: status === "authenticated",
  });
  const publicationsQuery = useQuery({
    queryKey: ["admin-content-v2", "publications"],
    queryFn: () => api.get("/admin/content/publications", PublicationArraySchema),
    enabled: status === "authenticated",
  });

  const placements = placementsQuery.data ?? [];
  const publications = publicationsQuery.data ?? [];
  const activePlacement = placements.find((item) => item.key === activePlacementKey) ?? placements[0] ?? null;
  const activePublications = publications.filter((item) => !activePlacement || item.placement_key === activePlacement.key);
  const selectedPublication = publications.find((item) => item.id === selectedPublicationId) ?? activePublications[0] ?? null;
  const selectedMediaUrl = selectedPublication ? publicationMediaUrl(selectedPublication) : null;

  const mediaPreview = useQuery({
    queryKey: ["admin-content-v2", "media-preview", selectedPublication?.media_asset_id ?? null],
    enabled: status === "authenticated" && Boolean(selectedPublication?.media_asset_id) && !selectedMediaUrl,
    retry: false,
    queryFn: () => api.post(
      "/runtime/media/read-sessions",
      {
        assetId: selectedPublication?.media_asset_id,
        idempotencyKey: createClientIdempotencyKey("admin.content.v2.preview", selectedPublication?.media_asset_id ?? undefined),
      },
      MediaReadSessionSchema,
    ),
  });

  useEffect(() => {
    if (!activePlacementKey && placements[0]) setActivePlacementKey(placements[0].key);
  }, [activePlacementKey, placements]);

  useEffect(() => {
    if (!selectedPublicationId && activePublications[0]) setSelectedPublicationId(activePublications[0].id);
  }, [activePublications, selectedPublicationId]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["admin-content-v2"] });
    await Promise.all([placementsQuery.refetch(), publicationsQuery.refetch()]);
  };

  const setPublicationState = useMutation({
    mutationFn: (input: { publicationId: string; nextStatus: string }) => api.post(
      "/admin/content/publications/state",
      {
        idempotencyKey: createClientIdempotencyKey(`admin.content.v2.${input.nextStatus}`, input.publicationId),
        publicationId: input.publicationId,
        reason: `Admin V2 set publication to ${input.nextStatus}.`,
        status: input.nextStatus,
      },
      MutationSchema,
    ),
    onSuccess: refresh,
  });

  const columns = useMemo<TableColumn<Publication>[]>(() => [
    {
      key: "content",
      header: "Content",
      render: (item) => (
        <button className="admin-content-title-button" type="button" onClick={() => setSelectedPublicationId(item.id)}>
          <strong>{item.title || "Untitled content"}</strong>
          <small>{formatAudience(item.audience_keys)}</small>
        </button>
      ),
    },
    { key: "status", header: "Status", render: (item) => <StatusBadge tone={statusTone(item.status)}>{normalizeStatusLabel(item.status)}</StatusBadge> },
    { key: "schedule", header: "Delivery", render: (item) => formatSchedule(item) },
    {
      key: "control",
      header: "Control",
      render: (item) => (
        <div className="skima-action-row">
          <Button size="sm" variant="outline" icon={Pencil} requiredPermission={CONTENT_MANAGE_PERMISSION} onClick={() => setEditing(item)}>Edit</Button>
          {item.status === "published"
            ? <Button size="sm" variant="ghost" requiredPermission={CONTENT_MANAGE_PERMISSION} onClick={() => setPublicationState.mutate({ publicationId: item.id, nextStatus: "paused" })}>Pause</Button>
            : <Button size="sm" variant="ghost" icon={Send} requiredPermission={CONTENT_MANAGE_PERMISSION} onClick={() => setPublicationState.mutate({ publicationId: item.id, nextStatus: "published" })}>Publish</Button>}
        </div>
      ),
    },
  ], [setPublicationState.mutate]);

  if (placementsQuery.isLoading || publicationsQuery.isLoading) return <LoadingState label="Loading content workspace" />;
  if (placementsQuery.error || publicationsQuery.error) {
    return <ErrorState title="Content workspace unavailable" message={readError(placementsQuery.error ?? publicationsQuery.error)} onRetry={() => void refresh()} />;
  }

  const publishedCount = publications.filter((item) => item.status === "published").length;
  const scheduledCount = publications.filter((item) => Boolean(item.starts_at || item.ends_at)).length;
  const mediaCount = publications.filter((item) => Boolean(publicationMediaUrl(item) || item.media_asset_id)).length;

  return (
    <div className="content-v2">
      <AdminV2PageHeader
        eyebrow="Experience · Content"
        title="Brand & app content"
        description="Publish banners, onboarding content, brand media and customer-facing messages through a focused workflow. Technical placement setup stays separate."
        actions={(
          <>
            <Button icon={RefreshCcw} variant="outline" onClick={() => void refresh()}>Refresh</Button>
            <Button icon={Settings2} variant="outline" requiredPermission={CONTENT_MANAGE_PERMISSION} onClick={() => props.onNavigate("/experience/content/advanced")}>Advanced setup</Button>
            <Button icon={Plus} requiredPermission={CONTENT_MANAGE_PERMISSION} disabled={placements.length === 0} onClick={() => setEditing("new")}>New publication</Button>
          </>
        )}
      />

      <section className="skima-grid skima-grid--compact">
        <MetricTile label="Content surfaces" value={placements.length} icon={Target} tone="info" />
        <MetricTile label="Published" value={publishedCount} icon={Send} tone="success" />
        <MetricTile label="Scheduled" value={scheduledCount} icon={Megaphone} tone="warning" />
        <MetricTile label="With media" value={mediaCount} icon={ImagePlus} />
      </section>

      {placements.length === 0 ? (
        <ErrorState
          title="No content surfaces yet"
          message="Create the first technical placement in Advanced setup, then return here to publish content into it."
          onRetry={() => props.onNavigate("/experience/content/advanced")}
        />
      ) : (
        <div className="content-v2__layout">
          <section className="sk-panel">
            <div className="sk-panel__header"><div><h2>Where content appears</h2><p className="skima-muted">Choose a customer-facing surface to manage its publications.</p></div></div>
            <div className="content-v2__surface-list">
              {placements.map((placement) => {
                const count = publications.filter((item) => item.placement_key === placement.key).length;
                return (
                  <button
                    className={`content-v2__surface${activePlacement?.key === placement.key ? " is-active" : ""}`}
                    key={placement.id}
                    type="button"
                    onClick={() => { setActivePlacementKey(placement.key); setSelectedPublicationId(null); }}
                  >
                    <span><strong>{placement.display_name}</strong><small>{friendlySurface(placement.surface_key)}</small></span>
                    <StatusBadge tone={placement.status === "active" ? "success" : "warning"}>{count}</StatusBadge>
                  </button>
                );
              })}
            </div>
          </section>

          <div className="content-v2">
            <section className="sk-panel">
              <div className="sk-panel__header">
                <div><h2>{activePlacement?.display_name ?? "Content"}</h2><p className="skima-muted">{activePlacement ? friendlySurface(activePlacement.surface_key) : "Choose a surface"}</p></div>
                <Button icon={Plus} requiredPermission={CONTENT_MANAGE_PERMISSION} onClick={() => setEditing("new")}>Add content</Button>
              </div>
              <DataTable
                caption="Content publications"
                columns={columns}
                records={activePublications}
                getRowKey={(item) => item.id}
                emptyTitle="No content on this surface"
                emptyMessage="Add the first publication for this app surface."
              />
            </section>

            <PublicationPreview
              publication={selectedPublication}
              mediaUrl={selectedMediaUrl ?? mediaPreview.data?.signedUrl ?? null}
              loading={mediaPreview.isLoading}
              onEdit={() => selectedPublication ? setEditing(selectedPublication) : undefined}
            />
          </div>
        </div>
      )}

      {(setPublicationState.error) ? <StatusBadge tone="danger">{readError(setPublicationState.error)}</StatusBadge> : null}

      <PublicationDialog
        target={editing}
        placements={placements}
        defaultPlacementKey={activePlacement?.key ?? ""}
        api={api}
        ownerUserId={context?.user.id ?? null}
        supabase={supabase}
        onClose={() => setEditing(null)}
        onSaved={async () => { setEditing(null); await refresh(); }}
      />
    </div>
  );
}

function PublicationPreview(props: {
  publication: Publication | null;
  mediaUrl: string | null;
  loading: boolean;
  onEdit: () => void;
}) {
  if (!props.publication) return null;
  return (
    <section className="sk-panel">
      <div className="sk-panel__header">
        <div><h2>Preview</h2><p className="skima-muted">A compact content review before editing or publishing.</p></div>
        <Button variant="outline" icon={Pencil} requiredPermission={CONTENT_MANAGE_PERMISSION} onClick={props.onEdit}>Edit</Button>
      </div>
      <div className="content-v2__preview">
        <div className="content-v2__preview-media">
          {props.loading ? <LoadingState label="Loading media" /> : props.mediaUrl ? <img src={props.mediaUrl} alt={props.publication.accessibility_label ?? ""} /> : <ImagePlus aria-hidden="true" size={38} />}
        </div>
        <div className="content-v2__preview-copy">
          <StatusBadge tone={statusTone(props.publication.status)}>{normalizeStatusLabel(props.publication.status)}</StatusBadge>
          <h3>{props.publication.title || "Untitled content"}</h3>
          <p>{props.publication.body || "No supporting copy."}</p>
          <small className="content-v2__muted">Audience: {formatAudience(props.publication.audience_keys)}</small>
          <small className="content-v2__muted">Delivery: {formatSchedule(props.publication)}</small>
        </div>
      </div>
    </section>
  );
}

function PublicationDialog(props: {
  target: Publication | "new" | null;
  placements: Placement[];
  defaultPlacementKey: string;
  api: ApiGatewayClient;
  ownerUserId: string | null;
  supabase: SupabaseClient;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [step, setStep] = useState("surface");
  const [form, setForm] = useState<PublicationForm>(EMPTY_PUBLICATION);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const target = props.target;
  useEffect(() => {
    if (!target) return;
    setForm(target === "new"
      ? { ...EMPTY_PUBLICATION, placementKey: props.defaultPlacementKey }
      : publicationToForm(target));
    setPreviewUrl(target === "new" ? null : publicationMediaUrl(target));
    setStep("surface");
    setError(null);
  }, [target, props.defaultPlacementKey]);

  useEffect(() => () => {
    if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const uploadMedia = useMutation({
    mutationFn: (file: File) => uploadAdminContentMedia({ api: props.api, file, ownerUserId: props.ownerUserId, supabase: props.supabase }),
    onSuccess: (media) => {
      setPreviewUrl(media.publicUrl);
      setForm((current) => ({ ...current, mediaAssetId: media.mediaAssetId ?? current.mediaAssetId, mediaPublicUrl: media.publicUrl }));
    },
  });

  const save = useMutation({
    mutationFn: () => props.api.post(
      "/admin/content/publications",
      {
        accessibilityLabel: nullableText(form.accessibilityLabel),
        audienceKeys: listFromInput(form.audienceKeys, ["public"]),
        body: nullableText(form.body),
        cities: listFromInput(form.cities),
        countryCodes: listFromInput(form.countryCodes),
        ctaAction: readCtaAction(form),
        ctaLabel: nullableText(form.ctaLabel),
        endsAt: nullableIso(form.endsAt),
        mediaPublicUrl: nullableText(form.mediaPublicUrl),
        mediaAssetId: nullableText(form.mediaAssetId),
        metadata: nullableText(form.mediaPublicUrl) ? { media_public_url: nullableText(form.mediaPublicUrl) } : {},
        moduleKey: nullableText(form.moduleKey),
        organizationId: nullableText(form.organizationId),
        placementKey: form.placementKey,
        priority: Number.parseInt(form.priority, 10) || 0,
        publicationId: nullableText(form.publicationId),
        publicationKey: form.publicationKey.trim() || createPublicationKey(form.placementKey, form.title),
        regions: listFromInput(form.regions),
        startsAt: nullableIso(form.startsAt),
        status: form.status,
        title: nullableText(form.title),
      },
      MutationSchema,
    ),
    onSuccess: props.onSaved,
  });

  if (!target) return null;

  const activePlacement = props.placements.find((item) => item.key === form.placementKey) ?? null;
  const audienceOptionsForForm = audienceOptions.some((option) => option.value === form.audienceKeys)
    ? audienceOptions
    : [...audienceOptions, { label: `Custom: ${form.audienceKeys || "none"}`, value: form.audienceKeys }];

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.placementKey) { setError("Choose where this content should appear."); setStep("surface"); return; }
    if (uploadMedia.isPending) { setError("Wait for the image upload to finish."); setStep("creative"); return; }
    if (!form.title.trim() && !form.body.trim() && !form.mediaPublicUrl && !form.mediaAssetId) {
      setError("Add an image, title or supporting copy before saving.");
      setStep("creative");
      return;
    }
    setError(null);
    save.mutate();
  };

  return (
    <Dialog
      isOpen
      title={target === "new" ? "Create publication" : "Edit publication"}
      onClose={props.onClose}
      footer={<Button variant="ghost" onClick={props.onClose}>Cancel</Button>}
    >
      <form onSubmit={submit}>
        <AdminTaskFlow
          steps={publicationSteps}
          activeStep={step}
          onStepChange={(next) => { setStep(next); setError(null); }}
          disableNext={step === "surface" && !form.placementKey}
          footer={step === "publish" ? <Button type="submit" isLoading={save.isPending} disabled={uploadMedia.isPending}>Save publication</Button> : undefined}
        >
          {step === "surface" ? (
            <AdminFormSection title="Choose where it appears" description="Pick the existing app surface. Technical placement keys remain behind the normal workflow.">
              <SelectInput
                label="App surface"
                value={form.placementKey}
                options={[{ label: "Choose content surface", value: "" }, ...props.placements.map((item) => ({ label: item.display_name, value: item.key }))]}
                onChange={(event) => setForm({ ...form, placementKey: event.currentTarget.value })}
                required
              />
              {activePlacement ? <div className="content-v2__review-grid"><div><small>Surface</small><strong>{activePlacement.display_name}</strong></div><div><small>App location</small><strong>{friendlySurface(activePlacement.surface_key)}</strong></div></div> : null}
            </AdminFormSection>
          ) : null}

          {step === "creative" ? (
            <AdminFormSection title="Create the content" description="Keep mobile copy concise and attach the visual asset that belongs on this surface.">
              <div className="content-v2__upload">
                <strong>Image or visual asset</strong>
                <input
                  className="sk-input"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    const file = event.currentTarget.files?.[0];
                    if (!file) return;
                    const localPreview = URL.createObjectURL(file);
                    setPreviewUrl(localPreview);
                    uploadMedia.mutate(file);
                  }}
                />
                {previewUrl ? <img className="content-v2__upload-preview" src={previewUrl} alt="Content preview" /> : null}
                <small className="content-v2__muted">{uploadMedia.isPending ? "Uploading…" : form.mediaPublicUrl ? "Media uploaded and ready." : "Image upload is optional for text-only surfaces."}</small>
              </div>
              <TextInput label="Title" value={form.title} onChange={(event) => setForm({ ...form, title: event.currentTarget.value })} />
              <TextAreaInput label="Short copy" rows={4} value={form.body} onChange={(event) => setForm({ ...form, body: event.currentTarget.value })} />
              <details className="content-v2__advanced"><summary>Accessibility</summary><div><TextInput label="Image accessibility label" value={form.accessibilityLabel} onChange={(event) => setForm({ ...form, accessibilityLabel: event.currentTarget.value })} /></div></details>
            </AdminFormSection>
          ) : null}

          {step === "audience" ? (
            <AdminFormSection title="Choose the audience" description="Use common audiences here. Geographic and technical targeting stays under Advanced targeting.">
              <SelectInput label="Who should see this?" value={form.audienceKeys} options={audienceOptionsForForm} onChange={(event) => setForm({ ...form, audienceKeys: event.currentTarget.value })} />
              <details className="content-v2__advanced">
                <summary>Advanced targeting</summary>
                <div className="skima-form-grid">
                  <TextInput label="Audience keys" helperText="Comma separated only when a custom audience is required." value={form.audienceKeys} onChange={(event) => setForm({ ...form, audienceKeys: event.currentTarget.value })} />
                  <TextInput label="Module" value={form.moduleKey} onChange={(event) => setForm({ ...form, moduleKey: event.currentTarget.value })} />
                  <TextInput label="Countries" helperText="Comma separated ISO codes." value={form.countryCodes} onChange={(event) => setForm({ ...form, countryCodes: event.currentTarget.value })} />
                  <TextInput label="Regions" value={form.regions} onChange={(event) => setForm({ ...form, regions: event.currentTarget.value })} />
                  <TextInput label="Cities" value={form.cities} onChange={(event) => setForm({ ...form, cities: event.currentTarget.value })} />
                </div>
              </details>
            </AdminFormSection>
          ) : null}

          {step === "action" ? (
            <AdminFormSection title="What happens when users tap it?" description="Leave this empty for non-interactive brand or onboarding content.">
              <SelectInput label="Tap action" value={form.ctaType} options={ctaOptions} onChange={(event) => setForm({ ...form, ctaType: event.currentTarget.value })} />
              {form.ctaType ? (
                <div className="skima-form-grid">
                  <TextInput label="Button label" value={form.ctaLabel} onChange={(event) => setForm({ ...form, ctaLabel: event.currentTarget.value })} />
                  <TextInput label={form.ctaType === "url" ? "Web address" : "Destination"} value={form.ctaTarget} onChange={(event) => setForm({ ...form, ctaTarget: event.currentTarget.value })} />
                </div>
              ) : <p className="skima-muted">This content will display without a tap action.</p>}
            </AdminFormSection>
          ) : null}

          {step === "publish" ? (
            <AdminFormSection title="Review and publish" description="Confirm the surface, audience and delivery state. Scheduling and priority are optional advanced controls.">
              <div className="content-v2__review-grid">
                <div><small>Surface</small><strong>{activePlacement?.display_name ?? "Not selected"}</strong></div>
                <div><small>Audience</small><strong>{formatAudience(listFromInput(form.audienceKeys, ["public"]))}</strong></div>
                <div><small>Content</small><strong>{form.title.trim() || (form.mediaPublicUrl ? "Visual content" : "Text content")}</strong></div>
                <div><small>Action</small><strong>{form.ctaType ? form.ctaLabel || normalizeStatusLabel(form.ctaType) : "No tap action"}</strong></div>
              </div>
              <SelectInput label="Publication state" value={form.status} options={statusOptions} onChange={(event) => setForm({ ...form, status: event.currentTarget.value })} />
              <details className="content-v2__advanced">
                <summary>Schedule and technical controls</summary>
                <div className="skima-form-grid">
                  <TextInput label="Starts" type="datetime-local" value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.currentTarget.value })} />
                  <TextInput label="Ends" type="datetime-local" value={form.endsAt} onChange={(event) => setForm({ ...form, endsAt: event.currentTarget.value })} />
                  <TextInput label="Priority / carousel order" type="number" value={form.priority} onChange={(event) => setForm({ ...form, priority: event.currentTarget.value })} />
                  <TextInput label="Publication key" value={form.publicationKey} onChange={(event) => setForm({ ...form, publicationKey: event.currentTarget.value })} />
                </div>
              </details>
            </AdminFormSection>
          ) : null}

          {error || uploadMedia.error || save.error ? <StatusBadge tone="danger">{error ?? readError(uploadMedia.error ?? save.error)}</StatusBadge> : null}
        </AdminTaskFlow>
      </form>
    </Dialog>
  );
}

async function uploadAdminContentMedia(input: {
  api: ApiGatewayClient;
  file: File;
  ownerUserId: string | null;
  supabase: SupabaseClient;
}) {
  const contentType = input.file.type || "application/octet-stream";
  const upload = await input.api.post(
    "/runtime/media/upload-sessions",
    {
      contentType,
      fileName: input.file.name,
      idempotencyKey: createClientIdempotencyKey("admin.content.v2.media", input.file.name),
      storageBucket: "skima-product-content",
    },
    UploadSessionSchema,
  );
  const result = await input.supabase.storage
    .from(upload.storageBucket)
    .uploadToSignedUrl(upload.storagePath, upload.token, input.file, { contentType, upsert: true });
  if (result.error) throw new Error(result.error.message || "The media upload did not complete.");
  void input.ownerUserId;
  return { mediaAssetId: null, publicUrl: withCacheVersion(upload.publicUrl, input.file.lastModified) };
}

function publicationToForm(publication: Publication): PublicationForm {
  const action = publication.cta_action ?? {};
  return {
    publicationId: publication.id,
    publicationKey: publication.publication_key,
    placementKey: publication.placement_key,
    organizationId: publication.organization_id ?? "",
    moduleKey: publication.module_key ?? "",
    audienceKeys: publication.audience_keys.join(", ") || "public",
    countryCodes: publication.country_codes.join(", "),
    regions: publication.regions.join(", "),
    cities: publication.cities.join(", "),
    title: publication.title ?? "",
    body: publication.body ?? "",
    accessibilityLabel: publication.accessibility_label ?? "",
    ctaLabel: publication.cta_label ?? "",
    ctaType: recordString(action, "type") ?? "",
    ctaTarget: recordString(action, "value") ?? recordString(action, "target") ?? recordString(action, "href") ?? "",
    mediaAssetId: publication.media_asset_id ?? "",
    mediaPublicUrl: publicationMediaUrl(publication) ?? "",
    priority: String(publication.priority ?? 0),
    status: publication.status,
    startsAt: datetimeLocal(publication.starts_at ?? null),
    endsAt: datetimeLocal(publication.ends_at ?? null),
  };
}

function publicationMediaUrl(publication: Publication): string | null {
  const metadata = isRecord(publication.metadata) ? publication.metadata : {};
  return recordString(metadata, "media_public_url") ?? recordString(metadata, "mediaPublicUrl");
}

function readCtaAction(form: PublicationForm) {
  const type = form.ctaType.trim();
  const target = form.ctaTarget.trim();
  return type ? { type, target, value: target } : {};
}

function nullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}

function nullableIso(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function datetimeLocal(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 16);
}

function listFromInput(value: string, fallback: readonly string[] = []): string[] {
  const list = value.split(",").map((item) => item.trim()).filter(Boolean);
  return list.length ? Array.from(new Set(list)) : [...fallback];
}

function createPublicationKey(placementKey: string, title: string): string {
  const source = `${placementKey}.${title || "publication"}`;
  const normalized = source
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, ".")
    .replace(/\.{2,}/g, ".")
    .replace(/^[^a-z]+/, "")
    .replace(/[^a-z0-9]+$/, "");
  return `${normalized || "content.publication"}.${crypto.randomUUID().slice(0, 8)}`.slice(0, 150);
}

function formatAudience(audience: readonly string[]) {
  return audience.length ? audience.map((item) => normalizeStatusLabel(item)).join(", ") : "Public";
}

function formatSchedule(publication: Publication) {
  if (!publication.starts_at && !publication.ends_at) return publication.status === "published" ? "Live" : "No schedule";
  const start = publication.starts_at ? new Date(publication.starts_at).toLocaleDateString() : "Now";
  const end = publication.ends_at ? new Date(publication.ends_at).toLocaleDateString() : "No end";
  return `${start} → ${end}`;
}

function friendlySurface(value: string) {
  return value.replaceAll(".", " · ").replaceAll("_", " ");
}

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (["active", "published"].includes(status)) return "success";
  if (["draft", "inactive", "paused"].includes(status)) return "warning";
  if (status === "retired") return "danger";
  return "neutral";
}

function recordString(record: PlatformRecord | null | undefined, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is PlatformRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withCacheVersion(url: string, version: number): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("v", String(version || Date.now()));
    return parsed.toString();
  } catch {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}v=${encodeURIComponent(String(version || Date.now()))}`;
  }
}

function readError(error: unknown) {
  return error instanceof Error && error.message.trim() ? error.message : "The content action could not be completed. Please try again.";
}
