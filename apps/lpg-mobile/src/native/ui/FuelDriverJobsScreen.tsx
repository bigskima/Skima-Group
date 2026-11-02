import { router } from "expo-router";
import { CheckCircle2, Fuel, Package, RotateCcw, Truck } from "lucide-react-native";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useState } from "react";

import { useGatewayMutation, useGatewayQuery } from "../api/gateway";
import { ActionResponseSchema, RecordArraySchema, firstNumber, firstString } from "../api/records";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { idempotencyKey } from "../utilities/idempotency";
import { AppButton } from "./AppButton";
import { Card } from "./Card";
import { EmptyState } from "./EmptyState";
import { Screen } from "./Screen";
import { StatusPill } from "./StatusPill";

export function FuelDriverJobsScreen() {
  const { palette } = useAppTheme();
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const products = useGatewayQuery({
    key: ["fuel", "products"],
    path: "/runtime/fuel/products",
    schema: RecordArraySchema,
    refetchInterval: 60000,
  });
  const productNameForKey = (key: string) =>
    firstString((products.data ?? []).find((item) => firstString(item, ["key"]) === key), ["display_name"]) || key || "Fuel";

  const orders = useGatewayQuery({
    key: ["fuel", "driver", "orders"],
    path: "/runtime/fuel/orders/operations?scope=driver",
    schema: RecordArraySchema,
    refetchInterval: 12000,
  });
  const allocations = useGatewayQuery({
    key: ["fuel", "driver", "allocations", selectedOrderId],
    path: "/runtime/fuel/container-allocations",
    schema: RecordArraySchema,
    enabled: Boolean(selectedOrderId),
    refetchInterval: 10000,
  });
  const confirmDelivery = useGatewayMutation({
    path: "/runtime/fuel/orders/confirm-delivery",
    schema: ActionResponseSchema,
    invalidate: [["fuel", "driver", "orders"], ["fuel", "orders"]],
  });
  const confirmRentalReturn = useGatewayMutation({
    path: "/runtime/fuel/orders/confirm-rental-return",
    schema: ActionResponseSchema,
    invalidate: [["fuel", "driver", "orders"], ["fuel", "orders"], ["fuel", "driver", "allocations"]],
  });

  const records = orders.data ?? [];
  const selectedOrder = records.find((row) => firstString(row, ["order_id"]) === selectedOrderId) ?? null;
  const selectedAllocations = (allocations.data ?? []).filter((row) => firstString(row, ["order_id"]) === selectedOrderId);
  const isRental = firstString(selectedOrder, ["container_mode"]) === "rental";
  const currentStage = firstString(selectedOrder, ["stage_key"]) ?? "";
  const productKey = firstString(selectedOrder, ["product_key"]) ?? "fuel.pms";
  const productName = productNameForKey(productKey);
  const requestedLitres = firstNumber(selectedOrder, ["requested_litres"]) ?? 0;
  const fulfillmentMode = firstString(selectedOrder, ["fulfillment_mode"]) ?? "";
  const driverModeDescription = describeDriverMode(fulfillmentMode);
  const containerCount = firstNumber(selectedOrder, ["container_count"]) ?? 0;
  const withDriverCount = selectedAllocations.filter((row) => firstString(row, ["status"]) === "with_driver").length;

  const refresh = async () => {
    await Promise.allSettled([orders.refetch(), allocations.refetch()]);
  };

  const perform = async (orderId: string, action: () => Promise<void>, message: string) => {
    setBusyOrderId(orderId);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(message);
      await refresh();
    } catch (cause) {
      setError(friendlyError(cause, "SKIMA could not record this Fuel delivery step. Check the container status and try again."));
    } finally {
      setBusyOrderId(null);
    }
  };

  const completeCustomerHandover = async () => {
    if (!selectedOrder) return;
    await perform(selectedOrderId, async () => {
      // One server-side transaction validates all containers, records every
      // custody event, advances the order and settles completed purchase orders.
      // The driver does not scan each container or submit a second delivery step.
      await confirmDelivery.mutateAsync({
        orderId: selectedOrderId,
        idempotencyKey: idempotencyKey("fuel-order-customer-delivery", selectedOrderId),
        metadata: { customer_handover_confirmed: true, delivery_mode: firstString(selectedOrder, ["fulfillment_mode"]) },
      });
    }, isRental
      ? "Delivery confirmed once for the full order. The customer must now transfer the fuel and return every SKIMA rental container to you."
      : "Delivery confirmed once for the full order. The customer owns the purchased containers and this delivery is complete.");
  };

  const confirmCustomerReturn = async () => {
    if (!selectedOrder) return;
    await perform(selectedOrderId, async () => {
      await confirmRentalReturn.mutateAsync({
        orderId: selectedOrderId,
        action: "customer_returned_to_driver",
        idempotencyKey: idempotencyKey("fuel-order-customer-rental-return", selectedOrderId),
        metadata: { customer_return_confirmed: true },
      });
    }, "All rental containers were recorded as returned to you. Take the complete set back to the assigned station.");
  };

  const confirmStationReturn = async () => {
    if (!selectedOrder) return;
    await perform(selectedOrderId, async () => {
      await confirmRentalReturn.mutateAsync({
        orderId: selectedOrderId,
        action: "driver_returned_to_station",
        idempotencyKey: idempotencyKey("fuel-order-driver-rental-return", selectedOrderId),
        metadata: { station_return_confirmed: true },
      });
    }, "The complete rental-container return was recorded at the assigned station. The station team must inspect the containers before reuse.");
  };

  const actionForStage = () => {
    if (currentStage === "station_handover") {
      return (
        <Text style={[styles.muted, { color: palette.muted }]}>
          The station has recorded the full handover. Your delivery journey is starting automatically; wait for the order to show Out for Delivery.
        </Text>
      );
    }
    if (currentStage === "out_for_delivery") {
      return <AppButton label="Confirm customer delivery" fullWidth loading={busyOrderId === selectedOrderId || confirmDelivery.isPending} onPress={() => void completeCustomerHandover()} icon={<CheckCircle2 color="#FFFFFF" size={18} />} />;
    }
    if (currentStage === "return_due") {
      return <AppButton label="Confirm all rental containers received" fullWidth loading={busyOrderId === selectedOrderId || confirmRentalReturn.isPending} onPress={() => void confirmCustomerReturn()} icon={<RotateCcw color="#FFFFFF" size={18} />} />;
    }
    if (currentStage === "returned_to_driver") {
      return <AppButton label="Confirm all containers back at station" fullWidth loading={busyOrderId === selectedOrderId || confirmRentalReturn.isPending} onPress={() => void confirmStationReturn()} icon={<Package color="#FFFFFF" size={18} />} />;
    }
    return null;
  };

  return (
    <Screen
      eyebrow="SKIMA Fuel · Driver"
      title="Fuel delivery jobs"
      subtitle="Follow the instructions for your assigned fulfilment mode and current order stage. The app confirms all containers together when you complete a handover."
      action={<AppButton label="My LPG jobs" size="sm" variant="ghost" onPress={() => router.push("/(driver)/jobs" as never)} />}
    >
      {orders.isPending ? (
        <View style={styles.loading}><ActivityIndicator color={palette.brand} /><Text style={[styles.muted, { color: palette.muted }]}>Loading your assigned Fuel jobs…</Text></View>
      ) : orders.error ? (
        <EmptyState title="Fuel jobs couldn't be loaded" description="Refresh your driver workspace and try again." action={<AppButton label="Refresh" onPress={() => void refresh()} />} />
      ) : records.length === 0 ? (
        <EmptyState icon={<Fuel color={palette.brand} size={28} />} title="No Fuel jobs assigned" description="Only Fuel jobs assigned to your approved driver profile will appear here." action={<AppButton label="Refresh jobs" variant="secondary" onPress={() => void refresh()} />} />
      ) : (
        <>
          {error ? <Text accessibilityRole="alert" style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}
          {notice ? <Text style={[styles.notice, { color: palette.success }]}>{notice}</Text> : null}
          <Card title="Assigned Fuel jobs" description="The station assigns a vehicle and verifies your qualification for the exact fuel product and load.">
            <View style={styles.list}>
              {records.map((order) => {
                const orderId = firstString(order, ["order_id"]) ?? "";
                const productKey = firstString(order, ["product_key"]) ?? "fuel.pms";
                const product = productNameForKey(productKey);
                const stage = firstString(order, ["stage_key"]) ?? "unknown";
                const selected = orderId === selectedOrderId;
                const isRentalOrder = firstString(order, ["container_mode"]) === "rental";
                return (
                  <Pressable key={orderId} onPress={() => { setSelectedOrderId(orderId); void allocations.refetch(); }} style={[styles.jobRow, { borderColor: selected ? palette.brand : palette.border, backgroundColor: selected ? palette.brandSoft : palette.surface }]}>
                    <View style={[styles.icon, { backgroundColor: selected ? palette.brand : palette.surfaceSubtle }]}><Fuel color={selected ? "#FFFFFF" : palette.brand} size={20} /></View>
                    <View style={styles.jobCopy}>
                      <Text style={[styles.jobTitle, { color: palette.ink }]}>{product} · {firstNumber(order, ["requested_litres"]) ?? 0} L</Text>
                      <Text style={[styles.muted, { color: palette.muted }]}>{modeLabel(firstString(order, ["fulfillment_mode"]) ?? "")} · {isRentalOrder ? "Rental containers" : "Purchased containers"} · {orderId.slice(0, 8).toUpperCase()}</Text>
                    </View>
                    <StatusPill label={humanize(stage)} tone={stageTone(stage)} />
                  </Pressable>
                );
              })}
            </View>
          </Card>

          {selectedOrder ? (
            <Card title={productName + " delivery"} description={stageDescription(currentStage, isRental)}>
              <View style={[styles.returnCard, { backgroundColor: palette.surfaceSubtle }]}>
                <Truck color={palette.brand} size={20} />
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={[styles.jobTitle, { color: palette.ink }]}>{modeLabel(fulfillmentMode)}</Text>
                  <Text style={[styles.muted, { color: palette.ink }]}>{driverModeDescription}</Text>
                </View>
              </View>
              <View style={styles.metrics}>
                <Metric label="Ordered" value={`${requestedLitres} L`} />
                <Metric label="Containers" value={String(firstNumber(selectedOrder, ["container_count"]) ?? 0)} />
                <Metric label="Type" value={isRental ? "Rental" : "Purchase"} />
              </View>
              {isRental ? (
                <View style={[styles.returnCard, { backgroundColor: palette.surfaceSubtle }]}>
                  <RotateCcw color={palette.brand} size={20} />
                  <Text style={[styles.muted, { color: palette.ink }]}>For a rental, the customer transfers the fuel and returns every SKIMA container to you. You must take the empty containers back to the same station.</Text>
                </View>
              ) : null}
              <View style={[styles.returnCard, { backgroundColor: palette.surfaceSubtle }]}>
                <Package color={palette.brand} size={20} />
                <Text style={[styles.muted, { color: palette.ink }]}>Container custody: {withDriverCount} of {containerCount} with you. The app records the full order handover together; you do not need to scan each container a second time.</Text>
              </View>
              {actionForStage()}
              {["delivered","inspection_passed","completed","exception"].includes(currentStage) ? (
                <Text style={[styles.muted, { color: palette.muted }]}>There is no further driver action for this order at the current stage.</Text>
              ) : null}
              {allocations.isPending ? <View style={styles.loadingSmall}><ActivityIndicator color={palette.brand} /></View> : null}
              {allocations.error ? <Text style={[styles.muted, { color: palette.muted }]}>Container custody details could not be refreshed.</Text> : null}
            </Card>
          ) : null}
          <AppButton label="Refresh Fuel jobs" variant="secondary" fullWidth onPress={() => void refresh()} />
        </>
      )}
    </Screen>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  const { palette } = useAppTheme();
  return <View style={styles.metric}><Text style={[styles.metricValue, { color: palette.ink }]}>{value}</Text><Text style={[styles.muted, { color: palette.muted }]}>{label}</Text></View>;
}

