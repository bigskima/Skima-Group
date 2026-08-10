import * as Print from "expo-print";
import { router, useLocalSearchParams } from "expo-router";
import * as Sharing from "expo-sharing";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import QRCode from "react-native-qrcode-svg";
import { domainQueries } from "../api/domains";
import {
  displayReference,
  displayStatus,
  firstNumber,
  firstString,
  recordId,
} from "../api/records";
import { colors, radii, spacing } from "../theme/tokens";
import { Card } from "./Card";
import { PresentationMediaPanel } from "./PresentationMediaPanel";
import { Screen } from "./Screen";

export function CylinderDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const query = domainQueries.cylinders();
  const cylinder = query.data?.find(
    (item) => recordId(item) === id || displayReference(item) === id,
  );
  const identifier = cylinder
    ? firstString(cylinder, [
        "cylinder_identifier",
        "cylinderIdentifier",
        "public_reference",
        "publicReference",
        "id",
      ])
    : null;
  const shareLabel = async () => {
    if (!cylinder || !identifier) return;
    const title = escapeHtml(displayReference(cylinder) ?? identifier);
    const file = await Print.printToFileAsync({
      html: `<html><body style="font-family:Arial;text-align:center;padding:48px"><h1>SKIMA LPG</h1><h2>${title}</h2><p>Verified cylinder identity</p><hr/><p>Size: ${firstNumber(cylinder, ["size_kg", "sizeKg"]) ?? "Configured"} kg</p><p>Serial: ${escapeHtml(firstString(cylinder, ["serial_number", "serialNumber"]) ?? "Not recorded")}</p><p>Scan this cylinder in the SKIMA LPG app using identifier:</p><h3>${escapeHtml(identifier)}</h3></body></html>`,
    });
    if (await Sharing.isAvailableAsync())
      await Sharing.shareAsync(file.uri, {
        mimeType: "application/pdf",
        dialogTitle: "Share cylinder label",
      });
  };
  return (
    <Screen
      eyebrow="Verified asset"
      title={
        cylinder
          ? `${firstNumber(cylinder, ["size_kg", "sizeKg"]) ?? ""} kg cylinder`.trim()
          : "Cylinder details"
      }
      action={
        <Pressable onPress={() => router.back()}>
          <Text style={styles.back}>Back</Text>
        </Pressable>
      }
    >
      {query.isPending ? (
        <ActivityIndicator color={colors.brand} />
      ) : query.error ? (
        <Text style={styles.error}>{query.error.message}</Text>
      ) : !cylinder ? (
        <Text style={styles.muted}>
          This cylinder is unavailable or you no longer have access.
        </Text>
      ) : (
        <>
          <View style={styles.identity}>
            <View style={styles.qr}>
              <QRCode
                value={identifier ?? recordId(cylinder) ?? "unavailable"}
                size={168}
                color={colors.ink}
                backgroundColor="white"
              />
            </View>
            <Text style={styles.reference}>{displayReference(cylinder)}</Text>
            <Text style={styles.status}>
              {(displayStatus(cylinder) ?? "registered").replace(/[_-]/g, " ")}
            </Text>
          </View>
          <Card>
            <Field
              label="Cylinder identifier"
              value={identifier ?? "Unavailable"}
            />
            <Field
              label="Brand"
              value={
                firstString(cylinder, ["brand", "manufacturer"]) ??
                "Not recorded"
              }
            />
            <Field
              label="Serial number"
              value={
                firstString(cylinder, ["serial_number", "serialNumber"]) ??
                "Not recorded"
              }
            />
            <Field
              label="Colour"
              value={
                firstString(cylinder, ["colour", "color"]) ?? "Not recorded"
              }
            />
            <Field
              label="Condition"
              value={(
                firstString(cylinder, [
                  "condition_status",
                  "conditionStatus",
                ]) ?? "Not recorded"
              ).replace(/[_-]/g, " ")}
            />
            <Field
              label="Next inspection"
              value={formatDate(
                firstString(cylinder, [
                  "next_inspection_at",
                  "nextInspectionAt",
                ]),
              )}
            />
          </Card>
          <Pressable style={styles.primary} onPress={() => void shareLabel()}>
            <Text style={styles.primaryText}>
              Download or share cylinder label
            </Text>
          </Pressable>
          {id ? (
            <PresentationMediaPanel
              subjectId={recordId(cylinder) ?? id}
              subjectType="lpg_cylinder"
              colour={firstString(cylinder, ["colour", "color"])}
              originalAssetId={firstAssetId(
                cylinder.image_asset_ids ?? cylinder.imageAssetIds,
              )}
            />
          ) : null}
        </>
      )}
    </Screen>
  );
}
function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}
function formatDate(value: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}
function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ] ?? character,
  );
}
function firstAssetId(value: unknown) {
  return Array.isArray(value)
    ? (value.find((item): item is string => typeof item === "string") ?? null)
    : null;
}
const styles = StyleSheet.create({
  back: { color: colors.brand, fontWeight: "800" },
  error: { color: colors.danger },
  muted: { color: colors.muted },
  identity: {
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.xl,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  qr: { padding: spacing.md, backgroundColor: "white", borderRadius: radii.md },
  reference: { color: colors.ink, fontSize: 22, fontWeight: "900" },
  status: {
    color: colors.success,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  field: { gap: 3 },
  label: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  value: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: "700",
    textTransform: "capitalize",
  },
  primary: {
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: colors.brand,
  },
  primaryText: { color: "white", fontWeight: "900" },
});
