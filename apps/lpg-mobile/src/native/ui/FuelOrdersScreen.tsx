import { router } from "expo-router";
import { ArrowRight, Fuel, Package, RefreshCw } from "lucide-react-native";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { useGatewayQuery } from "../api/gateway";
import { RecordArraySchema, firstNumber, firstString } from "../api/records";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";
import { AppButton } from "./AppButton";
import { Card } from "./Card";
import { EmptyState } from "./EmptyState";
import { Screen } from "./Screen";
import { StatusPill } from "./StatusPill";

export function FuelOrdersScreen() {
  const { palette } = useAppTheme();
  const orders = useGatewayQuery({
    key: ["fuel", "orders", "customer"],
    path: "/runtime/fuel/orders/operations?scope=customer",
    schema: RecordArraySchema,
    refetchInterval: 15000,
  });

  return (
    <Screen
      eyebrow="SKIMA Fuel"
      title="My fuel orders"
      subtitle="Follow station preparation, driver delivery and rental container returns."
      action={<AppButton label="Order fuel" size="sm" onPress={() => router.push("/(customer)/fuel" as never)} />}
    >
      {orders.isPending ? (
        <View style={styles.loading}>
          <ActivityIndicator color={palette.brand} />
          <Text style={[styles.muted, { color: palette.muted }]}>Loading your fuel orders…</Text>
        </View>
      ) : orders.error ? (
        <EmptyState
          title="Fuel orders couldn't be loaded"
          description="Refresh the list and try again."
          action={<AppButton label="Refresh" variant="secondary" onPress={() => void orders.refetch()} />}
        />
      ) : (orders.data ?? []).length === 0 ? (
        <EmptyState
          icon={<Fuel color={palette.brand} size={28} />}
          title="No fuel orders yet"
          description="Your petrol, diesel and kerosene deliveries will appear here."
          action={<AppButton label="Order fuel" onPress={() => router.push("/(customer)/fuel" as never)} />}
        />
      ) : (
        <View style={styles.list}>
          {(orders.data ?? []).map((order, index) => {
            const orderId = firstString(order, ["order_id"]) ?? String(index);
            const productKey = firstString(order, ["product_key"]) ?? "fuel";
            const product = productKey === "fuel.pms" ? "Petrol" : productKey === "fuel.ago" ? "Diesel" : "Kerosene";
            const litres = firstNumber(order, ["requested_litres"]) ?? 0;
            const status = firstString(order, ["stage_key"]) ?? "awaiting_station_acceptance";
            const containerMode = firstString(order, ["container_mode"]) === "rental" ? "Rental container" : "Purchased container";
            const count = firstNumber(order, ["container_count"]) ?? 1;
            return (
              <Pressable
                key={orderId}
                onPress={() => router.push(`/(customer)/fuel-order/${orderId}` as never)}
                style={({ pressed }) => [styles.orderCard, { backgroundColor: palette.surface, borderColor: palette.border, opacity: pressed ? 0.82 : 1 }]}
              >
                <View style={styles.orderHead}>
                  <View style={[styles.icon, { backgroundColor: palette.brandSoft }]}>
                    <Fuel color={palette.brand} size={21} />
                  </View>
                  <View style={styles.orderCopy}>
                    <Text style={[styles.orderTitle, { color: palette.ink }]}>{product} · {litres.toLocaleString()} L</Text>
                    <Text style={[styles.muted, { color: palette.muted }]}>{containerMode} · {count} container(s)</Text>
                    <Text style={[styles.small, { color: palette.muted }]}>Order {orderId.slice(0, 8).toUpperCase()}</Text>
                  </View>
                  <ArrowRight color={palette.muted} size={18} />
                </View>
                <View style={styles.orderFooter}>
                  <StatusPill label={humanize(status)} tone={stageTone(status)} />
                  <Text style={[styles.openText, { color: palette.brand }]}>View details</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
      <Card variant="subtle" title="Rental container reminder" description="After transferring the fuel, return the SKIMA rental container to the delivery driver. It becomes available for reuse only after station receipt and inspection." />
    </Screen>
  );
}

function humanize(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function stageTone(value: string): "neutral" | "brand" | "success" | "warning" | "danger" {
  if (["completed", "inspection_passed"].includes(value)) return "success";
  if (["cancelled", "failed", "exception"].includes(value)) return "danger";
  if (["delivered", "return_due", "returned_to_driver", "received_at_station"].includes(value)) return "warning";
  return "brand";
}

const styles = StyleSheet.create({
  loading: { minHeight: 180, gap: spacing.md, justifyContent: "center", alignItems: "center" },
  list: { gap: spacing.md },
  orderCard: { borderWidth: 1, borderRadius: radii.xl, padding: 15, gap: 13 },
  orderHead: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  icon: { width: 43, height: 43, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  orderCopy: { flex: 1, gap: 3 },
  orderTitle: { ...typography.bodyStrong, fontSize: 15 },
  muted: { ...typography.caption, fontSize: 12, lineHeight: 17 },
  small: { ...typography.caption, fontSize: 10 },
  orderFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#8A8A8A33", paddingTop: 11 },
  openText: { ...typography.caption, fontWeight: "900" },
});
