import { useQuery } from "@tanstack/react-query";
import { useSession } from "../session/SessionProvider";

export interface ProductContentRecord {
  publicationId: string;
  publicationKey: string;
  placementKey: string;
  contentKind: string;
  title: string | null;
  body: string | null;
  accessibilityLabel: string | null;
  ctaLabel: string | null;
  ctaAction: Record<string, unknown>;
  mediaAssetId: string | null;
  mediaUrl: string | null;
  priority: number;
  revision: number;
  metadata: Record<string, unknown>;
}

export function usePublishedProductContent(
  placementKeys: readonly string[],
  options: {
    audience?: "public" | "customer" | "driver" | "station";
    countryCode?: string | null;
    region?: string | null;
    city?: string | null;
    moduleKey?: string | null;
  } = {},
) {
  const session = useSession();
  const key = placementKeys.join("|");
  return useQuery({
    queryKey: [
      "product-content",
      key,
      options.moduleKey ?? "platform",
      options.audience ?? "public",
      options.countryCode ?? "all",
      options.region ?? "all",
      options.city ?? "all",
    ],
    queryFn: async () => {
      const { data, error } = await session.supabase.rpc(
        "read_published_product_content",
        {
          target_placement_keys: [...placementKeys],
          target_module_key: options.moduleKey ?? null,
          target_audience_key: options.audience ?? "public",
          target_country_code: options.countryCode ?? null,
          target_region: options.region ?? null,
          target_city: options.city ?? null,
        },
      );
      if (error) throw error;
      return (Array.isArray(data) ? data : []).map(readProductContentRecord);
    },
    staleTime: 5 * 60_000,
    meta: { persist: true },
  });
}

function readProductContentRecord(value: unknown): ProductContentRecord {
  const record = isRecord(value) ? value : {};
  const bucket = readString(record.media_storage_bucket);
  const path = readString(record.media_storage_path);
  return {
    publicationId: readString(record.publication_id) ?? "",
    publicationKey: readString(record.publication_key) ?? "",
    placementKey: readString(record.placement_key) ?? "",
    contentKind: readString(record.content_kind) ?? "service",
    title: readString(record.title),
    body: readString(record.body),
    accessibilityLabel: readString(record.accessibility_label),
    ctaLabel: readString(record.cta_label),
    ctaAction: isRecord(record.cta_action) ? record.cta_action : {},
    mediaAssetId: readString(record.media_asset_id),
    mediaUrl: bucket && path ? publicMediaUrl(bucket, path) : null,
    priority: readNumber(record.priority) ?? 0,
    revision: readNumber(record.revision) ?? 1,
    metadata: isRecord(record.metadata) ? record.metadata : {},
  };
}

function publicMediaUrl(bucket: string, path: string) {
  const base = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  if (!base) return null;
  const safeBucket = encodeURIComponent(bucket);
  const safePath = path.split("/").map(encodeURIComponent).join("/");
  return `${base}/storage/v1/object/public/${safeBucket}/${safePath}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
