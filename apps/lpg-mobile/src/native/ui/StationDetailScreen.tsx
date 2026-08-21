import { router } from "expo-router";
import { Clock3, Fuel, MapPin, ShieldCheck, Store } from "lucide-react-native";
import { type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { domainQueries, useEntityMediaLinks } from "../api/domains";
import {
  displayStatus,
  firstNumber,
  firstString,
  nestedRecord,
  recordId,
} from "../api/records";
import { OperationalMap } from "../maps/OperationalMap";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { AppButton } from "./AppButton";
import { EmptyState } from "./EmptyState";
import { RuntimeMediaImage } from "./RuntimeMediaImage";
import { Screen } from "./Screen";
import { ScreenSkeleton } from "./ScreenSkeleton";
import { StatusPill } from "./StatusPill";

export function StationDetailScreen({ id }: { id: string | null }) {
  const { palette } = useAppTheme();
  const stations = domainQueries.stations();
  const media = useEntityMediaLinks("station", id);
  const station = (stations.data ?? []).find((item) => recordId(item) === id);
  const latitude = firstNumber(station, ["latitude", "lat"]);
  const longitude = firstNumber(station, ["longitude", "lng", "lon"]);
  const hours = nestedRecord(station, "operatingHours") ?? nestedRecord(station, "operating_hours");
  const presentation = (media.data ?? []).find((item) =>
    (firstString(item, ["media_role", "mediaRole"]) ?? "").includes("presentation"),
  );
  const approvedPublic = (media.data ?? []).find((item) =>
    ["public", "station.photo", "original", "photo"].some((role) =>
      (firstString(item, ["media_role", "mediaRole"]) ?? "").includes(role),
    ),
  );
  const assetId = firstString(presentation ?? approvedPublic, ["media_asset_id", "mediaAssetId"]);
  const stationName = firstString(station, ["display_name", "displayName", "name"]) ?? "SKIMA station";
  const status = (station ? displayStatus(station) : null) ??
    firstString(station, ["availability_status", "availabilityStatus"]) ??
    "approved";
  const address = firstString(station, ["formatted_address", "formattedAddress", "address"]) ?? "Public address unavailable";
  const availableKg = firstNumber(station, ["currentAvailableKg", "current_available_kg"]);

  return (
    <Screen
      eyebrow="Verified SKIMA station"
      title={stationName}
      subtitle="Public station information that helps customers and drivers confirm this SKIMA LPG location."
      action={<AppButton label="Back" variant="ghost" size="sm" onPress={() => router.back()} />}
    >
      {stations.isPending || media.isPending ? (
        <ScreenSkeleton cards={3} />
      ) : !station ? (
        <EmptyState
          icon={<Store color={palette.brand} size={28} />}
          title="Station unavailable"
          description="This station is not currently available in the public SKIMA station directory."
          action={<AppButton label="Back to stations" onPress={() => router.replace("/(customer)/stations")} />}
        />
      ) : (
        <>
          {assetId ? (
            <View style={[styles.media, shadows.soft, { backgroundColor: palette.surface }]}> 
              <RuntimeMediaImage assetId={assetId} label={`${stationName} public station photo`} />
            </View>
          ) : null}

          <View style={[styles.hero, shadows.raised, { backgroundColor: palette.brand }]}>
            <View style={styles.heroIcon}><ShieldCheck color="#FFFFFF" size={28} /></View>
            <View style={styles.heroCopy}>
              <Text style={styles.heroEyebrow}>SKIMA NETWORK VERIFIED</Text>
              <Text numberOfLines={1} style={styles.heroTitle}>{stationName}</Text>
              <Text numberOfLines={2} style={styles.heroBody}>{address}</Text>
            </View>
            <StatusPill label={friendlyStatus(status)} tone={stationTone(status)} />
          </View>

          {latitude !== null && longitude !== null ? (
            <View style={[styles.mapShell, shadows.soft]}>
              <OperationalMap
                points={[{ latitude, longitude, label: stationName }]}
                height={330}
              />
            </View>
          ) : null}

          <View style={styles.metrics}>
            <PublicMetric
              icon={<Clock3 color={palette.brand} size={20} />}
              label="Operating hours"
              value={`${firstString(hours, ["opensAt", "opens_at"]) ?? "—"} – ${firstString(hours, ["closesAt", "closes_at"]) ?? "—"}`}
            />
            <PublicMetric
              icon={<Fuel color={palette.brand} size={20} />}
              label="Available refill stock"
              value={availableKg === null ? "Not listed" : `${availableKg} kg`}
            />
          </View>

          <View style={[styles.addressCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <View style={[styles.addressIcon, { backgroundColor: palette.brandSoft }]}><MapPin color={palette.brand} size={22} /></View>
            <View style={styles.addressCopy}>
              <Text style={[styles.addressLabel, { color: palette.muted }]}>PUBLIC STATION ADDRESS</Text>
              <Text style={[styles.addressValue, { color: palette.ink }]}>{address}</Text>
            </View>
          </View>

          <View style={[styles.trust, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
            <ShieldCheck color={palette.mutedStrong} size={18} />
            <Text style={[styles.trustText, { color: palette.muted }]}>This profile shows only public operational station information approved for discovery. Applicant identity documents, representative photos, licences and private verification evidence are not shown here.</Text>
          </View>
        </>
      )}
    </Screen>
  );
}

function PublicMetric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  const { palette } = useAppTheme();
  return (
    <View style={[styles.metric, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <View style={[styles.metricIcon, { backgroundColor: palette.brandSoft }]}>{icon}</View>
      <Text style={[styles.metricValue, { color: palette.ink }]}>{value}</Text>
      <Text style={[styles.metricLabel, { color: palette.muted }]}>{label}</Text>
    </View>
  );
}

function friendlyStatus(value: string) {
  const normalized = value.toLowerCase().replace(/[\s-]+/g, "_");
  const labels: Record<string, string> = {
    approved: "Verified",
    active: "Available",
    available: "Available",
    paused: "Temporarily paused",
    closed: "Closed",
    unavailable: "Unavailable",
  };
  return labels[normalized] ?? normalized.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

function stationTone(value: string): "neutral" | "brand" | "success" | "warning" | "danger" {
  const normalized = value.toLowerCase();
  if (["approved", "active", "available"].some((part) => normalized.includes(part))) return "success";
  if (["paused", "closed"].some((part) => normalized.includes(part))) return "warning";
  if (["suspended", "deactivated"].some((part) => normalized.includes(part))) return "danger";
  return "neutral";
}

const styles = StyleSheet.create({
  media: { overflow: "hidden", borderRadius: radii.xl },
  hero: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderRadius: radii.xl },
  heroIcon: { width: 54, height: 54, borderRadius: 19, backgroundColor: "rgba(255,255,255,.14)", alignItems: "center", justifyContent: "center" },
  heroCopy: { flex: 1, minWidth: 0, gap: 3 },
  heroEyebrow: { color: "rgba(255,255,255,.72)", ...typography.eyebrow, fontSize: 8 },
  heroTitle: { color: "#FFFFFF", ...typography.heading, fontSize: 20 },
  heroBody: { color: "rgba(255,255,255,.84)", ...typography.caption, lineHeight: 18 },
  mapShell: { overflow: "hidden", borderRadius: radii.xl },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  metric: { flex: 1, minWidth: 150, gap: 6, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  metricIcon: { width: 40, height: 40, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  metricValue: { ...typography.bodyStrong, fontSize: 15 },
  metricLabel: { ...typography.caption },
  addressCard: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  addressIcon: { width: 46, height: 46, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  addressCopy: { flex: 1, gap: 3 },
  addressLabel: { ...typography.eyebrow, fontSize: 8 },
  addressValue: { ...typography.bodyStrong, fontSize: 14, lineHeight: 20 },
  trust: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm + 2, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  trustText: { flex: 1, ...typography.caption, lineHeight: 18 },
});
