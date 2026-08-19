import * as ImagePicker from "expo-image-picker";
import { Camera, CheckCircle2, RefreshCw, UserCheck } from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { colors, radii, spacing } from "../theme/tokens";

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
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [4, 5],
        quality: 0.9,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      setLoading(true);
      await onPhotoSelected({
        uri: asset.uri,
        name: `profile-photo-${Date.now()}.jpg`,
        mimeType: "image/jpeg",
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not capture photo.");
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
        allowsEditing: true,
        aspect: [4, 5],
        quality: 0.9,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      setLoading(true);
      await onPhotoSelected({
        uri: asset.uri,
        name: `profile-photo-${Date.now()}.jpg`,
        mimeType: "image/jpeg",
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not select photo.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={styles.headIcon}>
          <UserCheck color={colors.brand} size={22} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
      </View>

      <View style={styles.frameContainer}>
        {photoUrl ? (
          <View style={styles.photoWrap}>
            <Image source={{ uri: photoUrl }} style={styles.photo} />
            <View style={styles.photoBadge}>
              <CheckCircle2 color="white" size={14} />
              <Text style={styles.photoBadgeText}>Photo Captured</Text>
            </View>
          </View>
        ) : (
          <View style={styles.emptyFrame}>
            <Camera color={colors.muted} size={40} />
            <Text style={styles.emptyFrameText}>Center face within frame</Text>
          </View>
        )}
      </View>

      <View style={styles.guidanceBox}>
        <Text style={styles.guidanceText}>{guidanceText}</Text>
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <View style={styles.btnRow}>
        <Pressable
          disabled={loading}
          onPress={() => void capturePhoto()}
          style={styles.primaryBtn}
        >
          {loading ? (
            <ActivityIndicator color="white" size="small" />
          ) : (
            <>
              <Camera color="white" size={16} />
              <Text style={styles.primaryBtnText}>
                {photoUrl ? "Retake Photo" : "Take Photo"}
              </Text>
            </>
          )}
        </Pressable>

        <Pressable
          disabled={loading}
          onPress={() => void pickLibraryPhoto()}
          style={styles.secondaryBtn}
        >
          <RefreshCw color={colors.brand} size={15} />
          <Text style={styles.secondaryBtnText}>Choose from Gallery</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  head: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
  },
  headIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FFF0F1",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 16,
    fontWeight: "900",
    color: colors.ink,
  },
  subtitle: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
  frameContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.sm,
  },
  photoWrap: {
    width: 140,
    height: 175,
    borderRadius: 20,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: colors.brand,
    position: "relative",
  },
  photo: {
    width: "100%",
    height: "100%",
  },
  photoBadge: {
    position: "absolute",
    bottom: 6,
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.75)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
    flexDirection: "row",
    gap: 4,
    alignItems: "center",
  },
  photoBadgeText: {
    color: "white",
    fontSize: 10,
    fontWeight: "800",
  },
  emptyFrame: {
    width: 140,
    height: 175,
    borderRadius: 20,
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: colors.border,
    backgroundColor: "#FAFAFA",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: 8,
  },
  emptyFrameText: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.muted,
    textAlign: "center",
  },
  guidanceBox: {
    backgroundColor: "#F9FAFB",
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  guidanceText: {
    fontSize: 12,
    color: colors.muted,
    lineHeight: 17,
  },
  btnRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  primaryBtn: {
    flex: 1,
    minHeight: 46,
    backgroundColor: colors.brand,
    borderRadius: radii.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  primaryBtnText: {
    color: "white",
    fontSize: 13,
    fontWeight: "900",
  },
  secondaryBtn: {
    flex: 1,
    minHeight: 46,
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: radii.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  secondaryBtnText: {
    color: colors.brand,
    fontSize: 13,
    fontWeight: "800",
  },
  errorText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: "700",
  },
});
