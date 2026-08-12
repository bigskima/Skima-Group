import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Eye,
  ImagePlus,
  Megaphone,
  MonitorSmartphone,
  PauseCircle,
  Pencil,
  Plus,
  RefreshCcw,
  Send,
  Target,
  UploadCloud,
} from "lucide-react";
import { type ChangeEvent, type FormEvent, useEffect, useMemo, useState } from "react";
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
  PageHeader,
  SelectInput,
  StatusBadge,
  type TableColumn,
  TextAreaInput,
  TextInput,
} from "@skima/ui";

import { useSessionState } from "./session";
import "./admin-content-workspace.css";

const PlacementSchema = z.object({
  id: z.string(),
  key: z.string(),
  display_name: z.string(),
  surface_key: z.string(),
  content_kind: z.string(),
  allowed_audiences: z.array(z.string()),
  status: z.string(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
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
  priority: z.number(),
  revision: z.number(),
  status: z.string(),
  starts_at: z.string().nullable().optional(),
  ends_at: z.string().nullable().optional(),
  published_at: z.string().nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
}).passthrough();

const UploadSessionSchema = z.object({
  signedUrl: z.string().url(),
  method: z.literal("PUT"),
  storageBucket: z.string(),
  storagePath: z.string(),
});

const MediaReadSessionSchema = z.object({
  signedUrl: z.string().url(),
});

const PlacementArraySchema = z.array(PlacementSchema);
const PublicationArraySchema = z.array(PublicationSchema);
const MutationSchema = z.union([z.string(), z.record(z.unknown()), z.null()]);

type PlacementRecord = z.infer<typeof PlacementSchema>;
type PublicationRecord = z.infer<typeof PublicationSchema>;
type PlatformRecord = Readonly<Record<string, unknown>>;

type ContentDialog =
  | { readonly type: "placement"; readonly placement?: PlacementRecord }
  | { readonly type: "publication"; readonly publication?: PublicationRecord }
  | null;

interface PlacementFormState {
  readonly key: string;
  readonly displayName: string;
  readonly surfaceKey: string;
  readonly contentKind: string;
  readonly allowedAudiences: string;
  readonly status: string;
}

interface PublicationFormState {
  readonly publicationId: string;
  readonly publicationKey: string;
  readonly placementKey: string;
  readonly organizationId: string;
  readonly moduleKey: string;
  readonly audienceKeys: string;
  readonly countryCodes: string;
  readonly regions: string;
  readonly cities: string;
  readonly title: string;
  readonly body: string;
  readonly accessibilityLabel: string;
  readonly ctaLabel: string;
  readonly ctaType: string;
  readonly ctaTarget: string;
  readonly mediaAssetId: string;
  readonly priority: string;
  readonly status: string;
  readonly startsAt: string;
  readonly endsAt: string;
}

const emptyPlacement: PlacementFormState = {
  key: "",
  displayName: "",
  surfaceKey: "mobile.home.banner",
  contentKind: "promotion",
  allowedAudiences: "public, customer, driver, station",
  status: "active",
};

const emptyPublication: PublicationFormState = {
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
  priority: "0",
  status: "draft",
  startsAt: "",
  endsAt: "",
};

const CONTENT_MANAGE_PERMISSION = "platform.content.manage";

export function AdminContentWorkspace() {
  const { api, context, status } = useSessionState();
  const queryClient = useQueryClient();
  const [activePlacementKey, setActivePlacementKey] = useState<string | null>(null);
  const [selectedPublicationId, setSelectedPublicationId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<ContentDialog>(null);
  const [placementForm, setPlacementForm] = useState<PlacementFormState>(emptyPlacement);
  const [publicationForm, setPublicationForm] = useState<PublicationFormState>(emptyPublication);
  const [formError, setFormError] = useState<string | null>(null);
  const [uploadPreviewUrl, setUploadPreviewUrl] = useState<string | null>(null);

  const placementsQuery = useQuery({
    queryKey: ["admin-content", "placements"],
    queryFn: () => api.get("/admin/content/placements", PlacementArraySchema),
    enabled: status === "authenticated",
  });

  const publicationsQuery = useQuery({
    queryKey: ["admin-content", "publications"],
    queryFn: () => api.get("/admin/content/publications", PublicationArraySchema),
    enabled: status === "authenticated",
  });

  const placements = placementsQuery.data ?? [];
  const publications = publicationsQuery.data ?? [];
  const activePlacement = placements.find((placement) => placement.key === activePlacementKey) ??
    placements[0] ?? null;
  const activePlacementPublications = publications.filter((publication) =>
    !activePlacement || publication.placement_key === activePlacement.key
  );
  const selectedPublication = useMemo(
    () => publications.find((publication) => publication.id === selectedPublicationId) ??
      activePlacementPublications[0] ?? null,
    [activePlacementPublications, publications, selectedPublicationId],
  );
  const selectedMediaAssetId = selectedPublication?.media_asset_id ?? null;

  const mediaPreviewQuery = useQuery({
    queryKey: ["admin-content", "media-preview", selectedMediaAssetId],
    queryFn: () =>
      api.post(
        "/runtime/media/read-sessions",
        {
          assetId: selectedMediaAssetId,
          idempotencyKey: createClientIdempotencyKey("admin.content.preview", selectedMediaAssetId ?? undefined),
        },
        MediaReadSessionSchema,
      ),
    enabled: status === "authenticated" && Boolean(selectedMediaAssetId),
    retry: false,
  });

  useEffect(() => {
    if (!activePlacementKey && placements[0]) {
      setActivePlacementKey(placements[0].key);
    }
  }, [activePlacementKey, placements]);

  useEffect(() => {
    if (!selectedPublicationId && activePlacementPublications[0]) {
      setSelectedPublicationId(activePlacementPublications[0].id);
    }
  }, [activePlacementPublications, selectedPublicationId]);

  useEffect(() => () => {
    if (uploadPreviewUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(uploadPreviewUrl);
    }
  }, [uploadPreviewUrl]);

  const savePlacement = useMutation({
    mutationFn: () =>
      api.post(
        "/admin/content/placements",
        {
          allowedAudiences: listFromInput(placementForm.allowedAudiences, ["public"]),
          constraints: {},
          contentKind: placementForm.contentKind,
          displayName: placementForm.displayName.trim(),
          key: placementForm.key.trim(),
          metadata: {},
          status: placementForm.status,
          surfaceKey: placementForm.surfaceKey.trim(),
        },
        MutationSchema,
      ),
    onSuccess: async () => {
      setDialog(null);
      setFormError(null);
      await queryClient.invalidateQueries({ queryKey: ["admin-content"] });
    },
  });

  const savePublication = useMutation({
    mutationFn: () =>
      api.post(
        "/admin/content/publications",
        {
          accessibilityLabel: nullableText(publicationForm.accessibilityLabel),
          audienceKeys: listFromInput(publicationForm.audienceKeys, ["public"]),
          body: nullableText(publicationForm.body),
          cities: listFromInput(publicationForm.cities),
          countryCodes: listFromInput(publicationForm.countryCodes),
          ctaAction: readCtaAction(publicationForm),
          ctaLabel: nullableText(publicationForm.ctaLabel),
          endsAt: nullableIso(publicationForm.endsAt),
          mediaAssetId: nullableText(publicationForm.mediaAssetId),
          metadata: {},
          moduleKey: nullableText(publicationForm.moduleKey),
          organizationId: nullableText(publicationForm.organizationId),
          placementKey: publicationForm.placementKey,
          priority: Number.parseInt(publicationForm.priority, 10) || 0,
          publicationId: nullableText(publicationForm.publicationId),
          publicationKey: publicationForm.publicationKey.trim() ||
            createPublicationKey(publicationForm.placementKey, publicationForm.title),
          regions: listFromInput(publicationForm.regions),
          startsAt: nullableIso(publicationForm.startsAt),
          status: publicationForm.status,
          title: nullableText(publicationForm.title),
        },
        MutationSchema,
      ),
    onSuccess: async () => {
      setDialog(null);
      setFormError(null);
      await queryClient.invalidateQueries({ queryKey: ["admin-content"] });
    },
  });

  const uploadMedia = useMutation({
    mutationFn: (file: File) =>
      uploadAdminContentMedia({
        api,
        assetTypeKey: "content.publication.media",
        file,
        ownerUserId: context?.user.id ?? null,
      }),
    onSuccess: (assetId) => {
      setPublicationForm((current) => ({ ...current, mediaAssetId: assetId }));
    },
  });

  const setPublicationState = useMutation({
    mutationFn: (input: { readonly publicationId: string; readonly status: string }) =>
      api.post(
        "/admin/content/publications/state",
        {
          idempotencyKey: createClientIdempotencyKey(`admin.content.${input.status}`, input.publicationId),
          publicationId: input.publicationId,
          reason: `Admin set publication to ${input.status}.`,
          status: input.status,
        },
        MutationSchema,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-content"] });
    },
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["admin-content"] });

  const openPlacementDialog = (placement?: PlacementRecord) => {
    setFormError(null);
    setPlacementForm(placement
      ? {
        key: placement.key,
        displayName: placement.display_name,
        surfaceKey: placement.surface_key,
        contentKind: placement.content_kind,
        allowedAudiences: placement.allowed_audiences.join(", "),
        status: placement.status,
      }
      : emptyPlacement);
    setDialog({ type: "placement", placement });
  };

  const openPublicationDialog = (publication?: PublicationRecord) => {
    setFormError(null);
    setUploadPreviewUrl(null);
    setPublicationForm(publication
      ? publicationToForm(publication)
      : {
        ...emptyPublication,
        placementKey: activePlacement?.key ?? placements[0]?.key ?? "",
      });
    setDialog({ type: "publication", publication });
  };

  const columns = useMemo(
    () => buildPublicationColumns(openPublicationDialog, setPublicationState.mutate, setSelectedPublicationId),
    [setPublicationState.mutate],
  );

  if (placementsQuery.isLoading || publicationsQuery.isLoading) {
    return <LoadingState label="Loading content controls" />;
  }

  if (placementsQuery.error || publicationsQuery.error) {
    return (
      <ErrorState
        title="Content workspace unavailable"
        message={readError(placementsQuery.error ?? publicationsQuery.error)}
        onRetry={refresh}
      />
    );
  }

  const publishedCount = publications.filter((publication) => publication.status === "published").length;
  const scheduledCount = publications.filter((publication) => Boolean(publication.starts_at)).length;
  const mediaCount = publications.filter((publication) => Boolean(publication.media_asset_id)).length;

  return (
    <>
      <PageHeader
        eyebrow="Brand, onboarding & promotions"
        title="Content operations"
        description="Control app logos, promotion banners, onboarding panels, empty states, and targeted product content from governed placements."
        actions={
          <>
            <Button icon={RefreshCcw} variant="outline" onClick={refresh}>Refresh</Button>
            <Button
              icon={MonitorSmartphone}
              variant="outline"
              requiredPermission={CONTENT_MANAGE_PERMISSION}
              onClick={() => openPlacementDialog()}
            >
              New placement
            </Button>
            <Button
              icon={Plus}
              requiredPermission={CONTENT_MANAGE_PERMISSION}
              onClick={() => openPublicationDialog()}
            >
              New publication
            </Button>
          </>
        }
      />

      <section className="skima-grid skima-grid--compact">
        <MetricTile label="Placements" value={placements.length} icon={Target} tone="info" />
        <MetricTile label="Published" value={publishedCount} icon={Send} tone="success" />
        <MetricTile label="Scheduled" value={scheduledCount} icon={Megaphone} tone="warning" />
        <MetricTile label="Media linked" value={mediaCount} icon={ImagePlus} />
      </section>

      {(savePlacement.error || savePublication.error || uploadMedia.error || setPublicationState.error)
        ? (
          <div className="admin-content-notice is-error" role="alert">
            {readError(savePlacement.error ?? savePublication.error ?? uploadMedia.error ?? setPublicationState.error)}
          </div>
        )
        : null}

      <div className="admin-content-layout">
        <section className="sk-panel admin-content-placements">
          <div className="sk-panel__header">
            <div>
              <p className="admin-section-kicker">Placement map</p>
              <h2>Surfaces</h2>
            </div>
            <StatusBadge>{String(placements.length)}</StatusBadge>
          </div>
          <div className="admin-content-placement-list">
            {placements.map((placement) => (
              <button
                key={placement.id}
                className={`admin-content-placement${activePlacement?.key === placement.key ? " is-active" : ""}`}
                type="button"
                onClick={() => {
                  setActivePlacementKey(placement.key);
                  setSelectedPublicationId(null);
                }}
              >
                <span>
                  <strong>{placement.display_name}</strong>
                  <small>{placement.surface_key}</small>
                </span>
                <StatusBadge tone={statusTone(placement.status)}>
                  {normalizeStatusLabel(placement.status)}
                </StatusBadge>
              </button>
            ))}
            {placements.length === 0
              ? <div className="admin-empty-compact">Create the first placement to publish app content.</div>
              : null}
          </div>
        </section>

        <section className="sk-panel admin-content-publications">
          <div className="sk-panel__header">
            <div>
              <p className="admin-section-kicker">Publication queue</p>
              <h2>{activePlacement?.display_name ?? "All publications"}</h2>
            </div>
            <Button
              icon={Pencil}
              variant="outline"
              requiredPermission={CONTENT_MANAGE_PERMISSION}
              disabled={!activePlacement}
              onClick={() => activePlacement ? openPlacementDialog(activePlacement) : undefined}
            >
              Edit placement
            </Button>
          </div>
          <DataTable
            caption="Content publications"
            columns={columns}
            records={activePlacementPublications}
            getRowKey={(record) => record.id}
            emptyTitle="No publications"
            emptyMessage="This placement does not have any content yet."
          />
        </section>

        <PublicationInspector
          mediaUrl={uploadPreviewUrl ?? mediaPreviewQuery.data?.signedUrl ?? null}
          publication={selectedPublication}
          placement={placements.find((placement) => placement.key === selectedPublication?.placement_key) ?? null}
          previewLoading={mediaPreviewQuery.isLoading}
          onEdit={() => selectedPublication ? openPublicationDialog(selectedPublication) : undefined}
        />
      </div>

      <Dialog
        title={dialog?.type === "placement" && dialog.placement ? "Edit placement" : "New placement"}
        isOpen={dialog?.type === "placement"}
        onClose={() => setDialog(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
            <Button
              form="admin-content-placement-form"
              type="submit"
              isLoading={savePlacement.isPending}
              requiredPermission={CONTENT_MANAGE_PERMISSION}
            >
              Save placement
            </Button>
          </>
        }
      >
        <form
          id="admin-content-placement-form"
          className="skima-form"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            if (!placementForm.key.trim() || !placementForm.displayName.trim() || !placementForm.surfaceKey.trim()) {
              setFormError("Placement key, name, and surface are required.");
              return;
            }
            setFormError(null);
            savePlacement.mutate();
          }}
        >
          <div className="admin-form-grid">
            <TextInput
              label="Placement key"
              name="key"
              value={placementForm.key}
              onChange={(event) => setPlacementForm({ ...placementForm, key: event.currentTarget.value })}
              required
            />
            <TextInput
              label="Display name"
              name="displayName"
              value={placementForm.displayName}
              onChange={(event) => setPlacementForm({ ...placementForm, displayName: event.currentTarget.value })}
              required
            />
          </div>
          <div className="admin-form-grid">
            <TextInput
              label="Surface key"
              name="surfaceKey"
              value={placementForm.surfaceKey}
              onChange={(event) => setPlacementForm({ ...placementForm, surfaceKey: event.currentTarget.value })}
              required
            />
            <SelectInput
              label="Content kind"
              name="contentKind"
              value={placementForm.contentKind}
              options={contentKindOptions}
              onChange={(event) => setPlacementForm({ ...placementForm, contentKind: event.currentTarget.value })}
            />
          </div>
          <div className="admin-form-grid">
            <TextInput
              label="Allowed audiences"
              name="allowedAudiences"
              helperText="Comma separated audience keys."
              value={placementForm.allowedAudiences}
              onChange={(event) => setPlacementForm({ ...placementForm, allowedAudiences: event.currentTarget.value })}
            />
            <SelectInput
              label="Status"
              name="status"
              value={placementForm.status}
              options={placementStatusOptions}
              onChange={(event) => setPlacementForm({ ...placementForm, status: event.currentTarget.value })}
            />
          </div>
          {formError ? <p className="admin-form-error">{formError}</p> : null}
        </form>
      </Dialog>

      <Dialog
        title={dialog?.type === "publication" && dialog.publication ? "Edit publication" : "New publication"}
        isOpen={dialog?.type === "publication"}
        onClose={() => setDialog(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
            <Button
              form="admin-content-publication-form"
              type="submit"
              isLoading={savePublication.isPending}
              requiredPermission={CONTENT_MANAGE_PERMISSION}
            >
              Save publication
            </Button>
          </>
        }
      >
        <form
          id="admin-content-publication-form"
          className="skima-form admin-content-form"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            if (!publicationForm.placementKey) {
              setFormError("Choose a placement before saving this publication.");
              return;
            }
            setFormError(null);
            savePublication.mutate();
          }}
        >
          <div className="admin-form-grid">
            <TextInput
              label="Publication key"
              name="publicationKey"
              helperText="Leave blank to generate one from the title."
              value={publicationForm.publicationKey}
              onChange={(event) => setPublicationForm({ ...publicationForm, publicationKey: event.currentTarget.value })}
            />
            <SelectInput
              label="Placement"
              name="placementKey"
              value={publicationForm.placementKey}
              options={placements.map((placement) => ({ label: placement.display_name, value: placement.key }))}
              onChange={(event) => setPublicationForm({ ...publicationForm, placementKey: event.currentTarget.value })}
              required
            />
          </div>

          <div className="admin-form-grid">
            <TextInput
              label="Title"
              name="title"
              value={publicationForm.title}
              onChange={(event) => setPublicationForm({ ...publicationForm, title: event.currentTarget.value })}
            />
            <TextInput
              label="Audience keys"
              name="audienceKeys"
              value={publicationForm.audienceKeys}
              onChange={(event) => setPublicationForm({ ...publicationForm, audienceKeys: event.currentTarget.value })}
            />
          </div>

          <TextAreaInput
            label="Body"
            name="body"
            rows={4}
            value={publicationForm.body}
            onChange={(event) => setPublicationForm({ ...publicationForm, body: event.currentTarget.value })}
          />

          <div className="admin-form-grid">
            <TextInput
              label="CTA label"
              name="ctaLabel"
              value={publicationForm.ctaLabel}
              onChange={(event) => setPublicationForm({ ...publicationForm, ctaLabel: event.currentTarget.value })}
            />
            <SelectInput
              label="CTA action"
              name="ctaType"
              value={publicationForm.ctaType}
              options={ctaOptions}
              onChange={(event) => setPublicationForm({ ...publicationForm, ctaType: event.currentTarget.value })}
            />
          </div>

          <TextInput
            label="CTA target"
            name="ctaTarget"
            value={publicationForm.ctaTarget}
            onChange={(event) => setPublicationForm({ ...publicationForm, ctaTarget: event.currentTarget.value })}
          />

          <div className="admin-content-upload">
            <label htmlFor="admin-content-media">Media</label>
            <input
              id="admin-content-media"
              className="sk-input"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                const file = event.currentTarget.files?.[0];
                if (!file) return;
                const previewUrl = URL.createObjectURL(file);
                setUploadPreviewUrl(previewUrl);
                uploadMedia.mutate(file);
              }}
            />
            <div className="admin-content-upload__status">
              <UploadCloud aria-hidden="true" />
              <span>
                {uploadMedia.isPending
                  ? "Uploading media"
                  : publicationForm.mediaAssetId
                  ? `Media asset: ${publicationForm.mediaAssetId}`
                  : "Upload an image or paste an existing media asset id below."}
              </span>
            </div>
          </div>

          <TextInput
            label="Media asset id"
            name="mediaAssetId"
            value={publicationForm.mediaAssetId}
            onChange={(event) => setPublicationForm({ ...publicationForm, mediaAssetId: event.currentTarget.value })}
          />

          <div className="admin-form-grid admin-form-grid--thirds">
            <SelectInput
              label="Status"
              name="status"
              value={publicationForm.status}
              options={publicationStatusOptions}
              onChange={(event) => setPublicationForm({ ...publicationForm, status: event.currentTarget.value })}
            />
            <TextInput
              label="Priority"
              name="priority"
              type="number"
              value={publicationForm.priority}
              onChange={(event) => setPublicationForm({ ...publicationForm, priority: event.currentTarget.value })}
            />
            <TextInput
              label="Module key"
              name="moduleKey"
              value={publicationForm.moduleKey}
              onChange={(event) => setPublicationForm({ ...publicationForm, moduleKey: event.currentTarget.value })}
            />
          </div>

          <div className="admin-form-grid">
            <TextInput
              label="Starts"
              name="startsAt"
              type="datetime-local"
              value={publicationForm.startsAt}
              onChange={(event) => setPublicationForm({ ...publicationForm, startsAt: event.currentTarget.value })}
            />
            <TextInput
              label="Ends"
              name="endsAt"
              type="datetime-local"
              value={publicationForm.endsAt}
              onChange={(event) => setPublicationForm({ ...publicationForm, endsAt: event.currentTarget.value })}
            />
          </div>

          <div className="admin-form-grid">
            <TextInput
              label="Countries"
              name="countryCodes"
              helperText="Comma separated ISO country codes."
              value={publicationForm.countryCodes}
              onChange={(event) => setPublicationForm({ ...publicationForm, countryCodes: event.currentTarget.value })}
            />
            <TextInput
              label="Cities"
              name="cities"
              value={publicationForm.cities}
              onChange={(event) => setPublicationForm({ ...publicationForm, cities: event.currentTarget.value })}
            />
          </div>

          <TextInput
            label="Regions"
            name="regions"
            value={publicationForm.regions}
            onChange={(event) => setPublicationForm({ ...publicationForm, regions: event.currentTarget.value })}
          />

          <TextInput
            label="Accessibility label"
            name="accessibilityLabel"
            value={publicationForm.accessibilityLabel}
            onChange={(event) => setPublicationForm({ ...publicationForm, accessibilityLabel: event.currentTarget.value })}
          />

          {formError || uploadMedia.error
            ? <p className="admin-form-error">{formError ?? readError(uploadMedia.error)}</p>
            : null}
        </form>
      </Dialog>
    </>
  );
}

