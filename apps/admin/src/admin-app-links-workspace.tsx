import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Link2, RefreshCcw, Save, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";

import { Button, ErrorState, LoadingState, PageHeader, StatusBadge } from "@skima/ui";
import { useSessionState } from "./session";
import "./admin-app-links-workspace.css";

const AppLinkSchema = z.object({
  service_key: z.enum(["refill", "store", "logistics", "bills"]),
  display_name: z.string(),
  description: z.string().nullable().optional(),
  web_url: z.string().nullable(),
  android_store_url: z.string().nullable(),
  ios_store_url: z.string().nullable(),
  android_deep_link_url: z.string().nullable().optional(),
  ios_deep_link_url: z.string().nullable().optional(),
  android_deep_link_enabled: z.boolean().default(false),
  ios_deep_link_enabled: z.boolean().default(false),
  is_active: z.boolean(),
  sort_order: z.coerce.number(),
}).passthrough();
const AppLinkArraySchema = z.array(AppLinkSchema);
type AppLink = z.infer<typeof AppLinkSchema>;

type LinkDraft = {
  display_name: string;
  description: string;
  web_url: string;
  android_store_url: string;
  ios_store_url: string;
  android_deep_link_url: string;
  ios_deep_link_url: string;
  android_deep_link_enabled: boolean;
  ios_deep_link_enabled: boolean;
  is_active: boolean;
  sort_order: string;
};

const APP_ORDER = ["refill", "logistics", "bills", "store"] as const;
const APP_LABELS: Record<AppLink["service_key"], string> = {
  refill: "SKIMA Refill",
  logistics: "SKIMA Logistics",
  bills: "SKIMA Bills",
  store: "SKIMA Store",
};

function toDraft(row: AppLink): LinkDraft {
  return {
    display_name: row.display_name,
    description: row.description ?? "",
    web_url: row.web_url ?? "",
    android_store_url: row.android_store_url ?? "",
    ios_store_url: row.ios_store_url ?? "",
    android_deep_link_url: row.android_deep_link_url ?? "",
    ios_deep_link_url: row.ios_deep_link_url ?? "",
    android_deep_link_enabled: row.android_deep_link_enabled,
    ios_deep_link_enabled: row.ios_deep_link_enabled,
    is_active: row.is_active,
    sort_order: String(row.sort_order),
  };
}

