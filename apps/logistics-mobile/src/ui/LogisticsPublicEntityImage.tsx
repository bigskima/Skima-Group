import { createClientIdempotencyKey } from "@skima/frontend-core";
import { useQuery } from "@tanstack/react-query";
import { Image, StyleSheet, View } from "react-native";
import { z } from "zod";
import { RecordArraySchema } from "../api/logistics";
import { useSession } from "../session/SessionProvider";

type EntityType = "driver" | "logistics_vehicle";
type MediaRole = "driver.photo.public" | "logistics.vehicle.photo.public";
const ReadSessionSchema = z.object({ assetId: z.string().uuid(), signedUrl: z.string().url() });

export function LogisticsPublicEntityImage({
  entityType,
  entityId,
  mediaRole,
  size = 64,
}: {
  entityType: EntityType;
  entityId: string | null | undefined;
  mediaRole: MediaRole;
  size?: number;
}) {
  const { api } = useSession();
  const queryKey = ["skima-logistics", "public-media", entityType, entityId ?? "none", mediaRole];
  const links = useQuery({
    queryKey,
    enabled: Boolean(entityId),
    queryFn: ({ signal }) => api.get(
      `/runtime/media/entity-links?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId ?? "")}`,
      RecordArraySchema,
      { signal },
    ),
    staleTime: 30_000,
  });
  const current = links.data?.find((link) => link.media_role === mediaRole && link.is_primary === true)
    ?? links.data?.find((link) => link.media_role === mediaRole)
    ?? null;
  const assetId = typeof current?.media_asset_id === "string" ? current.media_asset_id : null;
  const readSession = useQuery({
    queryKey: [...queryKey, "read", assetId],
    enabled: Boolean(assetId),
    queryFn: () => api.post(
      "/runtime/media/read-sessions",
      { assetId, idempotencyKey: createClientIdempotencyKey("logistics.media.read") },
      ReadSessionSchema,
    ),
    staleTime: 10 * 60_000,
  });
  const signedUrl = readSession.data?.signedUrl;
  if (!signedUrl) return null;
  return (
    <View style={[styles.frame, { width: size, height: size, borderRadius: Math.max(10, Math.round(size * 0.22)) }]}>
      <Image source={{ uri: signedUrl }} resizeMode="cover" style={StyleSheet.absoluteFill} accessibilityLabel={entityType === "driver" ? "Assigned driver's public photo" : "Assigned vehicle photo"} />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: "hidden", backgroundColor: "rgba(128,128,128,0.10)" },
});
