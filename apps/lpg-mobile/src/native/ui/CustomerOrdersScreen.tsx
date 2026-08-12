import { router, useLocalSearchParams } from "expo-router";
import {
  ChevronRight,
  ClipboardList,
  MapPin,
  PackageCheck,
  Truck,
} from "lucide-react-native";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { domainQueries, useJobDetails } from "../api/domains";
import {
  displayReference,
  displayStatus,
  firstNumber,
  firstString,
  nestedRecord,
  recordId,
} from "../api/records";
import { colors, radii, spacing } from "../theme/tokens";
import { Card } from "./Card";
import { Screen } from "./Screen";

export function CustomerOrdersScreen() {
  const orders = domainQueries.orders();
  return (
    <Screen
      eyebrow="Refills"
      title="My orders"
      action={
        <Pressable
          onPress={() => router.push("/(customer)/orders/new")}
          style={styles.primarySmall}
        >
          <Text style={styles.primaryText}>New refill</Text>
        </Pressable>
      }
    >
      {orders.isPending ? (
        <ActivityIndicator color={colors.brand} />
      ) : orders.error ? (
        <ErrorState
          message="Check your connection and try again."
          retry={() => void orders.refetch()}
        />
      ) : (
        <>
          {(orders.data ?? []).map((order, index) => {
            const id = recordId(order);
            const cylinder = nestedRecord(order, "cylinder");
            const station =
              nestedRecord(order, "station") ??
              nestedRecord(order, "stationBranch");
            const status = displayStatus(order) ?? "created";
            const currency =
              firstString(order, ["currency_code", "currencyCode"]) ?? "NGN";
            return (
              <Pressable
                key={id ?? String(index)}
                disabled={!id}
                onPress={() => router.push(`/(customer)/orders/${id}` as never)}
                style={styles.order}
              >
                <View style={styles.orderHead}>
                  <View style={styles.orderIcon}>
                    <ClipboardList color={colors.brand} size={22} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.orderRef}>
                      {displayReference(order) ?? "Refill order"}
                    </Text>
                    <Text style={styles.date}>
                      {formatDate(
                        firstString(order, ["created_at", "createdAt"]),
                      )}
                    </Text>
                  </View>
                  <Text style={styles.status}>
                    {friendlyOrderStatus(status)}
                  </Text>
                </View>
                <View style={styles.divider} />
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>CYLINDER</Text>
                    <Text style={styles.value}>
                      {cylinder
                        ? `${firstNumber(cylinder, ["sizeKg", "size_kg"]) ?? "Configured"} kg · ${displayReference(cylinder)}`
                        : "Cylinder details unavailable"}
                    </Text>
                  </View>
                  <Text style={styles.amount}>
                    {money(
                      firstNumber(order, [
                        "total_amount",
                        "totalAmount",
                        "quoted_total",
                        "quotedTotal",
                      ]) ?? 0,
                      currency,
                    )}
                  </Text>
                </View>
                <View style={styles.station}>
                  <MapPin color={colors.muted} size={17} />
                  <Text numberOfLines={1} style={styles.stationText}>
                    {station
                      ? (firstString(station, [
                          "displayName",
                          "display_name",
                          "formattedAddress",
                          "formatted_address",
                        ]) ?? "Assigned station")
                      : "Finding the best station"}
                  </Text>
                  <ChevronRight color={colors.muted} size={18} />
                </View>
              </Pressable>
            );
          })}
          {(orders.data ?? []).length === 0 ? (
            <View style={styles.empty}>
              <PackageCheck color={colors.brand} size={34} />
              <Text style={styles.emptyTitle}>Ready for your first refill</Text>
              <Text style={styles.body}>
                Choose a cylinder and pickup place. We’ll show the full price before you confirm.
              </Text>
              <Pressable
                onPress={() => router.push("/(customer)/orders/new")}
                style={styles.primary}
              >
                <Text style={styles.primaryText}>Request a refill</Text>
              </Pressable>
            </View>
          ) : null}
        </>
      )}
    </Screen>
  );
}