const contentKindOptions = [
  { label: "Brand", value: "brand" },
  { label: "Onboarding", value: "onboarding" },
  { label: "Promotion", value: "promotion" },
  { label: "Safety", value: "safety" },
  { label: "Empty state", value: "empty_state" },
  { label: "Illustration", value: "illustration" },
  { label: "Service", value: "service" },
] as const;

const placementStatusOptions = [
  { label: "Active", value: "active" },
  { label: "Inactive", value: "inactive" },
  { label: "Retired", value: "retired" },
] as const;

const publicationStatusOptions = [
  { label: "Draft", value: "draft" },
  { label: "Published", value: "published" },
  { label: "Paused", value: "paused" },
  { label: "Retired", value: "retired" },
] as const;

const ctaOptions = [
  { label: "No action", value: "" },
  { label: "Open route", value: "route" },
  { label: "Open URL", value: "url" },
  { label: "Open application", value: "application" },
] as const;

function buildPublicationColumns(
  openEditor: (publication: PublicationRecord) => void,
  setState: (input: { readonly publicationId: string; readonly status: string }) => void,
  selectPublication: (publicationId: string) => void,
): TableColumn<PublicationRecord>[] {
  return [
    {
      key: "content",
      header: "Content",
      minWidth: "220px",
      render: (record) => (
        <button
          type="button"
          className="admin-content-title-button"
          onClick={() => selectPublication(record.id)}
        >
          <strong>{record.title || record.publication_key}</strong>
          <small>{record.publication_key}</small>
        </button>
      ),
    },
    {
      key: "audience",
      header: "Audience",
      render: (record) => record.audience_keys.join(", ") || "public",
    },
    {
      key: "status",
      header: "Status",
      render: (record) => (
        <StatusBadge tone={statusTone(record.status)}>
          {normalizeStatusLabel(record.status)}
        </StatusBadge>
      ),
    },
    {
      key: "priority",
      header: "Priority",
      align: "right",
      render: (record) => String(record.priority ?? 0),
    },
    {
      key: "updated",
      header: "Updated",
      render: (record) => formatDate(record.updated_at ?? record.created_at ?? null),
    },
    {
      key: "actions",
      header: "Control",
      minWidth: "220px",
      render: (record) => (
        <div className="admin-inline-actions">
          <Button
            size="sm"
            icon={Pencil}
            variant="outline"
            requiredPermission={CONTENT_MANAGE_PERMISSION}
            onClick={() => openEditor(record)}
          >
            Edit
          </Button>
          {record.status === "published"
            ? (
              <Button
                size="sm"
                icon={PauseCircle}
                variant="ghost"
                requiredPermission={CONTENT_MANAGE_PERMISSION}
                onClick={() => setState({ publicationId: record.id, status: "paused" })}
              >
                Pause
              </Button>
            )
            : (
              <Button
                size="sm"
                icon={Send}
                variant="ghost"
                requiredPermission={CONTENT_MANAGE_PERMISSION}
                onClick={() => setState({ publicationId: record.id, status: "published" })}
              >
                Publish
              </Button>
            )}
          <Button
            size="sm"
            icon={Archive}
            variant="ghost"
            requiredPermission={CONTENT_MANAGE_PERMISSION}
            onClick={() => setState({ publicationId: record.id, status: "retired" })}
          >
            Retire
          </Button>
        </div>
      ),
    },
  ];
}

