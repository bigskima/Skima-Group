import { router, useLocalSearchParams } from "expo-router";
import { Download, Edit3, QrCode as QrCodeIcon, RefreshCw, Save, Scale, ShieldCheck } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { domainQueries } from "../api/domains";
import { useGatewayMutation } from "../api/gateway";
import { ActionResponseSchema, displayReference, displayStatus, firstNumber, firstString, recordId, type PlatformRecord } from "../api/records";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { saveQrPng } from "../utilities/qrDownload";
import { AppButton } from "./AppButton";
import { EmptyState } from "./EmptyState";
import { PresentationMediaPanel } from "./PresentationMediaPanel";
import { Screen } from "./Screen";
import { ScreenSkeleton } from "./ScreenSkeleton";
import { StatusPill } from "./StatusPill";

type QrHandle = { toDataURL(callback: (base64: string) => void): void };

export function CylinderDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { palette } = useAppTheme();
  const query = domainQueries.cylinders();
  const qrRef = useRef<QrHandle | null>(null);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageSuccess, setMessageSuccess] = useState(false);
  const cylinder = query.data?.find((item) => recordId(item) === id || displayReference(item) === id);
  const cylinderReference = cylinder ? displayReference(cylinder) : null;
  const displayName = cylinder ? firstString(cylinder, ["display_name", "displayName"]) : null;
  const qrValue = cylinder ? firstString(cylinder, ["qr_payload", "qrPayload"]) : null;
  const cylinderId = cylinder ? recordId(cylinder) : null;
  const cylinderSizeKg = cylinder ? firstNumber(cylinder, ["size_kg", "sizeKg"]) : null;
  const verifiedCapacityKg = cylinder ? firstNumber(cylinder, ["max_capacity_kg", "maxCapacityKg"]) : null;
  const status = cylinder ? displayStatus(cylinder) ?? "registered" : "";
  const tagStatus = cylinder ? physicalTagStatus(cylinder) : "untagged";

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
      await nameMutation.mutateAsync({ cylinderId, displayName: name.trim() });
      setEditing(false);
      setMessageSuccess(true);
      setMessage("Cylinder name updated.");
    } catch (cause) {
      setMessageSuccess(false);
      setMessage(friendlyError(cause, "We couldn't save the new name. Please try again."));
    }
  };

  const downloadQr = async () => {
    setMessage(null);
    if (!qrValue) {
      setMessageSuccess(false);
      setMessage("This cylinder's scan code is not available yet. Refresh and try again shortly.");
      return;
    }
    if (!qrRef.current) {
      setMessageSuccess(false);
      setMessage("The QR code is still preparing. Try again in a moment.");
      return;
    }
    try {
      await new Promise<void>((resolve, reject) => {
        qrRef.current?.toDataURL((base64) => {
          void saveQrPng(
            `data:image/png;base64,${base64}`,
            `${safeFileName(displayName ?? cylinderReference ?? "skima-cylinder")}-qr.png`,
          ).then(resolve, reject);
        });
      });
      setMessageSuccess(true);
      setMessage("Optional QR code is ready to save or share.");
    } catch (cause) {
      setMessageSuccess(false);
      setMessage(friendlyError(cause, "We couldn't save the QR code. Please try again."));
    }
  };

  return (
    <Screen
      eyebrow="Your cylinder"
      title={displayName ?? "Cylinder details"}
      subtitle="Your SKIMA Cylinder ID stays with this cylinder for every refill. Use the QR code for faster scanning when available."
      action={<AppButton label="Back" variant="ghost" size="sm" onPress={() => router.back()} />}
    >
      {query.isPending ? (
        <ScreenSkeleton cards={3} />
      ) : query.error ? (
        <EmptyState
          icon={<QrCodeIcon color={palette.brand} size={27} />}
          title="Cylinder could not be loaded"
          description="Check your connection and refresh this cylinder."
          action={<AppButton label="Retry" onPress={() => void query.refetch()} />}
        />
      ) : !cylinder ? (
        <EmptyState
          icon={<QrCodeIcon color={palette.brand} size={27} />}
          title="Cylinder unavailable"
          description="This cylinder is unavailable or is no longer accessible from this account."
          action={<AppButton label="Back to cylinders" onPress={() => router.replace("/(customer)/cylinders")} />}
        />
      ) : (
        <>
          <View style={[styles.hero, shadows.raised, { backgroundColor: palette.brand }]}>
            <View style={styles.heroIcon}><QrCodeIcon color="#FFFFFF" size={28} /></View>
            <View style={styles.heroCopy}>
              <Text style={styles.heroEyebrow}>PERMANENT SKIMA CYLINDER ID</Text>
              <Text numberOfLines={1} style={styles.heroReference}>{cylinderReference ?? "Reference unavailable"}</Text>
              <Text style={styles.heroBody}>{cylinderSizeKg ?? "Unknown"} kg cylinder</Text>
            </View>
            <StatusPill label={friendlyCylinderStatus(status)} tone={cylinderTone(status)} />
          </View>

          <PresentationMediaPanel
            colour={firstString(cylinder, ["colour", "color"])}
            originalAssetId={firstAssetId(cylinder.image_asset_ids ?? cylinder.imageAssetIds)}
            subjectId={cylinderId ?? id ?? ""}
            subjectType="lpg_cylinder"
          />

          <View style={[styles.nameCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <View style={styles.nameHead}>
              <View style={styles.nameCopy}>
                <Text style={[styles.label, { color: palette.muted }]}>YOUR CYLINDER NAME</Text>
                {editing ? (
                  <TextInput
                    autoFocus
                    onChangeText={setName}
                    placeholder="Name this cylinder"
                    placeholderTextColor={palette.muted}
                    style={[styles.nameInput, { color: palette.ink, borderColor: palette.borderStrong, backgroundColor: palette.input }]}
                    value={name}
                  />
                ) : (
                  <Text style={[styles.nameValue, { color: palette.ink }]}>{displayName ?? "Add a name"}</Text>
                )}
              </View>
              <AppButton
                accessibilityLabel={editing ? "Save cylinder name" : "Edit cylinder name"}
                label={editing ? "Save" : "Edit"}
                size="sm"
                variant={editing ? "primary" : "secondary"}
                loading={nameMutation.isPending}
                icon={editing ? <Save color="#FFFFFF" size={16} /> : <Edit3 color={palette.brand} size={16} />}
                onPress={() => editing ? void saveName() : setEditing(true)}
              />
            </View>
          </View>

          <View style={[styles.detailsCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <Field label="SKIMA Cylinder ID" value={cylinderReference ?? "Unavailable"} />
            <Divider />
            <Field label="Physical SKIMA tag" value={friendlyTagStatus(tagStatus)} />
            <Divider />
            <Field label="Registered size" value={formatKg(cylinderSizeKg)} />
            <Divider />
            <Field label="Verified refill limit" value={formatKg(verifiedCapacityKg ?? cylinderSizeKg)} />
            <Divider />
            <Field label="Brand" value={firstString(cylinder, ["brand", "manufacturer"]) ?? "Not added"} />
            <Divider />
            <Field label="Serial number" value={firstString(cylinder, ["serial_number", "serialNumber"]) ?? "Not added"} />
            <Divider />
            <Field label="Colour" value={firstString(cylinder, ["colour", "color"]) ?? "Not added"} />
            <Divider />
            <Field label="Condition" value={friendly(firstString(cylinder, ["condition_status", "conditionStatus"]) ?? "Not added")} />
            <Divider />
            <Field label="Next inspection" value={formatDate(firstString(cylinder, ["next_inspection_at", "nextInspectionAt"]))} />
          </View>

          {cylinderId ? (
            <View style={[styles.capacityCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <View style={styles.capacityLead}>
                <View style={[styles.capacityIcon, { backgroundColor: palette.brandSoft }]}>
                  <Scale color={palette.brand} size={22} />
                </View>
                <View style={styles.capacityCopy}>
                  <Text style={[styles.capacityTitle, { color: palette.ink }]}>Is the recorded size wrong?</Text>
                  <Text style={[styles.capacityBody, { color: palette.muted }]}>To change the verified cylinder size, send clear photos for SKIMA to review. The current size remains in use until the review is complete.</Text>
                </View>
              </View>
              <AppButton
                label="Review or correct capacity"
                fullWidth
                variant="secondary"
                icon={<Scale color={palette.brand} size={17} />}
                onPress={() => router.push(`/(customer)/cylinder-capacity/${cylinderId}` as never)}
              />
            </View>
          ) : null}

          <View style={[styles.qrCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <View style={styles.qrHeader}>
              <View style={[styles.qrIcon, { backgroundColor: palette.brandSoft }]}><QrCodeIcon color={palette.brand} size={22} /></View>
              <View style={styles.qrHeaderCopy}>
                <Text style={[styles.qrTitle, { color: palette.ink }]}>Optional digital scan code</Text>
                <Text style={[styles.qrBody, { color: palette.muted }]}>Use this QR code for faster scanning. You can also use the permanent Cylinder ID if the QR code is unavailable.</Text>
              </View>
            </View>

            {qrValue ? (
              <>
                <View style={styles.qrFrame}>
                  <QRCode
                    backgroundColor="white"
                    color="#151A17"
                    getRef={(ref) => { qrRef.current = ref as QrHandle | null; }}
                    size={192}
                    value={qrValue}
                  />
                </View>
                <Text style={[styles.reference, { color: palette.ink }]}>{cylinderReference}</Text>
                <AppButton
                  label="Save or share optional QR"
                  fullWidth
                  icon={<Download color="#FFFFFF" size={18} />}
                  onPress={() => void downloadQr()}
                />
              </>
            ) : (
              <View style={styles.pendingIdentity}>
                <View style={[styles.pendingIcon, { backgroundColor: palette.brandSoft }]}><RefreshCw color={palette.brand} size={25} /></View>
                <Text style={[styles.pendingTitle, { color: palette.ink }]}>Digital scan code is being prepared</Text>
                <Text style={[styles.pendingBody, { color: palette.muted }]}>Your cylinder is already registered with its permanent SKIMA Cylinder ID. The optional downloadable QR is not available on this screen yet.</Text>
                <AppButton label="Refresh scan code" variant="secondary" icon={<RefreshCw color={palette.brand} size={17} />} onPress={() => void query.refetch()} />
              </View>
            )}
          </View>

          <View style={[styles.security, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
            <ShieldCheck color={palette.mutedStrong} size={18} />
            <Text style={[styles.securityText, { color: palette.muted }]}>The QR code and Cylinder ID help identify this cylinder. SKIMA also confirms the order and the assigned delivery partner before each hand-over.</Text>
          </View>

          {message ? (
            <View style={[styles.messageBox, { backgroundColor: messageSuccess ? palette.successSoft : palette.dangerSoft }]}>
              <Text accessibilityRole="alert" style={[styles.messageText, { color: messageSuccess ? palette.success : palette.danger }]}>{message}</Text>
            </View>
          ) : null}
        </>
      )}
    </Screen>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  const { palette } = useAppTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: palette.muted }]}>{label}</Text>
      <Text style={[styles.fieldValue, { color: palette.ink }]}>{value}</Text>
    </View>
  );
}

function Divider() {
  const { palette } = useAppTheme();
  return <View style={[styles.divider, { backgroundColor: palette.border }]} />;
}

function physicalTagStatus(cylinder: PlatformRecord) {
  const metadata = cylinder.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "untagged";
  return firstString(metadata as PlatformRecord, ["physicalTagStatus", "physical_tag_status"]) ?? "untagged";
}

function friendlyTagStatus(value: string) {
  const normalized = value.toLowerCase().replace(/[\s-]+/g, "_");
  const labels: Record<string, string> = {
    untagged: "Not attached yet",
    tag_pending: "Tag pending",
    tagged: "Active",
    tag_damaged: "Damaged — replacement needed",
    tag_lost: "Reported lost",
    replacement_pending: "Replacement pending",
    retired: "Retired",
  };
  return labels[normalized] ?? friendly(value);
}

function friendly(value: string) {
  return value.replace(/[_-]/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

function friendlyCylinderStatus(value: string) {
  const normalized = value.toLowerCase().replace(/[\s-]+/g, "_");
  const labels: Record<string, string> = {
    active: "Ready to refill",
    registered: "Ready to refill",
    damaged: "Needs attention",
    unsafe: "Not safe to refill",
    expired: "Inspection needed",
  };
  return labels[normalized] ?? friendly(value);
}

function cylinderTone(value: string): "neutral" | "brand" | "success" | "warning" | "danger" {
  const normalized = value.toLowerCase();
  if (["active", "registered"].includes(normalized)) return "success";
  if (["unsafe", "damaged"].includes(normalized)) return "danger";
  if (["expired", "inspection"].some((part) => normalized.includes(part))) return "warning";
  return "brand";
}

function formatDate(value: string | null) {
  if (!value) return "Not added";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function formatKg(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "Not added";
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)} kg`;
}

function firstAssetId(value: unknown) {
  return Array.isArray(value) ? value.find((item): item is string => typeof item === "string") ?? null : null;
}

function safeFileName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "skima-cylinder";
}

const styles = StyleSheet.create({
  hero: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderRadius: radii.xl },
  heroIcon: { width: 54, height: 54, borderRadius: 19, backgroundColor: "rgba(255,255,255,.14)", alignItems: "center", justifyContent: "center" },
  heroCopy: { flex: 1, minWidth: 0, gap: 3 },
  heroEyebrow: { color: "rgba(255,255,255,.72)", ...typography.eyebrow, fontSize: 8 },
  heroReference: { color: "#FFFFFF", ...typography.heading, fontSize: 19 },
  heroBody: { color: "rgba(255,255,255,.82)", ...typography.caption },
  nameCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.lg },
  nameHead: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  nameCopy: { flex: 1, gap: 4 },
  label: { ...typography.eyebrow, fontSize: 9 },
  nameValue: { ...typography.heading, fontSize: 20 },
  nameInput: { minHeight: 48, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.md, fontSize: 16, fontWeight: "800" },
  detailsCard: { gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.lg },
  field: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md },
  fieldLabel: { ...typography.caption, flex: 0.42 },
  fieldValue: { ...typography.bodyStrong, fontSize: 14, flex: 0.58, textAlign: "right" },
  divider: { height: StyleSheet.hairlineWidth },
  capacityCard: { gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.lg },
  capacityLead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  capacityIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  capacityCopy: { flex: 1, gap: 4 },
  capacityTitle: { ...typography.subheading, fontSize: 15 },
  capacityBody: { ...typography.caption, lineHeight: 18 },
  qrCard: { alignItems: "center", gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.lg },
  qrHeader: { width: "100%", flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  qrIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  qrHeaderCopy: { flex: 1, gap: 3 },
  qrTitle: { ...typography.subheading, fontSize: 15 },
  qrBody: { ...typography.caption, lineHeight: 18 },
  qrFrame: { padding: spacing.md, backgroundColor: "#FFFFFF", borderRadius: 22 },
  reference: { ...typography.bodyStrong, fontSize: 14 },
  pendingIdentity: { width: "100%", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.md },
  pendingIcon: { width: 52, height: 52, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  pendingTitle: { ...typography.subheading, textAlign: "center" },
  pendingBody: { maxWidth: 420, ...typography.body, fontSize: 13, lineHeight: 19, textAlign: "center" },
  security: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm + 2, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  securityText: { flex: 1, ...typography.caption, lineHeight: 18 },
  messageBox: { borderRadius: radii.md, padding: spacing.md },
  messageText: { ...typography.caption, fontWeight: "800", textAlign: "center" },
});
