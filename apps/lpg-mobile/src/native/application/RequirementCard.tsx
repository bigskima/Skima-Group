import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  FileCheck2,
  FileText,
  RefreshCw,
  Upload,
} from "lucide-react-native";
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

export interface RequirementCardProps {
  requirementKey: string;
  title: string;
  description: string;
  isRequired: boolean;
  allowedContentTypes?: string[];
  maxByteSize?: number;
  uploadedDocument?: {
    id: string;
    status: string;
    mediaUrl?: string | null;
    replacementRequested?: boolean;
    replacementReason?: string | null;
  } | null;
  onUploadFile: (file: { uri: string; name: string; mimeType: string; size?: number }) => Promise<void>;
}

export function RequirementCard({
  requirementKey,
  title,
  description,
  isRequired,
  allowedContentTypes = [],
  maxByteSize = 52428800,
  uploadedDocument,
  onUploadFile,
}: RequirementCardProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isImageOnly = allowedContentTypes.every((t) => t.startsWith("image/"));
  const isApproved = uploadedDocument?.status === "approved";
  const isReplacementRequested =
    uploadedDocument?.replacementRequested ||
    uploadedDocument?.status === "rejected" ||
    Boolean(uploadedDocument?.replacementReason);
  const isUploaded = Boolean(uploadedDocument && !isReplacementRequested);

  const handlePickDocument = async () => {
    setError(null);
    try {
      if (isImageOnly) {
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
        setUploading(true);
        await onUploadFile({
          uri: asset.uri,
          name: asset.fileName ?? `${requirementKey}-${Date.now()}.jpg`,
          mimeType: asset.mimeType ?? "image/jpeg",
          size: asset.fileSize,
        });
      } else {
        const result = await DocumentPicker.getDocumentAsync({
          type: allowedContentTypes.length ? allowedContentTypes : ["*/*"],
          copyToCacheDirectory: true,
        });
        if (result.canceled) return;
        const asset = result.assets[0];
        if (asset.size && asset.size > maxByteSize) {
          setError(`File exceeds max size limit (${Math.round(maxByteSize / 1024 / 1024)}MB).`);
          return;
        }
        setUploading(true);
        await onUploadFile({
          uri: asset.uri,
          name: asset.name,
          mimeType: asset.mimeType ?? "application/octet-stream",
          size: asset.size,
        });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  const handleTakePhoto = async () => {
    setError(null);
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        setError("Camera permission is required to capture photos.");
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        quality: 0.9,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      setUploading(true);
      await onUploadFile({
        uri: asset.uri,
        name: `${requirementKey}-capture-${Date.now()}.jpg`,
        mimeType: "image/jpeg",
        size: asset.fileSize,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Camera capture failed. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <View
      style={[
        styles.card,
        isReplacementRequested && styles.cardWarning,
        isApproved && styles.cardSuccess,
      ]}
    >
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>{title}</Text>
            <View style={[styles.badge, isRequired ? styles.badgeRequired : styles.badgeOptional]}>
              <Text style={[styles.badgeText, isRequired ? styles.badgeTextRequired : styles.badgeTextOptional]}>
                {isRequired ? "Required" : "Optional"}
              </Text>
            </View>
          </View>
          <Text style={styles.description}>{description}</Text>
        </View>

        <View style={styles.statusIconWrap}>
          {isApproved ? (
            <CheckCircle2 color={colors.success} size={24} />
          ) : isReplacementRequested ? (
            <AlertCircle color={colors.danger} size={24} />
          ) : isUploaded ? (
            <FileCheck2 color={colors.brand} size={24} />
          ) : (
            <FileText color={colors.muted} size={24} />
          )}
        </View>
      </View>

      {/* Admin Replacement Notice */}
      {isReplacementRequested && uploadedDocument?.replacementReason ? (
        <View style={styles.feedbackBox}>
          <AlertCircle color={colors.danger} size={18} />
          <View style={{ flex: 1 }}>
            <Text style={styles.feedbackTitle}>Correction Requested by Admin</Text>
            <Text style={styles.feedbackText}>{uploadedDocument.replacementReason}</Text>
          </View>
        </View>
      ) : null}

      {/* Uploaded Media Preview */}
      {uploadedDocument?.mediaUrl ? (
        <View style={styles.previewContainer}>
          <Image source={{ uri: uploadedDocument.mediaUrl }} style={styles.previewImage} />
          <View style={styles.previewMeta}>
            <Text style={styles.previewStatus}>
              {isApproved ? "Verified by Admin" : isReplacementRequested ? "Replacement Required" : "Uploaded & Under Review"}
            </Text>
          </View>
        </View>
      ) : null}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {/* Action Buttons */}
      <View style={styles.actionsRow}>
        <Pressable
          disabled={uploading}
          onPress={() => void handlePickDocument()}
          style={[styles.actionBtn, isUploaded && !isReplacementRequested && styles.actionBtnSecondary]}
        >
          {uploading ? (
            <ActivityIndicator size="small" color={isUploaded ? colors.brand : "white"} />
          ) : (
            <>
              {isUploaded && !isReplacementRequested ? (
                <RefreshCw color={colors.brand} size={16} />
              ) : (
                <Upload color="white" size={16} />
              )}
              <Text
                style={[
                  styles.actionBtnText,
                  isUploaded && !isReplacementRequested && styles.actionBtnTextSecondary,
                ]}
              >
                {isReplacementRequested ? "Upload Replacement" : isUploaded ? "Replace File" : "Choose File"}
              </Text>
            </>
          )}
        </Pressable>

        {isImageOnly ? (
          <Pressable
            disabled={uploading}
            onPress={() => void handleTakePhoto()}
            style={styles.cameraBtn}
          >
            <Camera color={colors.brand} size={18} />
          </Pressable>
        ) : null}
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
  cardWarning: {
    borderColor: "#FCA5A5",
    backgroundColor: "#FFFBFB",
  },
  cardSuccess: {
    borderColor: "#86EFAC",
    backgroundColor: "#F8FFF9",
  },
  header: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "flex-start",
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    marginBottom: 4,
  },
  title: {
    fontSize: 16,
    fontWeight: "900",
    color: colors.ink,
  },
  description: {
    fontSize: 13,
    color: colors.muted,
    lineHeight: 18,
  },
  statusIconWrap: {
    paddingTop: 2,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
  },
  badgeRequired: {
    backgroundColor: "#FFF0F1",
  },
  badgeOptional: {
    backgroundColor: "#F3F4F6",
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "900",
  },
  badgeTextRequired: {
    color: colors.brand,
  },
  badgeTextOptional: {
    color: colors.muted,
  },
  feedbackBox: {
    flexDirection: "row",
    gap: 10,
    backgroundColor: "#FEF2F2",
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: "#FEE2E2",
    alignItems: "flex-start",
  },
  feedbackTitle: {
    fontSize: 13,
    fontWeight: "900",
    color: colors.danger,
    marginBottom: 2,
  },
  feedbackText: {
    fontSize: 12,
    color: "#7F1D1D",
    lineHeight: 16,
  },
  previewContainer: {
    borderRadius: radii.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#FAFAFA",
  },
  previewImage: {
    width: "100%",
    height: 160,
    objectFit: "cover",
  },
  previewMeta: {
    padding: 8,
    backgroundColor: "rgba(0,0,0,0.6)",
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
  },
  previewStatus: {
    color: "white",
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
  },
  actionsRow: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
  },
  actionBtn: {
    flex: 1,
    minHeight: 46,
    backgroundColor: colors.brand,
    borderRadius: radii.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: spacing.md,
  },
  actionBtnSecondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.brand,
  },
  actionBtnText: {
    color: "white",
    fontSize: 13,
    fontWeight: "800",
  },
  actionBtnTextSecondary: {
    color: colors.brand,
  },
  cameraBtn: {
    width: 46,
    height: 46,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF0F1",
  },
  errorText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: "700",
  },
});
