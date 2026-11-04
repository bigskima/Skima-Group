import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeDollarSign, Boxes, PackagePlus, RefreshCcw, Settings2, ShoppingBag, Tag, Truck } from "lucide-react";
import { type ChangeEvent, useMemo, useState } from "react";
import { z } from "zod";

import { createClientIdempotencyKey, normalizeStatusLabel } from "@skima/frontend-core";
import {
  Button,
  DataTable,
  Dialog,
  ErrorState,
  LoadingState,
  MetricTile,
  SelectInput,
  StatusBadge,
  TextAreaInput,
  TextInput,
  type TableColumn,
} from "@skima/ui";

import { useSessionState } from "../../session";
import { AdminV2PageHeader } from "../../shared/patterns/AdminV2Patterns";
import {
  catalogError,
  catalogLabel,
  catalogSlug,
  catalogText,
  type CatalogRecord,
} from "../services/service-catalog-v2-shared";

const RecordArraySchema = z.array(z.record(z.unknown()));
const StoreSettingsSchema = z.unknown();
const StoreProductSchema = z.record(z.unknown());
const UploadSessionSchema = z.object({ token: z.string(), signedUrl: z.string().url(), storageBucket: z.string(), storagePath: z.string() });
const MediaAssetSchema = z.union([z.string(), z.record(z.unknown())]);

