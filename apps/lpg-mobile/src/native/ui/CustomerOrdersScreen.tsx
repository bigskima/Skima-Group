import { router, useLocalSearchParams } from "expo-router";
import { ChevronRight, ClipboardList, MapPin, PackageCheck, ShieldCheck, Truck } from "lucide-react-native";
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { domainQueries, useJobDetails } from "../api/domains";
import {
  displayReference,
  displayStatus,
  firstNumber,
  firstString,
  nestedRecord,
  recordId,
  type PlatformRecord,
} from "../api/records";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { AppButton } from "./AppButton";
import { Card } from "./Card";
import { EmptyState } from "./EmptyState";
import { Screen } from "./Screen";
import { StatusPill } from "./StatusPill";

const TRACKABLE_ORDER_STATES = new Set([
  "driver_accepted",
  "assigned",
  "pickup_en_route",
  "pickup_verified",
  "station_en_route",
  "station_verified",
  "refill_started",
  "refill_in_progress",
  "refill_confirmed",
  "refill_completed",
  "station_settled",
  "return_en_route",
  "returning",
  "delivery_verification_pending",
]);

// Delivery confirmation is deliberately narrow. A customer must never be offered
// the final hand-over action merely because the driver has started the return trip.
const DELIVERY_CONFIRMATION_STATES = new Set([
  "delivery_verification_pending",
  "delivery_arrived",
  "customer_confirmation_pending",
]);

const FINAL_ORDER_STATES = new Set(["delivered", "completed"]);

