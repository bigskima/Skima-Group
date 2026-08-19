import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { Camera, Check, ChevronDown, ImagePlus, ShieldCheck, Sparkles } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useLpgConfig } from "../api/domains";
import { useGatewayMutation } from "../api/gateway";
import { ActionResponseSchema, firstNumber, firstString, nestedRecords, type PlatformRecord } from "../api/records";
import { uploadMedia } from "../media/upload";
import { useSession } from "../session/SessionProvider";
import { draftStore } from "../storage/drafts";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { idempotencyKey } from "../utilities/idempotency";
import { AppButton } from "./AppButton";
import { Screen } from "./Screen";
import { ScreenSkeleton } from "./ScreenSkeleton";

const DRAFT = "customer-cylinder-registration";

type CylinderPhoto = { uri: string; fileName: string; mimeType: string };

export function CylinderRegistrationScreen() {
  const session = useSession();
  const owner = session.context?.profile?.id ?? session.context?.user.id ?? session.session?.user.id ?? "";
  const { palette } = useAppTheme();
  const config = useLpgConfig();
  const [name, setName] = useState("");
  const [size, setSize] = useState("");
  const [colour, setColour] = useState("");
  const [brand, setBrand] = useState("");
  const [showOptional, setShowOptional] = useState(false);
  const [photo, setPhoto] = useState<CylinderPhoto | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitLabel, setSubmitLabel] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mutation = useGatewayMutation({
    path: "/lpg/cylinders",
    schema: ActionResponseSchema,
    invalidate: [["cylinders"]],
  });
  const presentationMutation = useGatewayMutation({
    path: "/runtime/ai/queue",
    schema: ActionResponseSchema,
  });
  const sizeOptions = nestedRecords(config.data, "cylinderTypeProfiles");

  useEffect(() => {
    if (!owner) return;
    void draftStore.load(owner, DRAFT).then((draft) => {
      if (draft) {
        setName(String(draft.values.name ?? ""));
        setSize(String(draft.values.size ?? ""));
        setColour(String(draft.values.colour ?? ""));
        setBrand(String(draft.values.brand ?? ""));
        setShowOptional(Boolean(draft.values.colour || draft.values.brand));
        const pending = draft.pendingMedia[0];
        if (pending) {
          setPhoto({ uri: pending.uri, fileName: "cylinder.jpg", mimeType: "image/jpeg" });
        }
      }
      setHydrated(true);
    });
  }, [owner]);

  useEffect(() => {
    if (!owner || !hydrated) return;
    const now = new Date().toISOString();
    void draftStore.save({
      version: 1,
      type: DRAFT,
      ownerProfileId: owner,
      step: photo ? "review" : size ? "photo" : "details",
      values: { name, size, colour, brand },
      pendingMedia: photo ? [{ uri: photo.uri, purpose: "cylinder-original" }] : [],
      createdAt: now,
      updatedAt: now,
    });
  }, [brand, colour, hydrated, name, owner, photo, size]);

  const applyPickedPhoto = (asset: ImagePicker.ImagePickerAsset) => {
    setPhoto({
      uri: asset.uri,
      fileName: asset.fileName ?? `cylinder-${Date.now()}.jpg`,
      mimeType: asset.mimeType ?? "image/jpeg",
    });
    setError(null);
  };

  const takePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError("Camera access is needed to take a cylinder photo. You can choose an existing photo instead.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      quality: 0.9,
    });
    if (!result.canceled) applyPickedPhoto(result.assets[0]);
  };

  const choosePhoto = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("Photo access is needed to choose a cylinder picture. You can take a new photo instead.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      quality: 0.9,
    });
    if (!result.canceled) applyPickedPhoto(result.assets[0]);
  };

  const submit = async () => {
    setError(null);
    const kg = Number(size);
    const profile = sizeOptions.find((option) => firstNumber(option, ["sizeKg", "size_kg"]) === kg);
    const maxCapacityKg = profile ? firstNumber(profile, ["maxCapacityKg", "max_capacity_kg"]) ?? kg : kg;

    if (name.trim().length < 2 || !Number.isFinite(kg) || kg <= 0) {
      setError("Give your cylinder a name and choose its size.");
      return;
    }

    setSubmitting(true);
    setSubmitLabel(photo ? "Uploading cylinder photo" : "Creating cylinder identity");
    setUploadProgress(photo ? 0 : null);

    try {
      let assetId: string | undefined;
      if (photo) {
        assetId = await uploadMedia({
          api: session.api,
          uri: photo.uri,
          fileName: photo.fileName,
          contentType: photo.mimeType,
          ownerUserId: session.context?.user.id ?? session.session!.user.id,
          assetTypeKey: "lpg.cylinder.original",
          onProgress: setUploadProgress,
        });
      }

      setSubmitLabel("Creating SKIMA identity");
      const response = await mutation.mutateAsync({
        displayName: name.trim(),
        sizeKg: kg,
        maxCapacityKg,
        brand: brand.trim() || undefined,
        colour: colour.trim() || undefined,
        imageAssetIds: assetId ? [assetId] : [],
        conditionStatus: "unknown",
        idempotencyKey: idempotencyKey("register-cylinder", `${owner}:${name.trim()}:${kg}`),
        metadata: { registrationExperience: "guided_v3" },
      });

      const createdRecord = actionRecord(response);
      const cylinderId = firstString(createdRecord, ["id"]);
      const cylinderReference = firstString(createdRecord, ["publicReference", "public_reference"]) ?? cylinderId;

      if (assetId && cylinderId) {
        setSubmitLabel("Preparing cylinder image");
        try {
          await presentationMutation.mutateAsync({
            taskKey: "ai.lpg.cylinder.presentation",
            subjectType: "lpg_cylinder",
            subjectId: cylinderId,
            source: "skima.lpg.mobile",
            idempotencyKey: idempotencyKey("presentation-media", cylinderId),
            input: {
              purpose: "public_presentation",
              confirmedColour: colour.trim() || undefined,
              sourceMediaAssetId: assetId,
              preserveOriginal: true,
            },
          });
          await session.api.request("/runtime/ai/process", ActionResponseSchema, {
            method: "POST",
            body: {},
            timeoutMs: 60_000,
          });
        } catch {
          // Presentation media is optional and must never block cylinder registration.
        }
      }

      await draftStore.clear(owner, DRAFT);
      router.replace(cylinderReference ? (`/(customer)/cylinder/${cylinderReference}` as never) : "/(customer)/cylinders");
    } catch (cause) {
      setError(friendlyError(cause, "We couldn't register this cylinder. Check the details and try again."));
    } finally {
      setSubmitting(false);
      setSubmitLabel(null);
      setUploadProgress(null);
    }
  };

  if (config.isPending) {
    return (
      <Screen eyebrow="Cylinder identity" title="Add a cylinder">
        <ScreenSkeleton cards={3} />
      </Screen>
    );
  }

  const inputStyle = [
    styles.input,
    { backgroundColor: palette.input, borderColor: palette.borderStrong, color: palette.ink },
  ];
  const ready = name.trim().length >= 2 && Boolean(size);

  return (
    <Screen
      eyebrow="Cylinder identity"
      title="Add a cylinder"
      subtitle="Create the SKIMA identity that will follow this cylinder through pickup, refill and delivery."
      action={<AppButton label="Cancel" variant="ghost" size="sm" onPress={() => router.back()} />}
    >
      <View style={[styles.identityNote, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <View style={[styles.identityIcon, { backgroundColor: palette.brand }]}><ShieldCheck color="#FFFFFF" size={24} /></View>
        <View style={styles.identityCopy}>
          <Text style={[styles.identityTitle, { color: palette.ink }]}>SKIMA creates the permanent identity</Text>
          <Text style={[styles.identityBody, { color: palette.muted }]}>After registration, this cylinder receives its SKIMA reference and scan code. Keep that identity with the correct physical cylinder.</Text>
        </View>
      </View>

      <View style={[styles.stepCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <StepHeader number="1" title="Name your cylinder" description="Choose a familiar name so you can recognise it in your account." />
        <TextInput
          onChangeText={setName}
          placeholder="Kitchen cylinder"
          placeholderTextColor={palette.muted}
          style={inputStyle}
          value={name}
        />
      </View>

      <View style={[styles.stepCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <StepHeader number="2" title="Choose the cylinder size" description="Use the kilogram marking printed or stamped on the physical cylinder." />
        <View style={styles.sizes}>
          {sizeOptions.map((option, index) => {
            const kg = firstNumber(option, ["sizeKg", "size_kg"]);
            if (kg === null) return null;
            const value = String(kg);
            const selected = value === size;
            return (
              <Pressable
                key={firstString(option, ["id", "key"]) ?? String(index)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setSize(value)}
                style={({ pressed }) => [
                  styles.sizeOption,
                  {
                    backgroundColor: selected ? palette.brand : palette.surfaceSubtle,
                    borderColor: selected ? palette.brand : palette.border,
                    opacity: pressed ? 0.82 : 1,
                  },
                ]}
              >
                <View style={styles.sizeCopy}>
                  <Text style={[styles.sizeValue, { color: selected ? "#FFFFFF" : palette.ink }]}>{kg} kg</Text>
                  <Text style={[styles.sizeLabel, { color: selected ? "rgba(255,255,255,.78)" : palette.muted }]}>{firstString(option, ["displayName", "display_name"]) ?? "Cylinder"}</Text>
                </View>
                {selected ? <Check color="#FFFFFF" size={19} /> : null}
              </Pressable>
            );
          })}
        </View>
        {!sizeOptions.length ? <Text style={[styles.errorText, { color: palette.danger }]}>Cylinder sizes are unavailable right now. Please try again shortly.</Text> : null}
      </View>

      <View style={[styles.stepCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <StepHeader number="3" title="Add a clear cylinder photo" description="A photo helps you, drivers and SKIMA recognise the correct physical cylinder. You can also add one later." />
        {photo ? (
          <View style={[styles.photoPreview, { borderColor: palette.border }]}>
            <Image source={{ uri: photo.uri }} resizeMode="cover" style={styles.photo} />
            <View style={styles.photoOverlay}>
              <AppButton label="Take new" size="sm" variant="secondary" icon={<Camera color={palette.brand} size={16} />} onPress={() => void takePhoto()} />
              <AppButton label="Choose another" size="sm" variant="secondary" icon={<ImagePlus color={palette.brand} size={16} />} onPress={() => void choosePhoto()} />
            </View>
          </View>
        ) : (
          <View style={[styles.photoPicker, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}> 
            <View style={[styles.cameraIcon, { backgroundColor: palette.brandSoft }]}><Camera color={palette.brand} size={27} /></View>
            <Text style={[styles.photoTitle, { color: palette.ink }]}>Photograph the full cylinder</Text>
            <Text style={[styles.photoHint, { color: palette.muted }]}>Use a bright view where the body, colour and general condition are easy to see.</Text>
            <View style={styles.photoActions}>
              <AppButton label="Take photo" icon={<Camera color="#FFFFFF" size={17} />} onPress={() => void takePhoto()} />
              <AppButton label="Choose from device" variant="secondary" icon={<ImagePlus color={palette.brand} size={17} />} onPress={() => void choosePhoto()} />
            </View>
          </View>
        )}
      </View>

      <View style={[styles.stepCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <Pressable onPress={() => setShowOptional((value) => !value)} style={styles.optionalToggle}>
          <View style={styles.optionalCopy}>
            <Text style={[styles.optionalTitle, { color: palette.ink }]}>Optional details</Text>
            <Text style={[styles.optionalBody, { color: palette.muted }]}>Colour and manufacturer can help with recognition.</Text>
          </View>
          <ChevronDown color={palette.muted} size={20} style={{ transform: [{ rotate: showOptional ? "180deg" : "0deg" }] }} />
        </Pressable>
        {showOptional ? (
          <View style={styles.optionalFields}>
            <View style={styles.fieldGroup}>
              <Text style={[styles.fieldLabel, { color: palette.ink }]}>Colour</Text>
              <TextInput onChangeText={setColour} placeholder="e.g. Grey" placeholderTextColor={palette.muted} style={inputStyle} value={colour} />
            </View>
            <View style={styles.fieldGroup}>
              <Text style={[styles.fieldLabel, { color: palette.ink }]}>Brand or maker</Text>
              <TextInput onChangeText={setBrand} placeholder="Optional" placeholderTextColor={palette.muted} style={inputStyle} value={brand} />
            </View>
          </View>
        ) : null}
      </View>

      <View style={[styles.review, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
        <View style={styles.reviewHead}>
          <Sparkles color={palette.brand} size={20} />
          <Text style={[styles.reviewTitle, { color: palette.ink }]}>Ready to create the identity?</Text>
        </View>
        <Text style={[styles.reviewBody, { color: palette.muted }]}>{ready ? `${name.trim()} · ${size} kg${photo ? " · photo added" : " · no photo yet"}` : "Complete the cylinder name and size before continuing."}</Text>
      </View>

      {error ? (
        <View style={[styles.errorBox, { backgroundColor: palette.dangerSoft }]}>
          <Text accessibilityRole="alert" style={[styles.errorText, { color: palette.danger }]}>{error}</Text>
        </View>
      ) : null}

      <AppButton
        label={submitting ? submitLabel ?? "Creating your cylinder" : "Create SKIMA cylinder"}
        fullWidth
        size="lg"
        loading={mutation.isPending || submitting}
        disabled={!ready}
        icon={<Sparkles color="#FFFFFF" size={18} />}
        onPress={() => void submit()}
      />

      {submitting && uploadProgress !== null ? (
        <Text style={[styles.progress, { color: palette.muted }]}>Photo upload {Math.round(uploadProgress * 100)}%</Text>
      ) : null}

      <Text style={[styles.note, { color: palette.muted }]}>Your progress is saved on this device until registration is completed.</Text>
    </Screen>
  );
}

function StepHeader({ number, title, description }: { number: string; title: string; description: string }) {
  const { palette } = useAppTheme();
  return (
    <View style={styles.stepHeading}>
      <View style={[styles.stepNumber, { backgroundColor: palette.brand }]}><Text style={styles.stepNumberText}>{number}</Text></View>
      <View style={styles.stepCopy}>
        <Text style={[styles.stepTitle, { color: palette.ink }]}>{title}</Text>
        <Text style={[styles.hint, { color: palette.muted }]}>{description}</Text>
      </View>
    </View>
  );
}

function actionRecord(value: unknown): PlatformRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as PlatformRecord : null;
}

const styles = StyleSheet.create({
  identityNote: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl },
  identityIcon: { width: 50, height: 50, alignItems: "center", justifyContent: "center", borderRadius: 17 },
  identityCopy: { flex: 1, gap: 3 },
  identityTitle: { ...typography.subheading, fontSize: 15 },
  identityBody: { ...typography.caption, lineHeight: 18 },
  stepCard: { gap: spacing.md, padding: spacing.lg, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl },
  stepHeading: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  stepNumber: { width: 34, height: 34, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  stepNumberText: { color: "#FFFFFF", ...typography.bodyStrong, fontSize: 13 },
  stepCopy: { flex: 1, gap: 3 },
  stepTitle: { ...typography.subheading, fontSize: 15 },
  hint: { ...typography.caption, lineHeight: 17 },
  input: { minHeight: 54, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.md, fontSize: 16 },
  sizes: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  sizeOption: { minWidth: 138, flex: 1, minHeight: 76, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, padding: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg },
  sizeCopy: { gap: 2 },
  sizeValue: { ...typography.heading, fontSize: 19 },
  sizeLabel: { ...typography.caption, fontSize: 10 },
  photoPicker: { minHeight: 220, alignItems: "center", justifyContent: "center", gap: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderStyle: "dashed", borderRadius: radii.xl, padding: spacing.lg },
  cameraIcon: { width: 60, height: 60, alignItems: "center", justifyContent: "center", borderRadius: 20 },
  photoTitle: { ...typography.subheading, fontSize: 16, textAlign: "center" },
  photoHint: { maxWidth: 420, ...typography.caption, lineHeight: 18, textAlign: "center" },
  photoActions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: spacing.sm, marginTop: spacing.sm },
  photoPreview: { overflow: "hidden", borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl },
  photo: { width: "100%", height: 300 },
  photoOverlay: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, padding: spacing.md },
  optionalToggle: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  optionalCopy: { flex: 1, gap: 2 },
  optionalTitle: { ...typography.bodyStrong, fontSize: 14 },
  optionalBody: { ...typography.caption },
  optionalFields: { gap: spacing.md, paddingTop: spacing.sm },
  fieldGroup: { gap: spacing.sm },
  fieldLabel: { ...typography.caption, fontSize: 13, fontWeight: "900" },
  review: { gap: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  reviewHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  reviewTitle: { ...typography.bodyStrong, fontSize: 14 },
  reviewBody: { ...typography.caption, lineHeight: 18 },
  errorBox: { borderRadius: radii.md, padding: spacing.md },
  errorText: { ...typography.caption, fontWeight: "800", lineHeight: 18 },
  progress: { ...typography.caption, textAlign: "center" },
  note: { ...typography.caption, lineHeight: 18, textAlign: "center" },
});
