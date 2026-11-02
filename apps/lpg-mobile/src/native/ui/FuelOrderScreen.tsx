import { router } from "expo-router";
import { CheckCircle2, Droplets, Fuel, Gauge, MapPin, Package, ShieldCheck, Truck, WalletCards } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
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
    ? Boolean(selectedProductRecord && selectedOffer && branchId)
    : orderStep === 2
      ? quantityValid
      : orderStep === 3
        ? containerValid
        : !validationError;
  const stepTitles = ["Fuel & station", "Quantity", "Container", "Delivery"];

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
      title={paid ? "Order confirmed" : createdQuote ? "Review your quote" : "Order " + selectedProductTitle.toLowerCase()}
      subtitle={paid ? "Your payment is safely reserved and the station can prepare your order." : createdQuote ? "Check your price and container details before paying." : "A simpler way to get petrol, diesel or kerosene delivered."}
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
          description="Refresh and try again. Existing LPG ordering is not affected."
          action={<AppButton label="Try again" onPress={refreshAll} />}
        />
      ) : paid && createdQuote ? (
        <View style={[styles.successCard, shadows.soft, { backgroundColor: palette.successSoft, borderColor: palette.success }]}>
          <View style={styles.successIcon}><CheckCircle2 color={palette.success} size={34} /></View>
          <Text style={[styles.successEyebrow, { color: palette.success }]}>PAYMENT RESERVED</Text>
          <Text style={[styles.successTitle, { color: palette.ink }]}>Your fuel order is on its way</Text>
          <Text style={[styles.successCopy, { color: palette.muted }]}>The station can now confirm and prepare your order. Your payment remains protected in escrow.</Text>
          <View style={[styles.successReference, { backgroundColor: palette.surface }]}>
            <View style={styles.flex}>
              <Text style={[styles.label, { color: palette.muted }]}>ORDER REFERENCE</Text>
              <Text style={[styles.orderReference, { color: palette.ink }]}>{createdQuote.orderId.slice(0, 8).toUpperCase()}</Text>
              <Text style={[styles.muted, { color: palette.muted }]}>{selectedProductTitle} · {requestedLitres ?? 0} L</Text>
            </View>
            <StatusPill label="Reserved" tone="success" />
          </View>
          <AppButton label="View my Fuel orders" fullWidth size="lg" onPress={() => router.push("/(customer)/fuel-orders" as never)} />
        </View>
      ) : createdQuote ? (
        <>
          <View style={styles.progressCard} accessibilityLabel="Fuel order step 4 of 4">
            <View style={styles.progressSegments}>
              {[1, 2, 3, 4].map((step) => <View key={step} style={[styles.progressSegment, { backgroundColor: palette.brand }]} />)}
            </View>
            <View style={styles.progressMeta}>
              <Text style={[styles.progressEyebrow, { color: palette.muted }]}>YOUR ORDER</Text>
              <Text style={[styles.progressText, { color: palette.ink }]}>Step 4 of 4 · Price review</Text>
            </View>
          </View>
          <View style={[styles.quoteHero, shadows.raised, { backgroundColor: palette.brand }]}>
            <View style={styles.heroTop}>
              <View style={styles.heroCopy}>
                <Text style={styles.heroEyebrow}>YOUR FUEL TOTAL</Text>
                <Text adjustsFontSizeToFit numberOfLines={1} style={styles.heroAmount}>{money(createdQuote.totalAmount, createdQuote.currencyCode)}</Text>
                <Text style={styles.heroDescription}>{selectedProductTitle} · {requestedLitres} L · {branchName}</Text>
              </View>
              <View style={styles.heroIcon}><WalletCards color="#FFFFFF" size={27} /></View>
            </View>
            <Text style={styles.heroFootnote}>Your final amount is calculated by SKIMA and locked into this quote before payment.</Text>
          </View>
          <View style={[styles.quoteCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <View style={styles.sectionLead}>
              <View style={[styles.sectionIcon, { backgroundColor: palette.successSoft }]}><CheckCircle2 color={palette.success} size={20} /></View>
              <View style={styles.sectionCopy}>
                <Text style={[styles.sectionTitle, { color: palette.ink }]}>Price breakdown</Text>
                <Text style={[styles.muted, { color: palette.muted }]}>Review each part of your fuel order.</Text>
              </View>
            </View>
            <PriceRow label="Fuel" value={firstNumber(createdQuote.componentSnapshot, ["fuel_amount"]) ?? 0} currency={createdQuote.currencyCode} />
            <PriceRow label={containerMode === "purchase" ? "Container purchase" : "Container rental"} value={firstNumber(createdQuote.componentSnapshot, ["container_amount"]) ?? 0} currency={createdQuote.currencyCode} />
            <PriceRow label="Delivery" value={firstNumber(createdQuote.componentSnapshot, ["driver_delivery_fee_amount"]) ?? 0} currency={createdQuote.currencyCode} />
            <PriceRow label="Platform fee" value={firstNumber(createdQuote.componentSnapshot, ["platform_fee_amount"]) ?? 0} currency={createdQuote.currencyCode} />
            <PriceRow label="Tax" value={firstNumber(createdQuote.componentSnapshot, ["tax_amount"]) ?? createdQuote.taxAmount} currency={createdQuote.currencyCode} />
            {containerMode === "rental" ? <PriceRow label="Refundable container deposit" value={firstNumber(createdQuote.componentSnapshot, ["refundable_deposit_amount"]) ?? 0} currency={createdQuote.currencyCode} muted /> : null}
            <View style={[styles.totalRow, { borderTopColor: palette.border }]}>
              <Text style={[styles.totalLabel, { color: palette.ink }]}>Total to pay</Text>
              <Text style={[styles.totalValue, { color: palette.brand }]}>{money(createdQuote.totalAmount, createdQuote.currencyCode)}</Text>
            </View>
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
          <AppButton label="Edit order" variant="ghost" fullWidth onPress={() => setCreatedQuote(null)} />
        </>
      ) : (
        <>
          <View style={styles.progressCard} accessibilityLabel={"Fuel order step " + orderStep + " of 4"}>
            <View style={styles.progressSegments}>
              {[1, 2, 3, 4].map((step) => (
                <Pressable
                  key={step}
                  accessibilityRole="button"
                  accessibilityLabel={"Go to " + stepTitles[step - 1]}
                  accessibilityState={{ disabled: step > orderStep, selected: step === orderStep }}
                  disabled={step > orderStep}
                  onPress={() => { setOrderStep(step); setLocalError(null); }}
                  style={[styles.progressSegment, { backgroundColor: step <= orderStep ? palette.brand : palette.border }]}
                />
              ))}
            </View>
            <View style={styles.progressMeta}>
              <Text style={[styles.progressEyebrow, { color: palette.muted }]}>ORDER JOURNEY</Text>
              <Text style={[styles.progressText, { color: palette.ink }]}>Step {orderStep} of 4 · {stepTitles[orderStep - 1]}</Text>
            </View>
          </View>

          <View style={[styles.productHero, shadows.raised, { backgroundColor: palette.brand }]}>
            <View style={styles.heroTop}>
              <View style={styles.heroCopy}>
                <Text style={styles.heroEyebrow}>SKIMA FUEL · LIVE OFFERS</Text>
                <Text style={styles.heroTitle}>{selectedProductTitle} delivered to you</Text>
                <Text style={styles.heroDescription}>{branchName} · {pricePerLitre !== null ? money(pricePerLitre, currencyCode) + " / litre" : "Choose a live station offer"}</Text>
              </View>
              <View style={styles.heroIcon}><Fuel color="#FFFFFF" size={28} /></View>
            </View>
            <View style={styles.heroMetrics}>
              <View style={styles.heroMetric}>
                <Text style={styles.heroMetricLabel}>QUANTITY</Text>
                <Text style={styles.heroMetricValue}>{requestedLitres && requestedLitres > 0 ? String(requestedLitres) + " L" : "Not set"}</Text>
              </View>
              <View style={styles.heroMetricDivider} />
              <View style={styles.heroMetric}>
                <Text style={styles.heroMetricLabel}>ESTIMATED TOTAL</Text>
                <Text style={styles.heroMetricValue}>{estimatedTotal === null ? "—" : money(estimatedTotal, currencyCode)}</Text>
              </View>
            </View>
            <View style={styles.heroOrb} />
          </View>

          {orderStep === 1 ? (
            <>
              <View style={[styles.selectionCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                <View style={styles.sectionLead}>
                  <View style={[styles.sectionIcon, { backgroundColor: palette.brandSoft }]}><Droplets color={palette.brand} size={20} /></View>
                  <View style={styles.sectionCopy}>
                    <Text style={[styles.sectionEyebrow, { color: palette.brand }]}>STEP 01 · PRODUCT</Text>
                    <Text style={[styles.sectionTitle, { color: palette.ink }]}>What do you need today?</Text>
                    <Text style={[styles.muted, { color: palette.muted }]}>Choose the fuel you want. Only products enabled by SKIMA are shown.</Text>
                  </View>
                </View>
                <View style={styles.productGrid}>
                  {activeProducts.map((product) => {
                    const key = firstString(product, ["key"]) as ProductKey;
                    const selected = selectedProductKey === key;
                    const title = firstString(product, ["display_name"]) ?? key;
                    const shortCode = firstString(product, ["short_code"]) ?? key;
                    return (
                      <Pressable
                        key={key}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        onPress={() => {
                          setSelectedProductKey(key);
                          setSelectedBranchId("");
                          setContainerTypeKey("");
                          setCreatedQuote(null);
                          setLocalError(null);
                        }}
                        style={[styles.productOption, { backgroundColor: selected ? palette.brandSoft : palette.surfaceSubtle, borderColor: selected ? palette.brand : palette.border }]}
                      >
                        <View style={[styles.productMark, { backgroundColor: selected ? palette.brand : palette.surface }]}>
                          <Fuel color={selected ? "#FFFFFF" : palette.brand} size={21} />
                        </View>
                        <Text style={[styles.productName, { color: palette.ink }]}>{title}</Text>
                        <Text style={[styles.productCode, { color: palette.muted }]}>{shortCode}</Text>
                        {selected ? <CheckCircle2 color={palette.success} size={17} /> : null}
                      </Pressable>
                    );
                  })}
                </View>
                {activeProducts.length === 0 ? <Text style={[styles.muted, { color: palette.muted }]}>Fuel ordering has not been enabled by SKIMA yet.</Text> : null}
              </View>

              <View style={[styles.selectionCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                <View style={styles.sectionLead}>
                  <View style={[styles.sectionIcon, { backgroundColor: palette.brandSoft }]}><MapPin color={palette.brand} size={20} /></View>
                  <View style={styles.sectionCopy}>
                    <Text style={[styles.sectionEyebrow, { color: palette.brand }]}>LIVE STATIONS</Text>
                    <Text style={[styles.sectionTitle, { color: palette.ink }]}>Choose your station</Text>
                    <Text style={[styles.muted, { color: palette.muted }]}>Offers available in {currencyCode}. Prices refresh automatically.</Text>
                  </View>
                </View>
                {activeOffers.length === 0 ? (
                  <View style={[styles.emptyOffer, { backgroundColor: palette.surfaceSubtle }]}>
                    <MapPin color={palette.muted} size={20} />
                    <Text style={[styles.muted, { color: palette.muted }]}>No stations currently offer this fuel product in your wallet currency.</Text>
                  </View>
                ) : (
                  <View style={styles.optionList}>
                    {activeOffers.map((offer) => {
                      const id = firstString(offer, ["branch_id"]) ?? "";
                      const branch = nestedRecord(offer, "branch");
                      const name = firstString(branch, ["display_name", "key"]) ?? "SKIMA station";
                      const selected = id === (selectedBranchId || firstString(selectedOffer, ["branch_id"]));
                      const address = addressText(branch?.address) || "Station branch";
                      return (
                        <Pressable key={id} accessibilityRole="button" accessibilityState={{ selected }} onPress={() => { setSelectedBranchId(id); setLocalError(null); setCreatedQuote(null); }} style={[styles.stationOption, { borderColor: selected ? palette.brand : palette.border, backgroundColor: selected ? palette.brandSoft : palette.surfaceSubtle }]}>
                          <View style={[styles.stationIcon, { backgroundColor: selected ? palette.brand : palette.surface }]}>
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
              </View>
            </>
          ) : null}

          {orderStep === 2 ? (
            <View style={[styles.selectionCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <View style={styles.sectionLead}>
                <View style={[styles.sectionIcon, { backgroundColor: palette.brandSoft }]}><Droplets color={palette.brand} size={20} /></View>
                <View style={styles.sectionCopy}>
                  <Text style={[styles.sectionEyebrow, { color: palette.brand }]}>STEP 02 · QUANTITY</Text>
                  <Text style={[styles.sectionTitle, { color: palette.ink }]}>How many litres do you need?</Text>
                  <Text style={[styles.muted, { color: palette.muted }]}>Choose a quick amount or enter the exact litres for your order.</Text>
                </View>
              </View>
              <AppField
                label="Fuel quantity (litres)"
                value={litresInput}
                onChangeText={(value) => { setLitresInput(value.replace(/[^0-9.]/g, "")); setCreatedQuote(null); setLocalError(null); }}
                placeholder="e.g. 20"
                keyboardType="decimal-pad"
                hint={minLitres !== null && maxLitres !== null ? "This station accepts " + minLitres + "–" + maxLitres + " litres." : "The selected station's configured limits are applied."}
              />
              <View style={styles.quickQuantityRow}>
                {[5, 10, 20, 25, 50, 100].map((value) => (
                  <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: requestedLitres === value }} onPress={() => { setLitresInput(String(value)); setCreatedQuote(null); setLocalError(null); }} style={[styles.quickQuantity, { borderColor: requestedLitres === value ? palette.brand : palette.border, backgroundColor: requestedLitres === value ? palette.brandSoft : palette.surfaceSubtle }]}>
                    <Text style={[styles.quickQuantityText, { color: requestedLitres === value ? palette.brand : palette.ink }]}>{value} L</Text>
                  </Pressable>
                ))}
              </View>
              {requestedLitres !== null && requestedLitres > 0 ? (
                <View style={[styles.liveEstimate, { backgroundColor: palette.brandSoft, borderColor: palette.brand }]}>
                  <View style={styles.estimateIcon}><WalletCards color={palette.brand} size={22} /></View>
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
          ) : null}

          {orderStep === 3 ? (
            <View style={[styles.selectionCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <View style={styles.sectionLead}>
                <View style={[styles.sectionIcon, { backgroundColor: palette.brandSoft }]}><Package color={palette.brand} size={20} /></View>
                <View style={styles.sectionCopy}>
                  <Text style={[styles.sectionEyebrow, { color: palette.brand }]}>STEP 03 · CONTAINER</Text>
                  <Text style={[styles.sectionTitle, { color: palette.ink }]}>Choose your container</Text>
                  <Text style={[styles.muted, { color: palette.muted }]}>Rent a SKIMA-owned container or buy one to keep after verified delivery.</Text>
                </View>
              </View>
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
                    <Pressable key={key} accessibilityRole="button" accessibilityState={{ selected }} onPress={() => { setContainerTypeKey(key); setCreatedQuote(null); }} style={[styles.typeOption, { borderColor: selected ? palette.brand : palette.border, backgroundColor: selected ? palette.brandSoft : palette.surfaceSubtle }]}>
                      <View style={[styles.containerIcon, { backgroundColor: selected ? palette.brand : palette.surface }]}><Package color={selected ? "#FFFFFF" : palette.brand} size={20} /></View>
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
            </View>
          ) : null}

          {orderStep === 4 ? (
            <>
              <View style={[styles.selectionCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                <View style={styles.sectionLead}>
                  <View style={[styles.sectionIcon, { backgroundColor: palette.brandSoft }]}><Truck color={palette.brand} size={20} /></View>
                  <View style={styles.sectionCopy}>
                    <Text style={[styles.sectionEyebrow, { color: palette.brand }]}>STEP 04 · DELIVERY</Text>
                    <Text style={[styles.sectionTitle, { color: palette.ink }]}>How should we deliver?</Text>
                    <Text style={[styles.muted, { color: palette.muted }]}>Choose an option supported by the selected station.</Text>
                  </View>
                </View>
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
                <View style={styles.fieldGroup}>
                  <Text style={[styles.label, { color: palette.ink }]}>Delivery location</Text>
                  {savedLocations.length === 0 ? (
                    <View style={[styles.emptyOffer, { backgroundColor: palette.surfaceSubtle }]}>
                      <MapPin color={palette.muted} size={20} />
                      <Text style={[styles.muted, { color: palette.muted }]}>Add a saved delivery location before ordering.</Text>
                      <AppButton label="Add location" size="sm" onPress={() => router.push("/(customer)/locations" as never)} />
                    </View>
                  ) : (
                    <View style={styles.optionList}>
                      {savedLocations.map((location) => {
                        const locationId = firstString(location, ["id"]) ?? "";
                        const selected = locationId === (deliveryLocationId || chosenLocationId);
                        return (
                          <Pressable key={locationId} accessibilityRole="button" accessibilityState={{ selected }} onPress={() => { setDeliveryLocationId(locationId); setCreatedQuote(null); setLocalError(null); }} style={[styles.locationOption, { backgroundColor: selected ? palette.brandSoft : palette.surfaceSubtle, borderColor: selected ? palette.brand : palette.border }]}>
                            <MapPin color={selected ? palette.brand : palette.muted} size={18} />
                            <View style={styles.flex}>
                              <Text style={[styles.cardTitle, { color: palette.ink }]}>{firstString(location, ["label", "name", "title"]) ?? "Saved address"}</Text>
                              <Text style={[styles.muted, { color: palette.muted }]}>{addressText(location)}</Text>
                            </View>
                            {selected ? <CheckCircle2 color={palette.success} size={19} /> : null}
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                </View>
                <AppField label="Delivery instructions (optional)" value={instructions} onChangeText={setInstructions} placeholder="Gate, landmark or handover details" multiline optional />
              </View>
              {selectedOffer && requestedLitres !== null && requestedLitres > 0 ? (
                <View style={[styles.liveEstimate, { backgroundColor: palette.brandSoft, borderColor: palette.brand }]}>
                  <View style={styles.estimateIcon}><WalletCards color={palette.brand} size={22} /></View>
                  <View style={styles.flex}>
                    <Text style={[styles.liveEstimateLabel, { color: palette.muted }]}>ESTIMATED ORDER TOTAL</Text>
                    <Text style={[styles.liveEstimateAmount, { color: palette.ink }]}>{estimatedTotal === null ? "—" : money(estimatedTotal, currencyCode)}</Text>
                    <Text style={[styles.muted, { color: palette.muted }]}>{selectedProductTitle} · {requestedLitres} L · {branchName}</Text>
                  </View>
                </View>
              ) : null}
              {validationError ? <Text style={[styles.error, { color: palette.danger }]}>{validationError}</Text> : null}
              {localError ? <Text accessibilityRole="alert" style={[styles.error, { color: palette.danger }]}>{localError}</Text> : null}
            </>
          ) : null}

          <View style={styles.stepActions}>
            {orderStep > 1 ? <AppButton label="Back" variant="secondary" onPress={() => { setOrderStep(orderStep - 1); setLocalError(null); }} /> : <View style={styles.stepSpacer} />}
            <AppButton
              label={orderStep === 4 ? "Review fuel order" : "Continue"}
              size="lg"
              fullWidth={orderStep === 1}
              disabled={!stepReady}
              onPress={() => {
                setLocalError(null);
                if (orderStep === 4) setReviewOpen(true);
                else setOrderStep(orderStep + 1);
              }}
            />
          </View>

          <AppModal visible={reviewOpen} title="Review your fuel order" description="Check the selected fuel, container and delivery before SKIMA prepares your secure quote." onClose={() => setReviewOpen(false)}>
            <View style={styles.reviewContent}>
              <Text style={[styles.reviewLead, { color: palette.ink }]}>{selectedProductTitle} · {requestedLitres} L</Text>
              <Text style={[styles.reviewLine, { color: palette.muted }]}>{branchName}{branchAddress ? " · " + branchAddress : ""}</Text>
              <Text style={[styles.reviewLine, { color: palette.muted }]}>{firstString(selectedContainerType, ["display_name"]) ?? "Container"} · {containerMode === "purchase" ? "Purchase" : "Rental"} · {containerCount} container(s)</Text>
              <Text style={[styles.reviewLine, { color: palette.muted }]}>{fulfillmentMode === "station_managed" ? "Station Managed" : fulfillmentMode === "skima_managed" ? "SKIMA Managed / SKIMA Fleet" : "Independent Managed"}</Text>
              <Text style={[styles.reviewLine, { color: palette.muted }]}>{addressText(selectedLocation) || "Selected delivery location"}</Text>
              <View style={[styles.reviewEstimate, { backgroundColor: palette.surfaceSubtle }]}>
                <Text style={[styles.liveEstimateLabel, { color: palette.muted }]}>CURRENT ESTIMATE</Text>
                <Text style={[styles.liveEstimateAmount, { color: palette.ink }]}>{estimatedTotal === null ? "—" : money(estimatedTotal, currencyCode)}</Text>
                <Text style={[styles.muted, { color: palette.muted }]}>The server quote is authoritative. No payment is taken in this step.</Text>
              </View>
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
  flex: { flex: 1, minWidth: 0, gap: 3 },
  progressCard: { gap: spacing.sm, paddingVertical: spacing.xs },
  progressSegments: { flexDirection: "row", gap: 6 },
  progressSegment: { height: 5, flex: 1, borderRadius: radii.pill },
  progressMeta: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  progressEyebrow: { ...typography.eyebrow, fontSize: 9 },
  progressText: { ...typography.caption, fontWeight: "800", fontSize: 12 },
  productHero: { position: "relative", overflow: "hidden", borderRadius: radii.xl, padding: spacing.lg, gap: spacing.lg },
  quoteHero: { overflow: "hidden", borderRadius: radii.xl, padding: spacing.lg, gap: spacing.md },
  heroTop: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  heroCopy: { flex: 1, minWidth: 0, gap: 5 },
  heroEyebrow: { ...typography.eyebrow, color: "rgba(255,255,255,.76)", fontSize: 9, letterSpacing: 1.1 },
  heroTitle: { ...typography.heading, color: "#FFFFFF", fontSize: 23, lineHeight: 29 },
  heroAmount: { ...typography.title, color: "#FFFFFF", fontSize: 31, lineHeight: 38 },
  heroDescription: { ...typography.caption, color: "rgba(255,255,255,.84)", lineHeight: 18 },
  heroFootnote: { ...typography.caption, color: "rgba(255,255,255,.82)", lineHeight: 18 },
  heroIcon: { width: 52, height: 52, borderRadius: 18, backgroundColor: "rgba(255,255,255,.15)", alignItems: "center", justifyContent: "center" },
  heroMetrics: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(255,255,255,.24)", paddingTop: spacing.md },
  heroMetric: { flex: 1, gap: 4 },
  heroMetricLabel: { ...typography.eyebrow, color: "rgba(255,255,255,.7)", fontSize: 8 },
  heroMetricValue: { ...typography.bodyStrong, color: "#FFFFFF", fontSize: 15 },
  heroMetricDivider: { width: StyleSheet.hairlineWidth, height: 34, backgroundColor: "rgba(255,255,255,.28)" },
  heroOrb: { position: "absolute", width: 128, height: 128, borderRadius: 64, right: -44, bottom: -74, backgroundColor: "rgba(255,255,255,.08)" },
  selectionCard: { gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.lg },
  sectionLead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  sectionIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  sectionCopy: { flex: 1, minWidth: 0, gap: 3 },
  sectionEyebrow: { ...typography.eyebrow, fontSize: 8 },
  sectionTitle: { ...typography.subheading, fontSize: 16 },
  productGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  productOption: { flexGrow: 1, flexBasis: "30%", minWidth: 92, alignItems: "center", gap: 6, borderWidth: 1, borderRadius: radii.lg, paddingVertical: 13, paddingHorizontal: 8 },
  productMark: { width: 42, height: 42, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  productName: { ...typography.bodyStrong, fontSize: 13, textAlign: "center" },
  productCode: { ...typography.eyebrow, fontSize: 9 },
  optionList: { gap: spacing.sm },
  stationOption: { flexDirection: "row", gap: spacing.md, alignItems: "center", borderWidth: 1, borderRadius: radii.lg, padding: 12 },
  stationIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  typeOption: { flexDirection: "row", gap: spacing.md, alignItems: "center", borderWidth: 1, borderRadius: radii.lg, padding: 12 },
  containerIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  locationOption: { flexDirection: "row", gap: spacing.sm, alignItems: "center", borderWidth: 1, borderRadius: radii.md, padding: 12 },
  modeRow: { flexDirection: "row", gap: spacing.sm },
  modeOption: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderRadius: radii.lg, padding: 12 },
  radio: { width: 17, height: 17, borderRadius: 9, borderWidth: 1.5 },
  quickQuantityRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  quickQuantity: { borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: 15, paddingVertical: 9 },
  quickQuantityText: { ...typography.caption, fontWeight: "800", fontSize: 12 },
  liveEstimate: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: 1, borderRadius: radii.lg, padding: spacing.md },
  estimateIcon: { width: 44, height: 44, borderRadius: 15, backgroundColor: "rgba(255,255,255,.6)", alignItems: "center", justifyContent: "center" },
  liveEstimateLabel: { ...typography.eyebrow, fontSize: 8 },
  liveEstimateAmount: { ...typography.title, fontSize: 24 },
  inlineNotice: { ...typography.caption, fontWeight: "800", lineHeight: 18 },
  containerSummary: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: 12, borderRadius: radii.lg },
  policyNoteBox: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, padding: spacing.md, borderRadius: radii.lg },
  fieldGroup: { gap: spacing.sm },
  stepActions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  stepSpacer: { flex: 1 },
  emptyOffer: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radii.lg },
  priceText: { ...typography.caption, fontWeight: "900", fontSize: 12, marginTop: 4 },
  cardTitle: { ...typography.bodyStrong, fontSize: 13 },
  muted: { ...typography.caption, fontSize: 12, lineHeight: 17 },
  label: { ...typography.caption, fontWeight: "800", fontSize: 12, marginTop: spacing.xs },
  error: { ...typography.caption, fontSize: 12, lineHeight: 18 },
  reviewContent: { gap: spacing.md },
  reviewLead: { ...typography.bodyStrong, fontSize: 17 },
  reviewLine: { ...typography.caption, fontSize: 12, lineHeight: 18 },
  reviewEstimate: { gap: 5, padding: spacing.md, borderRadius: radii.lg },
  quoteCard: { gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.lg },
  priceRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  priceAmount: { ...typography.bodyStrong, fontSize: 13 },
  totalRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  totalLabel: { ...typography.bodyStrong, fontSize: 14 },
  totalValue: { ...typography.sectionTitle, fontSize: 19 },
  walletSummary: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: 13, borderRadius: radii.lg },
  policyNote: { ...typography.caption, lineHeight: 18 },
  successCard: { borderWidth: 1, borderRadius: radii.xl, padding: spacing.lg, gap: spacing.md },
  successIcon: { width: 64, height: 64, alignItems: "center", justifyContent: "center", borderRadius: 22, backgroundColor: "rgba(255,255,255,.75)" },
  successEyebrow: { ...typography.eyebrow, fontSize: 9 },
  successTitle: { ...typography.heading, fontSize: 23 },
  successCopy: { ...typography.body, lineHeight: 21 },
  successReference: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radii.lg },
  orderReference: { ...typography.sectionTitle, fontSize: 21 },
});
