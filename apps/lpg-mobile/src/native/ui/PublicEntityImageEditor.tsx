import { useQuery } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { Camera, ImagePlus, Maximize2, Trash2 } from "lucide-react-native";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useEntityMediaLinks } from "../api/domains";
import { firstString, nestedRecord } from "../api/records";
import { uploadMedia } from "../media/upload";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { RuntimeMediaImage } from "./RuntimeMediaImage";

type PublicEntityType = "driver" | "station";
type PublicMediaRole = "driver.photo.public" | "station.logo.public" | "station.photo.public";
type ImageFit = "cover" | "contain" | "center";

const FIT_OPTIONS: Array<{ key: ImageFit; label: string; detail: string }> = [
  { key: "cover", label: "Cover", detail: "Fill the frame" },
  { key: "contain", label: "Contain", detail: "Show the whole image" },
  { key: "center", label: "Center", detail: "Keep the subject centered" },
];

export function PublicEntityImageEditor({
  entityType,
  entityId,
  mediaRole,
  title,
  description,
  label,
  aspect = [4, 3],
  variant = "hero",
}: {
  entityType: PublicEntityType;
  entityId: string;
  mediaRole: PublicMediaRole;
  title: string;
  description: string;
  label: string;
  aspect?: [number, number];
  variant?: "card" | "avatar" | "hero";
}) {
  const session = useSession();
  const { palette } = useAppTheme();
  const links = useEntityMediaLinks(entityType, entityId);
  const capability = useQuery({
    queryKey: ["lpg-expo", "public-entity-media-capability", entityType, entityId],
    enabled: session.status === "authenticated" && Boolean(entityId),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const result = await session.supabase.rpc("can_manage_public_entity_media", {
        target_entity_type: entityType,
        target_entity_id: entityId,
      });
      if (result.error) throw result.error;
      return result.data === true;
    },
  });
  const activeLink = useMemo(
    () => (links.data ?? []).find((item) => {
      const role = firstString(item, ["media_role", "mediaRole"]);
      const status = firstString(item, ["status"]) ?? "active";
      return role === mediaRole && status === "active";
    }) ?? null,
    [links.data, mediaRole],
  );
  const assetId = firstString(activeLink, ["media_asset_id", "mediaAssetId"]);
  const linkMetadata = nestedRecord(activeLink, "metadata");
  const storedFit = firstString(linkMetadata, ["fit"]);
  const initialFit: ImageFit = storedFit === "contain" || storedFit === "center" ? storedFit : "cover";
  const [fitOverride, setFitOverride] = useState<ImageFit | null>(null);
  const [pending, setPending] = useState<"upload" | "remove" | "fit" | null>(null);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const fit = fitOverride ?? initialFit;
  const editable = capability.data === true;
  const contentFit = fit === "center" ? "contain" : fit;

  const publish = async (mediaAssetId: string, nextFit: ImageFit) => {
    const result = await session.supabase.rpc("set_public_entity_media", {
      target_entity_type: entityType,
      target_entity_id: entityId,
      target_media_asset_id: mediaAssetId,
      target_media_role: mediaRole,
      target_fit: nextFit,
      target_is_primary: true,
    });
    if (result.error) throw result.error;
  };

  const choose = async () => {
    setMessage(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setMessage("Photo-library permission is required to choose this public image.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect,
      quality: 0.9,
    });
    if (result.canceled) return;

    const selected = result.assets[0];
    setPending("upload");
    setProgress(0);
    try {
      const mediaAssetId = await uploadMedia({
        api: session.api,
        uri: selected.uri,
        fileName: selected.fileName ?? `${mediaRole.replace(/\./g, "-")}-${Date.now()}.jpg`,
        contentType: selected.mimeType ?? "image/jpeg",
        ownerUserId: session.context!.user.id,
        assetTypeKey: `media.${mediaRole}`,
        onProgress: setProgress,
      });
      await publish(mediaAssetId, fit);
      await links.refetch();
      setMessage(`${label} updated. This image is separate from verification and KYC media.`);
    } catch (cause) {
      setMessage(friendlyError(cause, `${label} could not be updated.`));
    } finally {
      setPending(null);
    }
  };

  const changeFit = async (nextFit: ImageFit) => {
    setFitOverride(nextFit);
    setMessage(null);
    if (!assetId || !editable) return;
    setPending("fit");
    try {
      await publish(assetId, nextFit);
      await links.refetch();
      setMessage("Image fit updated.");
    } catch (cause) {
      setFitOverride(null);
      setMessage(friendlyError(cause, "Image fit could not be updated."));
    } finally {
      setPending(null);
    }
  };

  const remove = async () => {
    setMessage(null);
    setPending("remove");
    try {
      const result = await session.supabase.rpc("remove_public_entity_media", {
        target_entity_type: entityType,
        target_entity_id: entityId,
        target_media_role: mediaRole,
      });
      if (result.error) throw result.error;
      setFitOverride(null);
      await links.refetch();
      setMessage(`${label} removed from the public profile.`);
    } catch (cause) {
      setMessage(friendlyError(cause, `${label} could not be removed.`));
    } finally {
      setPending(null);
    }
  };

  return (
    <View style={[styles.panel, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <View style={styles.headingRow}>
        <View style={[styles.headingIcon, { backgroundColor: palette.brandSoft }]}>
          <ImagePlus color={palette.brand} size={20} />
        </View>
        <View style={styles.headingCopy}>
          <Text style={[styles.title, { color: palette.ink }]}>{title}</Text>
          <Text style={[styles.description, { color: palette.muted }]}>{description}</Text>
        </View>
      </View>

      <RuntimeMediaImage
        assetId={assetId}
        label={label}
        variant={variant}
        contentFit={contentFit}
        previewable
      />

      {assetId ? (
        <View style={[styles.previewHint, { backgroundColor: palette.surfaceSubtle }]}>
          <Maximize2 color={palette.mutedStrong} size={15} />
          <Text style={[styles.previewHintText, { color: palette.muted }]}>Tap the image for a full-screen preview.</Text>
        </View>
      ) : null}

      {editable ? (
        <>
          <Text style={[styles.controlLabel, { color: palette.mutedStrong }]}>Image fit</Text>
          <View style={styles.fitRow}>
            {FIT_OPTIONS.map((option) => {
              const active = option.key === fit;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  disabled={pending !== null}
                  key={option.key}
                  onPress={() => void changeFit(option.key)}
                  style={({ pressed }) => [
                    styles.fitChip,
                    {
                      backgroundColor: active ? palette.brandSoft : palette.surfaceSubtle,
                      borderColor: active ? palette.brand : palette.border,
                      opacity: pressed ? 0.75 : 1,
                    },
                  ]}
                >
                  <Text style={[styles.fitLabel, { color: active ? palette.brand : palette.ink }]}>{option.label}</Text>
                  <Text style={[styles.fitDetail, { color: palette.muted }]}>{option.detail}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              disabled={pending !== null}
              onPress={() => void choose()}
              style={({ pressed }) => [styles.primaryAction, { backgroundColor: palette.brand, opacity: pressed ? 0.78 : pending !== null ? 0.55 : 1 }]}
            >
              {pending === "upload" ? <ActivityIndicator color="#FFFFFF" /> : <Camera color="#FFFFFF" size={17} />}
              <Text style={styles.primaryText}>
                {pending === "upload" ? `Uploading ${Math.round(progress * 100)}%` : assetId ? "Change image" : "Upload image"}
              </Text>
            </Pressable>
            {assetId ? (
              <Pressable
                accessibilityRole="button"
                disabled={pending !== null}
                onPress={() => void remove()}
                style={({ pressed }) => [styles.secondaryAction, { borderColor: palette.border, opacity: pressed ? 0.72 : pending !== null ? 0.55 : 1 }]}
              >
                {pending === "remove" ? <ActivityIndicator color={palette.danger} /> : <Trash2 color={palette.danger} size={17} />}
                <Text style={[styles.secondaryText, { color: palette.danger }]}>Remove</Text>
              </Pressable>
            ) : null}
          </View>
          <Text style={[styles.privacyNote, { color: palette.muted }]}>Crop/reposition is available when selecting a new image. SKIMA will never automatically use a KYC or verification image here.</Text>
        </>
      ) : capability.isPending ? (
        <View style={styles.capabilityRow}><ActivityIndicator color={palette.brand} /><Text style={[styles.capabilityText, { color: palette.muted }]}>Checking image permissions…</Text></View>
      ) : (
        <Text style={[styles.privacyNote, { color: palette.muted }]}>This public image is read-only for your current role.</Text>
      )}

      {message ? <Text accessibilityRole="alert" style={[styles.message, { color: message.includes("updated") || message.includes("removed") ? palette.success : palette.danger }]}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.md },
  headingRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  headingIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  headingCopy: { flex: 1, minWidth: 0, gap: 3 },
  title: { ...typography.subheading, fontSize: 15 },
  description: { ...typography.caption, lineHeight: 17 },
  previewHint: { minHeight: 34, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderRadius: radii.md, paddingHorizontal: spacing.sm + 2 },
  previewHintText: { ...typography.caption, flex: 1, fontSize: 10 },
  controlLabel: { ...typography.eyebrow, fontSize: 9 },
  fitRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  fitChip: { flexGrow: 1, minWidth: 92, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: 11, paddingVertical: 9, gap: 2 },
  fitLabel: { ...typography.bodyStrong, fontSize: 11 },
  fitDetail: { ...typography.caption, fontSize: 9 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  primaryAction: { minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, borderRadius: radii.md, paddingHorizontal: spacing.md },
  primaryText: { color: "#FFFFFF", ...typography.bodyStrong, fontSize: 12 },
  secondaryAction: { minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, borderRadius: radii.md, borderWidth: 1, paddingHorizontal: spacing.md },
  secondaryText: { ...typography.bodyStrong, fontSize: 12 },
  privacyNote: { ...typography.caption, lineHeight: 17 },
  capabilityRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  capabilityText: { ...typography.caption },
  message: { ...typography.caption, lineHeight: 17, fontWeight: "800" },
});
