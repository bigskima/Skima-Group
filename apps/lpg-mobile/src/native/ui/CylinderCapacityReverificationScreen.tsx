import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { AlertTriangle, Camera, CheckCircle2, ImagePlus, Scale, ShieldCheck } from "lucide-react-native";
import { useMemo, useRef, useState } from "react";
import { Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { domainQueries, useLpgConfig } from "../api/domains";
import { useGatewayMutation } from "../api/gateway";
import {
  ActionResponseSchema,
  displayReference,
  displayStatus,
  firstNumber,
  firstString,
  nestedRecord,
  nestedRecords,
  recordId,
  type PlatformRecord,
} from "../api/records";
import { uploadMedia } from "../media/upload";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { idempotencyKey } from "../utilities/idempotency";
import { AppButton } from "./AppButton";
import { EmptyState } from "./EmptyState";
import { Screen } from "./Screen";
import { ScreenSkeleton } from "./ScreenSkeleton";

const APPLICATION_TYPE_KEY = "application.lpg.cylinder.capacity-reverification";
const EDITABLE_STATUSES = new Set(["draft", "incomplete", "additional_info_required"]);
const REVIEW_STATUSES = new Set(["submitted", "resubmitted", "under_review"]);

type Photo = { uri: string; fileName: string; mimeType: string };

type PhotoKind = "capacity-marking" | "full-view";

export function CylinderCapacityReverificationScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const session = useSession();
  const { palette } = useAppTheme();
  const cylinders = domainQueries.cylinders();
  const applications = domainQueries.applications();
  const applicationTypes = domainQueries.applicationTypes();
  const documents = domainQueries.documents();
  const config = useLpgConfig();
  const attemptKey = useRef(`${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

  const [requestedProfileKey, setRequestedProfileKey] = useState("");
  const [reason, setReason] = useState("");
  const [markingPhoto, setMarkingPhoto] = useState<Photo | null>(null);
  const [fullViewPhoto, setFullViewPhoto] = useState<Photo | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitLabel, setSubmitLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const cylinder = useMemo(
    () => (cylinders.data ?? []).find((item) => recordId(item) === id || displayReference(item) === id) ?? null,
    [cylinders.data, id],
  );
  const cylinderId = cylinder ? recordId(cylinder) : null;
  const currentSizeKg = firstNumber(cylinder, ["size_kg", "sizeKg"]);
  const currentMaxCapacityKg = firstNumber(cylinder, ["max_capacity_kg", "maxCapacityKg"]);

  const applicationType = useMemo(
    () => (applicationTypes.data ?? []).find((item) => firstString(item, ["key"]) === APPLICATION_TYPE_KEY) ?? null,
    [applicationTypes.data],
  );
  const applicationTypeId = applicationType ? recordId(applicationType) : null;

  const matchingApplications = useMemo(() => {
    if (!applicationTypeId || !cylinderId) return [];
    return (applications.data ?? [])
      .filter((item) => {
        if (firstString(item, ["application_type_id", "applicationTypeId"]) !== applicationTypeId) return false;
        const metadata = nestedRecord(item, "metadata");
        return firstString(metadata, ["cylinderId", "cylinder_id"]) === cylinderId;
      })
      .sort((a, b) => timestampOf(b) - timestampOf(a));
  }, [applicationTypeId, applications.data, cylinderId]);

  const currentApplication = matchingApplications[0] ?? null;
  const currentApplicationId = currentApplication ? recordId(currentApplication) : null;
  const currentApplicationStatus = currentApplication ? displayStatus(currentApplication) ?? "draft" : null;
  const editableApplicationId = currentApplicationId && currentApplicationStatus && EDITABLE_STATUSES.has(currentApplicationStatus)
    ? currentApplicationId
    : null;
  const reviewInProgress = Boolean(currentApplicationStatus && REVIEW_STATUSES.has(currentApplicationStatus));

  const profiles = nestedRecords(config.data, "cylinderTypeProfiles");
  const availableProfiles = useMemo(
    () => profiles.filter((profile) => {
      const sizeKg = firstNumber(profile, ["sizeKg", "size_kg"]);
      const maxCapacityKg = firstNumber(profile, ["maxCapacityKg", "max_capacity_kg"]);
      const key = firstString(profile, ["key"]);
      if (!key || sizeKg === null || maxCapacityKg === null) return false;
      return sizeKg !== currentSizeKg || maxCapacityKg !== currentMaxCapacityKg;
    }),
    [currentMaxCapacityKg, currentSizeKg, profiles],
  );
  const selectedProfile = availableProfiles.find((profile) => firstString(profile, ["key"]) === requestedProfileKey) ?? null;

  const createApplication = useGatewayMutation({
    path: "/runtime/applications",
    schema: ActionResponseSchema,
    invalidate: [["applications"]],
  });
  const savePayload = useGatewayMutation({
    path: "/runtime/applications/payload",
    schema: ActionResponseSchema,
    invalidate: [["applications"]],
  });
  const registerDocument = useGatewayMutation({
    path: "/runtime/documents",
    schema: ActionResponseSchema,
    invalidate: [["documents"], ["applications"]],
  });
  const submitApplication = useGatewayMutation({
    path: "/runtime/applications/submit",
    schema: ActionResponseSchema,
    invalidate: [["applications"]],
  });

  const pickPhoto = async (kind: PhotoKind, source: "camera" | "library") => {
    setError(null);
    const permission = source === "camera"
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError(source === "camera"
        ? "Allow camera access to photograph the cylinder."
        : "Allow photo access to choose cylinder photos from this device.");
      return;
    }

    const result = source === "camera"
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], allowsEditing: true, quality: 0.9 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, quality: 0.9 });

    if (result.canceled) return;
    const asset = result.assets[0];
    const photo: Photo = {
      uri: asset.uri,
      fileName: asset.fileName ?? `cylinder-${kind}-${Date.now()}.jpg`,
      mimeType: asset.mimeType ?? "image/jpeg",
    };
    if (kind === "capacity-marking") setMarkingPhoto(photo);
    else setFullViewPhoto(photo);
  };

  const submit = async () => {
    setError(null);
    setSuccess(null);
    const userId = session.context?.user.id ?? session.session?.user.id;
    if (!userId || !cylinderId) {
      setError("Please sign in again and reopen this cylinder before continuing.");
      return;
    }
    if (!selectedProfile) {
      setError("Choose the cylinder size printed or stamped on the physical cylinder.");
      return;
    }
    if (!markingPhoto || !fullViewPhoto) {
      setError("Add both the capacity-marking photo and a clear full-cylinder photo before submitting.");
      return;
    }

    const payload = {
      cylinder: { id: cylinderId },
      requested: { cylinderTypeProfileKey: firstString(selectedProfile, ["key"]) },
      reason: reason.trim() || undefined,
    };

    setSubmitting(true);
    try {
      let applicationId = editableApplicationId;
      if (applicationId) {
        setSubmitLabel("Updating review request");
        await savePayload.mutateAsync({
          applicationId,
          payload,
          metadata: { cylinderId, purpose: "capacity_reverification" },
          idempotencyKey: idempotencyKey(
            "capacity-reverification-payload",
            `${applicationId}:${firstString(selectedProfile, ["key"]) ?? "profile"}:${attemptKey.current}`,
          ),
        });
      } else {
        setSubmitLabel("Creating review request");
        const result = await createApplication.mutateAsync({
          applicationTypeKey: APPLICATION_TYPE_KEY,
          applicantUserId: userId,
          payload,
          source: "skima.lpg.mobile",
          metadata: { cylinderId, purpose: "capacity_reverification" },
          idempotencyKey: idempotencyKey(
            "capacity-reverification-create",
            `${cylinderId}:${attemptKey.current}`,
          ),
        });
        applicationId = actionId(result);
      }

      if (!applicationId) throw new Error("The capacity review request could not be created.");

      setSubmitLabel("Uploading capacity marking");
      await uploadAndRegisterEvidence({
        applicationId,
        kind: "capacity-marking",
        photo: markingPhoto,
        userId,
      });

      setSubmitLabel("Uploading cylinder photo");
      await uploadAndRegisterEvidence({
        applicationId,
        kind: "full-view",
        photo: fullViewPhoto,
        userId,
      });

      setSubmitLabel("Submitting for review");
      await submitApplication.mutateAsync({
        applicationId,
        metadata: { cylinderId, purpose: "capacity_reverification" },
        idempotencyKey: idempotencyKey(
          "capacity-reverification-submit",
          `${applicationId}:${attemptKey.current}`,
        ),
      });

      setMarkingPhoto(null);
      setFullViewPhoto(null);
      setSuccess(
        `Review submitted. Your verified refill size remains ${kg(currentMaxCapacityKg)} until SKIMA completes the review.`,
      );
      await Promise.all([applications.refetch(), documents.refetch(), cylinders.refetch()]);
    } catch (cause) {
      setError(friendlyError(cause, "We couldn't submit the size review. Check the photos and try again."));
    } finally {
      setSubmitting(false);
      setSubmitLabel(null);
    }
  };

  const uploadAndRegisterEvidence = async ({
    applicationId,
    kind,
    photo,
    userId,
  }: {
    applicationId: string;
    kind: PhotoKind;
    photo: Photo;
    userId: string;
  }) => {
    const requirementKey = kind === "capacity-marking" ? "cylinder.capacity-marking" : "cylinder.full-view";
    const mediaAssetId = await uploadMedia({
      api: session.api,
      uri: photo.uri,
      fileName: photo.fileName,
      contentType: photo.mimeType,
      ownerUserId: userId,
      assetTypeKey: `media.${requirementKey}`,
    });

    await registerDocument.mutateAsync({
      applicationId,
      requirementKey,
      storageBucket: "applications",
      storagePath: `docs/${applicationId}/${requirementKey}/${Date.now()}`,
      contentType: photo.mimeType,
      source: "skima.lpg.mobile",
      metadata: { mediaAssetId, cylinderId, purpose: "capacity_reverification" },
      idempotencyKey: idempotencyKey("capacity-reverification-document", `${applicationId}:${requirementKey}:${mediaAssetId}`),
    });
  };

  const loading = cylinders.isPending || applicationTypes.isPending || applications.isPending || config.isPending;

  return (
    <Screen
      eyebrow="Cylinder safety"
      title="Review cylinder capacity"
      subtitle="Send clear cylinder photos to request a size correction. The current verified size remains in use until the review is complete."
      action={<AppButton label="Back" variant="ghost" size="sm" onPress={() => router.back()} />}
    >
      {loading ? (
        <ScreenSkeleton cards={4} />
      ) : !cylinder ? (
        <EmptyState
          icon={<Scale color={palette.brand} size={27} />}
          title="Cylinder unavailable"
          description="This cylinder is unavailable or is no longer accessible from this account."
          action={<AppButton label="Back to cylinders" onPress={() => router.replace("/(customer)/cylinders")} />}
        />
      ) : !applicationType ? (
        <EmptyState
          icon={<ShieldCheck color={palette.brand} size={27} />}
          title="Capacity review is unavailable"
          description="Size review is temporarily unavailable. Your current verified cylinder size has not changed."
          action={<AppButton label="Back" onPress={() => router.back()} />}
        />
      ) : (
        <>
          <View style={[styles.currentCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <View style={[styles.currentIcon, { backgroundColor: palette.brandSoft }]}><Scale color={palette.brand} size={23} /></View>
            <View style={styles.currentCopy}>
              <Text style={[styles.eyebrow, { color: palette.brand }]}>CURRENT VERIFIED LIMIT</Text>
              <Text style={[styles.currentValue, { color: palette.ink }]}>{kg(currentMaxCapacityKg)}</Text>
              <Text style={[styles.body, { color: palette.muted }]}>Cylinder {displayReference(cylinder) ?? "details"}. Refill orders cannot exceed this size while a review is pending.</Text>
            </View>
          </View>

          {currentApplicationStatus ? (
            <ApplicationStatusCard
              status={currentApplicationStatus}
              currentCapacity={currentMaxCapacityKg}
              palette={palette}
            />
          ) : null}

          {reviewInProgress ? (
            <View style={[styles.lockedCard, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
              <ShieldCheck color={palette.brand} size={22} />
              <View style={styles.lockedCopy}>
                <Text style={[styles.sectionTitle, { color: palette.ink }]}>Review in progress</Text>
                <Text style={[styles.body, { color: palette.muted }]}>No new capacity request can replace this one while SKIMA is reviewing it. The current verified capacity remains {kg(currentMaxCapacityKg)}.</Text>
              </View>
            </View>
          ) : (
            <>
              <View style={[styles.formCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                <View style={styles.sectionLead}>
                  <View style={[styles.sectionIcon, { backgroundColor: palette.brandSoft }]}><Scale color={palette.brand} size={20} /></View>
                  <View style={styles.sectionCopy}>
                    <Text style={[styles.sectionTitle, { color: palette.ink }]}>What size is printed on the cylinder?</Text>
                    <Text style={[styles.body, { color: palette.muted }]}>Choose from the cylinder sizes currently supported by SKIMA. Your verified size will not change until the review is complete.</Text>
                  </View>
                </View>

                <View style={styles.profileGrid}>
                  {availableProfiles.map((profile, index) => {
                    const key = firstString(profile, ["key"]);
                    if (!key) return null;
                    const selected = key === requestedProfileKey;
                    const maxCapacity = firstNumber(profile, ["maxCapacityKg", "max_capacity_kg"]);
                    return (
                      <Pressable
                        key={key || String(index)}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        onPress={() => { setRequestedProfileKey(key); setError(null); }}
                        style={({ pressed }) => [
                          styles.profileOption,
                          {
                            backgroundColor: selected ? palette.brand : palette.surfaceSubtle,
                            borderColor: selected ? palette.brand : palette.border,
                            opacity: pressed ? 0.82 : 1,
                          },
                        ]}
                      >
                        <Text style={[styles.profileValue, { color: selected ? "#FFFFFF" : palette.ink }]}>{kg(maxCapacity)}</Text>
                        <Text style={[styles.profileLabel, { color: selected ? "rgba(255,255,255,.78)" : palette.muted }]}>{firstString(profile, ["displayName", "display_name"]) ?? "Cylinder size"}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                {!availableProfiles.length ? <Text style={[styles.body, { color: palette.muted }]}>No other cylinder sizes are available right now.</Text> : null}

                <View style={styles.fieldGroup}>
                  <Text style={[styles.fieldLabel, { color: palette.ink }]}>Why does the size need correction? <Text style={{ color: palette.muted, fontWeight: "600" }}>(optional)</Text></Text>
                  <TextInput
                    value={reason}
                    onChangeText={setReason}
                    placeholder="For example: I selected the wrong size during registration"
                    placeholderTextColor={palette.muted}
                    multiline
                    style={[styles.input, styles.multiline, { backgroundColor: palette.input, borderColor: palette.borderStrong, color: palette.ink }]}
                  />
                </View>
              </View>

              <EvidenceCard
                title="Capacity marking"
                description="Photograph the permanent kg or capacity marking clearly enough for review."
                photo={markingPhoto}
                onCamera={() => void pickPhoto("capacity-marking", "camera")}
                onLibrary={() => void pickPhoto("capacity-marking", "library")}
              />

              <EvidenceCard
                title="Full cylinder view"
                description="Show the complete cylinder so the marking can be matched to the registered physical cylinder."
                photo={fullViewPhoto}
                onCamera={() => void pickPhoto("full-view", "camera")}
                onLibrary={() => void pickPhoto("full-view", "library")}
              />

              <View style={[styles.safetyNote, { backgroundColor: palette.warningSoft, borderColor: palette.border }]}>
                <AlertTriangle color={palette.warning} size={20} />
                <Text style={[styles.safetyText, { color: palette.muted }]}>Your cylinder size changes only after SKIMA reviews the required photos. If more information is needed, the current verified size remains unchanged.</Text>
              </View>

              <AppButton
                label={editableApplicationId ? "Resubmit capacity review" : "Submit capacity review"}
                fullWidth
                size="lg"
                loading={submitting}
                onPress={() => void submit()}
              />
              {submitLabel ? <Text style={[styles.progressText, { color: palette.muted }]}>{submitLabel}…</Text> : null}
            </>
          )}

          {success ? (
            <View style={[styles.messageCard, { backgroundColor: palette.successSoft }]}>
              <CheckCircle2 color={palette.success} size={20} />
              <Text accessibilityRole="alert" style={[styles.messageText, { color: palette.success }]}>{success}</Text>
            </View>
          ) : null}
          {error ? (
            <View style={[styles.messageCard, { backgroundColor: palette.dangerSoft }]}>
              <AlertTriangle color={palette.danger} size={20} />
              <Text accessibilityRole="alert" style={[styles.messageText, { color: palette.danger }]}>{error}</Text>
            </View>
          ) : null}
        </>
      )}
    </Screen>
  );
}

function EvidenceCard({
  title,
  description,
  photo,
  onCamera,
  onLibrary,
}: {
  title: string;
  description: string;
  photo: Photo | null;
  onCamera(): void;
  onLibrary(): void;
}) {
  const { palette } = useAppTheme();
  return (
    <View style={[styles.evidenceCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <View style={styles.sectionLead}>
        <View style={[styles.sectionIcon, { backgroundColor: palette.brandSoft }]}><Camera color={palette.brand} size={20} /></View>
        <View style={styles.sectionCopy}>
          <Text style={[styles.sectionTitle, { color: palette.ink }]}>{title}</Text>
          <Text style={[styles.body, { color: palette.muted }]}>{description}</Text>
        </View>
      </View>
      {photo ? (
        <View style={[styles.photoFrame, { borderColor: palette.border }]}>
          <Image source={{ uri: photo.uri }} resizeMode="cover" style={styles.photo} />
          <View style={styles.photoActions}>
            <AppButton label="Take new" size="sm" variant="secondary" icon={<Camera color={palette.brand} size={16} />} onPress={onCamera} />
            <AppButton label="Choose another" size="sm" variant="secondary" icon={<ImagePlus color={palette.brand} size={16} />} onPress={onLibrary} />
          </View>
        </View>
      ) : (
        <View style={[styles.photoPicker, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
          <Camera color={palette.brand} size={26} />
          <View style={styles.photoActions}>
            <AppButton label="Take photo" size="sm" onPress={onCamera} />
            <AppButton label="Choose photo" size="sm" variant="secondary" onPress={onLibrary} />
          </View>
        </View>
      )}
    </View>
  );
}

function ApplicationStatusCard({
  status,
  currentCapacity,
  palette,
}: {
  status: string;
  currentCapacity: number | null;
  palette: ReturnType<typeof useAppTheme>["palette"];
}) {
  const normalized = status.toLowerCase();
  const approved = normalized === "approved";
  const rejected = normalized === "rejected";
  const correction = normalized === "additional_info_required" || normalized === "incomplete";
  const title = approved
    ? "Previous capacity review approved"
    : rejected
      ? "Previous capacity review was not approved"
      : correction
        ? "More information is needed"
        : "Capacity review submitted";
  const body = approved
    ? "The approved configured capacity has been applied to the cylinder record. If the physical marking still differs, you can submit another review."
    : rejected
      ? `The cylinder stayed at ${kg(currentCapacity)}. You can submit a new request with clearer photos.`
      : correction
        ? `Upload new photos and submit again. The verified capacity remains ${kg(currentCapacity)} until approval.`
        : `SKIMA is reviewing your request. The verified capacity remains ${kg(currentCapacity)} until approval.`;
  const background = approved ? palette.successSoft : rejected ? palette.dangerSoft : correction ? palette.warningSoft : palette.surfaceSubtle;
  const iconColor = approved ? palette.success : rejected ? palette.danger : correction ? palette.warning : palette.brand;

  return (
    <View style={[styles.statusCard, { backgroundColor: background, borderColor: palette.border }]}>
      {approved ? <CheckCircle2 color={iconColor} size={21} /> : rejected || correction ? <AlertTriangle color={iconColor} size={21} /> : <ShieldCheck color={iconColor} size={21} />}
      <View style={styles.statusCopy}>
        <Text style={[styles.sectionTitle, { color: palette.ink }]}>{title}</Text>
        <Text style={[styles.body, { color: palette.muted }]}>{body}</Text>
      </View>
    </View>
  );
}

function actionId(result: string | PlatformRecord | null) {
  if (typeof result === "string") return result;
  const nested = nestedRecord(result, "data");
  return firstString(result, ["id", "application_id", "applicationId"]) ?? firstString(nested, ["id", "application_id", "applicationId"]);
}

function timestampOf(record: PlatformRecord) {
  const value = firstString(record, ["updated_at", "updatedAt", "created_at", "createdAt"]);
  const timestamp = value ? Date.parse(value) : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function kg(value: number | null) {
  if (value === null) return "Configured limit";
  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  return `${formatted} kg`;
}

const styles = StyleSheet.create({
  currentCard: { flexDirection: "row", gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.lg },
  currentIcon: { width: 48, height: 48, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  currentCopy: { flex: 1, gap: 3 },
  eyebrow: { ...typography.eyebrow, fontSize: 8 },
  currentValue: { ...typography.heading, fontSize: 24 },
  body: { ...typography.caption, lineHeight: 18 },
  statusCard: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  statusCopy: { flex: 1, gap: 3 },
  lockedCard: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.lg },
  lockedCopy: { flex: 1, gap: 4 },
  formCard: { gap: spacing.lg, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.lg },
  sectionLead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  sectionIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  sectionCopy: { flex: 1, gap: 3 },
  sectionTitle: { ...typography.subheading, fontSize: 15 },
  profileGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  profileOption: { minWidth: 118, flexGrow: 1, flexBasis: "45%", borderWidth: 1, borderRadius: radii.md, padding: spacing.md, gap: 3 },
  profileValue: { ...typography.subheading, fontSize: 17 },
  profileLabel: { ...typography.caption, lineHeight: 16 },
  fieldGroup: { gap: spacing.sm },
  fieldLabel: { ...typography.caption, fontSize: 13, fontWeight: "900" },
  input: { minHeight: 54, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.md, fontSize: 15 },
  multiline: { minHeight: 92, paddingTop: spacing.md, textAlignVertical: "top" },
  evidenceCard: { gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.lg },
  photoFrame: { overflow: "hidden", borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg },
  photo: { width: "100%", aspectRatio: 4 / 3 },
  photoPicker: { alignItems: "center", gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.lg },
  photoActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, padding: spacing.sm },
  safetyNote: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm + 2, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  safetyText: { flex: 1, ...typography.caption, lineHeight: 18 },
  progressText: { ...typography.caption, textAlign: "center" },
  messageCard: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm + 2, borderRadius: radii.md, padding: spacing.md },
  messageText: { flex: 1, ...typography.caption, fontWeight: "800", lineHeight: 18 },
});