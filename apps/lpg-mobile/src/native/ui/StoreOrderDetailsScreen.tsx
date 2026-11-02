import { router, useLocalSearchParams } from "expo-router";
import { MapPin, PackageCheck, ShieldCheck, ShoppingBag } from "lucide-react-native";
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";

import { useGatewayQuery } from "../api/gateway";
import {
  firstNumber,
  firstString,
  nestedRecord,
  RecordArraySchema,
  type PlatformRecord,
} from "../api/records";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";
import { AppButton } from "./AppButton";
import { Card } from "./Card";
import { EmptyState } from "./EmptyState";
import { Screen } from "./Screen";
import { StatusPill } from "./StatusPill";

export function StoreOrderDetailsScreen() {
  const { palette } = useAppTheme();
  const params = useLocalSearchParams<{ id?: string }>();
  const orderId = typeof params.id === "string" ? params.id : "";
  const query = useGatewayQuery({
    key: ["store", "customer-order", orderId],
    path: `/runtime/storefront/orders?orderId=${encodeURIComponent(orderId)}`,
    schema: RecordArraySchema,
    enabled: Boolean(orderId),
    refetchInterval: 15000,
  });

  const order = query.data?.[0] ?? null;
  const payload = nestedRecord(order, "order_payload");
  const snapshot = nestedRecord(payload, "store_checkout_snapshot");
  const delivery = nestedRecord(snapshot, "deliveryLocation");
  const pickup = nestedRecord(snapshot, "pickupLocation");
  const lineItems = Array.isArray(order?.line_items)
    ? order.line_items.filter((item): item is PlatformRecord =>
        Boolean(item) && typeof item === "object" && !Array.isArray(item)
      )
    : [];
  const status = firstString(order, ["status"]) ?? "received";
  const currency = firstString(order, ["currency_code", "currencyCode"]) ?? "NGN";
  const subtotal = firstNumber(order, ["subtotal_amount", "subtotalAmount"]) ?? 0;
  const deliveryFee = firstNumber(order, ["fee_amount", "feeAmount"]) ?? 0;
  const total = firstNumber(order, ["total_amount", "totalAmount"]) ?? subtotal + deliveryFee;
  const metadata = nestedRecord(order, "metadata");
  const escrowHoldId = firstString(metadata, ["escrow_hold_id", "escrowHoldId"]);
  const fulfilment = firstString(order, ["fulfillment_method"]) ?? firstString(payload, ["fulfillment_method"]) ?? "delivery";
  const fulfilmentAddress = fulfilment === "pickup"
    ? (firstString(pickup, ["formattedAddress", "formatted_address"]) || firstString(pickup, ["label"]) || "Pickup point")
    : (firstString(delivery, ["formattedAddress", "formatted_address"]) || "Saved delivery address");

  return (
    <Screen
      eyebrow="SKIMA Marketplace"
      title="Order details"
      subtitle={orderId ? `Order ${orderId.slice(0, 8).toUpperCase()}` : "Your Store purchase"}
      action={<AppButton label="Back" variant="ghost" size="sm" onPress={() => router.back()} />}
      refreshControl={
        <RefreshControl
          refreshing={query.isRefetching}
          onRefresh={() => void query.refetch()}
          tintColor={palette.brand}
        />
      }
    >
      {query.isPending ? (
        <View style={styles.loading}>
          <ActivityIndicator color={palette.brand} />
          <Text style={[styles.muted, { color: palette.muted }]}>Loading your Store order…</Text>
        </View>
      ) : query.error || !order ? (
        <EmptyState
          icon={<ShoppingBag color={palette.brand} size={27} />}
          title="This Store order is unavailable"
          description="We could not load this order from your account. Refresh or return to the marketplace."
          action={<AppButton label="Open marketplace" onPress={() => router.replace("/(customer)/store" as never)} />}
        />
      ) : (
        <>
          <Card padding="lg">
            <View style={styles.statusHeader}>
              <View style={styles.statusCopy}>
                <Text style={[styles.eyebrow, { color: palette.brand }]}>ORDER STATUS</Text>
                <Text style={[styles.title, { color: palette.ink }]}>{humanize(status)}</Text>
              </View>
              <StatusPill label={humanize(status)} tone={statusTone(status)} />
            </View>
            <View style={[styles.paymentNotice, { backgroundColor: palette.successSoft }]}>
              <ShieldCheck color={palette.success} size={19} />
              <View style={styles.paymentCopy}>
                <Text style={[styles.paymentTitle, { color: palette.ink }]}>
                  {escrowHoldId ? "Payment reserved in SKIMA escrow" : "Payment status"}
                </Text>
                <Text style={[styles.muted, { color: palette.mutedStrong }]}>
                  {escrowHoldId
                    ? "Your funds are protected while the Store team reviews and fulfils the order."
                    : "The current payment reservation is being confirmed."}
                </Text>
              </View>
            </View>
          </Card>

          <Card padding="lg">
            <View style={styles.sectionHead}>
              <PackageCheck color={palette.brand} size={19} />
              <Text style={[styles.sectionTitle, { color: palette.ink }]}>Items in this order</Text>
            </View>
            {lineItems.length ? lineItems.map((line, index) => {
              const item = nestedRecord(line, "item_snapshot");
              const quantity = firstNumber(line, ["quantity"]) ?? 1;
              const unitAmount = firstNumber(line, ["unit_amount", "unitAmount"]) ?? 0;
              const lineAmount = firstNumber(line, ["line_amount", "lineAmount"]) ?? unitAmount * quantity;
              return (
                <View key={firstString(line, ["id"]) ?? String(index)} style={[styles.lineItem, index > 0 && { borderTopColor: palette.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
                  <View style={styles.lineCopy}>
                    <Text style={[styles.lineTitle, { color: palette.ink }]}>{firstString(item, ["display_name", "displayName", "name"]) ?? "Store product"}</Text>
                    <Text style={[styles.muted, { color: palette.muted }]}>{quantity} × {money(unitAmount, currency)}</Text>
                  </View>
                  <Text style={[styles.lineAmount, { color: palette.ink }]}>{money(lineAmount, currency)}</Text>
                </View>
              );
            }) : (
              <Text style={[styles.muted, { color: palette.muted }]}>The order items are loading or are not available.</Text>
            )}
          </Card>

          <Card padding="lg">
            <Text style={[styles.sectionTitle, { color: palette.ink }]}>Fulfilment</Text>
            <View style={styles.addressRow}>
              <MapPin color={palette.brand} size={19} />
              <View style={styles.addressCopy}>
                <Text style={[styles.lineTitle, { color: palette.ink }]}>{fulfilment === "pickup" ? "Customer pickup" : "Delivery address"}</Text>
                <Text style={[styles.muted, { color: palette.muted }]}>
                  {fulfilmentAddress}
                </Text>
                {firstString(delivery, ["landmark"]) ? <Text style={[styles.muted, { color: palette.muted }]}>Landmark: {firstString(delivery, ["landmark"])}</Text> : null}
                {firstString(delivery, ["deliveryInstructions"]) ? <Text style={[styles.muted, { color: palette.muted }]}>Instructions: {firstString(delivery, ["deliveryInstructions"])}</Text> : null}
              </View>
            </View>
            {firstString(payload, ["customer_note"]) ? (
              <View style={[styles.note, { backgroundColor: palette.surfaceSubtle }]}>
                <Text style={[styles.eyebrow, { color: palette.muted }]}>YOUR NOTE</Text>
                <Text style={[styles.muted, { color: palette.ink }]}>{firstString(payload, ["customer_note"])}</Text>
              </View>
            ) : null}
          </Card>

          <Card padding="lg">
            <Text style={[styles.sectionTitle, { color: palette.ink }]}>Payment summary</Text>
            <SummaryRow label="Items subtotal" value={money(subtotal, currency)} />
            <SummaryRow label="Delivery fee" value={deliveryFee === 0 ? "Free" : money(deliveryFee, currency)} />
            <View style={[styles.totalRow, { borderTopColor: palette.border }]}>
              <Text style={[styles.totalLabel, { color: palette.ink }]}>Total reserved</Text>
              <Text style={[styles.totalValue, { color: palette.ink }]}>{money(total, currency)}</Text>
            </View>
            <Text style={[styles.muted, { color: palette.muted }]}>
              {escrowHoldId ? `Escrow reference: ${escrowHoldId.slice(0, 8).toUpperCase()}` : "Escrow reference will appear after the reservation is confirmed."}
            </Text>
          </Card>

          <AppButton label="Continue shopping" variant="secondary" fullWidth onPress={() => router.replace("/(customer)/store" as never)} />
        </>
      )}
    </Screen>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  const { palette } = useAppTheme();
  return (
    <View style={styles.summaryRow}>
      <Text style={[styles.muted, { color: palette.muted }]}>{label}</Text>
      <Text style={[styles.lineAmount, { color: palette.ink }]}>{value}</Text>
    </View>
  );
}

function money(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString()}`;
  }
}

function humanize(value: string) {
  return value.replace(/[_-]+/g, " ").replace(/\\b\\w/g, (letter) => letter.toUpperCase());
}

function statusTone(value: string): "neutral" | "brand" | "success" | "warning" | "danger" {
  const normalized = value.toLowerCase().replace(/[-\\s]+/g, "_");
  if (["completed", "fulfilled", "paid", "settled"].includes(normalized)) return "success";
  if (["cancelled", "failed", "rejected"].includes(normalized)) return "danger";
  if (["received", "pending", "payment_reserved"].includes(normalized)) return "warning";
  return "brand";
}

const styles = StyleSheet.create({
  loading: { minHeight: 170, justifyContent: "center", alignItems: "center", gap: spacing.sm },
  muted: { ...typography.caption, fontSize: 11, lineHeight: 16 },
  statusHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  statusCopy: { flex: 1, gap: 3 },
  eyebrow: { ...typography.eyebrow, fontSize: 8 },
  title: { fontSize: 20, lineHeight: 25, fontWeight: "900" },
  paymentNotice: { marginTop: spacing.md, flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, padding: spacing.md, borderRadius: radii.lg },
  paymentCopy: { flex: 1, gap: 3 },
  paymentTitle: { ...typography.bodyStrong, fontSize: 12 },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  sectionTitle: { ...typography.subheading, fontSize: 15 },
  lineItem: { minHeight: 58, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, paddingVertical: spacing.sm },
  lineCopy: { flex: 1, gap: 3 },
  lineTitle: { ...typography.bodyStrong, fontSize: 12 },
  lineAmount: { ...typography.bodyStrong, fontSize: 12 },
  addressRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, marginTop: spacing.md },
  addressCopy: { flex: 1, gap: 4 },
  note: { marginTop: spacing.md, padding: spacing.md, borderRadius: radii.md, gap: 4 },
  summaryRow: { minHeight: 38, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  totalRow: { minHeight: 50, flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: StyleSheet.hairlineWidth, marginTop: spacing.sm },
  totalLabel: { ...typography.bodyStrong, fontSize: 13 },
  totalValue: { fontSize: 19, fontWeight: "900" },
});
