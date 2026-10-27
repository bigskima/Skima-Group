import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { BriefcaseBusiness, CheckCircle2, Clock3, MapPin, Truck } from "lucide-react-native";
import { RefreshControl, StyleSheet, Text, View } from "react-native";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { AppButton } from "./AppButton";
import { EmptyState } from "./EmptyState";
import { Screen } from "./Screen";
import { StatusPill } from "./StatusPill";

type StationDriverHomeJob = {
  id: string;
  lpgOrderId: string;
  publicReference: string | null;
  status: "assigned" | "accepted" | "en_route" | "delivered";
  orderStatus: string;
  requestedKg: number;
  totalAmount: number;
  currencyCode: string;
  assignedAt: string;
  completedAt: string | null;
  stationName: string;
  stationAddress: string | null;
  deliveryAddress: string | null;
  customerName: string | null;
  vehicleRegistration?: string | null;
};

export function StationManagedDriverHomeScreen() {
  const { supabase } = useSession();
  const { palette } = useAppTheme();
  const jobs = useQuery({
    queryKey: ["station-managed-driver-jobs"],
    queryFn: async (): Promise<StationDriverHomeJob[]> => {
      const result = await supabase.rpc("read_lpg_station_managed_driver_jobs", { target_limit: 50 });
      if (result.error) throw result.error;
      if (!Array.isArray(result.data)) throw new Error("Station delivery jobs were returned in an unexpected format.");
      return result.data as StationDriverHomeJob[];
    },
    refetchInterval: 15000,
  });

  const rows = jobs.data ?? [];
  const activeJobs = rows.filter((job) => job.status !== "delivered");
  const completedJobs = rows.filter((job) => job.status === "delivered");
  const nextJob = activeJobs[0] ?? null;
  const refresh = () => void jobs.refetch();

  return (
    <Screen
      eyebrow="STATION MANAGED"
      title="Your workday"
      subtitle="Your deliveries, pickup and hand-over workflow in one place. Only jobs assigned to your station-driver identity appear here."
      refreshControl={<RefreshControl refreshing={jobs.isRefetching} onRefresh={refresh} tintColor={palette.brand} />}
    >
      <View style={styles.metrics}>
        <View style={[styles.metric, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <View style={[styles.metricIcon, { backgroundColor: palette.brandSoft }]}>
            <Truck color={palette.brand} size={20} />
          </View>
          <Text style={[styles.metricValue, { color: palette.ink }]}>{jobs.isPending ? "—" : activeJobs.length}</Text>
          <Text style={[styles.metricLabel, { color: palette.muted }]}>Active deliveries</Text>
        </View>
        <View style={[styles.metric, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <View style={[styles.metricIcon, { backgroundColor: palette.successSoft }]}>
            <CheckCircle2 color={palette.success} size={20} />
          </View>
          <Text style={[styles.metricValue, { color: palette.ink }]}>{jobs.isPending ? "—" : completedJobs.length}</Text>
          <Text style={[styles.metricLabel, { color: palette.muted }]}>Completed in loaded history</Text>
        </View>
      </View>

      <View style={[styles.sectionHeader, { borderBottomColor: palette.border }]}>
        <View style={styles.sectionHeadingCopy}>
          <Text style={[styles.sectionTitle, { color: palette.ink }]}>Next delivery</Text>
          <Text style={[styles.sectionSubtitle, { color: palette.muted }]}>Open a job to continue the verified station-specific workflow.</Text>
        </View>
        <BriefcaseBusiness color={palette.brand} size={22} />
      </View>

      {jobs.error ? (
        <EmptyState
          icon={<BriefcaseBusiness color={palette.brand} size={26} />}
          title="Deliveries unavailable"
          description={friendlyError(jobs.error, "We could not load your station assignments. Try again shortly.")}
          action={<AppButton label="Try again" variant="secondary" onPress={refresh} />}
        />
      ) : jobs.isPending ? (
        <View style={[styles.infoCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <Text style={[styles.mutedText, { color: palette.muted }]}>Loading your station assignments…</Text>
        </View>
      ) : nextJob ? (
        <View style={[styles.infoCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <View style={styles.jobHeader}>
            <View style={styles.jobCopy}>
              <Text style={[styles.jobReference, { color: palette.ink }]}>{nextJob.publicReference || "Station delivery"}</Text>
              <Text style={[styles.mutedText, { color: palette.muted }]}>{nextJob.stationName}</Text>
            </View>
            <StatusPill
              label={statusLabel(nextJob.status)}
              tone={nextJob.status === "en_route" ? "brand" : "neutral"}
            />
          </View>
          <View style={styles.detailRow}>
            <Clock3 color={palette.muted} size={16} />
            <Text style={[styles.detailText, { color: palette.ink }]}>{stageLabel(nextJob.orderStatus)}</Text>
          </View>
          <View style={styles.detailRow}>
            <MapPin color={palette.muted} size={16} />
            <Text style={[styles.detailText, { color: palette.ink }]}>{nextJob.deliveryAddress || "Delivery address is available in the job details."}</Text>
          </View>
          <View style={[styles.jobMeta, { borderTopColor: palette.border }]}>
            <Text style={[styles.metaText, { color: palette.ink }]}>{nextJob.requestedKg} kg requested</Text>
            <Text style={[styles.metaText, { color: palette.ink }]}>{money(nextJob.totalAmount, nextJob.currencyCode)}</Text>
          </View>
          <AppButton
            label="Open delivery workflow"
            fullWidth
            onPress={() => router.push(`/(station-driver)/job/${encodeURIComponent(nextJob.lpgOrderId)}` as never)}
          />
        </View>
      ) : (
        <EmptyState
          icon={<CheckCircle2 color={palette.brand} size={26} />}
          title="No active deliveries assigned"
          description="When your station has an eligible paid order and the required driver and vehicle are ready, SKIMA's existing dispatch flow will assign the delivery here."
        />
      )}

      <AppButton
        label="View all deliveries"
        fullWidth
        variant="secondary"
        onPress={() => router.push("/(station-driver)/jobs" as never)}
      />

      <View style={[styles.processCard, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
        <Text style={[styles.sectionTitle, { color: palette.ink }]}>Your delivery workflow</Text>
        <Step number="1" title="Pickup and station handover" detail="Open the assigned job and follow its required pickup and cylinder-verification steps." />
        <Step number="2" title="Wait for station release" detail="The station completes its refill and settlement steps before the return leg is available." />
        <Step number="3" title="Customer handover" detail="Follow the delivery verification and final cylinder scan shown in the job." />
        <Text style={[styles.disclaimer, { color: palette.muted }]}>Station Managed drivers keep a station-owned identity. Station compensation is handled by the station, not through SKIMA driver payouts.</Text>
      </View>
    </Screen>
  );
}

function Step({ number, title, detail }: { number: string; title: string; detail: string }) {
  const { palette } = useAppTheme();
  return (
    <View style={styles.step}>
      <View style={[styles.stepNumber, { backgroundColor: palette.brandSoft }]}>
        <Text style={[styles.stepNumberText, { color: palette.brand }]}>{number}</Text>
      </View>
      <View style={styles.stepCopy}>
        <Text style={[styles.stepTitle, { color: palette.ink }]}>{title}</Text>
        <Text style={[styles.mutedText, { color: palette.muted }]}>{detail}</Text>
      </View>
    </View>
  );
}

function statusLabel(status: string) {
  if (status === "assigned") return "Assigned";
  if (status === "accepted") return "Accepted";
  if (status === "en_route") return "En route";
  return "Completed";
}

function stageLabel(status: string) {
  const labels: Record<string, string> = {
    driver_offered: "Waiting for driver acceptance",
    driver_accepted: "Pickup and station handover",
    station_settled: "Ready for return delivery",
    return_en_route: "Return delivery in progress",
    delivery_verification_pending: "Customer handover verification",
    completed: "Delivery completed",
  };
  return labels[status] ?? status.replace(/[_-]+/g, " ");
}

function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
  }
}

const styles = StyleSheet.create({
  metrics: { flexDirection: "row", gap: spacing.md },
  metric: { flex: 1, minWidth: 0, padding: spacing.md, borderWidth: 1, borderRadius: radii.xl, gap: spacing.xs },
  metricIcon: { width: 38, height: 38, borderRadius: radii.md, alignItems: "center", justifyContent: "center", marginBottom: spacing.xs },
  metricValue: { ...typography.title, fontSize: 26, lineHeight: 31 },
  metricLabel: { ...typography.caption, fontSize: 11, lineHeight: 15 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: spacing.sm },
  sectionHeadingCopy: { flex: 1, gap: 4 },
  sectionTitle: { ...typography.heading, fontSize: 17, fontWeight: "900" },
  sectionSubtitle: { ...typography.caption, lineHeight: 17 },
  infoCard: { borderWidth: 1, borderRadius: radii.xl, padding: spacing.md, gap: spacing.md },
  jobHeader: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  jobCopy: { flex: 1, minWidth: 0, gap: 4 },
  jobReference: { ...typography.heading, fontSize: 17, fontWeight: "900" },
  mutedText: { ...typography.caption, lineHeight: 18 },
  detailRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  detailText: { ...typography.body, flex: 1, fontSize: 13, lineHeight: 19 },
  jobMeta: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.sm, flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  metaText: { ...typography.body, fontWeight: "800" },
  processCard: { borderWidth: 1, borderRadius: radii.xl, padding: spacing.md, gap: spacing.md },
  step: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  stepNumber: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  stepNumberText: { fontSize: 12, fontWeight: "900" },
  stepCopy: { flex: 1, gap: 3 },
  stepTitle: { ...typography.body, fontWeight: "900" },
  disclaimer: { ...typography.caption, lineHeight: 18 },
});
