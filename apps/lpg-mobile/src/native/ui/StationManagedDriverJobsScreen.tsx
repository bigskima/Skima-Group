import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { RefreshControl, ScrollView, StyleSheet, Text, View, Pressable } from "react-native";
import { BriefcaseBusiness, CheckCircle2, Clock3, MapPin, UserRound } from "lucide-react-native";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";
import { idempotencyKey } from "../utilities/idempotency";
import { friendlyError } from "../utilities/friendlyError";
import { Screen } from "./Screen";
import { AppButton } from "./AppButton";
import { EmptyState } from "./EmptyState";
import { StatusPill } from "./StatusPill";

type ManagedJob = {
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
  deliveryInstructions: string | null;
  customerName: string | null;
};

export function StationManagedDriverJobsScreen() {
  const { supabase } = useSession();
  const { palette } = useAppTheme();
  const queryClient = useQueryClient();
  const jobs = useQuery({
    queryKey: ["station-managed-driver-jobs"],
    queryFn: async (): Promise<ManagedJob[]> => {
      const result = await supabase.rpc("read_lpg_station_managed_driver_jobs", { target_limit: 50 });
      if (result.error) throw result.error;
      if (!Array.isArray(result.data)) throw new Error("Station delivery jobs were returned in an unexpected format.");
      return result.data as ManagedJob[];
    },
    refetchInterval: 15000,
  });
  const updateStatus = useMutation({
    mutationFn: async ({ job, nextStatus }: { job: ManagedJob; nextStatus: "accepted" | "en_route" }) => {
      const result = await supabase.rpc("update_lpg_station_managed_driver_assignment_status", {
        target_assignment_id: job.id,
        target_status: nextStatus,
        target_idempotency_key: idempotencyKey("station-managed-driver-status", `${job.id}:${nextStatus}`),
        target_metadata: { source: "lpg.station_managed_driver.mobile" },
      });
      if (result.error) throw result.error;
      return nextStatus;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["station-managed-driver-jobs"] });
      await jobs.refetch();
    },
  });

  const refreshing = jobs.isRefetching;
  const activeJobs = (jobs.data ?? []).filter((job) => job.status !== "delivered");
  const refresh = () => void jobs.refetch();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: palette.canvas }}
      contentContainerStyle={styles.page}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={palette.brand} />}
    >
      <Screen
        eyebrow="STATION DRIVER"
        title="My deliveries"
        subtitle="Accept station-assigned LPG deliveries and update your progress. Delivery completion is confirmed through the station's normal safety and cylinder-verification process."
        action={<AppButton label="Account" size="sm" variant="ghost" onPress={() => router.push("/(station-driver)/account" as never)} />}
      >
        <View style={[styles.summary, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <BriefcaseBusiness color={palette.brand} size={22} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.summaryTitle, { color: palette.ink }]}>{activeJobs.length} active deliveries</Text>
            <Text style={[styles.muted, { color: palette.muted }]}>Pull down to refresh or wait for automatic updates.</Text>
          </View>
        </View>

        {jobs.isPending ? <Text style={[styles.muted, { color: palette.muted }]}>Loading your station deliveries…</Text> : null}
        {jobs.error ? (
          <EmptyState
            icon={<BriefcaseBusiness color={palette.brand} size={26} />}
            title="Deliveries unavailable"
            description={friendlyError(jobs.error, "We could not load your station assignments. Try again shortly.")}
            action={<AppButton label="Try again" variant="secondary" onPress={refresh} />}
          />
        ) : null}
        {jobs.data && jobs.data.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 color={palette.brand} size={26} />}
            title="No station deliveries assigned"
            description="When your station assigns a delivery to you, it will appear here. You do not need an independent-driver profile for Station Managed work."
          />
        ) : null}

        {(jobs.data ?? []).map((job) => {
          const busy = updateStatus.isPending && updateStatus.variables?.job.id === job.id;
          return (
            <View key={job.id} style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.orderRef, { color: palette.ink }]}>{job.publicReference || "Station delivery"}</Text>
                  <Text style={[styles.muted, { color: palette.muted }]}>{job.stationName}</Text>
                </View>
                <StatusPill label={statusLabel(job.status)} tone={job.status === "delivered" ? "success" : job.status === "en_route" ? "info" : "neutral"} />
              </View>
              <View style={styles.detailRow}>
                <Clock3 color={palette.muted} size={16} />
                <Text style={[styles.detailText, { color: palette.ink }]}>Assigned {formatDate(job.assignedAt)}</Text>
              </View>
              <View style={styles.detailRow}>
                <MapPin color={palette.muted} size={16} />
                <Text style={[styles.detailText, { color: palette.ink }]}>{job.deliveryAddress || "Delivery address will be confirmed with the station"}</Text>
              </View>
              {job.customerName ? (
                <View style={styles.detailRow}>
                  <UserRound color={palette.muted} size={16} />
                  <Text style={[styles.detailText, { color: palette.ink }]}>{job.customerName}</Text>
                </View>
              ) : null}
              {job.deliveryInstructions ? <Text style={[styles.instructions, { color: palette.muted }]}>{job.deliveryInstructions}</Text> : null}
              <View style={[styles.orderMeta, { borderTopColor: palette.border }]}>
                <Text style={[styles.metaText, { color: palette.ink }]}>{job.requestedKg} kg requested</Text>
                <Text style={[styles.metaText, { color: palette.ink }]}>{formatMoney(job.totalAmount, job.currencyCode)}</Text>
              </View>
              {job.status === "assigned" ? (
                <AppButton label="Accept delivery" isLoading={busy} disabled={updateStatus.isPending} onPress={() => updateStatus.mutate({ job, nextStatus: "accepted" })} />
              ) : null}
              {job.status === "accepted" ? (
                <AppButton label="Start delivery" isLoading={busy} disabled={updateStatus.isPending} onPress={() => updateStatus.mutate({ job, nextStatus: "en_route" })} />
              ) : null}
              {job.status === "en_route" ? (
                <View style={[styles.notice, { backgroundColor: palette.brandSofter }]}>
                  <Text style={[styles.noticeText, { color: palette.ink }]}>You are en route. Follow the station's delivery and cylinder verification process to complete this order.</Text>
                </View>
              ) : null}
              {job.status === "delivered" ? <Text style={[styles.muted, { color: palette.muted }]}>Delivery completion verified by the station.</Text> : null}
            </View>
          );
        })}
      </Screen>
    </ScrollView>
  );
}

function statusLabel(status: ManagedJob["status"]) {
  return status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
function formatMoney(amount: number, currency: string) {
  try { return new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount); }
  catch { return `${currency} ${amount.toLocaleString()}`; }
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, paddingBottom: 120, gap: spacing.md },
  summary: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: 1, borderRadius: radii.xl, padding: spacing.md },
  summaryTitle: { ...typography.body, fontWeight: "900" },
  muted: { ...typography.caption, marginTop: 3 },
  card: { borderWidth: 1, borderRadius: radii.xl, padding: spacing.md, gap: spacing.sm },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  orderRef: { ...typography.heading, fontSize: 17, fontWeight: "900" },
  detailRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  detailText: { ...typography.body, flex: 1, fontSize: 13 },
  instructions: { ...typography.caption, lineHeight: 19 },
  orderMeta: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.sm, flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  metaText: { ...typography.body, fontWeight: "800" },
  notice: { padding: spacing.md, borderRadius: radii.md },
  noticeText: { ...typography.caption, lineHeight: 19, fontWeight: "700" },
});
