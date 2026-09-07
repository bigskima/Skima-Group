import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { Camera, ImagePlus } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { domainQueries } from "../api/domains";
import { useGatewayMutation } from "../api/gateway";
import { ActionResponseSchema, displayReference, firstString, recordId } from "../api/records";
import { uploadMedia } from "../media/upload";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { idempotencyKey } from "../utilities/idempotency";
import { AppButton } from "./AppButton";
import { EmptyState } from "./EmptyState";
import { PresentationMediaPanel } from "./PresentationMediaPanel";
import { RuntimeMediaImage } from "./RuntimeMediaImage";
import { Screen } from "./Screen";
import { ScreenSkeleton } from "./ScreenSkeleton";

type PickedPhoto = { uri: string; fileName: string; mimeType: string };

export function CylinderMediaScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const session = useSession();
  const { palette } = useAppTheme();
  const cylinders = domainQueries.cylinders();
  const cylinder = cylinders.data?.find((item) => recordId(item) === id || displayReference(item) === id);
  const cylinderId = cylinder ? recordId(cylinder) : null;
  const currentAssetId = cylinder ? firstAssetId(cylinder.image_asset_ids ?? cylinder.imageAssetIds) : null;
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageError, setMessageError] = useState(false);

  const primaryMedia = useGatewayMutation({
    path: "/lpg/cylinders/media/primary",
    schema: ActionResponseSchema,
    invalidate: [["cylinders"]],
  });

  const apply = (asset: ImagePicker.ImagePickerAsset) => {
    setPhoto({
      uri: asset.uri,
      fileName: asset.fileName ?? "cylinder-" + Date.now() + ".jpg",
      mimeType: asset.mimeType ?? "image/jpeg",
    });
    setMessage(null);
    setMessageError(false);
  };

  const takePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setMessageError(true);
      setMessage("Camera permission is needed to take a cylinder photo.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      quality: 0.9,
    });
    if (!result.canceled) apply(result.assets[0]);
  };

  const choosePhoto = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setMessageError(true);
      setMessage("Photo permission is needed to choose a cylinder image.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      quality: 0.9,
    });
    if (!result.canceled) apply(result.assets[0]);
  };

  const upload = async () => {
    if (!photo || !cylinderId || uploading) return;
    setUploading(true);
    setMessage(null);
    setMessageError(false);
    try {
      const ownerUserId = session.context?.user.id ?? session.session?.user.id;
      if (!ownerUserId) throw new Error("Please sign in again.");
      const assetId = await uploadMedia({
        api: session.api,
        uri: photo.uri,
        fileName: photo.fileName,
        contentType: photo.mimeType,
        ownerUserId,
        assetTypeKey: "lpg.cylinder.original",
      });
      await primaryMedia.mutateAsync({
        cylinderId,
        mediaAssetId: assetId,
        source: "skima.lpg.customer_media",
        metadata: { updateMode: currentAssetId ? "replace" : "add" },
        idempotencyKey: idempotencyKey("cylinder-primary-image", cylinderId + ":" + Date.now()),
      });
      setPhoto(null);
      await cylinders.refetch();
      setMessage("Cylinder photo updated. You can replace it again whenever needed.");
    } catch (cause) {
      setMessageError(true);
      setMessage(friendlyError(cause, "The cylinder photo could not be updated. Please try again."));
    } finally {
      setUploading(false);
    }
  };

  if (cylinders.isPending) {
    return <Screen eyebrow="Cylinder media" title="Photo & AI image"><ScreenSkeleton cards={2} /></Screen>;
  }
  if (!cylinder || !cylinderId) {
    return (
      <Screen eyebrow="Cylinder media" title="Photo & AI image">
        <EmptyState title="Cylinder unavailable" description="This cylinder is no longer available." />
      </Screen>
    );
  }

  return (
    <Screen
      eyebrow="Cylinder media"
      title="Photo & AI image"
      subtitle="Add or replace your original photo whenever needed. AI generation also works when no photo has been uploaded."
      action={<AppButton label="Back" variant="ghost" size="sm" onPress={() => router.back()} />}
    >
      <View style={[styles.photoCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <RuntimeMediaImage assetId={currentAssetId} label="Current cylinder photo" variant="hero" />
        <View style={styles.actions}>
          <AppButton
            label={currentAssetId ? "Take replacement" : "Take photo"}
            size="sm"
            icon={<Camera color="#FFFFFF" size={16} />}
            onPress={() => void takePhoto()}
          />
          <AppButton
            label="Choose image"
            size="sm"
            variant="secondary"
            icon={<ImagePlus color={palette.brand} size={16} />}
            onPress={() => void choosePhoto()}
          />
        </View>
        {photo ? (
          <View style={styles.pending}>
            <Text style={[styles.pendingText, { color: palette.ink }]}>New image selected</Text>
            <AppButton
              label={currentAssetId ? "Replace cylinder photo" : "Upload cylinder photo"}
              fullWidth
              loading={uploading}
              onPress={() => void upload()}
            />
          </View>
        ) : null}
      </View>

      <PresentationMediaPanel
        subjectId={cylinderId}
        subjectType="lpg_cylinder"
        colour={firstString(cylinder, ["colour", "color"])}
        originalAssetId={currentAssetId}
      />

      {message ? (
        <Text accessibilityRole="alert" style={[styles.message, { color: messageError ? palette.danger : palette.success }]}>
          {message}
        </Text>
      ) : null}
    </Screen>
  );
}

function firstAssetId(value: unknown) {
  return Array.isArray(value)
    ? value.find((item): item is string => typeof item === "string") ?? null
    : null;
}

const styles = StyleSheet.create({
  photoCard: {
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.lg,
    padding: spacing.sm,
  },
  actions: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  pending: { gap: spacing.sm, paddingTop: 2 },
  pendingText: { ...typography.bodyStrong, fontSize: 12 },
  message: { ...typography.caption, fontWeight: "700", textAlign: "center" },
});
