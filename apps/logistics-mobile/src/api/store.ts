import { useLogisticsQuery } from "./logistics";

export function useLogisticsStorefrontData() {
  const modules = useLogisticsQuery(["store", "modules"], "/modules", true, 60_000);
  const settings = useLogisticsQuery(["store", "settings"], "/runtime/storefront/settings", true, 60_000);
  const storeModule = (modules.data ?? []).find((item) => item.key === "store" && item.status === "active") ?? null;
  const activeSettings = (settings.data ?? []).find((item) => item.status === "active") ?? null;
  const enabled = Boolean(storeModule?.id && activeSettings?.organization_id);
  const categories = useLogisticsQuery(["store", "categories"], "/runtime/catalog/categories", enabled, 60_000);
  const items = useLogisticsQuery(["store", "items", activeSettings?.organization_id ?? "none"], "/runtime/catalog/items", enabled, 60_000);
  const variants = useLogisticsQuery(["store", "variants"], "/runtime/catalog/variants", enabled, 60_000);
  const prices = useLogisticsQuery(["store", "prices"], "/runtime/catalog/prices", enabled, 60_000);
  const availability = useLogisticsQuery(["store", "availability"], "/runtime/catalog/availability", enabled, 30_000);
  const media = useLogisticsQuery(["store", "media"], "/runtime/catalog/media", enabled, 60_000);
  return { modules, settings, storeModule, activeSettings, categories, items, variants, prices, availability, media };
}