function PublicationInspector(props: {
  readonly publication: PublicationRecord | null;
  readonly placement: PlacementRecord | null;
  readonly mediaUrl: string | null;
  readonly previewLoading: boolean;
  readonly onEdit: () => void;
}) {
  if (!props.publication) {
    return (
      <section className="sk-panel admin-content-inspector">
        <div className="admin-empty-compact">Select a publication to preview it.</div>
      </section>
    );
  }

  return (
    <section className="sk-panel admin-content-inspector">
      <div className="sk-panel__header">
        <div>
          <p className="admin-section-kicker">Preview</p>
          <h2>{props.publication.title || "Untitled content"}</h2>
        </div>
        <Button
          icon={Pencil}
          variant="outline"
          requiredPermission={CONTENT_MANAGE_PERMISSION}
          onClick={props.onEdit}
        >
          Edit
        </Button>
      </div>
      <div className="admin-content-preview-frame">
        {props.previewLoading
          ? <LoadingState label="Loading media" />
          : props.mediaUrl
          ? <img src={props.mediaUrl} alt={props.publication.accessibility_label ?? props.publication.title ?? ""} />
          : (
            <div className="admin-content-preview-fallback">
              <Eye aria-hidden="true" />
              <span>No image attached</span>
            </div>
          )}
      </div>
      <div className="admin-content-preview-copy">
        <StatusBadge tone={statusTone(props.publication.status)}>
          {normalizeStatusLabel(props.publication.status)}
        </StatusBadge>
        <strong>{props.publication.title || props.publication.publication_key}</strong>
        {props.publication.body ? <p>{props.publication.body}</p> : null}
        {props.publication.cta_label ? <button type="button">{props.publication.cta_label}</button> : null}
      </div>
      <dl className="admin-content-inspector-list">
        <div>
          <dt>Placement</dt>
          <dd>{props.placement?.display_name ?? props.publication.placement_key}</dd>
        </div>
        <div>
          <dt>Audience</dt>
          <dd>{props.publication.audience_keys.join(", ") || "public"}</dd>
        </div>
        <div>
          <dt>Schedule</dt>
          <dd>{formatSchedule(props.publication)}</dd>
        </div>
        <div>
          <dt>Revision</dt>
          <dd>{props.publication.revision ?? 1}</dd>
        </div>
      </dl>
    </section>
  );
}