export function CustomerOrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const detail = useJobDetails(id ?? null);
  const root = detail.data;
  const order = nestedRecord(root, "order") ?? root;
  const cylinder =
    nestedRecord(root, "cylinder") ?? nestedRecord(order, "cylinder");
  const station =
    nestedRecord(root, "station") ??
    nestedRecord(order, "station") ??
    nestedRecord(order, "stationBranch");
  const pickup =
    nestedRecord(root, "pickupLocation") ??
    nestedRecord(order, "pickupLocation") ??
    nestedRecord(order, "pickup_location");
  const delivery =
    nestedRecord(root, "deliveryLocation") ??
    nestedRecord(order, "deliveryLocation") ??
    nestedRecord(order, "delivery_location");
  const status = order ? (displayStatus(order) ?? "created") : "";
  const currency =
    firstString(order, ["currency_code", "currencyCode"]) ?? "NGN";
  const trackable = [
    "assigned",
    "pickup",
    "station",
    "refill",
    "return",
    "delivery",
  ].some((part) => status.includes(part));
  return (
    <Screen
      eyebrow="Order details"
      title={
        order ? (displayReference(order) ?? "Refill order") : "Refill order"
      }
      action={
        <Pressable onPress={() => router.back()}>
          <Text style={styles.link}>Back</Text>
        </Pressable>
      }
    >
      {detail.isPending ? (
        <ActivityIndicator color={colors.brand} />
      ) : !order ? (
        <ErrorState
          message="This order is unavailable or you no longer have access."
          retry={() => void detail.refetch()}
        />
      ) : (
        <>
          <View style={styles.detailHero}>
            <Truck color="white" size={29} />
            <View style={{ flex: 1 }}>
              <Text style={styles.heroLabel}>WHERE YOUR REFILL IS NOW</Text>
              <Text style={styles.heroStatus}>
                {friendlyOrderStatus(status)}
              </Text>
              <Text style={styles.heroBody}>
                Updated{" "}
                {formatDate(
                  firstString(order, ["updated_at", "updatedAt", "created_at"]),
                )}
              </Text>
            </View>
          </View>
          <Card>
            <Field
              label="Cylinder"
              value={
                cylinder
                  ? `${firstNumber(cylinder, ["sizeKg", "size_kg"]) ?? "Configured"} kg · ${displayReference(cylinder)}`
                  : "Cylinder details unavailable"
              }
            />
            <Field
              label="Station"
              value={
                station
                  ? (firstString(station, [
                      "displayName",
                      "display_name",
                      "formattedAddress",
                      "formatted_address",
                    ]) ?? "Assigned station")
                  : "Finding the best station"
              }
            />
            <Field
              label="Pickup address"
              value={
                pickup
                  ? (firstString(pickup, [
                      "formattedAddress",
                      "formatted_address",
                      "label",
                    ]) ?? "Saved location")
                  : "Saved order location"
              }
            />
            <Field
              label="Delivery address"
              value={
                delivery
                  ? (firstString(delivery, [
                      "formattedAddress",
                      "formatted_address",
                      "label",
                    ]) ?? "Saved location")
                  : "Saved order location"
              }
            />
            <Field
              label="Requested refill"
              value={`${firstNumber(order, ["requestedKg", "requested_kg"]) ?? "Configured"} kg`}
            />
            {firstNumber(order, ["actualKg", "actual_kg"]) !== null ? (
              <Field
                label="Actual refill"
                value={`${firstNumber(order, ["actualKg", "actual_kg"])} kg`}
              />
            ) : null}
            <Field
              label="Order total"
              value={money(
                firstNumber(order, [
                  "total_amount",
                  "totalAmount",
                  "quoted_total",
                  "quotedTotal",
                ]) ?? 0,
                currency,
              )}
            />
            <Field
              label="Payment"
              value={friendlyPaymentStatus(
                firstString(order, ["payment_status", "paymentStatus"]) ??
                "pending"
              )}
            />
          </Card>
          {trackable && id ? (
            <Pressable
              style={styles.primary}
              onPress={() =>
                router.push(`/(customer)/orders/${id}/tracking` as never)
              }
            >
              <Text style={styles.primaryText}>Open live tracking</Text>
            </Pressable>
          ) : null}
          {id && (status.includes("delivery") || status.includes("return")) ? (
            <Pressable
              style={styles.secondary}
              onPress={() =>
                router.push(`/(customer)/orders/${id}/verify` as never)
              }
            >
              <Text style={styles.secondaryText}>Confirm delivery</Text>
            </Pressable>
          ) : null}
          {id &&
          (["paid", "completed", "delivered", "settled"].some((part) =>
            status.includes(part),
          ) ||
            ["paid", "settled"].includes(
              firstString(order, ["payment_status", "paymentStatus"]) ?? "",
            )) ? (
            <Pressable
              style={styles.secondary}
              onPress={() =>
                router.push(`/(customer)/orders/${id}/receipt` as never)
              }
            >
              <Text style={styles.secondaryText}>View or share receipt</Text>
            </Pressable>
          ) : null}
          <Text style={styles.safety}>Every update appears after SKIMA confirms the hand-off, payment or location change.</Text>
        </>
      )}
    </Screen>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}
