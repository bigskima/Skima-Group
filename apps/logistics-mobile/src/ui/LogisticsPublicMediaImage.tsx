import { useQuery } from "@tanstack/react-query";
import { Image, StyleSheet, Text, View } from "react-native";
import { z } from "zod";
import { RecordArraySchema, asString } from "../api/logistics";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, typography } from "../theme/tokens";

type EntityType = "driver" | "logistics_vehicle" | "logistics_company";
const ReadSessionSchema = z.object({ assetId: z.string().uuid(), signedUrl: z.string().url() });

export function LogisticsPublicMediaImage({
  entityType,
  entityId,
  mediaRole,
  label,
  size = 64,
}: {
  entityType: EntityType;
  entityId: string | null;
  mediaRole: string;
  label: string;
  size?: number;
}) {
  const { api } = useSession();
  const { palette } = useAppTheme();
  const links = useQuery({
    queryKey: ["skima-logistics", "public-media", entityType, entityId, mediaRole],
    enabled: Boolean(entityId),
    queryFn: ({ signal }) => api.get(
      `/runtime/media/entity-links?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId ?? "")}`,
      RecordArraySchema,
      { signal },
    ),
    staleTime: 60_000,
  });
  const link = links.data?.find((item) =>
    asString(item, "media_role") === mediaRole && item.is_primary === true
  ) ?? links.data?.find((item) => asString(item, "media_role") === mediaRole) ?? null;
  const assetId = asString(link, "media_asset_id");
  const read = useQuery({
    queryKey: ["skima-logistics", "public-media-read", assetId],
    enabled: Boolean(assetId),
    queryFn: () => api.post(
      "/runtime/media/read-sessions",
      { assetId, idempotencyKey: `public-media-read:${assetId}` },
      ReadSessionSchema,
    ),
    staleTime: 10 * 60_000,
  });

  return (
    <View style={[
      styles.frame,
      {
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.24),
        backgroundColor: palette.brandSoft,
        borderColor: palette.border,
      },
    ]}>
      {read.data?.signedUrl ? (
        <Image source={{ uri: read.data.signedUrl }} accessibilityLabel={label} resizeMode="cover" style={styles.image} />
      ) : (
        <Text style={[styles.initial, { color: palette.brand }]}>{label.trim().slice(0, 1).toUpperCase() || "S"}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: "hidden", borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
  image: { width: "100%", height: "100%" },
  initial: { ...typography.bodyStrong, fontSize: 22, fontWeight: "900" },
});
