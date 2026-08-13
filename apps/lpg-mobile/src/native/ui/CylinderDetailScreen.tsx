import { router, useLocalSearchParams } from "expo-router";
import {
  Download,
  Edit3,
  QrCode as QrCodeIcon,
  RefreshCw,
  Save,
} from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import QRCode from "react-native-qrcode-svg";
import { domainQueries } from "../api/domains";
import { useGatewayMutation } from "../api/gateway";
import {
  ActionResponseSchema,
  displayReference,
  displayStatus,
  firstNumber,
  firstString,
  recordId,
} from "../api/records";
import { useAppTheme } from "../theme/ThemeProvider";
import { colors, radii, spacing } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { saveQrPng } from "../utilities/qrDownload";
import { Card } from "./Card";
import { PresentationMediaPanel } from "./PresentationMediaPanel";
import { Screen } from "./Screen";
import { ScreenSkeleton } from "./ScreenSkeleton";

type QrHandle = { toDataURL(callback: (base64: string) => void): void };

export function CylinderDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { palette } = useAppTheme();
  const query = domainQueries.cylinders();
  const qrRef = useRef<QrHandle | null>(null);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const cylinder = query.data?.find(
    (item) => recordId(item) === id || displayReference(item) === id,
  );
  const cylinderReference = cylinder ? displayReference(cylinder) : null;
  const displayName = cylinder ? firstString(cylinder, ["display_name", "displayName"]) : null;
  const qrValue = cylinder ? firstString(cylinder, ["qr_payload", "qrPayload"]) : null;
  const cylinderId = cylinder ? recordId(cylinder) : null;
  const nameMutation = useGatewayMutation({
    path: "/lpg/cylinders/name",
    schema: ActionResponseSchema,
    invalidate: [["cylinders"]],
  });

  useEffect(() => setName(displayName ?? ""), [displayName]);

  const saveName = async () => {
    if (!cylinderId || name.trim().length < 2) return;
    setMessage(null);
    try {
      await nameMutation.mutateAsync({
        cylinderId,
        displayName: name.trim(),
      });
      setEditing(false);
      setMessage("Cylinder name saved.");
    } catch (cause) {
      setMessage(friendlyError(cause, "We couldn't save the new name. Please try again."));
    }
  };

  const downloadQr = async () => {
    if (!qrRef.current) return;
    setMessage(null);
    try {
      await new Promise<void>((resolve, reject) => {
        qrRef.current?.toDataURL((base64) => {
          void saveQrPng(
            `data:image/png;base64,${base64}`,
            `${safeFileName(displayName ?? cylinderReference ?? "skima-cylinder")}-qr.png`,
          ).then(resolve, reject);
        });
      });
      setMessage("QR code is ready to save or share.");
    } catch (cause) {
      setMessage(friendlyError(cause, "We couldn't save the QR code. Please try again."));
    }
  };

  return (
    <Screen
      eyebrow="Verified asset"
      title={displayName ?? "Cylinder details"}
      action={
        <Pressable onPress={() => router.back()}>
          <Text style={styles.back}>Back</Text>
        </Pressable>
      }
    >
      {query.isPending ? (
        <ScreenSkeleton cards={3} />
      ) : query.error ? (
        <Text style={styles.error}>We couldn't load this cylinder. Please try again.</Text>
      ) : !cylinder ? (
        <Text style={[styles.muted, { color: palette.muted }]}>
          This cylinder is unavailable or you no longer have access.
        </Text>
      ) : (
        <>
          <PresentationMediaPanel
            colour={firstString(cylinder, ["colour", "color"])}
            originalAssetId={firstAssetId(cylinder.image_asset_ids ?? cylinder.imageAssetIds)}
            subjectId={cylinderId ?? id ?? ""}
            subjectType="lpg_cylinder"
          />

          <Card>
            <View style={styles.nameHead}>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={[styles.label, { color: palette.muted }]}>
                  YOUR CYLINDER NAME
                </Text>
                {editing ? (
                  <TextInput
                    autoFocus
                    onChangeText={setName}
                    placeholder="Name this cylinder"
                    placeholderTextColor={palette.muted}
                    style={[
                      styles.nameInput,
                      {
                        color: palette.ink,
                        borderColor: palette.border,
                        backgroundColor: palette.input,
                      },
                    ]}
                    value={name}
                  />
                ) : (
                  <Text style={[styles.nameValue, { color: palette.ink }]}>
                    {displayName ?? "Add a name"}
                  </Text>
                )}
              </View>
              <Pressable
                onPress={() => editing ? void saveName() : setEditing(true)}
                style={[styles.editButton, { backgroundColor: palette.brandSoft }]}
              >
                {nameMutation.isPending ? (
                  <ActivityIndicator color={colors.brand} />
                ) : editing ? (
                  <Save color={colors.brand} size={19} />
                ) : (
                  <Edit3 color={colors.brand} size={19} />
                )}
              </Pressable>
            </View>
            {message ? (
              <Text
                accessibilityRole="alert"
                style={[
                  styles.message,
                  {
                    color: message.includes("saved") || message.includes("ready")
                      ? colors.success
                      : colors.danger,
                  },
                ]}
              >
                {message}
              </Text>
            ) : null}
          </Card>

          <Card>
            <Field label="SKIMA reference" value={cylinderReference ?? "Unavailable"} />
            <Field label="Size" value={`${firstNumber(cylinder, ["size_kg", "sizeKg"]) ?? "Configured"} kg`} />
            <Field label="Brand" value={firstString(cylinder, ["brand", "manufacturer"]) ?? "Not recorded"} />
            <Field label="Serial number" value={firstString(cylinder, ["serial_number", "serialNumber"]) ?? "Not recorded"} />
            <Field label="Colour" value={firstString(cylinder, ["colour", "color"]) ?? "Not recorded"} />
            <Field label="Condition" value={(firstString(cylinder, ["condition_status", "conditionStatus"]) ?? "Not recorded").replace(/[_-]/g, " ")} />
            <Field label="Next inspection" value={formatDate(firstString(cylinder, ["next_inspection_at", "nextInspectionAt"]))} />
          </Card>

          <View
            style={[
              styles.qrCard,
              {
                backgroundColor: palette.surface,
                borderColor: palette.border,
                shadowColor: palette.shadow,
              },
            ]}
          >
            <View style={styles.qrHeader}>
              <View style={[styles.qrIcon, { backgroundColor: palette.brandSoft }]}>
                <QrCodeIcon color={colors.brand} size={22} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.qrTitle, { color: palette.ink }]}>
                  Private cylinder scan code
                </Text>
                <Text style={[styles.muted, { color: palette.muted }]}>
                  Download saves only the QR code, not the full screen.
                </Text>
              </View>
            </View>

            {qrValue ? (
              <>
                <View style={styles.qrFrame}>
                  <QRCode
                    ref={qrRef as never}
                    backgroundColor="white"
                    color={colors.ink}
                    size={192}
                    value={qrValue}
                  />
                </View>
                <Text style={[styles.reference, { color: palette.ink }]}>
                  {displayReference(cylinder)}
                </Text>
                <Text style={styles.status}>
                  {(displayStatus(cylinder) ?? "registered").replace(/[_-]/g, " ")}
                </Text>
                <Pressable style={styles.primary} onPress={() => void downloadQr()}>
                  <Download color="white" size={19} />
                  <Text style={styles.primaryText}>Download QR code</Text>
                </Pressable>
              </>
            ) : (
              <View style={styles.pendingIdentity}>
                <View style={[styles.qrSkeleton, { borderColor: palette.border }]}>
                  {Array.from({ length: 9 }).map((_, index) => (
                    <View
                      key={index}
                      style={[
                        styles.qrSkeletonBit,
                        {
                          opacity: index % 2 === 0 ? 1 : 0.45,
                          backgroundColor: index % 3 === 0 ? colors.brand : palette.border,
                        },
                      ]}
                    />
                  ))}
                </View>
                <Text style={[styles.pendingTitle, { color: palette.ink }]}>
                  Scan code repair in progress
                </Text>
                <Text style={[styles.pendingBody, { color: palette.muted }]}>
                  Existing cylinders are being assigned permanent private scan codes. Refresh this view after the backend migration finishes.
                </Text>
                <Pressable
                  onPress={() => void query.refetch()}
                  style={[styles.secondary, { borderColor: palette.border }]}
                >
                  <RefreshCw color={colors.brand} size={17} />
                  <Text style={styles.secondaryText}>Refresh identity</Text>
                </Pressable>
              </View>
            )}
          </View>
        </>
      )}
    </Screen>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  const { palette } = useAppTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: palette.muted }]}>{label}</Text>
      <Text style={[styles.value, { color: palette.ink }]}>{value}</Text>
    </View>
  );
}

