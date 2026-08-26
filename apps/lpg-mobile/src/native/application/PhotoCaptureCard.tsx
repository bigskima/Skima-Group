import * as ImagePicker from "expo-image-picker";
import { Camera, CheckCircle2, Images, UserCheck } from "lucide-react-native";
import { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { AppButton } from "../ui/AppButton";

export interface PhotoCaptureCardProps {
  title: string;
  subtitle: string;
  photoUrl?: string | null;
  guidanceText?: string;
  onPhotoSelected: (file: { uri: string; name: string; mimeType: string }) => Promise<void>;
}

export function PhotoCaptureCard({
  title,
  subtitle,
  photoUrl,
  guidanceText = "Face must be clearly visible, centered, with no sunglasses or face coverings.",
  onPhotoSelected,
}: PhotoCaptureCardProps) {
  const { palette } = useAppTheme();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const capturePhoto = async () => {
    setError(null);
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        setError("Camera permission is required to capture your photo.");
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [4, 5], quality: 0.9 });
      if (result.canceled) return;
      const asset = result.assets[0];
      setLoading(true);
      await onPhotoSelected({ uri: asset.uri, name: `profile-photo-${Date.now()}.jpg`, mimeType: "image/jpeg" });
    } catch (cause) {
      setError(friendlyError(cause, "We couldn't take the photo. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  const pickLibraryPhoto = async () => {
    setError(null);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setError("Photo library permission is required.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({ allowsEditing: true, aspect: [4, 5], quality: 0.9 });
      if (result.canceled) return;
      const asset = result.assets[0];
      setLoading(true);
      await onPhotoSelected({ uri: asset.uri, name: `profile-photo-${Date.now()}.jpg`, mimeType: "image/jpeg" });
    } catch (cause) {
      setError(friendlyError(cause, "We couldn't select the photo. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.card, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <View style={styles.head}>
        <View style={[styles.headIcon, { backgroundColor: palette.brandSoft }]}>
          <UserCheck color={palette.brand} size={21} />
        </View>
        <View style={styles.headCopy}>
          <Text style={[styles.title, { color: palette.ink }]}>{title}</Text>
          <Text style={[styles.subtitle, { color: palette.muted }]}>{subtitle}</Text>
        </View>
      </View>

      <View style={styles.frameContainer}>
        {photoUrl ? (
          <View style={[styles.photoWrap, { borderColor: palette.brand }]}>
            <Image source={{ uri: photoUrl }} resizeMode="cover" style={styles.photo} />
            <View style={styles.photoBadge}>
              <CheckCircle2 color="#FFFFFF" size={14} />
              <Text style={styles.photoBadgeText}>Photo ready</Text>
            </View>
          </View>
        ) : (
          <View style={[styles.emptyFrame, { borderColor: palette.borderStrong, backgroundColor: palette.surfaceSubtle }]}>
            <View style={[styles.cameraBubble, { backgroundColor: palette.brandSoft }]}>
              <Camera color={palette.brand} size={30} />
            </View>
            <Text style={[styles.emptyFrameTitle, { color: palette.ink }]}>Center your face in frame</Text>
            <Text style={[styles.emptyFrameText, { color: palette.muted }]}>Use a bright, clear background and look directly at the camera.</Text>
          </View>
        )}
      </View>

      <View style={[styles.guidanceBox, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
        <Text style={[styles.guidanceLabel, { color: palette.mutedStrong }]}>PHOTO GUIDANCE</Text>
        <Text style={[styles.guidanceText, { color: palette.muted }]}>{guidanceText}</Text>
      </View>

      {error ? <Text style={[styles.errorText, { color: palette.danger }]}>{error}</Text> : null}

      <View style={styles.btnRow}>
        <View style={styles.buttonSlot}>
          <AppButton
            label={photoUrl ? "Retake photo" : "Take photo"}
            loading={loading}
            disabled={loading}
            icon={<Camera color="#FFFFFF" size={16} />}
            onPress={() => void capturePhoto()}
          />
        </View>
        <View style={styles.buttonSlot}>
          <AppButton
            label="Choose photo"
            variant="secondary"
            disabled={loading}
            icon={<Images color={palette.ink} size={16} />}
            onPress={() => void pickLibraryPhoto()}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radii.lg, padding: spacing.md, borderWidth: StyleSheet.hairlineWidth, gap: spacing.md, marginBottom: spacing.sm },
  head: { flexDirection: "row", gap: spacing.sm + 2, alignItems: "center" },
  headIcon: { width: 42, height: 42, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  headCopy: { flex: 1, gap: 2 },
  title: { ...typography.subheading, fontSize: 15 },
  subtitle: { ...typography.caption, lineHeight: 17 },
  frameContainer: { alignItems: "center", justifyContent: "center", paddingVertical: spacing.xs },
  photoWrap: { width: 154, height: 192, borderRadius: radii.lg, overflow: "hidden", borderWidth: 2, position: "relative" },
  photo: { width: "100%", height: "100%" },
  photoBadge: { position: "absolute", bottom: 8, alignSelf: "center", backgroundColor: "rgba(20,20,22,.78)", paddingHorizontal: 9, paddingVertical: 5, borderRadius: radii.pill, flexDirection: "row", gap: 5, alignItems: "center" },
  photoBadgeText: { color: "#FFFFFF", ...typography.caption, fontSize: 10, fontWeight: "800" },
  emptyFrame: { width: "100%", minHeight: 190, borderRadius: radii.lg, borderWidth: 1, borderStyle: "dashed", alignItems: "center", justifyContent: "center", gap: 7, padding: spacing.lg },
  cameraBubble: { width: 64, height: 64, borderRadius: 24, alignItems: "center", justifyContent: "center", marginBottom: 2 },
  emptyFrameTitle: { ...typography.bodyStrong, textAlign: "center" },
  emptyFrameText: { ...typography.caption, textAlign: "center", maxWidth: 300 },
  guidanceBox: { padding: spacing.md, borderRadius: radii.md, borderWidth: StyleSheet.hairlineWidth, gap: 4 },
  guidanceLabel: { ...typography.eyebrow, fontSize: 9 },
  guidanceText: { ...typography.caption, lineHeight: 17 },
  btnRow: { flexDirection: "row", gap: spacing.sm },
  buttonSlot: { flex: 1 },
  errorText: { ...typography.caption, fontWeight: "700" },
});
