import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeDollarSign, Boxes, PackagePlus, RefreshCcw, ShoppingBag, Tag, Truck } from "lucide-react";
import { useMemo, useState } from "react";
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
import { AdminFormSection, AdminV2PageHeader } from "../../shared/patterns/AdminV2Patterns";
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

export function StoreWorkspace(props: { readonly onNavigate: (href: string) => void }) {
  const { api, status } = useSessionState();
  const client = useQueryClient();
  const [settingsEditorOpen, setSettingsEditorOpen] = useState(false);
  const [productEditorOpen, setProductEditorOpen] = useState(false);
  const [organizationId, setOrganizationId] = useState("");
  const [currencyCode, setCurrencyCode] = useState("NGN");
  const [fulfillmentMethod, setFulfillmentMethod] = useState("delivery");
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
    mutationFn: () => api.post("/runtime/storefront/settings", {
      organizationId,
      branchId: null,
      currencyCode,
      fulfillmentMethod,
      fulfillmentMethods: ["delivery", "pickup"],
      status: "active",
      idempotencyKey: createClientIdempotencyKey("admin.storefront.settings"),
      metadata: { configuredFrom: "admin.store" },
    }, StoreSettingsSchema),
    onSuccess: async () => {
      setSettingsEditorOpen(false);
      await refresh();
    },
  });

  const createProduct = useMutation({
    mutationFn: () => {
      const parsedAmount = Number(amount);
      const parsedCompareAt = compareAtAmount.trim() ? Number(compareAtAmount) : null;
      const parsedStock = Number(stockQuantity);
      if (!productName.trim()) throw new Error("Enter a product name.");
      if (!Number.isFinite(parsedAmount) || parsedAmount < 0) throw new Error("Enter a valid selling price.");
      if (parsedCompareAt !== null && (!Number.isFinite(parsedCompareAt) || parsedCompareAt <= parsedAmount)) {
        throw new Error("The crossed-out price must be greater than the selling price.");
      }
      if (!Number.isFinite(parsedStock) || parsedStock < 0) throw new Error("Enter a valid stock quantity.");
      const slug = catalogSlug(productName);
      return api.post("/runtime/storefront/products", {
        displayName: productName.trim(),
        description: description.trim(),
        categoryKey: catalogSlug(categoryKey) ? categoryKey : "store.category.general",
        categoryName: categoryName.trim() || "General",
        itemKey: `store.item.${slug}.${Date.now()}`,
        amount: parsedAmount,
        compareAtAmount: parsedCompareAt,
        stockQuantity: parsedStock,
        status: "active",
        idempotencyKey: createClientIdempotencyKey("admin.storefront.product"),
        metadata: { productOrigin: "skima_store_admin" },
      }, StoreProductSchema);
    },
    onSuccess: async () => {
      setProductEditorOpen(false);
      setProductName("");
      setDescription("");
      setAmount("");
      setCompareAtAmount("");
      setStockQuantity("1");
      await refresh();
    },
  });

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
    { key: "status", header: "Status", render: (item) => <StatusBadge tone={catalogText(item, "status") === "active" ? "success" : "warning"}>{normalizeStatusLabel(catalogText(item, "status") || "unknown")}</StatusBadge> },
  ];

  const orderColumns: TableColumn<CatalogRecord>[] = [
    { key: "order", header: "Order", render: (order) => <><strong>{catalogText(order, "id").slice(0, 8).toUpperCase()}</strong><br /><small>{new Date(String(order.created_at ?? "")).toLocaleString()}</small></> },
    { key: "customer", header: "Customer", render: (order) => catalogText(order, "requester_user_id") || "Customer" },
    { key: "total", header: "Total", render: (order) => formatMoney(numberValue(order.total_amount), catalogText(order, "currency_code") || "NGN") },
    { key: "status", header: "Status", render: (order) => <StatusBadge tone={catalogText(order, "status") === "completed" ? "success" : "warning"}>{normalizeStatusLabel(catalogText(order, "status") || "received")}</StatusBadge> },
  ];

  const queries = [organizations, modules, settings, items, categories, prices, availability, orders];
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
        actions={<><Button icon={RefreshCcw} variant="outline" onClick={() => void refresh()}>Refresh</Button><Button icon={Boxes} variant="outline" onClick={() => props.onNavigate("/services/catalog")}>Full catalogue</Button><Button icon={PackagePlus} disabled={!savedSettings || savedSettings.status !== "active"} onClick={() => setProductEditorOpen(true)}>Add product</Button></>}
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
        <Button icon={Settings2} variant="outline" onClick={() => { setOrganizationId(savedOrganizationId); setCurrencyCode(catalogText(savedSettings, "currency_code") || "NGN"); setFulfillmentMethod(catalogText(savedSettings, "fulfillment_method") || "delivery"); setSettingsEditorOpen(true); }}>{savedSettings ? "Edit setup" : "Configure Store"}</Button>
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
            <div className="sk-panel"><DataTable caption="Store orders" columns={orderColumns} records={storeOrders.slice(0, 20)} getRowKey={(item) => catalogText(item, "id")} emptyTitle="No Store orders yet" emptyMessage="Customer Store orders will appear here after the first checkout request." /></div>
          </section>
        </>
      )}

      <Dialog isOpen={settingsEditorOpen} title="Store operating setup" onClose={() => setSettingsEditorOpen(false)} footer={<><Button variant="ghost" onClick={() => setSettingsEditorOpen(false)}>Cancel</Button><Button isLoading={saveSettings.isPending} disabled={!organizationId} onClick={() => saveSettings.mutate()}>Save and activate Store</Button></>}>
        <div className="skima-form-grid">
          <SelectInput label="Operating organisation" value={organizationId} onChange={(event) => setOrganizationId(event.currentTarget.value)} options={organizationOptions(organizations.data ?? [])} />
          <SelectInput label="Store currency" value={currencyCode} onChange={(event) => setCurrencyCode(event.currentTarget.value)} options={[{ label: "Nigerian naira (NGN)", value: "NGN" }, { label: "USDC", value: "USDC" }]} />
          <SelectInput label="Default fulfillment" value={fulfillmentMethod} onChange={(event) => setFulfillmentMethod(event.currentTarget.value)} options={[{ label: "Delivery", value: "delivery" }, { label: "Customer pickup", value: "pickup" }]} />
          {saveSettings.error ? <StatusBadge tone="danger">{catalogError(saveSettings.error)}</StatusBadge> : null}
        </div>
      </Dialog>

      <Dialog isOpen={productEditorOpen} title="Add Store product" onClose={() => setProductEditorOpen(false)} footer={<><Button variant="ghost" onClick={() => setProductEditorOpen(false)}>Cancel</Button><Button isLoading={createProduct.isPending} disabled={!productName.trim() || !amount.trim()} onClick={() => createProduct.mutate()}>Create and publish product</Button></>}>
        <div className="skima-form-grid">
          <TextInput label="Product name" value={productName} onChange={(event) => setProductName(event.currentTarget.value)} placeholder="e.g. 12.5kg LPG cylinder" />
          <TextAreaInput label="Description" value={description} onChange={(event) => setDescription(event.currentTarget.value)} placeholder="Tell customers what they are buying." />
          <TextInput label="Category name" value={categoryName} onChange={(event) => { setCategoryName(event.currentTarget.value); setCategoryKey(`store.category.${catalogSlug(event.currentTarget.value) || "general"}`); }} placeholder="General" />
          <div className="store-workspace__price-grid">
            <TextInput label={`Selling price (${currencyCode})`} type="number" value={amount} onChange={(event) => setAmount(event.currentTarget.value)} placeholder="0.00" />
            <TextInput label="Compare-at price (optional)" type="number" value={compareAtAmount} onChange={(event) => setCompareAtAmount(event.currentTarget.value)} placeholder="Original price" />
          </div>
          <TextInput label="Available stock quantity" type="number" value={stockQuantity} onChange={(event) => setStockQuantity(event.currentTarget.value)} helperText="Set 0 to list the product as out of stock." />
          <div className="store-workspace__pricing-hint"><Tag size={16} /><span>The crossed-out price is shown as an offer only when it is higher than the current selling price.</span></div>
          {createProduct.error ? <StatusBadge tone="danger">{catalogError(createProduct.error)}</StatusBadge> : null}
        </div>
      </Dialog>
    </div>
  );
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
