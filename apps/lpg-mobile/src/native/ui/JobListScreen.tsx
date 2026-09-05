import { router } from "expo-router";
import { Clock3, MapPin, PackageCheck, Route, ScanLine, Search, UserCheck } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { domainQueries, useLpgConfig } from "../api/domains";
import {
  displayReference,
  displayStatus,
  firstNumber,
  firstString,
  nestedRecord,
  recordId,
  type PlatformRecord,
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
  const config = useLpgConfig();
  const [searchQuery, setSearchQuery] = useState("");
  const allJobs = jobs.data ?? [];
  const visibleJobs = workspace === "station" && searchQuery.trim()
    ? allJobs.filter((job) => matchesStationVerificationSearch(job, searchQuery))
    : allJobs;
  const driverLimit = workspace === "driver" ? readDriverDispatchLimit(config.data) : null;
  const remainingDriverSlots = driverLimit === null ? null : Math.max(driverLimit - allJobs.length, 0);

  const refresh = () => {
    if (workspace === "driver") {
      void Promise.all([jobs.refetch(), config.refetch()]);
      return;
    }
    void jobs.refetch();
  };

  return (
    <Screen
      eyebrow={workspace === "driver" ? "Driver jobs" : "Station orders"}
      title={workspace === "driver" ? "Deliveries" : "Expected arrivals"}
      subtitle={workspace === "driver"
        ? "See what needs your attention now and open a delivery for the full route."
        : "See expected SKIMA arrivals and open one when the driver reaches reception."}
      refreshControl={
        <RefreshControl
          refreshing={jobs.isRefetching || (workspace === "driver" && config.isRefetching)}
          onRefresh={refresh}
          tintColor={palette.brand}
        />
      }
    >
      {workspace === "driver" ? (
        <View style={[styles.workloadCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <View style={styles.workloadHead}>
            <View style={[styles.workloadIcon, { backgroundColor: palette.brandSoft }]}>
              <Route color={palette.brand} size={20} />
            </View>
            <View style={styles.workloadCopy}>
              <Text style={[styles.workloadTitle, { color: palette.ink }]}>Workload</Text>
              <Text style={[styles.workloadBody, { color: palette.muted }]}>Your current delivery capacity at a glance.</Text>
            </View>
          </View>
          <View style={styles.workloadMetrics}>
            <View style={[styles.workloadMetric, { backgroundColor: palette.surfaceSubtle }]}>
              <Text style={[styles.workloadValue, { color: palette.ink }]}>{allJobs.length}</Text>
              <Text style={[styles.workloadLabel, { color: palette.muted }]}>ACTIVE ORDERS</Text>
            </View>
            <View style={[styles.workloadMetric, { backgroundColor: palette.surfaceSubtle }]}>
              <Text style={[styles.workloadValue, { color: palette.ink }]}>{driverLimit ?? "—"}</Text>
              <Text style={[styles.workloadLabel, { color: palette.muted }]}>JOB LIMIT</Text>
            </View>
            <View style={[styles.workloadMetric, { backgroundColor: palette.surfaceSubtle }]}>
              <Text style={[styles.workloadValue, { color: remainingDriverSlots === 0 ? palette.warning : palette.ink }]}>{remainingDriverSlots ?? "—"}</Text>
              <Text style={[styles.workloadLabel, { color: palette.muted }]}>SPACES LEFT</Text>
            </View>
          </View>
          <Text style={[styles.workloadHint, { color: palette.muted }]}>New work is assigned only when your route, vehicle and availability are suitable.</Text>
        </View>
      ) : null}

      {workspace === "station" ? (
        <View style={[styles.searchCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <View style={styles.searchHead}>
            <View style={[styles.detailIcon, { backgroundColor: palette.brandSoft }]}>
              <Search color={palette.brand} size={16} />
            </View>
            <View style={styles.searchCopy}>
              <Text style={[styles.searchTitle, { color: palette.ink }]}>Find an arrival</Text>
              <Text style={[styles.searchBody, { color: palette.muted }]}>Search your station queue by order, cylinder or driver.</Text>
            </View>
          </View>
          <TextInput
            accessibilityLabel="Find assigned LPG service"
            autoCapitalize="characters"
            autoCorrect={false}
            onChangeText={setSearchQuery}
            placeholder="Order, Cylinder ID or Driver ID"
            placeholderTextColor={palette.muted}
            style={[styles.searchInput, { backgroundColor: palette.input, borderColor: palette.borderStrong, color: palette.ink }]}
            value={searchQuery}
          />
          <Text style={[styles.searchHint, { color: palette.muted }]}>Only arrivals assigned to this station are shown.</Text>
        </View>
      ) : null}

      {jobs.isPending ? (
        <View style={styles.loading}>
          <ActivityIndicator color={palette.brand} />
          <Text style={[styles.loadingText, { color: palette.muted }]}>Loading jobs…</Text>
        </View>
      ) : jobs.error ? (
        <EmptyState
          title="Couldn't load jobs"
          description={friendlyError(jobs.error, "Jobs could not be loaded. Please try again.")}
          action={<AppButton label="Retry" variant="secondary" onPress={() => void jobs.refetch()} />}
        />
      ) : allJobs.length === 0 ? (
        <EmptyState
          icon={<PackageCheck color={palette.brand} size={26} />}
          title={workspace === "driver" ? "No active deliveries" : "No expected arrivals"}
          description={workspace === "driver" ? "New suitable jobs appear here automatically. You may receive another job before finishing the current one when your route and workload allow it." : "New refill orders appear here automatically when SKIMA assigns them to this station."}
        />
      ) : visibleJobs.length === 0 ? (
        <EmptyState
          icon={<Search color={palette.brand} size={26} />}
          title="No assigned arrival matches"
          description="Check the order reference, Cylinder ID or Driver ID. This station can only search within its own assigned LPG jobs."
          action={<AppButton label="Clear search" variant="secondary" onPress={() => setSearchQuery("")} />}
        />
      ) : (
        <View style={styles.list}>
          {visibleJobs.map((job, index) => {
            const id = recordId(job);
            const order = nestedRecord(job, "order") ?? job;
            const cylinder = nestedRecord(job, "cylinder") ?? nestedRecord(order, "cylinder");
            const driver = nestedRecord(job, "driver") ?? nestedRecord(order, "driver");
            const location = workspace === "driver"
              ? (nestedRecord(order, "pickupLocation") ?? nestedRecord(order, "pickup_location"))
              : (nestedRecord(job, "station") ?? nestedRecord(order, "station") ?? nestedRecord(order, "stationBranch"));
            const status = displayStatus(job) ?? displayStatus(order) ?? "queued";
            const tone = jobStatusTone(status);
            const reference = displayReference(order) ?? displayReference(job) ?? "Refill order";
            const cylinderReference = cylinder
              ? displayReference(cylinder)
              : firstString(job, ["cylinderReference", "cylinderIdentifier", "cylinder_reference", "cylinder_identifier"]);
            const size = cylinder
              ? firstNumber(cylinder, ["sizeKg", "size_kg"])
              : firstNumber(job, ["cylinderSizeKg", "cylinder_size_kg"]);
            const cylinderTagStatus = firstString(job, ["cylinderTagStatus", "tagStatus", "cylinder_tag_status", "tag_status"]);
            const driverName = driver
              ? firstString(driver, ["displayName", "display_name", "name"])
              : firstString(job, ["driverDisplayName", "driver_display_name"]);
            const driverReference = driver
              ? firstString(driver, ["publicReference", "public_reference", "driverId", "driver_id"])
              : firstString(job, ["driverReference", "driver_reference"]);
            const driverVerificationStatus = firstString(job, ["driverVerificationStatus", "driver_verification_status"]);
            const locationText = location
              ? (firstString(location, ["formattedAddress", "formatted_address", "displayName", "display_name"]) ?? "Location details available in the job")
              : workspace === "station"
              ? (firstString(job, ["stationAddress", "stationDisplayName", "station_address", "station_display_name"]) ?? "This station")
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
                  {
                    backgroundColor: palette.surface,
                    borderColor: palette.border,
                    opacity: pressed ? 0.78 : 1,
                    transform: [{ scale: pressed ? 0.988 : 1 }],
                  },
                ]}
              >
                <View style={styles.head}>
                  <View style={[styles.icon, { backgroundColor: palette.brandSoft }]}>
                    {workspace === "driver" ? <Route color={palette.brand} size={21} /> : <ScanLine color={palette.brand} size={21} />}
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

                <View style={styles.metaRow}>
                  {cylinderReference ? (
                    <View style={[styles.metaChip, { backgroundColor: palette.surfaceSubtle }]}>
                      <PackageCheck color={palette.mutedStrong} size={13} />
                      <Text numberOfLines={1} style={[styles.metaText, { color: palette.mutedStrong }]}>
                        {cylinderReference}{cylinderTagStatus && normalizedStatus(cylinderTagStatus) !== "tagged" ? ` · ${tagStatusLabel(cylinderTagStatus)}` : ""}
                      </Text>
                    </View>
                  ) : null}
                  {workspace === "station" && (driverName || driverReference) ? (
                    <View style={[styles.metaChip, { backgroundColor: palette.surfaceSubtle }]}>
                      <UserCheck color={palette.mutedStrong} size={13} />
                      <Text numberOfLines={1} style={[styles.metaText, { color: palette.mutedStrong }]}>
                        {[driverName, driverReference].filter(Boolean).join(" · ")}
                      </Text>
                    </View>
                  ) : null}
                </View>

                <View style={[styles.locationRow, { borderTopColor: palette.border }]}>
                  <MapPin color={palette.brand} size={15} />
                  <Text numberOfLines={1} style={[styles.locationText, { color: palette.ink }]}>{locationText}</Text>
                  <Text style={[styles.updatedText, { color: palette.muted }]}>
                    {compactDate(firstString(job, ["updated_at", "updatedAt", "created_at", "createdAt"]))}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

function matchesStationVerificationSearch(job: PlatformRecord, rawQuery: string) {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return true;
  const order = nestedRecord(job, "order") ?? job;
  const cylinder = nestedRecord(job, "cylinder") ?? nestedRecord(order, "cylinder");
  const driver = nestedRecord(job, "driver") ?? nestedRecord(order, "driver");
  const candidates = [
    displayReference(job),
    displayReference(order),
    firstString(job, ["cylinderReference", "cylinderIdentifier", "cylinder_reference", "cylinder_identifier"]),
    cylinder ? displayReference(cylinder) : null,
    cylinder ? firstString(cylinder, ["cylinderIdentifier", "cylinder_identifier"]) : null,
    firstString(job, ["driverReference", "driver_reference"]),
    firstString(job, ["driverDisplayName", "driver_display_name"]),
    driver ? displayReference(driver) : null,
    driver ? firstString(driver, ["driverId", "driver_id", "publicReference", "public_reference"]) : null,
  ];
  return candidates.some((candidate) => candidate?.toLowerCase().includes(query));
}

function readDriverDispatchLimit(config: PlatformRecord | null | undefined): number | null {
  const policies = nestedRecord(config, "policies");
  const dispatchEnvelope = nestedRecord(policies, "lpg.dispatch.phase_one");
  const dispatchPolicy = nestedRecord(dispatchEnvelope, "policy");
  const configured = firstNumber(dispatchPolicy, ["max_concurrent_orders_per_driver", "maxConcurrentOrdersPerDriver"]);
  if (configured === null || !Number.isFinite(configured) || configured <= 0) return null;
  return Math.floor(configured);
}

function compactDate(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function normalizedStatus(status: string) {
  return status.toLowerCase().replace(/[-\s]+/g, "_");
}

function tagStatusLabel(status: string) {
  const labels: Record<string, string> = {
    untagged: "Not physically tagged yet",
    tag_pending: "Tag pending",
    tagged: "Physical tag active",
    tag_damaged: "Tag damaged",
    tag_lost: "Tag lost",
    replacement_pending: "Replacement pending",
    retired: "Retired",
  };
  const key = normalizedStatus(status);
  return labels[key] ?? key.replace(/_/g, " ");
}

function driverStatusLabel(status: string) {
  const key = normalizedStatus(status);
  if (["verified", "approved", "active"].includes(key)) return "Verified driver";
  if (["rejected", "blocked", "suspended"].includes(key)) return "Driver not eligible";
  return key.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());
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
  workloadCard: { gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.md },
  workloadHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  workloadIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  workloadCopy: { flex: 1, minWidth: 0, gap: 3 },
  workloadTitle: { ...typography.subheading, fontSize: 15 },
  workloadBody: { ...typography.caption, fontSize: 11, lineHeight: 16 },
  workloadMetrics: { flexDirection: "row", gap: spacing.sm },
  workloadMetric: { flex: 1, minHeight: 64, borderRadius: radii.lg, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xs },
  workloadValue: { fontSize: 20, fontWeight: "900" },
  workloadLabel: { ...typography.eyebrow, fontSize: 7, marginTop: 3, textAlign: "center" },
  workloadHint: { ...typography.caption, fontSize: 10, lineHeight: 15 },
  searchCard: { gap: spacing.sm + 2, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.md },
  searchHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  searchCopy: { flex: 1, gap: 3 },
  searchTitle: { ...typography.subheading, fontSize: 15 },
  searchBody: { ...typography.caption, lineHeight: 18 },
  searchHint: { ...typography.caption, fontSize: 10, lineHeight: 15 },
  searchInput: { minHeight: 48, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.md, ...typography.bodyStrong, fontSize: 14 },
  loading: { minHeight: 180, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  loadingText: { ...typography.caption },
  list: { gap: spacing.sm + 2 },
  job: { gap: 12, padding: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl },
  head: { flexDirection: "row", alignItems: "center", gap: 11 },
  icon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  headingCopy: { flex: 1, minWidth: 0, gap: 5 },
  title: { ...typography.subheading, fontSize: 15 },
  sizeBadge: { minWidth: 48, minHeight: 44, borderRadius: 14, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.sm },
  sizeValue: { fontSize: 15, fontWeight: "900" },
  sizeUnit: { ...typography.caption, fontSize: 8, marginTop: -1 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  metaChip: { maxWidth: "100%", minHeight: 28, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, borderRadius: radii.pill },
  metaText: { flexShrink: 1, ...typography.caption, fontSize: 9, fontWeight: "800" },
  locationRow: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: 7, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10 },
  locationText: { flex: 1, minWidth: 0, ...typography.caption, fontSize: 11, fontWeight: "800" },
  updatedText: { ...typography.caption, fontSize: 9 },
});