function ErrorState({ message, retry }: { message: string; retry(): void }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>Couldn’t load this order</Text>
      <Text style={styles.body}>{message}</Text>
      <Pressable onPress={retry}>
        <Text style={styles.link}>Try again</Text>
      </Pressable>
    </View>
  );
}
function money(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}
function formatDate(value: string | null) {
  if (!value) return "Time unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
function friendlyOrderStatus(value: string) {
  const normalized = value.toLowerCase().replace(/[-\s]+/g, "_");
  const labels: Record<string, string> = {
    created: "Order started",
    awaiting_payment: "Waiting for payment",
    payment_reserved: "Payment confirmed",
    matching_station: "Finding a refill station",
    matching_driver: "Finding your driver",
    driver_offered: "Driver notified",
    driver_accepted: "Driver assigned",
    pickup_en_route: "Driver heading to pickup",
    pickup_verified: "Cylinder collected",
    station_en_route: "Heading to the station",
    station_verified: "Cylinder received at station",
    refill_in_progress: "Refill in progress",
    refill_confirmed: "Refill complete",
    return_en_route: "On the way back to you",
    delivery_verification_pending: "Ready for hand-over",
    delivered: "Delivered",
    completed: "Completed",
    cancelled: "Cancelled",
    pending: "Waiting for confirmation",
  };
  return labels[normalized] ?? normalized.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}
function friendlyPaymentStatus(value: string) {
  const normalized = value.toLowerCase().replace(/[-\s]+/g, "_");
  const labels: Record<string, string> = {
    pending: "Waiting for confirmation",
    awaiting_payment: "Payment needed",
    reserved: "Payment confirmed",
    payment_reserved: "Payment confirmed",
    paid: "Paid",
    failed: "Payment failed",
    refunded: "Refunded",
  };
  return labels[normalized] ?? "Payment update available";
}
const styles = StyleSheet.create({
  primarySmall: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radii.pill,
    backgroundColor: colors.brand,
  },
  primaryText: { color: "white", fontWeight: "900" },
  order: {
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
  },
  orderHead: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  orderIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF0F1",
  },
  orderRef: { color: colors.ink, fontSize: 17, fontWeight: "900" },
  date: { color: colors.muted, fontSize: 12, marginTop: 3 },
  status: {
    maxWidth: 120,
    color: colors.brandDark,
    backgroundColor: "#FFF0F1",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.pill,
    overflow: "hidden",
    fontSize: 11,
    fontWeight: "900",
    textTransform: "capitalize",
  },
  divider: { height: 1, backgroundColor: colors.border },
  row: { flexDirection: "row", alignItems: "flex-end", gap: spacing.md },
  label: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  value: { color: colors.ink, fontWeight: "800", marginTop: 4 },
  amount: { color: colors.ink, fontSize: 18, fontWeight: "900" },
  station: { flexDirection: "row", alignItems: "center", gap: 7 },
  stationText: { flex: 1, color: colors.muted },
  empty: {
    minHeight: 280,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
  },
  emptyTitle: { color: colors.ink, fontSize: 21, fontWeight: "900" },
  body: { color: colors.muted, lineHeight: 21, textAlign: "center" },
  primary: {
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.lg,
  },
  link: { color: colors.brand, fontWeight: "900" },
  detailHero: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.xl,
    borderRadius: radii.lg,
    backgroundColor: colors.brand,
  },
  heroLabel: { color: "#FFDDE1", fontSize: 11, fontWeight: "900" },
  heroStatus: {
    color: "white",
    fontSize: 24,
    fontWeight: "900",
    textTransform: "capitalize",
    marginTop: 4,
  },
  heroBody: { color: "#FFF1F2", marginTop: 4 },
  fieldValue: { color: colors.ink, fontSize: 16, fontWeight: "800" },
  secondary: {
    minHeight: 54,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: radii.md,
  },
  secondaryText: { color: colors.brand, fontWeight: "900" },
  safety: { color: colors.muted, lineHeight: 20 },
});
