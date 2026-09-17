import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, ImagePlus, Palette, RefreshCcw, Save } from "lucide-react";
import { useEffect, useState, type ChangeEvent } from "react";
import { z } from "zod";

import { createClientIdempotencyKey } from "@skima/frontend-core";
import {
  Button,
  ErrorState,
  LoadingState,
  PageHeader,
  SelectInput,
  StatusBadge,
  TextAreaInput,
  TextInput,
} from "@skima/ui";

import { AdminWorkspaceIntro, AdminWorkspaceSections } from "./admin-workspace-sections";
import { useSessionState } from "./session";

const BrandingSchema = z.object({
  version: z.number(),
  enabled: z.boolean(),
  backgroundColor: z.string(),
  logoLightUrl: z.string().nullable(),
  logoDarkUrl: z.string().nullable(),
  backgroundImageUrl: z.string().nullable(),
  logoSize: z.number(),
  logoPlacement: z.enum(["top", "center", "bottom"]),
  tagline: z.string().nullable(),
  displayDurationMs: z.number(),
  updatedAt: z.string().nullable(),
});

const UploadSchema = z.object({
  token: z.string(),
  publicUrl: z.string().url(),
  storageBucket: z.string(),
  storagePath: z.string(),
  method: z.literal("PUT"),
});

type Branding = z.infer<typeof BrandingSchema>;
type BrandingSection = "appearance" | "images" | "preview";

