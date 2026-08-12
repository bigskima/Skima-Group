import { router } from "expo-router";
import {
  Clock3,
  MapPin,
  PackageCheck,
  Route,
  ScanLine,
} from "lucide-react-native";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { domainQueries } from "../api/domains";
import {
  displayReference,
  displayStatus,
  firstNumber,
  firstString,
  nestedRecord,
  recordId,
} from "../api/records";
import { colors, radii, spacing } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { Screen } from "./Screen";
export function JobListScreen({
  workspace,
}: {
  workspace: "driver" | "station";
}) {
  const jobs =
    workspace === "driver"
      ? domainQueries.driverJobs()
      : domainQueries.stationJobs();
  return (
    <Screen
      eyebrow={workspace === "driver" ? "Ready for you" : "At your station"}
      title={workspace === "driver" ? "Deliveries" : "Refill requests"}
      refreshControl={
        <RefreshControl
          refreshing={jobs.isRefetching}
          onRefresh={() => void jobs.refetch()}
          tintColor={colors.brand}
        />
      }
    >
      {jobs.isPending ? (
        <ActivityIndicator color={colors.brand} />
      ) : jobs.error ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Couldn't load this list</Text>
          <Text style={styles.body}>
            {friendlyError(jobs.error, "Jobs could not be loaded. Please try again.")}
          </Text>
          <Pressable onPress={() => void jobs.refetch()}>
            <Text style={styles.link}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <>
          {(jobs.data ?? []).map((job, index) => {
            const id = recordId(job);
            const order = nestedRecord(job, "order") ?? job;
            const cylinder = nestedRecord(order, "cylinder");
            const location =
              workspace === "driver"
                ? (nestedRecord(order, "pickupLocation") ??
                  nestedRecord(order, "pickup_location"))
                : (nestedRecord(order, "station") ??
                  nestedRecord(order, "stationBranch"));
            const status =
              displayStatus(job) ?? displayStatus(order) ?? "queued";
            return (
              <Pressable
                key={id ?? String(index)}
                disabled={!id}
                onPress={() =>
                  router.push(
                    `/${workspace === "driver" ? "(driver)" : "(station)"}/job/${id}` as never,
                  )
                }
                style={styles.job}
              >
                <View style={styles.head}>
                  <View style={styles.icon}>
                    {workspace === "driver" ? (
                      <Route color={colors.brand} size={24} />
                    ) : (
                      <ScanLine color={colors.brand} size={24} />
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title}>
                      {displayReference(order) ??
                        displayReference(job) ??
                        "Refill order"}
                    </Text>
                    <Text style={styles.status}>
                      {jobStatusLabel(status)}
                    </Text>
                  </View>
                  <Text style={styles.size}>
                    {cylinder
                      ? `${firstNumber(cylinder, ["sizeKg", "size_kg"]) ?? "—"} kg`
                      : "LPG"}
                  </Text>
                </View>
                <View style={styles.divider} />
                <View style={styles.detail}>
                  <MapPin color={colors.muted} size={17} />
                  <Text numberOfLines={2} style={styles.body}>
                    {location
                      ? (firstString(location, [
                          "formattedAddress",
                          "formatted_address",
                          "displayName",
                          "display_name",
                        ]) ?? "Location details will appear here")
                      : "Location details will appear here"}
                  </Text>
                </View>
                <View style={styles.detail}>
                  <Clock3 color={colors.muted} size={17} />
                  <Text style={styles.body}>
                    {formatDate(
                      firstString(job, [
                        "updated_at",
                        "updatedAt",
                        "created_at",
                        "createdAt",
                      ]),
                    )}
                  </Text>
                </View>
              </Pressable>
            );
          })}
          {(jobs.data ?? []).length === 0 ? (
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <PackageCheck color={colors.brand} size={34} />
              </View>
              <Text style={styles.emptyTitle}>No active jobs</Text>
              <Text style={styles.body}>
                {workspace === "driver"
                  ? "New assignments will appear here when they are ready for you."
                  : "New refill jobs will appear here when they reach your station."}
              </Text>
            </View>
          ) : null}
        </>
      )}
    </Screen>
  );
}
function formatDate(value: string | null) {
  if (!value) return "Time not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time not available" : date.toLocaleString();
}
function jobStatusLabel(status: string) {
  const labels: Record<string, string> = {
    accepted: "Accepted",
    assigned: "Driver assigned",
    at_station: "At station",
    cancelled: "Cancelled",
    collected: "Cylinder collected",
    completed: "Completed",
    delivered: "Delivered",
    in_progress: "In progress",
    pending: "Waiting to begin",
    queued: "Ready to begin",
    refill_completed: "Refill complete",
    returning: "Returning to customer",
  };
  return labels[status.toLowerCase()] ?? "In progress";
}
const styles = StyleSheet.create({
  job: {
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
  },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  icon: {
    width: 50,
    height: 50,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF0F1",
  },
  title: { color: colors.ink, fontSize: 17, fontWeight: "900" },
  status: {
    color: colors.brandDark,
    fontWeight: "800",
    textTransform: "capitalize",
    marginTop: 4,
  },
  size: { color: colors.ink, fontSize: 18, fontWeight: "900" },
  divider: { height: 1, backgroundColor: colors.border },
  detail: { flexDirection: "row", alignItems: "center", gap: 8 },
  body: { flex: 1, color: colors.muted, lineHeight: 20 },
  empty: {
    minHeight: 280,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.xl,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF0F1",
  },
  emptyTitle: { color: colors.ink, fontSize: 21, fontWeight: "900" },
  link: { color: colors.brand, fontWeight: "900" },
});
