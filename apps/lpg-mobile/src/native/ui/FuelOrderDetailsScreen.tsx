import { router, useLocalSearchParams } from "expo-router";
import { CheckCircle2, Fuel, KeyRound, Package, RotateCcw, ShieldCheck, Truck } from "lucide-react-native";
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from "react-native";
import { useState } from "react";
import type { ReactNode } from "react";

import { useGatewayMutation, useGatewayQuery } from "../api/gateway";
import { ActionResponseSchema, RecordArraySchema, firstNumber, firstString } from "../api/records";
import { useAppTheme } from "../theme/ThemeProvider";
import { spacing, typography } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { idempotencyKey } from "../utilities/idempotency";
import { AppButton } from "./AppButton";
import { Card } from "./Card";
import { EmptyState } from "./EmptyState";
import { Screen } from "./Screen";
import { StatusPill } from "./StatusPill";

export function FuelOrderDetailsScreen() {
  const { palette } = useAppTheme();
  const params = useLocalSearchParams<{ id?: string }>();
  const orderId = typeof params.id === "string" ? params.id : "";
  const products = useGatewayQuery({
    key: ["fuel", "products"],
    path: "/runtime/fuel/products",
    schema: RecordArraySchema,
    refetchInterval: 60000,
  });
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
  const requestDeliveryChallenge = useGatewayMutation({
    path: "/runtime/fuel/orders/delivery-challenge",
    schema: ActionResponseSchema,
    invalidate: [["fuel", "order", orderId]],
  });
  const fetchDeliveryCode = useGatewayMutation({
    path: "/runtime/otp/delivery",
    schema: ActionResponseSchema,
  });
  const verifyDelivery = useGatewayMutation({
    path: "/runtime/fuel/orders/verify-delivery",
    schema: ActionResponseSchema,
    invalidate: [["fuel", "orders"], ["fuel", "order", orderId], ["orders"], ["wallets"]],
  });
  const [deliveryChallengeId, setDeliveryChallengeId] = useState<string | null>(null);
  const [deliveryCode, setDeliveryCode] = useState<string | null>(null);
  const [verificationCode, setVerificationCode] = useState("");
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [verificationNotice, setVerificationNotice] = useState<string | null>(null);

  const revealDeliveryCode = async (challengeId: string) => {
    setVerificationError(null);
    try {
      const deliveryResult = await fetchDeliveryCode.mutateAsync({
        challengeId,
        idempotencyKey: idempotencyKey("fuel-delivery-code", challengeId),
        source: "skima.fuel.mobile",
      });
      const deliveryEnvelope = responseRecord(deliveryResult);
      const deliveryData = responseRecord(deliveryEnvelope?.data) ?? deliveryEnvelope;
      const code = firstString(deliveryData, ["code"]);
      if (!code) throw new Error("The secure in-app delivery confirmation code is unavailable. Request the code again.");
      setDeliveryCode(code);
      setVerificationCode(code);
      setVerificationNotice("Your order-specific confirmation code is ready. Check the fuel and quantity, then confirm delivery below.");
    } catch (error) {
      setVerificationError(friendlyError(error, "The Fuel delivery code could not be retrieved."));
    }
  };

  const requestCustomerDeliveryCode = async () => {
    setVerificationError(null);
    setVerificationNotice(null);
    try {
      const challengeResult = await requestDeliveryChallenge.mutateAsync({
        orderId,
        idempotencyKey: idempotencyKey("fuel-delivery-challenge", orderId),
        metadata: { customer_requested_delivery_verification: true },
      });
      const challengeEnvelope = responseRecord(challengeResult);
      const challengeData = responseRecord(challengeEnvelope?.data) ?? challengeEnvelope;
      const challengeId = firstString(challengeData, ["challenge_id", "challengeId", "id"]);
      if (!challengeId) throw new Error("SKIMA could not create a delivery verification challenge for this order.");
      setDeliveryChallengeId(challengeId);
      setDeliveryCode(null);
      setVerificationCode("");
      await revealDeliveryCode(challengeId);
    } catch (error) {
      setVerificationError(friendlyError(error, "SKIMA could not create the Fuel delivery verification code."));
    }
  };

  const confirmReceivedDelivery = async (challengeId: string) => {
    setVerificationError(null);
    setVerificationNotice(null);
    if (verificationCode.trim().length < 4) {
      setVerificationError("Enter the confirmation code for this Fuel delivery.");
      return;
    }
    try {
      await verifyDelivery.mutateAsync({
        orderId,
        challengeId,
        code: verificationCode.trim(),
        idempotencyKey: idempotencyKey("fuel-delivery-verify", challengeId),
        metadata: {
          customer_confirmed_physical_handover: true,
          verification_channel: "in_app",
        },
      });
      const [refreshedOperations] = await Promise.all([operations.refetch(), events.refetch()]);
      const refreshedOrder = refreshedOperations.data?.[0] ?? null;
      const confirmedStage = firstString(refreshedOrder, ["stage_key"]);
      const confirmedAt = firstString(refreshedOrder, ["delivery_verified_at"]);
      if (!confirmedAt || !["completed", "return_due"].includes(confirmedStage ?? "")) {
        throw new Error("The code was accepted, but SKIMA has not finished updating this order. Your funds remain protected; refresh and check again.");
      }
      setDeliveryCode(null);
      setVerificationCode("");
      setDeliveryChallengeId(null);
      setVerificationNotice(isRental
        ? "Your delivery is verified. The rental container return is still open; settlement and deposit release wait for station inspection."
        : "Your delivery is verified. SKIMA has closed the purchase and released the protected settlement.");
    } catch (error) {
      setVerificationError(friendlyError(error, "SKIMA could not verify this Fuel delivery. Your funds remain protected; refresh and retry."));
    }
  };

  const order = operations.data?.[0] ?? null;
  const productKey = firstString(order, ["product_key"]) ?? "";
  const productRecord = (products.data ?? []).find((item) => firstString(item, ["key"]) === productKey);
  const product = (firstString(productRecord, ["display_name"]) ?? productKey) || "Fuel";
  const stage = firstString(order, ["stage_key"]) ?? "awaiting_station_acceptance";
  const litres = firstNumber(order, ["requested_litres"]) ?? 0;
  const filled = firstNumber(order, ["filled_litres"]) ?? 0;
  const delivered = firstNumber(order, ["delivered_litres"]) ?? 0;
  const count = firstNumber(order, ["container_count"]) ?? 0;
  const isRental = firstString(order, ["container_mode"]) === "rental";
  const fulfillment = firstString(order, ["fulfillment_mode"]) ?? "independent_driver";
  const rentalReturnPending = isRental && ["return_due", "returned_to_driver", "received_at_station", "inspection", "inspection_passed"].includes(stage);
  const deliveryVerified = Boolean(firstString(order, ["delivery_verified_at"]) || order?.delivery_verified_at);
  const activeDeliveryChallengeId = deliveryChallengeId ?? firstString(order, ["delivery_challenge_id"]);
  const settlementExecutionId = firstString(order, ["settlement_execution_id"]);
  const settlementTransactionId = firstString(order, ["settlement_transaction_id"]);
  const settlementStatementId = firstString(order, ["settlement_statement_id"]);
  const settledAt = firstString(order, ["settled_at"]);
  const depositRefundedAt = firstString(order, ["deposit_refunded_at"]);
  const depositRefundAmount = firstNumber(order, ["deposit_refund_amount"]) ?? 0;
  const settlementReleased = Boolean(settlementExecutionId && settlementTransactionId && settledAt);

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

          <Card title="Payment settlement" description={settlementReleased ? "SKIMA has posted the verified financial distribution for this order." : "Your funds remain protected in SKIMA escrow until the delivery and any rental-container return checks are complete."}>
            <View style={styles.statusLine}>
              <Text style={[styles.muted, { color: palette.muted }]}>Settlement status</Text>
              <StatusPill label={settlementReleased ? "Settled" : "Protected in escrow"} tone={settlementReleased ? "success" : "warning"} />
            </View>
            {settledAt ? <DetailRow icon={<CheckCircle2 color={palette.success} size={17} />} label="Released at" value={formatDate(settledAt)} /> : null}
            {settlementExecutionId ? <DetailRow icon={<ShieldCheck color={palette.success} size={17} />} label="Settlement reference" value={settlementExecutionId.slice(0, 8).toUpperCase()} /> : null}
            {settlementTransactionId ? <DetailRow icon={<Package color={palette.mutedStrong} size={17} />} label="Financial transaction" value={settlementTransactionId.slice(0, 8).toUpperCase()} /> : null}
            {settlementStatementId ? <DetailRow icon={<Package color={palette.mutedStrong} size={17} />} label="Station statement" value="Recorded" /> : null}
            {isRental ? (
              <DetailRow
                icon={<RotateCcw color={depositRefundedAt ? palette.success : palette.warning} size={17} />}
                label="Rental deposit"
                value={depositRefundedAt
                  ? `Returned to your SKIMA wallet · ${depositRefundAmount.toLocaleString()} · ${formatDate(depositRefundedAt)}`
                  : depositRefundAmount<=0 && stage==="completed"
                    ? "No refundable rental deposit was due"
                    : depositRefundAmount>0
                    ? `${depositRefundAmount.toLocaleString()} held until the station receives and inspects all rental containers`
                    : "Refundable deposit amount will be confirmed with your accepted quote and returned after station inspection"}
              />
            ) : null}
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
          {stage === "delivered" && !deliveryVerified ? (
            <Card
              title="Confirm your delivery"
              description="Check that the correct fuel and quantity are physically with you. Request your order-specific code, then press Confirm delivery to complete the handover."
            >
              {verificationError ? <Text accessibilityRole="alert" style={[styles.returnText, { color: palette.danger }]}>{verificationError}</Text> : null}
              {verificationNotice ? <Text style={[styles.muted, { color: palette.success }]}>{verificationNotice}</Text> : null}
              {!activeDeliveryChallengeId ? (
                <AppButton
                  label="I have received the fuel — get confirmation code"
                  fullWidth
                  loading={requestDeliveryChallenge.isPending || fetchDeliveryCode.isPending}
                  icon={<KeyRound color="#FFFFFF" size={18} />}
                  onPress={() => void requestCustomerDeliveryCode()}
                />
              ) : (
                <>
                  <View style={[styles.deliveryCodeCard, { backgroundColor: palette.successSoft, borderColor: palette.success }]}>
                    <Text style={[styles.deliveryCodeLabel, { color: palette.success }]}>Your Fuel delivery code</Text>
                    <Text accessibilityLabel="Your Fuel delivery confirmation code" selectable style={[styles.deliveryCodeValue, { color: palette.success }]}>
                      {deliveryCode ?? "••••••"}
                    </Text>
                    <Text style={[styles.muted, { color: palette.muted }]}>
                      {deliveryCode
                        ? "This code belongs only to this Fuel order. Confirm only after checking your fuel and container handover."
                        : "Reveal the secure in-app code to continue."}
                    </Text>
                  </View>
                  {!deliveryCode ? (
                    <AppButton
                      label="Show confirmation code"
                      fullWidth
                      variant="secondary"
                      loading={fetchDeliveryCode.isPending}
                      disabled={fetchDeliveryCode.isPending}
                      onPress={() => void revealDeliveryCode(activeDeliveryChallengeId)}
                    />
                  ) : null}
                  <Text style={[styles.verificationLabel, { color: palette.ink }]}>Confirm the code</Text>
                  <TextInput
                    accessibilityLabel="Fuel delivery confirmation code"
                    value={verificationCode}
                    onChangeText={setVerificationCode}
                    keyboardType="number-pad"
                    autoComplete="one-time-code"
                    maxLength={8}
                    placeholder="••••••"
                    placeholderTextColor={palette.muted}
                    style={[styles.verificationInput, { backgroundColor: palette.input, borderColor: palette.borderStrong, color: palette.ink }]}
                  />
                  <AppButton
                    label="Confirm delivery"
                    fullWidth
                    loading={verifyDelivery.isPending}
                    disabled={verificationCode.trim().length < 4}
                    onPress={() => void confirmReceivedDelivery(activeDeliveryChallengeId)}
                    icon={<CheckCircle2 color="#FFFFFF" size={18} />}
                  />
                </>
              )}
              <Text style={[styles.muted, { color: palette.muted }]}>
                {isRental
                  ? "This confirms delivery only. Return every empty SKIMA rental container to the assigned driver; station inspection completes the rental order."
                  : "Your verified confirmation automatically closes the purchase and releases the accepted station, driver and SKIMA settlement shares."}
              </Text>
            </Card>
          ) : null}
          {stage === "delivered" && deliveryVerified && isRental ? (
            <Card title="Delivery verified · rental return pending" description="Your fuel delivery has been confirmed. The order remains open until every rental container is received and inspected by the station.">
              <StatusPill label="Return containers to driver" tone="warning" />
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

function DetailRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  const { palette } = useAppTheme();
  return (
    <View style={styles.detailRow}>
      {icon}
      <Text style={[styles.muted, { color: palette.muted }]}>{label}</Text>
      <Text style={[styles.detailValue, { color: palette.ink }]}>{value}</Text>
    </View>
  );
}

function responseRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
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
    delivered: "The driver has completed the handover. Please verify that the fuel and containers are physically with you.",
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
  deliveryCodeCard: { alignItems: "center", justifyContent: "center", gap: spacing.xs, borderWidth: 1, borderRadius: 14, padding: spacing.md },
  deliveryCodeLabel: { ...typography.caption, fontWeight: "800" },
  deliveryCodeValue: { fontSize: 30, fontWeight: "900", letterSpacing: 7, paddingVertical: spacing.xs },
  verificationLabel: { ...typography.caption, fontSize: 13, fontWeight: "900" },
  verificationInput: { minHeight: 58, borderWidth: 1, borderRadius: 12, paddingHorizontal: spacing.md, textAlign: "center", fontSize: 23, fontWeight: "900", letterSpacing: 7 },
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
