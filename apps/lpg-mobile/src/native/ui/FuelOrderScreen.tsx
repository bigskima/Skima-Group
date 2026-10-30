import { router } from "expo-router";
import { Fuel, Gauge, MapPin, Package, ShieldCheck, WalletCards, Truck, CheckCircle2 } from "lucide-react-native";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { domainQueries } from "../api/domains";
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
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { selectWorkspaceWallet } from "../utilities/financeWallet";
import { friendlyError } from "../utilities/friendlyError";
import { idempotencyKey } from "../utilities/idempotency";
import { AppButton } from "./AppButton";
import { AppField } from "./AppField";
import { Card } from "./Card";
import { EmptyState } from "./EmptyState";
import { Screen } from "./Screen";
import { StatusPill } from "./StatusPill";

type ProductKey = "fuel.pms" | "fuel.ago" | "fuel.dpk";
type ContainerMode = "purchase" | "rental";
type FulfillmentMode = "station_managed" | "independent_driver" | "skima_managed";

type CreatedQuote = {
  orderId: string;
  serviceRequestId: string;
  priceQuoteId: string;
  currencyCode: string;
  totalAmount: number;
  subtotalAmount: number;
  feeAmount: number;
  taxAmount: number;
  expiresAt: string | null;
  containerCount: number;
  componentSnapshot: PlatformRecord;
};

const productLabels: Record<ProductKey, { title: string; subtitle: string; icon: string }> = {
  "fuel.pms": { title: "Petrol", subtitle: "PMS", icon: "P" },
  "fuel.ago": { title: "Diesel", subtitle: "AGO", icon: "D" },
  "fuel.dpk": { title: "Kerosene", subtitle: "DPK", icon: "K" },
};

