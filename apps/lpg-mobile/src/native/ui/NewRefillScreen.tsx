import { router } from "expo-router";
import { AlertTriangle, CheckCircle2, MapPin, Scale, ShieldCheck, Store, WalletCards } from "lucide-react-native";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { domainQueries } from "../api/domains";
import { useGatewayMutation } from "../api/gateway";
import {
  ActionResponseSchema,
  displayTitle,
  firstNumber,
  firstString,
  recordId,
  type PlatformRecord,
} from "../api/records";
import { useLpgServiceability } from "../api/serviceability";
import { useEligibleLpgStations, type EligibleLpgStation } from "../api/stationEligibility";
import { useSession } from "../session/SessionProvider";
import { draftStore } from "../storage/drafts";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { idempotencyKey } from "../utilities/idempotency";
import { AppButton } from "./AppButton";
import { AppModal } from "./AppModal";
import { RuntimeMediaImage } from "./RuntimeMediaImage";
import { Screen } from "./Screen";

const TYPE = "customer-refill-request";

export function NewRefillScreen() {
  const session = useSession();
  const owner = session.context?.profile?.id ?? session.context?.user.id ?? "";
  const { palette } = useAppTheme();
  const cylinders = domainQueries.cylinders();
  const locations = domainQueries.locations();
  const wallets = domainQueries.wallets();
  const quotes = domainQueries.quotes();
  const [cylinderId, setCylinderId] = useState("");
  const [pickupLocationId, setPickupLocationId] = useState("");
  const [deliveryLocationId, setDeliveryLocationId] = useState("");
  const [stationId, setStationId] = useState("");
  const [requestedKg, setRequestedKg] = useState("");
  const [purchaseMode, setPurchaseMode] = useState<"kg" | "amount">("kg");
  const [requestedAmount, setRequestedAmount] = useState("");
  const [refillStep, setRefillStep] = useState(1);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [quoteRecord, setQuoteRecord] = useState<PlatformRecord | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const draftCreatedAt = useRef(new Date().toISOString());

  const selectedCylinder = (cylinders.data ?? []).find((item) => recordId(item) === cylinderId) ?? null;
  const selectedPickupLocation = (locations.data ?? []).find((item) => recordId(item) === pickupLocationId) ?? null;
  const selectedDeliveryLocation = (locations.data ?? []).find((item) => recordId(item) === deliveryLocationId) ?? null;
  const cylinderCapacityKg = firstNumber(selectedCylinder, ["max_capacity_kg", "maxCapacityKg"]);
  const requestedKgNumber = requestedKg.trim() ? Number(requestedKg) : null;
  const requestedAmountNumber = requestedAmount.trim() ? Number(requestedAmount) : null;
  const validRequestedAmount = Boolean(requestedAmountNumber !== null && Number.isFinite(requestedAmountNumber) && requestedAmountNumber > 0);
  const validRequestedKg = Boolean(
    requestedKgNumber !== null && Number.isFinite(requestedKgNumber) && requestedKgNumber > 0,
  );
  const exceedsCylinderCapacity = Boolean(
    cylinderCapacityKg !== null &&
      requestedKgNumber !== null &&
      Number.isFinite(requestedKgNumber) &&
      requestedKgNumber > cylinderCapacityKg,
  );

  const pickupServiceability = useLpgServiceability(selectedPickupLocation);
  const deliveryServiceability = useLpgServiceability(selectedDeliveryLocation);
  const hasSelectedTrip = Boolean(selectedPickupLocation && selectedDeliveryLocation);
  const pickupHasCoordinates = Boolean(
    selectedPickupLocation &&
      firstNumber(selectedPickupLocation, ["latitude", "lat"]) !== null &&
      firstNumber(selectedPickupLocation, ["longitude", "lng", "lon"]) !== null,
  );
  const deliveryHasCoordinates = Boolean(
    selectedDeliveryLocation &&
      firstNumber(selectedDeliveryLocation, ["latitude", "lat"]) !== null &&
      firstNumber(selectedDeliveryLocation, ["longitude", "lng", "lon"]) !== null,
  );
  const locationNeedsMapPosition = hasSelectedTrip && (!pickupHasCoordinates || !deliveryHasCoordinates);
  const serviceabilityPending = Boolean(
    hasSelectedTrip &&
      !locationNeedsMapPosition &&
      (pickupServiceability.isPending || deliveryServiceability.isPending),
  );
  const serviceabilityError = Boolean(
    hasSelectedTrip &&
      !locationNeedsMapPosition &&
      (pickupServiceability.isError || deliveryServiceability.isError),
  );
  const pickupUnavailable = pickupServiceability.data?.serviceable === false;
  const deliveryUnavailable = deliveryServiceability.data?.serviceable === false;
  const driverOnboardingAvailable = Boolean(
    pickupServiceability.data?.partnerOpportunities?.driver || deliveryServiceability.data?.partnerOpportunities?.driver,
  );
  const stationOnboardingAvailable = Boolean(
    pickupServiceability.data?.partnerOpportunities?.station || deliveryServiceability.data?.partnerOpportunities?.station,
  );
  const serviceUnavailable = pickupUnavailable || deliveryUnavailable;
  const tripServiceable = Boolean(
    hasSelectedTrip &&
      pickupServiceability.data?.serviceable === true &&
      deliveryServiceability.data?.serviceable === true,
  );
  const validPurchase = purchaseMode === "kg" ? validRequestedKg : validRequestedAmount;
  const stationEligibilityReady = Boolean(tripServiceable && validPurchase && !exceedsCylinderCapacity && cylinderId);
  const eligibleStations = useEligibleLpgStations({
    pickupLocationId: pickupLocationId || null,
    deliveryLocationId: deliveryLocationId || null,
    cylinderId: cylinderId || null,
    requestedKg: stationEligibilityReady && purchaseMode === "kg" ? requestedKgNumber : null,
    requestedAmount: stationEligibilityReady && purchaseMode === "amount" ? requestedAmountNumber : null,
    enabled: stationEligibilityReady,
    limit: 10,
  });
  const displayedStations = eligibleStations.data ?? [];
  const selectedStation = displayedStations.find((station) => station.station_branch_id === stationId) ?? null;

  useEffect(() => {
    if (purchaseMode !== "amount" || !selectedStation?.price_per_kg) return;
    const amount = Number(requestedAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    setRequestedKg(formatKg(Math.floor((amount / selectedStation.price_per_kg) * 1000) / 1000));
  }, [purchaseMode, requestedAmount, selectedStation?.price_per_kg]);

  const quote = useGatewayMutation({
    path: "/lpg/quotes",
    schema: ActionResponseSchema,
    invalidate: [["quotes"]],
  });
  const expansionInterest = useGatewayMutation({
    path: "/lpg/expansion-interest",
    schema: ActionResponseSchema,
  });
  const order = useGatewayMutation({
    path: "/lpg/orders",
    schema: ActionResponseSchema,
    invalidate: [["orders"], ["orders", "active"]],
  });
  const reserve = useGatewayMutation({
    path: "/lpg/orders/reserve-payment",
    schema: ActionResponseSchema,
    invalidate: [["orders"], ["orders", "active"], ["wallets"]],
  });

  useEffect(() => {
    if (!owner) return;
    void draftStore.load(owner, TYPE).then((draft) => {
      if (draft) {
        draftCreatedAt.current = draft.createdAt;
        setCylinderId(String(draft.values.cylinderId ?? ""));
        setPickupLocationId(String(draft.values.pickupLocationId ?? ""));
        setDeliveryLocationId(String(draft.values.deliveryLocationId ?? ""));
        setStationId(String(draft.values.stationId ?? ""));
        setRequestedKg(String(draft.values.requestedKg ?? ""));
        setInstructions(String(draft.values.instructions ?? ""));
        setOrderId(typeof draft.values.orderId === "string" ? draft.values.orderId : null);
        const savedQuote = asRecord(draft.values.quoteRecord);
        const savedQuoteId = typeof draft.values.quoteId === "string" ? draft.values.quoteId : null;
        if (savedQuoteId && savedQuote && !quoteExpired(savedQuote)) {
          setQuoteId(savedQuoteId);
          setQuoteRecord(savedQuote);
        }
      }
      setHydrated(true);
    });
  }, [owner]);

  useEffect(() => {
    if (!hydrated) return;
    if (!cylinderId && cylinders.data?.[0]) setCylinderId(recordId(cylinders.data[0]) ?? "");
    const firstLocationId = locations.data?.[0] ? recordId(locations.data[0]) : null;
    if (!pickupLocationId && firstLocationId) setPickupLocationId(firstLocationId);
    if (!deliveryLocationId && firstLocationId) setDeliveryLocationId(firstLocationId);
  }, [cylinderId, cylinders.data, deliveryLocationId, hydrated, locations.data, pickupLocationId]);

  useEffect(() => {
    if (!hydrated || !cylinderId || requestedKg.trim() || cylinderCapacityKg === null) return;
    setRequestedKg(formatKg(cylinderCapacityKg));
  }, [cylinderCapacityKg, cylinderId, hydrated, requestedKg]);

  useEffect(() => {
    const options = displayedStations;
    if (!options) return;
    if (stationId && options.some((station) => station.station_branch_id === stationId)) return;
    setStationId(options[0]?.station_branch_id ?? "");
  }, [displayedStations, stationId]);

  useEffect(() => {
    if (!owner || !hydrated) return;
    const now = new Date().toISOString();
    void draftStore.save({
      version: 1,
      type: TYPE,
      ownerProfileId: owner,
      step: orderId ? "payment-reservation" : quoteId ? "quote-review" : "selection",
      workflowId: orderId ?? quoteId ?? undefined,
      values: {
        cylinderId,
        pickupLocationId,
        deliveryLocationId,
        stationId,
        requestedKg,
        instructions,
        quoteId,
        quoteRecord,
        orderId,
      },
      pendingMedia: [],
      createdAt: draftCreatedAt.current,
      updatedAt: now,
    });
  }, [
    cylinderId,
    deliveryLocationId,
    hydrated,
    instructions,
    orderId,
    owner,
    pickupLocationId,
    quoteId,
    quoteRecord,
    requestedKg,
    stationId,
  ]);

  const requestQuote = async () => {
    setError(null);
    const kilograms = Number(requestedKg);
    if (purchaseMode === "amount" && !validRequestedAmount) {
      setError("Enter a valid amount greater than zero.");
      return;
    }
    if (!cylinderId || !pickupLocationId || !deliveryLocationId) {
      setError("Choose a cylinder, pickup location and delivery location.");
      return;
    }
    if (locationNeedsMapPosition) {
      setError("Update the selected location so SKIMA can verify its map position before continuing.");
      return;
    }
    if (serviceabilityError || serviceabilityPending) {
      setError("SKIMA couldn't confirm service availability for this trip yet. Check again and continue when the locations are verified.");
      return;
    }
    if (!tripServiceable) {
      setError("Sorry, SKIMA service is not yet available for the selected pickup and return trip. Choose another location or apply to become a SKIMA partner in this area.");
      return;
    }
    if (!Number.isFinite(kilograms) || kilograms <= 0) {
      setError("Enter the amount of gas you want in kilograms.");
      return;
    }
    if (cylinderCapacityKg !== null && kilograms > cylinderCapacityKg) {
      setError(
        `This cylinder can hold up to ${formatKg(cylinderCapacityKg)} kg. Choose ${formatKg(cylinderCapacityKg)} kg or less, or check the cylinder details before continuing.`,
      );
      return;
    }
    if (eligibleStations.isPending) {
      setError("SKIMA is still checking which stations can fulfil this refill. Please wait a moment.");
      return;
    }
    if (eligibleStations.isError) {
      setError("SKIMA couldn't check station availability right now. Try the station check again.");
      return;
    }
    if (!stationId || !displayedStations.some((station) => station.station_branch_id === stationId)) {
      setError("No eligible SKIMA station is selected for this refill. Check the station options and try again.");
      return;
    }

    try {
      const result = await quote.mutateAsync({
        cylinderId,
        pickupLocationId,
        deliveryLocationId,
        stationBranchId: stationId,
        requestedKg: kilograms,
        requestedAmount: purchaseMode === "amount" ? requestedAmountNumber : undefined,
        deliveryInstructions: instructions.trim() || undefined,
        source: "skima.lpg.mobile",
        idempotencyKey: idempotencyKey("create-quote", cylinderId),
      });
      const id = resultId(result);
      if (!id) throw new Error("Your quote could not be prepared. Please try again.");
      const refreshed = await quotes.refetch();
      setQuoteRecord(
        refreshed.data?.find((item) => recordId(item) === id) ??
          (typeof result === "object" && result ? result : null),
      );
      setQuoteId(id);
    } catch (cause) {
      setError(friendlyError(cause, "Your quote could not be prepared. Please try again."));
    }
  };

  const createOrder = async () => {
    if (!quoteId) return;
    setError(null);
    try {
      let nextOrderId = orderId;
      if (!nextOrderId) {
        const result = await order.mutateAsync({
          lpgRefillQuoteId: quoteId,
          source: "skima.lpg.mobile",
          idempotencyKey: idempotencyKey("create-order", quoteId),
        });
        nextOrderId = resultId(result);
        if (!nextOrderId) throw new Error("Your order could not be created. Please try again.");
        setOrderId(nextOrderId);
      }

      const walletId = firstString(wallets.data?.[0], ["wallet_id", "walletId", "id"]);
      await reserve.mutateAsync({
        lpgOrderId: nextOrderId,
        customerWalletId: walletId ?? undefined,
        source: "skima.lpg.mobile",
        idempotencyKey: idempotencyKey("reserve-order-payment", nextOrderId),
      });
      await draftStore.clear(owner, TYPE);
      router.replace("/(customer)/orders");
    } catch (cause) {
      setError(friendlyError(cause, "Your order could not be completed. Check your wallet and try again."));
    }
  };

  const retryServiceability = () => {
    if (selectedPickupLocation) void pickupServiceability.refetch();
    if (selectedDeliveryLocation) void deliveryServiceability.refetch();
  };

  const selectPickupLocation = (id: string) => {
    setPickupLocationId(id);
    setStationId("");
    setQuoteId(null);
    setQuoteRecord(null);
    setError(null);
  };

  const selectDeliveryLocation = (id: string) => {
    setDeliveryLocationId(id);
    setStationId("");
    setQuoteId(null);
    setQuoteRecord(null);
    setError(null);
  };

  const selectCylinder = (id: string) => {
    setCylinderId(id);
    setStationId("");
    setQuoteId(null);
    setQuoteRecord(null);
    setError(null);
  };

  const currency = firstString(quoteRecord, ["currencyCode", "currency_code"]) ?? "NGN";
  const total = firstNumber(quoteRecord, ["totalAmount", "total_amount", "quotedTotal"]);
  const stationUnavailable = stationEligibilityReady && !eligibleStations.isPending && !eligibleStations.isError && displayedStations.length === 0;
  const quoteButtonLabel = !hasSelectedTrip
    ? "Choose locations to continue"
    : locationNeedsMapPosition
      ? "Update location map position"
      : serviceabilityPending
        ? "Checking service availability…"
        : serviceabilityError
          ? "Check availability to continue"
          : serviceUnavailable
            ? "Service not available for this trip"
            : !validRequestedKg
              ? "Enter refill amount to continue"
              : exceedsCylinderCapacity
                ? "Correct refill amount to continue"
                : eligibleStations.isPending
                  ? "Finding eligible stations…"
                  : eligibleStations.isError
                    ? "Check stations to continue"
                    : stationUnavailable
                      ? "No station can fulfil this refill"
                      : "See my price";
  const registerExpansionInterest = async () => {
    const locationIds = [...new Set([
      pickupUnavailable ? pickupLocationId : null,
      deliveryUnavailable ? deliveryLocationId : null,
    ].filter((value): value is string => Boolean(value)))];
    if (locationIds.length === 0) return;
    setError(null);
    try {
      await expansionInterest.mutateAsync({ locationIds });
    } catch (cause) {
      setError(friendlyError(cause, "We couldn't save your launch notification request. Please try again."));
    }
  };

  return (
    <Screen
      eyebrow="LPG refill"
      title={quoteId ? "Review your quote" : "Request a refill"}
      subtitle={
        quoteId
          ? "Check the full price before confirming the order."
          : "Choose the cylinder, locations, refill amount and station for this trip."
      }
      action={<AppButton label={quoteId ? "Edit" : "Cancel"} variant="ghost" size="sm" onPress={() => quoteId ? setQuoteId(null) : router.back()} />}
    >
      {quoteId ? (
        <>
          <View style={styles.progressCard} accessibilityLabel={`Refill step ${refillStep} of 4`}>
            {[1, 2, 3, 4].map((stepNumber) => <View key={stepNumber} style={[styles.progressSegment, { backgroundColor: stepNumber <= refillStep ? palette.brand : palette.border }]} />)}
            <Text style={[styles.progressText, { color: palette.muted }]}>Step {refillStep} of 4</Text>
          </View>
          <View style={[styles.quoteHero, shadows.raised, { backgroundColor: palette.brand }]}>
            <View style={styles.quoteHeroTop}>
              <View>
                <Text style={styles.quoteEyebrow}>YOUR REFILL TOTAL</Text>
                <Text adjustsFontSizeToFit numberOfLines={1} style={styles.quoteTotal}>{money(total, currency)}</Text>
              </View>
              <View style={styles.quoteHeroIcon}><WalletCards color="#FFFFFF" size={25} /></View>
            </View>
            <Text style={styles.quoteHeroBody}>This quote is based on your cylinder, station, refill amount, pickup and return locations.</Text>
          </View>

          <View style={[styles.quoteCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <View style={styles.quoteHeader}>
              <View style={[styles.confirmIcon, { backgroundColor: palette.successSoft }]}><CheckCircle2 color={palette.success} size={21} /></View>
              <View style={styles.quoteHeaderCopy}>
                <Text style={[styles.quoteTitle, { color: palette.ink }]}>Price breakdown</Text>
                <Text style={[styles.quoteSub, { color: palette.muted }]}>Review what makes up this refill before confirming.</Text>
              </View>
            </View>
            <QuoteLine label="Gas refill" value={money(firstNumber(quoteRecord, ["refillAmount", "refill_amount", "lpg_amount", "lpgAmount"]), currency)} />
            <QuoteLine label="Delivery" value={money(firstNumber(quoteRecord, ["deliveryAmount", "delivery_amount", "delivery_fee_amount", "deliveryFeeAmount"]), currency)} />
            <View style={[styles.quoteDivider, { backgroundColor: palette.border }]} />
            <QuoteLine label="Total" value={money(total, currency)} strong />
          </View>

          <View style={[styles.validity, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
            <ShieldCheck color={palette.mutedStrong} size={18} />
            <Text style={[styles.validityText, { color: palette.muted }]}>Quote valid until {formatDate(firstString(quoteRecord, ["expiresAt", "expires_at"]))}. Payment is reserved through your SKIMA wallet only after you confirm.</Text>
          </View>

          <AppButton
            label={orderId ? "Retry payment confirmation" : "Confirm and place order"}
            fullWidth
            size="lg"
            loading={order.isPending || reserve.isPending}
            onPress={() => void createOrder()}
          />
        </>
      ) : (
        <>
          {!locations.isPending && (locations.data ?? []).length === 0 ? (
            <View style={[styles.requirement, { backgroundColor: palette.warningSoft }]}>
              <MapPin color={palette.warning} size={22} />
              <View style={styles.requirementCopy}>
                <Text style={[styles.requirementTitle, { color: palette.ink }]}>Add a pickup location first</Text>
                <Text style={[styles.requirementBody, { color: palette.muted }]}>SKIMA needs a precise pickup and return point before it can calculate the trip.</Text>
              </View>
              <AppButton label="Add location" size="sm" onPress={() => router.push("/(customer)/location-editor" as never)} />
            </View>
          ) : null}

          {refillStep === 1 ? <><SelectionSection
            step="1"
            icon={<Scale color={palette.brand} size={20} />}
            title="Choose your cylinder"
            description="Choose the cylinder you want to refill."
            records={cylinders.data ?? []}
            selected={cylinderId}
            onSelect={selectCylinder}
            emptyText="No cylinder is registered yet."
            showImages
          /><AppButton label="Continue to locations" fullWidth disabled={!cylinderId} onPress={() => setRefillStep(2)} /></> : null}

          {refillStep === 2 ? <><SelectionSection
            step="2"
            icon={<MapPin color={palette.brand} size={20} />}
            title="Pickup location"
            description="Where should the driver collect the cylinder?"
            records={locations.data ?? []}
            selected={pickupLocationId}
            onSelect={selectPickupLocation}
            emptyText="Add a saved location to continue."
          />

          <SelectionSection
            step="3"
            icon={<MapPin color={palette.brand} size={20} />}
            title="Return location"
            description="Choose where the filled cylinder should be delivered."
            records={locations.data ?? []}
            selected={deliveryLocationId}
            onSelect={selectDeliveryLocation}
            emptyText="Add a saved location to continue."
          /><View style={styles.stepActions}><AppButton label="Back" variant="secondary" onPress={() => setRefillStep(1)} /><AppButton label="Continue" disabled={!pickupLocationId || !deliveryLocationId || !tripServiceable || serviceabilityPending || serviceabilityError || locationNeedsMapPosition} onPress={() => setRefillStep(3)} /></View></> : null}

          {refillStep === 2 && hasSelectedTrip ? (
            locationNeedsMapPosition ? (
              <View style={[styles.availabilityCard, { backgroundColor: palette.warningSoft, borderColor: palette.warning }]}>
                <View style={styles.availabilityLead}>
                  <AlertTriangle color={palette.warning} size={22} />
                  <View style={styles.requirementCopy}>
                    <Text style={[styles.requirementTitle, { color: palette.ink }]}>Update the saved location</Text>
                    <Text style={[styles.requirementBody, { color: palette.muted }]}>One of these locations does not have a usable map position, so SKIMA cannot verify service availability yet.</Text>
                  </View>
                </View>
                <AppButton label="Update locations" variant="secondary" size="sm" onPress={() => router.push("/(customer)/locations")} />
              </View>
            ) : serviceabilityPending ? (
              <View style={[styles.availabilityCard, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
                <View style={styles.availabilityLead}>
                  <MapPin color={palette.brand} size={22} />
                  <View style={styles.requirementCopy}>
                    <Text style={[styles.requirementTitle, { color: palette.ink }]}>Checking service availability</Text>
                    <Text style={[styles.requirementBody, { color: palette.muted }]}>We are checking both the pickup and return locations before showing stations and pricing.</Text>
                  </View>
                </View>
              </View>
            ) : serviceabilityError ? (
              <View style={[styles.availabilityCard, { backgroundColor: palette.warningSoft, borderColor: palette.warning }]}>
                <View style={styles.availabilityLead}>
                  <AlertTriangle color={palette.warning} size={22} />
                  <View style={styles.requirementCopy}>
                    <Text style={[styles.requirementTitle, { color: palette.ink }]}>We couldn't check this location right now</Text>
                    <Text style={[styles.requirementBody, { color: palette.muted }]}>Your saved locations are still here. Check your connection and try the availability check again.</Text>
                  </View>
                </View>
                <AppButton label="Check again" variant="secondary" size="sm" onPress={retryServiceability} />
              </View>
            ) : serviceUnavailable ? (
              <View style={[styles.availabilityCard, { backgroundColor: palette.brandSoft, borderColor: palette.brand }]}>
                <View style={styles.availabilityLead}>
                  <MapPin color={palette.brand} size={22} />
                  <View style={styles.requirementCopy}>
                    <Text style={[styles.requirementTitle, { color: palette.ink }]}>Sorry, SKIMA service is not yet available in your area</Text>
                    <Text style={[styles.requirementBody, { color: palette.muted }]}>
                      {pickupUnavailable && deliveryUnavailable
                        ? "We haven't opened LPG pickup or return service for the selected locations yet."
                        : pickupUnavailable
                          ? "We haven't opened LPG pickup service for the selected pickup location yet."
                          : "We haven't opened LPG return service for the selected return location yet."} Choose another location, or help bring SKIMA LPG to this area as an early partner.
                    </Text>
                  </View>
                </View>
                <View style={styles.availabilityActions}>
                  <AppButton label="Choose another location" variant="secondary" size="sm" onPress={() => router.push("/(customer)/locations")} />
                  <AppButton label={expansionInterest.isSuccess ? "Launch notification saved" : "Notify me when SKIMA launches here"} variant="secondary" size="sm" loading={expansionInterest.isPending} disabled={expansionInterest.isSuccess} onPress={() => void registerExpansionInterest()} />
                  {driverOnboardingAvailable ? <AppButton label="Become a Driver Partner" size="sm" onPress={() => router.push("/(customer)/driver-application" as never)} /> : null}
                  {stationOnboardingAvailable ? <AppButton label="Become a Station Partner" variant="secondary" size="sm" onPress={() => router.push("/(customer)/station-application" as never)} /> : null}
                </View>
              </View>
            ) : tripServiceable ? (
              <View style={[styles.availabilityCard, { backgroundColor: palette.successSoft, borderColor: palette.success }]}>
                <View style={styles.availabilityLead}>
                  <ShieldCheck color={palette.success} size={22} />
                  <View style={styles.requirementCopy}>
                    <Text style={[styles.requirementTitle, { color: palette.ink }]}>SKIMA LPG is available for this trip</Text>
                    <Text style={[styles.requirementBody, { color: palette.muted }]}>SKIMA LPG is available at both your pickup and return locations.</Text>
                  </View>
                </View>
              </View>
            ) : null
          ) : null}

          {refillStep === 3 ? <View style={[styles.formCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <SectionLead step="4" icon={<Scale color={palette.brand} size={20} />} title="Choose how much gas you need" description="Order by weight or enter the amount you want to spend. SKIMA converts money to kilograms using the selected station's live price." />

            <View style={styles.modeSwitch}>
              <AppButton label="Buy by kg" size="sm" variant={purchaseMode === "kg" ? "primary" : "secondary"} onPress={() => setPurchaseMode("kg")} />
              <AppButton label="Buy by amount" size="sm" variant={purchaseMode === "amount" ? "primary" : "secondary"} onPress={() => setPurchaseMode("amount")} />
            </View>

            {cylinderCapacityKg !== null ? (
              <View
                style={[
                  styles.capacityNotice,
                  {
                    backgroundColor: exceedsCylinderCapacity ? palette.dangerSoft : palette.surfaceSubtle,
                    borderColor: exceedsCylinderCapacity ? palette.danger : palette.border,
                  },
                ]}
              >
                {exceedsCylinderCapacity ? (
                  <AlertTriangle color={palette.danger} size={20} />
                ) : (
                  <ShieldCheck color={palette.success} size={20} />
                )}
                <View style={styles.capacityCopy}>
                  <Text style={[styles.capacityTitle, { color: palette.ink }]}>Cylinder capacity: {formatKg(cylinderCapacityKg)} kg</Text>
                  <Text style={[styles.capacityBody, { color: exceedsCylinderCapacity ? palette.danger : palette.muted }]}>
                    {exceedsCylinderCapacity
                      ? `${requestedKg.trim()} kg is above this cylinder's verified maximum. SKIMA will not prepare or charge for an over-capacity refill.`
                      : `This is the maximum quantity SKIMA will quote for this cylinder.`}
                  </Text>
                </View>
              </View>
            ) : null}

            {purchaseMode === "kg" ? <View style={styles.fieldGroup}>
              <Text style={[styles.fieldLabel, { color: palette.ink }]}>Kilograms to refill</Text>
              <View style={styles.quantityControl}>
                <AppButton accessibilityLabel="Reduce refill kilograms" label="−" variant="secondary" onPress={() => setRequestedKg(formatKg(Math.max(0.5, (Number(requestedKg) || 0.5) - 0.5)))} />
                <TextInput
                  value={requestedKg}
                  onChangeText={(value) => {
                  setRequestedKg(value);
                  setStationId("");
                  setQuoteId(null);
                  setQuoteRecord(null);
                  if (error) setError(null);
                }}
                keyboardType="decimal-pad"
                placeholder="e.g. 6"
                placeholderTextColor={palette.muted}
                  style={[
                  styles.input, styles.quantityInput,
                  {
                    backgroundColor: palette.input,
                    borderColor: exceedsCylinderCapacity ? palette.danger : palette.borderStrong,
                    color: palette.ink,
                  },
                ]}
                />
                <AppButton accessibilityLabel="Add refill kilograms" label="+" variant="secondary" onPress={() => setRequestedKg(formatKg(Math.min(cylinderCapacityKg ?? 1000, (Number(requestedKg) || 0) + 0.5)))} />
              </View>
            </View> : <View style={styles.fieldGroup}>
              <Text style={[styles.fieldLabel, { color: palette.ink }]}>Amount to spend (NGN)</Text>
              <TextInput value={requestedAmount} onChangeText={setRequestedAmount} keyboardType="decimal-pad" placeholder="e.g. 5000" placeholderTextColor={palette.muted} style={[styles.input, { backgroundColor: palette.input, borderColor: palette.borderStrong, color: palette.ink }]} />
              <View style={styles.amountPresets}>{[2000, 5000, 10000].map((amount) => <AppButton key={amount} label={`₦${amount.toLocaleString()}`} size="sm" variant={requestedAmount === String(amount) ? "primary" : "secondary"} onPress={() => setRequestedAmount(String(amount))} />)}</View>
              <Text style={[styles.capacityBody, { color: palette.muted }]}>{selectedStation?.price_per_kg ? `${money(Number(requestedAmount) || 0, "NGN")} buys approximately ${requestedKg || "0"} kg at ${selectedStation.display_name}.` : "Choose a station below to calculate the exact kilograms its current price can provide."}</Text>
            </View>}

            {exceedsCylinderCapacity && cylinderCapacityKg !== null ? (
              <View style={styles.capacityActions}>
                <AppButton
                  label={`Use ${formatKg(cylinderCapacityKg)} kg`}
                  size="sm"
                  onPress={() => {
                    setRequestedKg(formatKg(cylinderCapacityKg));
                    setStationId("");
                    setError(null);
                  }}
                />
                <AppButton
                  label="Check cylinder details"
                  variant="secondary"
                  size="sm"
                  onPress={() => router.push(`/(customer)/cylinder/${cylinderId}` as never)}
                />
              </View>
            ) : null}

            <View style={styles.fieldGroup}>
              <Text style={[styles.fieldLabel, { color: palette.ink }]}>Driver note <Text style={{ color: palette.muted, fontWeight: "600" }}>(optional)</Text></Text>
              <TextInput
                value={instructions}
                onChangeText={setInstructions}
                placeholder="Gate colour, building note or pickup instruction"
                placeholderTextColor={palette.muted}
                multiline
                style={[styles.input, styles.multiline, { backgroundColor: palette.input, borderColor: palette.borderStrong, color: palette.ink }]}
              />
            </View>
            <View style={styles.stepActions}><AppButton label="Back" variant="secondary" onPress={() => setRefillStep(2)} /><AppButton label="Find stations" disabled={!validPurchase || exceedsCylinderCapacity} onPress={() => setRefillStep(4)} /></View>
          </View> : null}

          {refillStep === 4 && tripServiceable ? (
            <StationSelectionSection
              stations={displayedStations}
              selected={stationId}
              onSelect={(id) => {
                setStationId(id);
                setQuoteId(null);
                setQuoteRecord(null);
                setError(null);
              }}
              ready={stationEligibilityReady}
              loading={eligibleStations.isPending}
              failed={eligibleStations.isError}
              onRetry={() => void eligibleStations.refetch()}
            />
          ) : null}

          {refillStep === 4 ? <><AppButton
            label="Review refill"
            fullWidth
            size="lg"
            disabled={
              !tripServiceable ||
              serviceabilityError ||
              locationNeedsMapPosition ||
              !validPurchase ||
              exceedsCylinderCapacity ||
              eligibleStations.isError ||
              stationUnavailable ||
              !stationId
            }
            loading={quote.isPending || serviceabilityPending || eligibleStations.isPending}
            onPress={() => setReviewOpen(true)}
          /><AppButton label="Back" variant="ghost" onPress={() => setRefillStep(3)} /></> : null}

          <AppModal visible={reviewOpen} title="Review your refill" description="Confirm every detail before SKIMA prepares your protected quote." onClose={() => setReviewOpen(false)}>
              <View style={styles.reviewContent}>
                <Text style={[styles.reviewLine, { color: palette.muted }]}>{displayTitle(selectedCylinder ?? {})} • {requestedKg || "—"} kg</Text>
                <Text style={[styles.reviewLine, { color: palette.muted }]}>{selectedStation?.display_name ?? "Selected station"}</Text>
                <Text style={[styles.reviewLine, { color: palette.muted }]}>Pickup and return: {displayTitle(selectedPickupLocation ?? {})} → {displayTitle(selectedDeliveryLocation ?? {})}</Text>
                <Text style={[styles.reviewHint, { color: palette.muted }]}>Next, Matty’s pricing safeguards prepare a quote. No payment is taken until you confirm the quote.</Text>
                <AppButton label={quoteButtonLabel} fullWidth loading={quote.isPending} onPress={() => { setReviewOpen(false); void requestQuote(); }} />
                <AppButton label="Make changes" fullWidth variant="secondary" onPress={() => setReviewOpen(false)} />
              </View>
          </AppModal>
        </>
      )}

      {error ? (
        <View style={[styles.errorBox, { backgroundColor: palette.dangerSoft }]}>
          <Text accessibilityRole="alert" style={[styles.errorText, { color: palette.danger }]}>{error}</Text>
        </View>
      ) : null}

      {!quoteId ? <Text style={[styles.draftNote, { color: palette.muted }]}>Your selections are saved on this device so you can continue if you leave this screen before placing the order.</Text> : null}
    </Screen>
  );
}

function SelectionSection({
  step,
  icon,
  title,
  description,
  records,
  selected,
  onSelect,
  emptyText,
  showImages = false,
}: {
  step: string;
  icon: ReactNode;
  title: string;
  description: string;
  records: PlatformRecord[];
  selected: string;
  onSelect(id: string): void;
  emptyText: string;
  showImages?: boolean;
}) {
  const { palette } = useAppTheme();
  return (
    <View style={[styles.selectionCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <SectionLead step={step} icon={icon} title={title} description={description} />
      {records.length ? (
        <View style={styles.choices}>
          {records.map((item, index) => {
            const id = recordId(item) ?? String(index);
            const active = id === selected;
            return (
              <Pressable key={id} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={() => onSelect(id)} style={[styles.recordChoice, { backgroundColor: active ? palette.brandSoft : palette.surfaceSubtle, borderColor: active ? palette.brand : palette.border }]}>
                {showImages ? <RuntimeMediaImage assetId={firstAssetId(item.image_asset_ids ?? item.imageAssetIds)} label={displayTitle(item)} variant="thumbnail" /> : null}
                <Text style={[styles.recordChoiceText, { color: palette.ink }]}>{displayTitle(item)}</Text>
                {active ? <CheckCircle2 color={palette.brand} size={20} /> : null}
              </Pressable>
            );
          })}
        </View>
      ) : (
        <Text style={[styles.emptyText, { color: palette.muted }]}>{emptyText}</Text>
      )}
    </View>
  );
}

function StationSelectionSection({
  stations,
  selected,
  onSelect,
  ready,
  loading,
  failed,
  onRetry,
}: {
  stations: EligibleLpgStation[];
  selected: string;
  onSelect(id: string): void;
  ready: boolean;
  loading: boolean;
  failed: boolean;
  onRetry(): void;
}) {
  const { palette } = useAppTheme();
  return (
    <View style={[styles.selectionCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <SectionLead
        step="5"
        icon={<Store color={palette.brand} size={20} />}
        title="Choose a station"
        description="Only stations currently able to complete this refill are shown. The closest options appear first."
      />

      {!ready ? (
        <Text style={[styles.emptyText, { color: palette.muted }]}>Enter a valid refill amount to see available stations.</Text>
      ) : loading ? (
        <Text style={[styles.emptyText, { color: palette.muted }]}>Finding stations for this refill…</Text>
      ) : failed ? (
        <View style={styles.stationQueryState}>
          <Text style={[styles.emptyText, { color: palette.muted }]}>We couldn't refresh station availability right now.</Text>
          <AppButton label="Check stations again" variant="secondary" size="sm" onPress={onRetry} />
        </View>
      ) : stations.length === 0 ? (
        <View style={styles.stationQueryState}>
          <Text style={[styles.stationEmptyTitle, { color: palette.ink }]}>No station is available for this refill right now</Text>
          <Text style={[styles.emptyText, { color: palette.muted }]}>A station may be outside its service radius, unavailable, low on stock, missing a current price, or unable to handle this cylinder size. Try another location or check again later.</Text>
        </View>
      ) : (
        <View style={styles.stationOptions}>
          {stations.map((station, index) => {
            const active = station.station_branch_id === selected;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                key={station.station_branch_id}
                onPress={() => onSelect(station.station_branch_id)}
                style={({ pressed }) => [
                  styles.stationOption,
                  {
                    backgroundColor: active ? palette.brandSoft : palette.surfaceSubtle,
                    borderColor: active ? palette.brand : palette.border,
                    opacity: pressed ? 0.78 : 1,
                  },
                ]}
              >
                <View style={styles.stationOptionTop}>
                  <View style={styles.stationOptionCopy}>
                    <View style={styles.stationNameRow}>
                      <Text style={[styles.stationName, { color: palette.ink }]}>{station.display_name}</Text>
                      {index === 0 ? <Text style={[styles.recommendedTag, { color: palette.brand }]}>CLOSEST</Text> : null}
                    </View>
                    <Text style={[styles.stationAddress, { color: palette.muted }]} numberOfLines={2}>{station.formatted_address}</Text>
                  </View>
                  {active ? <CheckCircle2 color={palette.brand} size={21} /> : null}
                </View>
                <View style={styles.stationFacts}>
                  <Text style={[styles.stationFact, { color: palette.ink }]}>{money(station.price_per_kg, station.currency_code)}/kg</Text>
                  <Text style={[styles.stationFactMuted, { color: palette.muted }]}>~{formatDistance(station.route_proxy_distance_meters)} trip</Text>
                  <Text style={[styles.stationFactMuted, { color: palette.muted }]}>{formatKg(station.current_available_kg)} kg available</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      <Text style={[styles.stationFootnote, { color: palette.muted }]}>The final delivery route and full price are calculated when you request the quote.</Text>
    </View>
  );
}

function SectionLead({ step, icon, title, description }: { step: string; icon: ReactNode; title: string; description: string }) {
  const { palette } = useAppTheme();
  return (
    <View style={styles.sectionLead}>
      <View style={[styles.sectionIcon, { backgroundColor: palette.brandSoft }]}>{icon}</View>
      <View style={styles.sectionCopy}>
        <Text style={[styles.sectionStep, { color: palette.brand }]}>STEP {step}</Text>
        <Text style={[styles.sectionTitle, { color: palette.ink }]}>{title}</Text>
        <Text style={[styles.sectionDescription, { color: palette.muted }]}>{description}</Text>
      </View>
    </View>
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

function money(value: number | null, currency: string | null) {
  if (value === null) return "—";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency ?? "NGN" }).format(value);
  } catch {
    return `${currency ?? ""} ${value.toFixed(2)}`.trim();
  }
}

function formatKg(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function firstAssetId(value: unknown): string | null {
  return Array.isArray(value) && typeof value[0] === "string" ? value[0] : null;
}

function formatDistance(distanceMeters: number) {
  if (!Number.isFinite(distanceMeters)) return "—";
  if (distanceMeters < 1000) return `${Math.max(1, Math.round(distanceMeters))} m`;
  return `${(distanceMeters / 1000).toFixed(distanceMeters < 10_000 ? 1 : 0)} km`;
}

function formatDate(value: string | null) {
  if (!value) return "the displayed expiry time";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function resultId(result: string | PlatformRecord | null): string | null {
  if (typeof result === "string") return result;
  return firstString(result, ["id", "lpgOrderId", "lpg_order_id", "lpgRefillQuoteId", "lpg_refill_quote_id"]);
}

function asRecord(value: unknown): PlatformRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as PlatformRecord) : null;
}

function quoteExpired(quote: PlatformRecord) {
  const value = firstString(quote, ["expiresAt", "expires_at"]);
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}

const styles = StyleSheet.create({
  progressCard: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: 2 },
  progressSegment: { flex: 1, height: 5, borderRadius: radii.pill },
  progressText: { ...typography.caption, marginLeft: spacing.sm, fontWeight: "900" },
  stepActions: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
  reviewContent: { gap: spacing.md },
  reviewLine: { ...typography.bodyStrong },
  reviewHint: { ...typography.caption, lineHeight: 18 },
  quoteHero: { gap: spacing.md, padding: spacing.lg, borderRadius: radii.xl },
  quoteHeroTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md },
  quoteEyebrow: { color: "rgba(255,255,255,.76)", ...typography.eyebrow, fontSize: 9 },
  quoteTotal: { color: "#FFFFFF", fontSize: 36, lineHeight: 43, fontWeight: "900", letterSpacing: -1, marginTop: 4 },
  quoteHeroIcon: { width: 48, height: 48, borderRadius: 17, backgroundColor: "rgba(255,255,255,.14)", alignItems: "center", justifyContent: "center" },
  quoteHeroBody: { color: "rgba(255,255,255,.84)", ...typography.caption, lineHeight: 18 },
  quoteCard: { gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.lg },
  quoteHeader: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  confirmIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  quoteHeaderCopy: { flex: 1, gap: 3 },
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
  requirement: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderRadius: radii.lg, padding: spacing.md },
  requirementCopy: { flex: 1, gap: 2 },
  requirementTitle: { ...typography.bodyStrong, fontSize: 14 },
  requirementBody: { ...typography.caption, lineHeight: 17 },
  availabilityCard: { gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  availabilityLead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  availabilityActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  selectionCard: { gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.lg },
  formCard: { gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.lg },
  sectionLead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  sectionIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  sectionCopy: { flex: 1, gap: 2 },
  sectionStep: { ...typography.eyebrow, fontSize: 8 },
  sectionTitle: { ...typography.subheading, fontSize: 15 },
  sectionDescription: { ...typography.caption, lineHeight: 17 },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  recordChoice: { minWidth: 150, flexGrow: 1, flexBasis: 160, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderRadius: radii.lg, padding: spacing.sm },
  recordChoiceText: { flex: 1, ...typography.bodyStrong, fontSize: 13 },
  emptyText: { ...typography.caption, paddingVertical: spacing.xs },
  stationQueryState: { gap: spacing.sm },
  stationEmptyTitle: { ...typography.bodyStrong, fontSize: 14 },
  stationOptions: { gap: spacing.sm },
  stationOption: { gap: spacing.sm, borderWidth: 1, borderRadius: radii.lg, padding: spacing.md },
  stationOptionTop: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  stationOptionCopy: { flex: 1, gap: 3 },
  stationNameRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm },
  stationName: { ...typography.bodyStrong, fontSize: 14 },
  recommendedTag: { ...typography.eyebrow, fontSize: 8 },
  stationAddress: { ...typography.caption, lineHeight: 17 },
  stationFacts: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm + 2 },
  stationFact: { ...typography.caption, fontWeight: "900" },
  stationFactMuted: { ...typography.caption, fontWeight: "700" },
  stationFootnote: { ...typography.caption, lineHeight: 17 },
  capacityNotice: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm + 2, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, padding: spacing.md },
  capacityCopy: { flex: 1, gap: 3 },
  capacityTitle: { ...typography.bodyStrong, fontSize: 13 },
  capacityBody: { ...typography.caption, lineHeight: 17 },
  capacityActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  fieldGroup: { gap: spacing.sm },
  modeSwitch: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  quantityControl: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  quantityInput: { flex: 1, textAlign: "center", fontSize: 22, fontWeight: "900" },
  amountPresets: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  fieldLabel: { ...typography.caption, fontSize: 13, fontWeight: "900" },
  input: { minHeight: 54, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.md, fontSize: 16 },
  multiline: { minHeight: 92, paddingTop: spacing.md, textAlignVertical: "top" },
  errorBox: { borderRadius: radii.md, padding: spacing.md },
  errorText: { ...typography.caption, fontWeight: "800", textAlign: "center" },
  draftNote: { ...typography.caption, lineHeight: 18 },
});
