import { router } from "expo-router";
import { CheckCircle2, Fuel, MapPin, Package, RotateCcw, Truck } from "lucide-react-native";
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
  const changeStage = useGatewayMutation({
    path: "/runtime/fuel/orders/stage",
    schema: ActionResponseSchema,
    invalidate: [["fuel", "driver", "orders"], ["fuel", "orders"]],
  });
  const recordHandover = useGatewayMutation({
    path: "/runtime/fuel/containers/handover",
    schema: ActionResponseSchema,
    invalidate: [["fuel", "driver", "allocations"], ["fuel", "orders"]],
  });

  const records = orders.data ?? [];
  const selectedOrder = records.find((row) => firstString(row, ["order_id"]) === selectedOrderId) ?? null;
  const selectedAllocations = (allocations.data ?? []).filter((row) => firstString(row, ["order_id"]) === selectedOrderId);
  const isRental = firstString(selectedOrder, ["container_mode"]) === "rental";
  const currentStage = firstString(selectedOrder, ["stage_key"]) ?? "";
  const productKey = firstString(selectedOrder, ["product_key"]) ?? "fuel.pms";
  const productName = productKey === "fuel.pms" ? "Petrol" : productKey === "fuel.ago" ? "Diesel" : "Kerosene";
  const requestedLitres = firstNumber(selectedOrder, ["requested_litres"]) ?? 0;

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

  const startDelivery = async () => {
    if (!selectedOrder) return;
    await perform(selectedOrderId, async () => {
      await changeStage.mutateAsync({
        orderId: selectedOrderId,
        stageKey: "out_for_delivery",
        idempotencyKey: idempotencyKey("fuel-driver-out-for-delivery", selectedOrderId),
        metadata: { driver_confirmation: "started_delivery" },
      });
    }, "Fuel delivery has started. Keep the order's containers with you until customer handover.");
  };

  const completeCustomerHandover = async () => {
    if (!selectedOrder) return;
    await perform(selectedOrderId, async () => {
      const rows = (await allocations.refetch()).data?.filter((row) =>
        firstString(row, ["order_id"]) === selectedOrderId
      ) ?? [];
      const withDriver = rows.filter((row) => firstString(row, ["status"]) === "with_driver");
      const expected = firstNumber(selectedOrder, ["container_count"]) ?? 0;
      if (withDriver.length !== expected) {
        throw new Error(`The station handed over ${withDriver.length} of ${expected} required containers to you.`);
      }

      let deliveredLitres = 0;
      for (const allocation of withDriver) {
        const allocationId = firstString(allocation, ["id"]);
        const profileId = firstString(allocation, ["container_profile_id"]);
        const litres = firstNumber(allocation, ["filled_litres"]) ?? firstNumber(allocation, ["allocated_litres"]) ?? 0;
        if (!allocationId || litres <= 0) throw new Error("A filled container is missing its measured litre value.");
        await recordHandover.mutateAsync({
          allocationId,
          eventKey: "delivered_to_customer",
          measuredLitres: litres,
          note: "Fuel delivered and quantity confirmed with customer",
          idempotencyKey: idempotencyKey("fuel-container-delivered", `${selectedOrderId}:${profileId ?? allocationId}`),
          metadata: { customer_handover_confirmed: true },
        });
        deliveredLitres += litres;
      }
      if (Math.abs(deliveredLitres-requestedLitres)>0.001) {
        throw new Error("Measured container litres do not match the ordered Fuel quantity. Please report this discrepancy to the station.");
      }
      await changeStage.mutateAsync({
        orderId: selectedOrderId,
        stageKey: "delivered",
        deliveredLitres,
        idempotencyKey: idempotencyKey("fuel-driver-delivered", selectedOrderId),
        metadata: { delivered_litres: deliveredLitres, customer_handover_confirmed: true },
      });
      if (isRental) {
        await changeStage.mutateAsync({
          orderId: selectedOrderId,
          stageKey: "return_due",
          idempotencyKey: idempotencyKey("fuel-driver-return-due", selectedOrderId),
          metadata: { rental_container_return_required: true },
        });
      }
    }, isRental
      ? "Fuel delivery is confirmed. The customer must transfer the fuel and return the SKIMA containers to you."
      : "Fuel delivery is confirmed. Purchased container ownership has transferred to the customer.");
  };

  const confirmRentalReturn = async () => {
    if (!selectedOrder) return;
    await perform(selectedOrderId, async () => {
      const rows = (await allocations.refetch()).data?.filter((row) =>
        firstString(row, ["order_id"]) === selectedOrderId
      ) ?? [];
      const delivered = rows.filter((row) => firstString(row, ["status"]) === "delivered");
      const expected = firstNumber(selectedOrder, ["container_count"]) ?? 0;
      if (delivered.length !== expected) throw new Error("Not all rental containers have a delivered customer handover.");

      for (const allocation of delivered) {
        const allocationId = firstString(allocation, ["id"]);
        const profileId = firstString(allocation, ["container_profile_id"]);
        if (!allocationId) continue;
        await recordHandover.mutateAsync({
          allocationId,
          eventKey: "returned_to_driver",
          note: "Customer returned the empty SKIMA rental container after transferring fuel",
          idempotencyKey: idempotencyKey("fuel-container-returned-to-driver", allocationId),
          metadata: { customer_return_confirmed: true },
        });
      }

      await changeStage.mutateAsync({
        orderId: selectedOrderId,
        stageKey: "returned_to_driver",
        idempotencyKey: idempotencyKey("fuel-stage-returned-to-driver", selectedOrderId),
        metadata: { all_rental_containers_received: true },
      });
    }, "All rental containers have been returned to you. Take them back to the assigned station.");
  };

  const confirmStationReturn = async () => {
    if (!selectedOrder) return;
    await perform(selectedOrderId, async () => {
      const rows = (await allocations.refetch()).data?.filter((row) =>
        firstString(row, ["order_id"]) === selectedOrderId
      ) ?? [];
      const returned = rows.filter((row) => firstString(row, ["status"]) === "returned_to_driver");
      const expected = firstNumber(selectedOrder, ["container_count"]) ?? 0;
      if (returned.length !== expected) throw new Error("All rented containers must be received from the customer before station return.");

      for (const allocation of returned) {
        const allocationId = firstString(allocation, ["id"]);
        if (!allocationId) continue;
        await recordHandover.mutateAsync({
          allocationId,
          eventKey: "received_at_station",
          note: "Returned SKIMA rental container received at its assigned station",
          idempotencyKey: idempotencyKey("fuel-container-received-at-station", allocationId),
          metadata: { station_return_confirmed: true },
        });
      }

      await changeStage.mutateAsync({
        orderId: selectedOrderId,
        stageKey: "received_at_station",
        idempotencyKey: idempotencyKey("fuel-stage-received-at-station", selectedOrderId),
        metadata: { all_rental_containers_returned_to_station: true },
      });
    }, "Rental containers are back at the station. The station team must inspect each one before it can be reused.");
  };

  const actionForStage = () => {
    if (currentStage === "station_handover") {
      return <AppButton label="Start fuel delivery" fullWidth loading={busyOrderId === selectedOrderId || changeStage.isPending} onPress={() => void startDelivery()} icon={<Truck color="#FFFFFF" size={18} />} />;
    }
    if (currentStage === "out_for_delivery") {
      return <AppButton label="Confirm customer delivery" fullWidth loading={busyOrderId === selectedOrderId || recordHandover.isPending || changeStage.isPending} onPress={() => void completeCustomerHandover()} icon={<CheckCircle2 color="#FFFFFF" size={18} />} />;
    }
    if (currentStage === "return_due") {
      return <AppButton label="Confirm customer returned rental containers" fullWidth loading={busyOrderId === selectedOrderId || recordHandover.isPending} onPress={() => void confirmRentalReturn()} icon={<RotateCcw color="#FFFFFF" size={18} />} />;
    }
    if (currentStage === "returned_to_driver") {
      return <AppButton label="Confirm containers returned to station" fullWidth loading={busyOrderId === selectedOrderId || recordHandover.isPending} onPress={() => void confirmStationReturn()} icon={<Package color="#FFFFFF" size={18} />} />;
    }
    return null;
  };

  return (
    <Screen
      eyebrow="SKIMA Fuel · Driver"
      title="Fuel delivery jobs"
      subtitle="Deliver filled containers, confirm measured litres and return SKIMA rental containers to the station."
      action={<AppButton label="My LPG jobs" size="sm" variant="ghost" onPress={() => router.push("/(driver)/jobs" as never)} />}
    >
      {orders.isPending ? (
        <View style={styles.loading}><ActivityIndicator color={palette.brand} /><Text style={[styles.muted, { color: palette.muted }]}>Loading your assigned Fuel jobs…</Text></View>
      ) : orders.error ? (
        <EmptyState title="Fuel jobs couldn't be loaded" description="Refresh your driver workspace and try again." action={<AppButton label="Refresh" onPress={() => void refresh()} />} />
      ) : records.length === 0 ? (
        <EmptyState icon={<Fuel color={palette.brand} size={28} />} title="No Fuel jobs assigned" description="Only petrol, diesel or kerosene jobs assigned to your approved driver profile will appear here." action={<AppButton label="Refresh jobs" variant="secondary" onPress={() => void refresh()} />} />
      ) : (
        <>
          {error ? <Text accessibilityRole="alert" style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}
          {notice ? <Text style={[styles.notice, { color: palette.success }]}>{notice}</Text> : null}
          <Card title="Assigned Fuel jobs" description="The station assigns a vehicle and verifies your qualification for the exact fuel product and load.">
            <View style={styles.list}>
              {records.map((order) => {
                const orderId = firstString(order, ["order_id"]) ?? "";
                const productKey = firstString(order, ["product_key"]) ?? "fuel.pms";
                const product = productKey === "fuel.pms" ? "Petrol" : productKey === "fuel.ago" ? "Diesel" : "Kerosene";
                const stage = firstString(order, ["stage_key"]) ?? "unknown";
                const selected = orderId === selectedOrderId;
                const isRentalOrder = firstString(order, ["container_mode"]) === "rental";
                return (
                  <Pressable key={orderId} onPress={() => { setSelectedOrderId(orderId); void allocations.refetch(); }} style={[styles.jobRow, { borderColor: selected ? palette.brand : palette.border, backgroundColor: selected ? palette.brandSoft : palette.surface }]}>
                    <View style={[styles.icon, { backgroundColor: selected ? palette.brand : palette.surfaceSubtle }]}><Fuel color={selected ? "#FFFFFF" : palette.brand} size={20} /></View>
                    <View style={styles.jobCopy}>
                      <Text style={[styles.jobTitle, { color: palette.ink }]}>{product} · {firstNumber(order, ["requested_litres"]) ?? 0} L</Text>
                      <Text style={[styles.muted, { color: palette.muted }]}>{isRentalOrder ? "Rental container return required" : "Purchased container"} · {orderId.slice(0, 8).toUpperCase()}</Text>
                    </View>
                    <StatusPill label={humanize(stage)} tone={stageTone(stage)} />
                  </Pressable>
                );
              })}
            </View>
          </Card>

          {selectedOrder ? (
            <Card title={productName + " delivery"} description={stageDescription(currentStage, isRental)}>
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
    driver_assigned: "You have been assigned to this Fuel order. The station must hand the prepared containers to you before departure.",
    station_handover: "The station has handed the filled containers to you. Confirm departure to start the delivery.",
    out_for_delivery: "The customer delivery is in progress. Confirm all container handovers and the measured litres at the destination.",
    delivered: rental ? "Delivery is confirmed. The customer needs to transfer the fuel and return all SKIMA containers." : "Delivery is confirmed. The purchased container now belongs to the customer.",
    return_due: "Wait for the customer to transfer the fuel and return every SKIMA rental container to you.",
    returned_to_driver: "You have received the empty rental containers. Return them to the assigned station.",
    received_at_station: "The station has received the containers. The station team must inspect them before they re-enter service.",
    completed: "This Fuel order is complete.",
    exception: "This Fuel order is under operational review. Contact station support before taking further action.",
  };
  return descriptions[stage] ?? "Follow the station handover and customer delivery instructions for this order.";
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
