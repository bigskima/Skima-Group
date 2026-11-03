import { createClientIdempotencyKey } from "@skima/frontend-core";
import { useQuery } from "@tanstack/react-query";
import { Building2, ImageOff, Truck, UserRound } from "lucide-react-native";
import { Image, StyleSheet, Text, View } from "react-native";
import { z } from "zod";
import { RecordArraySchema } from "../api/logistics";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, typography } from "../theme/tokens";

type EntityType = "driver" | "logistics_vehicle" | "logistics_company";
type MediaRole =
  | "driver.photo.public"
  | "logistics.vehicle.photo.public"
  | "logistics.company.logo.public"
  | "logistics.company.photo.public";

const ReadSessionSchema = z.object({
  assetId: z.string(),
  signedUrl: z.string().url(),
  expiresInSeconds: z.number().positive().optional(),
  contentType: z.string().nullable().optional(),
});

export function LogisticsPublicEntityImage({
  entityType,
  entityId,
  mediaRole,
  label,
  size = 68,
  aspectRatio = 1,
}: {
  entityType: EntityType;
  entityId: string | null | undefined;
  mediaRole: MediaRole;
  label: string;
  size?: number;
  aspectRatio?: number;
}) {
  const { api, session, status } = useSession();
  const { palette } = useAppTheme();
  const identity = session?.user.id ?? "anonymous";
  const queryKey = ["skima-logistics", "public-entity-media", entityType, entityId ?? "none", mediaRole, identity];
  const links = useQuery({
    queryKey,
    enabled: status === "authenticated" && Boolean(entityId),
    queryFn: ({ signal }) => api.get(
      `/runtime/media/entity-links?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId ?? "")}`,
      RecordArraySchema,
      { signal },
    ),
    staleTime: 60_000,
  });
  const selected = links.data?.find((item) => item.media_role === mediaRole && item.is_primary === true)
    ?? links.data?.find((item) => item.media_role === mediaRole)
    ?? null;
  const assetId = typeof selected?.media_asset_id === "string" ? selected.media_asset_id : null;
  const read = useQuery({
    queryKey: [...queryKey, "read", assetId],
    enabled: status === "authenticated" && Boolean(assetId),
    queryFn: () => api.post(
      "/runtime/media/read-sessions",
      { assetId, idempotencyKey: createClientIdempotencyKey("logistics.media.public-read", `${entityType}:${entityId}:${mediaRole}`) },
      ReadSessionSchema,
    ),
    staleTime: 10 * 60_000,
  });
  const signedUrl = read.data?.signedUrl;
  const fallbackIcon = entityType === "driver"
    ? <UserRound color={palette.muted} size={Math.round(size * 0.32)} />
    : entityType === "logistics_vehicle"
      ? <Truck color={palette.muted} size={Math.round(size * 0.32)} />
      : <Building2 color={palette.muted} size={Math.round(size * 0.32)} />;

  return (
    <View style={[styles.frame, {
      width: size,
      height: size / aspectRatio,
      borderRadius: entityType === "driver" ? size / 2 : radii.md,
      backgroundColor: palette.surfaceSubtle,
      borderColor: palette.border,
    }]}>
      {signedUrl ? (
        <Image source={{ uri: signedUrl }} resizeMode="cover" style={StyleSheet.absoluteFill} accessibilityLabel={label} />
      ) : (
        <View style={styles.placeholder}>
          {read.isPending || links.isPending ? fallbackIcon : <ImageOff color={palette.muted} size={Math.round(size * 0.32)} />}
          <Text numberOfLines={2} style={[styles.placeholderText, { color: palette.muted }]}>{label}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: "hidden", borderWidth: StyleSheet.hairlineWidth },
  placeholder: { flex: 1, alignItems: "center", justifyContent: "center", gap: 4, padding: 5 },
  placeholderText: { ...typography.caption, fontSize: 8, textAlign: "center", fontWeight: "700" },
});
