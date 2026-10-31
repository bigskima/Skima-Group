import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import {
  DEFAULT_MAP_CENTER,
  getMapsRuntimeConfig,
  isUsablePublicTileTemplate,
  type Coordinate,
} from "./index";
import { useSession } from "../../session/SessionProvider";

const MapsRendererConfigurationSchema = z.object({
  tile_url_template: z.string(),
  attribution: z.string().optional(),
  max_zoom: z.coerce.number().int().min(1).max(22).optional(),
  default_center: z.object({
    longitude: z.coerce.number().min(-180).max(180),
    latitude: z.coerce.number().min(-85.051129).max(85.051129),
  }).optional(),
  default_zoom: z.coerce.number().int().min(1).max(22).optional(),
});

export interface MapsRendererConfiguration {
  readonly tileTemplate: string;
  readonly attribution: string;
  readonly maxZoom: number;
  readonly defaultCenter: Coordinate;
  readonly defaultZoom: number;
  readonly source: "platform_configuration" | "safe_fallback";
}

/**
 * Use the same public, keyless renderer configuration as SKIMA Admin.
 * The environment configuration remains a safe offline fallback only.
 */
export function useMapsRendererConfiguration(): MapsRendererConfiguration {
  const { status, supabase } = useSession();
  const runtimeTile = getMapsRuntimeConfig().tile;

  const fallback: MapsRendererConfiguration = {
    tileTemplate: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors",
    maxZoom: 19,
    defaultCenter: DEFAULT_MAP_CENTER,
    defaultZoom: 6,
    source: "safe_fallback",
  };

  const query = useQuery({
    queryKey: ["lpg-expo", "maps-renderer-configuration"],
    enabled: status === "authenticated" || status === "unauthenticated",
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: async (): Promise<MapsRendererConfiguration> => {
      const { data, error } = await supabase.rpc("read_maps_renderer_configuration");
      if (error) throw error;

      const configuration = MapsRendererConfigurationSchema.parse(data);
      if (!isUsablePublicTileTemplate(configuration.tile_url_template)) {
        return fallback;
      }

      return {
        tileTemplate: configuration.tile_url_template.trim(),
        attribution: configuration.attribution?.trim() || runtimeTile.attribution,
        maxZoom: configuration.max_zoom ?? runtimeTile.maxZoom,
        defaultCenter: configuration.default_center
          ? {
              latitude: configuration.default_center.latitude,
              longitude: configuration.default_center.longitude,
            }
          : DEFAULT_MAP_CENTER,
        defaultZoom: configuration.default_zoom ?? 6,
        source: "platform_configuration",
      };
    },
  });

  return query.data ?? fallback;
}
