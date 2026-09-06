import { useQuery } from "@tanstack/react-query";

import { useSessionState } from "./session";

const LOGO_PLACEMENTS = ["mobile.brand.logo.primary", "mobile.brand.logo.compact"] as const;

export function AdminBrandLogo(props: { readonly compact?: boolean; readonly className?: string }) {
  const { supabase } = useSessionState();
  const logo = useQuery({
    queryKey: ["admin-server-brand-logo", props.compact ? "compact" : "primary"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const placements = props.compact
        ? ["mobile.brand.logo.compact", "mobile.brand.logo.primary"]
        : [...LOGO_PLACEMENTS];
      const { data, error } = await supabase.rpc("read_published_product_content", {
        target_placement_keys: placements,
        target_module_key: null,
        target_audience_key: "public",
        target_country_code: null,
        target_region: null,
        target_city: null,
      });
      if (error) throw error;
      for (const placement of placements) {
        const row = (Array.isArray(data) ? data : []).find((value) =>
          isRecord(value) && value.placement_key === placement
        );
        if (!isRecord(row)) continue;
        const metadata = isRecord(row.metadata) ? row.metadata : {};
        const direct = readString(metadata.media_public_url) ?? readString(metadata.mediaPublicUrl);
        if (direct) {
          return {
            url: direct,
            label: readString(row.accessibility_label) ?? readString(row.title) ?? "SKIMA",
          };
        }
        const bucket = readString(row.media_storage_bucket);
        const path = readString(row.media_storage_path);
        if (bucket && path) {
          return {
            url: supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl,
            label: readString(row.accessibility_label) ?? readString(row.title) ?? "SKIMA",
          };
        }
      }
      return null;
    },
  });

  const className = ["admin-server-logo", props.compact ? "admin-server-logo--compact" : "", props.className ?? ""]
    .filter(Boolean)
    .join(" ");

  if (logo.data?.url) {
    return <span className={className}><img src={logo.data.url} alt={logo.data.label} /></span>;
  }

  return <span className={className} aria-label="SKIMA"><strong>SKIMA</strong></span>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
