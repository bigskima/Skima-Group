import { useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, Text, View } from "react-native";
import { CheckCircle2, Clock3, Package, ReceiptText } from "lucide-react-native";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { useSession } from "../session/SessionProvider";
import { useStoreRecords, asNumber, asString, makeIdempotencyKey, money } from "../api/store";
import { useAppTheme } from "../theme/ThemeProvider";
import { Page, Card, SectionTitle, ActionButton, State, Notice } from "./StoreUI";
import { GuideTarget } from "../onboarding/StoreGuideProvider";
import { ServiceDiscoveryModal } from "./ServiceDiscoveryModal";

const ActionSchema = z.union([z.string(), z.record(z.string(), z.unknown()), z.null()]);
const recordValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const cancellationReason = (order: Record<string, unknown>) => {
  const metadata = recordValue(order.metadata);
  const events = Array.isArray(order.events) ? order.events.map(recordValue) : [];
  const cancelled = [...events].reverse().find((event) =>
    asString(event, "to_status") === "cancelled" ||
    asString(recordValue(event.metadata), "action_key") === "store.order.cancel"
  );
  const eventMetadata = recordValue(cancelled?.metadata);
  return asString(eventMetadata, "customerVisibleReason", "reason") ??
    asString(metadata, "store_cancellation_reason", "store_refund_reason");
};
const statusLabel = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const dateLabel = (value: string | null) => value
  ? new Date(value).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })
  : "Date unavailable";

