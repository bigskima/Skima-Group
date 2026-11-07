import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, Text, View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useSession } from "../session/SessionProvider";
import {
  useStoreRecords,
  useStorefrontData,
  asNumber,
  asString,
  makeIdempotencyKey,
  money,
} from "../api/store";
import { useAppTheme } from "../theme/ThemeProvider";
import { Page, Card, SectionTitle, ActionButton, Field, Notice, State } from "./StoreUI";

type Row = Record<string, unknown>;
const ActionSchema = z.union([z.string(), z.record(z.string(), z.unknown()), z.null()]);
const asRecord = (value: unknown): Row =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const productMetadata = (item: Row) => asRecord(item.metadata);
const orderPayload = (order: Row) => asRecord(order.order_payload);
const orderMetadata = (order: Row) => asRecord(order.metadata);

const cancellationReasons = [
  {
    key: "coverage_unavailable",
    label: "Delivery coverage unavailable",
    customerReason: "Delivery coverage is unavailable for your location, so SKIMA cannot safely fulfil this order.",
  },
  {
    key: "item_unavailable",
    label: "Item unavailable",
    customerReason: "One or more items in this order are no longer available.",
  },
  {
    key: "stock_unavailable",
    label: "Insufficient stock",
    customerReason: "Available stock is not sufficient to complete this order.",
  },
  {
    key: "fulfilment_issue",
    label: "Fulfilment issue",
    customerReason: "SKIMA is unable to complete this order safely with the available fulfilment options.",
  },
  {
    key: "customer_request",
    label: "Customer requested cancellation",
    customerReason: "This order was cancelled following the customer's request.",
  },
] as const;

function nextOrderAction(status: string) {
  switch (status.toLowerCase()) {
    case "received": return { key: "store.order.accept", label: "Accept order" };
    case "accepted": return { key: "store.order.prepare", label: "Start preparation" };
    case "preparing": return { key: "store.order.ready", label: "Mark ready" };
    case "ready_for_pickup": return { key: "store.order.fulfill", label: "Confirm hand-off / dispatch" };
    default: return null;
  }
}

function eventCancellationReason(events: readonly Row[], order: Row) {
  const cancellation = [...events].reverse().find((event) =>
    asString(event, "to_status") === "cancelled" ||
    asString(asRecord(event.metadata), "action_key") === "store.order.cancel"
  );
  const metadata = asRecord(cancellation?.metadata);
  return asString(metadata, "customerVisibleReason", "reason") ??
    asString(orderMetadata(order), "store_cancellation_reason", "store_refund_reason");
}

