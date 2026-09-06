import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Eye,
  Flame,
  Home,
  ImagePlus,
  Images,
  type LucideIcon,
  Megaphone,
  MonitorSmartphone,
  PackageCheck,
  PauseCircle,
  Pencil,
  Plus,
  QrCode,
  RefreshCcw,
  Send,
  Target,
  Truck,
  UploadCloud,
} from "lucide-react";
import { type ChangeEvent, type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
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
  readonly mediaPublicUrl: string;
  readonly priority: string;
  readonly status: string;
  readonly startsAt: string;
  readonly endsAt: string;
}

interface ContentSurfacePreset {
  readonly key: string;
  readonly label: string;
  readonly surface: string;
  readonly description: string;
  readonly recommendedSize: string;
  readonly icon: LucideIcon;
  readonly placementKey: string;
  readonly placementDisplayName: string;
  readonly placementSurfaceKey: string;
  readonly placementContentKind: string;
  readonly placementAudiences: string;
  readonly publicationKey: string;
  readonly title: string;
  readonly body: string;
  readonly moduleKey: string;
  readonly audienceKeys: string;
  readonly ctaLabel: string;
  readonly ctaType: string;
  readonly ctaTarget: string;
  readonly priority: string;
  readonly publicationMode?: "fixed" | "unique";
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
  mediaPublicUrl: "",
  priority: "0",
  status: "draft",
  startsAt: "",
  endsAt: "",
};

const CONTENT_MANAGE_PERMISSION = "platform.content.manage";