export function StoreOrdersScreen() {
  const session = useSession();
  const { palette } = useAppTheme();
  const [thankYouVisible, setThankYouVisible] = useState(false);
  const orders = useStoreRecords(["orders"], "/runtime/storefront/orders", true, 15_000);
  const confirmReceipt = useMutation({
    mutationFn: (orderId: string) => session.api.post(
      "/runtime/storefront/orders/confirm-receipt",
      { orderId, idempotencyKey: makeIdempotencyKey("store-receipt:" + orderId) },
      ActionSchema,
    ),
    onSuccess: async (_result, orderId) => {
      const refreshed = await orders.refetch();
      const completedOrder = (refreshed.data ?? []).find((item) => asString(item, "id") === orderId);
      if ((asString(completedOrder, "status") ?? "").toLowerCase() === "completed") setThankYouVisible(true);
    },
  });
  const rows = useMemo(() => [...(orders.data ?? [])].sort((left, right) => {
    const a = Date.parse(asString(left, "created_at") ?? "");
    const b = Date.parse(asString(right, "created_at") ?? "");
    return (Number.isFinite(b) ? b : 0) - (Number.isFinite(a) ? a : 0);
  }), [orders.data]);
  const refresh = () => void orders.refetch();

  return (
    <Page guidePage="orders" refreshControl={<RefreshControl refreshing={orders.isRefetching} onRefresh={refresh} tintColor={palette.brand} />}>
      <GuideTarget page="orders" targetKey="store.orders.history"><SectionTitle title="Your orders" caption="Follow each Store purchase from checkout through delivery and receipt." /></GuideTarget>
      {confirmReceipt.isError ? <Notice tone="error" text={confirmReceipt.error instanceof Error ? confirmReceipt.error.message : "Receipt confirmation could not be completed. Try again."} /> : null}
      {confirmReceipt.isSuccess ? <Notice tone="success" text="Your receipt has been confirmed and the order settlement has been updated." /> : null}
      {orders.isPending ? <ActivityIndicator color={palette.brand} /> :
        orders.error ? <State title="Orders unavailable" body="Your Store purchases are safe. Refresh to try again." retry={refresh} /> :
        !rows.length ? <State title="No orders yet" body="Your first SKIMA Store purchase will appear here with its delivery status and receipt." /> :
        <View style={{ gap: 10 }}>
          <Card style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: palette.brandSoft, alignItems: "center", justifyContent: "center" }}>
              <Package color={palette.brand} size={20} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontSize: 11, color: palette.ink, fontWeight: "900" }}>{rows.length} Store {rows.length === 1 ? "order" : "orders"}</Text>
              <Text style={{ fontSize: 10, color: palette.muted }}>View your order updates and confirm receipt when your items arrive.</Text>
            </View>
          </Card>
          {rows.map((order, index) => {
            const id = asString(order, "id") ?? "order-" + index;
            const status = (asString(order, "status") ?? "received").toLowerCase();
            const currency = asString(order, "currency_code") ?? "NGN";
            const canConfirm = status === "fulfilled";
            const completed = status === "completed";
            const cancelled = status === "cancelled";
            const orderMetadata = recordValue(order.metadata);
            const reason = cancellationReason(order);
            const refundedAt = asString(orderMetadata, "store_refunded_at");
            const noRefundRequired = asString(orderMetadata, "store_refund_status") === "not_required" ||
              asString(orderMetadata, "store_payment_status") === "not_funded";
            return (
              <Card key={id} style={{ gap: 9 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                    <ReceiptText color={palette.brand} size={17} />
                    <Text style={{ color: palette.ink, fontSize: 11, fontWeight: "900" }}>Order {id.slice(0, 8).toUpperCase()}</Text>
                  </View>
                  <Text style={{ color: completed ? palette.success : cancelled ? palette.danger : palette.brand, fontSize: 10, fontWeight: "900" }}>{statusLabel(status)}</Text>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Clock3 size={12} color={palette.muted} />
                  <Text style={{ color: palette.muted, fontSize: 10 }}>{dateLabel(asString(order, "created_at"))}</Text>
                </View>
                <View style={{ height: 1, backgroundColor: palette.border }} />
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                  <Text style={{ color: palette.muted, fontSize: 10 }}>Delivery method</Text>
                  <Text style={{ color: palette.ink, fontSize: 10, fontWeight: "800" }}>{statusLabel(asString(order, "fulfillment_method") ?? "delivery")}</Text>
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                  <Text style={{ color: palette.muted, fontSize: 10 }}>Total</Text>
                  <Text style={{ color: palette.ink, fontSize: 12, fontWeight: "900" }}>{money(asNumber(order, "total_amount") ?? 0, currency)}</Text>
                </View>
                {cancelled ? (
                  <View style={{ padding: 12, borderRadius: 13, borderWidth: 1, borderColor: palette.danger, backgroundColor: palette.dangerSoft, gap: 6 }}>
                    <Text style={{ color: palette.danger, fontSize: 11, fontWeight: "900" }}>Why SKIMA cancelled this order</Text>
                    <Text style={{ color: palette.ink, fontSize: 11, lineHeight: 17 }}>
                      {reason ?? "SKIMA could not fulfil this order. Please contact our support team if you need more details."}
                    </Text>
                    <Text style={{ color: palette.ink, fontSize: 10, lineHeight: 16 }}>
                      {refundedAt
                        ? "Your refund was sent to your SKIMA Wallet on " + dateLabel(refundedAt) + "."
                        : noRefundRequired
                          ? "No payment was captured from your SKIMA Wallet for this checkout, so no refund is required."
                          : "Your order is cancelled. The wallet refund has not yet been marked as completed."}
                    </Text>
                  </View>
                ) : canConfirm ? <ActionButton label="Confirm receipt" loading={confirmReceipt.isPending} disabled={confirmReceipt.isPending} onPress={() => confirmReceipt.mutate(id)} /> :
                  completed ? <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><CheckCircle2 color={palette.success} size={14} /><Text style={{ color: palette.success, fontSize: 10, fontWeight: "800" }}>Receipt confirmed · settlement completed</Text></View> :
                  <Text style={{ color: palette.muted, fontSize: 10 }}>We’ll update you as your order is prepared and delivered.</Text>}
              </Card>
            );
          })}
        </View>}
      <ServiceDiscoveryModal visible={thankYouVisible} currentServiceKey="store" title="Thanks for choosing SKIMA!" message="Your Store delivery is complete and your receipt is confirmed. Thank you for shopping with SKIMA." supabase={session.supabase} onClose={() => setThankYouVisible(false)} />
    </Page>
  );
}
