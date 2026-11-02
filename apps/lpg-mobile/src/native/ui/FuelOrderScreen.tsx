import { router } from "expo-router";
import { CheckCircle2, Droplets, Fuel, Gauge, MapPin, Package, ShieldCheck, Truck, WalletCards } from "lucide-react-native";
import { useEffect, useMemo, useState, type ReactNode } from "react";
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
import { AppModal } from "./AppModal";
import { EmptyState } from "./EmptyState";
import { Screen } from "./Screen";
import { StatusPill } from "./StatusPill";

type ProductKey = "fuel.pms" | "fuel.ago" | "fuel.dpk";
type ContainerMode = "purchase" | "rental";
type FulfillmentMode = "station_managed" | "independent_driver" | "skima_managed";

const STATION_PREVIEW_LIMIT = 4;

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
  const [orderStep, setOrderStep] = useState(1);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [showAllOffers, setShowAllOffers] = useState(false);

  const activeProducts = (products.data ?? []).filter((item) =>
    firstString(item, ["status"]) === "enabled" &&
    ["fuel.pms", "fuel.ago", "fuel.dpk"].includes(firstString(item, ["key"]) ?? "")
  );
  const selectedProductRecord = activeProducts.find((item) => firstString(item, ["key"]) === selectedProductKey);
  const selectedProductTitle = firstString(selectedProductRecord, ["display_name"]) ?? "Fuel";
  const selectedProductPrecision = firstNumber(selectedProductRecord, ["quantity_precision"]) ?? 2;
  const customerWallet = selectWorkspaceWallet(wallets.data ?? [], "customer");
  const walletId = firstString(customerWallet, ["wallet_id", "walletId", "id"]);
  const currencyCode = firstString(customerWallet, ["currency_code", "currencyCode"]) ?? "NGN";
  const walletBalance = firstNumber(customerWallet, ["available_balance", "availableBalance", "balance"]) ?? 0;

  useEffect(() => {
    if (activeProducts.length > 0 && !activeProducts.some((item) => firstString(item, ["key"]) === selectedProductKey)) {
      const firstEnabled = firstString(activeProducts[0], ["key"]);
      if (firstEnabled && ["fuel.pms", "fuel.ago", "fuel.dpk"].includes(firstEnabled)) {
        setSelectedProductKey(firstEnabled as ProductKey);
      }
    }
  }, [activeProducts, selectedProductKey]);

  const activeOffers = (offers.data ?? []).filter((item) =>
    firstString(item, ["status"]) === "active" &&
    firstString(item, ["product_key"]) === selectedProductKey &&
    firstString(item, ["currency_code"]) === currencyCode
  );
  const selectedOffer = activeOffers.find((item) => firstString(item, ["branch_id"]) === selectedBranchId) ?? null;
  const firstOfferPreview = activeOffers.slice(0, STATION_PREVIEW_LIMIT);
  const selectedOfferAlreadyVisible = firstOfferPreview.some((item) => firstString(item, ["branch_id"]) === selectedBranchId);
  const previewOffers = selectedOffer && !selectedOfferAlreadyVisible
    ? [...firstOfferPreview.slice(0, STATION_PREVIEW_LIMIT - 1), selectedOffer]
    : firstOfferPreview;
  const visibleOffers = showAllOffers ? activeOffers : previewOffers;
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

  useEffect(() => {
    if (allowedFulfillmentModes.length > 0 && !allowedFulfillmentModes.includes(fulfillmentMode)) {
      setFulfillmentMode(allowedFulfillmentModes[0]);
    }
  }, [allowedFulfillmentModes, fulfillmentMode]);

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


  const quantityValid = Boolean(
    requestedLitres !== null &&
    Number.isFinite(requestedLitres) &&
    requestedLitres > 0 &&
    requestedLitres >= (minLitres ?? 0) &&
    (maxLitres === null || requestedLitres <= maxLitres) &&
    (litresInput.split(".")[1]?.length ?? 0) <= selectedProductPrecision
  );
  const containerValid = Boolean(selectedContainerType && nominalCapacity);
  const stepReady = orderStep === 1
    ? Boolean(selectedProductRecord)
    : orderStep === 2
      ? Boolean(chosenLocationId)
      : orderStep === 3
        ? quantityValid && containerValid
        : !validationError;
  const stepTitles = ["Fuel", "Location", "Amount", "Fulfillment"];

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
      title={paid ? "Order confirmed" : createdQuote ? "Review your quote" : "Order fuel"}
      subtitle={
        paid
          ? "Your payment is safely reserved and the station can prepare your order."
          : createdQuote
            ? "Check the full price before confirming your order."
            : "Choose your fuel, delivery location, quantity and fulfillment route."
      }
      action={<AppButton label="My orders" size="sm" variant="secondary" onPress={() => router.push("/(customer)/fuel-orders" as never)} />}
    >
      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={palette.brand} />
          <Text style={[styles.muted, { color: palette.muted }]}>Loading live fuel products and station offers…</Text>
        </View>
      ) : loadingError ? (
        <EmptyState
          title="Fuel offers could not be loaded"
          description="Refresh and try again. Your existing orders are not affected."
          action={<AppButton label="Try again" onPress={refreshAll} />}
        />
      ) : paid && createdQuote ? (
        <View style={[styles.successCard, shadows.soft, { backgroundColor: palette.successSoft, borderColor: palette.success }]}>
          <View style={styles.successIcon}><CheckCircle2 color={palette.success} size={34} /></View>
          <Text style={[styles.successEyebrow, { color: palette.success }]}>PAYMENT RESERVED</Text>
          <Text style={[styles.successTitle, { color: palette.ink }]}>Your fuel order is confirmed</Text>
          <Text style={[styles.successCopy, { color: palette.muted }]}>Your wallet payment is reserved in escrow. The selected station can now confirm and prepare your order.</Text>
          <View style={[styles.successReference, { backgroundColor: palette.surface }]}>
            <View style={styles.flex}>
              <Text style={[styles.label, { color: palette.muted }]}>ORDER REFERENCE</Text>
              <Text style={[styles.orderReference, { color: palette.ink }]}>{createdQuote.orderId.slice(0, 8).toUpperCase()}</Text>
              <Text style={[styles.muted, { color: palette.muted }]}>{selectedProductTitle} · {requestedLitres ?? 0} L</Text>
            </View>
            <StatusPill label="Payment reserved" tone="success" />
          </View>
          <AppButton label="View my Fuel orders" fullWidth size="lg" onPress={() => router.push("/(customer)/fuel-orders" as never)} />
        </View>
      ) : createdQuote ? (
        <>
          <View style={styles.progressCard} accessibilityLabel="Fuel order quote review, step 4 of 4">
            {[1, 2, 3, 4].map((stepNumber) => (
              <View key={stepNumber} style={[styles.progressSegment, { backgroundColor: palette.brand }]} />
            ))}
            <Text style={[styles.progressText, { color: palette.muted }]}>Step 4 of 4</Text>
          </View>
          <View style={[styles.quoteHero, shadows.raised, { backgroundColor: palette.brand }]}>
            <View style={styles.quoteHeroTop}>
              <View style={styles.quoteHeroCopy}>
                <Text style={styles.quoteEyebrow}>YOUR FUEL TOTAL</Text>
                <Text adjustsFontSizeToFit numberOfLines={1} style={styles.quoteTotal}>{money(createdQuote.totalAmount, createdQuote.currencyCode)}</Text>
              </View>
              <View style={styles.quoteHeroIcon}><WalletCards color="#FFFFFF" size={25} /></View>
            </View>
            <Text style={styles.quoteHeroBody}>
              This quote is based on {selectedProductTitle.toLowerCase()}, your selected station, {requestedLitres} litres, container choice and delivery route.
            </Text>
          </View>
          <View style={[styles.quoteCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <View style={styles.quoteHeader}>
              <View style={[styles.confirmIcon, { backgroundColor: palette.successSoft }]}><CheckCircle2 color={palette.success} size={21} /></View>
              <View style={styles.quoteHeaderCopy}>
                <Text style={[styles.quoteTitle, { color: palette.ink }]}>Price breakdown</Text>
                <Text style={[styles.quoteSub, { color: palette.muted }]}>Review each part of your fuel order before confirming.</Text>
              </View>
            </View>
            <QuoteLine label="Fuel" value={money(firstNumber(createdQuote.componentSnapshot, ["fuel_amount"]), createdQuote.currencyCode)} />
            <QuoteLine label={containerMode === "purchase" ? "Container purchase" : "Container rental"} value={money(firstNumber(createdQuote.componentSnapshot, ["container_amount"]), createdQuote.currencyCode)} />
            <QuoteLine label="Delivery" value={money(firstNumber(createdQuote.componentSnapshot, ["driver_delivery_fee_amount"]), createdQuote.currencyCode)} />
            <QuoteLine label="SKIMA service fee" value={money(firstNumber(createdQuote.componentSnapshot, ["platform_fee_amount"]), createdQuote.currencyCode)} />
            <QuoteLine label="Tax" value={money(firstNumber(createdQuote.componentSnapshot, ["tax_amount"]) ?? createdQuote.taxAmount, createdQuote.currencyCode)} />
            {containerMode === "rental" ? <QuoteLine label="Refundable container deposit" value={money(firstNumber(createdQuote.componentSnapshot, ["refundable_deposit_amount"]), createdQuote.currencyCode)} /> : null}
            <View style={[styles.quoteDivider, { backgroundColor: palette.border }]} />
            <QuoteLine label="Total" value={money(createdQuote.totalAmount, createdQuote.currencyCode)} strong />
          </View>
          <View style={[styles.validity, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
            <ShieldCheck color={palette.mutedStrong} size={18} />
            <Text style={[styles.validityText, { color: palette.muted }]}>
              Quote valid until {formatDate(createdQuote.expiresAt)}. Payment is reserved through your SKIMA wallet only after you confirm.
            </Text>
          </View>
          <View style={[styles.walletSummary, { backgroundColor: palette.surfaceSubtle }]}>
            <WalletCards color={palette.brand} size={20} />
            <View style={styles.flex}>
              <Text style={[styles.cardTitle, { color: palette.ink }]}>Available wallet balance</Text>
              <Text style={[styles.muted, { color: palette.muted }]}>{money(walletBalance, currencyCode)}</Text>
            </View>
            <StatusPill label={walletBalance >= createdQuote.totalAmount ? "Enough to pay" : "Top up needed"} tone={walletBalance >= createdQuote.totalAmount ? "success" : "warning"} />
          </View>
          <Text style={[styles.policyNote, { color: palette.muted }]}>
            {containerMode === "rental"
              ? "The deposit remains refundable under the rental return and inspection policy. Your container remains SKIMA-owned."
              : "The purchased container becomes yours after verified delivery."}
          </Text>
          {localError ? <Text accessibilityRole="alert" style={[styles.error, { color: palette.danger }]}>{localError}</Text> : null}
          <AppButton
            label={walletBalance >= createdQuote.totalAmount ? "Accept quote & pay" : "Insufficient wallet balance"}
            fullWidth
            size="lg"
            loading={acceptQuote.isPending || payOrder.isPending}
            disabled={walletBalance < createdQuote.totalAmount || !walletId}
            onPress={() => void acceptAndPay()}
            icon={<ShieldCheck color="#FFFFFF" size={18} />}
          />
          <AppButton label="Edit order" variant="ghost" fullWidth onPress={() => { setCreatedQuote(null); setOrderStep(4); setLocalError(null); }} />
        </>
      ) : (
        <>
          <View style={styles.progressCard} accessibilityLabel={`Fuel order step ${orderStep} of 4`}>
            {[1, 2, 3, 4].map((stepNumber) => (
              <View key={stepNumber} style={[styles.progressSegment, { backgroundColor: stepNumber <= orderStep ? palette.brand : palette.border }]} />
            ))}
            <Text style={[styles.progressText, { color: palette.muted }]}>Step {orderStep} of 4</Text>
          </View>

          {orderStep === 1 ? (
            <SelectionSection
              eyebrow="FUEL PRODUCT"
              icon={<Fuel color={palette.brand} size={20} />}
              title="Choose your fuel"
              description="Select the product you need. Only fuel products enabled by SKIMA are shown."
              records={activeProducts}
              selected={selectedProductKey}
              onSelect={(id) => {
                if (["fuel.pms", "fuel.ago", "fuel.dpk"].includes(id)) {
                  setSelectedProductKey(id as ProductKey);
                  setSelectedBranchId("");
                  setContainerTypeKey("");
                  setCreatedQuote(null);
                  setLocalError(null);
                }
              }}
              emptyText="Fuel ordering is not available at the moment."
              productChoices
            />
          ) : null}

          {orderStep === 2 ? (
            <SelectionSection
              eyebrow="DELIVERY LOCATION"
              icon={<MapPin color={palette.brand} size={20} />}
              title="Where should we deliver?"
              description="Choose the saved address where your fuel and container should arrive."
              records={savedLocations}
              selected={deliveryLocationId || chosenLocationId || ""}
              onSelect={(id) => { setDeliveryLocationId(id); setCreatedQuote(null); setLocalError(null); }}
              emptyText="Add a saved delivery address before ordering fuel."
              onAddLocation={() => router.push("/(customer)/locations" as never)}
            />
          ) : null}

          {orderStep === 3 ? (
            <>
              <View style={[styles.formCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                <SectionLead
                  eyebrow="FUEL QUANTITY"
                  icon={<Gauge color={palette.brand} size={20} />}
                  title="How much fuel do you need?"
                  description="Enter the litres you need. The selected station's configured limits and price are applied."
                />
                <AppField
                  label="Fuel quantity (litres)"
                  value={litresInput}
                  onChangeText={(value) => { setLitresInput(value.replace(/[^0-9.]/g, "")); setCreatedQuote(null); setLocalError(null); }}
                  placeholder="e.g. 20"
                  keyboardType="decimal-pad"
                  hint={minLitres !== null && maxLitres !== null ? `This station accepts ${minLitres}–${maxLitres} litres.` : "Choose a station in the next step to see its configured limits."}
                />
                <View style={styles.quickQuantityRow}>
                  {[5, 10, 20, 25, 50, 100].map((value) => (
                    <Pressable
                      key={value}
                      accessibilityRole="button"
                      accessibilityState={{ selected: requestedLitres === value }}
                      onPress={() => { setLitresInput(String(value)); setCreatedQuote(null); setLocalError(null); }}
                      style={({ pressed }) => [
                        styles.quickQuantity,
                        {
                          borderColor: requestedLitres === value ? palette.brand : palette.border,
                          backgroundColor: requestedLitres === value ? palette.brandSoft : palette.surfaceSubtle,
                          opacity: pressed ? 0.78 : 1,
                        },
                      ]}
                    >
                      <Text style={[styles.quickQuantityText, { color: requestedLitres === value ? palette.brand : palette.ink }]}>{value} L</Text>
                    </Pressable>
                  ))}
                </View>
                {selectedOffer && requestedLitres !== null && requestedLitres > 0 ? (
                  <View style={[styles.liveEstimate, { backgroundColor: palette.brandSoft, borderColor: palette.brand }]}>
                    <View style={[styles.estimateIcon, { backgroundColor: palette.surface }]}><WalletCards color={palette.brand} size={21} /></View>
                    <View style={styles.flex}>
                      <Text style={[styles.liveEstimateLabel, { color: palette.muted }]}>LIVE ESTIMATE</Text>
                      <Text style={[styles.liveEstimateAmount, { color: palette.ink }]}>{money(estimatedTotal ?? 0, currencyCode)}</Text>
                      <Text style={[styles.muted, { color: palette.muted }]}>{money(pricePerLitre ?? 0, currencyCode)} per litre · final server quote is confirmed before payment</Text>
                    </View>
                  </View>
                ) : null}
                {requestedLitres !== null && requestedLitres > 0 && !quantityValid ? (
                  <Text style={[styles.inlineNotice, { color: palette.warning }]}>
                    {requestedLitres < (minLitres ?? 0)
                      ? "This station's minimum is " + (minLitres ?? 0) + " litres."
                      : maxLitres !== null && requestedLitres > maxLitres
                        ? "This station's maximum is " + maxLitres + " litres."
                        : "Check the quantity and decimal places before continuing."}
                  </Text>
                ) : null}
              </View>

              <View style={[styles.selectionCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                <SectionLead
                  eyebrow="CONTAINER"
                  icon={<Package color={palette.brand} size={20} />}
                  title="Choose your container"
                  description="Rent a SKIMA-owned container or buy one to keep after verified delivery."
                />
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
                      <Pressable
                        key={key}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        onPress={() => { setContainerTypeKey(key); setCreatedQuote(null); }}
                        style={({ pressed }) => [
                          styles.typeOption,
                          {
                            borderColor: selected ? palette.brand : palette.border,
                            backgroundColor: selected ? palette.brandSoft : palette.surfaceSubtle,
                            opacity: pressed ? 0.8 : 1,
                          },
                        ]}
                      >
                        <View style={[styles.containerIcon, { backgroundColor: selected ? palette.brand : palette.surface }]}>
                          <Package color={selected ? "#FFFFFF" : palette.brand} size={20} />
                        </View>
                        <View style={styles.flex}>
                          <Text style={[styles.cardTitle, { color: palette.ink }]}>{firstString(type, ["display_name"]) ?? key}</Text>
                          <Text style={[styles.muted, { color: palette.muted }]}>{capacity} L capacity</Text>
                        </View>
                        {selected ? <CheckCircle2 color={palette.brand} size={20} /> : null}
                      </Pressable>
                    );
                  })}
                </View>
                {containerCount > 0 ? (
                  <View style={[styles.containerSummary, { backgroundColor: palette.surfaceSubtle }]}>
                    <Gauge color={palette.brand} size={19} />
                    <View style={styles.flex}>
                      <Text style={[styles.cardTitle, { color: palette.ink }]}>{containerCount} container(s) required</Text>
                      <Text style={[styles.muted, { color: palette.muted }]}>For your {requestedLitres} L order · {nominalCapacity} L per container</Text>
                    </View>
                  </View>
                ) : null}
                <View style={[styles.policyNoteBox, { backgroundColor: palette.surfaceSubtle }]}>
                  <ShieldCheck color={palette.success} size={18} />
                  <Text style={[styles.muted, { color: palette.muted }]}>
                    {containerMode === "rental"
                      ? "Your rental container is due back to the driver after you transfer the fuel. It returns to service only after station inspection."
                      : "Container ownership transfers to you after verified delivery."}
                  </Text>
                </View>
                <AppField label="Delivery instructions" value={instructions} onChangeText={setInstructions} placeholder="Gate colour, landmark or handover details" multiline optional />
              </View>
            </>
          ) : null}

          {orderStep === 4 ? (
            <>
              <View style={[styles.selectionCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                <SectionLead
                  eyebrow="FULFILLMENT"
                  icon={<MapPin color={palette.brand} size={20} />}
                  title="Choose a station"
                  description={`SKIMA shows active station offers for your ${selectedProductTitle.toLowerCase()} order in ${currencyCode}. Offers refresh automatically.`}
                />
                {activeOffers.length === 0 ? (
                  <View style={styles.stationQueryState}>
                    <Text style={[styles.stationEmptyTitle, { color: palette.ink }]}>No station offers available</Text>
                    <Text style={[styles.emptyText, { color: palette.muted }]}>No station currently offers this fuel product in your wallet currency. Try another enabled fuel product.</Text>
                  </View>
                ) : (
                  <View style={styles.stationOptions}>
                    {visibleOffers.map((offer, index) => {
                      const id = firstString(offer, ["branch_id"]) ?? "";
                      const branch = nestedRecord(offer, "branch");
                      const name = firstString(branch, ["display_name", "key"]) ?? "SKIMA station";
                      const selected = id === selectedBranchId;
                      const address = addressText(branch?.address) || "Station branch";
                      return (
                        <Pressable
                          key={id}
                          accessibilityRole="button"
                          accessibilityState={{ selected }}
                          onPress={() => { setSelectedBranchId(id); setCreatedQuote(null); setLocalError(null); }}
                          style={({ pressed }) => [
                            styles.stationOption,
                            {
                              borderColor: selected ? palette.brand : palette.border,
                              backgroundColor: selected ? palette.brandSoft : palette.surfaceSubtle,
                              opacity: pressed ? 0.78 : 1,
                            },
                          ]}
                        >
                          <View style={styles.stationOptionTop}>
                            <View style={styles.stationOptionCopy}>
                              <View style={styles.stationNameRow}>
                                <Text style={[styles.stationName, { color: palette.ink }]}>{name}</Text>
                                {index === 0 ? <Text style={[styles.recommendedTag, { color: palette.brand }]}>AVAILABLE OFFER</Text> : null}
                              </View>
                              <Text style={[styles.stationAddress, { color: palette.muted }]} numberOfLines={2}>{address}</Text>
                            </View>
                            {selected ? <CheckCircle2 color={palette.brand} size={21} /> : null}
                          </View>
                          <View style={styles.stationFacts}>
                            <Text style={[styles.stationFact, { color: palette.ink }]}>{money(firstNumber(offer, ["price_per_litre"]) ?? 0, currencyCode)} / litre</Text>
                            <Text style={[styles.stationFactMuted, { color: palette.muted }]}>Configured offer</Text>
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
                {activeOffers.length > STATION_PREVIEW_LIMIT ? (
                  <AppButton
                    label={showAllOffers ? "Show fewer stations" : `View all ${activeOffers.length} stations`}
                    size="sm"
                    variant="secondary"
                    onPress={() => setShowAllOffers((value) => !value)}
                  />
                ) : null}
              </View>

              {selectedOffer ? (
                <View style={[styles.selectionCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                  <SectionLead
                    eyebrow="DELIVERY METHOD"
                    icon={<Truck color={palette.brand} size={20} />}
                    title="Who delivers your order?"
                    description="Choose one of the fulfillment routes enabled for this station."
                  />
                  <View style={styles.optionList}>
                    {allowedFulfillmentModes.map((mode) => (
                      <ModeOption
                        key={mode}
                        title={mode === "station_managed" ? "Station Managed" : mode === "skima_managed" ? "SKIMA Managed / SKIMA Fleet" : "Independent Managed"}
                        subtitle={mode === "station_managed" ? "The station's approved driver delivers" : mode === "skima_managed" ? "SKIMA assigns its managed delivery team" : "An approved independent provider delivers"}
                        active={fulfillmentMode === mode}
                        onPress={() => { setFulfillmentMode(mode); setCreatedQuote(null); setLocalError(null); }}
                      />
                    ))}
                  </View>
                </View>
              ) : null}

              {selectedOffer && requestedLitres !== null && requestedLitres > 0 ? (
                <View style={[styles.liveEstimate, { backgroundColor: palette.brandSoft, borderColor: palette.brand }]}>
                  <View style={[styles.estimateIcon, { backgroundColor: palette.surface }]}><WalletCards color={palette.brand} size={21} /></View>
                  <View style={styles.flex}>
                    <Text style={[styles.liveEstimateLabel, { color: palette.muted }]}>ESTIMATED ORDER TOTAL</Text>
                    <Text style={[styles.liveEstimateAmount, { color: palette.ink }]}>{estimatedTotal === null ? "—" : money(estimatedTotal, currencyCode)}</Text>
                    <Text style={[styles.muted, { color: palette.muted }]}>{selectedProductTitle} · {requestedLitres} L · {branchName}</Text>
                  </View>
                </View>
              ) : null}

              {savedLocations.length > 0 && selectedLocation ? (
                <View style={[styles.locationSummary, { backgroundColor: palette.surfaceSubtle }]}>
                  <MapPin color={palette.brand} size={18} />
                  <View style={styles.flex}>
                    <Text style={[styles.cardTitle, { color: palette.ink }]}>{firstString(selectedLocation, ["label", "name", "title"]) ?? "Delivery address"}</Text>
                    <Text style={[styles.muted, { color: palette.muted }]}>{addressText(selectedLocation)}</Text>
                  </View>
                </View>
              ) : null}

              {validationError ? <Text style={[styles.error, { color: palette.danger }]}>{validationError}</Text> : null}
              {localError ? <Text accessibilityRole="alert" style={[styles.error, { color: palette.danger }]}>{localError}</Text> : null}
            </>
          ) : null}

          <View style={styles.stepActions}>
            {orderStep > 1 ? (
              <AppButton label="Back" variant="secondary" onPress={() => { setOrderStep(orderStep - 1); setLocalError(null); }} />
            ) : <View style={styles.stepSpacer} />}
            <AppButton
              label={orderStep === 4 ? "Review fuel order" : orderStep === 3 ? "Find fuel offers" : "Continue"}
              fullWidth={orderStep === 1}
              size="lg"
              disabled={!stepReady}
              onPress={() => {
                setLocalError(null);
                if (orderStep === 4) setReviewOpen(true);
                else setOrderStep(orderStep + 1);
              }}
            />
          </View>

          <AppModal visible={reviewOpen} title="Review your fuel order" description="Confirm your fuel, quantity, container and delivery route before SKIMA prepares your protected quote." onClose={() => setReviewOpen(false)}>
            <View style={styles.reviewContent}>
              <Text style={[styles.reviewLine, { color: palette.ink }]}>{selectedProductTitle} · {requestedLitres} L</Text>
              <Text style={[styles.reviewLine, { color: palette.muted }]}>{branchName}{branchAddress ? " · " + branchAddress : ""}</Text>
              <Text style={[styles.reviewLine, { color: palette.muted }]}>{firstString(selectedContainerType, ["display_name"]) ?? "Container"} · {containerMode === "purchase" ? "Purchase" : "Rental"} · {containerCount} container(s)</Text>
              <Text style={[styles.reviewLine, { color: palette.muted }]}>{fulfillmentMode === "station_managed" ? "Station Managed" : fulfillmentMode === "skima_managed" ? "SKIMA Managed / SKIMA Fleet" : "Independent Managed"}</Text>
              <Text style={[styles.reviewLine, { color: palette.muted }]}>{addressText(selectedLocation) || "Selected delivery location"}</Text>
              <Text style={[styles.reviewHint, { color: palette.muted }]}>No payment is taken at this stage. SKIMA prepares the full price first, and you review it before confirming payment.</Text>
              {localError ? <Text accessibilityRole="alert" style={[styles.error, { color: palette.danger }]}>{localError}</Text> : null}
              <AppButton label="Get secure price quote" fullWidth size="lg" loading={createOrder.isPending} onPress={() => { setReviewOpen(false); void createQuote(); }} />
              <AppButton label="Make changes" fullWidth variant="secondary" onPress={() => setReviewOpen(false)} />
            </View>
          </AppModal>
        </>
      )}
    </Screen>
  );
}


function SelectionSection({
  eyebrow, icon, title, description, records, selected, onSelect, emptyText,
  productChoices = false, onAddLocation,
}: {
  eyebrow: string; icon: ReactNode; title: string; description: string;
  records: PlatformRecord[]; selected: string; onSelect(id: string): void;
  emptyText: string; productChoices?: boolean; onAddLocation?: () => void;
}) {
  const { palette } = useAppTheme();
  return (
    <View style={[styles.selectionCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <SectionLead eyebrow={eyebrow} icon={icon} title={title} description={description} />
      {records.length ? (
        <View style={styles.choices}>
          {records.map((item, index) => {
            const id = productChoices ? firstString(item, ["key"]) ?? String(index) : firstString(item, ["id"]) ?? String(index);
            const active = id === selected;
            return (
              <Pressable
                key={id}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => onSelect(id)}
                style={({ pressed }) => [
                  productChoices ? styles.productChoice : styles.recordChoice,
                  { backgroundColor: active ? palette.brandSoft : palette.surfaceSubtle, borderColor: active ? palette.brand : palette.border, opacity: pressed ? 0.78 : 1 },
                ]}
              >
                {productChoices ? (
                  <View style={[styles.productIcon, { backgroundColor: active ? palette.brand : palette.surface }]}>
                    <Fuel color={active ? "#FFFFFF" : palette.brand} size={22} />
                  </View>
                ) : (
                  <View style={[styles.locationIcon, { backgroundColor: active ? palette.brand : palette.surface }]}>
                    <MapPin color={active ? "#FFFFFF" : palette.brand} size={18} />
                  </View>
                )}
                <View style={styles.choiceCopy}>
                  <Text numberOfLines={2} style={[styles.recordChoiceText, { color: palette.ink }]}>
                    {productChoices
                      ? firstString(item, ["display_name"]) ?? firstString(item, ["short_code"]) ?? id
                      : firstString(item, ["label", "name", "title"]) ?? "Saved address"}
                  </Text>
                  <Text numberOfLines={2} style={[styles.choiceMeta, { color: palette.muted }]}>
                    {productChoices ? firstString(item, ["short_code"]) ?? id.toUpperCase() : addressText(item)}
                  </Text>
                  {productChoices ? <Text style={[styles.choiceMeta, { color: palette.brand }]}>{firstString(item, ["unit_code"]) ?? "Litres"}</Text> : null}
                </View>
                {active ? <CheckCircle2 color={palette.brand} size={20} /> : null}
              </Pressable>
            );
          })}
        </View>
      ) : (
        <View style={styles.emptyState}>
          <Text style={[styles.emptyText, { color: palette.muted }]}>{emptyText}</Text>
          {onAddLocation ? <AppButton label="Add delivery location" size="sm" onPress={onAddLocation} /> : null}
        </View>
      )}
    </View>
  );
}

function SectionLead({ eyebrow, icon, title, description }: { eyebrow: string; icon: ReactNode; title: string; description: string }) {
  const { palette } = useAppTheme();
  return (
    <View style={styles.sectionLead}>
      <View style={[styles.sectionIcon, { backgroundColor: palette.brandSoft }]}>{icon}</View>
      <View style={styles.sectionCopy}>
        <Text style={[styles.sectionStep, { color: palette.brand }]}>{eyebrow}</Text>
        <Text style={[styles.sectionTitle, { color: palette.ink }]}>{title}</Text>
        <Text style={[styles.sectionDescription, { color: palette.muted }]}>{description}</Text>
      </View>
    </View>
  );
}

function ModeOption({ title, subtitle, active, onPress }: {
  title: string; subtitle: string; active: boolean; onPress: () => void;
}) {
  const { palette } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.modeOption,
        { borderColor: active ? palette.brand : palette.border, backgroundColor: active ? palette.brandSoft : palette.surfaceSubtle, opacity: pressed ? 0.78 : 1 },
      ]}
    >
      <View style={styles.modeMark}>
        {active ? <CheckCircle2 color={palette.brand} size={19} /> : <View style={[styles.radio, { borderColor: palette.borderStrong }]} />}
      </View>
      <View style={styles.modeCopy}>
        <Text style={[styles.cardTitle, { color: palette.ink }]}>{title}</Text>
        <Text style={[styles.muted, { color: palette.muted }]}>{subtitle}</Text>
      </View>
    </Pressable>
  );
}

function QuoteLine({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  const { palette } = useAppTheme();
  return (
    <View style={styles.quoteLine}>
      <Text style={[strong ? styles.quoteStrongLabel : styles.quoteLabel, { color: strong ? palette.ink : palette.muted }]}>{label}</Text>
      <Text style={[strong ? styles.quoteStrongAmount : styles.quoteAmount, { color: palette.ink }]}>{value}</Text>
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
    const direct = [record.street, record.city, record.area, record.state, record.formatted_address]
      .filter((part): part is string => typeof part === "string" && Boolean(part.trim()));
    if (direct.length > 0) return direct.join(", ");
    if (typeof record.address === "string") return record.address;
    if (record.address && typeof record.address === "object" && !Array.isArray(record.address)) {
      const nested = record.address as PlatformRecord;
      return [nested.street, nested.city, nested.area, nested.state, nested.formatted_address]
        .filter((part): part is string => typeof part === "string" && Boolean(part.trim()))
        .join(", ");
    }
  }
  return "";
}

function money(value: number | null, currency: string | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency ?? "NGN" }).format(value);
  } catch {
    return `${currency ?? ""} ${value.toFixed(2)}`.trim();
  }
}

function formatDate(value: string | null): string {
  if (!value) return "the displayed expiry time";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}


const styles = StyleSheet.create({
  loading: { minHeight: 190, alignItems: "center", justifyContent: "center", gap: spacing.md },
  progressCard: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: 2 },
  progressSegment: { flex: 1, height: 5, borderRadius: radii.pill },
  progressText: { ...typography.caption, marginLeft: spacing.sm, fontWeight: "900" },
  stepActions: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
  stepSpacer: { flex: 1 },
  selectionCard: { gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.lg },
  formCard: { gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.lg },
  sectionLead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  sectionIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  sectionCopy: { flex: 1, minWidth: 0, gap: 2 },
  sectionStep: { ...typography.eyebrow, fontSize: 8 },
  sectionTitle: { ...typography.subheading, fontSize: 15 },
  sectionDescription: { ...typography.caption, lineHeight: 17 },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  productChoice: { minWidth: 150, flexGrow: 1, flexBasis: 160, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderRadius: radii.lg, padding: spacing.md },
  productIcon: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  recordChoice: { width: "100%", minWidth: 0, flexBasis: "100%", flexGrow: 0, minHeight: 78, flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: 1, borderRadius: radii.lg, padding: spacing.md },
  locationIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  choiceCopy: { flex: 1, minWidth: 0, gap: 3 },
  recordChoiceText: { flex: 1, ...typography.bodyStrong, fontSize: 13 },
  choiceMeta: { ...typography.caption, fontSize: 10, lineHeight: 15 },
  emptyState: { gap: spacing.sm, alignItems: "flex-start" },
  emptyText: { ...typography.caption, paddingVertical: spacing.xs, lineHeight: 18 },
  quickQuantityRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  quickQuantity: { borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: 15, paddingVertical: 9 },
  quickQuantityText: { ...typography.caption, fontWeight: "800", fontSize: 12 },
  liveEstimate: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: 1, borderRadius: radii.lg, padding: spacing.md },
  estimateIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  liveEstimateLabel: { ...typography.eyebrow, fontSize: 8 },
  liveEstimateAmount: { ...typography.title, fontSize: 24 },
  inlineNotice: { ...typography.caption, fontWeight: "800", lineHeight: 18 },
  modeRow: { flexDirection: "row", gap: spacing.sm },
  modeOption: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderRadius: radii.lg, padding: spacing.md },
  modeMark: { width: 26, alignItems: "center", justifyContent: "center" },
  modeCopy: { flex: 1, minWidth: 0, gap: 3 },
  radio: { width: 17, height: 17, borderRadius: 9, borderWidth: 1.5 },
  optionList: { gap: spacing.sm },
  stationOptions: { gap: spacing.sm },
  stationOption: { gap: spacing.sm, borderWidth: 1, borderRadius: radii.lg, padding: spacing.md },
  stationOptionTop: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  stationOptionCopy: { flex: 1, minWidth: 0, gap: 3 },
  stationNameRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
  stationName: { ...typography.bodyStrong, fontSize: 14 },
  recommendedTag: { ...typography.eyebrow, fontSize: 8 },
  stationAddress: { ...typography.caption, lineHeight: 17 },
  stationFacts: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm + 2 },
  stationFact: { ...typography.caption, fontWeight: "900" },
  stationFactMuted: { ...typography.caption, fontWeight: "700" },
  stationQueryState: { gap: spacing.sm },
  stationEmptyTitle: { ...typography.bodyStrong, fontSize: 14 },
  containerIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  containerSummary: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radii.lg },
  policyNoteBox: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm + 2, padding: spacing.md, borderRadius: radii.lg },
  locationSummary: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radii.lg },
  cardTitle: { ...typography.bodyStrong, fontSize: 13 },
  muted: { ...typography.caption, fontSize: 12, lineHeight: 17 },
  label: { ...typography.caption, fontWeight: "800", fontSize: 12, marginTop: spacing.xs },
  error: { ...typography.caption, fontSize: 12, lineHeight: 18 },
  reviewContent: { gap: spacing.md },
  reviewLine: { ...typography.bodyStrong },
  reviewHint: { ...typography.caption, lineHeight: 18 },
  quoteHero: { gap: spacing.md, padding: spacing.lg, borderRadius: radii.xl },
  quoteHeroTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md },
  quoteHeroCopy: { flex: 1, minWidth: 0 },
  quoteEyebrow: { color: "rgba(255,255,255,.76)", ...typography.eyebrow, fontSize: 9 },
  quoteTotal: { color: "#FFFFFF", fontSize: 36, lineHeight: 43, fontWeight: "900", letterSpacing: -1, marginTop: 4 },
  quoteHeroIcon: { width: 48, height: 48, borderRadius: 17, backgroundColor: "rgba(255,255,255,.14)", alignItems: "center", justifyContent: "center" },
  quoteHeroBody: { color: "rgba(255,255,255,.84)", ...typography.caption, lineHeight: 18 },
  quoteCard: { gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.lg },
  quoteHeader: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  confirmIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  quoteHeaderCopy: { flex: 1, minWidth: 0, gap: 3 },
  quoteTitle: { ...typography.subheading },
  quoteSub: { ...typography.caption },
  quoteLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  quoteLabel: { ...typography.body },
  quoteAmount: { ...typography.bodyStrong },
  quoteStrongLabel: { ...typography.bodyStrong, fontSize: 16 },
  quoteStrongAmount: { ...typography.heading, fontSize: 20 },
  quoteDivider: { height: StyleSheet.hairlineWidth },
  validity: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm + 2, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  validityText: { flex: 1, ...typography.caption, lineHeight: 18 },
  walletSummary: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: 12, borderRadius: radii.lg },
  policyNote: { ...typography.caption, lineHeight: 18 },
  successCard: { borderWidth: 1, borderRadius: radii.xl, padding: spacing.lg, gap: spacing.md },
  successIcon: { width: 64, height: 64, alignItems: "center", justifyContent: "center", borderRadius: 22, backgroundColor: "rgba(255,255,255,.75)" },
  successEyebrow: { ...typography.eyebrow, fontSize: 9 },
  successTitle: { ...typography.heading, fontSize: 23 },
  successCopy: { ...typography.body, lineHeight: 21 },
  successReference: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radii.lg },
  orderReference: { ...typography.sectionTitle, fontSize: 21 },
  flex: { flex: 1, minWidth: 0, gap: 3 },
});
