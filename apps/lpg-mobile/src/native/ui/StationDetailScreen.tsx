import { router } from "expo-router";
import { Clock3, Fuel, MapPin, ShieldCheck } from "lucide-react-native";
import { type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { domainQueries, useEntityMediaLinks } from "../api/domains";
import {
  displayStatus,
  firstNumber,
  firstString,
  nestedRecord,
  recordId,
} from "../api/records";
import { OperationalMap } from "../maps/OperationalMap";
import { colors, radii, spacing } from "../theme/tokens";
import { Card } from "./Card";
import { RuntimeMediaImage } from "./RuntimeMediaImage";
import { Screen } from "./Screen";

export function StationDetailScreen({ id }: { id: string | null }) {
  const stations = domainQueries.stations();
  const media = useEntityMediaLinks("station", id);
  const station = (stations.data ?? []).find((item) => recordId(item) === id);
  const latitude = firstNumber(station, ["latitude", "lat"]);
  const longitude = firstNumber(station, ["longitude", "lng", "lon"]);
  const hours =
    nestedRecord(station, "operatingHours") ??
    nestedRecord(station, "operating_hours");
  const presentation = (media.data ?? []).find((item) =>
    (firstString(item, ["media_role", "mediaRole"]) ?? "").includes(
      "presentation",
    ),
  );
  const original = (media.data ?? []).find((item) =>
    ["station.photo", "original", "photo"].some((role) =>
      (firstString(item, ["media_role", "mediaRole"]) ?? "").includes(role),
    ),
  );
  const assetId = firstString(presentation ?? original, [
    "media_asset_id",
    "mediaAssetId",
  ]);
  return (
    <Screen
      eyebrow="Approved refill network"
      title={
        firstString(station, ["display_name", "displayName", "name"]) ??
        "Station"
      }
      action={
        <Pressable onPress={() => router.back()}>
          <Text style={styles.back}>Back</Text>
        </Pressable>
      }
    >
      {stations.isPending || media.isPending ? (
        <ActivityIndicator color={colors.brand} />
      ) : !station ? (
        <Card>
          <Text style={styles.title}>Station unavailable</Text>
          <Text style={styles.body}>
            This station is not in the current public, approved station
            directory.
          </Text>
        </Card>
      ) : (
        <>
          {assetId ? (
            <RuntimeMediaImage assetId={assetId} label="Station presentation" />
          ) : null}
          {latitude !== null && longitude !== null ? (
            <OperationalMap
              points={[
                {
                  latitude,
                  longitude,
                  label:
                    firstString(station, ["display_name", "displayName"]) ??
                    "Station",
                },
              ]}
            />
          ) : null}
          <View style={styles.hero}>
            <ShieldCheck color="white" size={28} />
            <View style={{ flex: 1 }}>
              <Text style={styles.heroTitle}>Verified network station</Text>
              <Text style={styles.heroBody}>
                {(displayStatus(station) ?? "approved").replace(/[_-]/g, " ")}
              </Text>
            </View>
          </View>
          <Card>
            <Fact
              icon={<MapPin color={colors.brand} size={20} />}
              label="Address"
              value={
                firstString(station, [
                  "formatted_address",
                  "formattedAddress",
                  "address",
                ]) ?? "Not publicly listed"
              }
            />
            <Fact
              icon={<Clock3 color={colors.brand} size={20} />}
              label="Operating hours"
              value={`${firstString(hours, ["opensAt", "opens_at"]) ?? "Configured"} – ${firstString(hours, ["closesAt", "closes_at"]) ?? "Configured"}`}
            />
            <Fact
              icon={<Fuel color={colors.brand} size={20} />}
              label="Available refill capacity"
              value={`${firstNumber(station, ["currentAvailableKg", "current_available_kg"]) ?? "—"} kg`}
            />
          </Card>
        </>
      )}
    </Screen>
  );
}
function Fact({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.fact}>
      {icon}
      <View style={{ flex: 1 }}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value}>{value}</Text>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  back: { color: colors.brand, fontWeight: "800" },
  hero: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.xl,
    borderRadius: radii.lg,
    backgroundColor: colors.brand,
  },
  heroTitle: { color: "white", fontSize: 21, fontWeight: "900" },
  heroBody: { color: "#FFF1F2", marginTop: 4, textTransform: "capitalize" },
  fact: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  label: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  value: { color: colors.ink, fontSize: 16, fontWeight: "800", marginTop: 3 },
  title: { color: colors.ink, fontSize: 19, fontWeight: "900" },
  body: { color: colors.muted, lineHeight: 21 },
});
