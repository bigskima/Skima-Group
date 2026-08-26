import * as ImagePicker from "expo-image-picker";
import { Camera, CheckCircle2, Images, Image as ImageIcon, LockKeyhole } from "lucide-react-native";
import { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { AppButton } from "../ui/AppButton";

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

export function MultiPhotoRequirement({ views, onUploadView }: MultiPhotoRequirementProps) {
  const { palette } = useAppTheme();
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
      const result = await ImagePicker.launchCameraAsync({ quality: 0.9 });
      if (result.canceled) return;
      const asset = result.assets[0];
      setUploadingKey(viewKey);
      await onUploadView(viewKey, { uri: asset.uri, name: `${viewKey}-${Date.now()}.jpg`, mimeType: "image/jpeg" });
    } catch (cause) {
      setError(friendlyError(cause, "The upload failed. Please try again."));
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
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.9 });
      if (result.canceled) return;
      const asset = result.assets[0];
      setUploadingKey(viewKey);
      await onUploadView(viewKey, { uri: asset.uri, name: `${viewKey}-${Date.now()}.jpg`, mimeType: "image/jpeg" });
    } catch (cause) {
      setError(friendlyError(cause, "The upload failed. Please try again."));
    } finally {
      setUploadingKey(null);
    }
  };

  const requiredCount = views.filter((v) => v.isRequired).length;
  const completedRequired = views.filter((v) => v.isRequired && v.uploadedUrl && !v.replacementRequested).length;
  const completedPercent = requiredCount ? Math.round((completedRequired / requiredCount) * 100) : 100;

  return (
    <View style={styles.container}>
      <View style={[styles.summaryBar, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <View style={styles.summaryCopy}>
          <Text style={[styles.summaryTitle, { color: palette.ink }]}>Station premises photos</Text>
          <Text style={[styles.summaryDescription, { color: palette.muted }]}>Capture each requested view so SKIMA can verify the physical facility.</Text>
        </View>
        <View style={[styles.countBadge, { backgroundColor: completedRequired === requiredCount ? palette.successSoft : palette.brandSoft }]}>
          <Text style={[styles.summaryCount, { color: completedRequired === requiredCount ? palette.success : palette.brand }]}>
            {completedRequired}/{requiredCount} required
          </Text>
        </View>
        <View style={[styles.progressTrack, { backgroundColor: palette.soft }]}>
          <View style={[styles.progressFill, { backgroundColor: palette.brand, width: `${completedPercent}%` }]} />
        </View>
      </View>

      <View style={[styles.privacyNote, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
        <LockKeyhole color={palette.mutedStrong} size={16} />
        <Text style={[styles.privacyText, { color: palette.muted }]}>Application photos are private. A photo appears on a public station profile only after separate approval from SKIMA.</Text>
      </View>

      {error ? <Text style={[styles.errorText, { color: palette.danger }]}>{error}</Text> : null}

      <View style={styles.grid}>
        {views.map((view) => {
          const isUploaded = Boolean(view.uploadedUrl);
          const isUploading = uploadingKey === view.key;
          const needsReplacement = Boolean(view.replacementRequested || view.replacementReason);
          const internalOnly = view.key === "station.photo.tank";

          return (
            <View
              key={view.key}
              style={[
                styles.card,
                shadows.soft,
                {
                  backgroundColor: palette.surface,
                  borderColor: needsReplacement ? palette.danger : palette.border,
                },
              ]}
            >
              <View style={[styles.cardMedia, { backgroundColor: palette.surfaceSubtle }]}>
                {view.uploadedUrl ? (
                  <Image source={{ uri: view.uploadedUrl }} resizeMode="cover" style={styles.image} />
                ) : (
                  <View style={styles.placeholder}>
                    <View style={[styles.placeholderIcon, { backgroundColor: palette.brandSoft }]}>
                      <ImageIcon color={palette.brand} size={25} />
                    </View>
                    <Text style={[styles.placeholderText, { color: palette.muted }]}>No photo uploaded</Text>
                  </View>
                )}

                <View style={[styles.tag, { backgroundColor: view.isRequired ? palette.brandSoft : "rgba(20,20,22,.68)" }]}>
                  <Text style={[styles.tagText, { color: view.isRequired ? palette.brand : "#FFFFFF" }]}>
                    {view.isRequired ? "Required" : "Optional"}
                  </Text>
                </View>

                {internalOnly ? (
                  <View style={styles.internalTag}>
                    <LockKeyhole color="#FFFFFF" size={11} />
                    <Text style={styles.internalTagText}>Private</Text>
                  </View>
                ) : null}

                {isUploaded && !needsReplacement ? (
                  <View style={[styles.checkedBadge, { backgroundColor: palette.success }]}>
                    <CheckCircle2 color="#FFFFFF" size={14} />
                  </View>
                ) : null}
              </View>

              <View style={styles.cardContent}>
                <Text style={[styles.viewTitle, { color: palette.ink }]}>{view.title}</Text>
                <Text style={[styles.viewDesc, { color: palette.muted }]}>{view.description}</Text>

                {view.replacementReason ? (
                  <View style={[styles.reasonBox, { backgroundColor: palette.dangerSoft }]}>
                    <Text style={[styles.reasonText, { color: palette.danger }]}>{view.replacementReason}</Text>
                  </View>
                ) : null}

                <View style={styles.actions}>
                  <View style={styles.actionSlot}>
                    <AppButton
                      label={isUploaded ? "Retake" : "Camera"}
                      size="sm"
                      loading={isUploading}
                      disabled={isUploading}
                      icon={<Camera color="#FFFFFF" size={14} />}
                      onPress={() => void handleCapture(view.key)}
                    />
                  </View>
                  <View style={styles.actionSlot}>
                    <AppButton
                      label="Gallery"
                      size="sm"
                      variant="secondary"
                      disabled={isUploading}
                      icon={<Images color={palette.ink} size={14} />}
                      onPress={() => void handlePick(view.key)}
                    />
                  </View>
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
  container: { gap: spacing.md },
  summaryBar: { padding: spacing.md, borderRadius: radii.lg, borderWidth: StyleSheet.hairlineWidth, gap: spacing.sm },
  summaryCopy: { gap: 3 },
  summaryTitle: { ...typography.subheading, fontSize: 15 },
  summaryDescription: { ...typography.caption, lineHeight: 17 },
  countBadge: { alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 5, borderRadius: radii.pill },
  summaryCount: { ...typography.caption, fontSize: 11, fontWeight: "900" },
  progressTrack: { height: 6, borderRadius: radii.pill, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: radii.pill },
  privacyNote: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, padding: spacing.md, borderRadius: radii.md, borderWidth: StyleSheet.hairlineWidth },
  privacyText: { ...typography.caption, flex: 1, lineHeight: 17 },
  errorText: { ...typography.caption, fontWeight: "700" },
  grid: { gap: spacing.md },
  card: { borderRadius: radii.lg, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  cardMedia: { height: 154, position: "relative" },
  image: { width: "100%", height: "100%" },
  placeholder: { width: "100%", height: "100%", alignItems: "center", justifyContent: "center", gap: 7 },
  placeholderIcon: { width: 50, height: 50, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  placeholderText: { ...typography.caption },
  tag: { position: "absolute", top: 9, left: 9, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radii.pill },
  tagText: { ...typography.caption, fontSize: 10, fontWeight: "900" },
  internalTag: { position: "absolute", bottom: 9, left: 9, backgroundColor: "rgba(20,20,22,.72)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: radii.pill, flexDirection: "row", alignItems: "center", gap: 4 },
  internalTagText: { color: "#FFFFFF", ...typography.caption, fontSize: 9, fontWeight: "900" },
  checkedBadge: { position: "absolute", top: 9, right: 9, width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  cardContent: { padding: spacing.md, gap: 6 },
  viewTitle: { ...typography.subheading, fontSize: 15 },
  viewDesc: { ...typography.caption, lineHeight: 17 },
  reasonBox: { padding: 9, borderRadius: radii.sm, marginTop: 2 },
  reasonText: { ...typography.caption, fontWeight: "700" },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: 4 },
  actionSlot: { flex: 1 },
});