export function FuelOrderScreen() {
  const { palette } = useAppTheme();
  const products = useGatewayQuery({
    key: ["fuel", "products"],
    path: "/runtime/fuel/products",
    schema: RecordArraySchema,
    refetchInterval: 30000,
  });
  const offers = useGatewayQuery({
    key: ["fuel", "offers"],
    path: "/runtime/fuel/offers",
    schema: RecordArraySchema,
    refetchInterval: 30000,
  });
  const containerTypes = useGatewayQuery({
    key: ["fuel", "container-types"],
    path: "/runtime/fuel/container-types",
    schema: RecordArraySchema,
    refetchInterval: 60000,
  });
  const locations = domainQueries.locations();
  const wallets = domainQueries.wallets();

  const createOrder = useGatewayMutation({
    path: "/runtime/fuel/orders",
    schema: ActionResponseSchema,
    invalidate: [["fuel", "orders"], ["orders"], ["wallets"]],
  });
  const acceptQuote = useGatewayMutation({
    path: "/runtime/pricing/quotes/accept",
    schema: ActionResponseSchema,
    invalidate: [["fuel", "orders"]],
  });
  const payOrder = useGatewayMutation({
    path: "/runtime/fuel/orders/pay",
    schema: ActionResponseSchema,
    invalidate: [["fuel", "orders"], ["orders"], ["wallets"]],
  });

  const activeProducts = (products.data ?? []).filter((item) =>
    firstString(item, ["status"]) === "enabled" &&
    ["fuel.pms", "fuel.ago", "fuel.dpk"].includes(firstString(item, ["key"]) ?? "")
  );
  const selectedProductRecord = activeProducts.find((item) => firstString(item, ["key"]) === selectedProductKey);
  const selectedProductPrecision = firstNumber(selectedProductRecord, ["quantity_precision"]) ?? 2;
  const customerWallet = selectWorkspaceWallet(wallets.data ?? [], "customer");
  const walletId = firstString(customerWallet, ["wallet_id", "walletId", "id"]);
  const currencyCode = firstString(customerWallet, ["currency_code", "currencyCode"]) ?? "NGN";
  const walletBalance = firstNumber(customerWallet, ["available_balance", "availableBalance", "balance"]) ?? 0;

  const [selectedProductKey, setSelectedProductKey] = useState<ProductKey>("fuel.pms");
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [litresInput, setLitresInput] = useState("");
  const [containerMode, setContainerMode] = useState<ContainerMode>("rental");
  const [containerTypeKey, setContainerTypeKey] = useState("");
  const [fulfillmentMode, setFulfillmentMode] = useState<FulfillmentMode>("independent_driver");
  const [deliveryLocationId, setDeliveryLocationId] = useState("");
  const [instructions, setInstructions] = useState("");
  const [createdQuote, setCreatedQuote] = useState<CreatedQuote | null>(null);
  const [paid, setPaid] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const activeOffers = (offers.data ?? []).filter((item) =>
    firstString(item, ["status"]) === "active" &&
    firstString(item, ["product_key"]) === selectedProductKey &&
    firstString(item, ["currency_code"]) === currencyCode
  );
  const selectedOffer = activeOffers.find((item) => firstString(item, ["branch_id"]) === selectedBranchId) ?? activeOffers[0] ?? null;
  const branchId = selectedOffer ? firstString(selectedOffer, ["branch_id"]) : null;
  const branchInfo = selectedOffer ? nestedRecord(selectedOffer, "branch") : null;
  const branchName = firstString(branchInfo, ["display_name", "key"]) ??
    firstString(selectedOffer, ["branch_name", "station_name"]) ??
    (branchId ? "SKIMA station" : "Select a station");
  const branchAddress = firstString(branchInfo, ["address"]) ??
    firstString(selectedOffer, ["address", "formatted_address"]) ?? "";

  const compatibleContainerTypes = (containerTypes.data ?? []).filter((item) =>
    firstString(item, ["status"]) === "active" &&
    Array.isArray(item.supported_product_keys) &&
    item.supported_product_keys.includes(selectedProductKey)
  );
  const selectedContainerType = compatibleContainerTypes.find((item) =>
    firstString(item, ["key"]) === containerTypeKey
  ) ?? compatibleContainerTypes[0] ?? null;

  const savedLocations = locations.data ?? [];
  const selectedLocation = savedLocations.find((item) =>
    firstString(item, ["id"]) === deliveryLocationId
  ) ?? savedLocations[0] ?? null;
  const chosenLocationId = selectedLocation ? firstString(selectedLocation, ["id"]) : null;
  const requestedLitres = litresInput.trim() ? Number(litresInput) : null;
  const nominalCapacity = selectedContainerType ? firstNumber(selectedContainerType, ["nominal_capacity_litres"]) : null;
  const containerCount = requestedLitres !== null && nominalCapacity && requestedLitres > 0
    ? Math.ceil(requestedLitres / nominalCapacity)
    : 0;
  const minLitres = selectedOffer ? firstNumber(selectedOffer, ["minimum_litres"]) : null;
  const maxLitres = selectedOffer ? firstNumber(selectedOffer, ["maximum_litres"]) : null;
  const pricePerLitre = selectedOffer ? firstNumber(selectedOffer, ["price_per_litre"]) : null;
  const containerCost = selectedOffer
    ? firstNumber(selectedOffer, [containerMode === "purchase" ? "container_purchase_amount" : "container_rental_amount"]) ?? 0
    : 0;
  const depositPerContainer = containerMode === "rental" && selectedOffer
    ? firstNumber(selectedOffer, ["refundable_deposit_amount"]) ?? 0
    : 0;
  const estimatedTotal = selectedOffer && requestedLitres && requestedLitres > 0
    ? requestedLitres * (pricePerLitre ?? 0) +
      containerCount * containerCost +
      (firstNumber(selectedOffer, ["driver_delivery_fee_amount"]) ?? 0) +
      (firstNumber(selectedOffer, ["platform_fee_amount"]) ?? 0) +
      containerCount * depositPerContainer
    : null;
  const allowedFulfillmentModes = selectedOffer && Array.isArray(selectedOffer.fulfillment_modes)
    ? selectedOffer.fulfillment_modes.filter((value): value is FulfillmentMode =>
        ["station_managed", "independent_driver", "skima_managed"].includes(String(value))
      )
    : [];
  const hasProductOffer = activeOffers.length > 0;

  const validationError = useMemo(() => {
    if (!selectedProductRecord) return "No fuel product is currently enabled for ordering.";
    if (!selectedOffer || !branchId) return "Choose a station that currently offers this fuel product.";
    if (requestedLitres === null || !Number.isFinite(requestedLitres) || requestedLitres <= 0) return "Enter the number of litres you need.";
    if (requestedLitres < (minLitres ?? 0) || (maxLitres !== null && requestedLitres > maxLitres)) {
      return `This station accepts between ${minLitres ?? 0} and ${maxLitres ?? "its configured maximum"} litres.`;
    }
    const decimals = litresInput.split(".")[1]?.length ?? 0;
    if (decimals > selectedProductPrecision) return `Enter no more than ${selectedProductPrecision} decimal places.`;
    if (!selectedContainerType || !nominalCapacity) return "Choose a compatible delivery container.";
    if (!allowedFulfillmentModes.includes(fulfillmentMode)) return "Choose a fulfilment option supported by this station.";
    if (!chosenLocationId) return "Add or select a saved delivery location before placing the order.";
    if (!walletId) return `An active ${currencyCode} customer wallet is required to pay for this order.`;
    return null;
  }, [selectedProductRecord, selectedOffer, branchId, requestedLitres, minLitres, maxLitres, litresInput, selectedProductPrecision, selectedContainerType, nominalCapacity, allowedFulfillmentModes, fulfillmentMode, chosenLocationId, walletId, currencyCode]);

  const createQuote = async () => {
    if (validationError || !selectedOffer || !branchId || !requestedLitres || !selectedContainerType || !chosenLocationId) {
      setLocalError(validationError ?? "Check the order details and try again.");
      return;
    }
    setLocalError(null);
    setPaid(false);
    setCreatedQuote(null);
    try {
      const result = await createOrder.mutateAsync({
        branchId,
        productKey: selectedProductKey,
        requestedLitres,
        containerMode,
        containerTypeKey: firstString(selectedContainerType, ["key"]),
        fulfillmentMode,
        currencyCode,
        idempotencyKey: idempotencyKey("fuel-order", `${selectedProductKey}:${branchId}:${requestedLitres}:${containerMode}:${Date.now()}`),
        deliveryLocationId: chosenLocationId,
        deliveryInstructions: instructions.trim() || null,
        metadata: {},
      });
      const record = asRecord(result);
      const orderId = firstString(record, ["order_id", "orderId"]);
      const priceQuoteId = firstString(record, ["price_quote_id", "priceQuoteId"]);
      if (!orderId || !priceQuoteId) throw new Error("The Fuel order was created but the server did not return its quote reference.");
      const snapshot = nestedRecord(record, "component_snapshot") ?? {};
      setCreatedQuote({
        orderId,
        serviceRequestId: firstString(record, ["service_request_id", "serviceRequestId"]) ?? "",
        priceQuoteId,
        currencyCode: firstString(record, ["currency_code", "currencyCode"]) ?? currencyCode,
        totalAmount: firstNumber(record, ["total_amount", "totalAmount"]) ?? 0,
        subtotalAmount: firstNumber(record, ["subtotal_amount", "subtotalAmount"]) ?? 0,
        feeAmount: firstNumber(record, ["fee_amount", "feeAmount"]) ?? 0,
        taxAmount: firstNumber(record, ["tax_amount", "taxAmount"]) ?? 0,
        expiresAt: firstString(record, ["expires_at", "expiresAt"]),
        containerCount: firstNumber(record, ["container_count", "containerCount"]) ?? containerCount,
        componentSnapshot: snapshot,
      });
    } catch (error) {
      setLocalError(friendlyError(error, "SKIMA could not prepare this Fuel order. No payment has been taken."));
    }
  };

  const acceptAndPay = async () => {
    if (!createdQuote || !walletId || paid) return;
    setLocalError(null);
    try {
      await acceptQuote.mutateAsync({
        priceQuoteId: createdQuote.priceQuoteId,
        idempotencyKey: idempotencyKey("fuel-quote-accept", createdQuote.orderId),
        metadata: { module_key: "fuel", order_id: createdQuote.orderId },
      });
      await payOrder.mutateAsync({
        orderId: createdQuote.orderId,
        walletId,
        idempotencyKey: idempotencyKey("fuel-order-payment", createdQuote.orderId),
      });
      setPaid(true);
    } catch (error) {
      setLocalError(friendlyError(error, "Payment did not complete. Your order is saved and you can retry payment."));
    }
  };

  const refreshAll = () => void Promise.all([products.refetch(), offers.refetch(), containerTypes.refetch(), locations.refetch(), wallets.refetch()]);
  const loading = products.isPending || offers.isPending || containerTypes.isPending || wallets.isPending || locations.isPending;
  const loadingError = products.error || offers.error || containerTypes.error || wallets.error || locations.error;

  return (
    <Screen
      eyebrow="SKIMA Fuel"
      title="Order fuel"
      subtitle="Choose petrol, diesel or kerosene, set your litres and select a container option for delivery."
      action={<AppButton label="My orders" size="sm" variant="secondary" onPress={() => router.push("/(customer)/orders" as never)} />}
    >
      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={palette.brand} />
          <Text style={[styles.muted, { color: palette.muted }]}>Loading live fuel products and station offers…</Text>
        </View>
      ) : loadingError ? (
        <EmptyState
          title="Fuel offers could not be loaded"
          description="Refresh and try again. Existing LPG ordering is not affected."
          action={<AppButton label="Try again" onPress={refreshAll} />}
        />
      ) : paid && createdQuote ? (
        <Card variant="success" title="Fuel order funded" description="Your wallet payment has been reserved in escrow. The station can now confirm and prepare your order.">
          <View style={styles.successRow}>
            <CheckCircle2 color={palette.success} size={28} />
            <View style={styles.flex}>
              <Text style={[styles.cardTitle, { color: palette.ink }]}>{createdQuote.orderId.slice(0, 8).toUpperCase()}</Text>
              <Text style={[styles.muted, { color: palette.muted }]}>{productLabels[selectedProductKey].title} · {requestedLitres ?? 0} L</Text>
            </View>
            <StatusPill label="Payment reserved" tone="success" />
          </View>
          <AppButton label="View my Fuel orders" fullWidth onPress={() => router.push("/(customer)/fuel-orders" as never)} />
        </Card>
      ) : createdQuote ? (
        <Card title="Review your price" eyebrow="SERVER-CALCULATED QUOTE" description="The station price and all configured charges are locked in this quote before you pay.">
          <Text style={[styles.orderReference, { color: palette.ink }]}>{createdQuote.orderId.slice(0, 8).toUpperCase()}</Text>
          <Text style={[styles.muted, { color: palette.muted }]}>{productLabels[selectedProductKey].title} · {requestedLitres} L · {createdQuote.containerCount} container(s)</Text>
          <View style={[styles.breakdown, { borderColor: palette.border }]}>
            <PriceRow label="Fuel" value={firstNumber(createdQuote.componentSnapshot, ["fuel_amount"]) ?? 0} currency={createdQuote.currencyCode} />
            <PriceRow label={containerMode === "purchase" ? "Container purchase" : "Container rental"} value={firstNumber(createdQuote.componentSnapshot, ["container_amount"]) ?? 0} currency={createdQuote.currencyCode} />
            <PriceRow label="Delivery" value={firstNumber(createdQuote.componentSnapshot, ["driver_delivery_fee_amount"]) ?? 0} currency={createdQuote.currencyCode} />
            <PriceRow label="Platform fee" value={firstNumber(createdQuote.componentSnapshot, ["platform_fee_amount"]) ?? 0} currency={createdQuote.currencyCode} />
            <PriceRow label="Tax" value={firstNumber(createdQuote.componentSnapshot, ["tax_amount"]) ?? createdQuote.taxAmount} currency={createdQuote.currencyCode} />
            {containerMode === "rental" ? (
              <PriceRow label="Refundable container deposit" value={firstNumber(createdQuote.componentSnapshot, ["refundable_deposit_amount"]) ?? 0} currency={createdQuote.currencyCode} muted />
            ) : null}
            <View style={[styles.totalRow, { borderTopColor: palette.border }]}>
              <Text style={[styles.totalLabel, { color: palette.ink }]}>Total to pay</Text>
              <Text style={[styles.totalValue, { color: palette.brand }]}>{money(createdQuote.totalAmount, createdQuote.currencyCode)}</Text>
            </View>
          </View>
          <Text style={[styles.muted, { color: palette.muted }]}>
            {containerMode === "rental"
              ? "The deposit remains refundable under the rental return and inspection policy. Your container remains SKIMA-owned."
              : "The purchased container becomes yours after verified delivery."}
          </Text>
          <View style={[styles.walletSummary, { backgroundColor: palette.surfaceSubtle }]}>
            <WalletCards color={palette.brand} size={20} />
            <View style={styles.flex}>
              <Text style={[styles.cardTitle, { color: palette.ink }]}>Available wallet balance</Text>
              <Text style={[styles.muted, { color: palette.muted }]}>{money(walletBalance, currencyCode)}</Text>
            </View>
          </View>
          {localError ? <Text style={[styles.error, { color: palette.danger }]}>{localError}</Text> : null}
          <AppButton
            label={walletBalance >= createdQuote.totalAmount ? "Accept quote & pay" : "Insufficient wallet balance"}
            fullWidth
            loading={acceptQuote.isPending || payOrder.isPending}
            disabled={walletBalance < createdQuote.totalAmount || !walletId}
            onPress={() => void acceptAndPay()}
            icon={<ShieldCheck color="#FFFFFF" size={18} />}
          />
          <AppButton label="Edit order" variant="ghost" fullWidth onPress={() => setCreatedQuote(null)} />
        </Card>
      ) : (
        <>
          <Card title="Choose your fuel" description="Only products enabled for SKIMA orders are shown.">
            <View style={styles.productRow}>
              {activeProducts.map((product) => {
                const key = firstString(product, ["key"]) as ProductKey;
                const selected = selectedProductKey === key;
                const label = productLabels[key];
                if (!label) return null;
                return (
                  <Pressable key={key} onPress={() => { setSelectedProductKey(key); setSelectedBranchId(""); setCreatedQuote(null); }} style={[styles.productOption, { backgroundColor: selected ? palette.brandSoft : palette.surfaceSubtle, borderColor: selected ? palette.brand : palette.border }]}>
                    <View style={[styles.productMark, { backgroundColor: selected ? palette.brand : palette.surface }]}>
                      <Text style={[styles.productLetter, { color: selected ? "#FFFFFF" : palette.brand }]}>{label.icon}</Text>
                    </View>
                    <Text style={[styles.productName, { color: palette.ink }]}>{label.title}</Text>
                    <Text style={[styles.muted, { color: palette.muted }]}>{label.subtitle}</Text>
                  </Pressable>
                );
              })}
            </View>
            {activeProducts.length === 0 ? <Text style={[styles.muted, { color: palette.muted }]}>Fuel ordering has not been enabled by SKIMA yet.</Text> : null}
          </Card>

          <Card title="Select a station" description={`Live offers in ${currencyCode}.`}>
            {activeOffers.length === 0 ? (
              <Text style={[styles.muted, { color: palette.muted }]}>No stations currently offer this fuel product in your wallet currency.</Text>
            ) : (
              <View style={styles.optionList}>
                {activeOffers.map((offer) => {
                  const id = firstString(offer, ["branch_id"]) ?? "";
                  const branch = nestedRecord(offer, "branch");
                  const name = firstString(branch, ["display_name", "key"]) ?? "SKIMA station";
                  const selected = id === (selectedBranchId || firstString(selectedOffer, ["branch_id"]));
                  const address = addressText(branch?.address) || "Station branch";
                  return (
                    <Pressable key={id} onPress={() => { setSelectedBranchId(id); setCreatedQuote(null); }} style={[styles.stationOption, { borderColor: selected ? palette.brand : palette.border, backgroundColor: selected ? palette.brandSoft : palette.surface }]}>
                      <View style={[styles.stationIcon, { backgroundColor: selected ? palette.brand : palette.surfaceSubtle }]}>
                        <MapPin color={selected ? "#FFFFFF" : palette.brand} size={19} />
                      </View>
                      <View style={styles.flex}>
                        <Text style={[styles.cardTitle, { color: palette.ink }]}>{name}</Text>
                        <Text style={[styles.muted, { color: palette.muted }]}>{address}</Text>
                        <Text style={[styles.priceText, { color: palette.brand }]}>{money(firstNumber(offer, ["price_per_litre"]) ?? 0, currencyCode)} / L</Text>
                      </View>
                      {selected ? <CheckCircle2 color={palette.success} size={21} /> : null}
                    </Pressable>
                  );
                })}
              </View>
            )}
          </Card>

          <Card title="How much do you need?" description="The station's configured minimum and maximum are enforced when SKIMA creates the quote.">
            <AppField
              label="Fuel quantity (litres)"
              value={litresInput}
              onChangeText={(value) => { setLitresInput(value.replace(/[^0-9.]/g, "")); setCreatedQuote(null); }}
              placeholder="e.g. 20"
              keyboardType="decimal-pad"
              hint={minLitres !== null && maxLitres !== null ? `This station accepts ${minLitres}–${maxLitres} litres.` : "Enter the amount you need in litres."}
            />
            <View style={styles.quickQuantityRow}>
              {[5, 10, 20, 25, 50].map((value) => (
                <Pressable key={value} onPress={() => { setLitresInput(String(value)); setCreatedQuote(null); }} style={[styles.quickQuantity, { borderColor: palette.border, backgroundColor: requestedLitres === value ? palette.brandSoft : palette.surface }]}>
                  <Text style={[styles.quickQuantityText, { color: requestedLitres === value ? palette.brand : palette.ink }]}>{value} L</Text>
                </Pressable>
              ))}
            </View>
          </Card>

          <Card title="Choose a container" description="You can buy one and keep it, or rent a SKIMA-owned container for a lower fee.">
            <View style={styles.modeRow}>
              <ModeOption title="Rent" subtitle="Return after transfer" active={containerMode === "rental"} onPress={() => { setContainerMode("rental"); setCreatedQuote(null); }} />
              <ModeOption title="Buy" subtitle="Keep the container" active={containerMode === "purchase"} onPress={() => { setContainerMode("purchase"); setCreatedQuote(null); }} />
            </View>
            <View style={styles.optionList}>
              {compatibleContainerTypes.map((type) => {
                const key = firstString(type, ["key"]) ?? "";
                const selected = key === (containerTypeKey || firstString(selectedContainerType, ["key"]));
                const capacity = firstNumber(type, ["nominal_capacity_litres"]) ?? 0;
                return (
                  <Pressable key={key} onPress={() => { setContainerTypeKey(key); setCreatedQuote(null); }} style={[styles.typeOption, { borderColor: selected ? palette.brand : palette.border, backgroundColor: selected ? palette.brandSoft : palette.surface }]}>
                    <Package color={selected ? palette.brand : palette.muted} size={20} />
                    <View style={styles.flex}>
                      <Text style={[styles.cardTitle, { color: palette.ink }]}>{firstString(type, ["display_name"]) ?? key}</Text>
                      <Text style={[styles.muted, { color: palette.muted }]}>{capacity} L capacity</Text>
                    </View>
                    {selected ? <CheckCircle2 color={palette.success} size={20} /> : null}
                  </Pressable>
                );
              })}
            </View>
            {containerCount > 0 ? (
              <View style={[styles.containerSummary, { backgroundColor: palette.surfaceSubtle }]}>
                <Gauge color={palette.brand} size={19} />
                <Text style={[styles.muted, { color: palette.ink }]}>
                  {containerCount} container(s) required for {requestedLitres} L
                </Text>
              </View>
            ) : null}
            {containerMode === "rental" ? (
              <Text style={[styles.muted, { color: palette.muted }]}>Your rental container is due back to the driver after you transfer the fuel. It returns to service only after station inspection.</Text>
            ) : (
              <Text style={[styles.muted, { color: palette.muted }]}>Container ownership transfers to you after verified delivery.</Text>
            )}
          </Card>

          <Card title="Delivery details" description="Choose how SKIMA should fulfil this order.">
            <View style={styles.optionList}>
              {allowedFulfillmentModes.map((mode) => (
                <ModeOption
                  key={mode}
                  title={mode === "station_managed" ? "Station Managed" : mode === "skima_managed" ? "SKIMA Managed" : "Independent driver"}
                  subtitle={mode === "station_managed" ? "The station's approved driver delivers" : mode === "skima_managed" ? "SKIMA assigns its managed delivery team" : "An approved independent driver delivers"}
                  active={fulfillmentMode === mode}
                  onPress={() => { setFulfillmentMode(mode); setCreatedQuote(null); }}
                />
              ))}
            </View>
            <Text style={[styles.label, { color: palette.ink }]}>Delivery location</Text>
            {savedLocations.length === 0 ? (
              <EmptyState title="Add a delivery location" description="Save your delivery address before ordering fuel." action={<AppButton label="Add location" onPress={() => router.push("/(customer)/locations" as never)} />} />
            ) : (
              <View style={styles.optionList}>
                {savedLocations.map((location) => {
                  const locationId = firstString(location, ["id"]) ?? "";
                  const selected = locationId === (deliveryLocationId || chosenLocationId);
                  return (
                    <Pressable key={locationId} onPress={() => { setDeliveryLocationId(locationId); setCreatedQuote(null); }} style={[styles.locationOption, { backgroundColor: selected ? palette.brandSoft : palette.surfaceSubtle, borderColor: selected ? palette.brand : palette.border }]}>
                      <MapPin color={selected ? palette.brand : palette.muted} size={17} />
                      <View style={styles.flex}>
                        <Text style={[styles.cardTitle, { color: palette.ink }]}>{firstString(location, ["label", "name", "title"]) ?? "Saved address"}</Text>
                        <Text style={[styles.muted, { color: palette.muted }]}>{addressText(location)}</Text>
                      </View>
                      {selected ? <CheckCircle2 color={palette.success} size={18} /> : null}
                    </Pressable>
                  );
                })}
              </View>
            )}
            <AppField label="Delivery instructions" value={instructions} onChangeText={setInstructions} placeholder="Gate, landmark or handover details" multiline optional />
          </Card>

          {selectedOffer && requestedLitres !== null && requestedLitres > 0 ? (
            <Card title="Estimated total" description="Final pricing is calculated and confirmed by SKIMA before payment.">
              <View style={styles.estimateRow}>
                <Text style={[styles.estimateTotal, { color: palette.brand }]}>{estimatedTotal === null ? "—" : money(estimatedTotal, currencyCode)}</Text>
                <Text style={[styles.muted, { color: palette.muted }]}>{containerCount} container(s) · {currencyCode}</Text>
              </View>
              <Text style={[styles.muted, { color: palette.muted }]}>This is an estimate from the current station offer. The server quote shown next is authoritative.</Text>
            </Card>
          ) : null}

          {validationError ? <Text style={[styles.error, { color: palette.danger }]}>{validationError}</Text> : null}
          {localError ? <Text accessibilityRole="alert" style={[styles.error, { color: palette.danger }]}>{localError}</Text> : null}
          <AppButton
            label="Get secure price quote"
            fullWidth
            loading={createOrder.isPending}
            disabled={Boolean(validationError) || !hasProductOffer}
            onPress={() => void createQuote()}
            icon={<ShieldCheck color="#FFFFFF" size={18} />}
          />
        </>
      )}
    </Screen>
  );
}

