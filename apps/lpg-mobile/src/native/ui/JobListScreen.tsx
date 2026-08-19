import { router } from "expo-router";
import { Clock3, MapPin, PackageCheck, Route, ScanLine } from "lucide-react-native";
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { domainQueries } from "../api/domains";
import {
  displayReference,
  displayStatus,
  firstNumber,
  firstString,
  nestedRecord,
  recordId,
} from "../api/records";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { AppButton } from "./AppButton";
import { EmptyState } from "./EmptyState";
import { Screen } from "./Screen";
import { StatusPill } from "./StatusPill";

export function JobListScreen({ workspace }: { workspace: "driver" | "station" }) {
  const { palette } = useAppTheme();
  const jobs = workspace === "driver" ? domainQueries.driverJobs() : domainQueries.stationJobs();

  return (
    <Screen
      eyebrow={workspace === "driver" ? "Driver operations" : "Station operations"}
      title={workspace === "driver" ? "Deliveries" : "Refill queue"}
      subtitle={workspace === "driver" ? "Your assigned cylinder pickups, station hand-offs and returns." : "Cylinders assigned to this station and their current processing state."}
      refreshControl={
        <RefreshControl refreshing={jobs.isRefetching} onRefresh={() => void jobs.refetch()} tintColor={palette.brand} />
      }
    >
      {jobs.isPending ? (
        <View style={styles.loading}>
          <ActivityIndicator color={palette.brand} />
          <Text style={[styles.loadingText, { color: palette.muted }]}>Loading live jobs…</Text>
        </View>
      ) : jobs.error ? (
        <EmptyState
          title="Couldn't load the queue"
          description={friendlyError(jobs.error, "Jobs could not be loaded. Please try again.")}
          action={<AppButton label="Retry" variant="secondary" onPress={() => void jobs.refetch()} />}
        />
      ) : (jobs.data ?? []).length === 0 ? (
        <EmptyState
          icon={<PackageCheck color={palette.brand} size={26} />}
          title={workspace === "driver" ? "No active deliveries" : "No cylinders waiting"}
          description={workspace === "driver" ? "New assignments appear here automatically when SKIMA dispatches a job to you." : "New refill jobs appear here when a verified cylinder is routed to your station."}
        />
      ) : (
        <View style={styles.list}>
          {(jobs.data ?? []).map((job, index) => {
            const id = recordId(job);
            const order = nestedRecord(job, "order") ?? job;
            const cylinder = nestedRecord(order, "cylinder");
            const location = workspace === "driver"
              ? (nestedRecord(order, "pickupLocation") ?? nestedRecord(order, "pickup_location"))
              : (nestedRecord(order, "station") ?? nestedRecord(order, "stationBranch"));
            const status = displayStatus(job) ?? displayStatus(order) ?? "queued";
            const tone = jobStatusTone(status);
            const reference = displayReference(order) ?? displayReference(job) ?? "Refill order";
            const size = cylinder ? firstNumber(cylinder, ["sizeKg", "size_kg"]) : null;
            const locationText = location
              ? (firstString(location, ["formattedAddress", "formatted_address", "displayName", "display_name"]) ?? "Location details available in the job")
              : "Location details available in the job";

            return (
              <Pressable
                key={id ?? String(index)}
                accessibilityRole="button"
                disabled={!id}
                onPress={() => router.push(`/${workspace === "driver" ? "(driver)" : "(station)"}/job/${id}` as never)}
                style={({ pressed }) => [
                  styles.job,
                  shadows.soft,
                  { backgroundColor: palette.surface, borderColor: palette.border, opacity: pressed ? 0.76 : 1 },
                ]}
              >
                <View style={styles.head}>
                  <View style={[styles.icon, { backgroundColor: palette.brandSoft }]}>
                    {workspace === "driver" ? <Route color={palette.brand} size={23} /> : <ScanLine color={palette.brand} size={23} />}
                  </View>
                  <View style={styles.headingCopy}>
                    <Text numberOfLines={1} style={[styles.title, { color: palette.ink }]}>{reference}</Text>
                    <StatusPill label={jobStatusLabel(status)} tone={tone} />
                  </View>
                  <View style={[styles.sizeBadge, { backgroundColor: palette.soft }]}>
                    <Text style={[styles.sizeValue, { color: palette.ink }]}>{size !== null ? `${size}` : "LPG"}</Text>
                    {size !== null ? <Text style={[styles.sizeUnit, { color: palette.muted }]}>kg</Text> : null}
                  </View>
                </View>

                <View style={[styles.divider, { backgroundColor: palette.border }]} />

                <View style={styles.detail}>
                  <View style={[styles.detailIcon, { backgroundColor: palette.soft }]}>
                    <MapPin color={palette.mutedStrong} size={15} />
                  </View>
                  <View style={styles.detailCopy}>
                    <Text style={[styles.detailLabel, { color: palette.muted }]}>LOCATION</Text>
                    <Text numberOfLines={2} style={[styles.body, { color: palette.ink }]}>{locationText}</Text>
                  </View>
                </View>

                <View style={styles.detail}>
                  <View style={[styles.detailIcon, { backgroundColor: palette.soft }]}>
                    <Clock3 color={palette.mutedStrong} size={15} />
                  </View>
                  <View style={styles.detailCopy}>
                    <Text style={[styles.detailLabel, { color: palette.muted }]}>LAST UPDATED</Text>
                    <Text style={[styles.body, { color: palette.ink }]}>{formatDate(firstString(job, ["updated_at", "updatedAt", "created_at", "createdAt"]))}</Text>
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

function formatDate(value: string | null) {
  if (!value) return "Time not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time not available" : date.toLocaleString();
}

function normalizedStatus(status: string) {
  return status.toLowerCase().replace(/[-\s]+/g, "_");
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
    refill_in_progress: "Refill in progress",
    returning: "Returning to customer",
    pickup_en_route: "Heading to pickup",
    pickup_verified: "Cylinder collected",
    station_en_route: "Heading to station",
    station_verified: "Received at station",
    return_en_route: "Returning to customer",
    delivery_verification_pending: "Ready for hand-over",
  };
  const key = normalizedStatus(status);
  return labels[key] ?? key.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

function jobStatusTone(status: string): "neutral" | "brand" | "success" | "warning" | "danger" {
  const key = normalizedStatus(status);
  if (["completed", "delivered", "refill_completed"].includes(key)) return "success";
  if (["cancelled", "failed", "rejected"].includes(key)) return "danger";
  if (["pending", "queued", "delivery_verification_pending"].includes(key)) return "warning";
  if (["assigned", "accepted", "collected", "at_station", "in_progress", "refill_in_progress", "pickup_en_route", "pickup_verified", "station_en_route", "station_verified", "return_en_route", "returning"].includes(key)) return "brand";
  return "neutral";
}

const styles = StyleSheet.create({
  loading: { minHeight: 180, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  loadingText: { ...typography.caption },
  list: { gap: spacing.md },
  job: { gap: spacing.md, padding: spacing.lg, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  icon: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  headingCopy: { flex: 1, minWidth: 0, gap: 6 },
  title: { ...typography.subheading, fontSize: 16 },
  sizeBadge: { minWidth: 52, minHeight: 48, borderRadius: 15, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.sm },
  sizeValue: { fontSize: 16, fontWeight: "900" },
  sizeUnit: { ...typography.caption, fontSize: 9, marginTop: -1 },
  divider: { height: StyleSheet.hairlineWidth },
  detail: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  detailIcon: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  detailCopy: { flex: 1, minWidth: 0, gap: 2 },
  detailLabel: { ...typography.eyebrow, fontSize: 8 },
  body: { ...typography.caption, fontSize: 12, lineHeight: 17 },
});