const contentSurfacePresets: readonly ContentSurfacePreset[] = [
  {
    key: "primary-logo",
    label: "App logo",
    surface: "Header brand logo",
    description: "Shown on welcome, sign in, create account, forgot password, reset password, and full app headers.",
    recommendedSize: "Transparent PNG/WebP/SVG, 900×300px or 3:1",
    icon: ImagePlus,
    placementKey: "mobile.brand.logo.primary",
    placementDisplayName: "Primary mobile brand",
    placementSurfaceKey: "mobile.global.header",
    placementContentKind: "brand",
    placementAudiences: "public, customer, driver, station",
    publicationKey: "content.brand.primary.admin",
    title: "SKIMA",
    body: "",
    moduleKey: "",
    audienceKeys: "public, customer, driver, station",
    ctaLabel: "",
    ctaType: "",
    ctaTarget: "",
    priority: "500",
    publicationMode: "fixed",
  },
  {
    key: "compact-logo",
    label: "Compact SKIMA logo",
    surface: "Compact SKIMA logo",
    description: "Shown in compact customer, driver, station, and admin headers when the smaller SKIMA logo is needed.",
    recommendedSize: "Transparent PNG/WebP/SVG, 512×512px or 1:1",
    icon: MonitorSmartphone,
    placementKey: "mobile.brand.logo.compact",
    placementDisplayName: "Compact mobile brand",
    placementSurfaceKey: "mobile.global.compact-header",
    placementContentKind: "brand",
    placementAudiences: "public, customer, driver, station",
    publicationKey: "content.brand.compact.admin",
    title: "S",
    body: "",
    moduleKey: "",
    audienceKeys: "public, customer, driver, station",
    ctaLabel: "",
    ctaType: "",
    ctaTarget: "",
    priority: "500",
    publicationMode: "fixed",
  },
  {
    key: "customer-home-banner",
    label: "Add home banner",
    surface: "Customer home carousel",
    description: "Adds one scrollable customer home banner. Create more than one to fill the sideways carousel.",
    recommendedSize: "WebP/PNG, 1920×840px or 16:7",
    icon: Megaphone,
    placementKey: "mobile.home.promotion",
    placementDisplayName: "Mobile home promotion",
    placementSurfaceKey: "mobile.customer.home",
    placementContentKind: "promotion",
    placementAudiences: "customer",
    publicationKey: "content.home.promotion.admin",
    title: "Your refill, handled end to end",
    body: "Register once, request in a few taps and follow your cylinder all the way home.",
    moduleKey: "lpg",
    audienceKeys: "customer",
    ctaLabel: "Request a refill",
    ctaType: "route",
    ctaTarget: "/(customer)/orders/new",
    priority: "500",
    publicationMode: "unique",
  },
  {
    key: "welcome-hero",
    label: "Welcome fallback",
    surface: "Fallback welcome image",
    description: "Optional fallback image used only when a specific onboarding slide has no image yet.",
    recommendedSize: "WebP/PNG, 1600×1200px or 4:3",
    icon: Images,
    placementKey: "mobile.welcome.hero",
    placementDisplayName: "Welcome introduction",
    placementSurfaceKey: "mobile.auth.welcome",
    placementContentKind: "onboarding",
    placementAudiences: "public",
    publicationKey: "content.welcome.hero.admin",
    title: "Gas refill, without the runaround",
    body: "A smoother way to request, refill, track, and receive your cylinder.",
    moduleKey: "lpg",
    audienceKeys: "public",
    ctaLabel: "",
    ctaType: "",
    ctaTarget: "",
    priority: "500",
    publicationMode: "fixed",
  },
  {
    key: "onboarding-request",
    label: "Slide 1 — Request",
    surface: "Welcome onboarding stage 1",
    description: "First onboarding image: customer starts a cylinder refill request.",
    recommendedSize: "WebP/PNG, 1600×1200px or 4:3",
    icon: PackageCheck,
    placementKey: "mobile.onboarding.customer.request",
    placementDisplayName: "Customer onboarding - request",
    placementSurfaceKey: "mobile.auth.onboarding",
    placementContentKind: "onboarding",
    placementAudiences: "public, customer",
    publicationKey: "content.onboarding.customer.request.admin",
    title: "Request your refill",
    body: "Choose your cylinder and tell us where to collect it.",
    moduleKey: "lpg",
    audienceKeys: "public, customer",
    ctaLabel: "",
    ctaType: "",
    ctaTarget: "",
    priority: "500",
    publicationMode: "fixed",
  },
  {
    key: "onboarding-pickup",
    label: "Slide 2 — Pickup",
    surface: "Welcome onboarding stage 2",
    description: "Second onboarding image: verified driver collects the customer's cylinder.",
    recommendedSize: "WebP/PNG, 1600×1200px or 4:3",
    icon: Truck,
    placementKey: "mobile.onboarding.customer.pickup",
    placementDisplayName: "Customer onboarding - pickup",
    placementSurfaceKey: "mobile.auth.onboarding",
    placementContentKind: "onboarding",
    placementAudiences: "public, customer",
    publicationKey: "content.onboarding.customer.pickup.admin",
    title: "We collect it",
    body: "A verified driver collects your cylinder at the arranged time.",
    moduleKey: "lpg",
    audienceKeys: "public, customer",
    ctaLabel: "",
    ctaType: "",
    ctaTarget: "",
    priority: "500",
    publicationMode: "fixed",
  },
  {
    key: "onboarding-track",
    label: "Slide 3 — Track",
    surface: "Welcome onboarding stage 3",
    description: "Third onboarding image: QR/cylinder identity and live progress tracking.",
    recommendedSize: "WebP/PNG, 1600×1200px or 4:3",
    icon: QrCode,
    placementKey: "mobile.onboarding.customer.track",
    placementDisplayName: "Customer onboarding - track",
    placementSurfaceKey: "mobile.auth.onboarding",
    placementContentKind: "onboarding",
    placementAudiences: "public, customer",
    publicationKey: "content.onboarding.customer.track.admin",
    title: "Identified and tracked",
    body: "Your cylinder is checked at every hand-off, and you can follow its journey.",
    moduleKey: "lpg",
    audienceKeys: "public, customer",
    ctaLabel: "",
    ctaType: "",
    ctaTarget: "",
    priority: "500",
    publicationMode: "fixed",
  },
  {
    key: "onboarding-refill",
    label: "Slide 4 — Refill",
    surface: "Welcome onboarding stage 4",
    description: "Fourth onboarding image: partner station refills and verifies the cylinder.",
    recommendedSize: "WebP/PNG, 1600×1200px or 4:3",
    icon: Flame,
    placementKey: "mobile.onboarding.customer.refill",
    placementDisplayName: "Customer onboarding - refill",
    placementSurfaceKey: "mobile.auth.onboarding",
    placementContentKind: "onboarding",
    placementAudiences: "public, customer",
    publicationKey: "content.onboarding.customer.refill.admin",
    title: "Refilled by a partner station",
    body: "A trusted station refills your cylinder and confirms the amount supplied.",
    moduleKey: "lpg",
    audienceKeys: "public, customer",
    ctaLabel: "",
    ctaType: "",
    ctaTarget: "",
    priority: "500",
    publicationMode: "fixed",
  },
  {
    key: "onboarding-return",
    label: "Slide 5 — Return",
    surface: "Welcome onboarding stage 5",
    description: "Fifth onboarding image: the same cylinder is returned safely to the customer.",
    recommendedSize: "WebP/PNG, 1600×1200px or 4:3",
    icon: Home,
    placementKey: "mobile.onboarding.customer.return",
    placementDisplayName: "Customer onboarding - return",
    placementSurfaceKey: "mobile.auth.onboarding",
    placementContentKind: "onboarding",
    placementAudiences: "public, customer",
    publicationKey: "content.onboarding.customer.return.admin",
    title: "Returned to your door",
    body: "Your driver brings the same identified cylinder safely back to you.",
    moduleKey: "lpg",
    audienceKeys: "public, customer",
    ctaLabel: "",
    ctaType: "",
    ctaTarget: "",
    priority: "500",
    publicationMode: "fixed",
  },
];

