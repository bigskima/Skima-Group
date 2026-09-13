import { router } from "expo-router";
import { Building2, Clock3, Gauge, MapPin, ShieldCheck } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";
import { useStationLocations, useStationRuntime } from "../api/domains";
import { firstNumber, firstString, nestedRecord, recordId } from "../api/records";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { AppButton } from "./AppButton";
import { EmptyState } from "./EmptyState";
import { PublicEntityImageEditor } from "./PublicEntityImageEditor";
import { RequestFailureState } from "./RequestFailureState";
import { Screen } from "./Screen";
import { ScreenSkeleton } from "./ScreenSkeleton";
import { SectionHeader } from "./SectionHeader";
import { StatusPill } from "./StatusPill";

export function StationProfileScreen() {
  const { palette } = useAppTheme();
  const runtime = useStationRuntime();
  const branch = nestedRecord(runtime.data, "branch");
  const stationId = branch ? recordId(branch) : null;
  const locations = useStationLocations(stationId);
  const currentLocation = nestedRecord(locations.data, "currentLocation");
  const hours = nestedRecord(branch, "operatingHours") ?? nestedRecord(branch, "operating_hours");
  const sizes = numberValues(branch?.supportedCylinderSizesKg ?? branch?.supported_cylinder_sizes_kg);
  const availability = firstString(branch, ["availabilityStatus", "availability_status"]) ?? "unavailable";
  const compliance = firstString(branch, ["complianceStatus", "compliance_status", "approvalStatus"]) ?? "pending";

  return (
    <Screen
      eyebrow="Station profile"
      title="Branch profile"
      subtitle="Manage the public identity and verified operating information for this Station."
      action={<BackButton />}
    >
      {runtime.isPending || (Boolean(stationId) && locations.isPending) ? (
        <ScreenSkeleton cards={3} />
      ) : runtime.error || locations.error ? (
        <RequestFailureState
          error={runtime.error ?? locations.error}
          onRetry={() => void Promise.all([runtime.refetch(), locations.refetch()])}
          overrides={{
            permission: {
              title: "Station profile access is restricted",
              description: "Your current Station role cannot view this branch profile. Ask the Station Owner to review your access if you believe this is unexpected.",
            },
            station_scope: {
              title: "This Station profile is outside your access",
              description: "Switch to a Station you are assigned to or ask the Station Owner to review your branch access.",
            },
            missing: {
              title: "Station profile is not available",
              description: "This branch may still be activating or may no longer be available to this account.",
            },
          }}
        />
      ) : !branch ? (
        <StationAwaitingActivation />
      ) : (
        <>
          <View style={[styles.profileHero, shadows.raised, { backgroundColor: palette.brand }]}>
            <View style={styles.avatar}><Building2 color="#FFFFFF" size={31} /></View>
            <View style={styles.heroCopy}>
              <Text style={styles.heroEyebrow}>SKIMA STATION</Text>
              <Text style={styles.heroTitle}>{firstString(branch, ["displayName", "display_name", "name"]) ?? "SKIMA station"}</Text>
              <Text style={styles.heroBody}>{firstString(branch, ["formattedAddress", "formatted_address", "address"]) ?? "Address unavailable"}</Text>
              <View style={styles.heroPills}>
                <StatusPill label={friendly(compliance)} tone={approvalTone(compliance)} />
                <StatusPill label={friendly(availability)} tone={availability === "available" ? "success" : availability === "busy" ? "warning" : "neutral"} />
              </View>
            </View>
          </View>

          {stationId ? (
            <>
              <SectionHeader
                title="Public Station images"
                description="These images represent the Station publicly. They are separate from KYB, KYC, compliance and verification evidence."
              />
              <View style={styles.imageGrid}>
                <View style={styles.imagePanel}>
                  <PublicEntityImageEditor
                    entityType="station"
                    entityId={stationId}
                    mediaRole="station.logo.public"
                    title="Station logo"
                    description="Use a clear logo or square identity image shown with the Station's public identity."
                    label="Station logo"
                    aspect={[1, 1]}
                    variant="avatar"
                  />
                </View>
                <View style={styles.imagePanel}>
                  <PublicEntityImageEditor
                    entityType="station"
                    entityId={stationId}
                    mediaRole="station.photo.public"
                    title="Primary Station photo"
                    description="Show the facility or storefront customers and Drivers should recognize when they arrive."
                    label="Station public photo"
                    aspect={[4, 3]}
                    variant="hero"
                  />
                </View>
              </View>
            </>
          ) : null}

          <SectionHeader title="Branch details" description="Current approved operating information for this Station branch." />
          <View style={styles.metricGrid}>
            <ProfileMetric
              icon={<Clock3 color={palette.brand} size={19} />}
              label="Hours"
              value={`${firstString(hours, ["opensAt", "opens_at"]) ?? "—"} – ${firstString(hours, ["closesAt", "closes_at"]) ?? "—"}`}
            />
            <ProfileMetric
              icon={<Gauge color={palette.brand} size={19} />}
              label="Service radius"
              value={formatRadius(firstNumber(branch, ["serviceRadiusMeters", "service_radius_meters"]))}
            />
          </View>

          <View style={[styles.detailCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <InfoField label="Availability" value={friendly(availability)} />
            <Divider />
            <InfoField label="Supported cylinders" value={sizes.length ? sizes.map((size) => `${size} kg`).join(", ") : "Not available"} />
          </View>

          <SectionHeader
            title="Station location"
            description="Your verified physical Station address. Location updates are reviewed before they affect dispatch or public discovery."
          />
          <View style={[styles.detailCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <InfoField label="Address" value={firstString(currentLocation, ["formattedAddress", "formatted_address"]) ?? firstString(branch, ["formattedAddress", "formatted_address"]) ?? "Not recorded"} />
            <Divider />
            <InfoField label="Country" value={firstString(currentLocation, ["country"]) ?? "Not recorded"} />
            <Divider />
            <InfoField label="State" value={firstString(currentLocation, ["state"]) ?? "Not recorded"} />
            <Divider />
            <InfoField label="LGA" value={firstString(currentLocation, ["lga"]) ?? "Not recorded"} />
            <Divider />
            <InfoField label="City / town" value={firstString(currentLocation, ["city"]) ?? "Not recorded"} />
          </View>

          <AppButton
            label="Manage Station locations"
            fullWidth
            size="lg"
            icon={<MapPin color="#FFFFFF" size={19} />}
            onPress={() => router.push("/(station)/locations" as never)}
          />

          <View style={[styles.trustNote, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
            <ShieldCheck color={palette.mutedStrong} size={18} />
            <Text style={[styles.trustText, { color: palette.muted }]}>Public Station images can be changed only by roles with Station management access. Verification documents remain confidential and are never reused automatically.</Text>
          </View>
        </>
      )}
    </Screen>
  );
}

function StationAwaitingActivation() {
  const { palette } = useAppTheme();
  return (
    <>
      <EmptyState
        icon={<Building2 color={palette.brand} size={28} />}
        title="Your Station is not ready to receive orders yet"
        description="Your application is approved, but SKIMA is still completing Station setup. We will notify you when it can receive orders."
        action={<AppButton label="View application status" onPress={() => router.push("/(station)/application" as never)} />}
      />
      <View style={[styles.trustNote, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
        <ShieldCheck color={palette.mutedStrong} size={18} />
        <Text style={[styles.trustText, { color: palette.muted }]}>SKIMA will complete setup for the approved branch. This profile updates automatically when the Station is ready.</Text>
      </View>
    </>
  );
}

function BackButton() {
  return <AppButton label="Back" variant="ghost" size="sm" onPress={() => router.back()} />;
}

function InfoField({ label, value }: { label: string; value: string }) {
  const { palette } = useAppTheme();
  return (
    <View style={styles.fieldRow}>
      <Text style={[styles.fieldLabel, { color: palette.muted }]}>{label}</Text>
      <Text style={[styles.fieldValue, { color: palette.ink }]}>{value}</Text>
    </View>
  );
}

function Divider() {
  const { palette } = useAppTheme();
  return <View style={[styles.divider, { backgroundColor: palette.border }]} />;
}

function ProfileMetric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  const { palette } = useAppTheme();
  return (
    <View style={[styles.metric, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <View style={[styles.metricIcon, { backgroundColor: palette.brandSoft }]}>{icon}</View>
      <Text numberOfLines={1} style={[styles.metricValue, { color: palette.ink }]}>{value}</Text>
      <Text style={[styles.metricLabel, { color: palette.muted }]}>{label}</Text>
    </View>
  );
}

function numberValues(value: unknown) {
  return Array.isArray(value) ? value.map(Number).filter(Number.isFinite) : [];
}

function formatRadius(value: number | null) {
  if (value === null) return "Not available";
  return value >= 1000 ? `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)} km` : `${value} m`;
}

function friendly(value: string) {
  return value.replace(/[_-]/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

function approvalTone(value: string): "neutral" | "brand" | "success" | "warning" | "danger" {
  const normalized = value.toLowerCase();
  if (["approved", "verified", "active"].some((part) => normalized.includes(part))) return "success";
  if (["rejected", "suspended", "deactivated"].some((part) => normalized.includes(part))) return "danger";
  if (["pending", "review"].some((part) => normalized.includes(part))) return "warning";
  return "brand";
}

const styles = StyleSheet.create({
  profileHero: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderRadius: radii.xl },
  avatar: { width: 62, height: 62, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,.14)" },
  heroCopy: { flex: 1, minWidth: 0, gap: 3 },
  heroEyebrow: { color: "rgba(255,255,255,.72)", ...typography.eyebrow, fontSize: 9 },
  heroTitle: { color: "#FFFFFF", ...typography.heading, fontSize: 22 },
  heroBody: { color: "rgba(255,255,255,.84)", ...typography.caption },
  heroPills: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.xs },
  imageGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  imagePanel: { flexGrow: 1, flexBasis: 300, minWidth: 0 },
  detailCard: { gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.lg },
  fieldRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md },
  fieldLabel: { ...typography.caption, flex: 0.42 },
  fieldValue: { ...typography.bodyStrong, fontSize: 14, flex: 0.58, textAlign: "right" },
  divider: { height: StyleSheet.hairlineWidth },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  metric: { flex: 1, minWidth: 130, gap: 5, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  metricIcon: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  metricValue: { ...typography.heading, fontSize: 18 },
  metricLabel: { ...typography.caption },
  trustNote: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm + 2, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  trustText: { flex: 1, ...typography.caption, lineHeight: 18 },
});
