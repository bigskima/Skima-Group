import { router } from "expo-router";
import { ChevronRight, Gauge, MapPin, ShieldCheck } from "lucide-react-native";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { domainQueries } from "../api/domains";
import { displayStatus, firstNumber, firstString, recordId } from "../api/records";
import { OperationalMap, type MapPoint } from "../maps/OperationalMap";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { EmptyState } from "./EmptyState";
import { Screen } from "./Screen";
import { StatusPill } from "./StatusPill";

export function StationsScreen() {
  const { palette } = useAppTheme();
  const stations = domainQueries.stations();
  const points = (stations.data ?? [])
    .map((item) => {
      const latitude = firstNumber(item, ["latitude", "lat"]);
      const longitude = firstNumber(item, ["longitude", "lng", "lon"]);
      return latitude !== null && longitude !== null
        ? {
            latitude,
            longitude,
            label: firstString(item, ["display_name", "displayName", "name"]) ?? "SKIMA station",
          }
        : null;
    })
    .filter((item): item is MapPoint => Boolean(item));

  return (
    <Screen
      eyebrow="SKIMA stations"
      title="Nearby stations"
      subtitle="Find verified LPG stations available through SKIMA in your area."
    >
      {stations.isPending ? (
        <View style={styles.loading}>
          <ActivityIndicator color={palette.brand} />
          <Text style={[styles.loadingText, { color: palette.muted }]}>Finding available stations…</Text>
        </View>
      ) : stations.error ? (
        <EmptyState
          title="Stations couldn't be loaded"
          description="Check your connection and try again."
        />
      ) : (stations.data ?? []).length === 0 ? (
        <EmptyState
          icon={<ShieldCheck color={palette.brand} size={27} />}
          title="No stations nearby yet"
          description="Verified stations will appear here as SKIMA service becomes available around you."
        />
      ) : (
        <>
          {points.length ? (
            <View style={[styles.mapShell, shadows.soft, { borderColor: palette.border, backgroundColor: palette.surface }]}>
              <OperationalMap points={points} />
            </View>
          ) : null}

          <View style={styles.list}>
            {(stations.data ?? []).map((station, index) => {
              const id = recordId(station);
              const status = displayStatus(station) ?? firstString(station, ["availability_status", "availabilityStatus"]) ?? "configured";
              const capacity = firstNumber(station, ["currentAvailableKg", "current_available_kg"]);
              const name = firstString(station, ["display_name", "displayName", "name"]) ?? "SKIMA station";
              const address = firstString(station, ["formatted_address", "formattedAddress", "address"]) ?? "Address will appear when available";

              return (
                <Pressable
                  key={id ?? String(index)}
                  accessibilityRole="button"
                  disabled={!id}
                  onPress={() => router.push(`/(customer)/station/${id}` as never)}
                  style={({ pressed }) => [
                    styles.station,
                    shadows.soft,
                    { backgroundColor: palette.surface, borderColor: palette.border, opacity: pressed ? 0.76 : 1 },
                  ]}
                >
                  <View style={[styles.icon, { backgroundColor: palette.brandSoft }]}>
                    <MapPin color={palette.brand} size={22} />
                  </View>

                  <View style={styles.copy}>
                    <View style={styles.nameRow}>
                      <Text numberOfLines={1} style={[styles.title, { color: palette.ink }]}>{name}</Text>
                      <View style={[styles.verified, { backgroundColor: palette.successSoft }]}>
                        <ShieldCheck color={palette.success} size={12} />
                        <Text style={[styles.verifiedText, { color: palette.success }]}>Verified</Text>
                      </View>
                    </View>
                    <Text numberOfLines={2} style={[styles.body, { color: palette.muted }]}>{address}</Text>
                    <StatusPill label={friendlyStationStatus(status)} tone={stationStatusTone(status)} />
                  </View>

                  <View style={styles.trailing}>
                    <View style={[styles.capacity, { backgroundColor: palette.soft }]}>
                      <Gauge color={palette.mutedStrong} size={15} />
                      <Text style={[styles.capacityText, { color: palette.ink }]}>{capacity ?? "—"}</Text>
                      <Text style={[styles.capacityUnit, { color: palette.muted }]}>kg</Text>
                    </View>
                    <ChevronRight color={palette.muted} size={18} />
                  </View>
                </Pressable>
              );
            })}
          </View>
        </>
      )}
    </Screen>
  );
}

function normalizeStatus(value: string) {
  return value.toLowerCase().replace(/[-\s]+/g, "_");
}

function friendlyStationStatus(value: string) {
  const normalized = normalizeStatus(value);
  const labels: Record<string, string> = {
    available: "Available now",
    active: "Available now",
    configured: "Ready for SKIMA orders",
    busy: "High activity",
    temporarily_unavailable: "Temporarily unavailable",
    unavailable: "Unavailable",
    suspended: "Unavailable",
  };
  return labels[normalized] ?? normalized.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

function stationStatusTone(value: string): "neutral" | "brand" | "success" | "warning" | "danger" {
  const normalized = normalizeStatus(value);
  if (["available", "active"].includes(normalized)) return "success";
  if (["busy", "configured"].includes(normalized)) return "warning";
  if (["temporarily_unavailable", "unavailable", "suspended"].includes(normalized)) return "danger";
  return "neutral";
}

const styles = StyleSheet.create({
  loading: { minHeight: 180, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  loadingText: { ...typography.caption },
  mapShell: { overflow: "hidden", borderRadius: radii.xl, borderWidth: StyleSheet.hairlineWidth, minHeight: 220 },
  list: { gap: spacing.md },
  station: { minHeight: 116, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radii.xl, borderWidth: StyleSheet.hairlineWidth },
  icon: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, minWidth: 0, gap: 7 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  title: { flexShrink: 1, ...typography.subheading, fontSize: 16 },
  verified: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 4, borderRadius: radii.pill },
  verifiedText: { ...typography.caption, fontSize: 9, fontWeight: "900" },
  body: { ...typography.caption, fontSize: 12, lineHeight: 17 },
  trailing: { alignItems: "center", gap: spacing.sm },
  capacity: { minWidth: 54, minHeight: 50, alignItems: "center", justifyContent: "center", borderRadius: 15, paddingHorizontal: spacing.sm },
  capacityText: { fontSize: 13, fontWeight: "900", marginTop: 2 },
  capacityUnit: { ...typography.caption, fontSize: 8 },
});
