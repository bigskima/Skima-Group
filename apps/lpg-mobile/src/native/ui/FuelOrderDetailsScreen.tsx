import { router, useLocalSearchParams } from "expo-router";
import { CheckCircle2, Fuel, Package, RotateCcw, ShieldCheck, Truck } from "lucide-react-native";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { useGatewayMutation, useGatewayQuery } from "../api/gateway";
import { ActionResponseSchema } from "../api/records";
import { RecordArraySchema, firstNumber, firstString } from "../api/records";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";
import { AppButton } from "./AppButton";
import { Card } from "./Card";
import { EmptyState } from "./EmptyState";
import { Screen } from "./Screen";
import { StatusPill } from "./StatusPill";

export function FuelOrderDetailsScreen() {
  const { palette } = useAppTheme();
  const params = useLocalSearchParams<{ id?: string }>();
  const orderId = typeof params.id === "string" ? params.id : "";
  const operations = useGatewayQuery({
    key: ["fuel", "order", orderId],
    path: `/runtime/fuel/orders/operations?orderId=${encodeURIComponent(orderId)}`,
    schema: RecordArraySchema,
    enabled: Boolean(orderId),
    refetchInterval: 12000,
  });
  const events = useGatewayQuery({
    key: ["fuel", "order", orderId, "events"],
    path: `/runtime/fuel/orders/events?orderId=${encodeURIComponent(orderId)}`,
    schema: RecordArraySchema,
    enabled: Boolean(orderId),
    refetchInterval: 12000,
  });
  const completeOrder = useGatewayMutation({
    path: "/runtime/fuel/orders/stage",
    schema: ActionResponseSchema,
    invalidate: [["fuel", "orders"], ["fuel", "order", orderId], ["orders"]],
  });

  const order = operations.data?.[0] ?? null;
  const productKey = firstString(order, ["product_key"]) ?? "fuel.pms";
  const product = productKey === "fuel.pms" ? "Petrol" : productKey === "fuel.ago" ? "Diesel" : "Kerosene";
  const stage = firstString(order, ["stage_key"]) ?? "awaiting_station_acceptance";
  const litres = firstNumber(order, ["requested_litres"]) ?? 0;
  const filled = firstNumber(order, ["filled_litres"]) ?? 0;
  const delivered = firstNumber(order, ["delivered_litres"]) ?? 0;
  const count = firstNumber(order, ["container_count"]) ?? 0;
  const isRental = firstString(order, ["container_mode"]) === "rental";
  const fulfillment = firstString(order, ["fulfillment_mode"]) ?? "independent_driver";
  const rentalReturnPending = isRental && ["delivered", "return_due", "returned_to_driver", "received_at_station", "inspection"].includes(stage);

  return (
    <Screen
      eyebrow="Fuel order"
      title={product + " delivery"}
      subtitle={orderId ? `Order reference ${orderId.slice(0, 8).toUpperCase()}` : "Your Fuel delivery"}
      action={<AppButton label="Back" size="sm" variant="ghost" onPress={() => router.back()} />}
    >
      {operations.isPending ? (
        <View style={styles.loading}>
          <ActivityIndicator color={palette.brand} />
          <Text style={[styles.muted, { color: palette.muted }]}>Loading your Fuel order…</Text>
        </View>
      ) : operations.error || !order ? (
        <EmptyState
          title="This Fuel order is not available"
          description="Return to your fuel orders and refresh the list."
          action={<AppButton label="My fuel orders" onPress={() => router.replace("/(customer)/fuel-orders" as never)} />}
        />
      ) : (
        <>
          <Card title="Current progress" description={stageDescription(stage)}>
            <View style={styles.statusLine}>
              <StatusPill label={humanize(stage)} tone={stageTone(stage)} />
              <Text style={[styles.muted, { color: palette.muted }]}>{humanize(fulfillment)}</Text>
            </View>
            <View style={styles.metrics}>
              <Metric label="Ordered" value={`${litres} L`} />
              <Metric label="Filled" value={`${filled} L`} />
              <Metric label="Delivered" value={`${delivered} L`} />
            </View>
            <View style={[styles.progressTrack, { backgroundColor: palette.soft }]}>
              <View style={[styles.progressFill, { width: `${Math.max(0, Math.min(100, litres > 0 ? delivered / litres * 100 : 0))}%`, backgroundColor: palette.brand }]} />
            </View>
            <Text style={[styles.muted, { color: palette.muted }]}>{count} delivery container(s) · {isRental ? "SKIMA rental" : "Purchased container"}</Text>
          </Card>

          {rentalReturnPending ? (
            <Card variant="warning" title="Return your SKIMA container" description="After transferring the fuel, give the empty rental container back to the same driver. The container will remain out of circulation until the station receives and inspects it.">
              <View style={styles.returnNotice}>
                <RotateCcw color={palette.warning} size={22} />
                <Text style={[styles.returnText, { color: palette.ink }]}>Please return all {count} rental container(s) to the driver before the job is closed.</Text>
              </View>
            </Card>
          ) : null}

          <Card title="Order details">
            <DetailRow icon={<Fuel color={palette.brand} size={18} />} label="Fuel product" value={product} />
            <DetailRow icon={<Package color={palette.brand} size={18} />} label="Container option" value={isRental ? "Rent — return after transfer" : "Buy — keep after delivery"} />
            <DetailRow icon={<Truck color={palette.brand} size={18} />} label="Fulfilment" value={humanize(fulfillment)} />
            <DetailRow icon={<ShieldCheck color={palette.brand} size={18} />} label="Payment protection" value="Wallet funds held in SKIMA escrow" />
          </Card>

          <Card title="Activity history" description="The operational history is recorded as the station and driver complete each verified step.">
            {events.isPending ? (
              <View style={styles.loadingSmall}><ActivityIndicator color={palette.brand} /></View>
            ) : events.error ? (
              <Text style={[styles.muted, { color: palette.muted }]}>The activity history could not be refreshed.</Text>
            ) : (events.data ?? []).length === 0 ? (
              <Text style={[styles.muted, { color: palette.muted }]}>The station has not recorded an operational update yet.</Text>
            ) : (
              <View style={styles.timeline}>
                {(events.data ?? []).map((event, index) => {
                  const toStage = firstString(event, ["to_stage"]) ?? "updated";
                  const reason = firstString(event, ["reason"]);
                  const occurredAt = firstString(event, ["occurred_at", "created_at"]);
                  return (
                    <View key={firstString(event, ["id"]) ?? String(index)} style={styles.timelineRow}>
                      <View style={styles.timelineMark}>
                        <View style={[styles.timelineDot, { backgroundColor: index === (events.data?.length ?? 1) - 1 ? palette.brand : palette.success }]} />
                        {index < (events.data?.length ?? 1) - 1 ? <View style={[styles.timelineStem, { backgroundColor: palette.border }]} /> : null}
                      </View>
                      <View style={styles.timelineCopy}>
                        <Text style={[styles.timelineTitle, { color: palette.ink }]}>{humanize(toStage)}</Text>
                        {reason ? <Text style={[styles.muted, { color: palette.muted }]}>{reason}</Text> : null}
                        {occurredAt ? <Text style={[styles.time, { color: palette.muted }]}>{formatDate(occurredAt)}</Text> : null}
                      </View>
                      {index === (events.data?.length ?? 1) - 1 ? <CheckCircle2 color={palette.success} size={17} /> : null}
                    </View>
                  );
                })}
              </View>
            )}
          </Card>
          {((isRental && stage === "inspection_passed") || (!isRental && stage === "delivered")) ? (
            <Card title="Confirm order completion" description={isRental ? "The returned rental container has passed station inspection. Confirm that this order can now be closed." : "Your purchased container and measured fuel have been delivered. Confirm that your order is complete."}>
              <AppButton
                label="Confirm fuel order completed"
                fullWidth
                loading={completeOrder.isPending}
                onPress={() => void completeOrder.mutateAsync({
                  orderId,
                  stageKey: "completed",
                  idempotencyKey: `fuel-customer-complete:${orderId}`,
                  metadata: { customer_confirmed_completion: true },
                }).then(() => Promise.all([operations.refetch(), events.refetch()]))}
              />
            </Card>
          ) : null}
          <AppButton label="Refresh order" variant="secondary" fullWidth onPress={() => void Promise.all([operations.refetch(), events.refetch()])} />
          <AppButton label="View all fuel orders" variant="ghost" fullWidth onPress={() => router.replace("/(customer)/fuel-orders" as never)} />
        </>
      )}
    </Screen>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  const { palette } = useAppTheme();
  return (
    <View style={styles.metric}>
      <Text style={[styles.metricValue, { color: palette.ink }]}>{value}</Text>
      <Text style={[styles.muted, { color: palette.muted }]}>{label}</Text>
    </View>
  );
}

function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  const { palette } = useAppTheme();
  return (
    <View style={styles.detailRow}>
      {icon}
      <Text style={[styles.muted, { color: palette.muted }]}>{label}</Text>
      <Text style={[styles.detailValue, { color: palette.ink }]}>{value}</Text>
    </View>
  );
}