export function StoreWorkspace(props: { readonly onNavigate: (href: string) => void }) {
  const { api, status, supabase, context } = useSessionState();
  const client = useQueryClient();
  const [settingsEditorOpen, setSettingsEditorOpen] = useState(false);
  const [productEditorOpen, setProductEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<CatalogRecord | null>(null);
  const [mediaFiles, setMediaFiles] = useState<File[]>([]);
  const [listingStatus, setListingStatus] = useState("active");
  const [organizationId, setOrganizationId] = useState("");
  const [currencyCode, setCurrencyCode] = useState("NGN");
  const [fulfillmentMethod, setFulfillmentMethod] = useState("delivery");
  const [deliveryOriginLabel, setDeliveryOriginLabel] = useState("SKIMA Store");
  const [deliveryOriginAddress, setDeliveryOriginAddress] = useState("");
  const [deliveryBaseFeeAmount, setDeliveryBaseFeeAmount] = useState("0");
  const [freeDeliveryMinimumAmount, setFreeDeliveryMinimumAmount] = useState("");
  const [minimumOrderAmount, setMinimumOrderAmount] = useState("0");
  const [pickupLocationLabel, setPickupLocationLabel] = useState("SKIMA Store pickup");
  const [pickupFormattedAddress, setPickupFormattedAddress] = useState("");
  const [pickupInstructions, setPickupInstructions] = useState("");
  const [productName, setProductName] = useState("");
  const [description, setDescription] = useState("");
  const [categoryName, setCategoryName] = useState("General");
  const [categoryKey, setCategoryKey] = useState("store.category.general");
  const [amount, setAmount] = useState("");
  const [compareAtAmount, setCompareAtAmount] = useState("");
  const [stockQuantity, setStockQuantity] = useState("1");

  const organizations = useQuery({
    queryKey: ["store-admin", "organizations"],
    enabled: status === "authenticated",
    queryFn: () => api.get("/admin/organizations", RecordArraySchema),
  });
  const modules = useQuery({
    queryKey: ["store-admin", "modules"],
    enabled: status === "authenticated",
    queryFn: () => api.get("/modules", RecordArraySchema),
  });
  const settings = useQuery({
    queryKey: ["store-admin", "settings"],
    enabled: status === "authenticated",
    queryFn: () => api.get("/runtime/storefront/settings", RecordArraySchema),
  });
  const items = useQuery({
    queryKey: ["store-admin", "items"],
    enabled: status === "authenticated",
    queryFn: () => api.get("/runtime/catalog/items", RecordArraySchema),
  });
  const categories = useQuery({
    queryKey: ["store-admin", "categories"],
    enabled: status === "authenticated",
    queryFn: () => api.get("/runtime/catalog/categories", RecordArraySchema),
  });
  const prices = useQuery({
    queryKey: ["store-admin", "prices"],
    enabled: status === "authenticated",
    queryFn: () => api.get("/runtime/catalog/prices", RecordArraySchema),
  });
  const availability = useQuery({
    queryKey: ["store-admin", "availability"],
    enabled: status === "authenticated",
    queryFn: () => api.get("/runtime/catalog/availability", RecordArraySchema),
  });
  const media = useQuery({
    queryKey: ["store-admin", "media"],
    enabled: status === "authenticated",
    queryFn: () => api.get("/runtime/catalog/media", RecordArraySchema),
  });
  const orders = useQuery({
    queryKey: ["store-admin", "orders"],
    enabled: status === "authenticated",
    queryFn: () => api.get("/runtime/orders", RecordArraySchema),
  });

  const storeModule = modules.data?.find((module) =>
    catalogText(module, "key") === "store" && catalogText(module, "status") === "active"
  ) ?? null;
  const storeModuleId = catalogText(storeModule, "id");
  const savedSettings = settings.data?.find((entry) =>
    catalogText(entry, "module_id") === storeModuleId
  ) ?? null;
  const savedOrganizationId = catalogText(savedSettings, "organization_id");
  const savedOrganization = organizations.data?.find((entry) =>
    catalogText(entry, "id") === savedOrganizationId
  ) ?? null;

  const storeItems = useMemo(() => (items.data ?? []).filter((item) =>
    catalogText(item, "module_id") === storeModuleId &&
    (!savedOrganizationId || catalogText(item, "organization_id") === savedOrganizationId)
  ), [items.data, savedOrganizationId, storeModuleId]);
  const storeCategories = useMemo(() => (categories.data ?? []).filter((entry) =>
    catalogText(entry, "module_id") === storeModuleId &&
    (!savedOrganizationId || catalogText(entry, "organization_id") === savedOrganizationId)
  ), [categories.data, savedOrganizationId, storeModuleId]);
  const storeOrders = useMemo(() => (orders.data ?? []).filter((entry) =>
    catalogText(entry, "module_id") === storeModuleId &&
    (!savedOrganizationId || catalogText(entry, "organization_id") === savedOrganizationId)
  ), [orders.data, savedOrganizationId, storeModuleId]);

  const activeItems = storeItems.filter((item) => catalogText(item, "status") === "active");
  const activePrices = (prices.data ?? []).filter((price) =>
    catalogText(price, "status") === "active" &&
    storeItems.some((item) => catalogText(item, "id") === catalogText(price, "item_id"))
  );
  const availableProducts = (availability.data ?? []).filter((rule) =>
    catalogText(rule, "status") === "active" &&
    catalogText(rule, "availability_status") === "available" &&
    storeItems.some((item) => catalogText(item, "id") === catalogText(rule, "item_id"))
  ).length;

  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ["store-admin"] });
  };

  const saveSettings = useMutation({
    mutationFn: () => {
      const parsedBaseFee = Number(deliveryBaseFeeAmount);
      const parsedMinimumOrder = Number(minimumOrderAmount);
      const parsedFreeThreshold = freeDeliveryMinimumAmount.trim() ? Number(freeDeliveryMinimumAmount) : null;
      if (!deliveryOriginLabel.trim() || !deliveryOriginAddress.trim()) {
        throw new Error("Enter the Store dispatch origin and its formatted address.");
      }
      if (![parsedBaseFee, parsedMinimumOrder].every((value) => Number.isFinite(value) && value >= 0) ||
        (parsedFreeThreshold !== null && (!Number.isFinite(parsedFreeThreshold) || parsedFreeThreshold < 0))) {
        throw new Error("Delivery fees, free-delivery threshold and minimum order must be zero or greater.");
      }
      return api.post("/runtime/storefront/full-settings", {
        organizationId,
        branchId: null,
        currencyCode,
        fulfillmentMethod,
        fulfillmentMethods: ["delivery", "pickup"],
        deliveryOriginLabel: deliveryOriginLabel.trim(),
        deliveryOriginFormattedAddress: deliveryOriginAddress.trim(),
        deliveryOriginLatitude: null,
        deliveryOriginLongitude: null,
        deliveryBaseFeeAmount: parsedBaseFee,
        deliveryPerKmFeeAmount: 0,
        deliveryRadiusKm: null,
        freeDeliveryMinimumAmount: parsedFreeThreshold,
        minimumOrderAmount: parsedMinimumOrder,
        pickupLocationLabel: pickupLocationLabel.trim() || deliveryOriginLabel.trim(),
        pickupFormattedAddress: pickupFormattedAddress.trim() || deliveryOriginAddress.trim(),
        pickupInstructions: pickupInstructions.trim(),
        status: "active",
        idempotencyKey: createClientIdempotencyKey("admin.storefront.full-settings"),
        metadata: { configuredFrom: "admin.store" },
      }, StoreSettingsSchema);
    },
    onSuccess: async () => {
      setSettingsEditorOpen(false);
      await refresh();
    },
  });

  const createProduct = useMutation({
    mutationFn: async () => {
      const parsedAmount = Number(amount);
      const parsedCompareAt = compareAtAmount.trim() ? Number(compareAtAmount) : null;
      const parsedStock = Number(stockQuantity);
      if (!productName.trim()) throw new Error("Enter a product name.");
      if (!Number.isFinite(parsedAmount) || parsedAmount < 0) throw new Error("Enter a valid selling price.");
      if (parsedCompareAt !== null && (!Number.isFinite(parsedCompareAt) || parsedCompareAt <= parsedAmount)) {
        throw new Error("The crossed-out price must be greater than the selling price.");
      }
      if (!Number.isFinite(parsedStock) || parsedStock < 0) throw new Error("Enter a valid stock quantity.");
      if (!context?.user.id) throw new Error("The authenticated Admin identity is unavailable.");
      if (mediaFiles.some((file) => !file.type.startsWith("image/") && !file.type.startsWith("video/"))) throw new Error("Store media must be an image or video file.");
      if (mediaFiles.some((file) => file.size <= 0 || file.size > 50 * 1024 * 1024)) throw new Error("Each Store photo or video must be no larger than 50 MB.");

      let result: Record<string, unknown>;
      if (editingItem) {
        result = await api.post("/runtime/storefront/products", {
          operation: "update", itemId: catalogText(editingItem, "id"),
          displayName: productName.trim(), description: description.trim(), categoryKey, categoryName: categoryName.trim() || "General",
          amount: parsedAmount, compareAtAmount: parsedCompareAt, stockQuantity: parsedStock,
          status: listingStatus,
          idempotencyKey: createClientIdempotencyKey("admin.storefront.product.update", catalogText(editingItem, "id")),
          metadata: { productOrigin: "skima_store_admin", editedFrom: "store_workspace" },
        }, StoreProductSchema);
      } else {
        const slug = catalogSlug(productName);
        result = await api.post("/runtime/storefront/products", {
          displayName: productName.trim(), description: description.trim(),
          categoryKey: catalogSlug(categoryKey) ? categoryKey : "store.category.general",
          categoryName: categoryName.trim() || "General", itemKey: `store.item.${slug}.${Date.now()}`,
          amount: parsedAmount, compareAtAmount: parsedCompareAt, stockQuantity: parsedStock,
          status: listingStatus, idempotencyKey: createClientIdempotencyKey("admin.storefront.product"),
          metadata: { productOrigin: "skima_store_admin" },
        }, StoreProductSchema);
      }

      const itemId = catalogText(result, "itemId") || (editingItem ? catalogText(editingItem, "id") : "");
      if (!itemId) throw new Error("The Store product was saved but no item identifier was returned.");
      // Save the identifier before media uploads so a failed upload can be retried
      // as an edit of the existing listing instead of creating a duplicate.
      if (!editingItem) {
        setEditingItem({
          id: itemId,
          display_name: productName.trim(),
          description: description.trim(),
          status: listingStatus,
        } as CatalogRecord);
      }
      for (let index = 0; index < mediaFiles.length; index += 1) {
        const file = mediaFiles[index];
        const contentType = file.type || "application/octet-stream";
        const key = createClientIdempotencyKey("admin.store.product-media", `${itemId}:${file.name}:${file.lastModified}`);
        const upload = await api.post("/runtime/media/upload-sessions", { contentType, fileName: file.name, idempotencyKey: key, storageBucket: "skima-platform-media" }, UploadSessionSchema);
        const stored = await supabase.storage.from(upload.storageBucket).uploadToSignedUrl(upload.storagePath, upload.token, file, { contentType, upsert: true });
        if (stored.error) throw new Error(stored.error.message || `Could not upload ${file.name}.`);
        const registered = await api.post("/runtime/media/assets", {
          assetTypeKey: contentType.startsWith("video/") ? "media.video.product" : "media.image.product",
          byteSize: file.size, contentType, idempotencyKey: `${key}:asset`,
          metadata: { originalFileName: file.name }, ownerUserId: context.user.id,
          // The catalogue attachment row carries Store organisation scope;
          // the uploaded asset itself stays owner-scoped for platform admins.
          organizationId: null, source: "skima.admin.store",
          storageBucket: upload.storageBucket, storagePath: upload.storagePath,
        }, MediaAssetSchema);
        const assetId = typeof registered === "string" ? registered : catalogText(registered, "id");
        if (!assetId) throw new Error(`The media registry did not return an asset id for ${file.name}.`);
        await api.post("/runtime/catalog/media", {
          itemId, mediaAssetId: assetId,
          displayOrder: (media.data ?? []).filter((entry) => catalogText(entry, "item_id") === itemId).length + index,
          status: "active", idempotencyKey: `${key}:attach`,
          metadata: { mediaType: contentType.startsWith("video/") ? "video" : "image", originalFileName: file.name },
        }, StoreProductSchema);
        await api.post("/runtime/storefront/media/approve", {
          itemId,
          mediaAssetId: assetId,
        }, StoreProductSchema);
      }
      return result;
    },
    onSuccess: async () => {
      setProductEditorOpen(false); setEditingItem(null); setMediaFiles([]);
      setProductName(""); setDescription(""); setAmount(""); setCompareAtAmount(""); setStockQuantity("1"); setListingStatus("active");
      await refresh();
    },
  });

  const processOrderAction = useMutation({
    mutationFn: (input: { orderId: string; actionKey: string; reason?: string }) =>
      api.post("/runtime/orders/actions", {
        orderId: input.orderId,
        actionKey: input.actionKey,
        reason: input.reason,
        payload: { channel: "skima_store_admin" },
        metadata: { moduleKey: "store" },
        source: "platform.storefront",
        idempotencyKey: createClientIdempotencyKey("admin.store.order-action", input.orderId),
      }, StoreSettingsSchema),
    onSuccess: refresh,
  });
  const refundOrder = useMutation({
    mutationFn: (input: { orderId: string; reason: string }) => api.post("/runtime/storefront/orders/refund", {
      orderId: input.orderId, reason: input.reason,
      idempotencyKey: createClientIdempotencyKey("admin.store.order-refund", input.orderId),
    }, StoreSettingsSchema),
    onSuccess: refresh,
  });

  const openProductEditor = (item?: CatalogRecord) => {
    setEditingItem(item ?? null); setMediaFiles([]);
    if (item) {
      const itemId = catalogText(item, "id");
      const price = activePrices.find((entry) => catalogText(entry, "item_id") === itemId && !catalogText(entry, "variant_id"));
      const stock = (availability.data ?? []).find((entry) => catalogText(entry, "item_id") === itemId && !catalogText(entry, "variant_id") && catalogText(entry, "status") === "active");
      const productCategory = storeCategories.find((entry) => catalogText(entry, "id") === catalogText(item, "category_id"));
      setProductName(catalogLabel(item)); setDescription(catalogText(item, "description"));
      setCategoryName(catalogLabel(productCategory, "General")); setCategoryKey(catalogText(productCategory, "key") || "store.category.general");
      setAmount(price ? String(price.amount ?? "") : "");
      setCompareAtAmount(price && numberValue(price.compare_at_amount) > numberValue(price.amount) ? String(price.compare_at_amount) : "");
      setStockQuantity(stock && stock.stock_quantity !== null ? String(stock.stock_quantity) : "0");
      setListingStatus(catalogText(item, "status") === "active" ? "active" : "draft");
    } else {
      setProductName(""); setDescription(""); setCategoryName("General"); setCategoryKey("store.category.general");
      setAmount(""); setCompareAtAmount(""); setStockQuantity("1"); setListingStatus("active");
    }
    setProductEditorOpen(true);
  };

  const productColumns: TableColumn<CatalogRecord>[] = [
    { key: "product", header: "Product", render: (item) => <><strong>{catalogLabel(item)}</strong><br /><small>{catalogText(item, "key")}</small></> },
    { key: "category", header: "Category", render: (item) => storeCategories.find((entry) => catalogText(entry, "id") === catalogText(item, "category_id")) ? catalogLabel(storeCategories.find((entry) => catalogText(entry, "id") === catalogText(item, "category_id"))) : "Uncategorised" },
    { key: "price", header: "Selling price", render: (item) => {
      const price = activePrices.find((entry) => catalogText(entry, "item_id") === catalogText(item, "id") && !catalogText(entry, "variant_id"));
      return price ? <><strong>{formatMoney(numberValue(price.amount), catalogText(price, "currency_code") || "NGN")}</strong>{numberValue(price.compare_at_amount) > numberValue(price.amount) ? <small className="store-old-price">{formatMoney(numberValue(price.compare_at_amount), catalogText(price, "currency_code") || "NGN")}</small> : null}</> : "Price missing";
    } },
    { key: "stock", header: "Stock", render: (item) => {
      const stock = (availability.data ?? []).find((rule) => catalogText(rule, "item_id") === catalogText(item, "id") && !catalogText(rule, "variant_id") && catalogText(rule, "status") === "active");
      return stock ? `${stock.stock_quantity ?? "Unlimited"} ${catalogText(stock, "availability_status") === "out_of_stock" ? "· Out of stock" : ""}` : "Not configured";
    } },
    { key: "media", header: "Media", render: (item) => {
      const count = (media.data ?? []).filter((entry) => catalogText(entry, "item_id") === catalogText(item, "id") && catalogText(entry, "status") === "active").length;
      return count ? `${count} photo/video file${count === 1 ? "" : "s"}` : "No media";
    } },
    { key: "status", header: "Status", render: (item) => <StatusBadge tone={catalogText(item, "status") === "active" ? "success" : "warning"}>{normalizeStatusLabel(catalogText(item, "status") || "unknown")}</StatusBadge> },
    { key: "edit", header: "Manage", render: (item) => <Button size="sm" variant="outline" onClick={() => openProductEditor(item)}>Edit</Button> },
  ];

  const orderColumns: TableColumn<CatalogRecord>[] = [
    { key: "order", header: "Order", render: (order) => <><strong>{catalogText(order, "id").slice(0, 8).toUpperCase()}</strong><br /><small>{new Date(String(order.created_at ?? "")).toLocaleString()}</small></> },
    { key: "customer", header: "Customer", render: (order) => catalogText(order, "requester_user_id") || "Customer" },
    { key: "total", header: "Total", render: (order) => formatMoney(numberValue(order.total_amount), catalogText(order, "currency_code") || "NGN") },
    { key: "status", header: "Status", render: (order) => <StatusBadge tone={["completed", "fulfilled"].includes(catalogText(order, "status")) ? "success" : "warning"}>{normalizeStatusLabel(catalogText(order, "status") || "received")}</StatusBadge> },
    { key: "action", header: "Next action", render: (order) => {
      const nextAction = storeOrderNextAction(catalogText(order, "status"));
      const orderId = catalogText(order, "id");
      const orderMetadata = order.metadata && typeof order.metadata === "object" ? order.metadata as Record<string, unknown> : {};
      const refunded = typeof orderMetadata.store_refunded_at === "string";
      return nextAction ? (
        <div className="store-workspace__order-actions">
          <Button
            size="sm"
            isLoading={processOrderAction.isPending}
            disabled={!orderId}
            onClick={() => processOrderAction.mutate({ orderId, actionKey: nextAction.key })}
          >{nextAction.label}</Button>
          {nextAction.canCancel ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={processOrderAction.isPending || !orderId}
              onClick={() => processOrderAction.mutate({
                orderId,
                actionKey: "store.order.cancel",
                reason: "Store cannot fulfil the customer's delivery location.",
              })}
            >Cancel</Button>
          ) : null}
        </div>
      ) : catalogText(order, "status") === "cancelled" && !refunded ? (
        <Button size="sm" variant="outline" disabled={refundOrder.isPending || !orderId} onClick={() => refundOrder.mutate({ orderId, reason: "Store cannot fulfil the customer's delivery location." })}>Refund wallet</Button>
      ) : refunded ? <StatusBadge tone="success">Refunded</StatusBadge> : "—";
    } },
  ];

  const queries = [organizations, modules, settings, items, categories, prices, availability, media, orders];
  const loading = queries.some((query) => query.isLoading);
  const error = queries.find((query) => query.error)?.error;

  if (loading) return <LoadingState label="Loading SKIMA Store" />;
  if (error) return <ErrorState title="Store workspace unavailable" message={catalogError(error)} onRetry={() => void refresh()} />;

  return (
    <div className="store-workspace">
      <AdminV2PageHeader
        eyebrow="Commerce · SKIMA Store"
        title="Store"
        description="Manage SKIMA's direct product shop independently of LPG refill and fuel operations. Products use the shared catalogue, configured prices and stock rules."
        actions={<><Button icon={RefreshCcw} variant="outline" onClick={() => void refresh()}>Refresh</Button><Button icon={Boxes} variant="outline" onClick={() => props.onNavigate("/services/catalog")}>Full catalogue</Button><Button icon={PackagePlus} disabled={!savedSettings || savedSettings.status !== "active"} onClick={() => openProductEditor()}>Add product</Button></>}
      />

      <section className="skima-grid skima-grid--compact">
        <MetricTile label="Store products" value={storeItems.length} icon={ShoppingBag} />
        <MetricTile label="Published" value={activeItems.length} icon={PackagePlus} tone="success" />
        <MetricTile label="Priced products" value={new Set(activePrices.map((price) => catalogText(price, "item_id"))).size} icon={BadgeDollarSign} />
        <MetricTile label="Available stock records" value={availableProducts} icon={Truck} tone="info" />
      </section>

      <section className="sk-panel store-workspace__settings">
        <div className="store-workspace__settings-copy">
          <div className="store-workspace__settings-icon"><ShoppingBag size={20} /></div>
          <div>
            <strong>Store operating setup</strong>
            <p>{savedSettings ? `${catalogLabel(savedOrganization, "Operating organisation")} · ${catalogText(savedSettings, "currency_code")} · ${catalogText(savedSettings, "fulfillment_method")}` : "Choose which SKIMA organisation owns the Store catalogue and checkout."}</p>
            <small>{savedSettings?.status === "active" ? "Storefront is active" : savedSettings ? "Storefront is paused" : "Not configured"}</small>
          </div>
        </div>
        <Button icon={Settings2} variant="outline" onClick={() => {
          setOrganizationId(savedOrganizationId || catalogText(organizations.data?.find((entry) => catalogText(entry, "slug") === "skima-store") ?? null, "id") || "");
          setCurrencyCode(catalogText(savedSettings, "currency_code") || "NGN");
          setFulfillmentMethod(catalogText(savedSettings, "fulfillment_method") || "delivery");
          setDeliveryOriginLabel(catalogText(savedSettings, "delivery_origin_label") || "SKIMA Store");
          setDeliveryOriginAddress(catalogText(savedSettings, "delivery_origin_formatted_address"));
          setDeliveryBaseFeeAmount(catalogText(savedSettings, "delivery_base_fee_amount") || "0");
          setFreeDeliveryMinimumAmount(catalogText(savedSettings, "free_delivery_minimum_amount"));
          setMinimumOrderAmount(catalogText(savedSettings, "minimum_order_amount") || "0");
          setPickupLocationLabel(catalogText(savedSettings, "pickup_location_label") || "SKIMA Store pickup");
          setPickupFormattedAddress(catalogText(savedSettings, "pickup_formatted_address"));
          setPickupInstructions(catalogText(savedSettings, "pickup_instructions"));
          setSettingsEditorOpen(true);
        }}>{savedSettings ? "Edit setup" : "Configure Store"}</Button>
      </section>

      {!savedSettings ? (
        <section className="admin-notice"><strong>Configure the Store before publishing products</strong><p>The Store has its own operating organisation, currency and default fulfillment method. This does not change LPG, PMS, kerosene or diesel configuration.</p></section>
      ) : (
        <>
          <section className="store-workspace__section">
            <AdminV2PageHeader eyebrow="Store catalogue" title="Products" description="Create SKIMA Store listings with a selling price, optional crossed-out price and stock quantity. The customer Store only shows active, orderable products." />
            <div className="sk-panel"><DataTable caption="SKIMA Store products" columns={productColumns} records={storeItems} getRowKey={(item) => catalogText(item, "id")} emptyTitle="No Store products yet" emptyMessage="Add a cylinder or any other product SKIMA wants to sell." /></div>
          </section>
          <section className="store-workspace__section">
            <AdminV2PageHeader eyebrow="Store operations" title="Recent Store orders" description="Customer orders submitted from the Store are recorded by the shared order engine and linked to the Store module." />
            {processOrderAction.error ? <StatusBadge tone="danger">{catalogError(processOrderAction.error)}</StatusBadge> : null}
            {refundOrder.error ? <StatusBadge tone="danger">{catalogError(refundOrder.error)}</StatusBadge> : null}
            <div className="sk-panel"><DataTable caption="Store orders" columns={orderColumns} records={storeOrders.slice(0, 20)} getRowKey={(item) => catalogText(item, "id")} emptyTitle="No Store orders yet" emptyMessage="Customer Store orders will appear here after the first checkout request." /></div>
          </section>
        </>
      )}

      <Dialog isOpen={settingsEditorOpen} title="Store operating setup" onClose={() => setSettingsEditorOpen(false)} footer={<><Button variant="ghost" onClick={() => setSettingsEditorOpen(false)}>Cancel</Button><Button isLoading={saveSettings.isPending} disabled={!organizationId} onClick={() => saveSettings.mutate()}>Save and activate Store</Button></>}>
        <div className="admin-notice"><strong>First-party SKIMA Store</strong><p>The dedicated SKIMA Store organisation is preconfigured. Choose another organisation only when it has an active merchant profile; the shared order engine requires this before it can accept Store orders.</p></div>
        <div className="skima-form-grid">
          <SelectInput label="Operating organisation" value={organizationId} onChange={(event) => setOrganizationId(event.currentTarget.value)} options={organizationOptions(organizations.data ?? [])} />
          <SelectInput label="Store currency" value={currencyCode} onChange={(event) => setCurrencyCode(event.currentTarget.value)} options={[{ label: "Nigerian naira (NGN)", value: "NGN" }, { label: "USDC", value: "USDC" }]} />
          <SelectInput label="Default fulfillment" value={fulfillmentMethod} onChange={(event) => setFulfillmentMethod(event.currentTarget.value)} options={[{ label: "Delivery", value: "delivery" }, { label: "Customer pickup", value: "pickup" }]} />
          <div className="admin-notice"><strong>Nationwide delivery</strong><p>Customers may place Store orders from any address in Nigeria. SKIMA charges one flat delivery fee here, then Store operations reviews whether the destination can be served. Unserviceable orders can be cancelled and refunded from the Store orders list.</p></div>
          <TextInput label="Dispatch / warehouse name" value={deliveryOriginLabel} onChange={(event) => setDeliveryOriginLabel(event.currentTarget.value)} placeholder="SKIMA Store" />
          <TextInput label="Dispatch address or service area" value={deliveryOriginAddress} onChange={(event) => setDeliveryOriginAddress(event.currentTarget.value)} placeholder="Formatted address, town/city and state" />
          <div className="skima-form-grid">
            <TextInput label={`Flat delivery fee (${currencyCode})`} type="number" value={deliveryBaseFeeAmount} onChange={(event) => setDeliveryBaseFeeAmount(event.currentTarget.value)} />
            <TextInput label={`Free delivery from (${currencyCode}, optional)`} type="number" value={freeDeliveryMinimumAmount} onChange={(event) => setFreeDeliveryMinimumAmount(event.currentTarget.value)} />
          </div>
          <TextInput label={`Minimum order amount (${currencyCode})`} type="number" value={minimumOrderAmount} onChange={(event) => setMinimumOrderAmount(event.currentTarget.value)} />
          <div className="admin-notice"><strong>Customer pickup</strong><p>Customers choosing pickup will see this location instead of a delivery address.</p></div>
          <TextInput label="Pickup point name" value={pickupLocationLabel} onChange={(event) => setPickupLocationLabel(event.currentTarget.value)} placeholder="SKIMA Store pickup" />
          <TextInput label="Pickup address" value={pickupFormattedAddress} onChange={(event) => setPickupFormattedAddress(event.currentTarget.value)} placeholder="Defaults to the dispatch address" />
          <TextAreaInput label="Pickup instructions (optional)" value={pickupInstructions} onChange={(event) => setPickupInstructions(event.currentTarget.value)} placeholder="Opening hours, entrance, collection instructions..." />
          {saveSettings.error ? <StatusBadge tone="danger">{catalogError(saveSettings.error)}</StatusBadge> : null}
        </div>
      </Dialog>

      <Dialog isOpen={productEditorOpen} title={editingItem ? "Edit Store listing" : "Add Store product"} onClose={() => { setProductEditorOpen(false); setEditingItem(null); setMediaFiles([]); }} footer={<><Button variant="ghost" onClick={() => { setProductEditorOpen(false); setEditingItem(null); setMediaFiles([]); }}>Cancel</Button><Button isLoading={createProduct.isPending} disabled={!productName.trim() || !amount.trim()} onClick={() => createProduct.mutate()}>{editingItem ? "Save listing changes" : "Create product"}</Button></>}>
        <div className="skima-form-grid">
          <TextInput label="Product name" value={productName} onChange={(event) => setProductName(event.currentTarget.value)} placeholder="e.g. 12.5kg LPG cylinder" />
          <TextAreaInput label="Description" value={description} onChange={(event) => setDescription(event.currentTarget.value)} placeholder="Tell customers what they are buying." />
          <TextInput label="Category name" value={categoryName} onChange={(event) => { setCategoryName(event.currentTarget.value); setCategoryKey(`store.category.${catalogSlug(event.currentTarget.value) || "general"}`); }} placeholder="General" />
          <div className="store-workspace__price-grid">
            <TextInput label={`Selling price (${currencyCode})`} type="number" value={amount} onChange={(event) => setAmount(event.currentTarget.value)} placeholder="0.00" />
            <TextInput label="Compare-at price (optional)" type="number" value={compareAtAmount} onChange={(event) => setCompareAtAmount(event.currentTarget.value)} placeholder="Original price" />
          </div>
          <TextInput label="Available stock quantity" type="number" value={stockQuantity} onChange={(event) => setStockQuantity(event.currentTarget.value)} helperText="Set 0 to list the product as out of stock. Already-reserved stock cannot be removed." />
          <SelectInput label="Listing status" value={listingStatus} onChange={(event) => setListingStatus(event.currentTarget.value)} options={[{ label: "Published", value: "active" }, { label: "Draft / hidden", value: "draft" }]} />
          {editingItem ? <div className="admin-notice"><strong>Existing product media</strong><p>{(media.data ?? []).filter((entry) => catalogText(entry, "item_id") === catalogText(editingItem, "id") && catalogText(entry, "status") === "active").length} photo/video files are currently attached. New uploads are added to the gallery; existing media remains available.</p></div> : null}
          <div className="skima-form-field">
            <label htmlFor="store-product-media">Product photos and videos</label>
            <input id="store-product-media" type="file" accept="image/*,video/*" multiple onChange={(event: ChangeEvent<HTMLInputElement>) => setMediaFiles(Array.from(event.currentTarget.files ?? []))} />
            <small>Choose multiple photos and videos. Up to 50 MB per file. The first photo is used as the product cover.</small>
            {mediaFiles.length ? <small>{mediaFiles.map((file) => file.name).join(" · ")}</small> : null}
          </div>
          <div className="store-workspace__pricing-hint"><Tag size={16} /><span>The crossed-out price is shown as an offer only when it is higher than the current selling price.</span></div>
          {createProduct.error ? <StatusBadge tone="danger">{catalogError(createProduct.error)}</StatusBadge> : null}
        </div>
      </Dialog>
    </div>
  );
}


function storeOrderNextAction(status: string): { key: string; label: string; canCancel: boolean } | null {
  switch (status) {
    case "received": return { key: "store.order.accept", label: "Accept order", canCancel: true };
    case "accepted": return { key: "store.order.prepare", label: "Start preparation", canCancel: true };
    case "preparing": return { key: "store.order.ready", label: "Mark ready", canCancel: true };
    case "ready_for_pickup": return { key: "store.order.fulfill", label: "Confirm fulfilment", canCancel: true };
    case "fulfilled": return { key: "store.order.complete", label: "Complete order", canCancel: false };
    default: return null;
  }
}

function organizationOptions(records: readonly CatalogRecord[]) {
  return [
    { label: "Choose operating organisation", value: "" },
    ...records
      .filter((record) => catalogText(record, "status") === "active")
      .map((record) => ({ label: catalogLabel(record), value: catalogText(record, "id") }))
      .filter((option) => option.value),
  ];
}

function numberValue(value: unknown) {
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
}
