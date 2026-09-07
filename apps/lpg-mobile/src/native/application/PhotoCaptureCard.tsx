import {
  CameraView,
  useCameraPermissions,
} from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { Camera, CheckCircle2, Images, RotateCcw, UserCheck, X } from "lucide-react-native";
import { useRef, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
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
  const cameraRef = useRef<CameraView | null>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [cameraOpen, setCameraOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openCamera = async () => {
    setError(null);
    try {
      let permission = cameraPermission;
      if (!permission?.granted) {
        permission = await requestCameraPermission();
      }
      if (!permission.granted) {
        setError("Camera permission is required to capture your face.");
        return;
      }
      setCameraOpen(true);
    } catch (cause) {
      setError(friendlyError(cause, "SKIMA could not open the camera. Please try again."));
    }
  };

  const capturePhoto = async () => {
    if (!cameraRef.current || loading) return;
    setError(null);
    setLoading(true);
    try {
      const result = await cameraRef.current.takePictureAsync({
        quality: 0.9,
        shutterSound: false,
      });
      if (!result?.uri) {
        throw new Error("The camera did not return a photo.");
      }
      await onPhotoSelected({
        uri: result.uri,
        name: `profile-photo-${Date.now()}.jpg`,
        mimeType: "image/jpeg",
      });
      setCameraOpen(false);
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
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [4, 5],
        quality: 0.9,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      setLoading(true);
      await onPhotoSelected({
        uri: asset.uri,
        name: asset.fileName ?? `profile-photo-${Date.now()}.jpg`,
        mimeType: asset.mimeType ?? "image/jpeg",
      });
      setCameraOpen(false);
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
        {cameraOpen ? (
          <View style={styles.cameraWrap}>
            <CameraView
              ref={cameraRef}
              facing="front"
              mode="picture"
              style={styles.camera}
            />
            <View pointerEvents="none" style={styles.faceGuide}>
              <View style={styles.faceOval} />
              <Text style={styles.faceGuideText}>Keep your full face inside the guide</Text>
            </View>
            <Pressable
              accessibilityLabel="Close camera"
              onPress={() => setCameraOpen(false)}
              style={styles.closeCamera}
            >
              <X color="#FFFFFF" size={20} />
            </Pressable>
            <Pressable
              accessibilityLabel="Capture face photo"
              disabled={loading}
              onPress={() => void capturePhoto()}
              style={({ pressed }) => [
                styles.shutter,
                pressed && styles.shutterPressed,
                loading && styles.disabled,
              ]}
            >
              <View style={styles.shutterInner} />
            </Pressable>
          </View>
        ) : photoUrl ? (
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

      {!cameraOpen ? (
        <View style={styles.btnRow}>
          <View style={styles.buttonSlot}>
            <AppButton
              label={photoUrl ? "Retake photo" : "Take photo"}
              loading={loading}
              disabled={loading}
              icon={photoUrl ? <RotateCcw color="#FFFFFF" size={16} /> : <Camera color="#FFFFFF" size={16} />}
              onPress={() => void openCamera()}
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
      ) : (
        <Text style={[styles.cameraHint, { color: palette.muted }]}>
          Use the front camera for a clear profile photo. Identity liveness remains a separate private verification check.
        </Text>
      )}
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
  frameContainer: { alignItems: "center", justifyContent: "center", paddingVertical: spacing.xs, width: "100%" },
  cameraWrap: {
    width: "100%",
    maxWidth: 360,
    aspectRatio: 4 / 5,
    borderRadius: radii.lg,
    overflow: "hidden",
    backgroundColor: "#050706",
    position: "relative",
  },
  camera: { flex: 1 },
  faceGuide: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: 68,
  },
  faceOval: {
    width: "56%",
    aspectRatio: 0.76,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,.92)",
    borderRadius: 999,
  },
  faceGuideText: {
    position: "absolute",
    left: 20,
    right: 20,
    bottom: 76,
    color: "#FFFFFF",
    textAlign: "center",
    fontSize: 11,
    fontWeight: "800",
    textShadowColor: "rgba(0,0,0,.65)",
    textShadowRadius: 5,
  },
  closeCamera: {
    position: "absolute",
    right: 12,
    top: 12,
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,.55)",
  },
  shutter: {
    position: "absolute",
    bottom: 14,
    alignSelf: "center",
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 4,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,.2)",
  },
  shutterInner: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#FFFFFF",
  },
  shutterPressed: { transform: [{ scale: 0.94 }] },
  disabled: { opacity: 0.55 },
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
  cameraHint: { ...typography.caption, textAlign: "center", lineHeight: 17 },
});