function ModeOption({ title, subtitle, active, onPress }: {
  title: string;
  subtitle: string;
  active: boolean;
  onPress: () => void;
}) {
  const { palette } = useAppTheme();
  return (
    <Pressable onPress={onPress} style={[styles.modeOption, { borderColor: active ? palette.brand : palette.border, backgroundColor: active ? palette.brandSoft : palette.surface }]}>
      <View style={styles.flex}>
        <Text style={[styles.cardTitle, { color: palette.ink }]}>{title}</Text>
        <Text style={[styles.muted, { color: palette.muted }]}>{subtitle}</Text>
      </View>
      {active ? <CheckCircle2 color={palette.success} size={19} /> : <View style={[styles.radio, { borderColor: palette.borderStrong }]} />}
    </Pressable>
  );
}

function PriceRow({ label, value, currency, muted = false }: { label: string; value: number; currency: string; muted?: boolean }) {
  const { palette } = useAppTheme();
  return (
    <View style={styles.priceRow}>
      <Text style={[styles.muted, { color: muted ? palette.muted : palette.ink }]}>{label}</Text>
      <Text style={[styles.priceAmount, { color: muted ? palette.muted : palette.ink }]}>{money(value, currency)}</Text>
    </View>
  );
}

function asRecord(value: unknown): PlatformRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as PlatformRecord : {};
}