async function uploadAdminContentMedia(input: {
  readonly api: ApiGatewayClient;
  readonly assetTypeKey: string;
  readonly file: File;
  readonly ownerUserId: string | null;
}) {
  const contentType = input.file.type || "application/octet-stream";
  const idempotencyKey = createClientIdempotencyKey("admin.content.media", input.file.name);
  const upload = await input.api.post(
    "/runtime/media/upload-sessions",
    {
      contentType,
      fileName: input.file.name,
      idempotencyKey,
      storageBucket: "skima-platform-media",
    },
    UploadSessionSchema,
  );

  const uploadResponse = await fetch(upload.signedUrl, {
    body: input.file,
    headers: { "content-type": contentType },
    method: upload.method,
  });

  if (!uploadResponse.ok) {
    throw new Error("The media upload did not complete.");
  }

  const registered = await input.api.post(
    "/runtime/media/assets",
    {
      assetTypeKey: input.assetTypeKey,
      byteSize: input.file.size,
      contentType,
      idempotencyKey: `${idempotencyKey}:asset`,
      metadata: { originalFileName: input.file.name, purpose: "admin.content" },
      ownerUserId: input.ownerUserId,
      source: "skima.admin.content",
      storageBucket: upload.storageBucket,
      storagePath: upload.storagePath,
    },
    MutationSchema,
  );

  if (typeof registered === "string") return registered;
  const id = recordString(registered as PlatformRecord, "id");
  if (!id) throw new Error("The media service did not return an asset id.");
  return id;
}