export function AdminStartupBrandingWorkspace() {
  const { context, supabase, api } = useSessionState();
  const client = useQueryClient();
  const [section, setSection] = useState<BrandingSection>("appearance");
  const [form, setForm] = useState<Branding | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const allowed = context?.platformAdmin?.admin_kind === "super_admin";

  const query = useQuery({
    queryKey: ["startup-branding"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_active_startup_branding");
      if (error) throw error;
      return BrandingSchema.parse(data);
    },
  });

  useEffect(() => {
    if (query.data) setForm(query.data);
  }, [query.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!form) throw new Error("Startup screen settings are unavailable.");
      const { data, error } = await supabase.rpc("configure_startup_branding", {
        target_enabled: form.enabled,
        target_background_color: form.backgroundColor,
        target_logo_light_url: form.logoLightUrl,
        target_logo_dark_url: form.logoDarkUrl,
        target_background_image_url: form.backgroundImageUrl,
        target_logo_size: form.logoSize,
        target_logo_placement: form.logoPlacement,
        target_tagline: form.tagline,
        target_display_duration_ms: form.displayDurationMs,
        target_change_reason: "Updated from App Branding",
        target_idempotency_key: createClientIdempotencyKey("admin.startup-branding", String(Date.now())),
      });
      if (error) throw error;
      return BrandingSchema.parse(data);
    },
    onSuccess: async (data) => {
      setForm(data);
      setNotice("Startup screen saved. Mobile users will receive it automatically.");
      await client.invalidateQueries({ queryKey: ["startup-branding"] });
    },
  });

  const upload = async (
    kind: "logoLightUrl" | "logoDarkUrl" | "backgroundImageUrl",
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    if (file.type !== "image/png" && !file.name.toLowerCase().endsWith(".png")) {
      setNotice("Choose a PNG image.");
      return;
    }

    setUploading(kind);
    setNotice(null);
    try {
      const request = await api.post(
        "/runtime/media/upload-sessions",
        {
          contentType: "image/png",
          fileName: file.name,
          idempotencyKey: createClientIdempotencyKey("admin.startup-branding.upload", `${kind}:${file.name}`),
          storageBucket: "skima-product-content",
        },
        UploadSchema,
      );
      const result = await supabase.storage
        .from(request.storageBucket)
        .uploadToSignedUrl(request.storagePath, request.token, file, {
          contentType: "image/png",
          upsert: true,
        });
      if (result.error) throw result.error;
      setForm((current) => current ? { ...current, [kind]: `${request.publicUrl}?v=${file.lastModified}` } : current);
      setNotice("PNG uploaded. Open Preview, then save when you are satisfied.");
    } catch (error) {
      setNotice(readError(error));
    } finally {
      setUploading(null);
    }
  };

  if (!allowed) {
    return <ErrorState title="Startup branding restricted" message="Only the Super Admin can change application startup branding." />;
  }
  if (query.isLoading || !form) return <LoadingState label="Loading startup branding" />;
  if (query.error) {
    return <ErrorState title="Startup branding unavailable" message={readError(query.error)} onRetry={() => void query.refetch()} />;
  }

  const patch = (next: Partial<Branding>) => setForm((current) => current ? { ...current, ...next } : current);

  return (
    <>
      <PageHeader
        eyebrow="Experience · App Branding"
        title="Startup Screen"
        description="Change one part of the launch screen at a time, then preview it before saving. Updates reach users without rebuilding the app."
        actions={(
          <>
            <Button icon={RefreshCcw} variant="outline" onClick={() => void query.refetch()}>Refresh</Button>
            <Button icon={Save} disabled={Boolean(uploading)} isLoading={save.isPending} onClick={() => save.mutate()}>
              Save changes
            </Button>
          </>
        )}
      />

      <AdminWorkspaceSections
        compact
        label="App branding sections"
        activeKey={section}
        onChange={(key) => setSection(key as BrandingSection)}
        sections={[
          { key: "appearance", label: "Appearance", description: "Colour, size, position and timing.", icon: Palette },
          { key: "images", label: "Images", description: "Logos and optional background image.", icon: ImagePlus },
          { key: "preview", label: "Preview", description: "Check the final startup presentation.", icon: Eye },
        ]}
      />

      {notice ? (
        <StatusBadge tone={save.error ? "danger" : "success"} className="skima-status-note">{notice}</StatusBadge>
      ) : null}
      {save.error ? <StatusBadge tone="danger">{readError(save.error)}</StatusBadge> : null}

      {section === "appearance" ? (
        <section className="sk-panel stack-md">
          <AdminWorkspaceIntro
            kicker="Step 1"
            title="Startup appearance"
            description="Set the basic presentation first. Image uploads are kept in the next step so this form stays short on mobile."
          />
          <label className="skima-checkbox-row">
            <input type="checkbox" checked={form.enabled} onChange={(event) => patch({ enabled: event.currentTarget.checked })} />
            <span>Show custom startup screen</span>
          </label>
          <div className="skima-form-grid">
            <TextInput
              label="Background colour"
              type="color"
              value={form.backgroundColor}
              onChange={(event) => patch({ backgroundColor: event.currentTarget.value })}
            />
            <TextInput
              label="Logo size"
              type="number"
              min={48}
              max={320}
              value={String(form.logoSize)}
              onChange={(event) => patch({ logoSize: Number(event.currentTarget.value) })}
            />
            <SelectInput
              label="Logo placement"
              value={form.logoPlacement}
              options={[
                { label: "Top", value: "top" },
                { label: "Centre", value: "center" },
                { label: "Bottom", value: "bottom" },
              ]}
              onChange={(event) => patch({ logoPlacement: event.currentTarget.value as Branding["logoPlacement"] })}
            />
            <TextInput
              label="Display time (milliseconds)"
              type="number"
              min={250}
              max={5000}
              value={String(form.displayDurationMs)}
              onChange={(event) => patch({ displayDurationMs: Number(event.currentTarget.value) })}
            />
            <TextAreaInput
              label="Optional tagline"
              value={form.tagline ?? ""}
              onChange={(event) => patch({ tagline: event.currentTarget.value || null })}
            />
          </div>
          <div className="skima-action-row">
            <Button variant="outline" onClick={() => setSection("images")}>Next: choose images</Button>
          </div>
        </section>
      ) : null}

      {section === "images" ? (
        <section className="sk-panel stack-md">
          <AdminWorkspaceIntro
            kicker="Step 2"
            title="Startup images"
            description="Upload only the assets you want to replace. If an image is unavailable, the bundled SKIMA mark remains the safe fallback."
          />
          <AssetInput label="Logo for light backgrounds" currentUrl={form.logoLightUrl} busy={uploading === "logoLightUrl"} onChange={(event) => void upload("logoLightUrl", event)} />
          <AssetInput label="Logo for dark backgrounds" currentUrl={form.logoDarkUrl} busy={uploading === "logoDarkUrl"} onChange={(event) => void upload("logoDarkUrl", event)} />
          <AssetInput label="Optional background image" currentUrl={form.backgroundImageUrl} busy={uploading === "backgroundImageUrl"} onChange={(event) => void upload("backgroundImageUrl", event)} />
          <div className="skima-action-row">
            <Button variant="outline" onClick={() => setSection("appearance")}>Back</Button>
            <Button onClick={() => setSection("preview")}>Next: preview</Button>
          </div>
        </section>
      ) : null}

      {section === "preview" ? (
        <section className="sk-panel stack-md">
          <AdminWorkspaceIntro
            kicker="Step 3"
            title="Preview"
            description="Check the result before saving. Native launch branding remains the stable bundled SKIMA fallback."
          />
          <div
            style={{
              minHeight: 420,
              borderRadius: 24,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: form.logoPlacement === "top" ? "flex-start" : form.logoPlacement === "bottom" ? "flex-end" : "center",
              padding: 40,
              backgroundColor: form.backgroundColor,
              backgroundImage: form.backgroundImageUrl ? `url(${form.backgroundImageUrl})` : undefined,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          >
            {form.logoLightUrl ? (
              <img src={form.logoLightUrl} alt="Startup logo preview" style={{ width: form.logoSize, maxWidth: "80%", objectFit: "contain" }} />
            ) : (
              <strong style={{ fontSize: 42, letterSpacing: 4, color: "white" }}>SKIMA<span style={{ color: "#ED1C2E" }}>.</span></strong>
            )}
            {form.tagline ? <p style={{ color: "white", textAlign: "center", fontWeight: 700 }}>{form.tagline}</p> : null}
          </div>
          <div className="skima-action-row">
            <Button variant="outline" onClick={() => setSection("images")}>Back to images</Button>
            <Button icon={Save} disabled={Boolean(uploading)} isLoading={save.isPending} onClick={() => save.mutate()}>Save startup screen</Button>
          </div>
        </section>
      ) : null}
    </>
  );
}

function AssetInput({
  label,
  currentUrl,
  busy,
  onChange,
}: {
  label: string;
  currentUrl: string | null;
  busy: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className="sk-panel stack-sm">
      <strong>{label}</strong>
      <span className="skima-muted">{busy ? "Uploading PNG…" : currentUrl ? "Image uploaded. Choose another PNG to replace it." : "Choose a PNG image"}</span>
      <input type="file" accept="image/png,.png" disabled={busy} onChange={onChange} />
    </label>
  );
}

function readError(error: unknown) {
  return error instanceof Error ? error.message : "The startup branding action could not be completed.";
}
