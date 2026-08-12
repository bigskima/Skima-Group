import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { Camera, Check, ChevronDown, ShieldCheck, Sparkles } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useGatewayMutation } from "../api/gateway";
import { ActionResponseSchema, firstNumber, firstString, nestedRecords } from "../api/records";
import { useLpgConfig } from "../api/domains";
import { uploadMedia } from "../media/upload";
import { useSession } from "../session/SessionProvider";
import { draftStore } from "../storage/drafts";
import { useAppTheme } from "../theme/ThemeProvider";
import { colors, radii, spacing } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { idempotencyKey } from "../utilities/idempotency";
import { Screen } from "./Screen";
import { ScreenSkeleton } from "./ScreenSkeleton";

const DRAFT = "customer-cylinder-registration";

export function CylinderRegistrationScreen() {
  const session = useSession();
  const owner = session.context?.profile?.id ?? session.context?.user.id ?? "";
  const { palette } = useAppTheme();
  const config = useLpgConfig();
  const [name, setName] = useState("");
  const [size, setSize] = useState("");
  const [colour, setColour] = useState("");
  const [brand, setBrand] = useState("");
  const [showOptional, setShowOptional] = useState(false);
  const [photo, setPhoto] = useState<{ uri: string; fileName: string; mimeType: string } | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mutation = useGatewayMutation({ path: "/lpg/cylinders", schema: ActionResponseSchema, invalidate: [["cylinders"]] });
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
        if (pending) setPhoto({ uri: pending.uri, fileName: "cylinder.jpg", mimeType: "image/jpeg" });
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

  const choosePhoto = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("Allow photo access to choose a cylinder picture. You can continue without one and add it later.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, quality: 0.9 });
    if (!result.canceled) {
      const asset = result.assets[0];
      setPhoto({ uri: asset.uri, fileName: asset.fileName ?? `cylinder-${Date.now()}.jpg`, mimeType: asset.mimeType ?? "image/jpeg" });
      setError(null);
    }
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
    setUploadProgress(photo ? 0 : null);
    try {
      let assetId: string | undefined;
      if (photo)
        assetId = await uploadMedia({
          api: session.api,
          uri: photo.uri,
          fileName: photo.fileName,
          contentType: photo.mimeType,
          ownerUserId: session.context!.user.id,
          assetTypeKey: "lpg.cylinder.original",
          onProgress: setUploadProgress,
        });
      await mutation.mutateAsync({
        displayName: name.trim(),
        sizeKg: kg,
        maxCapacityKg,
        brand: brand.trim() || undefined,
        colour: colour.trim() || undefined,
        imageAssetIds: assetId ? [assetId] : [],
        conditionStatus: "unknown",
        idempotencyKey: idempotencyKey("register-cylinder", `${owner}:${name.trim()}:${kg}`),
        metadata: { registrationExperience: "guided_v2" },
      });
      await draftStore.clear(owner, DRAFT);
      router.replace("/(customer)/cylinders");
    } catch (cause) {
      setError(friendlyError(cause, "We couldn’t register this cylinder. Check the details and try again."));
    } finally {
      setSubmitting(false);
      setUploadProgress(null);
    }
  };

  if (config.isPending) return <Screen eyebrow="Add a cylinder" title="Let’s identify yours"><ScreenSkeleton cards={3} /></Screen>;
  const inputStyle = [styles.input, { backgroundColor: palette.input, borderColor: palette.border, color: palette.ink }];
  return (
    <Screen eyebrow="Add a cylinder" title="Let’s identify yours" action={<Pressable onPress={() => router.back()}><Text style={styles.link}>Cancel</Text></Pressable>}>
      <View style={[styles.identityNote, { backgroundColor: palette.ink }]}>
        <View style={styles.identityIcon}><ShieldCheck color="white" size={26} /></View>
        <View style={{ flex: 1, gap: 3 }}><Text style={styles.identityTitle}>SKIMA creates the identity</Text><Text style={styles.identityBody}>No serial number hunt. We’ll issue a permanent SKIMA reference and private scan code after registration.</Text></View>
      </View>

      <View style={styles.form}>
        <View style={styles.stepHeading}><Text style={styles.stepNumber}>1</Text><View><Text style={[styles.stepTitle, { color: palette.ink }]}>Name your cylinder</Text><Text style={[styles.hint, { color: palette.muted }]}>Choose any name that makes sense to you.</Text></View></View>
        <TextInput style={inputStyle} placeholder="Kitchen cylinder" placeholderTextColor={palette.muted} value={name} onChangeText={setName} />

        <View style={styles.stepHeading}><Text style={styles.stepNumber}>2</Text><View><Text style={[styles.stepTitle, { color: palette.ink }]}>Choose the size</Text><Text style={[styles.hint, { color: palette.muted }]}>Look for the kilogram marking on the cylinder.</Text></View></View>
        <View style={styles.sizes}>
          {sizeOptions.map((option, index) => {
            const kg = firstNumber(option, ["sizeKg", "size_kg"]);
            if (kg === null) return null;
            const value = String(kg);
            const selected = value === size;
            return <Pressable key={firstString(option, ["id", "key"]) ?? String(index)} onPress={() => setSize(value)} style={[styles.sizeOption, { backgroundColor: selected ? colors.brand : palette.surface, borderColor: selected ? colors.brand : palette.border }]}><Text style={[styles.sizeValue, { color: selected ? "white" : palette.ink }]}>{kg} kg</Text><Text style={[styles.sizeLabel, { color: selected ? "rgba(255,255,255,.78)" : palette.muted }]}>{firstString(option, ["displayName", "display_name"]) ?? "Cylinder"}</Text>{selected ? <Check color="white" size={18} /> : null}</Pressable>;
          })}
        </View>
        {!sizeOptions.length ? <Text style={styles.error}>Cylinder sizes are unavailable right now. Please try again shortly.</Text> : null}

        <View style={styles.stepHeading}><Text style={styles.stepNumber}>3</Text><View><Text style={[styles.stepTitle, { color: palette.ink }]}>Add a clear photo</Text><Text style={[styles.hint, { color: palette.muted }]}>Recommended for easier recognition and a polished cylinder image.</Text></View></View>
        <Pressable onPress={() => void choosePhoto()} style={[styles.photoPicker, { backgroundColor: palette.soft, borderColor: palette.border }]}>
          {photo ? <Image source={{ uri: photo.uri }} resizeMode="cover" style={styles.photo} /> : <><View style={[styles.cameraIcon, { backgroundColor: palette.surface }]}><Camera color={colors.brand} size={27} /></View><Text style={[styles.photoTitle, { color: palette.ink }]}>Choose cylinder photo</Text><Text style={[styles.photoHint, { color: palette.muted }]}>Use a bright, full view of the cylinder.</Text></>}
          {photo ? <View style={styles.changePhoto}><Camera color="white" size={17} /><Text style={styles.changePhotoText}>Change photo</Text></View> : null}
        </Pressable>

        <Pressable onPress={() => setShowOptional((value) => !value)} style={styles.optionalToggle}><Text style={[styles.optionalText, { color: palette.ink }]}>Optional details</Text><ChevronDown color={palette.muted} size={20} /></Pressable>
        {showOptional ? <View style={styles.optionalFields}><TextInput style={inputStyle} placeholder="Colour (optional)" placeholderTextColor={palette.muted} value={colour} onChangeText={setColour} /><TextInput style={inputStyle} placeholder="Brand or maker (optional)" placeholderTextColor={palette.muted} value={brand} onChangeText={setBrand} /></View> : null}

        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <Pressable disabled={mutation.isPending || submitting || !name.trim() || !size} onPress={() => void submit()} style={[styles.submit, (!name.trim() || !size) && styles.disabled]}>
          {mutation.isPending || submitting ? <View style={styles.pendingRow}><ActivityIndicator color="white" /><Text style={styles.submitText}>{uploadProgress === null ? "Creating your cylinder" : `Uploading photo ${Math.round(uploadProgress * 100)}%`}</Text></View> : <><Sparkles color="white" size={19} /><Text style={styles.submitText}>Create SKIMA cylinder</Text></>}
        </Pressable>
        <Text style={[styles.note, { color: palette.muted }]}>You can leave and come back—your progress stays on this device until registration is complete.</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  identityNote: { maxWidth: 720, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderRadius: 28 },
  identityIcon: { width: 52, height: 52, alignItems: "center", justifyContent: "center", borderRadius: 26, backgroundColor: colors.brand },
  identityTitle: { color: "white", fontSize: 18, fontWeight: "900" },
  identityBody: { color: "rgba(255,255,255,.72)", lineHeight: 20 },
  form: { width: "100%", maxWidth: 720, gap: spacing.md },
  stepHeading: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.sm },
  stepNumber: { width: 34, height: 34, color: "white", lineHeight: 34, textAlign: "center", borderRadius: 17, overflow: "hidden", backgroundColor: colors.brand, fontWeight: "900" },
  stepTitle: { fontSize: 18, fontWeight: "900" },
  hint: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  input: { minHeight: 56, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.md, fontSize: 16 },
  sizes: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  sizeOption: { minWidth: 135, flex: 1, minHeight: 92, justifyContent: "center", gap: 3, padding: spacing.md, borderWidth: 1, borderRadius: radii.lg },
  sizeValue: { fontSize: 21, fontWeight: "900" },
  sizeLabel: { fontSize: 11, fontWeight: "700" },
  photoPicker: { minHeight: 220, overflow: "hidden", alignItems: "center", justifyContent: "center", gap: spacing.sm, borderWidth: 1, borderStyle: "dashed", borderRadius: 28 },
  cameraIcon: { width: 60, height: 60, alignItems: "center", justifyContent: "center", borderRadius: 30 },
  photoTitle: { fontSize: 17, fontWeight: "900" },
  photoHint: { fontSize: 13 },
  photo: { width: "100%", height: 300 },
  changePhoto: { position: "absolute", right: spacing.md, bottom: spacing.md, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radii.pill, backgroundColor: "rgba(23,33,27,.82)" },
  changePhotoText: { color: "white", fontWeight: "900" },
  optionalToggle: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: colors.border },
  optionalText: { fontWeight: "900" },
  optionalFields: { gap: spacing.sm },
  submit: { minHeight: 58, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brand, borderRadius: radii.md },
  disabled: { opacity: .45 },
  submitText: { color: "white", fontSize: 16, fontWeight: "900" },
  pendingRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  link: { color: colors.brand, fontWeight: "900" },
  error: { color: colors.danger, fontWeight: "700", lineHeight: 20 },
  note: { fontSize: 13, lineHeight: 19, textAlign: "center" },
});