export function AdminContentWorkspace() {
  const { api, context, status, supabase } = useSessionState();
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
  const selectedPublicMediaUrl = selectedPublication ? publicationMediaUrl(selectedPublication) : null;

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
    enabled: status === "authenticated" && Boolean(selectedMediaAssetId) && !selectedPublicMediaUrl,
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
    mutationFn: async () => {
      await ensurePresetPlacement({
        api,
        existingPlacements: placements,
        placementKey: publicationForm.placementKey,
      });

      return api.post(
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
          mediaPublicUrl: nullableText(publicationForm.mediaPublicUrl),
          mediaAssetId: nullableText(publicationForm.mediaAssetId),
          metadata: nullableText(publicationForm.mediaPublicUrl)
            ? { media_public_url: nullableText(publicationForm.mediaPublicUrl) }
            : {},
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
      );
    },
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
        supabase,
      }),
    onSuccess: (media) => {
      setUploadPreviewUrl(media.publicUrl);
      setPublicationForm((current) => ({
        ...current,
        mediaAssetId: media.mediaAssetId ?? current.mediaAssetId,
        mediaPublicUrl: media.publicUrl,
      }));
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

  const openPresetPublicationDialog = (preset: ContentSurfacePreset) => {
    const existingPublication = findPresetPublication(preset, publications);

    if (existingPublication && preset.publicationMode !== "unique") {
      setActivePlacementKey(preset.placementKey);
      setSelectedPublicationId(existingPublication.id);
      openPublicationDialog(existingPublication);
      return;
    }

    setFormError(null);
    setUploadPreviewUrl(null);
    setActivePlacementKey(preset.placementKey);
    setSelectedPublicationId(null);
    setPublicationForm({
      ...emptyPublication,
      audienceKeys: preset.audienceKeys,
      body: preset.body,
      ctaLabel: preset.ctaLabel,
      ctaTarget: preset.ctaTarget,
      ctaType: preset.ctaType,
      moduleKey: preset.moduleKey,
      placementKey: preset.placementKey,
      priority: preset.priority,
      publicationKey: createPresetPublicationKey(preset),
      status: "published",
      title: preset.title,
    });
    setDialog({ type: "publication" });
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
  const mediaCount = publications.filter((publication) =>
    Boolean(publication.media_asset_id) || Boolean(publicationMediaUrl(publication))
  ).length;
  const publicationPlacementOptions = buildPlacementOptions(placements, publicationForm.placementKey);
  const activeFormPreset = contentSurfacePresets.find((preset) => preset.placementKey === publicationForm.placementKey) ?? null;
  const activePlacementPreset = contentSurfacePresets.find((preset) => preset.placementKey === activePlacement?.key) ?? null;
  const ActiveFormIcon = activeFormPreset?.icon;

  return (
    <>
      <PageHeader
        eyebrow="Brand, onboarding & promotions"
        title="Brand & App Content"
        description="Manage the SKIMA logos, banners, onboarding screens, empty-state messages, and other app content without changing code."
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

      <section className="sk-panel admin-content-media-workbench">
        <div className="sk-panel__header">
          <div>
            <p className="admin-section-kicker">Quick upload slots</p>
            <h2>App logo, banners and 5 welcome slides</h2>
          </div>
          <StatusBadge tone="info">Admin managed</StatusBadge>
        </div>
        <div className="admin-content-presets">
          {contentSurfacePresets.map((preset) => {
            const Icon = preset.icon;
            const presetPublications = publications.filter((publication) => publication.placement_key === preset.placementKey);
            const currentPublication = findPresetPublication(preset, publications) ?? sortContentPublications(presetPublications)[0] ?? null;
            const currentMediaUrl = findPublicationMediaUrl(presetPublications) ??
              (currentPublication ? publicationMediaUrl(currentPublication) : null);
            const publishedForSlot = presetPublications.filter((publication) => publication.status === "published").length;
            const isCarousel = preset.publicationMode === "unique";
            return (
              <button
                className="admin-content-preset-card"
                key={preset.key}
                type="button"
                onClick={() => openPresetPublicationDialog(preset)}
              >
                <span className="admin-content-presets__icon"><Icon aria-hidden="true" /></span>
                <span className="admin-content-preset-card__copy">
                  <strong>{preset.label}</strong>
                  <small>{preset.surface}</small>
                  <em>{preset.description}</em>
                  <span>{preset.recommendedSize}</span>
                </span>
                <span className={`admin-content-preset-card__preview${currentMediaUrl ? " has-media" : ""}`}>
                  <AdminPreviewImage
                    alt=""
                    fallback={<ImagePlus aria-hidden="true" />}
                    url={currentMediaUrl}
                  />
                </span>
                <span className="admin-content-preset-card__meta">
                  {isCarousel
                    ? `${publishedForSlot} banner${publishedForSlot === 1 ? "" : "s"} live`
                    : currentMediaUrl
                    ? "Image connected"
                    : "Needs image"}
                </span>
              </button>
            );
          })}
        </div>
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
            <div className="admin-inline-actions">
              {activePlacementPreset?.publicationMode === "unique" ? (
                <Button
                  icon={Plus}
                  requiredPermission={CONTENT_MANAGE_PERMISSION}
                  onClick={() => openPresetPublicationDialog(activePlacementPreset)}
                >
                  Add another banner
                </Button>
              ) : null}
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
          mediaUrl={uploadPreviewUrl ?? (selectedPublication ? publicationMediaUrl(selectedPublication) : null) ?? mediaPreviewQuery.data?.signedUrl ?? null}
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
              disabled={uploadMedia.isPending}
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
            if (uploadMedia.isPending) {
              setFormError("Wait for the image upload to finish before saving.");
              return;
            }
            if (activeFormPreset && !publicationForm.mediaPublicUrl && !publicationForm.mediaAssetId) {
              setFormError(`Upload an image for ${activeFormPreset.label} before saving.`);
              return;
            }
            setFormError(null);
            savePublication.mutate();
          }}
        >
          {activeFormPreset ? (
            <div className="admin-content-slot-hint">
              <span className="admin-content-slot-hint__icon">
                {ActiveFormIcon ? <ActiveFormIcon aria-hidden="true" /> : null}
              </span>
              <span>
                <strong>{activeFormPreset.label}</strong>
                <small>{activeFormPreset.description}</small>
                <em>{activeFormPreset.recommendedSize}</em>
              </span>
            </div>
          ) : null}

          <div className="admin-content-upload">
            <label htmlFor="admin-content-media">Upload image for this app slot</label>
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
                  : publicationForm.mediaPublicUrl
                  ? "Image uploaded and ready for app delivery."
                  : "Choose the image file for this logo, banner, or slide."}
              </span>
            </div>
          </div>

          <div className="admin-form-grid">
            <TextInput
              label="Title"
              name="title"
              helperText="Shown on banners and onboarding slides. Leave short for clean mobile UI."
              value={publicationForm.title}
              onChange={(event) => setPublicationForm({ ...publicationForm, title: event.currentTarget.value })}
            />
            <SelectInput
              label="Status"
              name="status"
              value={publicationForm.status}
              options={publicationStatusOptions}
              onChange={(event) => setPublicationForm({ ...publicationForm, status: event.currentTarget.value })}
            />
          </div>

          <TextAreaInput
            label="Short copy"
            name="body"
            rows={3}
            value={publicationForm.body}
            onChange={(event) => setPublicationForm({ ...publicationForm, body: event.currentTarget.value })}
          />

          <TextInput
            label="Public image URL"
            name="mediaPublicUrl"
            helperText="Filled automatically after upload. The app reads this URL."
            value={publicationForm.mediaPublicUrl}
            onChange={(event) => setPublicationForm({ ...publicationForm, mediaPublicUrl: event.currentTarget.value })}
          />

          <div className="admin-form-grid">
            <TextInput
              label="Priority / carousel order"
              name="priority"
              type="number"
              helperText="Higher priority appears first."
              value={publicationForm.priority}
              onChange={(event) => setPublicationForm({ ...publicationForm, priority: event.currentTarget.value })}
            />
            <TextInput
              label="CTA route"
              name="ctaTarget"
              helperText="Controls where the banner arrow navigates, for example /(customer)/orders/new."
              value={publicationForm.ctaTarget}
              onChange={(event) => setPublicationForm({
                ...publicationForm,
                ctaTarget: event.currentTarget.value,
                ctaType: event.currentTarget.value.trim() && !publicationForm.ctaType ? "route" : publicationForm.ctaType,
              })}
            />
          </div>

          <details className="admin-content-advanced">
            <summary>Advanced targeting and routing</summary>
            <div className="admin-form-grid">
              <TextInput
                label="Publication key"
                name="publicationKey"
                helperText="Fixed slots update the same publication. Carousel banners use unique keys."
                value={publicationForm.publicationKey}
                onChange={(event) => setPublicationForm({ ...publicationForm, publicationKey: event.currentTarget.value })}
              />
              <SelectInput
                label="Placement"
                name="placementKey"
                value={publicationForm.placementKey}
                options={publicationPlacementOptions}
                onChange={(event) => setPublicationForm({ ...publicationForm, placementKey: event.currentTarget.value })}
                required
              />
            </div>

            <div className="admin-form-grid">
              <TextInput
                label="Audience keys"
                name="audienceKeys"
                value={publicationForm.audienceKeys}
                onChange={(event) => setPublicationForm({ ...publicationForm, audienceKeys: event.currentTarget.value })}
              />
              <TextInput
                label="Module key"
                name="moduleKey"
                value={publicationForm.moduleKey}
                onChange={(event) => setPublicationForm({ ...publicationForm, moduleKey: event.currentTarget.value })}
              />
            </div>

            <div className="admin-form-grid">
              <SelectInput
                label="CTA action"
                name="ctaType"
                value={publicationForm.ctaType}
                options={ctaOptions}
                onChange={(event) => setPublicationForm({ ...publicationForm, ctaType: event.currentTarget.value })}
              />
              <div />
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

            <div className="admin-form-grid">
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
            </div>

            <TextInput
              label="Media asset id"
              helperText="Optional legacy media asset id."
              name="mediaAssetId"
              value={publicationForm.mediaAssetId}
              onChange={(event) => setPublicationForm({ ...publicationForm, mediaAssetId: event.currentTarget.value })}
            />
          </details>

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
          ? (
            <AdminPreviewImage
              alt={props.publication.accessibility_label ?? props.publication.title ?? ""}
              fallback={
                <div className="admin-content-preview-fallback">
                  <Eye aria-hidden="true" />
                  <span>Image URL unavailable</span>
                </div>
              }
              url={props.mediaUrl}
            />
          )
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