export function StoreManagementScreen() {
  const session = useSession();
  const { palette } = useAppTheme();
  const client = useQueryClient();
  const isStoreManager = Boolean(
    session.context?.platformAdmin?.status === "active" &&
    session.context.permissions.includes("platform.store.manage"),
  );

  const store = useStorefrontData();
  const ordersQuery = useStoreRecords(["store-management", "orders"], "/runtime/orders", isStoreManager, 15_000);
  const eventsQuery = useStoreRecords(["store-management", "events"], "/runtime/orders/events", isStoreManager, 15_000);

  const [productId, setProductId] = useState<string | null>(null);
  const [productName, setProductName] = useState("");
  const [description, setDescription] = useState("");
  const [categoryName, setCategoryName] = useState("General");
  const [price, setPrice] = useState("");
  const [compareAtPrice, setCompareAtPrice] = useState("");
  const [stock, setStock] = useState("1");
  const [listingStatus, setListingStatus] = useState<"active" | "draft">("active");
  const [productNotice, setProductNotice] = useState("");
  const [cancelOrderId, setCancelOrderId] = useState<string | null>(null);
  const [cancelReasonKey, setCancelReasonKey] = useState<(typeof cancellationReasons)[number]["key"]>("coverage_unavailable");

  const moduleId = asString(store.storeModule, "id");
  const settings = store.settings.data?.find((row) => asString(row, "module_id") === moduleId) ?? null;
  const organizationId = asString(settings, "organization_id");
  const currency = asString(settings, "currency_code") ?? "NGN";

  const products = useMemo(() => (store.items.data ?? []).filter((item) =>
    asString(item, "module_id") === moduleId &&
    (!organizationId || asString(item, "organization_id") === organizationId) &&
    productMetadata(item).sales_channel === "skima_store"
  ), [store.items.data, moduleId, organizationId]);

  const storeOrders = useMemo(() => (ordersQuery.data ?? []).filter((order) =>
    asString(order, "module_id") === moduleId &&
    (!organizationId || asString(order, "organization_id") === organizationId) &&
    asString(orderPayload(order), "channel") === "skima_store"
  ).sort((a, b) => {
    const left = Date.parse(asString(a, "created_at") ?? "");
    const right = Date.parse(asString(b, "created_at") ?? "");
    return (Number.isFinite(right) ? right : 0) - (Number.isFinite(left) ? left : 0);
  }), [ordersQuery.data, moduleId, organizationId]);

  const refresh = async () => {
    await Promise.all([
      store.modules.refetch(), store.settings.refetch(), store.items.refetch(),
      store.categories.refetch(), store.prices.refetch(), store.availability.refetch(),
      ordersQuery.refetch(), eventsQuery.refetch(),
    ]);
    await client.invalidateQueries({ queryKey: ["skima-store"] });
  };

  const resetProduct = () => {
    setProductId(null);
    setProductName("");
    setDescription("");
    setCategoryName("General");
    setPrice("");
    setCompareAtPrice("");
    setStock("1");
    setListingStatus("active");
  };

  const openProduct = (item?: Row) => {
    if (!item) {
      resetProduct();
      setProductNotice("");
      return;
    }
    const id = asString(item, "id") ?? "";
    const priceRow = (store.prices.data ?? []).find((entry) =>
      asString(entry, "item_id") === id && !asString(entry, "variant_id") &&
      asString(entry, "status") === "active"
    );
    const stockRow = (store.availability.data ?? []).find((entry) =>
      asString(entry, "item_id") === id && !asString(entry, "variant_id") &&
      asString(entry, "status") === "active"
    );
    setProductId(id);
    setProductName(asString(item, "display_name", "name") ?? "");
    setDescription(asString(item, "description") ?? "");
    const category = (store.categories.data ?? []).find((entry) => asString(entry, "id") === asString(item, "category_id"));
    setCategoryName(asString(category, "display_name") ?? "General");
    setPrice(String(asNumber(priceRow, "amount") ?? ""));
    setCompareAtPrice(String(asNumber(priceRow, "compare_at_amount") ?? ""));
    setStock(String(asNumber(stockRow, "stock_quantity") ?? 0));
    setListingStatus(asString(item, "status") === "active" ? "active" : "draft");
    setProductNotice("");
  };

  const saveProduct = useMutation({
    mutationFn: async () => {
      if (!settings || !organizationId || asString(settings, "status") !== "active") {
        throw new Error("The SKIMA Store storefront must be configured and active before products can be published.");
      }
      const amount = Number(price);
      const compareAmount = compareAtPrice.trim() ? Number(compareAtPrice) : null;
      const quantity = Number(stock);
      if (!productName.trim()) throw new Error("Enter a product name.");
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a selling price greater than zero.");
      if (compareAmount !== null && (!Number.isFinite(compareAmount) || compareAmount <= amount)) {
        throw new Error("The original price must be greater than the selling price.");
      }
      if (!Number.isFinite(quantity) || quantity < 0) throw new Error("Enter a valid stock quantity.");
      const slug = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "").slice(0, 70) || "general";
      const categoryKey = "store.category." + slug(categoryName);
      return session.api.post("/runtime/storefront/products", productId ? {
        operation: "update",
        itemId: productId,
        itemKey: "store.item." + slug(productName),
        displayName: productName.trim(),
        description: description.trim(),
        categoryKey,
        categoryName: categoryName.trim() || "General",
        amount,
        compareAtAmount: compareAmount,
        stockQuantity: quantity,
        status: listingStatus,
        idempotencyKey: makeIdempotencyKey("store-app-product-update:" + productId),
        metadata: { productOrigin: "skima_store_admin", source: "store_app" },
      } : {
        displayName: productName.trim(),
        description: description.trim(),
        categoryKey,
        categoryName: categoryName.trim() || "General",
        itemKey: "store.item." + slug(productName) + "." + Date.now().toString(36),
        amount,
        compareAtAmount: compareAmount,
        stockQuantity: quantity,
        status: listingStatus,
        idempotencyKey: makeIdempotencyKey("store-app-product-create"),
        metadata: { productOrigin: "skima_store_admin", sales_channel: "skima_store", source: "store_app" },
      }, ActionSchema);
    },
    onSuccess: async () => {
      setProductNotice(productId ? "Product changes saved." : "Product created successfully.");
      resetProduct();
      await refresh();
    },
  });

  const processOrder = useMutation({
    mutationFn: async (input: { orderId: string; actionKey: string; reason?: string; reasonCode?: string }) =>
      session.api.post("/runtime/orders/actions", {
        orderId: input.orderId,
        actionKey: input.actionKey,
        reason: input.reason,
        payload: {
          channel: "skima_store_admin",
          ...(input.reasonCode ? { cancellationReasonCode: input.reasonCode, customerVisibleReason: input.reason } : {}),
        },
        metadata: {
          moduleKey: "store",
          ...(input.reasonCode ? { cancellationReasonCode: input.reasonCode, customerVisibleReason: input.reason } : {}),
        },
        source: "platform.storefront",
        idempotencyKey: makeIdempotencyKey("store-app-order-action:" + input.orderId + ":" + input.actionKey),
      }, ActionSchema),
    onSuccess: async () => {
      setCancelOrderId(null);
      await Promise.all([ordersQuery.refetch(), eventsQuery.refetch()]);
    },
  });

  const refundOrder = useMutation({
    mutationFn: async (order: Row) => {
      const id = asString(order, "id");
      if (!id) throw new Error("The Store order identifier is missing.");
      const events = (eventsQuery.data ?? []).filter((event) => asString(event, "order_id") === id);
      const reason = eventCancellationReason(events, order) ??
        "SKIMA cancelled this Store order because it could not be fulfilled.";
      return session.api.post("/runtime/storefront/orders/refund", {
        orderId: id,
        reason,
        idempotencyKey: makeIdempotencyKey("store-app-order-refund:" + id),
      }, ActionSchema);
    },
    onSuccess: async () => {
      await Promise.all([ordersQuery.refetch(), eventsQuery.refetch()]);
    },
  });

  if (session.status === "loading") {
    return <Page><State title="Checking Store access" body="Verifying your SKIMA platform permissions." /></Page>;
  }
  if (!isStoreManager) {
    return <Page><State title="Access restricted" body="Store management is available only to authorised SKIMA platform administrators with the Store management permission." /></Page>;
  }
  if (!store.storeModule) {
    return <Page><State title="Store module unavailable" body="The Store module is not active. Contact a platform administrator." retry={() => void refresh()} /></Page>;
  }

  return (
    <Page refreshControl={<RefreshControl refreshing={store.items.isRefetching || ordersQuery.isRefetching} onRefresh={() => void refresh()} tintColor={palette.brand} />}>
      <SectionTitle title="Store management" caption="Create SKIMA Store products, accept orders, prepare deliveries and process customer refunds without leaving the Store app." />
      <Notice text="Changes here use the same Store catalogue, stock, order workflow and wallet-refund services as the SKIMA Admin dashboard. The Admin Store workspace remains available." />

      {!settings || asString(settings, "status") !== "active" ? (
        <Notice tone="warning" text="The Storefront is not active yet. An authorised platform administrator must complete the Store operating setup in Admin before products can be offered to customers." />
      ) : (
        <Card>
          <SectionTitle title={productId ? "Edit product" : "Create a Store product"} caption={productId ? "Update the existing SKIMA Store listing." : "Add a product to the SKIMA Store catalogue."} />
          <Field label="Product name" value={productName} onChangeText={setProductName} placeholder="e.g. 5 kg cooking pot" />
          <Field label="Description" value={description} onChangeText={setDescription} placeholder="Describe this product" />
          <Field label="Category" value={categoryName} onChangeText={setCategoryName} placeholder="General" />
          <Field label={"Selling price (" + currency + ")"} value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="0.00" />
          <Field label={"Original price (" + currency + ") · optional"} value={compareAtPrice} onChangeText={setCompareAtPrice} keyboardType="decimal-pad" placeholder="Leave blank when there is no discount" />
          <Field label="Available stock" value={stock} onChangeText={setStock} keyboardType="numeric" placeholder="0" />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <ActionButton small label={listingStatus === "active" ? "Published" : "Publish listing"} variant={listingStatus === "active" ? "secondary" : "primary"} onPress={() => setListingStatus("active")} />
            <ActionButton small label="Save as draft" variant={listingStatus === "draft" ? "secondary" : "quiet"} onPress={() => setListingStatus("draft")} />
          </View>
          {saveProduct.isError ? <Notice tone="error" text={saveProduct.error instanceof Error ? saveProduct.error.message : "Product could not be saved."} /> : null}
          <ActionButton label={productId ? "Save product changes" : "Create product"} loading={saveProduct.isPending} disabled={saveProduct.isPending} onPress={() => saveProduct.mutate()} />
          {productId ? <ActionButton label="Stop editing" variant="quiet" onPress={resetProduct} /> : null}
          {productNotice ? <Notice tone="success" text={productNotice} /> : null}
        </Card>
      )}

      <Card>
        <SectionTitle title="Your Store catalogue" caption={products.length + " SKIMA Store listing(s). Draft products are not shown to customers."} action={<ActionButton small label="New product" onPress={() => openProduct()} />} />
        {store.items.isPending || store.prices.isPending || store.availability.isPending ? <ActivityIndicator color={palette.brand} /> :
          products.length ? products.map((item) => {
            const id = asString(item, "id") ?? "";
            const itemPrice = (store.prices.data ?? []).find((entry) => asString(entry, "item_id") === id && !asString(entry, "variant_id") && asString(entry, "status") === "active");
            const itemStock = (store.availability.data ?? []).find((entry) => asString(entry, "item_id") === id && !asString(entry, "variant_id") && asString(entry, "status") === "active");
            return (
              <View key={id} style={{ paddingVertical: 10, borderTopWidth: 1, borderColor: palette.border, gap: 5 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <Text style={{ color: palette.ink, fontSize: 12, fontWeight: "900", flex: 1 }}>{asString(item, "display_name", "name") ?? "Store product"}</Text>
                  <Text style={{ color: asString(item, "status") === "active" ? palette.success : palette.warning, fontSize: 10, fontWeight: "900" }}>{asString(item, "status") === "active" ? "Published" : "Draft"}</Text>
                </View>
                <Text style={{ color: palette.muted, fontSize: 10 }}>{money(asNumber(itemPrice, "amount") ?? 0, currency)} · Stock {asNumber(itemStock, "stock_quantity") ?? 0}</Text>
                <ActionButton small label="Edit listing" variant="secondary" onPress={() => openProduct(item)} />
              </View>
            );
          }) : <State title="No Store products yet" body="Create your first product above. Only active, priced and available listings appear in the customer shop." />}
      </Card>

      <Card>
        <SectionTitle title="Order fulfilment" caption="Move every SKIMA Store order through acceptance, preparation, hand-off and customer confirmation." />
        {ordersQuery.isPending ? <ActivityIndicator color={palette.brand} /> :
          ordersQuery.error ? <State title="Orders unavailable" body="The order queue could not be loaded. Refresh and try again." retry={() => void ordersQuery.refetch()} /> :
          storeOrders.length ? storeOrders.map((order) => {
            const id = asString(order, "id") ?? "";
            const status = asString(order, "status") ?? "received";
            const metadata = orderMetadata(order);
            const events = (eventsQuery.data ?? []).filter((event) => asString(event, "order_id") === id);
            const reason = eventCancellationReason(events, order);
            const refunded = typeof metadata.store_refunded_at === "string";
            const next = nextOrderAction(status);
            return (
              <View key={id} style={{ paddingVertical: 12, borderTopWidth: 1, borderColor: palette.border, gap: 7 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <Text style={{ color: palette.ink, fontSize: 11, fontWeight: "900", flex: 1 }}>Order {id.slice(0, 8).toUpperCase()}</Text>
                  <Text style={{ color: palette.brand, fontSize: 10, fontWeight: "900" }}>{status.replaceAll("_", " ")}</Text>
                </View>
                <Text style={{ color: palette.muted, fontSize: 10 }}>{money(asNumber(order, "total_amount") ?? 0, asString(order, "currency_code") ?? currency)} · {asString(order, "fulfillment_method") ?? "delivery"}</Text>
                {status === "fulfilled" ? <Notice text="Waiting for the customer to confirm receipt. The order will complete through the existing receipt flow." /> : null}
                {status === "cancelled" ? <Notice tone="warning" text={"Cancellation reason: " + (reason ?? "SKIMA could not fulfil this order.")} /> : null}
                {next ? (
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <ActionButton small label={next.label} loading={processOrder.isPending} disabled={processOrder.isPending} onPress={() => processOrder.mutate({ orderId: id, actionKey: next.key })} />
                    <ActionButton small label="Cancel" variant="danger" disabled={processOrder.isPending} onPress={() => { setCancelOrderId(id); setCancelReasonKey("coverage_unavailable"); }} />
                  </View>
                ) : null}
                {status === "cancelled" && !refunded ? (
                  <ActionButton small label="Refund to customer wallet" variant="secondary" loading={refundOrder.isPending} disabled={refundOrder.isPending} onPress={() => refundOrder.mutate(order)} />
                ) : refunded ? <Notice tone="success" text="Refund sent to the customer's SKIMA Wallet." /> : null}
              </View>
            );
          }) : <State title="No Store orders yet" body="Orders placed by customers will appear here when checkout is completed." />}
        {eventsQuery.error ? <Notice tone="warning" text="Order actions remain available, but the event history could not be loaded." /> : null}
      </Card>

      {cancelOrderId ? (
        <Card>
          <SectionTitle title="Confirm order cancellation" caption="Choose the real reason so the customer understands why SKIMA cancelled the order." />
          {cancellationReasons.map((reason) => (
            <Pressable key={reason.key} onPress={() => setCancelReasonKey(reason.key)} style={{
              padding: 11, borderRadius: 12, borderWidth: 1,
              borderColor: cancelReasonKey === reason.key ? palette.brand : palette.border,
              backgroundColor: cancelReasonKey === reason.key ? palette.brandSoft : palette.surface,
              gap: 3,
            }}>
              <Text style={{ color: palette.ink, fontSize: 11, fontWeight: "900" }}>{reason.label}</Text>
              <Text style={{ color: palette.muted, fontSize: 10, lineHeight: 15 }}>{reason.customerReason}</Text>
            </Pressable>
          ))}
          <ActionButton label="Confirm cancellation" variant="danger" loading={processOrder.isPending} disabled={processOrder.isPending} onPress={() => {
            const reason = cancellationReasons.find((entry) => entry.key === cancelReasonKey) ?? cancellationReasons[0];
            processOrder.mutate({ orderId: cancelOrderId, actionKey: "store.order.cancel", reason: reason.customerReason, reasonCode: reason.key });
          }} />
          <ActionButton label="Keep order active" variant="quiet" onPress={() => setCancelOrderId(null)} />
        </Card>
      ) : null}
      {processOrder.isError ? <Notice tone="error" text={processOrder.error instanceof Error ? processOrder.error.message : "The Store order could not be updated."} /> : null}
      {refundOrder.isError ? <Notice tone="error" text={refundOrder.error instanceof Error ? refundOrder.error.message : "The customer refund could not be completed."} /> : null}
    </Page>
  );
}
