import * as ImagePicker from "expo-image-picker";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClientIdempotencyKey } from "@skima/frontend-core";
import React, { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { z } from "zod";
import { RecordArraySchema } from "../api/logistics";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";
import { AppButton } from "./AppButton";
import { Card } from "./Card";
import { uploadSignedAsset } from "../utils/uploadSignedAsset";

type PublicEntity = "logistics_company" | "logistics_vehicle" | "driver";
type PublicRole =
  | "logistics.company.logo.public"
  | "logistics.company.photo.public"
  | "logistics.vehicle.photo.public"
  | "driver.photo.public";

const UploadSessionSchema = z.object({
  signedUrl: z.string().url(),
  method: z.literal("PUT"),
  storageBucket: z.string(),
  storagePath: z.string(),
});
const ReadSessionSchema = z.object({ assetId: z.string().uuid(), signedUrl: z.string().url() });
const IdSchema = z.string().uuid();

export function LogisticsMediaPicker(props: {
  entityType: PublicEntity;
  entityId: string;
  organizationId?: string | null;
  mediaRole: PublicRole;
  title: string;
  description: string;
  compact?: boolean;
}) {
  const { palette } = useAppTheme();
  const { api, session } = useSession();
  const queryClient = useQueryClient();
  const queryKey = ["skima-logistics", "public-media", props.entityType, props.entityId, props.mediaRole];
  const links = useQuery({
    queryKey,
    enabled: Boolean(props.entityId),
    queryFn: ({ signal }) => api.get(
      `/runtime/media/entity-links?entityType=${encodeURIComponent(props.entityType)}&entityId=${encodeURIComponent(props.entityId)}`,
      RecordArraySchema,
      { signal },
    ),
    staleTime: 30_000,
  });
  const current = links.data?.find((link) =>
    link.media_role === props.mediaRole && link.is_primary === true
  ) ?? links.data?.find((link) => link.media_role === props.mediaRole) ?? null;
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
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const upload = async () => {
    if (!props.entityId || !session?.user.id || busy) return;
    setError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("Allow photo-library access to choose a company or vehicle image.");
      return;
    }
    const selection = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      quality: 0.86,
      aspect: props.mediaRole === "logistics.company.logo.public" ? [1, 1] : [4, 3],
    });
    if (selection.canceled || !selection.assets[0]) return;

    const image = selection.assets[0];
    const contentType = image.mimeType && image.mimeType.startsWith("image/")
      ? image.mimeType
      : "image/jpeg";
    const extension = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    const idempotencyKey = createClientIdempotencyKey("logistics.public-media.upload");
    setBusy(true);
    setProgress(0);
    try {
      const uploadSession = await api.post(
        "/runtime/media/upload-sessions",
        {
          contentType,
          fileName: `${props.mediaRole.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.${extension}`,
          idempotencyKey,
          storageBucket: "skima-platform-media",
        },
        UploadSessionSchema,
      );
      const uploaded = await uploadSignedAsset({
        uri: image.uri,
        signedUrl: uploadSession.signedUrl,
        contentType,
        onProgress: setProgress,
      });
      if (uploaded.status < 200 || uploaded.status >= 300) {
        throw new Error(`The protected image upload was rejected (${uploaded.status}).`);
      }
      const mediaAssetId = await api.post(
        "/runtime/media/assets",
        {
          assetTypeKey: "media.image.public",
          byteSize: uploaded.byteSize,
          contentType,
          idempotencyKey: `${idempotencyKey}:asset`,
          metadata: { originalFileName: image.fileName ?? `logistics-image.${extension}` },
          organizationId: props.organizationId ?? null,
          ownerUserId: session.user.id,
          source: "skima.logistics.mobile",
          storageBucket: uploadSession.storageBucket,
          storagePath: uploadSession.storagePath,
        },
        IdSchema,
      );
      await api.post(
        "/runtime/media/entity-links",
        {
          entityType: props.entityType,
          entityId: props.entityId,
          mediaAssetId,
          mediaRole: props.mediaRole,
          fit: props.mediaRole === "logistics.company.logo.public" ? "contain" : "cover",
          isPrimary: true,
        },
        IdSchema,
      );
      await queryClient.invalidateQueries({ queryKey });
      setProgress(1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The image could not be published. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card padding={props.compact ? "md" : "lg"}>
      <View style={styles.row}>
        {readSession.data?.signedUrl ? (
          <Image source={{ uri: readSession.data.signedUrl }} resizeMode={props.mediaRole === "logistics.company.logo.public" ? "contain" : "cover"}
            style={[styles.preview, { backgroundColor: palette.surfaceSubtle }, props.compact && styles.previewCompact]} />
        ) : (
          <View style={[styles.placeholder, { backgroundColor: palette.brandSoft }, props.compact && styles.previewCompact]}>
            <Text style={[styles.placeholderText, { color: palette.brand }]}>{props.mediaRole.includes("logo") ? "LOGO" : "PHOTO"}</Text>
          </View>
        )}
        <View style={styles.copy}>
          <Text style={[styles.title, { color: palette.ink }]}>{props.title}</Text>
          <Text style={[styles.description, { color: palette.muted }]}>{props.description}</Text>
          <AppButton size="sm" variant="secondary" label={busy ? "Uploading image…" : current ? "Replace image" : "Upload image"}
            disabled={busy || !props.entityId} loading={busy} onPress={() => void upload()} />
          {busy ? <Text style={[styles.progress, { color: palette.muted }]}>{Math.round(progress * 100)}% uploaded</Text> : null}
          {error ? <Text accessibilityRole="alert" style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}
          {links.error || readSession.error ? <Text style={[styles.error, { color: palette.danger }]}>Image status could not be refreshed. Retry after reconnecting.</Text> : null}
        </View>
      </View>
    </Card>
  );
}


const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  preview: { width: 88, height: 88, borderRadius: radii.lg },
  previewCompact: { width: 64, height: 64 },
  placeholder: { width: 88, height: 88, borderRadius: radii.lg, alignItems: "center", justifyContent: "center" },
  placeholderText: { ...typography.eyebrow, fontSize: 11, fontWeight: "900" },
  copy: { flex: 1, gap: 6, alignItems: "flex-start" },
  title: { ...typography.bodyStrong, fontSize: 12 },
  description: { ...typography.caption, fontSize: 10, lineHeight: 15 },
  progress: { ...typography.caption, fontSize: 9 },
  error: { ...typography.caption, fontSize: 10, lineHeight: 15 },
});
