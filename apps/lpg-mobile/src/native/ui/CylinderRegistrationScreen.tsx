import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useGatewayMutation } from "../api/gateway";
import { ActionResponseSchema, recordId } from "../api/records";
import { uploadMedia } from "../media/upload";
import { useSession } from "../session/SessionProvider";
import { draftStore } from "../storage/drafts";
import { colors, radii, spacing } from "../theme/tokens";
import { useAppTheme } from "../theme/ThemeProvider";
import { idempotencyKey } from "../utilities/idempotency";
import { Screen } from "./Screen";
const DRAFT = "customer-cylinder-registration";
export function CylinderRegistrationScreen() {
  const session = useSession();
  const owner = session.context?.profile?.id ?? session.context?.user.id ?? "";
  const { palette } = useAppTheme();
  const [name, setName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [size, setSize] = useState("");
  const [colour, setColour] = useState("");
  const [brand, setBrand] = useState("");
  const [photo, setPhoto] = useState<{
    uri: string;
    fileName: string;
    mimeType: string;
  } | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mutation = useGatewayMutation({
    path: "/lpg/cylinders",
    schema: ActionResponseSchema,
    invalidate: [["cylinders"]],
  });
  const nameMutation = useGatewayMutation({
    path: "/lpg/cylinders/name",
    schema: ActionResponseSchema,
    invalidate: [["cylinders"]],
  });
  useEffect(() => {
    if (!owner) return;
    void draftStore.load(owner, DRAFT).then((draft) => {
      if (draft) {
        setName(String(draft.values.name ?? ""));
        setIdentifier(String(draft.values.identifier ?? ""));
        setSize(String(draft.values.size ?? ""));
        setColour(String(draft.values.colour ?? ""));
        setBrand(String(draft.values.brand ?? ""));
        const pending = draft.pendingMedia[0];
        if (pending)
          setPhoto({
            uri: pending.uri,
            fileName: "cylinder.jpg",
            mimeType: "image/jpeg",
          });
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
      step: photo ? "review" : "details",
      values: { name, identifier, size, colour, brand },
      pendingMedia: photo
        ? [{ uri: photo.uri, purpose: "cylinder-original" }]
        : [],
      createdAt: now,
      updatedAt: now,
    });
  }, [brand, colour, hydrated, identifier, name, owner, photo, size]);
  const choosePhoto = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("Photo-library permission was not granted.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      quality: 0.9,
    });
    if (!result.canceled) {
      const asset = result.assets[0];
      setPhoto({
        uri: asset.uri,
        fileName: asset.fileName ?? `cylinder-${Date.now()}.jpg`,
        mimeType: asset.mimeType ?? "image/jpeg",
      });
    }
  };
  const submit = async () => {
    setError(null);
    const kg = Number(size);
    if (name.trim().length < 2 || !identifier.trim() || !Number.isFinite(kg) || kg <= 0) {
      setError("Name your cylinder, then enter its identifier and a valid size.");
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
      const created = await mutation.mutateAsync({
        cylinderIdentifier: identifier.trim(),
        sizeKg: kg,
        maxCapacityKg: kg,
        brand: brand.trim() || undefined,
        colour: colour.trim() || undefined,
        imageAssetIds: assetId ? [assetId] : [],
        conditionStatus: "unknown",
        idempotencyKey: idempotencyKey("register-cylinder", identifier.trim()),
        metadata: { customerDefinedName: name.trim() },
      });
      const cylinderId = typeof created === "string" ? created : created ? recordId(created) : null;
      if (!cylinderId) throw new Error("The cylinder service did not return an identifier.");
      await nameMutation.mutateAsync({ cylinderId, displayName: name.trim() });
      await draftStore.clear(owner, DRAFT);
      router.replace("/(customer)/cylinders");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Cylinder registration failed.",
      );
    } finally {
      setSubmitting(false);
      setUploadProgress(null);
    }
  };
  const inputStyle = [styles.input, { backgroundColor: palette.input, borderColor: palette.border, color: palette.ink }];
  return (
    <Screen
      eyebrow="Cylinder registration"
      title="Add your cylinder"
      action={
        <Pressable onPress={() => router.back()}>
          <Text style={styles.link}>Cancel</Text>
        </Pressable>
      }
    >
      <View style={styles.form}>
        <View style={styles.fieldGroup}>
          <Text style={[styles.label, { color: palette.ink }]}>What do you call this cylinder?</Text>
          <Text style={[styles.hint, { color: palette.muted }]}>Use any useful name, such as Kitchen, Shop or Backup.</Text>
          <TextInput
            style={inputStyle}
            placeholder="Your cylinder name"
            placeholderTextColor={palette.muted}
            value={name}
            onChangeText={setName}
          />
        </View>
        <TextInput
          style={inputStyle}
          placeholder="Cylinder identifier"
          placeholderTextColor={palette.muted}
          value={identifier}
          onChangeText={setIdentifier}
        />
        <View style={styles.row}>
          <TextInput
            style={[...inputStyle, styles.half]}
            placeholder="Size (kg)"
            placeholderTextColor={palette.muted}
            keyboardType="decimal-pad"
            value={size}
            onChangeText={setSize}
          />
          <TextInput
            style={[...inputStyle, styles.half]}
            placeholder="Colour"
            placeholderTextColor={palette.muted}
            value={colour}
            onChangeText={setColour}
          />
        </View>
        <TextInput
          style={inputStyle}
          placeholder="Brand (optional)"
          placeholderTextColor={palette.muted}
          value={brand}
          onChangeText={setBrand}
        />
        {photo ? (
          <Image
            source={{ uri: photo.uri }}
            resizeMode="cover"
            style={styles.photo}
          />
        ) : null}
        <Pressable onPress={() => void choosePhoto()} style={styles.secondary}>
          <Text style={styles.secondaryText}>
            {photo ? "Change photograph" : "Add cylinder photograph"}
          </Text>
        </Pressable>
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
        <Pressable
          disabled={mutation.isPending || nameMutation.isPending || submitting}
          onPress={() => void submit()}
          style={styles.submit}
        >
          {mutation.isPending || nameMutation.isPending || submitting ? (
            <View style={styles.pendingRow}>
              <ActivityIndicator color="white" />
              <Text style={styles.submitText}>
                {uploadProgress === null
                  ? "Registering securely"
                  : `Uploading ${Math.round(uploadProgress * 100)}%`}
              </Text>
            </View>
          ) : (
            <Text style={styles.submitText}>Register cylinder</Text>
          )}
        </Pressable>
        <Text style={styles.note}>
          Your progress is saved to this profile on this device until
          registration succeeds.
        </Text>
      </View>
    </Screen>
  );
}
const styles = StyleSheet.create({
  form: { width: "100%", maxWidth: 620, gap: spacing.md },
  fieldGroup: { gap: spacing.xs },
  label: { fontSize: 15, fontWeight: "900" },
  hint: { fontSize: 13, lineHeight: 18, marginBottom: spacing.xs },
  row: { flexDirection: "row", gap: spacing.md },
  half: { flex: 1 },
  input: {
    minHeight: 54,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    color: colors.ink,
    fontSize: 16,
  },
  photo: { width: "100%", aspectRatio: 4 / 3, borderRadius: radii.lg },
  secondary: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: radii.md,
  },
  secondaryText: { color: colors.brand, fontWeight: "800" },
  submit: {
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand,
    borderRadius: radii.md,
  },
  submitText: { color: "white", fontWeight: "800" },
  pendingRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  link: { color: colors.brand, fontWeight: "800" },
  error: { color: colors.danger },
  note: { color: colors.muted, fontSize: 13, lineHeight: 19 },
});
