import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import { Camera, Trash2, UserRound } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { ActionResponseSchema } from "../api/records";
import { uploadMedia } from "../media/upload";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { colors, radii, spacing } from "../theme/tokens";
import { RuntimeMediaImage } from "./RuntimeMediaImage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function ProfilePhotoEditor() {
  const session = useSession();
  const { palette } = useAppTheme();
  const [pending, setPending] = useState<"upload" | "delete" | null>(null);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const avatar = session.context?.profile?.avatar_url ?? null;

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
    setPending("upload");
    setProgress(0);
    try {
      const mediaAssetId = await uploadMedia({
        api: session.api,
        uri: selected.uri,
        fileName: selected.fileName ?? `profile-${Date.now()}.jpg`,
        contentType: selected.mimeType ?? "image/jpeg",
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
      setMessage("Profile image updated.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Profile image could not be updated.");
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
      setMessage("Profile image deleted.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Profile image could not be deleted.");
    } finally {
      setPending(null);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={[styles.avatarShell, { backgroundColor: palette.soft, borderColor: palette.border }]}>
        {avatar && UUID.test(avatar) ? (
          <RuntimeMediaImage assetId={avatar} label="Profile image" variant="avatar" />
        ) : avatar ? (
          <Image source={avatar} contentFit="cover" style={styles.avatar} accessibilityLabel="Profile image" />
        ) : (
          <UserRound color={palette.muted} size={42} />
        )}
      </View>
      <View style={styles.actions}>
        <Pressable disabled={pending !== null} onPress={() => void choose()} style={styles.primary}>
          {pending === "upload" ? <ActivityIndicator color="white" /> : <Camera color="white" size={18} />}
          <Text style={styles.primaryText}>{pending === "upload" ? `Uploading ${Math.round(progress * 100)}%` : avatar ? "Change photo" : "Upload photo"}</Text>
        </Pressable>
        {avatar ? (
          <Pressable disabled={pending !== null} onPress={() => void remove()} style={[styles.delete, { borderColor: palette.border }]}>
            {pending === "delete" ? <ActivityIndicator color={colors.danger} /> : <Trash2 color={colors.danger} size={18} />}
            <Text style={styles.deleteText}>Delete</Text>
          </Pressable>
        ) : null}
      </View>
      {message ? <Text accessibilityRole="alert" style={[styles.message, { color: message.includes("updated") || message.includes("deleted") ? colors.success : colors.danger }]}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: spacing.md },
  avatarShell: { width: 104, height: 104, borderRadius: 52, borderWidth: 4, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  avatar: { width: 96, height: 96, borderRadius: 48 },
  actions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: spacing.sm },
  primary: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radii.pill, backgroundColor: colors.brand },
  primaryText: { color: "white", fontWeight: "900" },
  delete: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radii.pill, borderWidth: 1 },
  deleteText: { color: colors.danger, fontWeight: "900" },
  message: { fontWeight: "700", textAlign: "center" },
});
