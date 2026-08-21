import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { BadgeCheck, Camera, CreditCard, Flashlight, MapPin, ScanLine, Search, ShieldAlert, ShieldCheck, Truck, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { z } from "zod";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { AppButton } from "./AppButton";
import { Screen } from "./Screen";
import { StatusPill } from "./StatusPill";

const DriverVerificationSchema = z.object({
  data: z.object({
    verified: z.boolean(),
    publicDriverId: z.string().nullable().optional(),
    displayName: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    cardStatus: z.string().nullable().optional(),
    operationalStatus: z.string().nullable().optional(),
    approvedAt: z.string().nullable().optional(),
    issuedAt: z.string().nullable().optional(),
    photoUrl: z.string().nullable().optional(),
    vehicleType: z.string().nullable().optional(),
    vehicleStatus: z.string().nullable().optional(),
    serviceZones: z.array(z.string()).optional().default([]),
  }).passthrough(),
  requestId: z.string().optional(),
}).passthrough();

type VerificationRecord = z.infer<typeof DriverVerificationSchema>["data"];

export function DriverVerificationScreen() {
  const session = useSession();
  const { palette } = useAppTheme();
  const params = useLocalSearchParams<{ id?: string; publicDriverId?: string; mode?: string }>();
  const initialId = (params.publicDriverId ?? params.id ?? "").trim();
  const [driverId, setDriverId] = useState(initialId);
  const [result, setResult] = useState<VerificationRecord | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(params.mode === "scan");
  const [scanLocked, setScanLocked] = useState(false);
  const [torch, setTorch] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const verify = async (value = driverId) => {
    const normalized = normalizeDriverId(value);
    if (!normalized || pending) return;
    setPending(true);
    setError(null);
    setResult(null);
    try {
      const response = await session.api.get(
        `/runtime/driver-id-cards/verify?publicDriverId=${encodeURIComponent(normalized)}`,
        DriverVerificationSchema,
      );
      setDriverId(normalized);
      setResult({
        ...response.data,
        serviceZones: response.data.serviceZones ?? [],
      });
    } catch (cause) {
      setError(friendlyError(cause, "We couldn't verify that SKIMA Driver ID. Check the ID and try again."));
    } finally {
      setPending(false);
    }
  };

  const openScanner = async () => {
    setError(null);
    if (!cameraPermission?.granted) {
      const permission = await requestCameraPermission();
      if (!permission.granted) {
        setError("Camera access is needed to scan a Driver Pass. You can still enter the SKIMA Driver ID below.");
        return;
      }
    }
    setScanLocked(false);
    setScannerOpen(true);
  };

  const handleScan = (scan: BarcodeScanningResult) => {
    if (scanLocked || pending) return;
    const reference = extractDriverId(scan.data);
    if (!reference) {
      setScanLocked(true);
      setError("That code does not contain a valid SKIMA Driver ID. Check the Driver Pass and scan again.");
      setTimeout(() => setScanLocked(false), 1200);
      return;
    }
    setScanLocked(true);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setScannerOpen(false);
    setTorch(false);
    setDriverId(reference);
    void verify(reference);
  };

  useEffect(() => {
    if (initialId) void verify(initialId);
    // Only run automatically for the route-provided ID.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialId]);

  useEffect(() => {
    if (params.mode === "scan" && !scannerOpen && !result && !pending) {
      void openScanner();
    }
    // This is intentionally keyed to the route mode only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.mode]);

  const verified = result?.verified === true && result?.status === "active";
  const suspended = ["suspended", "deactivated", "inactive", "revoked"].some((value) =>
    [result?.status, result?.cardStatus].some((status) => status?.toLowerCase().includes(value)),
  );

  return (
    <Screen
      eyebrow="SKIMA verification"
      title="Verify a driver"
      subtitle="Scan the Driver Pass or enter the SKIMA Driver ID before handing over your cylinder."
      action={<AppButton label="Back" variant="ghost" size="sm" onPress={() => router.canGoBack() ? router.back() : router.replace("/")} />}
    >
      {scannerOpen ? (
        <View style={[styles.scannerCard, shadows.raised, { backgroundColor: palette.ink }]}>
          {cameraPermission?.granted ? (
            <View style={styles.cameraWrap}>
              <CameraView
                style={styles.camera}
                facing="back"
                enableTorch={torch}
                barcodeScannerSettings={{ barcodeTypes: ["qr", "code128", "datamatrix"] }}
                onBarcodeScanned={scanLocked ? undefined : handleScan}
              />
              <View pointerEvents="none" style={styles.scanCopy}>
                <ScanLine color="#FFFFFF" size={23} />
                <Text style={styles.scanTitle}>Scan the Driver Pass</Text>
                <Text style={styles.scanBody}>Keep the SKIMA QR code inside the frame</Text>
              </View>
              <View pointerEvents="none" style={styles.scanFrame} />
              <Pressable accessibilityLabel="Close scanner" onPress={() => { setScannerOpen(false); setTorch(false); }} style={styles.closeScanner}>
                <X color="#FFFFFF" size={21} />
              </Pressable>
              <Pressable accessibilityLabel={torch ? "Turn flashlight off" : "Turn flashlight on"} onPress={() => setTorch((current) => !current)} style={[styles.torch, torch && { backgroundColor: palette.brand }]}>
                <Flashlight color="#FFFFFF" size={21} />
              </Pressable>
            </View>
          ) : (
            <View style={styles.permissionCard}>
              <Camera color="#FFFFFF" size={28} />
              <Text style={styles.scanTitle}>Camera access is off</Text>
              <Text style={styles.scanBody}>Allow camera access to scan the Driver Pass, or close this scanner and enter the Driver ID.</Text>
              <AppButton label="Allow camera" onPress={() => void openScanner()} />
            </View>
          )}
        </View>
      ) : (
        <AppButton
          label="Scan Driver ID QR"
          fullWidth
          size="lg"
          variant="secondary"
          icon={<ScanLine color={palette.brand} size={19} />}
          onPress={() => void openScanner()}
        />
      )}

      <View style={[styles.searchCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <View style={styles.searchLead}>
          <View style={[styles.searchIcon, { backgroundColor: palette.brandSoft }]}><Search color={palette.brand} size={22} /></View>
          <View style={styles.searchCopy}>
            <Text style={[styles.searchTitle, { color: palette.ink }]}>Enter Driver ID</Text>
            <Text style={[styles.searchBody, { color: palette.muted }]}>Use the SKIMA Driver ID printed on the driver's current pass.</Text>
          </View>
        </View>
        <TextInput
          accessibilityLabel="SKIMA Driver ID"
          autoCapitalize="characters"
          autoCorrect={false}
          value={driverId}
          onChangeText={setDriverId}
          onSubmitEditing={() => void verify()}
          placeholder="Example: SKD-9D0DBEEA49D4"
          placeholderTextColor={palette.muted}
          returnKeyType="search"
          style={[styles.input, { backgroundColor: palette.input, borderColor: palette.borderStrong, color: palette.ink }]}
        />
        <AppButton
          label="Verify driver"
          fullWidth
          size="lg"
          loading={pending}
          disabled={!driverId.trim()}
          icon={<ShieldCheck color="#FFFFFF" size={18} />}
          onPress={() => void verify()}
        />
      </View>

      {error ? (
        <View style={[styles.error, { backgroundColor: palette.dangerSoft }]}>
          <ShieldAlert color={palette.danger} size={20} />
          <Text accessibilityRole="alert" style={[styles.errorText, { color: palette.danger }]}>{error}</Text>
        </View>
      ) : null}

      {result ? (
        <>
          <View
            style={[
              styles.resultHero,
              shadows.raised,
              { backgroundColor: verified ? palette.brand : suspended ? palette.danger : palette.ink },
            ]}
          >
            <View style={styles.photoShell}>
              {result.photoUrl ? (
                <Image source={{ uri: result.photoUrl }} contentFit="cover" style={styles.photo} />
              ) : (
                <View style={styles.photoFallback}><CreditCard color="#FFFFFF" size={28} /></View>
              )}
            </View>
            <View style={styles.resultCopy}>
              <Text style={styles.resultEyebrow}>{verified ? "APPROVED SKIMA DRIVER" : suspended ? "NOT CURRENTLY APPROVED" : "VERIFICATION RESULT"}</Text>
              <Text numberOfLines={1} style={styles.resultName}>{result.displayName ?? "SKIMA Driver"}</Text>
              <Text style={styles.resultId}>{result.publicDriverId ?? driverId}</Text>
              <View style={styles.resultPills}>
                <StatusPill label={publicStatus(result)} tone={verified ? "success" : suspended ? "danger" : "warning"} />
              </View>
            </View>
            {verified ? <BadgeCheck color="#FFFFFF" size={30} /> : <ShieldAlert color="#FFFFFF" size={30} />}
          </View>

          <View style={[styles.detailCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <PublicField label="Driver name" value={result.displayName ?? "Not listed"} />
            <Divider />
            <PublicField label="SKIMA Driver ID" value={result.publicDriverId ?? driverId} />
            <Divider />
            <PublicField label="Approval" value={publicStatus(result)} />
            <Divider />
            <PublicField label="Vehicle type" value={friendly(result.vehicleType ?? "Not listed")} icon={<Truck color={palette.brand} size={17} />} />
            <Divider />
            <PublicField label="Vehicle status" value={friendly(result.vehicleStatus ?? "Not listed")} />
            <Divider />
            <PublicField label="Approved service area" value={result.serviceZones?.length ? result.serviceZones.join(", ") : "Not publicly listed"} icon={<MapPin color={palette.brand} size={17} />} />
          </View>

          <View style={[styles.trust, { backgroundColor: verified ? palette.successSoft : palette.warningSoft, borderColor: verified ? palette.success : palette.warning }]}>
            {verified ? <ShieldCheck color={palette.success} size={20} /> : <ShieldAlert color={palette.warning} size={20} />}
            <View style={styles.trustCopy}>
              <Text style={[styles.trustTitle, { color: palette.ink }]}>{verified ? "Current SKIMA approval confirmed" : "Do not hand over your cylinder yet"}</Text>
              <Text style={[styles.trustBody, { color: palette.muted }]}>{verified ? "The Driver ID is currently approved by SKIMA. For an active order, also confirm that the driver shown in your order matches this person." : "A printed pass or saved screenshot may be old. Only a current approved result should be used for a SKIMA pickup."}</Text>
            </View>
          </View>

          <View style={[styles.privacy, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
            <ShieldCheck color={palette.mutedStrong} size={18} />
            <Text style={[styles.privacyText, { color: palette.muted }]}>Private contact details, home address, identity documents and financial information are never shown in this public verification.</Text>
          </View>
        </>
      ) : null}
    </Screen>
  );
}

function PublicField({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  const { palette } = useAppTheme();
  return (
    <View style={styles.field}>
      <View style={styles.fieldLabelRow}>{icon}<Text style={[styles.fieldLabel, { color: palette.muted }]}>{label}</Text></View>
      <Text style={[styles.fieldValue, { color: palette.ink }]}>{value}</Text>
    </View>
  );
}

function Divider() {
  const { palette } = useAppTheme();
  return <View style={[styles.divider, { backgroundColor: palette.border }]} />;
}

function normalizeDriverId(value: string) {
  return value.trim().toUpperCase();
}

function extractDriverId(rawValue: string) {
  const raw = rawValue.trim();
  if (!raw) return null;

  const direct = raw.match(/\bSKD-[A-Z0-9]{6,32}\b/i)?.[0];
  if (direct) return normalizeDriverId(direct);

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const key of ["publicDriverId", "public_driver_id", "driverId", "driver_id"]) {
      const candidate = parsed[key];
      if (typeof candidate === "string") {
        const match = candidate.match(/\bSKD-[A-Z0-9]{6,32}\b/i)?.[0];
        if (match) return normalizeDriverId(match);
      }
    }
  } catch {
    // Not a JSON payload; URL parsing below handles Driver Pass links.
  }

  try {
    const url = new URL(raw);
    for (const key of ["publicDriverId", "public_driver_id", "driverId", "driver_id", "id"]) {
      const candidate = url.searchParams.get(key);
      const match = candidate?.match(/\bSKD-[A-Z0-9]{6,32}\b/i)?.[0];
      if (match) return normalizeDriverId(match);
    }
    const pathMatch = decodeURIComponent(url.pathname).match(/\bSKD-[A-Z0-9]{6,32}\b/i)?.[0];
    if (pathMatch) return normalizeDriverId(pathMatch);
  } catch {
    // Plain text that was not a SKIMA Driver ID.
  }

  return null;
}

function publicStatus(record: VerificationRecord) {
  if (record.verified && record.status === "active") return "Approved & active";
  const raw = record.cardStatus ?? record.status ?? record.operationalStatus ?? "not active";
  const normalized = raw.toLowerCase();
  if (normalized.includes("suspend")) return "Not currently approved";
  if (normalized.includes("deactiv") || normalized.includes("revok")) return "Not currently approved";
  if (normalized.includes("inactive")) return "Approved but inactive";
  return friendly(raw);
}

function friendly(value: string) {
  return value.replace(/[_-]/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

const styles = StyleSheet.create({
  scannerCard: { overflow: "hidden", borderRadius: radii.xl },
  cameraWrap: { height: 430, overflow: "hidden", borderRadius: radii.xl },
  camera: { flex: 1 },
  scanCopy: { position: "absolute", top: spacing.xl, left: spacing.lg, right: spacing.lg, alignItems: "center", gap: 5 },
  scanTitle: { color: "#FFFFFF", ...typography.heading, fontSize: 19, textAlign: "center" },
  scanBody: { color: "rgba(255,255,255,.78)", ...typography.caption, lineHeight: 18, textAlign: "center" },
  scanFrame: { position: "absolute", left: "15%", right: "15%", top: "29%", bottom: "26%", borderWidth: 3, borderColor: "#FFFFFF", borderRadius: radii.lg },
  closeScanner: { position: "absolute", left: spacing.md, top: spacing.md, width: 46, height: 46, alignItems: "center", justifyContent: "center", borderRadius: 23, backgroundColor: "rgba(0,0,0,.48)" },
  torch: { position: "absolute", right: spacing.md, bottom: spacing.md, width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: 24, backgroundColor: "rgba(0,0,0,.48)" },
  permissionCard: { minHeight: 270, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl },
  searchCard: { gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.lg },
  searchLead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  searchIcon: { width: 46, height: 46, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  searchCopy: { flex: 1, gap: 3 },
  searchTitle: { ...typography.subheading, fontSize: 15 },
  searchBody: { ...typography.caption, lineHeight: 18 },
  input: { minHeight: 58, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.md, fontSize: 17, fontWeight: "900", letterSpacing: 0.5 },
  error: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, padding: spacing.md, borderRadius: radii.lg },
  errorText: { flex: 1, ...typography.caption, lineHeight: 18, fontWeight: "800" },
  resultHero: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderRadius: radii.xl },
  photoShell: { width: 70, height: 70, overflow: "hidden", borderRadius: 23, backgroundColor: "rgba(255,255,255,.14)" },
  photo: { width: "100%", height: "100%" },
  photoFallback: { flex: 1, alignItems: "center", justifyContent: "center" },
  resultCopy: { flex: 1, minWidth: 0, gap: 2 },
  resultEyebrow: { color: "rgba(255,255,255,.72)", ...typography.eyebrow, fontSize: 8 },
  resultName: { color: "#FFFFFF", ...typography.heading, fontSize: 20 },
  resultId: { color: "rgba(255,255,255,.82)", ...typography.caption, fontWeight: "900" },
  resultPills: { flexDirection: "row", marginTop: 5 },
  detailCard: { gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.lg },
  field: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md },
  fieldLabelRow: { flex: 0.42, flexDirection: "row", alignItems: "center", gap: 6 },
  fieldLabel: { ...typography.caption, flexShrink: 1 },
  fieldValue: { ...typography.bodyStrong, fontSize: 14, flex: 0.58, textAlign: "right" },
  divider: { height: StyleSheet.hairlineWidth },
  trust: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  trustCopy: { flex: 1, gap: 3 },
  trustTitle: { ...typography.bodyStrong, fontSize: 14 },
  trustBody: { ...typography.caption, lineHeight: 18 },
  privacy: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm + 2, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  privacyText: { flex: 1, ...typography.caption, lineHeight: 18 },
});
