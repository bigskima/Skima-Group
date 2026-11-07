import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, Link2, Plus, RefreshCcw, Share2 } from "lucide-react";
import { z } from "zod";

import {
  Button,
  DataTable,
  ErrorState,
  LoadingState,
  MetricTile,
  PageHeader,
  StatusBadge,
  TextInput,
  type TableColumn,
} from "@skima/ui";
import { useSessionState } from "../../session";

const DirectoryRowSchema = z.object({
  platform_key: z.string(),
  platform_name: z.string(),
  icon_key: z.string(),
  icon_url: z.string().nullable(),
  profile_id: z.string().uuid().nullable(),
  display_name: z.string().nullable(),
  handle: z.string().nullable(),
  profile_url: z.string().nullable(),
  target_surfaces: z.array(z.string()).nullable(),
  sort_order: z.number().nullable(),
  is_active: z.boolean().nullable(),
});
const DirectorySchema = z.array(DirectoryRowSchema);
type DirectoryRow = z.infer<typeof DirectoryRowSchema>;

type ProfileForm = {
  platformKey: string;
  platformName: string;
  iconKey: string;
  iconUrl: string;
  displayName: string;
  handle: string;
  profileUrl: string;
  surfaces: string;
  sortOrder: string;
};
const EMPTY_FORM: ProfileForm = {
  platformKey: "",
  platformName: "",
  iconKey: "globe",
  iconUrl: "",
  displayName: "",
  handle: "",
  profileUrl: "",
  surfaces: "all",
  sortOrder: "100",
};

