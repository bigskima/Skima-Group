import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { BadgeCheck, CreditCard, MapPin, Search, ShieldAlert, ShieldCheck, Truck } from "lucide-react-native";
import { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
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
  const params = useLocalSearchParams<{ id?: string; publicDriverId?: string }>();
  const initialId = (params.publicDriverId ?? params.id ?? "").trim();
  const [driverId, setDriverId] = useState(initialId);
  const [result, setResult] = useState<VerificationRecord | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verify = async (value = driverId) => {
    const normalized = value.trim().toUpperCase();
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
      setResult(response.data);
    } catch (cause) {
      setError(friendlyError(cause, "We couldn't verify that SKIMA Driver ID. Check the number and try again."));
    } finally {
      setPending(false);
    }
  };

  useEffect(() => {
    if (initialId) void verify(initialId);
    // Only run automatically for the route-provided ID.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialId]);

  const verified = result?.verified === true && result?.status === "active";
  const suspended = ["suspended", "deactivated", "inactive", "revoked"].some((value) =>
    [result?.status, result?.cardStatus].some((status) => status?.toLowerCase().includes(value)),
  );

  return (
    <Screen
      eyebrow="Public SKIMA verification"
      title="Verify a driver"
      subtitle="Enter the SKIMA Driver ID printed on the driver's pass to confirm their current public authorisation status."
      action={<AppButton label="Back" variant="ghost" size="sm" onPress={() => router.canGoBack() ? router.back() : router.replace("/")} />}
    >
      <View style={[styles.searchCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <View style={styles.searchLead}>
          <View style={[styles.searchIcon, { backgroundColor: palette.brandSoft }]}><Search color={palette.brand} size={22} /></View>
          <View style={styles.searchCopy}>
            <Text style={[styles.searchTitle, { color: palette.ink }]}>SKIMA Driver ID</Text>
            <Text style={[styles.searchBody, { color: palette.muted }]}>Use only the ID shown on the driver's current SKIMA pass.</Text>
          </View>
        </View>
        <TextInput
          accessibilityLabel="SKIMA Driver ID"
          autoCapitalize="characters"
          autoCorrect={false}
          value={driverId}
          onChangeText={setDriverId}
          onSubmitEditing={() => void verify()}
          placeholder="Enter driver ID"
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
              <Text style={styles.resultEyebrow}>{verified ? "CURRENTLY AUTHORISED" : suspended ? "NOT CURRENTLY AUTHORISED" : "VERIFICATION RESULT"}</Text>
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
            <PublicField label="Authorisation" value={publicStatus(result)} />
            <Divider />
            <PublicField label="Vehicle type" value={friendly(result.vehicleType ?? "Not listed")} icon={<Truck color={palette.brand} size={17} />} />
            <Divider />
            <PublicField label="Vehicle status" value={friendly(result.vehicleStatus ?? "Not listed")} />
            <Divider />
            <PublicField label="Approved service coverage" value={result.serviceZones?.length ? result.serviceZones.join(", ") : "Not publicly listed"} icon={<MapPin color={palette.brand} size={17} />} />
          </View>

          <View style={[styles.trust, { backgroundColor: verified ? palette.successSoft : palette.warningSoft, borderColor: verified ? palette.success : palette.warning }]}>
            {verified ? <ShieldCheck color={palette.success} size={20} /> : <ShieldAlert color={palette.warning} size={20} />}
            <View style={styles.trustCopy}>
              <Text style={[styles.trustTitle, { color: palette.ink }]}>{verified ? "Current SKIMA authorisation confirmed" : "Do not rely on a saved screenshot alone"}</Text>
              <Text style={[styles.trustBody, { color: palette.muted }]}>{verified ? "This lookup checks the current SKIMA record for the Driver ID you entered." : "A printed pass or screenshot may be old. Only the current verification result on this screen should be used to confirm authorisation."}</Text>
            </View>
          </View>

          <View style={[styles.privacy, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
            <ShieldCheck color={palette.mutedStrong} size={18} />
            <Text style={[styles.privacyText, { color: palette.muted }]}>This public lookup intentionally excludes private KYC such as home address, NIN/BVN, private documents, internal review notes and other confidential identity evidence.</Text>
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

function publicStatus(record: VerificationRecord) {
  if (record.verified && record.status === "active") return "Approved & active";
  const raw = record.cardStatus ?? record.status ?? record.operationalStatus ?? "not active";
  const normalized = raw.toLowerCase();
  if (normalized.includes("suspend")) return "Suspended";
  if (normalized.includes("deactiv") || normalized.includes("revok")) return "No longer authorised";
  if (normalized.includes("inactive")) return "Approved but inactive";
  return friendly(raw);
}

function friendly(value: string) {
  return value.replace(/[_-]/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

const styles = StyleSheet.create({
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