function AdminPreviewImage(props: {
  readonly alt: string;
  readonly fallback: ReactNode;
  readonly url: string | null;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (!props.url || failedUrl === props.url) {
    return <>{props.fallback}</>;
  }

  return (
    <img
      alt={props.alt}
      src={props.url}
      onError={() => setFailedUrl(props.url)}
    />
  );
}

function findPresetPublication(
  preset: ContentSurfacePreset,
  publications: readonly PublicationRecord[],
): PublicationRecord | null {
  if (preset.publicationMode === "unique") return null;

  const matching = publications.filter((publication) => publication.placement_key === preset.placementKey);
  return matching.find((publication) => publication.publication_key === preset.publicationKey) ??
    sortContentPublications(matching)[0] ??
    null;
}

function sortContentPublications(publications: readonly PublicationRecord[]): PublicationRecord[] {
  return [...publications].sort((left, right) =>
    (right.priority ?? 0) - (left.priority ?? 0) ||
    (right.revision ?? 0) - (left.revision ?? 0) ||
    Date.parse(right.published_at ?? right.updated_at ?? right.created_at ?? "") -
      Date.parse(left.published_at ?? left.updated_at ?? left.created_at ?? ""),
  );
}

function findPublicationMediaUrl(publications: readonly PublicationRecord[]): string | null {
  for (const publication of sortContentPublications(publications)) {
    const mediaUrl = publicationMediaUrl(publication);
    if (mediaUrl) return mediaUrl;
  }

  return null;
}

function createPresetPublicationKey(preset: ContentSurfacePreset): string {
  if (preset.publicationMode !== "unique") return preset.publicationKey;
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return `${preset.publicationKey}.${suffix}`;
}

function buildPlacementOptions(
  placements: readonly PlacementRecord[],
  currentPlacementKey: string,
) {
  const options = placements.map((placement) => ({
    label: placement.display_name,
    value: placement.key,
  }));

  if (currentPlacementKey && !options.some((option) => option.value === currentPlacementKey)) {
    const preset = contentSurfacePresets.find((candidate) => candidate.placementKey === currentPlacementKey);
    options.push({
      label: preset?.placementDisplayName ?? currentPlacementKey,
      value: currentPlacementKey,
    });
  }

  return options;
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

async function uploadAdminContentMedia(input: {
  readonly api: ApiGatewayClient;
  readonly assetTypeKey: string;
  readonly file: File;
  readonly ownerUserId: string | null;
  readonly supabase: SupabaseClient;
}) {
  const contentType = input.file.type || "application/octet-stream";
  const idempotencyKey = createClientIdempotencyKey("admin.content.media", input.file.name);
  const upload = await input.api.post(
    "/runtime/media/upload-sessions",
    {
      contentType,
      fileName: input.file.name,
      idempotencyKey,
      storageBucket: "skima-product-content",
    },
    UploadSessionSchema,
  );

  const uploadResult = await input.supabase.storage
    .from(upload.storageBucket)
    .uploadToSignedUrl(upload.storagePath, upload.token, input.file, {
      contentType,
      upsert: true,
    });

  if (uploadResult.error) {
    throw new Error(uploadResult.error.message || "The media upload did not complete.");
  }

  void input.assetTypeKey;
  void input.ownerUserId;

  return {
    mediaAssetId: null,
    publicUrl: withCacheVersion(upload.publicUrl, input.file.lastModified),
  };
}

async function ensurePresetPlacement(input: {
  readonly api: ApiGatewayClient;
  readonly existingPlacements: readonly PlacementRecord[];
  readonly placementKey: string;
}) {
  if (input.existingPlacements.some((placement) => placement.key === input.placementKey)) {
    return;
  }

  const preset = contentSurfacePresets.find((candidate) => candidate.placementKey === input.placementKey);
  if (!preset) return;

  await input.api.post(
    "/admin/content/placements",
    {
      allowedAudiences: listFromInput(preset.placementAudiences, ["public"]),
      constraints: {},
      contentKind: preset.placementContentKind,
      displayName: preset.placementDisplayName,
      key: preset.placementKey,
      metadata: { adminPreset: preset.key },
      status: "active",
      surfaceKey: preset.placementSurfaceKey,
    },
    MutationSchema,
  );
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
    ctaTarget: recordString(ctaAction, "value") ?? recordString(ctaAction, "target") ?? recordString(ctaAction, "href") ?? "",
    mediaAssetId: publication.media_asset_id ?? "",
    mediaPublicUrl: publicationMediaUrl(publication) ?? "",
    priority: String(publication.priority ?? 0),
    status: publication.status,
    startsAt: datetimeLocal(publication.starts_at ?? null),
    endsAt: datetimeLocal(publication.ends_at ?? null),
  };
}

function publicationMediaUrl(publication: PublicationRecord): string | null {
  const metadata = isRecord(publication.metadata) ? publication.metadata : {};
  return recordString(metadata, "media_public_url") ?? recordString(metadata, "mediaPublicUrl");
}

function readCtaAction(form: PublicationFormState) {
  const type = form.ctaType.trim();
  const target = form.ctaTarget.trim();
  return type ? { type, target, value: target } : {};
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

function isRecord(value: unknown): value is PlatformRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : "The request could not be completed.";
}