function humanize(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function stageDescription(stage: string): string {
  const descriptions: Record<string, string> = {
    awaiting_station_acceptance: "Your payment is reserved. The selected station needs to accept and prepare the order.",
    stock_reserved: "The station has reserved the ordered litres from its available fuel stock.",
    station_filling: "Your fuel is being measured and filled into the assigned container(s).",
    ready_for_driver: "The full quantity and all containers are ready for driver handover.",
    driver_assigned: "An approved driver and vehicle have been assigned to your delivery.",
    station_handover: "The station has handed the filled container(s) to your driver.",
    out_for_delivery: "Your fuel delivery is on the way.",
    delivered: "The driver has confirmed delivery of the measured fuel quantity.",
    return_due: "The rental container is due back to the driver.",
    returned_to_driver: "The driver has received your returned rental container.",
    received_at_station: "The station has received the rental container for inspection.",
    inspection_passed: "The returned rental container passed inspection.",
    completed: "Your Fuel order is complete.",
    cancelled: "This Fuel order was cancelled.",
  };
  return descriptions[stage] ?? "SKIMA is updating the order status.";
}

function stageTone(stage: string): "neutral" | "brand" | "success" | "warning" | "danger" {
  if (["completed", "inspection_passed"].includes(stage)) return "success";
  if (["cancelled", "failed", "exception"].includes(stage)) return "danger";
  if (["delivered", "return_due", "returned_to_driver", "received_at_station"].includes(stage)) return "warning";
  return "brand";
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

const styles = StyleSheet.create({
  loading: { minHeight: 180, alignItems: "center", justifyContent: "center", gap: spacing.md },
  loadingSmall: { padding: spacing.md, alignItems: "center" },
  muted: { ...typography.caption, fontSize: 12, lineHeight: 17 },
  statusLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  metrics: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  metric: { flex: 1, gap: 4 },
  metricValue: { ...typography.sectionTitle, fontSize: 20 },
  progressTrack: { height: 7, borderRadius: 4, overflow: "hidden" },
  progressFill: { height: 7, borderRadius: 4 },
  returnNotice: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  returnText: { flex: 1, ...typography.bodyStrong, fontSize: 13 },
  detailRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 3 },
  detailValue: { marginLeft: "auto", maxWidth: "54%", textAlign: "right", ...typography.bodyStrong, fontSize: 12 },
  timeline: { gap: 0 },
  timelineRow: { minHeight: 58, flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  timelineMark: { width: 14, alignItems: "center", alignSelf: "stretch" },
  timelineDot: { width: 9, height: 9, borderRadius: 5, marginTop: 5 },
  timelineStem: { width: 2, flex: 1, marginTop: 3, marginBottom: -3 },
  timelineCopy: { flex: 1, gap: 2, paddingBottom: spacing.sm },
  timelineTitle: { ...typography.bodyStrong, fontSize: 13 },
  time: { ...typography.caption, fontSize: 10 },
});