export function CustomerOrdersScreen() {
  const { palette } = useAppTheme();
  const orders = domainQueries.orders();

  return (
    <Screen
      eyebrow="Refills"
      title="My orders"
      subtitle="Track every refill from payment and pickup through station processing and return delivery."
      action={<AppButton label="New refill" size="sm" onPress={() => router.push("/(customer)/orders/new")} />}
      refreshControl={
        <RefreshControl
          refreshing={orders.isRefetching}
          onRefresh={() => void orders.refetch()}
          tintColor={palette.brand}
        />
      }
    >
      {orders.isPending ? (
        <View style={styles.loading}>
          <ActivityIndicator color={palette.brand} />
          <Text style={[styles.loadingText, { color: palette.muted }]}>Loading your refill history…</Text>
        </View>
      ) : orders.error ? (
        <EmptyState
          title="We couldn't load your orders"
          description="Check your connection and try again."
          action={<AppButton label="Try again" variant="secondary" onPress={() => void orders.refetch()} />}
        />
      ) : (orders.data ?? []).length === 0 ? (
        <EmptyState
          icon={<PackageCheck color={palette.brand} size={27} />}
          title="Ready for your first refill"
          description="Choose a registered cylinder and pickup location. SKIMA shows the full price before you confirm."
          action={<AppButton label="Request a refill" onPress={() => router.push("/(customer)/orders/new")} />}
        />
      ) : (
        <View style={styles.orderList}>
          {(orders.data ?? []).map((order, index) => {
            const id = recordId(order);
            const cylinder = nestedRecord(order, "cylinder");
            const station = nestedRecord(order, "station") ?? nestedRecord(order, "stationBranch");
            const status = displayStatus(order) ?? "created";
            const currency = firstString(order, ["currency_code", "currencyCode"]) ?? "NGN";
            const total = firstNumber(order, ["total_amount", "totalAmount", "quoted_total", "quotedTotal"]);
            const stationText = station
              ? (firstString(station, ["displayName", "display_name", "formattedAddress", "formatted_address"]) ?? "Assigned station")
              : "Finding the best station";

            return (
              <Pressable
                key={id ?? String(index)}
                accessibilityRole="button"
                disabled={!id}
                onPress={() => router.push(`/(customer)/orders/${id}` as never)}
                style={({ pressed }) => [
                  styles.order,
                  shadows.soft,
                  { backgroundColor: palette.surface, borderColor: palette.border, opacity: pressed ? 0.76 : 1 },
                ]}
              >
                <View style={styles.orderHead}>
                  <View style={[styles.orderIcon, { backgroundColor: palette.brandSoft }]}>
                    <ClipboardList color={palette.brand} size={21} />
                  </View>
                  <View style={styles.orderHeadCopy}>
                    <Text numberOfLines={1} style={[styles.orderRef, { color: palette.ink }]}>{displayReference(order) ?? "Refill order"}</Text>
                    <Text style={[styles.date, { color: palette.muted }]}>{formatDate(firstString(order, ["created_at", "createdAt"]))}</Text>
                  </View>
                  <StatusPill label={friendlyOrderStatus(status)} tone={orderStatusTone(status)} />
                </View>

                <View style={[styles.divider, { backgroundColor: palette.border }]} />

                <View style={styles.summaryRow}>
                  <View style={styles.summaryCopy}>
                    <Text style={[styles.label, { color: palette.muted }]}>CYLINDER</Text>
                    <Text style={[styles.value, { color: palette.ink }]}>{cylinderSummary(cylinder)}</Text>
                  </View>
                  <View style={styles.amountCopy}>
                    <Text style={[styles.label, { color: palette.muted }]}>TOTAL</Text>
                    <Text style={[styles.amount, { color: palette.ink }]}>
                      {total === null ? "Pending" : money(total, currency)}
                    </Text>
                  </View>
                </View>

                <View style={[styles.station, { backgroundColor: palette.surfaceSubtle }]}>
                  <MapPin color={palette.mutedStrong} size={16} />
                  <Text numberOfLines={1} style={[styles.stationText, { color: palette.mutedStrong }]}>{stationText}</Text>
                  <ChevronRight color={palette.muted} size={17} />
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

export function CustomerOrderDetailScreen() {
  const { palette } = useAppTheme();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const detail = useJobDetails(id ?? null);
  const root = detail.data;
  const order = nestedRecord(root, "order") ?? root;
  const cylinder = nestedRecord(root, "cylinder") ?? nestedRecord(order, "cylinder");
  const station = nestedRecord(root, "station") ?? nestedRecord(order, "station") ?? nestedRecord(order, "stationBranch");
  const pickup = nestedRecord(root, "pickupLocation") ?? nestedRecord(order, "pickupLocation") ?? nestedRecord(order, "pickup_location");
  const delivery = nestedRecord(root, "deliveryLocation") ?? nestedRecord(order, "deliveryLocation") ?? nestedRecord(order, "delivery_location");
  const status = order ? (displayStatus(order) ?? "created") : "";
  const normalized = normalizeStatus(status);
  const currency = firstString(order, ["currency_code", "currencyCode"]) ?? "NGN";
  const paymentStatus = firstString(order, ["payment_status", "paymentStatus"]) ?? "pending";
  const total = firstNumber(order, ["total_amount", "totalAmount", "quoted_total", "quotedTotal"]);
  const requestedKg = firstNumber(order, ["requestedKg", "requested_kg"]);
  const actualKg = firstNumber(order, ["actualKg", "actual_kg"]);
  const trackable = TRACKABLE_ORDER_STATES.has(normalized);
  const canVerifyDelivery = DELIVERY_CONFIRMATION_STATES.has(normalized);
  const isFinal = FINAL_ORDER_STATES.has(normalized);
  const canShowReceipt = isFinal || ["paid", "settled"].includes(normalizeStatus(paymentStatus));

  return (
    <Screen
      eyebrow="Order details"
      title={order ? (displayReference(order) ?? "Refill order") : "Refill order"}
      subtitle="One trusted view of your cylinder, station, payment and current delivery stage."
      action={<AppButton label="Back" variant="ghost" size="sm" onPress={() => router.back()} />}
      refreshControl={
        <RefreshControl
          refreshing={detail.isRefetching}
          onRefresh={() => void detail.refetch()}
          tintColor={palette.brand}
        />
      }
    >
      {detail.isPending ? (
        <View style={styles.loading}>
          <ActivityIndicator color={palette.brand} />
          <Text style={[styles.loadingText, { color: palette.muted }]}>Loading order details…</Text>
        </View>
      ) : detail.error ? (
        <EmptyState
          title="Couldn't load this order"
          description="We couldn't refresh the latest order state. Check your connection and try again."
          action={<AppButton label="Try again" variant="secondary" onPress={() => void detail.refetch()} />}
        />
      ) : !order ? (
        <EmptyState
          title="This order is unavailable"
          description="The order may no longer be accessible from this account."
          action={<AppButton label="Back to orders" variant="secondary" onPress={() => router.back()} />}
        />
      ) : (
        <>
          <View style={[styles.detailHero, shadows.raised, { backgroundColor: palette.brand }]}>
            <View style={styles.heroIcon}>
              <Truck color="#FFFFFF" size={25} />
            </View>
            <View style={styles.heroCopy}>
              <Text style={styles.heroLabel}>CURRENT REFILL STAGE</Text>
              <Text style={styles.heroStatus}>{friendlyOrderStatus(status)}</Text>
              <Text style={styles.heroBody}>Updated {formatDate(firstString(order, ["updated_at", "updatedAt", "created_at"]))}</Text>
            </View>
          </View>

          <Card padding="lg">
            <View style={styles.detailStatusRow}>
              <Text style={[styles.detailSectionTitle, { color: palette.ink }]}>Order summary</Text>
              <StatusPill label={friendlyOrderStatus(status)} tone={orderStatusTone(status)} />
            </View>
            <InfoField label="Cylinder" value={cylinderSummary(cylinder)} />
            <InfoField label="Station" value={station ? (firstString(station, ["displayName", "display_name", "formattedAddress", "formatted_address"]) ?? "Assigned station") : "Finding the best station"} />
            <InfoField label="Pickup address" value={pickup ? (firstString(pickup, ["formattedAddress", "formatted_address", "label"]) ?? "Saved location") : "Saved order location"} />
            <InfoField label="Delivery address" value={delivery ? (firstString(delivery, ["formattedAddress", "formatted_address", "label"]) ?? "Saved location") : "Saved order location"} />
          </Card>

          <Card padding="lg">
            <Text style={[styles.detailSectionTitle, { color: palette.ink }]}>Refill & payment</Text>
            <View style={styles.metricsRow}>
              <Metric label="Requested" value={requestedKg === null ? "Not recorded" : `${requestedKg} kg`} />
              {actualKg !== null ? <Metric label="Actual" value={`${actualKg} kg`} /> : null}
              <Metric label="Total" value={total === null ? "Pending" : money(total, currency)} />
            </View>
            <View style={[styles.paymentRow, { backgroundColor: palette.surfaceSubtle }]}>
              <View style={[styles.paymentIcon, { backgroundColor: palette.brandSoft }]}>
                <ShieldCheck color={palette.brand} size={18} />
              </View>
              <View style={styles.paymentCopy}>
                <Text style={[styles.label, { color: palette.muted }]}>PAYMENT</Text>
                <Text style={[styles.value, { color: palette.ink }]}>{friendlyPaymentStatus(paymentStatus)}</Text>
              </View>
              <StatusPill label={friendlyPaymentStatus(paymentStatus)} tone={paymentStatusTone(paymentStatus)} />
            </View>
          </Card>

          <View style={styles.actions}>
            {trackable && id ? <AppButton label="Open live tracking" fullWidth onPress={() => router.push(`/(customer)/orders/${id}/tracking` as never)} /> : null}
            {id && canVerifyDelivery ? <AppButton label="Confirm delivery" variant="secondary" fullWidth onPress={() => router.push(`/(customer)/orders/${id}/verify` as never)} /> : null}
            {id && canShowReceipt ? <AppButton label="View or share receipt" variant="ghost" fullWidth onPress={() => router.push(`/(customer)/orders/${id}/receipt` as never)} /> : null}
          </View>

          {id && isFinal ? (
            <Card padding="lg">
              <Text style={[styles.detailSectionTitle, { color: palette.ink }]}>How did this refill go?</Text>
              <Text style={[styles.feedbackIntro, { color: palette.muted }]}>Rate the service relationships separately. Serious safety, quantity, custody, fraud or payment issues should be reported for investigation rather than left only as a star rating.</Text>
              <View style={styles.actions}>
                <AppButton label="Rate your driver" fullWidth onPress={() => router.push(`/(customer)/orders/${id}/rate-driver` as never)} />
                <AppButton label="Rate the station" variant="secondary" fullWidth onPress={() => router.push(`/(customer)/orders/${id}/rate-station` as never)} />
                <AppButton label="Report a serious issue" variant="ghost" fullWidth onPress={() => router.push(`/(customer)/orders/${id}/report` as never)} />
              </View>
            </Card>
          ) : null}

          <View style={[styles.safetyBox, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
            <ShieldCheck color={palette.brand} size={17} />
            <Text style={[styles.safety, { color: palette.mutedStrong }]}>Operational actions are only shown for the current backend-confirmed order state. Final delivery confirmation is not enabled while the cylinder is merely in transit.</Text>
          </View>
        </>
      )}
    </Screen>
  );
}

function cylinderSummary(cylinder: PlatformRecord | null) {
  if (!cylinder) return "Cylinder details unavailable";
  const size = firstNumber(cylinder, ["sizeKg", "size_kg"]);
  const reference = displayReference(cylinder);
  if (size !== null && reference) return `${size} kg · ${reference}`;
  if (size !== null) return `${size} kg`;
  if (reference) return reference;
  return "Cylinder details unavailable";
}

function InfoField({ label, value }: { label: string; value: string }) {
  const { palette } = useAppTheme();
  return (
    <View style={styles.infoField}>
      <Text style={[styles.label, { color: palette.muted }]}>{label.toUpperCase()}</Text>
      <Text style={[styles.fieldValue, { color: palette.ink }]}>{value}</Text>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  const { palette } = useAppTheme();
  return (
    <View style={[styles.metric, { backgroundColor: palette.surfaceSubtle }]}>
      <Text style={[styles.label, { color: palette.muted }]}>{label.toUpperCase()}</Text>
      <Text adjustsFontSizeToFit numberOfLines={1} style={[styles.metricValue, { color: palette.ink }]}>{value}</Text>
    </View>
  );
}

function money(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function formatDate(value: string | null) {
  if (!value) return "Time unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function normalizeStatus(value: string) {
  return value.toLowerCase().replace(/[-\s]+/g, "_");
}

function friendlyOrderStatus(value: string) {
  const normalized = normalizeStatus(value);
  const labels: Record<string, string> = {
    created: "Order started",
    awaiting_payment: "Waiting for payment",
    payment_reserved: "Payment confirmed",
    matching_station: "Finding a refill station",
    matching_driver: "Finding your driver",
    driver_offered: "Driver notified",
    driver_accepted: "Driver assigned",
    assigned: "Driver assigned",
    pickup_en_route: "Driver heading to pickup",
    pickup_verified: "Cylinder collected",
    station_en_route: "Heading to the station",
    station_verified: "Cylinder received at station",
    refill_started: "Refill started",
    refill_in_progress: "Refill in progress",
    refill_confirmed: "Refill complete",
    refill_completed: "Refill complete",
    station_settled: "Ready to return",
    return_en_route: "On the way back to you",
    returning: "On the way back to you",
    delivery_arrived: "Driver has arrived",
    delivery_verification_pending: "Ready for hand-over",
    customer_confirmation_pending: "Waiting for your confirmation",
    delivered: "Delivered",
    completed: "Completed",
    cancelled: "Cancelled",
    pending: "Waiting for confirmation",
  };
  return labels[normalized] ?? normalized.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

function orderStatusTone(value: string): "neutral" | "brand" | "success" | "warning" | "danger" {
  const normalized = normalizeStatus(value);
  if (["delivered", "completed", "refill_confirmed", "refill_completed"].includes(normalized)) return "success";
  if (["cancelled", "failed", "rejected"].includes(normalized)) return "danger";
  if (["created", "awaiting_payment", "pending", "matching_station", "matching_driver", "driver_offered", "delivery_verification_pending", "customer_confirmation_pending"].includes(normalized)) return "warning";
  if (["payment_reserved", "driver_accepted", "assigned", "pickup_en_route", "pickup_verified", "station_en_route", "station_verified", "refill_started", "refill_in_progress", "station_settled", "return_en_route", "returning", "delivery_arrived"].includes(normalized)) return "brand";
  return "neutral";
}

function friendlyPaymentStatus(value: string) {
  const normalized = normalizeStatus(value);
  const labels: Record<string, string> = {
    pending: "Waiting for confirmation",
    awaiting_payment: "Payment needed",
    reserved: "Payment confirmed",
    payment_reserved: "Payment confirmed",
    paid: "Paid",
    settled: "Settled",
    failed: "Payment failed",
    refunded: "Refunded",
  };
  return labels[normalized] ?? "Payment update available";
}

function paymentStatusTone(value: string): "neutral" | "brand" | "success" | "warning" | "danger" {
  const normalized = normalizeStatus(value);
  if (["paid", "settled", "reserved", "payment_reserved"].includes(normalized)) return "success";
  if (["failed", "rejected"].includes(normalized)) return "danger";
  if (["pending", "awaiting_payment"].includes(normalized)) return "warning";
  if (normalized === "refunded") return "brand";
  return "neutral";
}

const styles = StyleSheet.create({
  loading: { minHeight: 180, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  loadingText: { ...typography.caption },
  orderList: { gap: spacing.md },
  order: { gap: spacing.md, padding: spacing.lg, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl },
  orderHead: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  orderIcon: { width: 46, height: 46, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  orderHeadCopy: { flex: 1, minWidth: 0 },
  orderRef: { ...typography.subheading, fontSize: 16 },
  date: { ...typography.caption, fontSize: 11, marginTop: 3 },
  divider: { height: StyleSheet.hairlineWidth },
  summaryRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.md },
  summaryCopy: { flex: 1, minWidth: 0 },
  amountCopy: { alignItems: "flex-end", maxWidth: "44%" },
  label: { ...typography.eyebrow, fontSize: 8 },
  value: { ...typography.bodyStrong, fontSize: 13, marginTop: 3 },
  amount: { fontSize: 18, lineHeight: 23, fontWeight: "900", letterSpacing: -0.3, marginTop: 3 },
  station: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.sm + 2, borderRadius: radii.md },
  stationText: { flex: 1, ...typography.caption, fontSize: 12 },
  detailHero: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderRadius: radii.xl },
  heroIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: "rgba(255,255,255,.14)", alignItems: "center", justifyContent: "center" },
  heroCopy: { flex: 1, minWidth: 0 },
  heroLabel: { color: "rgba(255,255,255,.74)", ...typography.eyebrow, fontSize: 8 },
  heroStatus: { color: "#FFFFFF", fontSize: 22, lineHeight: 28, fontWeight: "900", letterSpacing: -0.4, marginTop: 4 },
  heroBody: { color: "rgba(255,255,255,.82)", ...typography.caption, fontSize: 11, marginTop: 3 },
  detailStatusRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md, marginBottom: spacing.xs },
  detailSectionTitle: { ...typography.subheading, fontSize: 16 },
  infoField: { gap: 3, paddingVertical: spacing.xs },
  fieldValue: { ...typography.bodyStrong, fontSize: 14, lineHeight: 20 },
  metricsRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  metric: { flexGrow: 1, minWidth: 100, padding: spacing.md, borderRadius: radii.md },
  metricValue: { fontSize: 16, lineHeight: 22, fontWeight: "900", marginTop: 4 },
  paymentRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radii.md },
  paymentIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  paymentCopy: { flex: 1, minWidth: 0 },
  actions: { gap: spacing.sm },
  feedbackIntro: { ...typography.caption, lineHeight: 18, marginVertical: spacing.sm },
  safetyBox: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, padding: spacing.md, borderRadius: radii.md, borderWidth: StyleSheet.hairlineWidth },
  safety: { flex: 1, ...typography.caption, lineHeight: 18 },
});