function addressText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as PlatformRecord;
    return [record.street, record.city, record.area, record.state, record.formatted_address]
      .filter((part): part is string => typeof part === "string" && Boolean(part.trim()))
      .join(", ");
  }
  return "";
}

function money(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

const styles = StyleSheet.create({
  loading: { minHeight: 190, alignItems: "center", justifyContent: "center", gap: spacing.md },
  productRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  productOption: { flexGrow: 1, minWidth: 92, alignItems: "center", gap: 5, borderWidth: 1, borderRadius: radii.lg, paddingVertical: 13, paddingHorizontal: 9 },
  productMark: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  productLetter: { fontSize: 18, fontWeight: "900" },
  productName: { ...typography.bodyStrong, fontSize: 13 },
  optionList: { gap: spacing.sm },
  stationOption: { flexDirection: "row", gap: spacing.md, alignItems: "center", borderWidth: 1, borderRadius: radii.lg, padding: 12 },
  stationIcon: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  typeOption: { flexDirection: "row", gap: spacing.md, alignItems: "center", borderWidth: 1, borderRadius: radii.lg, padding: 12 },
  locationOption: { flexDirection: "row", gap: spacing.sm, alignItems: "center", borderWidth: 1, borderRadius: radii.md, padding: 11 },
  modeRow: { flexDirection: "row", gap: spacing.sm },
  modeOption: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: 1, borderRadius: radii.lg, padding: 12 },
  radio: { width: 17, height: 17, borderRadius: 9, borderWidth: 1.5 },
  quickQuantityRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.sm },
  quickQuantity: { borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: 13, paddingVertical: 8 },
  quickQuantityText: { fontSize: 12, fontWeight: "800" },
  containerSummary: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: 11, borderRadius: radii.md },
  successRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  flex: { flex: 1, gap: 3 },
  cardTitle: { ...typography.bodyStrong, fontSize: 13 },
  muted: { ...typography.caption, fontSize: 12, lineHeight: 17 },
  label: { ...typography.caption, fontWeight: "800", fontSize: 12, marginTop: spacing.sm },
  priceText: { ...typography.caption, fontWeight: "900", fontSize: 12, marginTop: 4 },
  error: { ...typography.caption, fontSize: 12, lineHeight: 18 },
  estimateRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: spacing.sm },
  estimateTotal: { ...typography.title, fontSize: 27 },
  breakdown: { borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 10, gap: 11 },
  priceRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  priceAmount: { ...typography.bodyStrong, fontSize: 13 },
  totalRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  totalLabel: { ...typography.bodyStrong, fontSize: 14 },
  totalValue: { ...typography.sectionTitle, fontSize: 18 },
  orderReference: { ...typography.sectionTitle, fontSize: 21 },
  walletSummary: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: 12, borderRadius: radii.md },
});
