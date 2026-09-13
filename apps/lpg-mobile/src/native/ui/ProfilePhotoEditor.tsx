import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import { Camera, Check, Trash2, UserRound, X } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { ActionResponseSchema } from "../api/records";
import { uploadMedia } from "../media/upload";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { colors, radii, spacing } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { RuntimeMediaImage } from "./RuntimeMediaImage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ProfilePhotoEditorVariant = "default" | "onBrand";
type SelectedPhoto = { uri: string; fileName: string | null; mimeType: string | null };

export function ProfilePhotoEditor({ variant = "default" }: { variant?: ProfilePhotoEditorVariant }) {
  const session = useSession();
  const { palette } = useAppTheme();
  const [pending, setPending] = useState<"upload" | "delete" | null>(null);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<SelectedPhoto | null>(null);
  const avatar = session.context?.profile?.avatar_url ?? null;
  const onBrand = variant === "onBrand";
  const controlColor = onBrand ? "#FFFFFF" : colors.danger;

  const choose = async () => {
    setMessage(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setMessage("Photo-library permission is required to choose a profile image.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.88,
    });
    if (result.canceled) return;

    const selected = result.assets[0];
    setCandidate({
      uri: selected.uri,
      fileName: selected.fileName ?? null,
      mimeType: selected.mimeType ?? null,
    });
    setMessage("Preview your photo, then save when it looks right.");
  };

  const saveCandidate = async () => {
    if (!candidate) return;
    setPending("upload");
    setProgress(0);
    setMessage(null);
    try {
      const mediaAssetId = await uploadMedia({
        api: session.api,
        uri: candidate.uri,
        fileName: candidate.fileName ?? `profile-${Date.now()}.jpg`,
        contentType: candidate.mimeType ?? "image/jpeg",
        ownerUserId: session.context!.user.id,
        assetTypeKey: "media.profile.avatar",
        onProgress: setProgress,
      });
      await session.api.post(
        "/runtime/profile/avatar",
        { mediaAssetId },
        ActionResponseSchema,
      );
      await session.refresh();
      setCandidate(null);
      setMessage("Profile image updated.");
    } catch (cause) {
      setMessage(friendlyError(cause, "Your profile image could not be updated."));
    } finally {
      setPending(null);
    }
  };

  const remove = async () => {
    setMessage(null);
    setPending("delete");
    try {
      await session.api.request("/runtime/profile/avatar", ActionResponseSchema, {
        method: "DELETE",
      });
      await session.refresh();
      setCandidate(null);
      setMessage("Profile image deleted.");
    } catch (cause) {
      setMessage(friendlyError(cause, "Your profile image could not be deleted."));
    } finally {
      setPending(null);
    }
  };

  const messageSucceeded = Boolean(message?.includes("updated") || message?.includes("deleted"));

  return (
    <View style={styles.wrap}>
      <View
        style={[
          styles.avatarShell,
          {
            backgroundColor: onBrand ? "rgba(255,255,255,.14)" : palette.soft,
            borderColor: onBrand ? "rgba(255,255,255,.92)" : palette.border,
          },
        ]}
      >
        {candidate ? (
          <Image source={candidate.uri} contentFit="cover" style={styles.avatar} accessibilityLabel="New profile image preview" />
        ) : avatar && UUID.test(avatar) ? (
          <RuntimeMediaImage assetId={avatar} label="Profile image" variant="avatar" previewable />
        ) : avatar ? (
          <Image source={avatar} contentFit="cover" style={styles.avatar} accessibilityLabel="Profile image" />
        ) : (
          <UserRound color={onBrand ? "rgba(255,255,255,.82)" : palette.muted} size={42} />
        )}
      </View>

      <View style={styles.actions}>
        {candidate ? (
          <>
            <Pressable
              disabled={pending !== null}
              onPress={() => void saveCandidate()}
              style={({ pressed }) => [
                styles.primary,
                {
                  backgroundColor: onBrand ? "rgba(255,255,255,.16)" : colors.brand,
                  borderColor: onBrand ? "rgba(255,255,255,.42)" : colors.brand,
                  opacity: pressed ? 0.76 : pending !== null ? 0.62 : 1,
                },
              ]}
            >
              {pending === "upload" ? <ActivityIndicator color="#FFFFFF" /> : <Check color="#FFFFFF" size={17} />}
              <Text numberOfLines={1} style={styles.primaryText}>
                {pending === "upload" ? `Uploading ${Math.round(progress * 100)}%` : "Save photo"}
              </Text>
            </Pressable>
            <Pressable
              disabled={pending !== null}
              onPress={() => {
                setCandidate(null);
                setMessage(null);
              }}
              style={({ pressed }) => [
                styles.delete,
                {
                  backgroundColor: onBrand ? "rgba(255,255,255,.08)" : "transparent",
                  borderColor: onBrand ? "rgba(255,255,255,.34)" : palette.border,
                  opacity: pressed ? 0.76 : pending !== null ? 0.62 : 1,
                },
              ]}
            >
              <X color={controlColor} size={17} />
              <Text numberOfLines={1} style={[styles.deleteText, { color: controlColor }]}>Cancel</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable
              disabled={pending !== null}
              onPress={() => void choose()}
              style={({ pressed }) => [
                styles.primary,
                {
                  backgroundColor: onBrand ? "rgba(255,255,255,.16)" : colors.brand,
                  borderColor: onBrand ? "rgba(255,255,255,.42)" : colors.brand,
                  opacity: pressed ? 0.76 : pending !== null ? 0.62 : 1,
                },
              ]}
            >
              <Camera color="#FFFFFF" size={17} />
              <Text numberOfLines={1} style={styles.primaryText}>{avatar ? "Change photo" : "Upload photo"}</Text>
            </Pressable>

            {avatar ? (
              <Pressable
                disabled={pending !== null}
                onPress={() => void remove()}
                style={({ pressed }) => [
                  styles.delete,
                  {
                    backgroundColor: onBrand ? "rgba(255,255,255,.08)" : "transparent",
                    borderColor: onBrand ? "rgba(255,255,255,.34)" : palette.border,
                    opacity: pressed ? 0.76 : pending !== null ? 0.62 : 1,
                  },
                ]}
              >
                {pending === "delete" ? <ActivityIndicator color={controlColor} /> : <Trash2 color={controlColor} size={17} />}
                <Text numberOfLines={1} style={[styles.deleteText, { color: controlColor }]}>Delete</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </View>

      {message ? (
        <Text
          accessibilityRole="alert"
          style={[
            styles.message,
            { color: onBrand ? "rgba(255,255,255,.92)" : messageSucceeded ? colors.success : candidate ? palette.mutedStrong : colors.danger },
          ]}
        >
          {message}
        </Text>
      ) : null}
      {!candidate ? (
        <Text style={[styles.privacy, { color: onBrand ? "rgba(255,255,255,.72)" : palette.muted }]}>
          This account photo is separate from KYC, identity documents and verification evidence.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: spacing.md, maxWidth: "100%" },
  avatarShell: { width: 104, height: 104, borderRadius: 52, borderWidth: 4, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  avatar: { width: 96, height: 96, borderRadius: 48 },
  actions: { maxWidth: "100%", flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: spacing.sm },
  primary: { minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radii.pill, borderWidth: StyleSheet.hairlineWidth },
  primaryText: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  delete: { minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radii.pill, borderWidth: StyleSheet.hairlineWidth },
  deleteText: { fontSize: 13, fontWeight: "900" },
  message: { maxWidth: 300, fontSize: 12, lineHeight: 17, fontWeight: "700", textAlign: "center" },
  privacy: { maxWidth: 310, fontSize: 10, lineHeight: 14, textAlign: "center" },
});
