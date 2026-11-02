import { router, useLocalSearchParams } from "expo-router";
import { ChevronRight, ClipboardList, Fuel, MapPin, PackageCheck, QrCode, ReceiptText, ShieldCheck, ShoppingBag, Truck } from "lucide-react-native";
import QRCode from "react-native-qrcode-svg";
import { useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { domainQueries, useJobDetails } from "../api/domains";
import { isSkimaInternalFulfillmentChannel } from "../api/lpgFulfillment";
import { useResolvedLocationLabel } from "../domains/maps/readableLocation";
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
import { AiContextAction } from "./AiContextAction";
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

// The customer can request the final OTP once the order has entered its return
// leg. The customer must only reveal and confirm the code after the cylinder is
// physically with them; no second driver scan is required.
const DELIVERY_CONFIRMATION_STATES = new Set([
  "return_en_route",
  "returning",
  "delivery_verification_pending",
]);

const FINAL_ORDER_STATES = new Set(["delivered", "completed"]);

const ORDER_PAGE_SIZE = 8;
type OrderFilter = "all" | "refills" | "fuel" | "bills" | "marketplace";
type UnifiedOrderKind = Exclude<OrderFilter, "all">;
type UnifiedOrderItem = {
  id: string;
  kind: UnifiedOrderKind;
  title: string;
  subtitle: string;
  status: string;
  statusTone: "neutral" | "brand" | "success" | "warning" | "danger";
  reference: string;
  createdAt: string | null;
  amount: number | null;
  currency: string;
  route: string;
};

export function CustomerOrdersScreen() {
  const { palette } = useAppTheme();
  const refills = domainQueries.orders();
  const fuelOrders = domainQueries.fuelOrders();
  const fuelProducts = domainQueries.fuelProducts();
  const billPayments = domainQueries.utilityPayments();
  const storeOrders = domainQueries.storeOrders();
  const [filter, setFilter] = useState<OrderFilter>("all");
  const [visibleCount, setVisibleCount] = useState(12);

  const allItems: UnifiedOrderItem[] = [
    ...(refills.data ?? []).map((order, index): UnifiedOrderItem => {
      const id = recordId(order) ?? firstString(order, ["service_request_id"]) ?? `refill-${index}`;
      const cylinder = nestedRecord(order, "cylinder");
      const station = nestedRecord(order, "station") ?? nestedRecord(order, "stationBranch");
      const status = displayStatus(order) ?? "created";
      const fulfillmentChannel = firstString(order, ["fulfillment_channel", "fulfillmentChannel"]);
      const internalFulfillment = isSkimaInternalFulfillmentChannel(fulfillmentChannel);
      const paymentStatus = firstString(order, ["payment_status", "paymentStatus"]) ?? status;
      const paymentNeeded = isPaymentActionRequired(status, paymentStatus);
      const stationLabel = internalFulfillment
        ? "SKIMA-managed delivery"
        : station
          ? firstString(station, ["displayName", "display_name", "name"]) ?? "Partner station"
          : "Finding a refill station";
      return {
        id,
        kind: "refills",
        title: "LPG refill",
        subtitle: `${cylinderSummary(cylinder)} · ${stationLabel}`,
        status: paymentNeeded ? "Payment needed" : friendlyOrderStatus(status, fulfillmentChannel),
        statusTone: paymentNeeded ? "warning" : orderStatusTone(status),
        reference: displayReference(order) ?? id.slice(0, 8).toUpperCase(),
        createdAt: firstString(order, ["created_at", "createdAt"]),
        amount: firstNumber(order, ["total_amount", "totalAmount", "quoted_total", "quotedTotal"]),
        currency: firstString(order, ["currency_code", "currencyCode"]) ?? "NGN",
        route: paymentNeeded ? `/(customer)/orders/${id}/payment` : `/(customer)/orders/${id}`,
      };
    }),
    ...(fuelOrders.data ?? []).map((order, index): UnifiedOrderItem => {
      const id = firstString(order, ["order_id"]) ?? `fuel-${index}`;
      const productKey = firstString(order, ["product_key"]) ?? "fuel";
      const product = (fuelProducts.data ?? []).find((item) => firstString(item, ["key"]) === productKey);
      const productName = firstString(product, ["display_name"]) ?? humanizeStatus(productKey);
      const litres = firstNumber(order, ["requested_litres"]) ?? 0;
      const stage = firstString(order, ["stage_key"]) ?? "awaiting_station_acceptance";
      const currency = firstString(nestedRecord(order, "order"), ["currency_code", "currencyCode"]) ?? "NGN";
      return {
        id,
        kind: "fuel",
        title: `${productName} · ${litres.toLocaleString()} L`,
        subtitle: `${firstString(order, ["fulfillment_mode"]) ? humanizeStatus(firstString(order, ["fulfillment_mode"])!) : "Fuel delivery"} · ${firstNumber(order, ["container_count"]) ?? 1} container(s)`,
        status: humanizeStatus(stage),
        statusTone: unifiedStatusTone(stage),
        reference: id.slice(0, 8).toUpperCase(),
        createdAt: firstString(order, ["created_at", "createdAt"]),
        amount: firstNumber(order, ["total_amount", "totalAmount", "amount"]),
        currency,
        route: `/(customer)/fuel-order/${id}`,
      };
    }),
    ...(billPayments.data ?? []).map((payment, index): UnifiedOrderItem => {
      const id = firstString(payment, ["id", "request_id"]) ?? `bill-${index}`;
      const status = firstString(payment, ["status", "payment_status"]) ?? "pending";
      return {
        id,
        kind: "bills",
        title: firstString(payment, ["product_name", "display_name", "service_name", "provider_name"]) ?? "Bill payment",
        subtitle: firstString(payment, ["customer_identifier", "customer_name", "recipient_phone"]) ?? "Utility payment",
        status: humanizeStatus(status),
        statusTone: unifiedStatusTone(status),
        reference: firstString(payment, ["public_reference", "reference"]) ?? id.slice(0, 8).toUpperCase(),
        createdAt: firstString(payment, ["created_at", "createdAt", "requested_at"]),
        amount: firstNumber(payment, ["amount", "requested_amount", "total_amount", "amount_major"]),
        currency: firstString(payment, ["currency_code", "currencyCode"]) ?? "NGN",
        route: "/(customer)/bills",
      };
    }),
    ...(storeOrders.data ?? []).filter(isStoreOrder).map((order, index): UnifiedOrderItem => {
      const id = recordId(order) ?? `store-${index}`;
      const payload = nestedRecord(order, "order_payload");
      const status = displayStatus(order) ?? "received";
      return {
        id,
        kind: "marketplace",
        title: "Marketplace order",
        subtitle: firstString(payload, ["fulfillment_method"]) ? `Store · ${humanizeStatus(firstString(payload, ["fulfillment_method"])!)}` : "SKIMA Store purchase",
        status: humanizeStatus(status),
        statusTone: unifiedStatusTone(status),
        reference: firstString(payload, ["customerReference", "customer_reference", "public_reference"]) ?? id.slice(0, 8).toUpperCase(),
        createdAt: firstString(order, ["created_at", "createdAt"]),
        amount: firstNumber(order, ["total_amount", "totalAmount"]),
        currency: firstString(order, ["currency_code", "currencyCode"]) ?? "NGN",
        route: "/(customer)/store",
      };
    }),
  ].sort((left, right) => timestamp(right.createdAt) - timestamp(left.createdAt));

  const filteredItems = filter === "all" ? allItems : allItems.filter((item) => item.kind === filter);
  const visibleItems = filteredItems.slice(0, visibleCount);
  const isPending = refills.isPending || fuelOrders.isPending || billPayments.isPending || storeOrders.isPending;
  const sourceErrors = [refills.error, fuelOrders.error, billPayments.error, storeOrders.error].filter(Boolean);
  const refresh = () => void Promise.all([
    refills.refetch(),
    fuelOrders.refetch(),
    fuelProducts.refetch(),
    billPayments.refetch(),
    storeOrders.refetch(),
  ]);
  const selectFilter = (next: OrderFilter) => {
    setFilter(next);
    setVisibleCount(12);
  };

  return (
    <Screen
      eyebrow="Your activity"
      title="Orders"
      subtitle="Refills, fuel deliveries, bill payments and marketplace purchases together in one place."
      action={<AppButton label="New refill" size="sm" onPress={() => router.push("/(customer)/orders/new")} />}
      refreshControl={
        <RefreshControl
          refreshing={[refills, fuelOrders, billPayments, storeOrders].some((query) => query.isRefetching)}
          onRefresh={refresh}
          tintColor={palette.brand}
        />
      }
    >
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
        <OrderFilterChip label={`All · ${allItems.length}`} active={filter === "all"} onPress={() => selectFilter("all")} />
        <OrderFilterChip label={`Refills · ${allItems.filter((item) => item.kind === "refills").length}`} active={filter === "refills"} onPress={() => selectFilter("refills")} />
        <OrderFilterChip label={`Fuel · ${allItems.filter((item) => item.kind === "fuel").length}`} active={filter === "fuel"} onPress={() => selectFilter("fuel")} />
        <OrderFilterChip label={`Bills · ${allItems.filter((item) => item.kind === "bills").length}`} active={filter === "bills"} onPress={() => selectFilter("bills")} />
        <OrderFilterChip label={`Marketplace · ${allItems.filter((item) => item.kind === "marketplace").length}`} active={filter === "marketplace"} onPress={() => selectFilter("marketplace")} />
      </ScrollView>

      {isPending && allItems.length === 0 ? (
        <View style={styles.loading}>
          <ActivityIndicator color={palette.brand} />
          <Text style={[styles.loadingText, { color: palette.muted }]}>Gathering your SKIMA activity…</Text>
        </View>
      ) : sourceErrors.length > 0 ? (
        <Text style={[styles.sourceNotice, { color: palette.muted }]}>
          Some activity sources could not refresh. The records below are from the sources currently available.
        </Text>
      ) : null}

      {!(isPending && allItems.length === 0) && filteredItems.length === 0 ? (
        <EmptyState
          icon={<PackageCheck color={palette.brand} size={27} />}
          title={filter === "all" ? "Your SKIMA activity will appear here" : `No ${filter === "refills" ? "refill" : filter === "marketplace" ? "marketplace" : filter} activity yet`}
          description={filter === "all"
            ? "Your refills, fuel deliveries, bill payments and Store purchases will be collected in this list."
            : "Choose All to see activity from every SKIMA service."}
          action={filter === "all"
            ? <AppButton label="Start a refill" onPress={() => router.push("/(customer)/orders/new")} />
            : <AppButton label="Show all activity" variant="secondary" onPress={() => selectFilter("all")} />}
        />
      ) : (
        <View style={styles.unifiedList}>
          {visibleItems.map((item) => {
            const Icon = item.kind === "refills"
              ? PackageCheck
              : item.kind === "fuel"
                ? Fuel
                : item.kind === "bills"
                  ? ReceiptText
                  : ShoppingBag;
            const kindLabel = item.kind === "refills" ? "LPG REFILL" : item.kind === "fuel" ? "FUEL DELIVERY" : item.kind === "bills" ? "BILL PAYMENT" : "MARKETPLACE";
            return (
              <Pressable
                key={`${item.kind}:${item.id}`}
                accessibilityRole="button"
                onPress={() => router.push(item.route as never)}
                style={({ pressed }) => [
                  styles.unifiedOrder,
                  { backgroundColor: palette.surface, borderColor: palette.border, opacity: pressed ? 0.78 : 1 },
                ]}
              >
                <View style={[styles.unifiedIcon, { backgroundColor: palette.brandSoft }]}>
                  <Icon color={palette.brand} size={20} />
                </View>
                <View style={styles.unifiedCopy}>
                  <Text style={[styles.unifiedKind, { color: palette.brand }]}>{kindLabel}</Text>
                  <Text numberOfLines={1} style={[styles.unifiedTitle, { color: palette.ink }]}>{item.title}</Text>
                  <Text numberOfLines={1} style={[styles.unifiedSubtitle, { color: palette.muted }]}>{item.subtitle}</Text>
                  <Text numberOfLines={1} style={[styles.unifiedMeta, { color: palette.muted }]}>{item.reference} · {formatDate(item.createdAt)}</Text>
                </View>
                <View style={styles.unifiedTrailing}>
                  <Text numberOfLines={1} style={[styles.unifiedAmount, { color: palette.ink }]}>
                    {item.amount === null ? "Pending" : money(item.amount, item.currency)}
                  </Text>
                  <StatusPill label={item.status} tone={item.statusTone} />
                  <ChevronRight color={palette.muted} size={17} />
                </View>
              </Pressable>
            );
          })}
          {visibleCount < filteredItems.length ? (
            <AppButton
              label={`Show ${Math.min(12, filteredItems.length - visibleCount)} older items`}
              variant="secondary"
              onPress={() => setVisibleCount((count) => count + 12)}
            />
          ) : null}
        </View>
      )}
    </Screen>
  );
}

function isStoreOrder(order: PlatformRecord) {
  const payload = nestedRecord(order, "order_payload");
  const metadata = nestedRecord(order, "metadata");
  return firstString(payload, ["channel"]) === "skima_store" ||
    firstString(metadata, ["storefront_module"]) === "store" ||
    firstString(metadata, ["channel"]) === "skima_store";
}

function timestamp(value: string | null) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function humanizeStatus(value: string) {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function unifiedStatusTone(value: string): "neutral" | "brand" | "success" | "warning" | "danger" {
  const normalized = normalizeStatus(value);
  if (["completed", "delivered", "fulfilled", "paid", "settled", "refunded"].includes(normalized)) return "success";
  if (["failed", "rejected", "cancelled", "exception"].includes(normalized)) return "danger";
  if (["pending", "created", "received", "awaiting_payment", "awaiting_station_acceptance"].includes(normalized)) return "warning";
  return "brand";
}

export function CustomerOrderDetailScreen() {
  const { palette } = useAppTheme();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const detail = useJobDetails(id ?? null);
  const orders = domainQueries.orders();
  const cylinders = domainQueries.cylinders();
  const root = detail.data;
  const jobOrder = nestedRecord(root, "order") ?? (root && recordId(root) ? root : null);
  const savedOrder = (orders.data ?? []).find((item) => recordId(item) === id) ?? null;
  const order = jobOrder ?? savedOrder;
  const cylinder = nestedRecord(root, "cylinder") ?? nestedRecord(order, "cylinder");
  const cylinderId = firstString(cylinder, ["id", "cylinderId", "cylinder_id"])
    ?? firstString(order, ["cylinderId", "cylinder_id"]);
  const customerCylinder = (cylinders.data ?? []).find((item) => recordId(item) === cylinderId) ?? null;
  const permanentCylinderId =
    firstString(cylinder, ["cylinderIdentifier", "cylinder_identifier"])
    ?? firstString(customerCylinder, ["cylinder_identifier", "cylinderIdentifier", "public_reference", "publicReference"]);
  const cylinderQrPayload = firstString(customerCylinder, ["qr_payload", "qrPayload"]);
  const station = nestedRecord(root, "station") ?? nestedRecord(order, "station") ?? nestedRecord(order, "stationBranch");
  const pickup = nestedRecord(root, "pickupLocation") ?? nestedRecord(order, "pickupLocation") ?? nestedRecord(order, "pickup_location");
  const delivery = nestedRecord(root, "deliveryLocation") ?? nestedRecord(order, "deliveryLocation") ?? nestedRecord(order, "delivery_location");
  const status = order ? (displayStatus(order) ?? "created") : "";
  const normalized = normalizeStatus(status);
  const currency = firstString(order, ["currency_code", "currencyCode"]) ?? "NGN";
  const paymentStatus = firstString(order, ["payment_status", "paymentStatus"]) ?? "pending";
  const paymentNeeded = order ? isPaymentActionRequired(status, paymentStatus) : false;
  const pickupAddress = useResolvedLocationLabel(
    pickup,
    "Saved order location",
    `order:${id ?? "unknown"}:pickup`,
  );
  const returnAddress = useResolvedLocationLabel(
    delivery,
    "Saved order location",
    `order:${id ?? "unknown"}:return`,
  );
  const total = firstNumber(order, ["total_amount", "totalAmount", "quoted_total", "quotedTotal"]);
  const requestedKg = firstNumber(order, ["requestedKg", "requested_kg"]);
  const actualKg = firstNumber(order, ["actualKg", "actual_kg"]);
  const trackable = TRACKABLE_ORDER_STATES.has(normalized);
  const deliveryConfirmationStage = DELIVERY_CONFIRMATION_STATES.has(normalized);
  const canVerifyDelivery = deliveryConfirmationStage;
  const customerDisplayStatus = ["return_en_route", "returning"].includes(normalized)
    ? "delivery_verification_pending"
    : status;
  const canShowReceipt = FINAL_ORDER_STATES.has(normalized) || ["paid", "settled"].includes(normalizeStatus(paymentStatus));
  const aiOrderReference = order ? (displayReference(order) ?? id ?? "this refill") : "this refill";
  const fulfillmentChannel = firstString(order, ["fulfillment_channel", "fulfillmentChannel"]);
  const internalFulfillment = isSkimaInternalFulfillmentChannel(fulfillmentChannel);
  const fulfillmentLabel = internalFulfillment
    ? "SKIMA-managed fulfillment"
    : station
      ? (firstString(station, ["displayName", "display_name", "formattedAddress", "formatted_address"]) ?? "Assigned partner station")
      : "Finding an available partner station";


  return (
    <Screen
      eyebrow="Order details"
      title={order ? (displayReference(order) ?? "Refill order") : "Refill order"}
      subtitle="One trusted view of your cylinder, fulfillment route, payment and current delivery stage."
      action={<AppButton label="Back" variant="ghost" size="sm" onPress={() => router.back()} />}
      refreshControl={
        <RefreshControl
          refreshing={detail.isRefetching}
          onRefresh={() => void Promise.all([detail.refetch(), orders.refetch(), cylinders.refetch()])}
          tintColor={palette.brand}
        />
      }
    >
      {detail.isPending && orders.isPending ? (
        <View style={styles.loading}>
          <ActivityIndicator color={palette.brand} />
          <Text style={[styles.loadingText, { color: palette.muted }]}>Loading order details…</Text>
        </View>
      ) : detail.error && orders.error ? (
        <EmptyState
          title="Couldn't load this order"
          description="We couldn't refresh the latest order state. Check your connection and try again."
          action={<AppButton label="Try again" variant="secondary" onPress={() => void Promise.all([detail.refetch(), orders.refetch()])} />}
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
              <Text style={styles.heroStatus}>{friendlyOrderStatus(status, fulfillmentChannel)}</Text>
              <Text style={styles.heroBody}>Updated {formatDate(firstString(order, ["updated_at", "updatedAt", "created_at"]))}</Text>
            </View>
          </View>

          <AiContextAction
            workspace="customer"
            label="Explain this refill"
            prompt={`Explain my refill order ${aiOrderReference}. Its current SKIMA stage is ${friendlyOrderStatus(status, fulfillmentChannel)} and payment status is ${friendlyPaymentStatus(paymentStatus)}. Tell me what these mean and what normally happens next. Do not change the order or payment.`}
          />

          <Card padding="lg">
            <View style={styles.detailStatusRow}>
              <Text style={[styles.detailSectionTitle, { color: palette.ink }]}>Order summary</Text>
              <StatusPill label={friendlyOrderStatus(customerDisplayStatus, fulfillmentChannel)} tone={orderStatusTone(customerDisplayStatus)} />
            </View>
            <View style={styles.infoGrid}>
              <InfoField label="Cylinder" value={cylinderSummary(cylinder)} />
              <InfoField label="Fulfillment" value={fulfillmentLabel} />
              <InfoField label="Pickup" value={pickupAddress} />
              <InfoField label="Return" value={returnAddress} />
            </View>
          </Card>

          <Card padding="lg">
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <QrCode color={palette.brand} size={20} />
              <Text style={[styles.detailSectionTitle, { color: palette.ink }]}>Cylinder ID & QR for this order</Text>
            </View>
            <Text style={[styles.label, { color: palette.muted, marginTop: spacing.sm }]}>PERMANENT CYLINDER ID</Text>
            <Text selectable style={{ color: palette.ink, fontSize: 25, fontWeight: "900", letterSpacing: 1.2 }}>
              {permanentCylinderId ?? "ID unavailable"}
            </Text>
            {cylinderQrPayload ? (
              <View style={{ alignItems: "center", gap: spacing.md, marginTop: spacing.md }}>
                <View style={{ backgroundColor: "#FFFFFF", borderRadius: radii.xl, padding: spacing.md }}>
                  <QRCode
                    backgroundColor="#FFFFFF"
                    color="#151A17"
                    quietZone={12}
                    size={210}
                    value={cylinderQrPayload}
                  />
                </View>
                <Text style={[styles.fieldValue, { color: palette.muted, textAlign: "center" }]}>
                  This QR belongs to the cylinder assigned to {aiOrderReference}. Show it to the assigned SKIMA operator during hand-over.
                </Text>
              </View>
            ) : (
              <Text style={[styles.fieldValue, { color: palette.muted, marginTop: spacing.sm }]}>
                The QR is loading or unavailable. The permanent five-character Cylinder ID above remains the manual verification fallback.
              </Text>
            )}
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

            <AiContextAction
              workspace="customer"
              label="Explain this price"
              detail="Ask SKIMA to break down the price saved with this refill. Nothing is sent until you choose Send."
              prompt={`Explain the accepted price for my refill order ${aiOrderReference}. Break down the gas amount, SKIMA charge, delivery fee, tax if any, total, and any posted adjustment using the price saved with this order. If the actual kilograms differ from the quoted kilograms, explain that separately. Do not use admin pricing simulations or change any price, payment, refund, or policy.`}
            />
          </Card>

          <View style={styles.actions}>
            {id && paymentNeeded ? (
              <AppButton
                label="Continue payment"
                fullWidth
                onPress={() => router.push(`/(customer)/orders/${id}/payment` as never)}
              />
            ) : null}
            {trackable && id ? <AppButton label="Open live tracking" fullWidth onPress={() => router.push(`/(customer)/orders/${id}/tracking` as never)} /> : null}
            {id && canVerifyDelivery ? <AppButton label="Confirm delivery with OTP" variant="secondary" fullWidth onPress={() => router.push(`/(customer)/orders/${id}/verify` as never)} /> : null}
            {id && canShowReceipt ? <AppButton label="View or share receipt" variant="ghost" fullWidth onPress={() => router.push(`/(customer)/orders/${id}/receipt` as never)} /> : null}
          </View>

          <View style={[styles.safetyBox, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
            <ShieldCheck color={palette.brand} size={17} />
            <Text style={[styles.safety, { color: palette.mutedStrong }]}>Available actions change as your order progresses. You can confirm delivery only after the cylinder arrives.</Text>
          </View>
        </>
      )}
    </Screen>
  );
}

function OrderFilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress(): void;
}) {
  const { palette } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.filterChip,
        {
          backgroundColor: active ? palette.brandSoft : palette.surface,
          borderColor: active ? palette.brand : palette.border,
          opacity: pressed ? 0.78 : 1,
        },
      ]}
    >
      <Text style={[styles.filterChipText, { color: active ? palette.brand : palette.mutedStrong }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function orderMatchesFilter(order: PlatformRecord, filter: OrderFilter) {
  if (filter === "all") return true;
  const status = displayStatus(order) ?? "created";
  const paymentStatus = firstString(order, ["payment_status", "paymentStatus"]) ?? status;
  const normalized = normalizeStatus(status);
  if (filter === "payment") return isPaymentActionRequired(status, paymentStatus);
  if (filter === "completed") return FINAL_ORDER_STATES.has(normalized);
  return !FINAL_ORDER_STATES.has(normalized) && !isPaymentActionRequired(status, paymentStatus);
}

function isPaymentActionRequired(orderStatus: string, paymentStatus: string) {
  const orderState = normalizeStatus(orderStatus);
  const paymentState = normalizeStatus(paymentStatus);
  if (["reserved", "payment_reserved", "paid", "settled", "refunded"].includes(paymentState)) return false;
  return ["created", "awaiting_payment", "pending"].includes(orderState) ||
    ["pending", "awaiting_payment", "failed", "rejected"].includes(paymentState);
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
    <View style={[styles.infoField, { backgroundColor: palette.surfaceSubtle }]}>
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

function friendlyOrderStatus(value: string, fulfillmentChannel?: string | null) {
  const normalized = normalizeStatus(value);
  if (isSkimaInternalFulfillmentChannel(fulfillmentChannel)) {
    const internalLabels: Record<string, string> = {
      matching_station: "Preparing SKIMA fulfillment",
      station_en_route: "Heading to refill supplier",
      station_verified: "Cylinder received for refill",
      station_settled: "Refill complete · preparing return",
    };
    if (internalLabels[normalized]) return internalLabels[normalized];
  }
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
  filters: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingRight: spacing.md },
  sourceNotice: { ...typography.caption, lineHeight: 16 },
  unifiedList: { gap: spacing.sm + 2 },
  unifiedOrder: { minHeight: 94, flexDirection: "row", alignItems: "center", gap: spacing.sm + 2, padding: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl },
  unifiedIcon: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 14 },
  unifiedCopy: { flex: 1, minWidth: 0, gap: 2 },
  unifiedKind: { ...typography.eyebrow, fontSize: 7.5 },
  unifiedTitle: { ...typography.bodyStrong, fontSize: 13 },
  unifiedSubtitle: { ...typography.caption, fontSize: 10 },
  unifiedMeta: { ...typography.caption, fontSize: 9 },
  unifiedTrailing: { maxWidth: "38%", alignItems: "flex-end", gap: 5 },
  unifiedAmount: { fontSize: 12, fontWeight: "900" },
  filterChip: { minHeight: 38, justifyContent: "center", borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: 13 },
  filterChipText: { ...typography.caption, fontSize: 10, fontWeight: "900" },
  orderList: { gap: spacing.sm + 2 },
  order: { gap: 12, padding: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl },
  orderHead: { flexDirection: "row", alignItems: "center", gap: 11 },
  orderIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  orderHeadCopy: { flex: 1, minWidth: 0 },
  orderRef: { ...typography.subheading, fontSize: 15 },
  date: { ...typography.caption, fontSize: 10, marginTop: 2 },
  divider: { height: StyleSheet.hairlineWidth },
  summaryRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.md },
  summaryCopy: { flex: 1, minWidth: 0 },
  amountCopy: { alignItems: "flex-end", maxWidth: "44%" },
  label: { ...typography.eyebrow, fontSize: 8 },
  value: { ...typography.bodyStrong, fontSize: 13, marginTop: 3 },
  amount: { fontSize: 18, lineHeight: 23, fontWeight: "900", letterSpacing: -0.3, marginTop: 3 },
  station: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: 10, borderRadius: radii.lg },
  stationText: { flex: 1, ...typography.caption, fontSize: 12 },
  detailHero: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderRadius: radii.xl },
  heroIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: "rgba(255,255,255,.14)", alignItems: "center", justifyContent: "center" },
  heroCopy: { flex: 1, minWidth: 0 },
  heroLabel: { color: "rgba(255,255,255,.74)", ...typography.eyebrow, fontSize: 8 },
  heroStatus: { color: "#FFFFFF", fontSize: 22, lineHeight: 28, fontWeight: "900", letterSpacing: -0.4, marginTop: 4 },
  heroBody: { color: "rgba(255,255,255,.82)", ...typography.caption, fontSize: 11, marginTop: 3 },
  detailStatusRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md, marginBottom: spacing.xs },
  detailSectionTitle: { ...typography.subheading, fontSize: 16 },
  infoGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  infoField: { flexGrow: 1, flexBasis: "47%", minWidth: 135, gap: 3, padding: 11, borderRadius: radii.lg },
  fieldValue: { ...typography.bodyStrong, fontSize: 12, lineHeight: 17 },
  metricsRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  metric: { flexGrow: 1, minWidth: 100, padding: spacing.md, borderRadius: radii.md },
  metricValue: { fontSize: 16, lineHeight: 22, fontWeight: "900", marginTop: 4 },
  paymentRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radii.md },
  paymentIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  paymentCopy: { flex: 1, minWidth: 0 },
  actions: { gap: spacing.sm },
  safetyBox: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, padding: spacing.md, borderRadius: radii.md, borderWidth: StyleSheet.hairlineWidth },
  safety: { flex: 1, ...typography.caption, lineHeight: 18 },
});