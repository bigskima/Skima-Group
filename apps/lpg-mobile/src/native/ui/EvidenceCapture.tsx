import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import { Camera, ImagePlus, RotateCcw } from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { uploadMedia } from "../media/upload";
import { useSession } from "../session/SessionProvider";
import { draftStore } from "../storage/drafts";
import { colors, radii, spacing } from "../theme/tokens";

export function EvidenceCapture({
  assetTypeKey,
  label,
  draftType,
  onUploaded,
}: {
  assetTypeKey: string;
  label: string;
  draftType: string;
  onUploaded(id: string): Promise<void>;
}) {
  const session = useSession();
  const [asset, setAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [uploadedAssetId, setUploadedAssetId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const owner = session.context?.profile?.id ?? session.context?.user.id ?? "";
  useEffect(() => {
    if (!owner) return;
    void draftStore.load(owner, draftType).then((draft) => {
      const pendingAsset = draft?.pendingMedia[0];
      if (pendingAsset)
        setAsset({
          uri: pendingAsset.uri,
          width: 0,
          height: 0,
          fileName: `evidence-${Date.now()}.jpg`,
          mimeType: "image/jpeg",
        });
      if (typeof draft?.values.mediaAssetId === "string")
        setUploadedAssetId(draft.values.mediaAssetId);
    });
  }, [draftType, owner]);
  const remember = async (next: ImagePicker.ImagePickerAsset) => {
    setAsset(next);
    setUploadedAssetId(null);
    if (!owner) return;
    const now = new Date().toISOString();
    await draftStore.save({
      version: 1,
      type: draftType,
      ownerProfileId: owner,
      step: "pending-upload",
      values: {},
      pendingMedia: [{ uri: next.uri, purpose: assetTypeKey }],
      createdAt: now,
      updatedAt: now,
    });
  };
  const capture = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError("Camera permission is required for operational evidence.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 1,
      allowsEditing: false,
    });
    if (!result.canceled) await remember(result.assets[0]);
  };
  const choose = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("Photo-library permission was not granted.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 1,
      allowsEditing: false,
    });
    if (!result.canceled) await remember(result.assets[0]);
  };
  const upload = async () => {
    if ((!asset && !uploadedAssetId) || !session.context) return;
    setPending(true);
    setProgress(uploadedAssetId ? 1 : 0);
    setError(null);
    try {
      let id = uploadedAssetId;
      if (!id && asset) {
        id = await uploadMedia({
          api: session.api,
          uri: asset.uri,
          fileName: asset.fileName ?? `evidence-${Date.now()}.jpg`,
          contentType: asset.mimeType ?? "image/jpeg",
          ownerUserId: session.context.user.id,
          assetTypeKey,
          onProgress: setProgress,
        });
        setUploadedAssetId(id);
        const now = new Date().toISOString();
        await draftStore.save({
          version: 1,
          type: draftType,
          ownerProfileId: owner,
          step: "uploaded-awaiting-registration",
          values: { mediaAssetId: id },
          pendingMedia: [{ uri: asset.uri, purpose: assetTypeKey }],
          createdAt: now,
          updatedAt: now,
        });
      }
      if (!id)
        throw new Error(
          "The secure evidence asset is unavailable. Select the evidence again.",
        );
      await onUploaded(id);
      await draftStore.clear(owner, draftType);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Evidence upload failed. Retry before continuing.",
      );
    } finally {
      setPending(false);
      setProgress(null);
    }
  };
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{label}</Text>
      <Text style={styles.body}>
        Original evidence is preserved. It is never sent for AI presentation
        processing.
      </Text>
      {asset ? (
        <Image
          source={asset.uri}
          contentFit="cover"
          style={styles.image}
          transition={150}
        />
      ) : (
        <View style={styles.placeholder}>
          <Camera color={colors.muted} size={30} />
          <Text style={styles.body}>
            {uploadedAssetId
              ? "Secure upload ready for backend registration"
              : "No evidence captured"}
          </Text>
        </View>
      )}
      <View style={styles.row}>
        <Pressable onPress={() => void capture()} style={styles.secondary}>
          <Camera color={colors.brand} size={18} />
          <Text style={styles.secondaryText}>
            {asset ? "Recapture" : "Use camera"}
          </Text>
        </Pressable>
        <Pressable onPress={() => void choose()} style={styles.secondary}>
          <ImagePlus color={colors.brand} size={18} />
          <Text style={styles.secondaryText}>Choose</Text>
        </Pressable>
      </View>
      {asset || uploadedAssetId ? (
        <Pressable
          disabled={pending}
          onPress={() => void upload()}
          style={styles.primary}
        >
          {pending ? (
            <View style={styles.uploading}>
              <ActivityIndicator color="white" />
              <Text style={styles.primaryText}>
                {uploadedAssetId
                  ? "Registering securely"
                  : `Uploading ${Math.round((progress ?? 0) * 100)}%`}
              </Text>
            </View>
          ) : (
            <Text style={styles.primaryText}>
              {uploadedAssetId
                ? "Retry backend registration"
                : "Upload authentic evidence"}
            </Text>
          )}
        </Pressable>
      ) : null}
      {error ? (
        <View style={styles.errorRow}>
          <RotateCcw color={colors.danger} size={18} />
          <Text style={styles.error}>{error}</Text>
        </View>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  wrap: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  title: { color: colors.ink, fontSize: 18, fontWeight: "900" },
  body: { color: colors.muted, lineHeight: 20 },
  image: {
    width: "100%",
    aspectRatio: 4 / 3,
    borderRadius: radii.md,
    backgroundColor: "#E9ECEA",
  },
  placeholder: {
    height: 180,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: "#EEF1EF",
  },
  row: { flexDirection: "row", gap: spacing.sm },
  secondary: {
    flex: 1,
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: radii.md,
  },
  secondaryText: { color: colors.brand, fontWeight: "800" },
  primary: {
    minHeight: 54,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: colors.brand,
  },
  primaryText: { color: "white", fontWeight: "900" },
  uploading: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  errorRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  error: { flex: 1, color: colors.danger },
});