function parseSurfaces(value: string): string[] {
  const surfaces = [...new Set(value.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean))];
  return surfaces.length ? surfaces : ["all"];
}
function secureUrl(value: string): boolean {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

export function SocialDirectoryWorkspace() {
  const { supabase } = useSessionState();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ProfileForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");

  const directory = useQuery({
    queryKey: ["admin-social-directory"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_social_admin_directory");
      if (error) throw error;
      return DirectorySchema.parse(data ?? []);
    },
  });

  const rows = directory.data ?? [];
  const activeCount = rows.filter((row) => row.profile_id && row.is_active).length;
  const platformCount = useMemo(() => new Set(rows.map((row) => row.platform_key)).size, [rows]);

  const saveProfile = useMutation({
    mutationFn: async (input: ProfileForm & { profileId: string | null }) => {
      const platformKey = input.platformKey.trim().toLowerCase().replace(/\s+/g, "-");
      const displayName = input.displayName.trim();
      const profileUrl = input.profileUrl.trim();
      const sortOrder = Number.parseInt(input.sortOrder, 10);
      const surfaces = parseSurfaces(input.surfaces);
      if (!/^[a-z][a-z0-9_-]{0,31}$/.test(platformKey)) throw new Error("Use a simple platform key, such as x, tiktok or instagram.");
      if (!input.platformName.trim() || !displayName) throw new Error("Enter the platform name and profile name.");
      if (!secureUrl(profileUrl)) throw new Error("The profile link must begin with https://.");
      if (input.iconUrl.trim() && !secureUrl(input.iconUrl.trim())) throw new Error("The icon image link must begin with https://.");
      if (surfaces.some((surface) => !["all", "website", "refill", "logistics", "store", "bills", "customer", "driver", "station"].includes(surface))) {
        throw new Error("Use supported display locations: website, refill, logistics, store, bills, customer, driver, station or all.");
      }
      const { error: platformError } = await supabase.rpc("upsert_social_platform", {
        target_platform_key: platformKey,
        target_display_name: input.platformName.trim(),
        target_icon_key: input.iconKey.trim() || "globe",
        target_icon_url: input.iconUrl.trim() || null,
      });
      if (platformError) throw platformError;
      const { error: profileError } = await supabase.rpc("upsert_social_profile", {
        target_id: input.profileId,
        target_platform_key: platformKey,
        target_display_name: displayName,
        target_handle: input.handle.trim() || null,
        target_profile_url: profileUrl,
        target_surfaces: surfaces,
        target_sort_order: Number.isFinite(sortOrder) ? sortOrder : 100,
        target_is_active: true,
      });
      if (profileError) throw profileError;
    },
    onSuccess: async () => {
      setForm(EMPTY_FORM);
      setEditingId(null);
      setFormError("");
      setNotice("Social profile saved. Its selected SKIMA surfaces will use the updated link.");
      await queryClient.invalidateQueries({ queryKey: ["admin-social-directory"] });
    },
    onError: (cause) => setFormError(cause instanceof Error ? cause.message : "The social profile could not be saved."),
  });

  const setActive = useMutation({
    mutationFn: async (row: DirectoryRow) => {
      if (!row.profile_id || !row.display_name || !row.profile_url) return;
      const { error } = await supabase.rpc("upsert_social_profile", {
        target_id: row.profile_id,
        target_platform_key: row.platform_key,
        target_display_name: row.display_name,
        target_handle: row.handle,
        target_profile_url: row.profile_url,
        target_surfaces: row.target_surfaces?.length ? row.target_surfaces : ["all"],
        target_sort_order: row.sort_order ?? 100,
        target_is_active: !row.is_active,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-social-directory"] });
    },
  });

  const editRow = (row: DirectoryRow) => {
    if (!row.profile_id || !row.display_name || !row.profile_url) return;
    setEditingId(row.profile_id);
    setForm({
      platformKey: row.platform_key,
      platformName: row.platform_name,
      iconKey: row.icon_key,
      iconUrl: row.icon_url ?? "",
      displayName: row.display_name,
      handle: row.handle ?? "",
      profileUrl: row.profile_url,
      surfaces: (row.target_surfaces ?? ["all"]).join(", "),
      sortOrder: String(row.sort_order ?? 100),
    });
    setFormError("");
    setNotice("");
  };

  const columns: TableColumn<DirectoryRow>[] = [
    {
      key: "platform",
      header: "Platform",
      render: (row) => (
        <span><strong>{row.platform_name}</strong><br /><small>{row.platform_key}</small></span>
      ),
    },
    {
      key: "profile",
      header: "Profile",
      render: (row) => (
        <span><strong>{row.display_name ?? "Platform not linked"}</strong><br /><small>{row.handle ?? ""}</small></span>
      ),
    },
    {
      key: "surfaces",
      header: "Shown in",
      render: (row) => <small>{(row.target_surfaces ?? []).join(", ") || "—"}</small>,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => row.profile_id
        ? <StatusBadge tone={row.is_active ? "success" : "neutral"}>{row.is_active ? "Active" : "Hidden"}</StatusBadge>
        : <StatusBadge>Platform only</StatusBadge>,
    },
    {
      key: "actions",
      header: "",
      render: (row) => row.profile_id ? (
        <div className="skima-table-actions">
          <Button size="sm" variant="outline" onClick={() => editRow(row)}>Edit</Button>
          <Button size="sm" variant="ghost" onClick={() => setActive.mutate(row)} isLoading={setActive.isPending}>
            {row.is_active ? "Hide" : "Show"}
          </Button>
        </div>
      ) : null,
    },
  ];

  return (
    <div className="skima-workspace">
      <PageHeader
        eyebrow="Customer experience"
        title="Social media"
        description="Manage official SKIMA profiles and choose where each one appears. Updates go live from this directory without an app rebuild."
        actions={<Button icon={RefreshCcw} variant="outline" onClick={() => void directory.refetch()}>Refresh</Button>}
      />
      <section className="skima-grid skima-grid--compact">
        <MetricTile label="Platforms" value={platformCount} icon={Globe} />
        <MetricTile label="Visible profiles" value={activeCount} icon={Share2} />
      </section>

      <section className="skima-panel">
        <div className="skima-panel__header">
          <div><h2>{editingId ? "Edit social profile" : "Add a social profile"}</h2><p>Register a platform and connect its official SKIMA account.</p></div>
        </div>
        <div className="skima-form-grid">
          <TextInput label="Platform key" value={form.platformKey} onChange={(event) => setForm({ ...form, platformKey: event.currentTarget.value })} placeholder="x, tiktok, instagram" />
          <TextInput label="Platform name" value={form.platformName} onChange={(event) => setForm({ ...form, platformName: event.currentTarget.value })} placeholder="TikTok" />
          <TextInput label="Icon name" value={form.iconKey} onChange={(event) => setForm({ ...form, iconKey: event.currentTarget.value })} placeholder="music-2 or globe" />
          <TextInput label="Custom icon image URL (optional)" value={form.iconUrl} onChange={(event) => setForm({ ...form, iconUrl: event.currentTarget.value })} placeholder="https://…" />
          <TextInput label="Profile name" value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.currentTarget.value })} placeholder="SKIMA on TikTok" />
          <TextInput label="Username" value={form.handle} onChange={(event) => setForm({ ...form, handle: event.currentTarget.value })} placeholder="@skimagroup" />
          <TextInput label="Profile URL" value={form.profileUrl} onChange={(event) => setForm({ ...form, profileUrl: event.currentTarget.value })} placeholder="https://…" />
          <TextInput label="Display locations" value={form.surfaces} onChange={(event) => setForm({ ...form, surfaces: event.currentTarget.value })} placeholder="all or website, refill, logistics" />
          <TextInput label="Display order" value={form.sortOrder} onChange={(event) => setForm({ ...form, sortOrder: event.currentTarget.value })} placeholder="100" />
        </div>
        {formError ? <div className="admin-notice is-error" role="alert">{formError}</div> : null}
        {notice ? <div className="admin-notice" role="status">{notice}</div> : null}
        <div className="skima-form-actions">
          <Button icon={Plus} isLoading={saveProfile.isPending} onClick={() => saveProfile.mutate({ ...form, profileId: editingId })}>Save profile</Button>
          {editingId ? <Button variant="outline" onClick={() => { setForm(EMPTY_FORM); setEditingId(null); setFormError(""); }}>Cancel</Button> : null}
        </div>
        <p className="admin-field-hint">Display locations: all, website, refill, logistics, store, bills, customer, driver or station. Use a custom HTTPS icon URL for a platform without a built-in symbol.</p>
      </section>

      {directory.isLoading ? <LoadingState label="Loading social profiles" /> : directory.error ? (
        <ErrorState
          title="Social directory unavailable"
          message={directory.error instanceof Error ? directory.error.message : "Refresh and try again."}
          onRetry={() => void directory.refetch()}
        />
      ) : (
        <DataTable
          caption="Official SKIMA social accounts"
          columns={columns}
          records={rows}
          getRowKey={(row) => row.profile_id ?? row.platform_key}
          emptyTitle="No social profiles yet"
          emptyMessage="Add an official SKIMA social profile above."
        />
      )}
      {setActive.error ? <div className="admin-notice is-error" role="alert">{setActive.error instanceof Error ? setActive.error.message : "The social profile status could not be updated."}</div> : null}
    </div>
  );
}