export function AdminAppLinksWorkspace() {
  const { supabase, context, status } = useSessionState();
  const client = useQueryClient();
  const isSuperAdmin = context?.platformAdmin?.admin_kind === "super_admin";
  const [drafts, setDrafts] = useState<Record<string, LinkDraft>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeError, setNoticeError] = useState(false);

  const query = useQuery({
    queryKey: ["admin-app-discovery-links"],
    enabled: status === "authenticated" && isSuperAdmin,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_service_discovery_links")
        .select("service_key,display_name,description,web_url,android_store_url,ios_store_url,android_deep_link_url,ios_deep_link_url,android_deep_link_enabled,ios_deep_link_enabled,is_active,sort_order")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return AppLinkArraySchema.parse(data ?? []);
    },
  });

  useEffect(() => {
    if (!query.data) return;
    setDrafts(Object.fromEntries(query.data.map((row) => [row.service_key, toDraft(row)])));
  }, [query.data]);

  const save = useMutation({
    mutationFn: async (input: { serviceKey: AppLink["service_key"]; draft: LinkDraft }) => {
      const value = input.draft;
      assertSafeWebUrl(value.web_url, "Web fallback");
      assertOptionalWebUrl(value.android_store_url, "Google Play link");
      assertOptionalWebUrl(value.ios_store_url, "Apple App Store link");
      assertOptionalDeepLink(value.android_deep_link_url, "Android deep link");
      assertOptionalDeepLink(value.ios_deep_link_url, "iOS deep link");
      if (value.android_deep_link_enabled && !value.android_deep_link_url.trim()) {
        throw new Error("Enter an Android deep link or switch off Android deep links.");
      }
      if (value.ios_deep_link_enabled && !value.ios_deep_link_url.trim()) {
        throw new Error("Enter an iOS deep link or switch off iOS deep links.");
      }
      const { error } = await supabase
        .from("customer_service_discovery_links")
        .update({
          display_name: value.display_name.trim(),
          description: value.description.trim(),
          web_url: value.web_url.trim(),
          android_store_url: value.android_store_url.trim() || null,
          ios_store_url: value.ios_store_url.trim() || null,
          android_deep_link_url: value.android_deep_link_url.trim() || null,
          ios_deep_link_url: value.ios_deep_link_url.trim() || null,
          android_deep_link_enabled: value.android_deep_link_enabled,
          ios_deep_link_enabled: value.ios_deep_link_enabled,
          is_active: value.is_active,
          sort_order: Number.parseInt(value.sort_order, 10) || 0,
          updated_at: new Date().toISOString(),
        })
        .eq("service_key", input.serviceKey);
      if (error) throw error;
    },
    onSuccess: async () => {
      setNotice("App link settings saved. Public service cards and app download prompts will use the updated links.");
      setNoticeError(false);
      await client.invalidateQueries({ queryKey: ["admin-app-discovery-links"] });
      await query.refetch();
    },
    onError: (error) => {
      setNotice(error instanceof Error ? error.message : "App link settings could not be saved.");
      setNoticeError(true);
    },
  });

  const updateDraft = (key: AppLink["service_key"], patch: Partial<LinkDraft>) => {
    setDrafts((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
  };

  if (!isSuperAdmin) {
    return <ErrorState title="App link administration restricted" message="Only a Platform Super Admin can change public app and download destinations. This is also enforced by the database policy." />;
  }
  if (query.isPending) return <LoadingState label="Loading the existing app quick-route links…" />;
  if (query.error) return <ErrorState title="App links unavailable" message={query.error instanceof Error ? query.error.message : "The shared app link registry could not be loaded."} onRetry={() => void query.refetch()} />;

  const rows = [...(query.data ?? [])].sort((a, b) => APP_ORDER.indexOf(a.service_key) - APP_ORDER.indexOf(b.service_key));
  return (
    <div className="admin-app-links">
      <PageHeader
        eyebrow="Experience · App downloads"
        title="App links & quick routes"
        description="Edit the existing shared quick-route records. Store and deep links are optional; every app always keeps its web URL as the fallback."
        actions={<Button icon={RefreshCcw} variant="outline" onClick={() => void query.refetch()}>Refresh</Button>}
      />
      <div className="admin-app-links__notice">
        <Link2 size={18} />
        <div><strong>One shared registry</strong><p>The SKIMA website and all four apps read customer_service_discovery_links. These controls update those existing records instead of creating a second link catalogue.</p></div>
      </div>
      {notice ? <div className={noticeError ? "admin-app-links__message is-error" : "admin-app-links__message"}>{notice}</div> : null}
      <div className="admin-app-links__grid">
        {rows.map((row) => {
          const draft = drafts[row.service_key] ?? toDraft(row);
          return (
            <section className="admin-app-links__card" key={row.service_key}>
              <div className="admin-app-links__card-head">
                <div className="admin-app-links__app-icon"><Smartphone size={20} /></div>
                <div className="admin-app-links__app-title"><h2>{APP_LABELS[row.service_key]}</h2><small>{row.service_key}</small></div>
                <StatusBadge tone={draft.is_active ? "success" : "warning"}>{draft.is_active ? "Visible" : "Hidden"}</StatusBadge>
              </div>
              <label className="admin-app-links__field">Display name<input value={draft.display_name} onChange={(event) => updateDraft(row.service_key,{display_name:event.currentTarget.value})}/></label>
              <label className="admin-app-links__field">Short description<input value={draft.description} onChange={(event) => updateDraft(row.service_key,{description:event.currentTarget.value})}/></label>
              <label className="admin-app-links__field admin-app-links__field--wide">Website fallback URL<input type="url" value={draft.web_url} onChange={(event) => updateDraft(row.service_key,{web_url:event.currentTarget.value})} placeholder="https://…"/></label>
              <div className="admin-app-links__subhead">Android</div>
              <label className="admin-app-links__field">Google Play URL<input type="url" value={draft.android_store_url} onChange={(event) => updateDraft(row.service_key,{android_store_url:event.currentTarget.value})} placeholder="Optional Play Store URL"/></label>
              <label className="admin-app-links__field">Android app deep link<input value={draft.android_deep_link_url} onChange={(event) => updateDraft(row.service_key,{android_deep_link_url:event.currentTarget.value})} placeholder="skima-store://…"/></label>
              <label className="admin-app-links__toggle"><input type="checkbox" checked={draft.android_deep_link_enabled} onChange={(event) => updateDraft(row.service_key,{android_deep_link_enabled:event.currentTarget.checked})}/> Enable Android deep link</label>
              <div className="admin-app-links__subhead">iPhone & iPad</div>
              <label className="admin-app-links__field">Apple App Store URL<input type="url" value={draft.ios_store_url} onChange={(event) => updateDraft(row.service_key,{ios_store_url:event.currentTarget.value})} placeholder="Optional App Store URL"/></label>
              <label className="admin-app-links__field">iOS app deep link<input value={draft.ios_deep_link_url} onChange={(event) => updateDraft(row.service_key,{ios_deep_link_url:event.currentTarget.value})} placeholder="skima-bills://…"/></label>
              <label className="admin-app-links__toggle"><input type="checkbox" checked={draft.ios_deep_link_enabled} onChange={(event) => updateDraft(row.service_key,{ios_deep_link_enabled:event.currentTarget.checked})}/> Enable iOS deep link</label>
              <div className="admin-app-links__card-footer">
                <label className="admin-app-links__toggle"><input type="checkbox" checked={draft.is_active} onChange={(event) => updateDraft(row.service_key,{is_active:event.currentTarget.checked})}/> Show this app</label>
                <label className="admin-app-links__sort">Order<input type="number" value={draft.sort_order} onChange={(event) => updateDraft(row.service_key,{sort_order:event.currentTarget.value})}/></label>
                <Button icon={Save} isLoading={save.isPending} disabled={save.isPending || !draft.web_url.trim()} onClick={() => save.mutate({serviceKey:row.service_key,draft})}>Save links</Button>
              </div>
              <p className="admin-app-links__fallback"><ExternalLink size={14}/> Fallback order: enabled app deep link → store listing → website.</p>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function assertSafeWebUrl(value: string, label: string) {
  if (!value.trim()) throw new Error(label + " is required.");
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error(label + " must be a valid URL."); }
  if (parsed.protocol !== "https:") throw new Error(label + " must use HTTPS.");
}
function assertOptionalWebUrl(value: string, label: string) {
  if (value.trim()) assertSafeWebUrl(value, label);
}
function assertOptionalDeepLink(value: string, label: string) {
  if (value.trim() && !/^[a-z][a-z0-9+.-]*:\/\//i.test(value.trim())) {
    throw new Error(label + " must use a valid app URL scheme.");
  }
}
