import { router } from "expo-router";
import { Gauge, MapPin, ShieldCheck } from "lucide-react-native";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { domainQueries } from "../api/domains";
import {
  displayStatus,
  firstNumber,
  firstString,
  recordId,
} from "../api/records";
import { OperationalMap, type MapPoint } from "../maps/OperationalMap";
import { colors, radii, spacing } from "../theme/tokens";
import { Card } from "./Card";
import { Screen } from "./Screen";

export function StationsScreen() {
  const stations = domainQueries.stations();
  const points = (stations.data ?? [])
    .map((item) => {
      const latitude = firstNumber(item, ["latitude", "lat"]);
      const longitude = firstNumber(item, ["longitude", "lng", "lon"]);
      return latitude !== null && longitude !== null
        ? {
            latitude,
            longitude,
            label:
              firstString(item, ["display_name", "displayName", "name"]) ??
              "Station",
          }
        : null;
    })
    .filter((item): item is MapPoint => Boolean(item));
  return (
    <Screen eyebrow="Public station discovery" title="Stations near you">
      {stations.isPending ? (
        <ActivityIndicator color={colors.brand} />
      ) : (
        <>
          <OperationalMap points={points} />
          {(stations.data ?? []).map((station, index) => {
            const id = recordId(station);
            return (
              <Pressable
                key={id ?? String(index)}
                disabled={!id}
                onPress={() =>
                  router.push(`/(customer)/station/${id}` as never)
                }
              >
                <Card>
                  <View style={styles.row}>
                    <View style={styles.icon}>
                      <MapPin color={colors.brand} size={23} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.title}>
                        {firstString(station, [
                          "display_name",
                          "displayName",
                          "name",
                        ]) ?? "SKIMA station"}
                      </Text>
                      <Text style={styles.body}>
                        {firstString(station, [
                          "formatted_address",
                          "formattedAddress",
                          "address",
                        ]) ?? "Public address unavailable"}
                      </Text>
                      <Text style={styles.status}>
                        {(
                          displayStatus(station) ??
                          firstString(station, [
                            "availability_status",
                            "availabilityStatus",
                          ]) ??
                          "configured"
                        ).replace(/[_-]/g, " ")}
                      </Text>
                    </View>
                    <View style={styles.capacity}>
                      <Gauge color={colors.muted} size={18} />
                      <Text style={styles.capacityText}>
                        {firstNumber(station, [
                          "currentAvailableKg",
                          "current_available_kg",
                        ]) ?? "—"}{" "}
                        kg
                      </Text>
                    </View>
                  </View>
                </Card>
              </Pressable>
            );
          })}
          {(stations.data ?? []).length === 0 ? (
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <ShieldCheck color={colors.brand} size={32} />
              </View>
              <Text style={styles.emptyTitle}>
                No public stations available
              </Text>
              <Text style={styles.body}>
                Only verified stations available to serve customers are shown here.

              </Text>
            </View>
          ) : null}
        </>
      )}
    </Screen>
  );
}
const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  icon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF0F1",
  },
  title: { color: colors.ink, fontSize: 17, fontWeight: "900" },
  body: { color: colors.muted, lineHeight: 20 },
  status: {
    color: colors.brandDark,
    fontWeight: "800",
    textTransform: "capitalize",
    marginTop: 5,
  },
  capacity: { alignItems: "center", gap: 4 },
  capacityText: { color: colors.ink, fontWeight: "800" },
  empty: {
    minHeight: 270,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
  },
  emptyIcon: {
    width: 70,
    height: 70,
    borderRadius: 35,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF0F1",
  },
  emptyTitle: { color: colors.ink, fontSize: 21, fontWeight: "900" },
});
