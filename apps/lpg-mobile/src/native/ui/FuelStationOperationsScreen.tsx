import { router } from "expo-router";
import { CheckCircle2, Fuel, Package, RefreshCw, ShieldCheck, Truck } from "lucide-react-native";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useMemo, useState } from "react";

import { domainQueries, useStationInventory } from "../api/domains";
import { useGatewayMutation, useGatewayQuery } from "../api/gateway";
import {
  ActionResponseSchema,
  RecordArraySchema,
  firstNumber,
  firstString,
  nestedRecord,
  type PlatformRecord,
} from "../api/records";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { idempotencyKey } from "../utilities/idempotency";
import { AppButton } from "./AppButton";
import { Card } from "./Card";
import { EmptyState } from "./EmptyState";
import { Screen } from "./Screen";
import { StatusPill } from "./StatusPill";

type FuelOperation = PlatformRecord & {
  order_id?: string;
  product_key?: string;
  station_branch_id?: string;
  requested_litres?: number;
  container_count?: number;
  container_mode?: string;
  container_type_id?: string;
  fulfillment_mode?: string;
  stage_key?: string;
};

export function FuelStationOperationsScreen() {
  const { palette } = useAppTheme();
  const stationInventory = useStationInventory();
  const station = nestedRecord(stationInventory.data, "station");
  const stationBranchId = firstString(station, ["stationBranchId", "station_branch_id", "branchId", "branch_id"]) ?? "";
  const organizationId = firstString(station, ["organizationId", "organization_id"]) ?? "";

  const operations = useGatewayQuery({
    key: ["fuel", "station", "operations", stationBranchId],
    path: `/runtime/fuel/orders/operations?branchId=${encodeURIComponent(stationBranchId)}`,
    schema: RecordArraySchema,
    enabled: Boolean(stationBranchId),
    refetchInterval: 12000,
  });
  const storage = useGatewayQuery({
    key: ["fuel", "station", "storage", stationBranchId],
    path: `/runtime/fuel/storage?branchId=${encodeURIComponent(stationBranchId)}`,
    schema: RecordArraySchema,
    enabled: Boolean(stationBranchId),
    refetchInterval: 20000,
  });
  const offers = useGatewayQuery({
    key: ["fuel", "station", "offers", stationBranchId],
    path: `/runtime/fuel/offers?branchId=${encodeURIComponent(stationBranchId)}`,
    schema: RecordArraySchema,
    enabled: Boolean(stationBranchId),
    refetchInterval: 30000,
  });
  const containerTypes = useGatewayQuery({
    key: ["fuel", "station", "container-types"],
    path: "/runtime/fuel/container-types",
    schema: RecordArraySchema,
    refetchInterval: 60000,
  });
  const containers = useGatewayQuery({
    key: ["fuel", "station", "containers", organizationId],
    path: "/runtime/fuel/containers",
    schema: RecordArraySchema,
    refetchInterval: 20000,
  });
  const qualifications = useGatewayQuery({
    key: ["fuel", "station", "qualifications", stationBranchId],
    path: `/runtime/fuel/driver-qualifications?branchId=${encodeURIComponent(stationBranchId)}`,
    schema: RecordArraySchema,
    enabled: Boolean(stationBranchId),
    refetchInterval: 30000,
  });
  const vehicles = domainQueries.vehicles();

  const [focusedOrderId, setFocusedOrderId] = useState("");
  const [selectedDriverQualificationId, setSelectedDriverQualificationId] = useState("");
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reservations = useGatewayQuery({
    key: ["fuel", "station", "reservations", focusedOrderId],
    path: `/runtime/fuel/orders/stock/reservations?orderId=${encodeURIComponent(focusedOrderId)}`,
    schema: RecordArraySchema,
    enabled: Boolean(focusedOrderId),
    refetchInterval: 10000,
  });
  const allocations = useGatewayQuery({
    key: ["fuel", "station", "allocations", focusedOrderId],
    path: "/runtime/fuel/container-allocations",
    schema: RecordArraySchema,
    enabled: Boolean(focusedOrderId),
    refetchInterval: 10000,
  });

  const reserveBatch = useGatewayMutation({
    path: "/runtime/fuel/orders/stock/reserve-for-order",
    schema: ActionResponseSchema,
    invalidate: [["fuel", "station", "storage"], ["fuel", "station", "operations"]],
  });
  const changeStage = useGatewayMutation({
    path: "/runtime/fuel/orders/stage",
    schema: ActionResponseSchema,
    invalidate: [["fuel", "station", "operations"]],
  });
  const consumeStock = useGatewayMutation({
    path: "/runtime/fuel/orders/stock/consume",
    schema: ActionResponseSchema,
    invalidate: [["fuel", "station", "storage"], ["fuel", "station", "reservations"]],
  });
  const allocateContainer = useGatewayMutation({
    path: "/runtime/fuel/containers/allocate",
    schema: ActionResponseSchema,
    invalidate: [["fuel", "station", "containers"], ["fuel", "station", "allocations"]],
  });
  const recordHandover = useGatewayMutation({
    path: "/runtime/fuel/containers/handover",
    schema: ActionResponseSchema,
    invalidate: [["fuel", "station", "containers"], ["fuel", "station", "allocations"]],
  });
  const assignDriver = useGatewayMutation({
    path: "/runtime/fuel/orders/assign-driver",
    schema: ActionResponseSchema,
    invalidate: [["fuel", "station", "operations"], ["fuel", "station", "qualifications"]],
  });

  const rows = (operations.data ?? []) as FuelOperation[];
  const sortedRows = [...rows].sort((a, b) => {
    const order = stagePriority(firstString(a, ["stage_key"]) ?? "") - stagePriority(firstString(b, ["stage_key"]) ?? "");
    return order || String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""));
  });
  const focusedOrder = sortedRows.find((row) => firstString(row, ["order_id"]) === focusedOrderId) ?? null;
  const focusedProduct = focusedOrder ? firstString(focusedOrder, ["product_key"]) ?? "fuel.pms" : "";
  const focusedLitres = focusedOrder ? firstNumber(focusedOrder, ["requested_litres"]) ?? 0 : 0;
  const focusedMode = focusedOrder ? firstString(focusedOrder, ["container_mode"]) ?? "rental" : "rental";
  const focusedContainerTypeId = focusedOrder ? firstString(focusedOrder, ["container_type_id"]) ?? "" : "";
  const focusedStage = focusedOrder ? firstString(focusedOrder, ["stage_key"]) ?? "" : "";
  const currentOffer = focusedOrder
    ? (offers.data ?? []).find((offer) =>
        firstString(offer, ["product_key"]) === focusedProduct &&
        firstString(offer, ["currency_code"]) === (firstString(offer, ["currency_code"]) ?? "NGN") &&
        firstString(offer, ["status"]) === "active"
      ) ?? null
    : null;
  const branchOffers = (offers.data ?? []).filter((offer) =>
    firstString(offer, ["status"]) === "active" && firstString(offer, ["branch_id"]) === stationBranchId
  );

  const availableContainers = useMemo(() => (containers.data ?? []).filter((container) => {
    if (firstString(container, ["status"]) !== "available") return false;
    if (firstString(container, ["container_type_id"]) !== focusedContainerTypeId) return false;
    if (firstString(container, ["ownership_mode"]) !== "skima") return false;
    const asset = nestedRecord(container, "asset");
    const assetOrganization = firstString(asset, ["organization_id"]);
    return !organizationId || !assetOrganization || assetOrganization === organizationId;
  }), [containers.data, focusedContainerTypeId, organizationId]);

  const existingAllocations = (allocations.data ?? []).filter((row) =>
    firstString(row, ["order_id"]) === focusedOrderId &&
    firstString(row, ["status"]) !== "cancelled"
  );
  const filledAllocations = existingAllocations.filter((row) => firstString(row, ["status"]) === "station_prepared");
  const readyQualifications = (qualifications.data ?? []).filter((row) =>
    firstString(row, ["status"]) === "approved" &&
    firstString(row, ["product_key"]) === focusedProduct &&
    (firstNumber(row, ["maximum_load_litres"]) ?? 0) >= focusedLitres &&
    (!firstString(row, ["valid_until"]) || Date.parse(firstString(row, ["valid_until"]) ?? "") > Date.now()) &&
    (firstString(row, ["branch_id"]) === null || firstString(row, ["branch_id"]) === stationBranchId) &&
    (firstString(focusedOrder, ["fulfillment_mode"]) === "station_managed"
      ? Boolean(firstString(row, ["station_managed_driver_id"]))
      : Boolean(firstString(row, ["driver_profile_id"])))
  );
  const selectedQualification = readyQualifications.find((row) =>
    firstString(row, ["id"]) === selectedDriverQualificationId
  ) ?? readyQualifications[0] ?? null;

  const refreshAll = async () => {
    await Promise.allSettled([
      stationInventory.refetch(), operations.refetch(), storage.refetch(), offers.refetch(),
      containerTypes.refetch(), containers.refetch(), qualifications.refetch(),
      reservations.refetch(), allocations.refetch(), vehicles.refetch(),
    ]);
  };

  const withBusy = async (orderId: string, action: () => Promise<void>, successMessage: string) => {
    setBusyOrderId(orderId);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(successMessage);
      await refreshAll();
    } catch (cause) {
      setError(friendlyError(cause, "SKIMA could not complete this station operation. Check the order and try again."));
    } finally {
      setBusyOrderId(null);
    }
  };

  const startOrderPreparation = async (order: FuelOperation) => {
    const orderId = firstString(order, ["order_id"]) ?? "";
    const litres = firstNumber(order, ["requested_litres"]) ?? 0;
    await withBusy(orderId, async () => {
      await reserveBatch.mutateAsync({
        orderId,
        requestedLitres: litres,
        idempotencyKey: idempotencyKey("fuel-stock-batch", orderId),
        metadata: { branch_id: stationBranchId, product_key: firstString(order, ["product_key"]) },
      });
      await changeStage.mutateAsync({
        orderId,
        stageKey: "stock_reserved",
        idempotencyKey: idempotencyKey("fuel-stage-stock-reserved", orderId),
        metadata: { station_branch_id: stationBranchId },
      });
      await changeStage.mutateAsync({
        orderId,
        stageKey: "station_filling",
        idempotencyKey: idempotencyKey("fuel-stage-filling", orderId),
      });
      setFocusedOrderId(orderId);
    }, "Stock has been reserved and the order is ready for station filling.");
  };

  const finishStationFill = async () => {
    if (!focusedOrder) return;
    const orderId = focusedOrderId;
    const order = focusedOrder;
    await withBusy(orderId, async () => {
      const alreadyPrepared = existingAllocations.filter((row) => firstString(row, ["status"]) === "station_prepared");
      const alreadyPreparedLitres = alreadyPrepared.reduce((total, row) => total + (firstNumber(row, ["filled_litres"]) ?? 0), 0);
      const neededCount = Math.max(0, (firstNumber(order, ["container_count"]) ?? 0) - alreadyPrepared.length);
      const remainingLitres = Math.max(0, focusedLitres - alreadyPreparedLitres);
      const candidates = availableContainers.slice(0, neededCount);
      if (candidates.length !== neededCount) {
        throw new Error(`Only ${candidates.length} of ${neededCount} required compatible SKIMA containers are available at this station.`);
      }
      if (remainingLitres > 0.001 && !currentOffer) throw new Error("The current station offer could not be found for container charges.");

      let litresLeft = remainingLitres;
      for (const container of candidates) {
        const profileId = firstString(container, ["id"]) ?? "";
        const capacity = firstNumber(container, ["capacity_litres"]) ?? 0;
        const allocatedLitres = Math.min(capacity, litresLeft);
        if (!profileId || capacity <= 0 || allocatedLitres <= 0) throw new Error("A selected container has an invalid capacity.");

        await allocateContainer.mutateAsync({
          orderId,
          containerProfileId: profileId,
          allocatedLitres,
          allocationMode: focusedMode,
          purchaseAmount: focusedMode === "purchase" ? firstNumber(currentOffer, ["container_purchase_amount"]) ?? 0 : 0,
          rentalAmount: focusedMode === "rental" ? firstNumber(currentOffer, ["container_rental_amount"]) ?? 0 : 0,
          refundableDepositAmount: focusedMode === "rental" ? firstNumber(currentOffer, ["refundable_deposit_amount"]) ?? 0 : 0,
          currencyCode: firstString(currentOffer, ["currency_code"]) ?? "NGN",
          idempotencyKey: idempotencyKey("fuel-container-allocation", `${orderId}:${profileId}`),
          metadata: { station_branch_id: stationBranchId },
        });

        await recordHandover.mutateAsync({
          allocationId: firstString(container, ["allocation_id"]) ?? undefined,
          eventKey: "station_filled",
          measuredLitres: allocatedLitres,
          note: "Filled and measured at station",
          idempotencyKey: idempotencyKey("fuel-container-filled", `${orderId}:${profileId}`),
          metadata: { station_branch_id: stationBranchId },
        }).catch(async () => {
          const refreshed = await allocations.refetch();
          const allocation = (refreshed.data ?? []).find((row) =>
            firstString(row, ["order_id"]) === orderId &&
            firstString(row, ["container_profile_id"]) === profileId
          );
          const allocationId = allocation ? firstString(allocation, ["id"]) : null;
          if (!allocationId) throw new Error("The container was allocated but its allocation reference could not be reloaded.");
          await recordHandover.mutateAsync({
            allocationId,
            eventKey: "station_filled",
            measuredLitres: allocatedLitres,
            note: "Filled and measured at station",
            idempotencyKey: idempotencyKey("fuel-container-filled", `${orderId}:${profileId}`),
            metadata: { station_branch_id: stationBranchId },
          });
        });

        litresLeft -= allocatedLitres;
      }

      if (litresLeft > 0.001) throw new Error("Registered container capacity is not enough for the ordered litres.");

      const refreshedReservations = await reservations.refetch();
      const reservedRows = refreshedReservations.data ?? [];
      let consumedTotal = 0;
      for (const reservation of reservedRows) {
        const reserved = firstNumber(reservation, ["reserved_litres"]) ?? 0;
        const consumed = firstNumber(reservation, ["consumed_litres"]) ?? 0;
        const remaining = Math.max(0, reserved - consumed);
        if (remaining <= 0.001) continue;
        await consumeStock.mutateAsync({
          reservationId: firstString(reservation, ["id"]),
          consumedLitres: remaining,
          idempotencyKey: idempotencyKey("fuel-stock-consume", `${orderId}:${firstString(reservation, ["id"])}:${reserved}`),
          metadata: { measured_at_station: true, order_id: orderId },
        });
        consumedTotal += remaining;
      }
      if (consumedTotal < (focusedLitres - alreadyPreparedLitres) - 0.001) {
        throw new Error("Reserved fuel stock does not cover the remaining measured container litres.");
      }

      await changeStage.mutateAsync({
        orderId,
        stageKey: "ready_for_driver",
        idempotencyKey: idempotencyKey("fuel-stage-ready-driver", orderId),
      });
    }, "The measured fuel and all containers are prepared. The order is ready for a qualified driver.");
  };

  const assignQualifiedDriver = async () => {
    if (!focusedOrder || !selectedQualification) return;
    const orderId = focusedOrderId;
    const driverEntityId = firstString(selectedQualification, [
      firstString(focusedOrder, ["fulfillment_mode"]) === "station_managed" ? "station_managed_driver_id" : "driver_profile_id",
    ]);
    const vehicleId = firstString(selectedQualification, ["vehicle_id"]);
    if (!driverEntityId || !vehicleId) {
      setError("The selected Fuel qualification is missing its driver identity or vehicle.");
      return;
    }
    await withBusy(orderId, async () => {
      await assignDriver.mutateAsync({
        orderId,
        driverEntityId,
        vehicleId,
        idempotencyKey: idempotencyKey("fuel-driver-assignment", orderId),
        metadata: { station_branch_id: stationBranchId },
      });
    }, "A Fuel-approved driver and vehicle have been assigned to this order.");
  };

  const handContainersToDriver = async () => {
    if (!focusedOrder) return;
    const orderId = focusedOrderId;
    await withBusy(orderId, async () => {
      const allAllocations = (await allocations.refetch()).data ?? [];
      const prepared = allAllocations.filter((row) =>
        firstString(row, ["order_id"]) === orderId &&
        firstString(row, ["status"]) === "station_prepared"
      );
      if (prepared.length !== (firstNumber(focusedOrder, ["container_count"]) ?? 0)) {
        throw new Error("Every prepared container must be visible before station-to-driver handover.");
      }
      for (const allocation of prepared) {
        const allocationId = firstString(allocation, ["id"]);
        if (!allocationId) continue;
        await recordHandover.mutateAsync({
          allocationId,
          eventKey: "handed_to_driver",
          note: "Handed to the assigned Fuel driver",
          idempotencyKey: idempotencyKey("fuel-container-driver-handover", allocationId),
          metadata: { station_branch_id: stationBranchId },
        });
      }
      await changeStage.mutateAsync({
        orderId,
        stageKey: "station_handover",
        idempotencyKey: idempotencyKey("fuel-stage-station-handover", orderId),
      });
    }, "All filled containers have been handed to the assigned driver.");
  };

  const loading = stationInventory.isPending || operations.isPending || storage.isPending || offers.isPending;
  const failed = stationInventory.error || operations.error || storage.error || offers.error;
  const stageTone = (stage: string): "neutral" | "brand" | "success" | "warning" | "danger" => {
    if (["completed", "inspection_passed"].includes(stage)) return "success";
    if (["cancelled", "exception"].includes(stage)) return "danger";
    if (["delivered", "return_due", "received_at_station"].includes(stage)) return "warning";
    return "brand";
  };

  return (
    <Screen
      eyebrow="SKIMA Fuel · Station"
      title="Fuel operations"
      subtitle="Accept paid orders, reserve tank stock, fill and measure containers, then assign an approved driver and vehicle."
      action={<AppButton label="Back to station" size="sm" variant="ghost" onPress={() => router.replace("/(station)" as never)} />}
    >
      {!stationBranchId ? (
        <EmptyState
          title="Station branch not resolved"
          description="Complete station workspace setup before processing Fuel orders."
          action={<AppButton label="Refresh station" variant="secondary" onPress={() => void refreshAll()} />}
        />
      ) : loading ? (
        <View style={styles.loading}><ActivityIndicator color={palette.brand} /><Text style={[styles.muted, { color: palette.muted }]}>Loading Fuel station operations…</Text></View>
      ) : failed ? (
        <EmptyState title="Fuel operations could not be loaded" description="Refresh and try again." action={<AppButton label="Refresh" onPress={() => void refreshAll()} />} />
      ) : (
        <>
          <Card title="Fuel tank availability" description="Only the unreserved stock above the tank safety reserve can be committed to new orders.">
            <View style={styles.stockGrid}>
              {branchOffers.map((offer) => {
                const productKey = firstString(offer, ["product_key"]) ?? "";
                const units = (storage.data ?? []).filter((unit) =>
                  firstString(unit, ["product_key"]) === productKey &&
                  firstString(unit, ["status"]) === "active"
                );
                const available = units.reduce((total, unit) =>
                  total +
                  Math.max(0,
                    (firstNumber(unit, ["physical_stock_litres"]) ?? 0) -
                    (firstNumber(unit, ["reserved_stock_litres"]) ?? 0) -
                    (firstNumber(unit, ["safety_reserve_litres"]) ?? 0)
                  ), 0
                );
                const productName = productKey === "fuel.pms" ? "Petrol" : productKey === "fuel.ago" ? "Diesel" : "Kerosene";
                return (
                  <View key={productKey} style={[styles.stockTile, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
                    <Fuel color={palette.brand} size={18} />
                    <Text style={[styles.stockProduct, { color: palette.ink }]}>{productName}</Text>
                    <Text style={[styles.stockAmount, { color: palette.brand }]}>{available.toLocaleString()} L</Text>
                    <Text style={[styles.muted, { color: palette.muted }]}>{units.length} active tank(s)</Text>
                  </View>
                );
              })}
            </View>
            {branchOffers.length === 0 ? <Text style={[styles.muted, { color: palette.muted }]}>No active Fuel offers are configured for this branch.</Text> : null}
          </Card>

          {notice ? <Text style={[styles.successText, { color: palette.success }]}>{notice}</Text> : null}
          {error ? <Text accessibilityRole="alert" style={[styles.errorText, { color: palette.danger }]}>{error}</Text> : null}

          <Card title="Incoming Fuel orders" description="The station queue contains orders whose payment has already been reserved in escrow.">
            {sortedRows.length === 0 ? (
              <EmptyState icon={<Fuel color={palette.brand} size={27} />} title="No Fuel orders waiting" description="New paid petrol, diesel and kerosene orders will appear here." />
            ) : (
              <View style={styles.orderList}>
                {sortedRows.map((order) => {
                  const orderId = firstString(order, ["order_id"]) ?? "";
                  const productKey = firstString(order, ["product_key"]) ?? "";
                  const stage = firstString(order, ["stage_key"]) ?? "unknown";
                  const selected = orderId === focusedOrderId;
                  return (
                    <Pressable key={orderId} onPress={() => { setFocusedOrderId(orderId); setSelectedDriverQualificationId(""); void reservations.refetch(); void allocations.refetch(); }} style={[styles.orderRow, { borderColor: selected ? palette.brand : palette.border, backgroundColor: selected ? palette.brandSoft : palette.surface }]}>
                      <View style={styles.orderCopy}>
                        <Text style={[styles.orderTitle, { color: palette.ink }]}>{productKey === "fuel.pms" ? "Petrol" : productKey === "fuel.ago" ? "Diesel" : "Kerosene"} · {firstNumber(order, ["requested_litres"]) ?? 0} L</Text>
                        <Text style={[styles.muted, { color: palette.muted }]}>{orderId.slice(0, 8).toUpperCase()} · {firstNumber(order, ["container_count"]) ?? 0} container(s)</Text>
                      </View>
                      <StatusPill label={humanize(stage)} tone={stageTone(stage)} />
                    </Pressable>
                  );
                })}
              </View>
            )}
          </Card>

          {focusedOrder ? (
            <Card title="Selected order" description="Each station action is validated against payment, stock, container custody and driver qualification.">
              <View style={styles.focusSummary}>
                <View style={[styles.focusIcon, { backgroundColor: palette.brandSoft }]}><Package color={palette.brand} size={22} /></View>
                <View style={styles.orderCopy}>
                  <Text style={[styles.orderTitle, { color: palette.ink }]}>{focusedProduct === "fuel.pms" ? "Petrol" : focusedProduct === "fuel.ago" ? "Diesel" : "Kerosene"} · {focusedLitres} L</Text>
                  <Text style={[styles.muted, { color: palette.muted }]}>{focusedMode === "rental" ? "SKIMA rental containers" : "Purchased containers"} · {firstNumber(focusedOrder, ["container_count"]) ?? 0} total</Text>
                </View>
                <StatusPill label={humanize(focusedStage)} tone={stageTone(focusedStage)} />
              </View>

              {focusedStage === "awaiting_station_acceptance" ? (
                <AppButton label="Accept order & reserve full tank stock" fullWidth loading={busyOrderId === focusedOrderId || reserveBatch.isPending} onPress={() => void startOrderPreparation(focusedOrder)} icon={<ShieldCheck color="#FFFFFF" size={18} />} />
              ) : null}

              {focusedStage === "stock_reserved" ? (
                <AppButton label="Start station filling" fullWidth loading={busyOrderId === focusedOrderId} onPress={() => void withBusy(focusedOrderId, async () => {
                  await changeStage.mutateAsync({ orderId: focusedOrderId, stageKey: "station_filling", idempotencyKey: idempotencyKey("fuel-stage-filling", focusedOrderId) });
                }, "Station filling has started.")} />
              ) : null}

              {focusedStage === "station_filling" ? (
                <>
                  <View style={styles.operationInfo}>
                    <Text style={[styles.muted, { color: palette.muted }]}>Prepared containers: {filledAllocations.length} / {firstNumber(focusedOrder, ["container_count"]) ?? 0}</Text>
                    <Text style={[styles.muted, { color: palette.muted }]}>Open stock reservations: {(reservations.data ?? []).filter(row => ["reserved","partially_consumed"].includes(firstString(row, ["status"]) ?? "")).length}</Text>
                  </View>
                  <AppButton label="Complete measured fill & prepare containers" fullWidth loading={busyOrderId === focusedOrderId || allocateContainer.isPending || consumeStock.isPending} onPress={() => void finishStationFill()} />
                </>
              ) : null}

              {focusedStage === "ready_for_driver" ? (
                <>
                  <Text style={[styles.sectionLabel, { color: palette.ink }]}>Choose a qualified driver and vehicle</Text>
                  {readyQualifications.length === 0 ? (
                    <EmptyState title="No approved Fuel driver and vehicle" description="A station or platform administrator must approve a driver and vehicle for this exact fuel product and load before dispatch." />
                  ) : (
                    <View style={styles.orderList}>
                      {readyQualifications.map((qualification) => {
                        const id = firstString(qualification, ["id"]) ?? "";
                        const selected = selectedQualification?.id === id;
                        const driverId = firstString(qualification, ["station_managed_driver_id", "driver_profile_id"]) ?? "";
                        const vehicleId = firstString(qualification, ["vehicle_id"]) ?? "";
                        const vehicle = (vehicles.data ?? []).find((row) => firstString(row, ["id"]) === vehicleId);
                        const vehicleLabel = firstString(vehicle, ["registration_number", "registrationNumber", "plate_number", "plateNumber"]) ?? vehicleId.slice(0, 8).toUpperCase();
                        return (
                          <Pressable key={id} onPress={() => setSelectedDriverQualificationId(id)} style={[styles.driverRow, { borderColor: selected ? palette.brand : palette.border, backgroundColor: selected ? palette.brandSoft : palette.surface }]}>
                            <Truck color={palette.brand} size={19} />
                            <View style={styles.orderCopy}>
                              <Text style={[styles.orderTitle, { color: palette.ink }]}>Driver {driverId.slice(0, 8).toUpperCase()}</Text>
                              <Text style={[styles.muted, { color: palette.muted }]}>{vehicleLabel} · up to {firstNumber(qualification, ["maximum_load_litres"])} L</Text>
                            </View>
                            {selected ? <CheckCircle2 color={palette.success} size={19} /> : null}
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                  <AppButton label="Assign selected qualified driver" fullWidth disabled={!selectedQualification} loading={busyOrderId === focusedOrderId || assignDriver.isPending} onPress={() => void assignQualifiedDriver()} />
                </>
              ) : null}

              {focusedStage === "driver_assigned" ? (
                <AppButton label="Hand filled containers to assigned driver" fullWidth loading={busyOrderId === focusedOrderId || recordHandover.isPending} onPress={() => void handContainersToDriver()} />
              ) : null}

              {["station_handover","out_for_delivery","delivered","return_due","returned_to_driver","received_at_station","inspection_passed","completed"].includes(focusedStage) ? (
                <Text style={[styles.muted, { color: palette.muted }]}>The station portion of this order is complete or has been handed to the driver. Follow rental returns and inspection in the station queue when the driver brings the SKIMA container back.</Text>
              ) : null}
            </Card>
          ) : null}
          <AppButton label="Refresh station operations" variant="secondary" fullWidth onPress={() => void refreshAll()} />
        </>
      )}
    </Screen>
  );
}

function stagePriority(stage: string): number {
  const order: Record<string, number> = {
    awaiting_station_acceptance: 0,
    stock_reserved: 1,
    station_filling: 2,
    ready_for_driver: 3,
    driver_assigned: 4,
    station_handover: 5,
    out_for_delivery: 6,
    delivered: 7,
    return_due: 8,
    returned_to_driver: 9,
    received_at_station: 10,
    inspection_passed: 11,
    completed: 12,
  };
  return order[stage] ?? 50;
}

function humanize(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const styles = StyleSheet.create({
  loading: { minHeight: 180, alignItems: "center", justifyContent: "center", gap: spacing.md },
  muted: { ...typography.caption, fontSize: 11, lineHeight: 16 },
  successText: { ...typography.caption, fontWeight: "800" },
  errorText: { ...typography.caption, fontWeight: "800", lineHeight: 18 },
  stockGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  stockTile: { minWidth: 100, flexGrow: 1, gap: 5, borderWidth: 1, borderRadius: radii.lg, padding: 11 },
  stockProduct: { ...typography.bodyStrong, fontSize: 12 },
  stockAmount: { ...typography.sectionTitle, fontSize: 18 },
  orderList: { gap: spacing.sm },
  orderRow: { borderWidth: 1, borderRadius: radii.lg, padding: 11, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  orderCopy: { flex: 1, gap: 3 },
  orderTitle: { ...typography.bodyStrong, fontSize: 13 },
  focusSummary: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  focusIcon: { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  operationInfo: { gap: 3, padding: 10, borderRadius: radii.md, backgroundColor: "rgba(127,127,127,.08)" },
  sectionLabel: { ...typography.bodyStrong, fontSize: 13 },
  driverRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: 11, borderWidth: 1, borderRadius: radii.lg },
});