function humanize(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function stageTone(stage: string): "neutral" | "brand" | "success" | "warning" | "danger" {
  if (["completed","inspection_passed"].includes(stage)) return "success";
  if (["exception","cancelled"].includes(stage)) return "danger";
  if (["delivered","return_due","returned_to_driver","received_at_station"].includes(stage)) return "warning";
  return "brand";
}

function stageDescription(stage: string, rental: boolean): string {
  const descriptions: Record<string,string> = {
    driver_assigned: "CURRENT STEP — Meet the station team. Verify the product, ordered litres, order reference and the assigned vehicle. Wait until the station physically hands over every filled container. Do not leave before custody is recorded.",
    station_handover: "The station recorded the complete handover. SKIMA is starting the delivery leg automatically; no second departure confirmation is needed.",
    out_for_delivery: "CURRENT STEP — Take the assigned containers to the customer's delivery address. Let the customer check the fuel and confirm the delivered quantity. Then tap Confirm customer delivery once for the entire order. No second scan per container is required.",
    delivered: rental ? "DELIVERY CONFIRMED — The customer must transfer the fuel into their own container(s), then return every empty SKIMA rental container to you." : "DELIVERY CONFIRMED — The customer owns the purchased containers. There is no further driver action.",
    return_due: "CURRENT STEP — Wait for the customer to transfer the fuel and return the full set of empty SKIMA rental containers. Count the containers, then confirm the return once for the whole order.",
    returned_to_driver: "CURRENT STEP — You have received the complete set of rental containers from the customer. Take all of them back to the same station shown on the order and hand them to station staff.",
    received_at_station: "STATION RETURN RECORDED — The station team is responsible for inspection. Do not reuse or release these containers until inspection is passed.",
    inspection_passed: "RETURN INSPECTION PASSED — The station has confirmed the rental containers are safe to reuse. No further driver action is required.",
    completed: "ORDER COMPLETE — There is no further driver action for this order.",
    exception: "ORDER ON HOLD — Do not continue handover or delivery. Contact the station operator or SKIMA Dispatch and follow their resolution instructions.",
  };
  return descriptions[stage] ?? "Wait for the station or SKIMA Dispatch to update the order. Follow only the instruction for the current stage.";
}

function modeLabel(mode: string): string {
  switch (mode) {
    case "station_managed": return "Station Managed";
    case "independent_driver": return "Independent Managed";
    case "skima_managed": return "SKIMA Managed / SKIMA Fleet";
    default: return "Mode not assigned";
  }
}

function describeDriverMode(mode: string): string {
  switch (mode) {
    case "station_managed":
      return "You are the station's own registered driver. The station branch controls your assignment and hands over the filled containers to you.";
    case "independent_driver":
      return "You are an Independent Managed provider, not a station employee and not a SKIMA staff driver. Use your own approved vehicle linked to your independent provider profile.";
    case "skima_managed":
      return "You are assigned through SKIMA Managed / SKIMA Fleet as an internal SKIMA driver. Use only your assigned SKIMA-owned fleet vehicle; this is not Station Managed or Independent Managed delivery.";
    default:
      return "Your driver fulfilment mode is not resolved. Contact SKIMA Dispatch before accepting the order.";
  }
}

const styles = StyleSheet.create({
  loading: { minHeight: 180, alignItems: "center", justifyContent: "center", gap: spacing.md },
  loadingSmall: { minHeight: 36, alignItems: "center", justifyContent: "center" },
  muted: { ...typography.caption, fontSize: 11, lineHeight: 17 },
  error: { ...typography.caption, fontWeight: "800" },
  notice: { ...typography.caption, fontWeight: "800" },
  list: { gap: spacing.sm },
  jobRow: { borderWidth: 1, borderRadius: radii.lg, padding: 11, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  icon: { width: 40, height: 40, borderRadius: 13, justifyContent: "center", alignItems: "center" },
  jobCopy: { flex: 1, gap: 3 },
  jobTitle: { ...typography.bodyStrong, fontSize: 13 },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  metric: { flex: 1, gap: 4 },
  metricValue: { ...typography.sectionTitle, fontSize: 17 },
  returnCard: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: 11, borderRadius: radii.md },
});
