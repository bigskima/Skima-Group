import { router } from "expo-router";
import { Database, Gauge, PackageCheck, PlusCircle, ShieldCheck } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useStationRuntime } from "../api/domains";
import { useGatewayMutation } from "../api/gateway";
import {
  ActionResponseSchema,
  displayReference,
  displayStatus,
  firstNumber,
  nestedRecord,
  nestedRecords,
  recordId,
} from "../api/records";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { idempotencyKey } from "../utilities/idempotency";
import { AppButton } from "./AppButton";
import { EmptyState } from "./EmptyState";
import { Screen } from "./Screen";
import { ScreenSkeleton } from "./ScreenSkeleton";
import { SectionHeader } from "./SectionHeader";
import { StatusPill } from "./StatusPill";

export function StationInventoryScreen() {
  const session = useSession();
  const { palette } = useAppTheme();
  const canManage = Boolean(
    session.context?.platformAdmin ||
      session.context?.permissions.includes("lpg.stations.manage") ||
      session.context?.roles.some((role) => role.permissions.includes("lpg.stations.manage")),
  );
  const runtime = useStationRuntime();
  const branch = nestedRecord(runtime.data, "branch");
  const branchId = branch ? recordId(branch) : null;
  const orders = nestedRecords(runtime.data, "orders");
  const active = orders.filter((item) =>
    ["station_verified", "refill_in_progress", "refill_confirmed", "station_settled"].includes(
      displayStatus(item) ?? "",
    ),
  );
  const available = firstNumber(branch, ["currentAvailableKg", "current_available_kg"]);
  const capacity = firstNumber(branch, ["refillCapacityKg", "refill_capacity_kg"]);
  const remaining = capacity !== null && available !== null ? Math.max(0, capacity - available) : null;
  const stockPercent = capacity && available !== null ? Math.min(100, Math.max(0, (available / capacity) * 100)) : 0;
  const stockTone = stockPercent <= 20 ? "warning" : "success";
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [messageSuccess, setMessageSuccess] = useState(false);

  const mutation = useGatewayMutation({
    path: "/lpg/stations/capacity-adjustments",
    schema: ActionResponseSchema,
    invalidate: [["station-runtime"], ["stations"]],
  });

  const submit = async () => {
    const value = Number(amount);
    setMessage(null);
    if (!branchId || !Number.isFinite(value) || value <= 0 || (remaining !== null && value > remaining)) {
      setMessageSuccess(false);
      setMessage("Enter an amount that does not exceed the station's remaining capacity.");
      return;
    }

    try {
      await mutation.mutateAsync({
        stationBranchId: branchId,
        adjustmentKg: value,
        reasonKey: "lpg.capacity.replenishment",
        source: "skima.lpg.mobile",
        idempotencyKey: idempotencyKey("station-capacity-replenishment", branchId),
      });
      setAmount("");
      setMessageSuccess(true);
      setMessage("Replenishment recorded successfully.");
    } catch (cause) {
      setMessageSuccess(false);
      setMessage(friendlyError(cause, "Station capacity could not be updated."));
    }
  };

  return (
    <Screen
      eyebrow="Station operations"
      title="LPG stock"
      subtitle="See available LPG, cylinders at the station and record new stock."
      action={<AppButton label="Back" variant="ghost" size="sm" onPress={() => router.back()} />}
    >
      {runtime.isPending ? (
        <ScreenSkeleton cards={3} />
      ) : runtime.error ? (
        <EmptyState
          icon={<Database color={palette.brand} size={26} />}
          title="Inventory could not be loaded"
          description="Check your connection and try again."
          action={<AppButton label="Retry" onPress={() => void runtime.refetch()} />}
        />
      ) : (
        <>
          <View style={[styles.hero, shadows.raised, { backgroundColor: palette.brand }]}>
            <View style={styles.heroTop}>
              <View style={styles.heroCopy}>
                <Text style={styles.heroEyebrow}>AVAILABLE REFILL STOCK</Text>
                <Text adjustsFontSizeToFit numberOfLines={1} style={styles.heroValue}>{available ?? "—"} kg</Text>
                <Text style={styles.heroBody}>of {capacity ?? "unset"} kg total capacity</Text>
              </View>
              <View style={styles.heroIcon}><Gauge color="#FFFFFF" size={27} /></View>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${stockPercent}%` }]} />
            </View>
            <View style={styles.heroFooter}>
              <Text style={styles.heroFooterText}>{capacity === null ? "Total capacity has not been set" : `${stockPercent.toFixed(0)}% currently available`}</Text>
              {capacity !== null ? <View style={styles.heroBadge}><Text style={styles.heroBadgeText}>{remaining ?? 0} kg room</Text></View> : null}
            </View>
          </View>

          {capacity !== null && stockPercent <= 20 ? (
            <View style={[styles.warning, { backgroundColor: palette.warningSoft }]}>
              <Gauge color={palette.warning} size={20} />
              <View style={styles.warningCopy}>
                <Text style={[styles.warningTitle, { color: palette.ink }]}>Stock is running low</Text>
                <Text style={[styles.warningBody, { color: palette.muted }]}>Available LPG is at or below 20% of the station's total capacity.</Text>
              </View>
              <StatusPill label="Low stock" tone="warning" />
            </View>
          ) : null}

          <View style={styles.metricGrid}>
            <Metric label="Available" value={available === null ? "—" : `${available} kg`} />
            <Metric label="Capacity" value={capacity === null ? "—" : `${capacity} kg`} />
            <Metric label="At station" value={String(active.length)} />
          </View>

          <SectionHeader
            title="Cylinders at station"
            description="Only cylinders that have arrived for an active order are shown here."
          />

          <View style={styles.list}>
            {active.length ? (
              active.map((order, index) => {
                const cylinder = nestedRecord(order, "cylinder");
                const status = displayStatus(order) ?? "active";
                return (
                  <View
                    key={recordId(order) ?? String(index)}
                    style={[styles.cylinderCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}
                  >
                    <View style={[styles.cylinderIcon, { backgroundColor: palette.brandSoft }]}>
                      <PackageCheck color={palette.brand} size={22} />
                    </View>
                    <View style={styles.cylinderCopy}>
                      <Text style={[styles.cylinderTitle, { color: palette.ink }]}>
                        {cylinder ? displayReference(cylinder) : displayReference(order)}
                      </Text>
                      <Text style={[styles.cylinderMeta, { color: palette.muted }]}>
                        {cylinder ? `${firstNumber(cylinder, ["sizeKg", "size_kg"]) ?? "Configured"} kg cylinder` : "LPG cylinder"}
                      </Text>
                    </View>
                    <StatusPill label={friendlyStatus(status)} tone={status === "refill_confirmed" || status === "station_settled" ? "success" : "brand"} />
                  </View>
                );
              })
            ) : (
              <EmptyState
                icon={<PackageCheck color={palette.brand} size={26} />}
                title="No cylinders at station"
                description="Cylinders will appear here after their assigned driver arrives and checks in."
              />
            )}
          </View>

          {canManage && remaining !== null && remaining > 0 ? (
            <View style={[styles.adjustmentCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <View style={styles.adjustmentHead}>
                <View style={[styles.adjustmentIcon, { backgroundColor: palette.brandSoft }]}><PlusCircle color={palette.brand} size={22} /></View>
                <View style={styles.adjustmentCopy}>
                  <Text style={[styles.adjustmentTitle, { color: palette.ink }]}>Record replenishment</Text>
                  <Text style={[styles.adjustmentBody, { color: palette.muted }]}>Use this only when physical refill stock has actually been received at the station.</Text>
                </View>
              </View>
              <View style={styles.fieldGroup}>
                <Text style={[styles.fieldLabel, { color: palette.ink }]}>Kilograms received</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: palette.input, borderColor: palette.borderStrong, color: palette.ink }]}
                  value={amount}
                  onChangeText={setAmount}
                  keyboardType="decimal-pad"
                  placeholder={`Up to ${remaining} kg`}
                  placeholderTextColor={palette.muted}
                />
                <Text style={[styles.fieldHint, { color: palette.muted }]}>Remaining capacity: {remaining} kg.</Text>
              </View>
              <AppButton label="Record replenishment" fullWidth loading={mutation.isPending} onPress={() => void submit()} />
            </View>
          ) : !canManage ? (
            <View style={[styles.readOnly, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
              <ShieldCheck color={palette.mutedStrong} size={18} />
              <Text style={[styles.readOnlyText, { color: palette.muted }]}>You can view stock, but your team role does not allow stock updates.</Text>
            </View>
          ) : null}

          {message ? (
            <View style={[styles.message, { backgroundColor: messageSuccess ? palette.successSoft : palette.dangerSoft }]}>
              <Text style={[styles.messageText, { color: messageSuccess ? palette.success : palette.danger }]}>{message}</Text>
            </View>
          ) : null}
        </>
      )}
    </Screen>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  const { palette } = useAppTheme();
  return (
    <View style={[styles.metric, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <Text style={[styles.metricLabel, { color: palette.muted }]}>{label}</Text>
      <Text style={[styles.metricValue, { color: palette.ink }]}>{value}</Text>
    </View>
  );
}

function friendlyStatus(status: string) {
  const labels: Record<string, string> = {
    station_verified: "At station",
    refill_in_progress: "Refilling",
    refill_confirmed: "Refill complete",
    station_settled: "Station settled",
  };
  return labels[status] ?? status.replace(/[_-]/g, " ");
}

const styles = StyleSheet.create({
  hero: { gap: spacing.md, padding: spacing.lg, borderRadius: radii.xl },
  heroTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md },
  heroCopy: { flex: 1 },
  heroEyebrow: { color: "rgba(255,255,255,.72)", ...typography.eyebrow, fontSize: 9 },
  heroValue: { color: "#FFFFFF", fontSize: 38, lineHeight: 45, fontWeight: "900", letterSpacing: -1, marginTop: 4 },
  heroBody: { color: "rgba(255,255,255,.84)", ...typography.caption },
  heroIcon: { width: 50, height: 50, borderRadius: 17, backgroundColor: "rgba(255,255,255,.14)", alignItems: "center", justifyContent: "center" },
  progressTrack: { height: 8, borderRadius: 4, overflow: "hidden", backgroundColor: "rgba(70,0,10,.30)" },
  progressFill: { height: 8, backgroundColor: "#FFFFFF" },
  heroFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  heroFooterText: { color: "rgba(255,255,255,.82)", ...typography.caption },
  heroBadge: { backgroundColor: "rgba(255,255,255,.14)", paddingHorizontal: 10, paddingVertical: 5, borderRadius: radii.pill },
  heroBadgeText: { color: "#FFFFFF", ...typography.caption, fontWeight: "900" },
  warning: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderRadius: radii.lg, padding: spacing.md },
  warningCopy: { flex: 1, gap: 2 },
  warningTitle: { ...typography.bodyStrong, fontSize: 14 },
  warningBody: { ...typography.caption },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  metric: { flex: 1, minWidth: 95, gap: 4, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  metricLabel: { ...typography.caption },
  metricValue: { ...typography.heading, fontSize: 20 },
  list: { gap: spacing.sm },
  cylinderCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  cylinderIcon: { width: 46, height: 46, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  cylinderCopy: { flex: 1, gap: 3 },
  cylinderTitle: { ...typography.bodyStrong, fontSize: 14 },
  cylinderMeta: { ...typography.caption },
  adjustmentCard: { gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.lg },
  adjustmentHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  adjustmentIcon: { width: 46, height: 46, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  adjustmentCopy: { flex: 1, gap: 3 },
  adjustmentTitle: { ...typography.subheading },
  adjustmentBody: { ...typography.caption, lineHeight: 18 },
  fieldGroup: { gap: spacing.sm },
  fieldLabel: { ...typography.caption, fontSize: 13, fontWeight: "900" },
  input: { minHeight: 54, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.md, fontSize: 16 },
  fieldHint: { ...typography.caption },
  readOnly: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm + 2, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  readOnlyText: { flex: 1, ...typography.caption, lineHeight: 18 },
  message: { padding: spacing.md, borderRadius: radii.md },
  messageText: { ...typography.caption, fontWeight: "800", textAlign: "center" },
});