function publicationToForm(publication: PublicationRecord): PublicationFormState {
  const ctaAction = publication.cta_action ?? {};
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
    ctaType: recordString(ctaAction, "type") ?? "",
    ctaTarget: recordString(ctaAction, "target") ?? recordString(ctaAction, "href") ?? "",
    mediaAssetId: publication.media_asset_id ?? "",
    priority: String(publication.priority ?? 0),
    status: publication.status,
    startsAt: datetimeLocal(publication.starts_at ?? null),
    endsAt: datetimeLocal(publication.ends_at ?? null),
  };
}

function readCtaAction(form: PublicationFormState) {
  const type = form.ctaType.trim();
  const target = form.ctaTarget.trim();
  return type ? { type, target } : {};
}

function nullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
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
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 16);
}

function listFromInput(value: string, fallback: readonly string[] = []): string[] {
  const list = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
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

function formatDate(value: string | null): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatSchedule(publication: PublicationRecord): string {
  if (!publication.starts_at && !publication.ends_at) return "Always available";
  return `${formatDate(publication.starts_at ?? null)} to ${formatDate(publication.ends_at ?? null)}`;
}

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (["active", "published"].includes(status)) return "success";
  if (["draft", "inactive", "paused"].includes(status)) return "warning";
  if (["retired"].includes(status)) return "danger";
  return "neutral";
}

function recordString(record: PlatformRecord | null | undefined, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : "The request could not be completed.";
}
