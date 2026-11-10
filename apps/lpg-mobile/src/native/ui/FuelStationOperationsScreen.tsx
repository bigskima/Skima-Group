import { router } from "expo-router";
import { CheckCircle2, Fuel, MapPin, Package, PhoneCall, ShieldCheck, Truck } from "lucide-react-native";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useEffect, useMemo, useState } from "react";

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
import { AppField } from "./AppField";
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
  // stationBranchId in the LPG inventory model is the LPG station-profile ID,
  // not the organization_branches.id used by Fuel offers and inventory.
  const stationProfileId = firstString(station, ["stationBranchId", "station_branch_id"]) ?? "";
  const stationContext = useGatewayQuery({
    key: ["fuel", "station", "branch-context", stationProfileId],
    path: `/runtime/fuel/station-context?stationProfileId=${encodeURIComponent(stationProfileId)}`,
    schema: RecordArraySchema,
    enabled: Boolean(stationProfileId),
    refetchInterval: 60000,
  });
  const resolvedStationContext = stationContext.data?.[0] ?? null;
  const stationBranchId = firstString(resolvedStationContext, ["branch_id"]) ?? "";
  const organizationId = firstString(resolvedStationContext, ["organization_id"]) ?? "";
  const products = useGatewayQuery({
    key: ["fuel", "products"],
    path: "/runtime/fuel/products",
    schema: RecordArraySchema,
    refetchInterval: 60000,
  });
  const productNameForKey = (key: string) =>
    firstString((products.data ?? []).find((item) => firstString(item, ["key"]) === key), ["display_name"]) || key || "Fuel";
  const currencies = domainQueries.currencies();
  const modeControls = useGatewayQuery({
    key: ["fuel", "station", "mode-controls"],
    path: "/runtime/fuel/mode-controls",
    schema: RecordArraySchema,
    refetchInterval: 30000,
  });

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
  const [offerProductKey, setOfferProductKey] = useState("fuel.pms");
  const [offerCurrencyCode, setOfferCurrencyCode] = useState("NGN");
  const [offerPrice, setOfferPrice] = useState("");
  const [offerMinimumLitres, setOfferMinimumLitres] = useState("1");
  const [offerMaximumLitres, setOfferMaximumLitres] = useState("");
  const [offerModes, setOfferModes] = useState<string[]>([]);
  const [tankProductKey, setTankProductKey] = useState("fuel.pms");
  const [tankKey, setTankKey] = useState("");
  const [tankName, setTankName] = useState("");
  const [tankCapacity, setTankCapacity] = useState("");
  const [tankSafetyReserve, setTankSafetyReserve] = useState("0");
  const [selectedStockUnitId, setSelectedStockUnitId] = useState("");
  const [stockReceiptLitres, setStockReceiptLitres] = useState("");
  const [stockReceiptReason, setStockReceiptReason] = useState("");
  const [stockAdjustmentLitres, setStockAdjustmentLitres] = useState("");
  const [stockAdjustmentReason, setStockAdjustmentReason] = useState("");
  const [offerNotice, setOfferNotice] = useState<string | null>(null);
  const [offerError, setOfferError] = useState<string | null>(null);

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

  const saveStationOffer = useGatewayMutation({
    path: "/runtime/fuel/offers",
    schema: ActionResponseSchema,
    invalidate: [["fuel", "station", "offers"], ["fuel", "offers"]],
  });
  const configureTank = useGatewayMutation({
    path: "/runtime/fuel/storage",
    schema: ActionResponseSchema,
    invalidate: [["fuel", "station", "storage"]],
  });
  const receiveStock = useGatewayMutation({
    path: "/runtime/fuel/storage/receive",
    schema: ActionResponseSchema,
    invalidate: [["fuel", "station", "storage"]],
  });
  const adjustStock = useGatewayMutation({
    path: "/runtime/fuel/storage/adjust",
    schema: ActionResponseSchema,
    invalidate: [["fuel", "station", "storage"]],
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
  const inspectContainer = useGatewayMutation({
    path: "/runtime/fuel/containers/inspection",
    schema: ActionResponseSchema,
    invalidate: [["fuel", "station", "allocations"], ["fuel", "station", "containers"]],
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
  const focusedCustomerContact = nestedRecord(focusedOrder, "customer_contact");
  const focusedSettlementExecutionId = firstString(focusedOrder, ["settlement_execution_id"]);
  const focusedSettlementStatementId = firstString(focusedOrder, ["settlement_statement_id"]);
  const focusedSettledAt = firstString(focusedOrder, ["settled_at"]);
  const branchOffers = (offers.data ?? []).filter((offer) =>
    firstString(offer, ["status"]) === "active" && firstString(offer, ["branch_id"]) === stationBranchId
  );
  const selectedStockUnit = (storage.data ?? []).find((unit) =>
    firstString(unit, ["id"]) === selectedStockUnitId
  ) ?? null;
  const orderCurrency = firstString(nestedRecord(focusedOrder, "order"), ["currency_code"]) ?? "NGN";
  const currentOffer = focusedOrder
    ? branchOffers.find((offer) =>
        firstString(offer, ["product_key"]) === focusedProduct &&
        firstString(offer, ["currency_code"]) === orderCurrency
      ) ?? null
    : null;

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
  const focusedFulfillmentMode = firstString(focusedOrder, ["fulfillment_mode"]) ?? "";
  const readyQualifications = (qualifications.data ?? []).filter((row) =>
    focusedFulfillmentMode === "station_managed" &&
    firstString(row, ["fulfillment_mode"]) === "station_managed" &&
    firstString(row, ["status"]) === "approved" &&
    firstString(row, ["product_key"]) === focusedProduct &&
    (firstNumber(row, ["maximum_load_litres"]) ?? 0) >= focusedLitres &&
    (!firstString(row, ["valid_until"]) || Date.parse(firstString(row, ["valid_until"]) ?? "") > Date.now()) &&
    firstString(row, ["branch_id"]) === stationBranchId &&
    Boolean(firstString(row, ["station_managed_driver_id"])) &&
    !firstString(row, ["driver_profile_id"])
  );
  const selectedQualification = readyQualifications.find((row) =>
    firstString(row, ["id"]) === selectedDriverQualificationId
  ) ?? readyQualifications[0] ?? null;
  const enabledFuelProducts = (products.data ?? []).filter((product) =>
    firstString(product, ["status"]) === "enabled" &&
    ["fuel.pms", "fuel.ago", "fuel.dpk"].includes(firstString(product, ["key"]) ?? "")
  );
  const selectedProductModeControls = (modeControls.data ?? []).filter((control) =>
    firstString(control, ["product_key"]) === offerProductKey
  );
  const globalModeControlsUnavailable = Boolean(modeControls.error) ||
    (!modeControls.isPending && enabledFuelProducts.length > 0 && selectedProductModeControls.length !== 3);
  const enabledCurrencies = (currencies.data ?? []).filter((currency) =>
    firstString(currency, ["status"]) === "enabled" && firstString(currency, ["code"])
  );
  const stationOfferForEditor = (offers.data ?? []).find((offer) =>
    firstString(offer, ["branch_id"]) === stationBranchId &&
    firstString(offer, ["product_key"]) === offerProductKey &&
    firstString(offer, ["currency_code"]) === offerCurrencyCode
  ) ?? null;
  const globallyAllowedOfferModes = new Set((modeControls.data ?? [])
    .filter((control) =>
      firstString(control, ["product_key"]) === offerProductKey &&
      control.enabled === true
    )
    .map((control) => firstString(control, ["fulfillment_mode"]))
    .filter((value): value is string => Boolean(value)));
  const globallyAllowedOfferModeKey = [...globallyAllowedOfferModes].sort().join("|");

  useEffect(() => {
    if (enabledFuelProducts.length > 0 && !enabledFuelProducts.some((product) => firstString(product, ["key"]) === offerProductKey)) {
      setOfferProductKey(firstString(enabledFuelProducts[0], ["key"]) ?? "fuel.pms");
    }
  }, [enabledFuelProducts, offerProductKey]);

  useEffect(() => {
    if (enabledCurrencies.length > 0 && !enabledCurrencies.some((currency) => firstString(currency, ["code"]) === offerCurrencyCode)) {
      setOfferCurrencyCode(firstString(enabledCurrencies[0], ["code"]) ?? "NGN");
    }
  }, [enabledCurrencies, offerCurrencyCode]);

  useEffect(() => {
    setOfferPrice(stationOfferForEditor ? String(firstNumber(stationOfferForEditor, ["price_per_litre"]) ?? "") : "");
    setOfferMinimumLitres(stationOfferForEditor ? String(firstNumber(stationOfferForEditor, ["minimum_litres"]) ?? 1) : "1");
    setOfferMaximumLitres(stationOfferForEditor ? String(firstNumber(stationOfferForEditor, ["maximum_litres"]) ?? "") : "");
    const configured = Array.isArray(stationOfferForEditor?.fulfillment_modes)
      ? stationOfferForEditor.fulfillment_modes.filter((value): value is string => typeof value === "string")
      : [];
    setOfferModes(configured.filter((mode) => globallyAllowedOfferModes.has(mode)));
    setOfferNotice(null);
    setOfferError(null);
  }, [stationBranchId, offerProductKey, offerCurrencyCode, stationOfferForEditor?.id, stationOfferForEditor?.updated_at, globallyAllowedOfferModeKey]);

  useEffect(() => {
    const firstUnit = (storage.data ?? []).find((unit) => firstString(unit, ["status"]) === "active");
    if (!selectedStockUnitId || !(storage.data ?? []).some((unit) => firstString(unit, ["id"]) === selectedStockUnitId)) {
      setSelectedStockUnitId(firstString(firstUnit, ["id"]) ?? "");
    }
  }, [storage.data, selectedStockUnitId]);

  const refreshAll = async () => {
    await Promise.allSettled([
      stationInventory.refetch(), stationContext.refetch(), operations.refetch(), storage.refetch(), offers.refetch(), modeControls.refetch(), currencies.refetch(),
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

  const saveStationProductOffer = async (nextStatus: "active" | "paused") => {
    setOfferNotice(null);
    setOfferError(null);
    const price = Number(offerPrice);
    const minimum = Number(offerMinimumLitres);
    const maximum = Number(offerMaximumLitres);
    if (!modeControls.data?.length || modeControls.error) {
      setOfferError("SKIMA's global fulfilment settings could not be verified. Refresh before saving a station offer.");
      return;
    }
    if (!stationBranchId) {
      setOfferError("This station's branch could not be resolved. Refresh station setup before saving.");
      return;
    }
    if (!offerProductKey || !offerCurrencyCode || !Number.isFinite(price) || price <= 0 ||
        !Number.isFinite(minimum) || minimum <= 0 || !Number.isFinite(maximum) || maximum < minimum) {
      setOfferError("Enter a positive station selling price and a valid minimum/maximum litre range.");
      return;
    }
    const allowedSelections = offerModes.filter((mode) => globallyAllowedOfferModes.has(mode));
    if (allowedSelections.length === 0) {
      setOfferError("Select at least one fulfilment mode that SKIMA has globally enabled.");
      return;
    }
    try {
      await saveStationOffer.mutateAsync({
        branchId: stationBranchId,
        productKey: offerProductKey,
        currencyCode: offerCurrencyCode,
        pricePerLitre: price,
        minimumLitres: minimum,
        maximumLitres: maximum,
        fulfillmentModes: allowedSelections,
        status: nextStatus,
        idempotencyKey: idempotencyKey("fuel-station-offer", `${stationBranchId}:${offerProductKey}:${offerCurrencyCode}:${nextStatus}`),
      });
      setOfferNotice(nextStatus === "active"
        ? `${productNameForKey(offerProductKey)} is now offered by this station at ${price.toLocaleString()} ${offerCurrencyCode}/L.`
        : `${productNameForKey(offerProductKey)} is paused for this station. SKIMA's global product switch still has final control.`);
      await Promise.all([offers.refetch(), modeControls.refetch()]);
    } catch (cause) {
      setOfferError(friendlyError(cause, "SKIMA could not save this station product offer."));
    }
  };

  const createStationTank = async () => {
    const capacity = Number(tankCapacity);
    const reserve = Number(tankSafetyReserve);
    if (!stationBranchId || !organizationId) {
      setError("Station branch or organisation could not be resolved. Refresh station setup.");
      return;
    }
    if (!tankKey.trim() || !tankName.trim() || !Number.isFinite(capacity) || capacity <= 0 ||
        !Number.isFinite(reserve) || reserve < 0 || reserve > capacity ||
        !enabledFuelProducts.some((product) => firstString(product, ["key"]) === tankProductKey)) {
      setError("Choose an enabled fuel product and enter a tank name, unique key, positive capacity and valid safety reserve.");
      return;
    }
    setError(null);
    setNotice(null);
    try {
      await configureTank.mutateAsync({
        organizationId,
        branchId: stationBranchId,
        productKey: tankProductKey,
        storageKey: tankKey.trim(),
        displayName: tankName.trim(),
        capacityLitres: capacity,
        safetyReserveLitres: reserve,
        status: "active",
        metadata: { configured_from: "station_fuel_operations" },
        idempotencyKey: idempotencyKey("fuel-tank-setup", stationBranchId + ":" + tankKey.trim()),
      });
      setTankKey("");
      setTankName("");
      setTankCapacity("");
      setTankSafetyReserve("0");
      setNotice("Fuel tank configured. Record the opening stock below before accepting orders.");
      await storage.refetch();
    } catch (cause) {
      setError(friendlyError(cause, "SKIMA could not configure this fuel tank."));
    }
  };

  const recordStockReceipt = async () => {
    const quantity = Number(stockReceiptLitres);
    if (!selectedStockUnitId || firstString(selectedStockUnit, ["status"]) !== "active" ||
        !Number.isFinite(quantity) || quantity <= 0 || !stockReceiptReason.trim()) {
      setError("Choose an active tank, enter the litres received and provide a supplier receipt or delivery reference.");
      return;
    }
    setError(null);
    setNotice(null);
    try {
      await receiveStock.mutateAsync({
        storageUnitId: selectedStockUnitId,
        quantityLitres: quantity,
        reason: stockReceiptReason.trim(),
        idempotencyKey: idempotencyKey("fuel-stock-receipt", selectedStockUnitId + ":" + quantity + ":" + stockReceiptReason.trim()),
        metadata: { station_branch_id: stationBranchId, entry_channel: "station_fuel_operations" },
      });
      setStockReceiptLitres("");
      setStockReceiptReason("");
      setNotice("Fuel receipt recorded and physical stock updated.");
      await storage.refetch();
    } catch (cause) {
      setError(friendlyError(cause, "SKIMA could not record this fuel stock receipt."));
    }
  };

  const recordStockAdjustment = async () => {
    const delta = Number(stockAdjustmentLitres);
    if (!selectedStockUnitId || !Number.isFinite(delta) || delta === 0 || !stockAdjustmentReason.trim()) {
      setError("Choose a tank, enter a non-zero signed litre adjustment and explain the stock correction.");
      return;
    }
    setError(null);
    setNotice(null);
    try {
      await adjustStock.mutateAsync({
        storageUnitId: selectedStockUnitId,
        quantityDeltaLitres: delta,
        reason: stockAdjustmentReason.trim(),
        idempotencyKey: idempotencyKey("fuel-stock-adjustment", selectedStockUnitId + ":" + delta + ":" + stockAdjustmentReason.trim()),
        metadata: { station_branch_id: stationBranchId, entry_channel: "station_fuel_operations" },
      });
      setStockAdjustmentLitres("");
      setStockAdjustmentReason("");
      setNotice("Fuel stock adjustment recorded in the stock movement history.");
      await storage.refetch();
    } catch (cause) {
      setError(friendlyError(cause, "SKIMA could not adjust this fuel stock."));
    }
  };

  const toggleOfferMode = (mode: string) => {
    if (!globallyAllowedOfferModes.has(mode)) return;
    setOfferModes((current) => current.includes(mode)
      ? current.filter((item) => item !== mode)
      : [...current, mode]);
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
      // The final stock-reservation event advances the order automatically
      // through stock_reserved into station_filling.
      setFocusedOrderId(orderId);
    }, "Full stock reserved. SKIMA has moved the order into station filling automatically.");
  };

  const finishStationFill = async () => {
    if (!focusedOrder) return;
    const orderId = focusedOrderId;
    const order = focusedOrder;
    await withBusy(orderId, async () => {
      const requiredCount = firstNumber(order, ["container_count"]) ?? 0;
      const existing = (await allocations.refetch()).data?.filter((row) =>
        firstString(row, ["order_id"]) === orderId &&
        firstString(row, ["status"]) !== "cancelled"
      ) ?? [];
      if (existing.length > requiredCount) throw new Error("Container allocation count exceeds the accepted order quote.");

      const alreadyAllocatedProfiles = new Set(existing.map((row) => firstString(row, ["container_profile_id"])).filter(Boolean));
      const missingCount = Math.max(0, requiredCount - existing.length);
      const candidates = availableContainers.filter((container) =>
        !alreadyAllocatedProfiles.has(firstString(container, ["id"]))
      ).slice(0, missingCount);
      if (candidates.length !== missingCount) {
        throw new Error(`Only ${candidates.length} of ${missingCount} additional compatible SKIMA containers are available at this station.`);
      }
      if (requiredCount > 0 && !currentOffer) throw new Error("The station's accepted currency offer could not be found for container charges.");

      const markContainerFilled = async (allocationId: string, profileId: string, litres: number) => {
        await recordHandover.mutateAsync({
          allocationId,
          eventKey: "station_filled",
          measuredLitres: litres,
          note: "Filled and measured at station",
          idempotencyKey: idempotencyKey("fuel-container-filled", `${orderId}:${profileId}`),
          metadata: { station_branch_id: stationBranchId },
        });
      };

      // Complete any allocation left reserved by a previous interrupted station session.
      const unfilledExisting = existing.filter((row) => firstString(row, ["status"]) === "reserved");
      for (const allocation of unfilledExisting) {
        const allocationId = firstString(allocation, ["id"]);
        const profileId = firstString(allocation, ["container_profile_id"]);
        const litres = firstNumber(allocation, ["allocated_litres"]) ?? 0;
        if (!allocationId || !profileId || litres <= 0) {
          throw new Error("An existing container allocation is missing its identity or litre amount.");
        }
        await markContainerFilled(allocationId, profileId, litres);
      }

      const alreadyAllocatedLitres = existing.reduce((total, row) =>
        total + (firstNumber(row, ["allocated_litres"]) ?? 0), 0
      );
      let litresLeft = Math.max(0, focusedLitres - alreadyAllocatedLitres);

      for (const container of candidates) {
        const profileId = firstString(container, ["id"]) ?? "";
        const capacity = firstNumber(container, ["capacity_litres"]) ?? 0;
        const allocatedLitres = Math.min(capacity, litresLeft);
        if (!profileId || capacity <= 0 || allocatedLitres <= 0) {
          throw new Error("A selected container has an invalid capacity.");
        }

        await allocateContainer.mutateAsync({
          orderId,
          containerProfileId: profileId,
          allocatedLitres,
          allocationMode: focusedMode,
          purchaseAmount: focusedMode === "purchase" ? firstNumber(currentOffer, ["container_purchase_amount"]) ?? 0 : 0,
          rentalAmount: focusedMode === "rental" ? firstNumber(currentOffer, ["container_rental_amount"]) ?? 0 : 0,
          refundableDepositAmount: focusedMode === "rental" ? firstNumber(currentOffer, ["refundable_deposit_amount"]) ?? 0 : 0,
          currencyCode: orderCurrency,
          idempotencyKey: idempotencyKey("fuel-container-allocation", `${orderId}:${profileId}`),
          metadata: { station_branch_id: stationBranchId },
        });

        const latestAllocations = (await allocations.refetch()).data ?? [];
        const allocation = latestAllocations.find((row) =>
          firstString(row, ["order_id"]) === orderId &&
          firstString(row, ["container_profile_id"]) === profileId
        );
        const allocationId = allocation ? firstString(allocation, ["id"]) : null;
        if (!allocationId) throw new Error("The container was allocated but its order allocation could not be reloaded.");

        await markContainerFilled(allocationId, profileId, allocatedLitres);
        litresLeft -= allocatedLitres;
      }

      if (litresLeft > 0.001) throw new Error("Registered container capacity is not enough for the ordered litres.");

      const reservedRows = (await reservations.refetch()).data ?? [];
      if (reservedRows.length === 0) throw new Error("No stock reservation exists for this Fuel order.");
      for (const reservation of reservedRows) {
        const reserved = firstNumber(reservation, ["reserved_litres"]) ?? 0;
        const consumed = firstNumber(reservation, ["consumed_litres"]) ?? 0;
        const remaining = Math.max(0, reserved - consumed);
        if (remaining <= 0.001) continue;
        const reservationId = firstString(reservation, ["id"]);
        if (!reservationId) throw new Error("A fuel stock reservation is missing its identity.");
        await consumeStock.mutateAsync({
          reservationId,
          consumedLitres: remaining,
          idempotencyKey: idempotencyKey("fuel-stock-consume", `${orderId}:${reservationId}:${reserved}`),
          metadata: { measured_at_station: true, order_id: orderId },
        });
      }

      const finalReservations = (await reservations.refetch()).data ?? [];
      const fullyConsumed = finalReservations.reduce((total, row) => total + (firstNumber(row, ["consumed_litres"]) ?? 0), 0);
      if (fullyConsumed < focusedLitres - 0.001) {
        throw new Error("Reserved fuel stock has not yet covered the complete measured order quantity.");
      }

      // The stock-consumption event writes the measured order litres. The
      // database advances to ready_for_driver when all station checks balance.
    }, "The measured fuel and all containers are prepared. SKIMA has advanced the order to driver assignment automatically.");
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

  const recordContainerInspection = async (allocation: PlatformRecord, result: "passed" | "failed") => {
    if (!focusedOrder) return;
    const orderId = focusedOrderId;
    const allocationId = firstString(allocation, ["id"]);
    if (!allocationId) return;
    await withBusy(orderId, async () => {
      await inspectContainer.mutateAsync({
        allocationId,
        inspectionResult: result,
        note: result === "passed" ? "Station physical inspection passed." : "Station physical inspection failed; container quarantined.",
        idempotencyKey: idempotencyKey("fuel-container-inspection", `${allocationId}:${result}`),
        metadata: { station_branch_id: stationBranchId },
      });

      const latest = (await allocations.refetch()).data ?? [];
      const orderRows = latest.filter((row) => firstString(row, ["order_id"]) === orderId);
      const failed = orderRows.some((row) => firstString(row, ["status"]) === "exception");
      if (failed) {
        await changeStage.mutateAsync({
          orderId,
          stageKey: "exception",
          idempotencyKey: idempotencyKey("fuel-stage-inspection-exception", orderId),
          reason: "At least one returned rental container failed inspection.",
        });
      }
      // Each passing inspection inserts an immutable custody event. The final
      // passing event advances inspection_passed and completed automatically.
    }, result === "passed" ? "Container inspection recorded as passed." : "Container flagged and quarantined for review.");
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
      // The final handed_to_driver custody event automatically records the
      // station handover and starts the assigned driver's delivery leg.
    }, "All filled containers have been handed to the assigned driver. Delivery has started automatically.");
  };

  const loading = stationInventory.isPending || stationContext.isPending || products.isPending || operations.isPending || storage.isPending || offers.isPending || currencies.isPending || modeControls.isPending;
  const failed = Boolean(stationInventory.error || stationContext.error || operations.error || storage.error || offers.error);
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
      {!stationProfileId ? (
        <EmptyState
          title="Station profile not resolved"
          description="Complete station workspace setup before processing Fuel orders."
          action={<AppButton label="Refresh station" variant="secondary" onPress={() => void refreshAll()} />}
        />
      ) : !stationBranchId && !stationContext.isPending ? (
        <EmptyState
          title="Fuel branch could not be resolved"
          description={stationContext.error
            ? friendlyError(stationContext.error, "SKIMA could not resolve this station's Fuel branch.")
            : "This approved LPG station profile is not currently linked to an active organization branch. Contact SKIMA Admin before configuring Fuel offers or stock."}
          action={<AppButton label="Retry branch lookup" variant="secondary" onPress={() => void stationContext.refetch()} />}
        />
      ) : loading ? (
        <View style={styles.loading}><ActivityIndicator /><Text style={[styles.muted, { color: palette.muted }]}>Loading Fuel station operations…</Text></View>
      ) : failed ? (
        <EmptyState
          title="Fuel operations could not be loaded"
          description={globalModeControlsUnavailable
            ? "SKIMA's global fulfilment settings could not be verified. No mode has been assumed disabled. Refresh before changing offers or dispatching a new order."
            : "Refresh and try again. Existing orders and stock records have not been changed."}
          action={<AppButton label="Refresh" onPress={() => void refreshAll()} />}
        />
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
                const productName = productNameForKey(productKey);
                return (
                  <View key={productKey} style={[styles.stockTile, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
                    <Fuel size={18} />
                    <Text style={[styles.stockProduct, { color: palette.ink }]}>{productName}</Text>
                    <Text style={[styles.stockAmount, { color: palette.brand }]}>{available.toLocaleString()} L</Text>
                    <Text style={[styles.muted, { color: palette.muted }]}>{units.length} active tank(s)</Text>
                  </View>
                );
              })}
            </View>
            {branchOffers.length === 0 ? <Text style={[styles.muted, { color: palette.muted }]}>No active Fuel offers are configured for this branch.</Text> : null}
          </Card>

          <Card
            title="Configure fuel tanks"
            description="Create one storage record for each physical tank or approved storage compartment. Capacity and safety reserve are enforced by SKIMA."
          >
            <View style={styles.productChipRow}>
              {enabledFuelProducts.map((product) => {
                const key = firstString(product, ["key"]) ?? "";
                const active = tankProductKey === key;
                return (
                  <Pressable
                    key={key}
                    onPress={() => setTankProductKey(key)}
                    style={[styles.productChip, { borderColor: active ? palette.brand : palette.border, backgroundColor: active ? palette.brandSoft : palette.surface }]}
                  >
                    <Text style={[styles.productChipText, { color: active ? palette.brand : palette.ink }]}>{productNameForKey(key)}</Text>
                  </Pressable>
                );
              })}
            </View>
            <AppField label="Tank key" value={tankKey} onChangeText={setTankKey} placeholder="e.g. petrol-main-tank" />
            <AppField label="Tank name" value={tankName} onChangeText={setTankName} placeholder="e.g. PMS Tank 1" />
            <AppField label="Capacity (litres)" value={tankCapacity} onChangeText={setTankCapacity} placeholder="e.g. 30000" keyboardType="decimal-pad" />
            <AppField label="Safety reserve (litres)" value={tankSafetyReserve} onChangeText={setTankSafetyReserve} placeholder="0" keyboardType="decimal-pad" />
            <AppButton
              label="Save fuel tank"
              fullWidth
              loading={configureTank.isPending}
              disabled={!stationBranchId || !organizationId || !enabledFuelProducts.length}
              onPress={() => void createStationTank()}
            />
          </Card>

          <Card
            title="Fuel receipts and stock corrections"
            description="Record supplier deliveries against the actual tank. Each receipt and correction is added to the immutable stock movement history."
          >
            {(storage.data ?? []).filter((unit) => firstString(unit, ["status"]) !== "retired").length === 0 ? (
              <Text style={[styles.muted, { color: palette.muted }]}>No tanks are configured yet. Create a tank above, then record its opening stock as a supplier receipt.</Text>
            ) : (
              <>
                <Text style={[styles.sectionLabel, { color: palette.ink }]}>Select tank</Text>
                <View style={styles.offerModeList}>
                  {(storage.data ?? []).filter((unit) => ["active", "paused"].includes(firstString(unit, ["status"]) ?? "")).map((unit) => {
                    const unitId = firstString(unit, ["id"]) ?? "";
                    const active = selectedStockUnitId === unitId;
                    const name = firstString(unit, ["display_name", "key"]) ?? "Fuel tank";
                    const product = productNameForKey(firstString(unit, ["product_key"]) ?? "");
                    const stock = firstNumber(unit, ["physical_stock_litres"]) ?? 0;
                    const reserved = firstNumber(unit, ["reserved_stock_litres"]) ?? 0;
                    const reserve = firstNumber(unit, ["safety_reserve_litres"]) ?? 0;
                    return (
                      <Pressable
                        key={unitId}
                        onPress={() => setSelectedStockUnitId(unitId)}
                        style={[styles.offerModeRow, { borderColor: active ? palette.brand : palette.border, backgroundColor: active ? palette.brandSoft : palette.surfaceSubtle }]}
                      >
                        <View style={styles.offerModeCopy}>
                          <Text style={[styles.orderTitle, { color: palette.ink }]}>{name}</Text>
                          <Text style={[styles.muted, { color: palette.muted }]}>{product} · {stock.toLocaleString()} L physical · {Math.max(0, stock - reserved - reserve).toLocaleString()} L available</Text>
                        </View>
                        <StatusPill label={active ? "Selected" : firstString(unit, ["status"]) ?? "Tank"} tone={active ? "success" : "neutral"} />
                      </Pressable>
                    );
                  })}
                </View>
                <AppField label="Supplier delivery quantity (litres)" value={stockReceiptLitres} onChangeText={setStockReceiptLitres} placeholder="e.g. 5000" keyboardType="decimal-pad" />
                <AppField label="Supplier receipt / delivery reference" value={stockReceiptReason} onChangeText={setStockReceiptReason} placeholder="Supplier, delivery note or receipt number" />
                <AppButton
                  label="Record supplier receipt"
                  fullWidth
                  loading={receiveStock.isPending}
                  disabled={!selectedStockUnitId || firstString(selectedStockUnit, ["status"]) !== "active"}
                  onPress={() => void recordStockReceipt()}
                />
                <View style={styles.operationInfo}>
                  <Text style={[styles.muted, { color: palette.ink }]}>For corrections only, enter a positive amount to add or a negative amount to remove stock. SKIMA will reject changes that breach reserved quantities, safety reserve or tank capacity.</Text>
                </View>
                <AppField label="Stock adjustment (+/- litres)" value={stockAdjustmentLitres} onChangeText={setStockAdjustmentLitres} placeholder="e.g. -25 or 25" keyboardType="decimal-pad" />
                <AppField label="Reason for stock adjustment" value={stockAdjustmentReason} onChangeText={setStockAdjustmentReason} placeholder="Explain the physical stock reconciliation" />
                <AppButton
                  label="Record stock adjustment"
                  variant="secondary"
                  fullWidth
                  loading={adjustStock.isPending}
                  disabled={!selectedStockUnitId}
                  onPress={() => void recordStockAdjustment()}
                />
              </>
            )}
          </Card>

          {notice ? <Text style={[styles.successText, { color: palette.success }]}>{notice}</Text> : null}
          {error ? <Text accessibilityRole="alert" style={[styles.errorText, { color: palette.danger }]}>{error}</Text> : null}

          <Card
            title="What your station sells"
            description="Enable PMS, diesel or kerosene for this branch and set your own selling price. SKIMA's global product and fulfilment switches always take priority."
          >
            {globalModeControlsUnavailable ? (
              <Text style={[styles.errorText, { color: palette.danger }]}>
                SKIMA's global fulfilment settings are temporarily unavailable. You can still manage tanks and physical stock, but station offers cannot be changed until the platform settings are verified.
              </Text>
            ) : null}
            {enabledFuelProducts.length === 0 ? (
              <Text style={[styles.muted, { color: palette.muted }]}>SKIMA has globally disabled all Fuel products. Your station cannot enable or sell them.</Text>
            ) : (
              <>
                <View style={styles.productChipRow}>
                  {enabledFuelProducts.map((product) => {
                    const key = firstString(product, ["key"]) ?? "";
                    const selected = key === offerProductKey;
                    const existingOffer = (offers.data ?? []).find((offer) =>
                      firstString(offer, ["branch_id"]) === stationBranchId &&
                      firstString(offer, ["product_key"]) === key &&
                      firstString(offer, ["currency_code"]) === offerCurrencyCode
                    );
                    return (
                      <Pressable
                        key={key}
                        onPress={() => setOfferProductKey(key)}
                        style={[styles.productChip, { borderColor: selected ? palette.brand : palette.border, backgroundColor: selected ? palette.brandSoft : palette.surface }]}
                      >
                        <Text style={[styles.productChipText, { color: selected ? palette.brand : palette.ink }]}>{productNameForKey(key)}</Text>
                        {existingOffer ? <StatusPill label={firstString(existingOffer, ["status"]) === "active" ? "Enabled" : "Paused"} tone={firstString(existingOffer, ["status"]) === "active" ? "success" : "warning"} /> : <StatusPill label="Not offered" tone="neutral" />}
                      </Pressable>
                    );
                  })}
                </View>
                <View style={styles.productChipRow}>
                  {enabledCurrencies.map((currency) => {
                    const code = firstString(currency, ["code"]) ?? "";
                    const selected = code === offerCurrencyCode;
                    return (
                      <Pressable key={code} onPress={() => setOfferCurrencyCode(code)} style={[styles.currencyChip, { borderColor: selected ? palette.brand : palette.border, backgroundColor: selected ? palette.brandSoft : palette.surface }]}>
                        <Text style={[styles.productChipText, { color: selected ? palette.brand : palette.ink }]}>{code}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <View style={styles.offerFormGrid}>
                  <AppField
                    label={`Station price per litre (${offerCurrencyCode})`}
                    value={offerPrice}
                    onChangeText={setOfferPrice}
                    placeholder="e.g. 950"
                    keyboardType="decimal-pad"
                  />
                  <AppField
                    label="Minimum litres per order"
                    value={offerMinimumLitres}
                    onChangeText={setOfferMinimumLitres}
                    placeholder="1"
                    keyboardType="decimal-pad"
                  />
                  <AppField
                    label="Maximum litres per order"
                    value={offerMaximumLitres}
                    onChangeText={setOfferMaximumLitres}
                    placeholder="e.g. 200"
                    keyboardType="decimal-pad"
                  />
                </View>
                <View style={styles.offerModeList}>
                  <Text style={[styles.sectionLabel, { color: palette.ink }]}>Fulfilment modes available at this station</Text>
                  {([
                    ["station_managed", "Station Managed", "Your branch's own qualified driver and vehicle"],
                    ["independent_driver", "Independent Managed", "Independent qualified driver and own vehicle"],
                    ["skima_managed", "SKIMA Managed", "SKIMA driver programme and SKIMA fleet vehicle"],
                  ] as const).map(([mode, title, description]) => {
                    const modeControl = selectedProductModeControls.find((control) => firstString(control, ["fulfillment_mode"]) === mode);
                    const globalKnown = Boolean(modeControl);
                    const globallyEnabled = modeControl?.enabled === true;
                    const checked = offerModes.includes(mode);
                    return (
                      <Pressable
                        key={mode}
                        disabled={!globallyEnabled}
                        onPress={() => toggleOfferMode(mode)}
                        style={[styles.offerModeRow, { borderColor: checked ? palette.brand : palette.border, backgroundColor: checked ? palette.brandSoft : palette.surfaceSubtle, opacity: globallyEnabled ? 1 : 0.5 }]}
                      >
                        <View style={styles.offerModeCopy}>
                          <Text style={[styles.orderTitle, { color: palette.ink }]}>{title}</Text>
                          <Text style={[styles.muted, { color: palette.muted }]}>{!globalKnown ? "SKIMA's global setting could not be verified" : globallyEnabled ? description : "Disabled by SKIMA Admin · cannot be enabled by this station"}</Text>
                        </View>
                        <StatusPill label={!globalKnown ? "Unavailable" : !globallyEnabled ? "Globally off" : checked ? "On" : "Off"} tone={!globalKnown ? "warning" : !globallyEnabled ? "warning" : checked ? "success" : "neutral"} />
                      </Pressable>
                    );
                  })}
                </View>
                {offerNotice ? <Text style={[styles.successText, { color: palette.success }]}>{offerNotice}</Text> : null}
                {offerError ? <Text accessibilityRole="alert" style={[styles.errorText, { color: palette.danger }]}>{offerError}</Text> : null}
                <View style={styles.offerActionRow}>
                  <AppButton
                    label="Save & enable this product"
                    fullWidth
                    loading={saveStationOffer.isPending}
                    onPress={() => void saveStationProductOffer("active")}
                  />
                  {stationOfferForEditor?.status === "active" ? (
                    <AppButton
                      label="Pause at this station"
                      variant="secondary"
                      fullWidth
                      loading={saveStationOffer.isPending}
                      onPress={() => void saveStationProductOffer("paused")}
                    />
                  ) : null}
                </View>
              </>
            )}
          </Card>

          <Card title="Incoming Fuel orders" description="The station queue contains orders whose payment has already been reserved in escrow.">
            {sortedRows.length === 0 ? (
              <EmptyState icon={<Fuel size={27} />} title="No Fuel orders waiting" description="New paid Fuel orders will appear here." />
            ) : (
              <View style={styles.orderList}>
                {sortedRows.map((order) => {
                  const orderId = firstString(order, ["order_id"]) ?? "";
                  const productKey = firstString(order, ["product_key"]) ?? "";
                  const stage = firstString(order, ["stage_key"]) ?? "unknown";
                  const customerContact = nestedRecord(order, "customer_contact");
                  const customerName = firstString(customerContact, ["name"]) ?? "Customer contact unavailable";
                  const customerPhone = firstString(customerContact, ["phone"]);
                  const customerAddress = firstString(customerContact, ["address", "label"]) ?? "Delivery address not recorded";
                  const orderContainerMode = firstString(order, ["container_mode"]);
                  const selected = orderId === focusedOrderId;
                  return (
                    <Pressable key={orderId} onPress={() => { setFocusedOrderId(orderId); setSelectedDriverQualificationId(""); void reservations.refetch(); void allocations.refetch(); }} style={[styles.orderRow, { borderColor: selected ? palette.brand : palette.border, backgroundColor: selected ? palette.brandSoft : palette.surface }]}>
                      <View style={styles.orderCopy}>
                        <Text style={[styles.orderTitle, { color: palette.ink }]}>{productNameForKey(productKey)} · {firstNumber(order, ["requested_litres"]) ?? 0} L</Text>
                        <Text style={[styles.muted, { color: palette.muted }]}>{orderId.slice(0, 8).toUpperCase()} · {orderContainerMode === "exchange" ? "Container exchange" : orderContainerMode === "rental" ? "Rental container" : "Purchased container"}</Text>
                        <Text style={[styles.muted, { color: palette.ink }]}>{customerName} · {customerPhone ?? "Phone unavailable"}</Text>
                        <Text style={[styles.muted, { color: palette.muted }]} numberOfLines={2}>{customerAddress}</Text>
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
                <View style={[styles.focusIcon, { backgroundColor: palette.brandSoft }]}><Package size={22} /></View>
                <View style={styles.orderCopy}>
                  <Text style={[styles.orderTitle, { color: palette.ink }]}>{productNameForKey(focusedProduct)} · {focusedLitres} L</Text>
                  <Text style={[styles.muted, { color: palette.muted }]}>{focusedMode === "rental" ? "SKIMA rental containers" : focusedMode === "exchange" ? "Container exchange" : "Purchased containers"} · {firstNumber(focusedOrder, ["container_count"]) ?? 0} total</Text>
                </View>
                <StatusPill label={humanize(focusedStage)} tone={stageTone(focusedStage)} />
                <Text style={[styles.muted, { color: palette.muted }]}>{fulfillmentModeLabel(focusedFulfillmentMode)}</Text>
              </View>

              {focusedMode === "exchange" ? (
                <View style={styles.operationInfo}>
                  <Text style={[styles.muted, { color: palette.ink }]}>CONTAINER EXCHANGE: Prepare one filled SKIMA container matching the selected size. At delivery, the assigned driver must collect the customer's empty container and hand over this filled one. No container purchase, rental charge or deposit is applied.</Text>
                </View>
              ) : null}
              <View style={{ gap: spacing.xs, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surfaceSubtle }}>
                <Text style={[styles.sectionLabel, { color: palette.ink }]}>CUSTOMER DELIVERY DETAILS</Text>
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
                  <MapPin color={palette.brand} size={17} />
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={[styles.muted, { color: palette.ink }]}>{firstString(focusedCustomerContact, ["address", "label"]) ?? "Delivery address not recorded"}</Text>
                    {firstString(focusedCustomerContact, ["landmark"]) ? <Text style={[styles.muted, { color: palette.muted }]}>Landmark: {firstString(focusedCustomerContact, ["landmark"])}</Text> : null}
                    {firstString(focusedCustomerContact, ["instructions"]) ? <Text style={[styles.muted, { color: palette.muted }]}>Instructions: {firstString(focusedCustomerContact, ["instructions"])}</Text> : null}
                  </View>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[styles.muted, { color: palette.muted }]}>CUSTOMER CONTACT</Text>
                    <Text style={[styles.orderTitle, { color: palette.ink }]}>{firstString(focusedCustomerContact, ["name"]) ?? "Customer"}</Text>
                    <Text style={[styles.muted, { color: palette.ink }]}>{firstString(focusedCustomerContact, ["phone"]) ?? "Phone number unavailable"}</Text>
                  </View>
                  {firstString(focusedCustomerContact, ["phone"]) ? <AppButton label="Call customer" size="sm" variant="secondary" onPress={() => void Linking.openURL("tel:" + firstString(focusedCustomerContact, ["phone"])).catch(() => undefined)} icon={<PhoneCall color={palette.brand} size={15} />} /> : null}
                </View>
              </View>

              {focusedSettlementExecutionId ? (
                <View style={styles.operationInfo}>
                  <StatusPill label="Station settlement posted" tone="success" />
                  {focusedSettledAt ? <Text style={[styles.muted, { color: palette.muted }]}>Posted {new Date(focusedSettledAt).toLocaleString()}</Text> : null}
                  {focusedSettlementStatementId ? <Text style={[styles.muted, { color: palette.muted }]}>Statement reference · {focusedSettlementStatementId.slice(0, 8).toUpperCase()}</Text> : null}
                </View>
              ) : null}

              {focusedStage === "awaiting_station_acceptance" ? (
                <AppButton label="Accept order & reserve full tank stock" fullWidth loading={busyOrderId === focusedOrderId || reserveBatch.isPending} onPress={() => void startOrderPreparation(focusedOrder)} icon={<ShieldCheck color="#FFFFFF" size={18} />} />
              ) : null}

              {focusedStage === "stock_reserved" ? (
                <Text style={[styles.muted, { color: palette.muted }]}>Full stock reservation recorded. Station filling has started automatically.</Text>
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

              {focusedStage === "ready_for_driver" && focusedFulfillmentMode === "station_managed" ? (
                <>
                  <Text style={[styles.sectionLabel, { color: palette.ink }]}>Station Managed driver and vehicle</Text>
                  <Text style={[styles.muted, { color: palette.muted }]}>This is your station's own driver. Select only a Station Managed driver registered to this branch and a vehicle qualified for this fuel product and load.</Text>
                  {readyQualifications.length === 0 ? (
                    <EmptyState title="No approved Station Managed driver" description="Approve a Station Managed driver identity, this branch's vehicle and the product/load qualification before assigning the order." />
                  ) : (
                    <View style={styles.orderList}>
                      {readyQualifications.map((qualification) => {
                        const id = firstString(qualification, ["id"]) ?? "";
                        const selected = selectedQualification?.id === id;
                        const driverId = firstString(qualification, ["station_managed_driver_id"]) ?? "";
                        const vehicleId = firstString(qualification, ["vehicle_id"]) ?? "";
                        const vehicle = (vehicles.data ?? []).find((row) => firstString(row, ["id"]) === vehicleId);
                        const vehicleLabel = firstString(vehicle, ["registration_number", "registrationNumber", "plate_number", "plateNumber"]) ?? vehicleId.slice(0, 8).toUpperCase();
                        return (
                          <Pressable key={id} onPress={() => setSelectedDriverQualificationId(id)} style={[styles.driverRow, { borderColor: selected ? palette.brand : palette.border, backgroundColor: selected ? palette.brandSoft : palette.surface }]}>
                            <Truck size={19} />
                            <View style={styles.orderCopy}>
                              <Text style={[styles.orderTitle, { color: palette.ink }]}>Station driver {driverId.slice(0, 8).toUpperCase()}</Text>
                              <Text style={[styles.muted, { color: palette.muted }]}>{vehicleLabel} · up to {firstNumber(qualification, ["maximum_load_litres"])} L</Text>
                            </View>
                            {selected ? <CheckCircle2 size={19} /> : null}
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                  <AppButton label="Assign station driver" fullWidth disabled={!selectedQualification} loading={busyOrderId === focusedOrderId || assignDriver.isPending} onPress={() => void assignQualifiedDriver()} />
                </>
              ) : null}
              {focusedStage === "ready_for_driver" && focusedFulfillmentMode === "independent_driver" ? (
                <View style={styles.operationInfo}>
                  <StatusPill label="Independent Managed · SKIMA dispatch" tone="brand" />
                  <Text style={[styles.muted, { color: palette.ink }]}>This provider is not a station employee and does not use a SKIMA fleet vehicle. SKIMA Dispatch must assign an approved Independent Managed provider and their own qualified vehicle. You can hand over the containers after the driver has been assigned.</Text>
                </View>
              ) : null}
              {focusedStage === "ready_for_driver" && focusedFulfillmentMode === "skima_managed" ? (
                <View style={styles.operationInfo}>
                  <StatusPill label="SKIMA Managed / SKIMA Fleet · SKIMA dispatch" tone="brand" />
                  <Text style={[styles.muted, { color: palette.ink }]}>This is a SKIMA internal driver using an assigned SKIMA-owned fleet vehicle. It is not a station employee or an Independent Managed provider. SKIMA Dispatch assigns this driver and vehicle before you hand over the containers.</Text>
                </View>
              ) : null}

              {focusedStage === "driver_assigned" ? (
                <View style={{ gap: spacing.sm }}>
                  <Text style={[styles.muted, { color: palette.ink }]}>Check the driver and vehicle identity, then hand over all filled containers. This confirmation records the container custody handoff and starts the delivery for the driver.</Text>
                  <AppButton label="Hand over containers & start delivery" fullWidth loading={busyOrderId === focusedOrderId || recordHandover.isPending || changeStage.isPending} onPress={() => void handContainersToDriver()} />
                </View>
              ) : null}

              {focusedStage === "received_at_station" ? (
                <View style={styles.inspectionList}>
                  <Text style={[styles.sectionLabel, { color: palette.ink }]}>Inspect returned SKIMA containers</Text>
                  {existingAllocations.filter((row) => firstString(row, ["status"]) === "inspection").map((allocation) => (
                    <View key={firstString(allocation, ["id"])} style={[styles.inspectionRow, { borderColor: palette.border }]}>
                      <View style={styles.orderCopy}>
                        <Text style={[styles.orderTitle, { color: palette.ink }]}>Container {firstString(allocation, ["container_profile_id"])?.slice(0, 8).toUpperCase()}</Text>
                        <Text style={[styles.muted, { color: palette.muted }]}>{firstNumber(allocation, ["allocated_litres"])} L · Rental return received</Text>
                      </View>
                      <AppButton label="Pass" size="sm" onPress={() => void recordContainerInspection(allocation, "passed")} loading={busyOrderId === focusedOrderId || inspectContainer.isPending} />
                      <AppButton label="Fail" size="sm" variant="secondary" onPress={() => void recordContainerInspection(allocation, "failed")} loading={busyOrderId === focusedOrderId || inspectContainer.isPending} />
                    </View>
                  ))}
                  {existingAllocations.every((row) => firstString(row, ["status"]) !== "inspection") ? (
                    <Text style={[styles.muted, { color: palette.muted }]}>All returned containers have inspection outcomes recorded.</Text>
                  ) : null}
                </View>
              ) : null}

              {["station_handover","out_for_delivery","delivered","return_due","returned_to_driver","received_at_station","inspection_passed","completed","exception"].includes(focusedStage) ? (
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

function fulfillmentModeLabel(value: string): string {
  switch (value) {
    case "station_managed": return "Station Managed · station driver and branch-controlled vehicle";
    case "independent_driver": return "Independent Managed · independent provider and own vehicle";
    case "skima_managed": return "SKIMA Managed / SKIMA Fleet · internal SKIMA driver and fleet vehicle";
    default: return "Fuel fulfilment mode not resolved";
  }
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
  productChipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  productChip: { flexDirection: "row", alignItems: "center", gap: spacing.xs, borderWidth: 1, borderRadius: radii.lg, paddingVertical: 9, paddingHorizontal: 11 },
  currencyChip: { borderWidth: 1, borderRadius: radii.md, paddingVertical: 7, paddingHorizontal: 12 },
  productChipText: { ...typography.bodyStrong, fontSize: 12 },
  offerFormGrid: { gap: spacing.sm },
  offerModeList: { gap: spacing.sm },
  offerModeRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderRadius: radii.lg, padding: 11 },
  offerModeCopy: { flex: 1, gap: 3 },
  offerActionRow: { gap: spacing.sm },
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
  inspectionList: { gap: spacing.sm },
  inspectionRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderRadius: radii.lg, padding: 10 },
});