function formatDate(value: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function firstAssetId(value: unknown) {
  return Array.isArray(value)
    ? value.find((item): item is string => typeof item === "string") ?? null
    : null;
}

function safeFileName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "skima-cylinder";
}

const styles = StyleSheet.create({
  back: { color: colors.brand, fontWeight: "800" },
  error: { color: colors.danger },
  muted: { lineHeight: 20 },
  nameHead: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  nameValue: { fontSize: 22, fontWeight: "900" },
  nameInput: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    fontSize: 17,
    fontWeight: "800",
  },
  editButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
  },
  message: { fontWeight: "700" },
  field: { gap: 3 },
  label: {
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  value: { fontSize: 16, fontWeight: "700", textTransform: "capitalize" },
  qrCard: {
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.lg,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
  },
  qrHeader: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  qrIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  qrTitle: { fontSize: 17, fontWeight: "900" },
  qrFrame: {
    padding: spacing.md,
    backgroundColor: "white",
    borderRadius: 22,
  },
  reference: { fontSize: 17, fontWeight: "900" },
  status: { color: colors.success, fontWeight: "800", textTransform: "uppercase" },
  primary: {
    width: "100%",
    minHeight: 54,
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: colors.brand,
    marginTop: spacing.sm,
  },
  primaryText: { color: "white", fontWeight: "900" },
  pendingIdentity: { width: "100%", alignItems: "center", gap: spacing.sm },
  qrSkeleton: {
    width: 164,
    height: 164,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "center",
    alignContent: "center",
    padding: 18,
    borderWidth: 1,
    borderRadius: 24,
  },
  qrSkeletonBit: { width: 32, height: 32, borderRadius: 8 },
  pendingTitle: { fontSize: 17, fontWeight: "900", textAlign: "center" },
  pendingBody: { maxWidth: 420, lineHeight: 20, textAlign: "center" },
  secondary: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderRadius: radii.pill,
  },
  secondaryText: { color: colors.brand, fontWeight: "900" },
});
