import { RecordArraySchema } from "./records";
import { useGatewayQuery } from "./gateway";

export function useStorefrontData() {
  const modules = useGatewayQuery({
    key: ["store", "modules"],
    path: "/modules",
    schema: RecordArraySchema,
    persist: true,
  });
  const settings = useGatewayQuery({
    key: ["store", "settings"],
    path: "/runtime/storefront/settings",
    schema: RecordArraySchema,
    refetchInterval: 60000,
  });
  const storeModule = modules.data?.find((module) =>
    module.key === "store" && module.status === "active"
  );
  const activeSettings = settings.data?.find((setting) => setting.status === "active") ?? null;
  const enabled = Boolean(storeModule?.id && activeSettings?.organization_id);

  const categories = useGatewayQuery({
    key: ["store", "categories", storeModule?.id ?? "unconfigured"],
    path: "/runtime/catalog/categories",
    schema: RecordArraySchema,
    enabled,
    persist: true,
  });
  const items = useGatewayQuery({
    key: ["store", "items", activeSettings?.organization_id ?? "unconfigured", storeModule?.id ?? "unconfigured"],
    path: "/runtime/catalog/items",
    schema: RecordArraySchema,
    enabled,
    refetchInterval: 60000,
  });
  const variants = useGatewayQuery({
    key: ["store", "variants"],
    path: "/runtime/catalog/variants",
    schema: RecordArraySchema,
    enabled,
    persist: true,
  });
  const prices = useGatewayQuery({
    key: ["store", "prices"],
    path: "/runtime/catalog/prices",
    schema: RecordArraySchema,
    enabled,
    refetchInterval: 60000,
  });
  const availability = useGatewayQuery({
    key: ["store", "availability"],
    path: "/runtime/catalog/availability",
    schema: RecordArraySchema,
    enabled,
    refetchInterval: 30000,
  });
  const media = useGatewayQuery({
    key: ["store", "media"],
    path: "/runtime/catalog/media",
    schema: RecordArraySchema,
    enabled,
    persist: true,
  });

  return {
    modules,
    settings,
    storeModule,
    activeSettings,
    categories,
    items,
    variants,
    prices,
    availability,
    media,
  };
}

export type StorefrontSettingsRecord = Record<string, unknown>;
