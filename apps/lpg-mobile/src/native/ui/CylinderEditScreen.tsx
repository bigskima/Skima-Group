import { router, useLocalSearchParams } from "expo-router";
import { Save } from "lucide-react-native";
import { useEffect, useState, type ReactNode } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { domainQueries } from "../api/domains";
import { useGatewayMutation } from "../api/gateway";
import { ActionResponseSchema, displayReference, firstString, recordId } from "../api/records";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { idempotencyKey } from "../utilities/idempotency";
import { AppButton } from "./AppButton";
import { EmptyState } from "./EmptyState";
import { Screen } from "./Screen";
import { ScreenSkeleton } from "./ScreenSkeleton";

export function CylinderEditScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { palette } = useAppTheme();
  const cylinders = domainQueries.cylinders();
  const cylinder = cylinders.data?.find((item) => recordId(item) === id || displayReference(item) === id);
  const cylinderId = cylinder ? recordId(cylinder) : null;
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [colour, setColour] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [valveType, setValveType] = useState("");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [messageError, setMessageError] = useState(false);

  useEffect(() => {
    if (!cylinder) return;
    setName(firstString(cylinder, ["display_name", "displayName"]) ?? "");
    setBrand(firstString(cylinder, ["brand"]) ?? "");
    setManufacturer(firstString(cylinder, ["manufacturer"]) ?? "");
    setColour(firstString(cylinder, ["colour", "color"]) ?? "");
    setSerialNumber(firstString(cylinder, ["serial_number", "serialNumber"]) ?? "");
    setValveType(firstString(cylinder, ["valve_type", "valveType"]) ?? "");
    setNotes(firstString(cylinder, ["notes"]) ?? "");
  }, [cylinderId]);

  const mutation = useGatewayMutation({
    path: "/lpg/cylinders/update",
    schema: ActionResponseSchema,
    invalidate: [["cylinders"]],
  });

  const save = async () => {
    if (!cylinderId || name.trim().length < 2 || mutation.isPending) return;
    setMessage(null);
    setMessageError(false);
    try {
      await mutation.mutateAsync({
        cylinderId,
        displayName: name.trim(),
        brand: brand.trim() || undefined,
        manufacturer: manufacturer.trim() || undefined,
        colour: colour.trim() || undefined,
        serialNumber: serialNumber.trim() || undefined,
        valveType: valveType.trim() || undefined,
        notes: notes.trim() || undefined,
        metadata: { editedFrom: "customer_cylinder_details" },
        idempotencyKey: idempotencyKey("cylinder-details", cylinderId + ":" + Date.now()),
      });
      await cylinders.refetch();
      setMessage("Cylinder details updated.");
    } catch (cause) {
      setMessageError(true);
      setMessage(friendlyError(cause, "Cylinder details could not be updated. Please try again."));
    }
  };

  if (cylinders.isPending) {
    return <Screen eyebrow="Cylinder details" title="Edit details"><ScreenSkeleton cards={2} /></Screen>;
  }
  if (!cylinder || !cylinderId) {
    return (
      <Screen eyebrow="Cylinder details" title="Edit details">
        <EmptyState title="Cylinder unavailable" description="This cylinder is no longer available." />
      </Screen>
    );
  }

  const inputStyle = [
    styles.input,
    { backgroundColor: palette.input, borderColor: palette.borderStrong, color: palette.ink },
  ];

  return (
    <Screen
      eyebrow="Cylinder details"
      title="Edit details"
      subtitle="Update normal identifying information here. Verified capacity has its own review route."
      action={<AppButton label="Back" variant="ghost" size="sm" onPress={() => router.back()} />}
    >
      <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <Field label="Cylinder name">
          <TextInput value={name} onChangeText={setName} style={inputStyle} />
        </Field>
        <View style={styles.twoColumn}>
          <View style={styles.flex}>
            <Field label="Brand">
              <TextInput value={brand} onChangeText={setBrand} placeholder="Optional" placeholderTextColor={palette.muted} style={inputStyle} />
            </Field>
          </View>
          <View style={styles.flex}>
            <Field label="Colour">
              <TextInput value={colour} onChangeText={setColour} placeholder="Optional" placeholderTextColor={palette.muted} style={inputStyle} />
            </Field>
          </View>
        </View>
        <Field label="Manufacturer">
          <TextInput value={manufacturer} onChangeText={setManufacturer} placeholder="Optional" placeholderTextColor={palette.muted} style={inputStyle} />
        </Field>
        <View style={styles.twoColumn}>
          <View style={styles.flex}>
            <Field label="Serial number">
              <TextInput value={serialNumber} onChangeText={setSerialNumber} placeholder="Optional" placeholderTextColor={palette.muted} style={inputStyle} />
            </Field>
          </View>
          <View style={styles.flex}>
            <Field label="Valve type">
              <TextInput value={valveType} onChangeText={setValveType} placeholder="Optional" placeholderTextColor={palette.muted} style={inputStyle} />
            </Field>
          </View>
        </View>
        <Field label="Notes">
          <TextInput value={notes} onChangeText={setNotes} multiline placeholder="Optional notes" placeholderTextColor={palette.muted} style={[...inputStyle, styles.textArea]} />
        </Field>
      </View>

      {message ? (
        <Text accessibilityRole="alert" style={[styles.message, { color: messageError ? palette.danger : palette.success }]}>
          {message}
        </Text>
      ) : null}

      <AppButton
        label="Save cylinder details"
        fullWidth
        loading={mutation.isPending}
        disabled={name.trim().length < 2}
        icon={<Save color="#FFFFFF" size={17} />}
        onPress={() => void save()}
      />
    </Screen>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  const { palette } = useAppTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: palette.mutedStrong }]}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  field: { gap: 6 },
  label: { ...typography.caption, fontSize: 10, fontWeight: "800" },
  input: { minHeight: 44, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.sm + 2, fontSize: 14 },
  textArea: { minHeight: 76, paddingVertical: spacing.sm, textAlignVertical: "top" },
  twoColumn: { flexDirection: "row", gap: spacing.sm },
  flex: { flex: 1 },
  message: { ...typography.caption, fontWeight: "700", textAlign: "center" },
});
