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
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { AppButton } from "../ui/AppButton";
import { StatusPill } from "../ui/StatusPill";

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
  const { palette } = useAppTheme();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isImageOnly = allowedContentTypes.length > 0 && allowedContentTypes.every((t) => t.startsWith("image/"));
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
        const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.9 });
        if (result.canceled) return;
        const asset = result.assets[0];
        if (asset.fileSize && asset.fileSize > maxByteSize) {
          setError(`File exceeds the ${Math.round(maxByteSize / 1024 / 1024)}MB limit.`);
          return;
        }
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
          setError(`File exceeds the ${Math.round(maxByteSize / 1024 / 1024)}MB limit.`);
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
      setError(friendlyError(cause, "The upload failed. Please try again."));
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
      const result = await ImagePicker.launchCameraAsync({ quality: 0.9 });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (asset.fileSize && asset.fileSize > maxByteSize) {
        setError(`Photo exceeds the ${Math.round(maxByteSize / 1024 / 1024)}MB limit.`);
        return;
      }
      setUploading(true);
      await onUploadFile({
        uri: asset.uri,
        name: `${requirementKey}-capture-${Date.now()}.jpg`,
        mimeType: "image/jpeg",
        size: asset.fileSize,
      });
    } catch (cause) {
      setError(friendlyError(cause, "We couldn't take the photo. Please try again."));
    } finally {
      setUploading(false);
    }
  };

  const status = isApproved
    ? "approved"
    : isReplacementRequested
      ? "correction required"
      : isUploaded
        ? uploadedDocument?.status ?? "uploaded"
        : "not uploaded";

  return (
    <View
      style={[
        styles.card,
        shadows.soft,
        {
          backgroundColor: isReplacementRequested ? palette.dangerSoft : palette.surface,
          borderColor: isReplacementRequested
            ? palette.danger
            : isApproved
              ? palette.success
              : palette.border,
        },
      ]}
    >
      <View style={styles.header}>
        <View style={[styles.fileIcon, { backgroundColor: isApproved ? palette.successSoft : palette.brandSoft }]}>
          {isApproved ? (
            <CheckCircle2 color={palette.success} size={21} />
          ) : isReplacementRequested ? (
            <AlertCircle color={palette.danger} size={21} />
          ) : isUploaded ? (
            <FileCheck2 color={palette.brand} size={21} />
          ) : (
            <FileText color={palette.mutedStrong} size={21} />
          )}
        </View>
        <View style={styles.headerCopy}>
          <View style={styles.titleRow}>
            <Text style={[styles.title, { color: palette.ink }]}>{title}</Text>
            <View style={[styles.badge, { backgroundColor: isRequired ? palette.brandSoft : palette.soft }]}>
              <Text style={[styles.badgeText, { color: isRequired ? palette.brand : palette.mutedStrong }]}>
                {isRequired ? "Required" : "Optional"}
              </Text>
            </View>
          </View>
          <Text style={[styles.description, { color: palette.muted }]}>{description}</Text>
          <View style={styles.statusRow}>
            <StatusPill
              label={status}
              tone={isApproved ? "success" : isReplacementRequested ? "danger" : isUploaded ? "warning" : "neutral"}
            />
          </View>
        </View>
      </View>

      {isReplacementRequested && uploadedDocument?.replacementReason ? (
        <View style={[styles.feedbackBox, { backgroundColor: palette.dangerSoft, borderColor: palette.danger }]}>
          <AlertCircle color={palette.danger} size={18} />
          <View style={styles.feedbackCopy}>
            <Text style={[styles.feedbackTitle, { color: palette.danger }]}>Reviewer requested a replacement</Text>
            <Text style={[styles.feedbackText, { color: palette.ink }]}>{uploadedDocument.replacementReason}</Text>
          </View>
        </View>
      ) : null}

      {uploadedDocument?.mediaUrl ? (
        <View style={[styles.previewContainer, { borderColor: palette.border, backgroundColor: palette.surfaceSubtle }]}>
          <Image source={{ uri: uploadedDocument.mediaUrl }} resizeMode="cover" style={styles.previewImage} />
          <View style={styles.previewMeta}>
            <Text style={styles.previewStatus}>
              {isApproved ? "Verified by SKIMA" : isReplacementRequested ? "Replacement required" : "Uploaded for review"}
            </Text>
          </View>
        </View>
      ) : null}

      {error ? <Text style={[styles.errorText, { color: palette.danger }]}>{error}</Text> : null}

      <View style={styles.actionsRow}>
        <View style={styles.primaryAction}>
          <AppButton
            disabled={uploading}
            loading={uploading}
            label={isReplacementRequested ? "Upload replacement" : isUploaded ? "Replace file" : "Choose file"}
            variant={isUploaded && !isReplacementRequested ? "secondary" : "primary"}
            icon={
              isUploaded && !isReplacementRequested ? (
                <RefreshCw color={palette.ink} size={16} />
              ) : (
                <Upload color="#FFFFFF" size={16} />
              )
            }
            onPress={() => void handlePickDocument()}
          />
        </View>

        {isImageOnly ? (
          <Pressable
            accessibilityLabel="Take photo"
            accessibilityRole="button"
            disabled={uploading}
            onPress={() => void handleTakePhoto()}
            style={({ pressed }) => [
              styles.cameraBtn,
              {
                borderColor: palette.borderStrong,
                backgroundColor: palette.brandSoft,
                opacity: uploading ? 0.45 : pressed ? 0.75 : 1,
              },
            ]}
          >
            <Camera color={palette.brand} size={19} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radii.lg, padding: spacing.md, borderWidth: StyleSheet.hairlineWidth, gap: spacing.md, marginBottom: spacing.sm },
  header: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  fileIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  headerCopy: { flex: 1, gap: 4 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  title: { ...typography.subheading, fontSize: 15, flexShrink: 1 },
  description: { ...typography.caption, fontSize: 12, lineHeight: 18 },
  statusRow: { marginTop: 3 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radii.pill },
  badgeText: { ...typography.caption, fontSize: 10, fontWeight: "900" },
  feedbackBox: { flexDirection: "row", gap: 10, padding: spacing.md, borderRadius: radii.md, borderWidth: StyleSheet.hairlineWidth, alignItems: "flex-start" },
  feedbackCopy: { flex: 1, gap: 2 },
  feedbackTitle: { ...typography.caption, fontSize: 12, fontWeight: "900" },
  feedbackText: { ...typography.caption, lineHeight: 17 },
  previewContainer: { borderRadius: radii.md, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth },
  previewImage: { width: "100%", height: 168 },
  previewMeta: { padding: 8, backgroundColor: "rgba(0,0,0,.62)", position: "absolute", bottom: 0, left: 0, right: 0 },
  previewStatus: { color: "#FFFFFF", ...typography.caption, textAlign: "center", fontWeight: "800" },
  actionsRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  primaryAction: { flex: 1 },
  cameraBtn: { width: 48, height: 48, borderRadius: radii.md, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  errorText: { ...typography.caption, fontWeight: "700" },
});
