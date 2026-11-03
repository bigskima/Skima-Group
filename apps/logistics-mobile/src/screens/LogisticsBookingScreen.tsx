import { createClientIdempotencyKey } from "@skima/frontend-core";
import { router, useLocalSearchParams } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, CheckCircle2, LockKeyhole, MapPin, ShieldCheck, WalletCards } from "lucide-react-native";
import { useMemo, useRef, useState } from "react";
import { Alert, Linking, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { z } from "zod";
import { asNumber, asString, useLogisticsQuery, useLogisticsRecordQuery } from "../api/logistics";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";
import { AppButton } from "../ui/AppButton";
import { AppField } from "../ui/AppField";
import { Card } from "../ui/Card";
import { Screen } from "../ui/Screen";
import { ScreenSkeleton } from "../ui/ScreenSkeleton";
import { SectionHeader } from "../ui/SectionHeader";
import { StatePanel } from "../ui/StatePanel";
import { StatusPill } from "../ui/StatusPill";
import { LogisticsPublicEntityImage } from "../ui/LogisticsPublicEntityImage";

function nested(record: Record<string, unknown> | null | undefined, key: string) {
  const value = record?.[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function LogisticsBookingScreen() {
  const { id: routeId } = useLocalSearchParams<{ id: string }>();
  const bookingId = Array.isArray(routeId) ? routeId[0] : routeId;
  const { palette } = useAppTheme();
  const { api, session } = useSession();
  const queryClient = useQueryClient();
  const bookings = useLogisticsQuery(["bookings"], "/runtime/logistics/bookings", Boolean(bookingId));
  const walletsQuery = useLogisticsQuery(["wallets"], "/runtime/wallets");
  const balancesQuery = useLogisticsQuery(["wallet-balances"], "/runtime/wallet-balances");
  const booking = (bookings.data ?? []).find((item) => asString(item, "id") === bookingId) ?? null;
  const status = asString(booking, "status") ?? "awaiting_payment";
  const assignmentRows = Array.isArray(booking?.assignments)
    ? booking.assignments.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
  const activeAssignment = [...assignmentRows].reverse().find((item) =>
    ["offered", "accepted", "in_progress", "picked_up", "in_transit", "delivery_submitted"].includes(asString(item, "status") ?? "")
  ) ?? null;
  const assignedDriver = nested(activeAssignment, "driver");
  const assignedVehicle = nested(activeAssignment, "vehicle");
  const assignedDriverProfileId = asString(activeAssignment, "driver_profile_id");
  const assignedVehicleId = asString(activeAssignment, "vehicle_id");
  const incidentsQuery = useLogisticsQuery(
    ["booking-incidents", bookingId ?? "none"],
    "/runtime/logistics/bookings/incidents?bookingId=" + encodeURIComponent(bookingId ?? ""),
    Boolean(bookingId), 15_000,
  );
  const disputesQuery = useLogisticsQuery(
    ["booking-disputes", bookingId ?? "none"],
    "/runtime/logistics/bookings/disputes?bookingId=" + encodeURIComponent(bookingId ?? ""),
    Boolean(bookingId), 15_000,
  );
  const incidentRows = (incidentsQuery.data ?? []) as Record<string, unknown>[];
  const disputeRows = (disputesQuery.data ?? []) as Record<string, unknown>[];
  const activeDispute = [...disputeRows].reverse().find((item) => ["open", "under_review", "escalated"].includes(asString(item, "status") ?? "")) ?? null;
  const tracking = useLogisticsRecordQuery(
    ["booking-tracking", bookingId ?? "none"],
    "/runtime/logistics/bookings/tracking?bookingId=" + encodeURIComponent(bookingId ?? ""),
    Boolean(bookingId && ["in_progress", "delivery_exception", "failed_delivery", "disputed", "delivered", "settled", "completed_offline"].includes(status)),
    15_000,
  );
  const trackingSession = tracking.data?.tracking_session && typeof tracking.data.tracking_session === "object" && !Array.isArray(tracking.data.tracking_session)
    ? tracking.data.tracking_session as Record<string, unknown>
    : null;
  const trackingPoints = Array.isArray(tracking.data?.points)
    ? tracking.data.points.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
  const latestTrackingPoint = trackingPoints[trackingPoints.length - 1] ?? null;
  const latestLatitude = asNumber(latestTrackingPoint, "latitude");
  const latestLongitude = asNumber(latestTrackingPoint, "longitude");
  const assignedDriverProfileId = asString(booking, "assigned_driver_profile_id");
  const assignedVehicleId = asString(booking, "assigned_vehicle_id");
  const currency = asString(booking, "currency_code") ?? "";
  const customerId = session?.user.id ?? "";
  const customerWallets = useMemo(() => (walletsQuery.data ?? []).filter((wallet) =>
    asString(wallet, "wallet_type") === "customer" &&
    asString(wallet, "owner_entity_type") === "user" &&
    asString(wallet, "owner_entity_id") === customerId &&
    asString(wallet, "currency_code") === currency &&
    asString(wallet, "status") === "active"
  ), [walletsQuery.data, customerId, currency]);
  const [selectedWalletId, setSelectedWalletId] = useState("");
  const [disputeReason, setDisputeReason] = useState("non_delivery");
  const [disputeDetails, setDisputeDetails] = useState("");
  const [error, setError] = useState<string | null>(null);
  const cancelAttemptRef = useRef<string | null>(null);

  const walletBalances = balancesQuery.data ?? [];
  const walletWithBalance = customerWallets.map((wallet) => ({
    ...wallet,
    balance: walletBalances.find((item) => asString(item, "wallet_id") === asString(wallet, "id"))?.balance ?? 0,
  }));
  const preferredWalletId = selectedWalletId || asString(booking, "payment_attempt_wallet_id") || "";
  const selectedWallet = walletWithBalance.find((wallet) => asString(wallet, "id") === preferredWalletId)
    ?? (status === "payment_processing" ? null : walletWithBalance[0] ?? null);
  const total = asNumber(booking, "total_customer_charge") ?? 0;
  const bookingFee = asNumber(booking, "customer_booking_fee_amount") ?? 0;
  const delivery = asNumber(booking, "delivery_amount") ?? 0;
  const providerReceival = asNumber(booking, "provider_receival_fee_amount") ?? 0;
  const paymentMode = asString(booking, "payment_mode") ?? "online_wallet";
  const balance = Number(selectedWallet?.balance ?? 0);
  const requiredFromCustomer = paymentMode === "offline" ? bookingFee : total;
  const enoughBalance = Number.isFinite(balance) && balance >= requiredFromCustomer;

  const payOnline = useMutation({
    mutationFn: async () => api.post("/runtime/logistics/bookings/pay", {
      bookingId,
      walletId: asString(selectedWallet, "id"),
      idempotencyKey: createClientIdempotencyKey("logistics.booking.pay", bookingId),
    }, z.record(z.string(), z.unknown())),
    onSuccess: async () => { setError(null); await bookings.refetch(); },
    onError: async (cause) => {
      setError(cause instanceof Error ? cause.message : "Wallet payment could not be completed.");
      await bookings.refetch();
    },
  });
  const confirmOffline = useMutation({
    mutationFn: async () => api.post("/runtime/logistics/bookings/offline/confirm", {
      bookingId,
      walletId: asString(selectedWallet, "id"),
      idempotencyKey: createClientIdempotencyKey("logistics.booking.offline-confirm", bookingId),
    }, z.record(z.string(), z.unknown())),
    onSuccess: async () => { setError(null); await bookings.refetch(); },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "Offline fee confirmation could not be completed."),
  });
  const cancelBooking = useMutation({
    mutationFn: async () => {
      if (!bookingId) throw new Error("The booking identifier is missing.");
      const idempotencyKey = cancelAttemptRef.current ?? createClientIdempotencyKey("logistics.booking.cancel", bookingId);
      cancelAttemptRef.current = idempotencyKey;
      return api.post("/runtime/logistics/bookings/cancel", {
        bookingId,
        reason: "Cancelled by the customer before payment or offline fees were collected.",
        idempotencyKey,
      }, z.string().uuid());
    },
    onSuccess: async () => {
      setError(null);
      cancelAttemptRef.current = null;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["skima-logistics", "bookings"] }),
        queryClient.invalidateQueries({ queryKey: ["skima-logistics", "jobs"] }),
        bookings.refetch(),
      ]);
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "The booking could not be cancelled."),
  });

  const confirmDelivery = useMutation({
    mutationFn: async () => api.post("/runtime/logistics/bookings/delivery/confirm", {
      bookingId,
      idempotencyKey: createClientIdempotencyKey("logistics.booking.delivery-confirm", bookingId),
    }, z.record(z.string(), z.unknown())),
    onSuccess: async () => {
      setError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["skima-logistics", "bookings"] }),
        bookings.refetch(),
      ]);
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "Delivery confirmation could not be completed."),
  });
  const openDispute = useMutation({
    mutationFn: async () => {
      if (!bookingId || disputeDetails.trim().length < 5) {
        throw new Error("Explain the delivery problem in at least five characters.");
      }
      const latestIncident = [...incidentRows].reverse().find((item) => asString(item, "id"));
      return api.post("/runtime/logistics/bookings/disputes/open", {
        bookingId,
        reason: disputeReason,
        details: disputeDetails.trim(),
        incidentId: asString(latestIncident, "id") ?? null,
        idempotencyKey: createClientIdempotencyKey(
          "logistics.customer.dispute",
          bookingId + ":" + disputeReason + ":" + disputeDetails.trim(),
        ),
      }, z.string().uuid());
    },
    onSuccess: async () => {
      setError(null);
      setDisputeDetails("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["skima-logistics", "bookings"] }),
        queryClient.invalidateQueries({ queryKey: ["skima-logistics", "booking-disputes"] }),
        disputesQuery.refetch(), bookings.refetch(),
      ]);
      Alert.alert("Dispute opened", paymentMode === "online_wallet"
        ? "The booking is now under review. The original escrow is held while SKIMA investigates; no provider settlement can proceed."
        : "The booking is now under review. Offline payment disputes require finance review and will not trigger an automatic wallet refund.");
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "The delivery dispute could not be opened."),
  });

  const refresh = async () => { await Promise.all([bookings.refetch(), walletsQuery.refetch(), balancesQuery.refetch(), tracking.refetch(), incidentsQuery.refetch(), disputesQuery.refetch()]); };
  const isWorking = payOnline.isPending || confirmOffline.isPending || confirmDelivery.isPending || cancelBooking.isPending || openDispute.isPending;

  return (
    <Screen eyebrow="BOOKING" title="Booking & payment" subtitle="Review the total and complete the payment step securely."
      action={<AppButton label="Back" size="sm" variant="secondary" icon={<ArrowLeft color={palette.ink} size={15} />} onPress={() => router.back()} />}
      refreshControl={<RefreshControl refreshing={bookings.isRefetching || walletsQuery.isRefetching || balancesQuery.isRefetching || tracking.isRefetching} onRefresh={() => void refresh()} tintColor={palette.brand} />}>
      {bookings.isPending ? <ScreenSkeleton cards={3} /> : !booking ? (
        <StatePanel title="Booking not found" description="This booking may not be available to the signed-in account." retry={() => void bookings.refetch()} />
      ) : (
        <View style={styles.content}>
          <Card variant={status === "payment_reserved" || status === "offline_payment_confirmed" ? "success" : "default"} padding="lg">
            <View style={styles.bookingHead}>
              <View style={[styles.bookingIcon, { backgroundColor: status === "payment_reserved" || status === "offline_payment_confirmed" ? palette.successSoft : palette.brandSoft }]}>
                {status === "payment_reserved" || status === "offline_payment_confirmed" ? <CheckCircle2 color={palette.success} size={21} /> : <LockKeyhole color={palette.brand} size={21} />}
              </View>
              <View style={styles.bookingCopy}>
                <Text style={[styles.bookingTitle, { color: palette.ink }]}>Logistics booking</Text>
                <Text style={[styles.bookingRef, { color: palette.muted }]}>{bookingId?.slice(0, 8).toUpperCase()}</Text>
              </View>
              <StatusPill status={status} />
            </View>
            <Text style={[styles.totalEyebrow, { color: palette.muted }]}>{paymentMode === "offline" ? "TOTAL BOOKING VALUE" : "TOTAL CUSTOMER CHARGE"}</Text>
            <Text style={[styles.total, { color: palette.ink }]}>{formatMoney(total, currency)}</Text>
            <Text style={[styles.totalHint, { color: palette.muted }]}>{paymentMode === "offline" ? "The delivery price is paid offline to the provider. Only the configured customer booking fee is collected from your wallet." : "Includes the provider delivery price and your configured customer booking fee, reserved together in escrow."}</Text>
            <View style={[styles.amountDivider, { backgroundColor: palette.border }]} />
            <AmountLine label="Provider delivery price" value={formatMoney(delivery, currency)} />
            <AmountLine label="Customer booking fee" value={formatMoney(bookingFee, currency)} />
            {paymentMode === "offline" ? <AmountLine label="Provider receival fee" value="Paid by the company" subtle /> : null}
            {paymentMode === "online_wallet" && (asNumber(booking, "provider_commission_amount") ?? 0) > 0 ? <AmountLine label="Provider commission" value="Deducted from provider proceeds" subtle /> : null}
          </Card>

          {activeAssignment ? (
            <Card padding="lg" gap={spacing.md}>
              <SectionHeader title="Your assigned driver & vehicle" description="Check the driver and vehicle your company provider has assigned to this booking." />
              <View style={styles.assignmentPerson}>
                <LogisticsPublicEntityImage entityType="driver" entityId={assignedDriverProfileId}
                  mediaRole="driver.photo.public" size={68} />
                <View style={styles.assignmentCopy}>
                  <Text style={[styles.assignmentLabel, { color: palette.muted }]}>YOUR DRIVER</Text>
                  <Text style={[styles.assignmentTitle, { color: palette.ink }]}>{asString(assignedDriver, "driver_display_name") ?? asString(assignedDriver, "public_driver_id") ?? "Assigned driver"}</Text>
                  <Text style={[styles.assignmentMeta, { color: palette.muted }]}>{asString(assignedDriver, "public_driver_id") ?? "SKIMA driver"}</Text>
                  <StatusPill status={asString(activeAssignment, "status") ?? "offered"} />
                </View>
              </View>
              <View style={styles.assignmentDivider} />
              <View style={styles.assignmentPerson}>
                <LogisticsPublicEntityImage entityType="logistics_vehicle" entityId={assignedVehicleId}
                  mediaRole="logistics.vehicle.photo.public" size={68} />
                <View style={styles.assignmentCopy}>
                  <Text style={[styles.assignmentLabel, { color: palette.muted }]}>YOUR VEHICLE</Text>
                  <Text style={[styles.assignmentTitle, { color: palette.ink }]}>
                    {[asString(assignedVehicle, "manufacturer"), asString(assignedVehicle, "model")].filter(Boolean).join(" ") || "Assigned company vehicle"}
                  </Text>
                  <Text style={[styles.assignmentMeta, { color: palette.muted }]}>
                    {asString(assignedVehicle, "registration_number") ?? "Registration not provided"}
                  </Text>
                </View>
              </View>
            </Card>
          ) : null}

          {["in_progress", "delivered", "settled", "completed_offline"].includes(status) ? (
            <Card padding="lg">
              <View style={styles.sectionHeading}>
                <View style={[styles.sectionIcon, { backgroundColor: palette.brandSoft }]}><MapPin color={palette.brand} size={18} /></View>
                <View style={styles.sectionCopy}>
                  <Text style={[styles.sectionTitle, { color: palette.ink }]}>Driver location</Text>
                  <Text style={[styles.sectionDescription, { color: palette.muted }]}>Location updates are shared by your assigned driver during the active delivery.</Text>
                </View>
                {trackingSession ? <StatusPill status={asString(trackingSession, "status") ?? "active"} /> : null}
              </View>
              {tracking.isPending ? (
                <Text style={[styles.sectionDescription, { color: palette.muted }]}>Checking for the latest driver location…</Text>
              ) : latestLatitude !== null && latestLongitude !== null ? (
                <View style={[styles.balanceRow, { backgroundColor: palette.surfaceSubtle }]}>
                  <Text style={[styles.balanceLabel, { color: palette.muted }]}>Latest shared position</Text>
                  <Text style={[styles.balanceValue, { color: palette.ink }]}>{latestLatitude.toFixed(5)}, {latestLongitude.toFixed(5)}</Text>
                  {asString(latestTrackingPoint, "recorded_at") ? <Text style={[styles.sectionDescription, { color: palette.muted }]}>Updated {new Date(String(latestTrackingPoint?.recorded_at)).toLocaleString("en-NG")}</Text> : null}
                  <AppButton
                    label="Open location in Maps"
                    fullWidth
                    variant="secondary"
                    onPress={() => void Linking.openURL("https://www.google.com/maps/search/?api=1&query=" + latestLatitude + "," + latestLongitude)}
                  />
                </View>
              ) : (
                <Text style={[styles.sectionDescription, { color: palette.muted }]}>
                  The driver has not shared a location yet. Their latest location will appear here while they are sharing from the Logistics driver workspace.
                </Text>
              )}
              {tracking.error ? <Text style={[styles.inlineError, { color: palette.danger }]}>The latest tracking update could not be loaded. Pull down to retry.</Text> : null}
            </Card>
          ) : null}

          {status === "awaiting_payment" || status === "awaiting_offline_confirmation" ? (
            <Card variant="warning" padding="lg">
              <View style={styles.sectionHeading}>
                <AlertCircle color={palette.warning} size={19} />
                <Text style={[styles.sectionTitle, { color: palette.ink }]}>Booking not paid yet</Text>
              </View>
              <Text style={[styles.sectionDescription, { color: palette.muted }]}>
                You can cancel before online escrow is funded or before the offline booking fees are collected. Once a payment record exists, this cancellation option is no longer available.
              </Text>
              <AppButton
                label="Cancel booking"
                fullWidth
                variant="secondary"
                loading={cancelBooking.isPending}
                disabled={isWorking}
                onPress={() => Alert.alert(
                  "Cancel this booking?",
                  "The booking, selected offer and customer request will be closed. No wallet debit, refund or provider payout will be created.",
                  [
                    { text: "Keep booking", style: "cancel" },
                    { text: "Cancel booking", style: "destructive", onPress: () => { setError(null); cancelBooking.mutate(); } },
                  ],
                )}
              />
            </Card>
          ) : status === "cancelled" ? (
            <Card variant="subtle" padding="lg">
              <View style={styles.sectionHeading}>
                <CheckCircle2 color={palette.success} size={19} />
                <Text style={[styles.sectionTitle, { color: palette.ink }]}>Booking cancelled</Text>
              </View>
              <Text style={[styles.sectionDescription, { color: palette.muted }]}>This booking was cancelled before payment. No refund or settlement was needed.</Text>
              <AppButton label="Back to requests" fullWidth variant="secondary" onPress={() => router.replace("/(customer)/jobs" as never)} />
            </Card>
          ) : null}

          {paymentMode === "online_wallet" ? (
            <Card padding="lg">
              <View style={styles.sectionHeading}>
                <View style={[styles.sectionIcon, { backgroundColor: palette.brandSoft }]}><WalletCards color={palette.brand} size={19} /></View>
                <View style={styles.sectionCopy}>
                  <Text style={[styles.sectionTitle, { color: palette.ink }]}>Pay from your wallet</Text>
                  <Text style={[styles.sectionDescription, { color: palette.muted }]}>The full delivery amount and booking fee are reserved securely in escrow.</Text>
                </View>
              </View>
              {status === "payment_processing" ? (
                <View style={[styles.balanceRow, { backgroundColor: palette.warningSoft }]}>
                  <Text style={[styles.balanceLabel, { color: palette.ink }]}>Payment attempt in progress</Text>
                  <Text style={[styles.balanceValue, { color: palette.ink }]}>{asString(selectedWallet, "currency_code") ?? currency} wallet</Text>
                  <Text style={[styles.sectionDescription, { color: palette.muted }]}>The original wallet is locked to this attempt. Continue with the same wallet so an existing debit or escrow hold is not duplicated.</Text>
                </View>
              ) : (
                <WalletPicker wallets={walletWithBalance} selectedId={preferredWalletId || asString(selectedWallet, "id") || ""} onSelect={setSelectedWalletId} />
              )}
              {walletWithBalance.length === 0 ? <StatePanel title="No active wallet found" description={`An active customer wallet in ${currency} is required for this booking.`} /> : (
                <View style={[styles.balanceRow, { backgroundColor: palette.surfaceSubtle }]}>
                  <Text style={[styles.balanceLabel, { color: palette.muted }]}>Available balance</Text>
                  <Text style={[styles.balanceValue, { color: palette.ink }]}>{formatMoney(balance, currency)}</Text>
                </View>
              )}
              <AppButton label={status === "payment_processing" ? "Continue payment confirmation" : "Pay securely"} fullWidth loading={payOnline.isPending} disabled={!selectedWallet || (status !== "payment_processing" && !enoughBalance) || !["awaiting_payment", "payment_processing"].includes(status) || isWorking} onPress={() => { setError(null); payOnline.mutate(); }} icon={<LockKeyhole color="#FFFFFF" size={16} />} />
              {selectedWallet && !enoughBalance && status !== "payment_processing" ? <Text style={[styles.inlineError, { color: palette.danger }]}>Your selected wallet does not have enough balance for this booking.</Text> : null}
            </Card>
          ) : (
            <Card padding="lg">
              <View style={styles.sectionHeading}>
                <View style={[styles.sectionIcon, { backgroundColor: palette.successSoft }]}><ShieldCheck color={palette.success} size={19} /></View>
                <View style={styles.sectionCopy}>
                  <Text style={[styles.sectionTitle, { color: palette.ink }]}>Offline payment</Text>
                  <Text style={[styles.sectionDescription, { color: palette.muted }]}>Your wallet pays the customer booking fee. The provider receival fee is separately charged to the company’s wallet.</Text>
                </View>
              </View>
              <WalletPicker wallets={walletWithBalance} selectedId={selectedWalletId || asString(selectedWallet, "id") || ""} onSelect={setSelectedWalletId} />
              {walletWithBalance.length === 0 ? <StatePanel title="No active wallet found" description={`An active customer wallet in ${currency} is required to collect your booking fee.`} /> : (
                <View style={[styles.balanceRow, { backgroundColor: palette.surfaceSubtle }]}>
                  <Text style={[styles.balanceLabel, { color: palette.muted }]}>Your wallet · booking fee only</Text>
                  <Text style={[styles.balanceValue, { color: palette.ink }]}>{formatMoney(balance, currency)}</Text>
                </View>
              )}
              <AppButton label="Confirm offline booking fee" fullWidth loading={confirmOffline.isPending} disabled={!selectedWallet || !enoughBalance || status !== "awaiting_offline_confirmation"} onPress={() => { setError(null); confirmOffline.mutate(); }} />
              {selectedWallet && !enoughBalance ? <Text style={[styles.inlineError, { color: palette.danger }]}>Your selected wallet does not have enough balance for the booking fee.</Text> : null}
            </Card>
          )}

          {status === "delivered" ? (
            <Card variant="warning" padding="lg">
              <View style={styles.sectionHeading}>
                <ShieldCheck color={palette.warning} size={21} />
                <Text style={[styles.sectionTitle, { color: palette.ink }]}>Confirm the delivery</Text>
              </View>
              <Text style={[styles.sectionDescription, { color: palette.muted }]}>
                The provider has submitted the hand-off. Please confirm that you received the delivery. {paymentMode === "online_wallet" ? "Your escrowed payment will then be split between the provider’s net proceeds and the configured SKIMA fees." : "Your offline delivery is already paid directly to the provider; this confirmation will not charge another provider fee."}
              </Text>
              <AppButton label="Confirm delivery received" fullWidth loading={confirmDelivery.isPending}
                onPress={() => Alert.alert(
                  "Confirm delivery?",
                  paymentMode === "online_wallet"
                    ? "This confirms receipt and releases the protected escrow according to the booking's locked fee breakdown."
                    : "This records completion. No online commission or additional provider receival fee will be charged.",
                  [
                    { text: "Not yet", style: "cancel" },
                    { text: "Confirm delivery", onPress: () => { setError(null); confirmDelivery.mutate(); } },
                  ],
                )}
                icon={<CheckCircle2 color="#FFFFFF" size={16} />}
              />
            </Card>
          ) : null}

          {activeDispute ? (
            <Card variant="warning" padding="lg">
              <View style={styles.sectionHeading}>
                <ShieldCheck color={palette.warning} size={20} />
                <Text style={[styles.sectionTitle, { color: palette.ink }]}>Customer protection review</Text>
                <StatusPill status={asString(activeDispute, "status") ?? "open"} />
              </View>
              <Text style={[styles.sectionDescription, { color: palette.muted }]}>
                Your dispute is recorded for SKIMA review. {paymentMode === "online_wallet"
                  ? "The original escrow remains frozen; the provider cannot be settled while the dispute is open."
                  : "This booking was paid offline, so any payment reversal requires a manual finance review."}
              </Text>
              <Text style={[styles.sectionDescription, { color: palette.ink }]}>Reason: {(asString(activeDispute, "reason") ?? "other").replace(/_/g, " ")}</Text>
              <Text style={[styles.sectionDescription, { color: palette.muted }]}>{asString(activeDispute, "details")}</Text>
              {asString(activeDispute, "resolution_note") ? <Text style={[styles.sectionDescription, { color: palette.muted }]}>Review update: {asString(activeDispute, "resolution_note")}</Text> : null}
            </Card>
          ) : ["delivered", "delivery_exception", "failed_delivery"].includes(status) ? (
            <Card variant="warning" padding="lg">
              <View style={styles.sectionHeading}>
                <ShieldCheck color={palette.warning} size={20} />
                <Text style={[styles.sectionTitle, { color: palette.ink }]}>Report a delivery problem</Text>
              </View>
              <Text style={[styles.sectionDescription, { color: palette.muted }]}>
                Report non-delivery, damaged or partial cargo, or an unauthorized hand-off. Opening a dispute blocks settlement while SKIMA reviews the evidence.
              </Text>
              <View style={styles.disputeReasons}>
                {[
                  ["non_delivery", "Not received"],
                  ["partial_delivery", "Partial delivery"],
                  ["damaged_cargo", "Cargo damaged"],
                  ["wrong_delivery", "Wrong cargo"],
                  ["recipient_not_authorized", "Wrong recipient"],
                  ["other", "Other"],
                ].map(([value, label]) => {
                  const selected = disputeReason === value;
                  return (
                    <Pressable
                      key={value}
                      onPress={() => setDisputeReason(value)}
                      style={[
                        styles.disputeReason,
                        {
                          borderColor: selected ? palette.brand : palette.border,
                          backgroundColor: selected ? palette.brandSoft : palette.surface,
                        },
                      ]}
                    >
                      <Text style={[styles.sectionDescription, { color: selected ? palette.brand : palette.ink }]}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <AppField
                label="Describe the problem"
                value={disputeDetails}
                onChangeText={setDisputeDetails}
                placeholder="Tell us what was missing, damaged or not delivered."
                multiline
              />
              <AppButton
                label="Open customer dispute"
                fullWidth
                loading={openDispute.isPending}
                disabled={openDispute.isPending || disputeDetails.trim().length < 5}
                onPress={() => Alert.alert(
                  "Open a dispute?",
                  paymentMode === "online_wallet"
                    ? "The booking will be paused and its escrow held for investigation. No provider payout will be released."
                    : "The booking will be escalated for offline finance review. This does not automatically reverse the payment made to the provider.",
                  [
                    { text: "Not now", style: "cancel" },
                    { text: "Open dispute", style: "destructive", onPress: () => { setError(null); openDispute.mutate(); } },
                  ],
                )}
              />
            </Card>
          ) : null}

          {status === "settled" ? (
            <Card variant="success" padding="lg">
              <View style={styles.sectionHeading}><CheckCircle2 color={palette.success} size={21} /><Text style={[styles.sectionTitle, { color: palette.ink }]}>Delivery confirmed · payment settled</Text></View>
              <Text style={[styles.sectionDescription, { color: palette.muted }]}>The shared escrow settlement has been recorded. The provider receives the locked net amount and SKIMA receives the configured booking fee and online commission.</Text>
            </Card>
          ) : null}
          {status === "completed_offline" ? (
            <Card variant="success" padding="lg">
              <View style={styles.sectionHeading}><CheckCircle2 color={palette.success} size={21} /><Text style={[styles.sectionTitle, { color: palette.ink }]}>Offline delivery completed</Text></View>
              <Text style={[styles.sectionDescription, { color: palette.muted }]}>Your delivery confirmation is recorded. The customer booking fee and provider receival fee were collected earlier; no online commission or second provider fee was charged.</Text>
            </Card>
          ) : null}
          {status === "payment_reserved" ? (
            <Card variant="success" padding="lg">
              <View style={styles.sectionHeading}><ShieldCheck color={palette.success} size={21} /><Text style={[styles.sectionTitle, { color: palette.ink }]}>Payment protected in escrow</Text></View>
              <Text style={[styles.sectionDescription, { color: palette.muted }]}>Your online payment is reserved. The provider settlement follows the verified delivery process.</Text>
            </Card>
          ) : null}
          {status === "offline_payment_confirmed" ? (
            <Card variant="success" padding="lg">
              <View style={styles.sectionHeading}><CheckCircle2 color={palette.success} size={21} /><Text style={[styles.sectionTitle, { color: palette.ink }]}>Booking fee confirmed</Text></View>
              <Text style={[styles.sectionDescription, { color: palette.muted }]}>Your customer booking fee has been recorded. The company’s receival fee was handled separately.</Text>
            </Card>
          ) : null}

          {openDispute.error ? <View style={[styles.error, { backgroundColor: palette.dangerSoft }]}><AlertCircle color={palette.danger} size={16} /><Text style={[styles.inlineError, { color: palette.danger }]}>{openDispute.error instanceof Error ? openDispute.error.message : "The delivery dispute could not be opened."}</Text></View> : null}
          {error ? <View style={[styles.error, { backgroundColor: palette.dangerSoft }]}><AlertCircle color={palette.danger} size={16} /><Text style={[styles.inlineError, { color: palette.danger }]}>{error}</Text></View> : null}
        </View>
      )}
    </Screen>
  );
}

function WalletPicker({ wallets, selectedId, onSelect }: { wallets: Record<string, unknown>[]; selectedId: string; onSelect(id: string): void }) {
  const { palette } = useAppTheme();
  if (!wallets.length) return null;
  return (
    <View style={styles.walletList}>
      {wallets.map((wallet, index) => {
        const id = asString(wallet, "id") ?? "";
        const selected = selectedId === id;
        const balance = Number(wallet.balance ?? 0);
        return (
          <Pressable key={id || index} onPress={() => onSelect(id)} style={[styles.walletChoice, { borderColor: selected ? palette.brand : palette.border, backgroundColor: selected ? palette.brandSofter : palette.surface }]}>
            <View style={[styles.walletIcon, { backgroundColor: palette.brandSoft }]}><WalletCards color={palette.brand} size={17} /></View>
            <View style={styles.walletCopy}>
              <Text style={[styles.walletName, { color: palette.ink }]}>{asString(wallet, "currency_code") ?? "Wallet"} wallet</Text>
              <Text style={[styles.walletBalance, { color: palette.muted }]}>{formatMoney(balance, asString(wallet, "currency_code") ?? "")} available</Text>
            </View>
            <View style={[styles.radio, { borderColor: selected ? palette.brand : palette.borderStrong }]}>{selected ? <View style={[styles.radioDot, { backgroundColor: palette.brand }]} /> : null}</View>
          </Pressable>
        );
      })}
    </View>
  );
}
function AmountLine({ label, value, subtle = false }: { label: string; value: string; subtle?: boolean }) {
  const { palette } = useAppTheme();
  return <View style={styles.amountLine}><Text style={[styles.amountLabel, { color: palette.muted }]}>{label}</Text><Text style={[styles.amountValue, { color: subtle ? palette.muted : palette.ink }]}>{value}</Text></View>;
}
function formatMoney(amount: number, currency: string) {
  if (!currency) return amount.toLocaleString("en-NG");
  try { return new Intl.NumberFormat("en-NG", { style: "currency", currency }).format(amount); }
  catch { return `${currency} ${amount.toLocaleString("en-NG")}`; }
}
const styles = StyleSheet.create({
  content: { gap: spacing.md },
  assignmentPerson: { flexDirection: "row", alignItems: "center", gap: 12 },
  assignmentCopy: { flex: 1, minWidth: 0, gap: 3 },
  assignmentLabel: { ...typography.eyebrow, fontSize: 8 },
  assignmentTitle: { ...typography.bodyStrong, fontSize: 13 },
  assignmentMeta: { ...typography.caption, fontSize: 10 },
  assignmentDivider: { height: StyleSheet.hairlineWidth, backgroundColor: "rgba(128,128,128,0.22)" },
  bookingHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  bookingIcon: { width: 43, height: 43, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  bookingCopy: { flex: 1, gap: 2 },
  bookingTitle: { ...typography.bodyStrong, fontSize: 14 },
  bookingRef: { ...typography.caption, fontSize: 9 },
  totalEyebrow: { ...typography.eyebrow, fontSize: 8, marginTop: 5 },
  total: { ...typography.display, fontSize: 31, lineHeight: 37 },
  totalHint: { ...typography.caption, lineHeight: 17, fontSize: 10 },
  amountDivider: { height: StyleSheet.hairlineWidth, marginVertical: 3 },
  amountLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  amountLabel: { ...typography.caption, fontSize: 10 },
  amountValue: { ...typography.caption, fontWeight: "900", fontSize: 11, textAlign: "right" },
  sectionHeading: { flexDirection: "row", alignItems: "center", gap: 9 },
  sectionIcon: { width: 40, height: 40, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  sectionCopy: { flex: 1, gap: 2 },
  sectionTitle: { ...typography.bodyStrong, fontSize: 13 },
  sectionDescription: { ...typography.caption, lineHeight: 17, fontSize: 10 },
  balanceRow: { borderRadius: radii.lg, padding: 12, gap: 4 },
  balanceLabel: { ...typography.caption, fontSize: 9 },
  balanceValue: { ...typography.bodyStrong, fontSize: 15 },
  walletList: { gap: 8 },
  disputeReasons: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  disputeReason: { borderWidth: 1, borderRadius: radii.md, paddingHorizontal: 9, paddingVertical: 8 },
  walletChoice: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: radii.lg, padding: 10 },
  walletIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  walletCopy: { flex: 1, gap: 2 },
  walletName: { ...typography.bodyStrong, fontSize: 11 },
  walletBalance: { ...typography.caption, fontSize: 9 },
  radio: { width: 19, height: 19, borderRadius: 10, borderWidth: 1.6, alignItems: "center", justifyContent: "center" },
  radioDot: { width: 9, height: 9, borderRadius: 5 },
  inlineError: { ...typography.caption, fontSize: 10, flex: 1, lineHeight: 17 },
  error: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderRadius: radii.md, padding: spacing.md },
});
