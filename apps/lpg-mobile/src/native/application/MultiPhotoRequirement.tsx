import * as ImagePicker from "expo-image-picker";
import { Camera, CheckCircle2, Image as ImageIcon, Sparkles } from "lucide-react-native";
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

export interface StationPhotoView {
  key: string;
  title: string;
  description: string;
  isRequired: boolean;
  uploadedUrl?: string | null;
  uploadedId?: string | null;
  replacementRequested?: boolean;
  replacementReason?: string | null;
}

export interface MultiPhotoRequirementProps {
  views: StationPhotoView[];
  onUploadView: (viewKey: string, file: { uri: string; name: string; mimeType: string }) => Promise<void>;
}

export function MultiPhotoRequirement({
  views,
  onUploadView,
}: MultiPhotoRequirementProps) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCapture = async (viewKey: string) => {
    setError(null);
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        setError("Camera permission is required.");
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        quality: 0.9,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      setUploadingKey(viewKey);
      await onUploadView(viewKey, {
        uri: asset.uri,
        name: `${viewKey}-${Date.now()}.jpg`,
        mimeType: "image/jpeg",
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Upload failed.");
    } finally {
      setUploadingKey(null);
    }
  };

  const handlePick = async (viewKey: string) => {
    setError(null);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setError("Photo library permission is required.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.9,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      setUploadingKey(viewKey);
      await onUploadView(viewKey, {
        uri: asset.uri,
        name: `${viewKey}-${Date.now()}.jpg`,
        mimeType: "image/jpeg",
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Upload failed.");
    } finally {
      setUploadingKey(null);
    }
  };

  const requiredCount = views.filter((v) => v.isRequired).length;
  const completedRequired = views.filter((v) => v.isRequired && v.uploadedUrl).length;

  return (
    <View style={styles.container}>
      <View style={styles.summaryBar}>
        <Text style={styles.summaryTitle}>Premises Photographs</Text>
        <Text style={styles.summaryCount}>
          {completedRequired} of {requiredCount} required photos uploaded
        </Text>
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <View style={styles.grid}>
        {views.map((v) => {
          const isUploaded = Boolean(v.uploadedUrl);
          const isUploading = uploadingKey === v.key;

          return (
            <View key={v.key} style={styles.card}>
              <View style={styles.cardMedia}>
                {v.uploadedUrl ? (
                  <Image source={{ uri: v.uploadedUrl }} style={styles.image} />
                ) : (
                  <View style={styles.placeholder}>
                    <ImageIcon color={colors.muted} size={28} />
                    <Text style={styles.placeholderText}>Not uploaded</Text>
                  </View>
                )}

                <View style={[styles.tag, v.isRequired ? styles.tagRequired : styles.tagOptional]}>
                  <Text style={[styles.tagText, v.isRequired ? styles.tagTextRequired : styles.tagTextOptional]}>
                    {v.isRequired ? "Required" : "Optional Bonus"}
                  </Text>
                </View>

                {isUploaded ? (
                  <View style={styles.checkedBadge}>
                    <CheckCircle2 color="white" size={14} />
                  </View>
                ) : null}
              </View>

              <View style={styles.cardContent}>
                <Text style={styles.viewTitle}>{v.title}</Text>
                <Text style={styles.viewDesc}>{v.description}</Text>

                {v.replacementReason ? (
                  <Text style={styles.reasonText}>⚠️ {v.replacementReason}</Text>
                ) : null}

                <View style={styles.actions}>
                  <Pressable
                    disabled={isUploading}
                    onPress={() => void handleCapture(v.key)}
                    style={styles.actionBtnPrimary}
                  >
                    {isUploading ? (
                      <ActivityIndicator color="white" size="small" />
                    ) : (
                      <>
                        <Camera color="white" size={14} />
                        <Text style={styles.actionBtnTextPrimary}>Camera</Text>
                      </>
                    )}
                  </Pressable>

                  <Pressable
                    disabled={isUploading}
                    onPress={() => void handlePick(v.key)}
                    style={styles.actionBtnSecondary}
                  >
                    <Text style={styles.actionBtnTextSecondary}>Gallery</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
  },
  summaryBar: {
    backgroundColor: "#F3F4F6",
    padding: spacing.md,
    borderRadius: radii.md,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  summaryTitle: {
    fontSize: 14,
    fontWeight: "900",
    color: colors.ink,
  },
  summaryCount: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.brand,
  },
  errorText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: "700",
  },
  grid: {
    gap: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  cardMedia: {
    height: 140,
    backgroundColor: "#FAFAFA",
    position: "relative",
  },
  image: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
  },
  placeholder: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  placeholderText: {
    fontSize: 11,
    color: colors.muted,
    fontWeight: "700",
  },
  tag: {
    position: "absolute",
    top: 8,
    left: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
  },
  tagRequired: {
    backgroundColor: "#FFF0F1",
  },
  tagOptional: {
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  tagText: {
    fontSize: 10,
    fontWeight: "900",
  },
  tagTextRequired: {
    color: colors.brand,
  },
  tagTextOptional: {
    color: "white",
  },
  checkedBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: colors.success,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  cardContent: {
    padding: spacing.md,
    gap: 6,
  },
  viewTitle: {
    fontSize: 15,
    fontWeight: "900",
    color: colors.ink,
  },
  viewDesc: {
    fontSize: 12,
    color: colors.muted,
    lineHeight: 16,
  },
  reasonText: {
    fontSize: 11,
    color: colors.danger,
    fontWeight: "700",
  },
  actions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: 4,
  },
  actionBtnPrimary: {
    flex: 1,
    minHeight: 38,
    backgroundColor: colors.brand,
    borderRadius: radii.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  actionBtnTextPrimary: {
    color: "white",
    fontSize: 12,
    fontWeight: "800",
  },
  actionBtnSecondary: {
    flex: 1,
    minHeight: 38,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
  },
  actionBtnTextSecondary: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: "700",
  },
});
