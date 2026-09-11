import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeDollarSign, Boxes, Layers3, PackagePlus, Plus, RefreshCcw, Settings2, Tags } from "lucide-react";
import { useMemo, useState } from "react";

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

import { AdminResourceConsole } from "../../admin-resource-console";
import { useSessionState } from "../../session";
import { AdminFormSection, AdminTaskFlow, AdminV2PageHeader, type AdminTaskFlowStep } from "../../shared/patterns/AdminV2Patterns";
import { serviceCatalogConfig } from "./services-resource-configs";
import {
  CatalogMutationSchema,
  CatalogRecordArraySchema,
  catalogError,
  catalogFriendly,
  catalogLabel,
  catalogList,
  catalogOptionalIso,
  catalogOptionalNumber,
  catalogOptions,
  catalogSlug,
  catalogText,
  type CatalogRecord,
} from "./service-catalog-v2-shared";
import "./service-catalog-v2.css";

const BASE = "/services/catalog";

type EditorKind = "category" | "item" | "variant" | "price";

const nav = [
  { key: "overview", label: "Overview", href: BASE, icon: Boxes },
  { key: "categories", label: "Categories", href: `${BASE}/categories`, icon: Layers3 },
  { key: "items", label: "Services & items", href: `${BASE}/items`, icon: PackagePlus },
  { key: "variants", label: "Variants", href: `${BASE}/variants`, icon: Tags },
  { key: "pricing", label: "Pricing", href: `${BASE}/pricing`, icon: BadgeDollarSign },
] as const;

export function ServiceCatalogWorkspaceV2(props: {
  route: string;
  onNavigate: (href: string) => void;
}) {
  const { api, status } = useSessionState();
  const client = useQueryClient();
  const [editor, setEditor] = useState<EditorKind | null>(null);

  const organizations = useCatalogQuery("organizations", "/admin/organizations");
  const modules = useCatalogQuery("modules", "/modules");
  const branches = useCatalogQuery("branches", "/runtime/organization-branches");
  const units = useCatalogQuery("units", "/runtime/catalog/units");
  const categories = useCatalogQuery("categories", "/runtime/catalog/categories");
  const items = useCatalogQuery("items", "/runtime/catalog/items");
  const variants = useCatalogQuery("variants", "/runtime/catalog/variants");
  const prices = useCatalogQuery("prices", "/runtime/catalog/prices");

  if (props.route === `${BASE}/advanced`) {
    return (
      <div className="catalog-v2">
        <CatalogNav route={props.route} onNavigate={props.onNavigate} />
        <section className="admin-notice"><strong>Advanced catalog administration</strong><p>Use this compatibility console for units, raw metadata, media attachment and uncommon technical fields. Normal catalog work should use the focused V2 screens.</p></section>
        <AdminResourceConsole config={serviceCatalogConfig} />
      </div>
    );
  }

  const queries = [organizations, modules, branches, units, categories, items, variants, prices];
  const loading = queries.some((query) => query.isLoading);
  const error = queries.find((query) => query.error)?.error;
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ["service-catalog-v2"] });
    await Promise.all(queries.map((query) => query.refetch()));
  };

  if (loading) return <LoadingState label="Loading service catalog" />;
  if (error) return <ErrorState title="Service catalog unavailable" message={catalogError(error)} onRetry={() => void refresh()} />;

  const data = {
    organizations: organizations.data ?? [],
    modules: modules.data ?? [],
    branches: branches.data ?? [],
    units: units.data ?? [],
    categories: categories.data ?? [],
    items: items.data ?? [],
    variants: variants.data ?? [],
    prices: prices.data ?? [],
  };

  const activeRoute = nav.some((item) => item.href === props.route) ? props.route : BASE;
  const addKind: EditorKind | null = activeRoute === `${BASE}/categories`
    ? "category"
    : activeRoute === `${BASE}/items`
      ? "item"
      : activeRoute === `${BASE}/variants`
        ? "variant"
        : activeRoute === `${BASE}/pricing`
          ? "price"
          : null;

  const screen = activeRoute === `${BASE}/categories`
    ? <CategoryScreen data={data} onAdd={() => setEditor("category")} />
    : activeRoute === `${BASE}/items`
      ? <ItemScreen data={data} onAdd={() => setEditor("item")} />
      : activeRoute === `${BASE}/variants`
        ? <VariantScreen data={data} onAdd={() => setEditor("variant")} />
        : activeRoute === `${BASE}/pricing`
          ? <PricingScreen data={data} onAdd={() => setEditor("price")} />
          : <CatalogOverview data={data} onNavigate={props.onNavigate} onRefresh={refresh} />;

  return (
    <div className="catalog-v2">
      {activeRoute !== BASE ? <CatalogNav route={activeRoute} onNavigate={props.onNavigate} /> : null}
      {screen}
      <CatalogEditor
        kind={editor}
        data={data}
        api={api}
        onClose={() => setEditor(null)}
        onSaved={async () => { setEditor(null); await refresh(); }}
      />
      {addKind ? null : null}
    </div>
  );
}

function CatalogOverview(props: { data: CatalogData; onNavigate: (href: string) => void; onRefresh: () => Promise<void> }) {
  const activeItems = props.data.items.filter((item) => catalogText(item, "status") === "active").length;
  const activePrices = props.data.prices.filter((price) => catalogText(price, "status") === "active").length;
  return (
    <div className="catalog-v2__screen">
      <AdminV2PageHeader
        eyebrow="Services · Catalog"
        title="Service catalog"
        description="Define what SKIMA offers through focused category, item, variant and pricing screens. Technical IDs, units and media attachment stay out of the everyday workflow."
        actions={<><Button icon={RefreshCcw} variant="outline" onClick={() => void props.onRefresh()}>Refresh</Button><Button icon={Settings2} variant="outline" onClick={() => props.onNavigate(`${BASE}/advanced`)}>Advanced</Button></>}
      />
      <section className="skima-grid skima-grid--compact">
        <MetricTile label="Categories" value={props.data.categories.length} icon={Layers3} />
        <MetricTile label="Active services & items" value={activeItems} icon={PackagePlus} tone="success" />
        <MetricTile label="Variants" value={props.data.variants.length} icon={Tags} tone="info" />
        <MetricTile label="Active prices" value={activePrices} icon={BadgeDollarSign} tone={activePrices ? "success" : "warning"} />
      </section>
      <section className="catalog-v2__task-grid">
        {nav.slice(1).map((task) => {
          const Icon = task.icon;
          const descriptions: Record<string, string> = {
            categories: "Organize services into readable customer-facing groups.",
            items: "Create the actual services or products SKIMA can quote and fulfill.",
            variants: "Define sizes, packages or other selectable versions of an item.",
            pricing: "Set customer prices without mixing pricing into availability or stock.",
          };
          return <button className="catalog-v2__task" key={task.key} type="button" onClick={() => props.onNavigate(task.href)}><span><Icon aria-hidden="true" /></span><span><strong>{task.label}</strong><small>{descriptions[task.key]}</small></span></button>;
        })}
      </section>
    </div>
  );
}

function CategoryScreen(props: { data: CatalogData; onAdd: () => void }) {
  const columns: TableColumn<CatalogRecord>[] = [
    { key: "name", header: "Category", render: (item) => <strong>{catalogLabel(item)}</strong> },
    { key: "description", header: "Description", render: (item) => catalogText(item, "description") || "No description" },
    { key: "status", header: "Status", render: (item) => <StatusBadge tone={statusTone(catalogText(item, "status"))}>{normalizeStatusLabel(catalogText(item, "status") || "unknown")}</StatusBadge> },
  ];
  return <CatalogListHeader eyebrow="Services · Catalog · Categories" title="Categories" description="Keep customer-facing groups understandable. Internal keys are generated from the category name unless an advanced override is needed." actionLabel="Add category" onAdd={props.onAdd}><DataTable caption="Service categories" columns={columns} records={props.data.categories} getRowKey={(item) => catalogText(item, "id") || catalogText(item, "key")} emptyTitle="No categories yet" emptyMessage="Add a category before organizing services." /></CatalogListHeader>;
}

function ItemScreen(props: { data: CatalogData; onAdd: () => void }) {
  const categoryNames = new Map(props.data.categories.map((category) => [catalogText(category, "key"), catalogLabel(category)]));
  const columns: TableColumn<CatalogRecord>[] = [
    { key: "name", header: "Service or item", render: (item) => <><strong>{catalogLabel(item)}</strong><br /><small>{catalogFriendly(catalogText(item, "item_type") || "service")}</small></> },
    { key: "category", header: "Category", render: (item) => categoryNames.get(catalogText(item, "category_key")) ?? "Uncategorized" },
    { key: "status", header: "Status", render: (item) => <StatusBadge tone={statusTone(catalogText(item, "status"))}>{normalizeStatusLabel(catalogText(item, "status") || "unknown")}</StatusBadge> },
  ];
  return <CatalogListHeader eyebrow="Services · Catalog · Items" title="Services & items" description="Create reusable catalog items using company, category and location selectors rather than database references." actionLabel="Add service or item" onAdd={props.onAdd}><DataTable caption="Services and items" columns={columns} records={props.data.items} getRowKey={(item) => catalogText(item, "id") || catalogText(item, "key")} emptyTitle="No catalog items" emptyMessage="Create the first service or product item." /></CatalogListHeader>;
}

function VariantScreen(props: { data: CatalogData; onAdd: () => void }) {
  const itemNames = new Map(props.data.items.map((item) => [catalogText(item, "id"), catalogLabel(item)]));
  const columns: TableColumn<CatalogRecord>[] = [
    { key: "name", header: "Variant", render: (item) => <strong>{catalogLabel(item)}</strong> },
    { key: "item", header: "Service or item", render: (item) => itemNames.get(catalogText(item, "item_id")) ?? "Item unavailable" },
    { key: "status", header: "Status", render: (item) => <StatusBadge tone={statusTone(catalogText(item, "status"))}>{normalizeStatusLabel(catalogText(item, "status") || "unknown")}</StatusBadge> },
  ];
  return <CatalogListHeader eyebrow="Services · Catalog · Variants" title="Variants" description="Define selectable versions such as package size or quantity without exposing the item ID." actionLabel="Add variant" onAdd={props.onAdd}><DataTable caption="Catalog variants" columns={columns} records={props.data.variants} getRowKey={(item) => catalogText(item, "id") || catalogText(item, "key")} emptyTitle="No variants" emptyMessage="Variants are optional; add one when an item needs multiple selectable versions." /></CatalogListHeader>;
}

function PricingScreen(props: { data: CatalogData; onAdd: () => void }) {
  const itemNames = new Map(props.data.items.map((item) => [catalogText(item, "id"), catalogLabel(item)]));
  const columns: TableColumn<CatalogRecord>[] = [
    { key: "item", header: "Service or item", render: (price) => itemNames.get(catalogText(price, "item_id")) ?? "Item unavailable" },
    { key: "amount", header: "Price", render: (price) => formatMoney(Number(price.amount ?? 0), catalogText(price, "currency_code") || "NGN") },
    { key: "status", header: "Status", render: (price) => <StatusBadge tone={statusTone(catalogText(price, "status"))}>{normalizeStatusLabel(catalogText(price, "status") || "unknown")}</StatusBadge> },
  ];
  return <CatalogListHeader eyebrow="Services · Catalog · Pricing" title="Pricing" description="Set item or variant prices as a separate job. Availability and capacity stay in their own workspace." actionLabel="Set price" onAdd={props.onAdd}><DataTable caption="Catalog prices" columns={columns} records={props.data.prices} getRowKey={(item) => catalogText(item, "id") || JSON.stringify(item)} emptyTitle="No prices yet" emptyMessage="Add a price before exposing an item for ordering." /></CatalogListHeader>;
}

function CatalogListHeader(props: { eyebrow: string; title: string; description: string; actionLabel: string; onAdd: () => void; children: React.ReactNode }) {
  return <div className="catalog-v2__screen"><AdminV2PageHeader eyebrow={props.eyebrow} title={props.title} description={props.description} actions={<Button icon={Plus} onClick={props.onAdd}>{props.actionLabel}</Button>} /><section className="sk-panel">{props.children}</section></div>;
}

const itemSteps: readonly AdminTaskFlowStep[] = [
  { key: "scope", label: "Company & category", description: "Choose where it belongs" },
  { key: "details", label: "Details", description: "Name and customer description" },
  { key: "fulfillment", label: "Fulfillment", description: "Quantity and fulfillment rules" },
  { key: "review", label: "Review", description: "Status and save" },
];

function CatalogEditor(props: {
  kind: EditorKind | null;
  data: CatalogData;
  api: ReturnType<typeof useSessionState>["api"];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  if (!props.kind) return null;
  if (props.kind === "item") return <ItemEditor {...props} />;
  if (props.kind === "category") return <CategoryEditor {...props} />;
  if (props.kind === "variant") return <VariantEditor {...props} />;
  return <PriceEditor {...props} />;
}

function CategoryEditor(props: EditorProps) {
  const [organizationId, setOrganizationId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [moduleKey, setModuleKey] = useState("");
  const [parentKey, setParentKey] = useState("");
  const [keyOverride, setKeyOverride] = useState("");
  const [status, setStatus] = useState("active");
  const save = useMutation({ mutationFn: () => props.api.post("/runtime/catalog/categories", { organizationId, categoryKey: keyOverride.trim() || `catalog.category.${catalogSlug(name)}`, displayName: name.trim(), moduleKey: moduleKey || undefined, parentKey: parentKey || undefined, categoryType: "product", description: description.trim() || undefined, status, metadata: {}, idempotencyKey: createClientIdempotencyKey("admin.catalog-v2.category") }, CatalogMutationSchema), onSuccess: props.onSaved });
  return <Dialog isOpen title="Add category" onClose={props.onClose} footer={<><Button variant="ghost" onClick={props.onClose}>Cancel</Button><Button isLoading={save.isPending} disabled={!organizationId || !name.trim()} onClick={() => save.mutate()}>Save category</Button></>}><div className="skima-form-grid"><SelectInput label="Company" value={organizationId} onChange={(event) => setOrganizationId(event.currentTarget.value)} options={catalogOptions(props.data.organizations, "id", "Choose company")} /><TextInput label="Category name" value={name} onChange={(event) => setName(event.currentTarget.value)} /><TextAreaInput label="Description" value={description} onChange={(event) => setDescription(event.currentTarget.value)} /><SelectInput label="Status" value={status} onChange={(event) => setStatus(event.currentTarget.value)} options={statusOptions()} /><details className="catalog-v2__advanced"><summary>Advanced structure</summary><div className="skima-form-grid"><SelectInput label="Business line" value={moduleKey} onChange={(event) => setModuleKey(event.currentTarget.value)} options={catalogOptions(props.data.modules, "key", "No specific business line")} /><SelectInput label="Parent category" value={parentKey} onChange={(event) => setParentKey(event.currentTarget.value)} options={catalogOptions(props.data.categories, "key", "No parent category")} /><TextInput label="Internal category key override" value={keyOverride} onChange={(event) => setKeyOverride(event.currentTarget.value)} /></div></details>{save.error ? <StatusBadge tone="danger">{catalogError(save.error)}</StatusBadge> : null}</div></Dialog>;
}

function ItemEditor(props: EditorProps) {
  const [step, setStep] = useState("scope");
  const [organizationId, setOrganizationId] = useState("");
  const [categoryKey, setCategoryKey] = useState("");
  const [moduleKey, setModuleKey] = useState("");
  const [branchId, setBranchId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [itemType, setItemType] = useState("service");
  const [fulfillmentMethods, setFulfillmentMethods] = useState("");
  const [preparationTime, setPreparationTime] = useState("");
  const [minQuantity, setMinQuantity] = useState("");
  const [maxQuantity, setMaxQuantity] = useState("");
  const [keyOverride, setKeyOverride] = useState("");
  const [status, setStatus] = useState("draft");
  const save = useMutation({ mutationFn: () => props.api.post("/runtime/catalog/items", { organizationId, itemKey: keyOverride.trim() || `catalog.item.${catalogSlug(name)}`, displayName: name.trim(), itemType: itemType.trim() || "service", moduleKey: moduleKey || undefined, branchId: branchId || undefined, categoryKey: categoryKey || undefined, fulfillmentMethods: catalogList(fulfillmentMethods), preparationTimeMinutes: catalogOptionalNumber(preparationTime), minQuantity: catalogOptionalNumber(minQuantity), maxQuantity: catalogOptionalNumber(maxQuantity), description: description.trim() || undefined, status, metadata: {}, idempotencyKey: createClientIdempotencyKey("admin.catalog-v2.item") }, CatalogMutationSchema), onSuccess: props.onSaved });
  return <Dialog isOpen title="Add service or item" onClose={props.onClose} footer={<Button variant="ghost" onClick={props.onClose}>Cancel</Button>}><AdminTaskFlow steps={itemSteps} activeStep={step} onStepChange={setStep} disableNext={step === "scope" && !organizationId} footer={step === "review" ? <Button isLoading={save.isPending} disabled={!organizationId || !name.trim()} onClick={() => save.mutate()}>Save item</Button> : undefined}>{step === "scope" ? <AdminFormSection title="Choose where this item belongs" description="Select the company and customer-facing category by name."><SelectInput label="Company" value={organizationId} onChange={(event) => { setOrganizationId(event.currentTarget.value); setBranchId(""); }} options={catalogOptions(props.data.organizations, "id", "Choose company")} /><SelectInput label="Category" value={categoryKey} onChange={(event) => setCategoryKey(event.currentTarget.value)} options={catalogOptions(props.data.categories, "key", "No category selected")} /><SelectInput label="Business line" value={moduleKey} onChange={(event) => setModuleKey(event.currentTarget.value)} options={catalogOptions(props.data.modules, "key", "No specific business line")} /><SelectInput label="Location (optional)" value={branchId} onChange={(event) => setBranchId(event.currentTarget.value)} options={catalogOptions(props.data.branches.filter((branch) => !organizationId || catalogText(branch, "organization_id") === organizationId), "id", "All company locations")} /></AdminFormSection> : null}{step === "details" ? <AdminFormSection title="Customer-facing details" description="Use a clear name and short description customers can understand."><TextInput label="Name" value={name} onChange={(event) => setName(event.currentTarget.value)} /><TextAreaInput label="Description" value={description} onChange={(event) => setDescription(event.currentTarget.value)} /><details className="catalog-v2__advanced"><summary>Advanced item identity</summary><div className="skima-form-grid"><TextInput label="Item type" value={itemType} onChange={(event) => setItemType(event.currentTarget.value)} /><TextInput label="Internal item key override" value={keyOverride} onChange={(event) => setKeyOverride(event.currentTarget.value)} /></div></details></AdminFormSection> : null}{step === "fulfillment" ? <AdminFormSection title="Fulfillment and quantity" description="Only set limits that are meaningful for this item. Leave optional fields empty when they do not apply."><TextInput label="Fulfillment methods" helperText="Enter supported methods separated by commas, for example delivery, pickup." value={fulfillmentMethods} onChange={(event) => setFulfillmentMethods(event.currentTarget.value)} /><div className="skima-form-grid"><TextInput label="Preparation time (minutes)" type="number" value={preparationTime} onChange={(event) => setPreparationTime(event.currentTarget.value)} /><TextInput label="Minimum quantity" type="number" value={minQuantity} onChange={(event) => setMinQuantity(event.currentTarget.value)} /><TextInput label="Maximum quantity" type="number" value={maxQuantity} onChange={(event) => setMaxQuantity(event.currentTarget.value)} /></div></AdminFormSection> : null}{step === "review" ? <AdminFormSection title="Review and save" description="Saving as Draft lets the team finish pricing and availability before customers can order."><div className="catalog-v2__review-grid"><div><small>Company</small><strong>{catalogLabel(props.data.organizations.find((org) => catalogText(org, "id") === organizationId), "Not selected")}</strong></div><div><small>Name</small><strong>{name || "Not entered"}</strong></div><div><small>Category</small><strong>{catalogLabel(props.data.categories.find((category) => catalogText(category, "key") === categoryKey), "Uncategorized")}</strong></div></div><SelectInput label="Item status" value={status} onChange={(event) => setStatus(event.currentTarget.value)} options={[{ label: "Draft — finish setup first", value: "draft" }, { label: "Active", value: "active" }, { label: "Paused", value: "paused" }, { label: "Archived", value: "archived" }]} /></AdminFormSection> : null}{save.error ? <StatusBadge tone="danger">{catalogError(save.error)}</StatusBadge> : null}</AdminTaskFlow></Dialog>;
}

function VariantEditor(props: EditorProps) {
  const [itemId, setItemId] = useState("");
  const [name, setName] = useState("");
  const [unitKey, setUnitKey] = useState("");
  const [sku, setSku] = useState("");
  const [quantityValue, setQuantityValue] = useState("");
  const [keyOverride, setKeyOverride] = useState("");
  const [status, setStatus] = useState("active");
  const save = useMutation({ mutationFn: () => props.api.post("/runtime/catalog/variants", { itemId, variantKey: keyOverride.trim() || catalogSlug(name), displayName: name.trim(), unitKey: unitKey || undefined, sku: sku.trim() || undefined, quantityValue: catalogOptionalNumber(quantityValue), status, metadata: {}, idempotencyKey: createClientIdempotencyKey("admin.catalog-v2.variant") }, CatalogMutationSchema), onSuccess: props.onSaved });
  return <Dialog isOpen title="Add variant" onClose={props.onClose} footer={<><Button variant="ghost" onClick={props.onClose}>Cancel</Button><Button isLoading={save.isPending} disabled={!itemId || !name.trim()} onClick={() => save.mutate()}>Save variant</Button></>}><div className="skima-form-grid"><SelectInput label="Service or item" value={itemId} onChange={(event) => setItemId(event.currentTarget.value)} options={catalogOptions(props.data.items, "id", "Choose item")} /><TextInput label="Variant name" value={name} onChange={(event) => setName(event.currentTarget.value)} /><SelectInput label="Unit (optional)" value={unitKey} onChange={(event) => setUnitKey(event.currentTarget.value)} options={catalogOptions(props.data.units, "key", "No unit")} /><TextInput label="Quantity value (optional)" type="number" value={quantityValue} onChange={(event) => setQuantityValue(event.currentTarget.value)} /><details className="catalog-v2__advanced"><summary>Advanced variant identity</summary><div className="skima-form-grid"><TextInput label="SKU" value={sku} onChange={(event) => setSku(event.currentTarget.value)} /><TextInput label="Internal variant key override" value={keyOverride} onChange={(event) => setKeyOverride(event.currentTarget.value)} /></div></details><SelectInput label="Status" value={status} onChange={(event) => setStatus(event.currentTarget.value)} options={statusOptions()} />{save.error ? <StatusBadge tone="danger">{catalogError(save.error)}</StatusBadge> : null}</div></Dialog>;
}

function PriceEditor(props: EditorProps) {
  const [itemId, setItemId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [amount, setAmount] = useState("");
  const [compareAtAmount, setCompareAtAmount] = useState("");
  const [currencyCode, setCurrencyCode] = useState("NGN");
  const [status, setStatus] = useState("active");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveUntil, setEffectiveUntil] = useState("");
  const matchingVariants = props.data.variants.filter((variant) => !itemId || catalogText(variant, "item_id") === itemId);
  const save = useMutation({ mutationFn: () => props.api.post("/runtime/catalog/prices", { itemId, variantId: variantId || undefined, amount: Number(amount), compareAtAmount: catalogOptionalNumber(compareAtAmount), currencyCode: currencyCode.trim() || "NGN", effectiveFrom: catalogOptionalIso(effectiveFrom), effectiveUntil: catalogOptionalIso(effectiveUntil), status, metadata: {}, idempotencyKey: createClientIdempotencyKey("admin.catalog-v2.price") }, CatalogMutationSchema), onSuccess: props.onSaved });
  return <Dialog isOpen title="Set price" onClose={props.onClose} footer={<><Button variant="ghost" onClick={props.onClose}>Cancel</Button><Button isLoading={save.isPending} disabled={!itemId || !amount || Number(amount) < 0} onClick={() => save.mutate()}>Save price</Button></>}><div className="skima-form-grid"><SelectInput label="Service or item" value={itemId} onChange={(event) => { setItemId(event.currentTarget.value); setVariantId(""); }} options={catalogOptions(props.data.items, "id", "Choose item")} /><SelectInput label="Variant (optional)" value={variantId} onChange={(event) => setVariantId(event.currentTarget.value)} options={catalogOptions(matchingVariants, "id", "Base item price")} /><TextInput label="Price" type="number" value={amount} onChange={(event) => setAmount(event.currentTarget.value)} /><TextInput label="Compare-at price (optional)" type="number" value={compareAtAmount} onChange={(event) => setCompareAtAmount(event.currentTarget.value)} /><SelectInput label="Currency" value={currencyCode} onChange={(event) => setCurrencyCode(event.currentTarget.value)} options={[{ label: "Nigerian naira (NGN)", value: "NGN" }, { label: "USDC", value: "USDC" }]} /><SelectInput label="Status" value={status} onChange={(event) => setStatus(event.currentTarget.value)} options={statusOptions()} /><details className="catalog-v2__advanced"><summary>Effective dates</summary><div className="skima-form-grid"><TextInput label="Starts" type="datetime-local" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.currentTarget.value)} /><TextInput label="Ends" type="datetime-local" value={effectiveUntil} onChange={(event) => setEffectiveUntil(event.currentTarget.value)} /></div></details>{save.error ? <StatusBadge tone="danger">{catalogError(save.error)}</StatusBadge> : null}</div></Dialog>;
}

function CatalogNav(props: { route: string; onNavigate: (href: string) => void }) {
  return <nav className="catalog-v2__nav" aria-label="Service catalog sections">{nav.map((item) => { const Icon = item.icon; const active = props.route === item.href; return <button type="button" key={item.key} className={active ? "is-active" : undefined} onClick={() => props.onNavigate(item.href)}><Icon aria-hidden="true" />{item.label}</button>; })}</nav>;
}

function useCatalogQuery(key: string, path: string) {
  const { api, status } = useSessionState();
  return useQuery({ queryKey: ["service-catalog-v2", key], enabled: status === "authenticated", queryFn: () => api.get(path, CatalogRecordArraySchema) });
}

function statusOptions() {
  return [{ label: "Draft", value: "draft" }, { label: "Active", value: "active" }, { label: "Inactive", value: "inactive" }, { label: "Archived", value: "archived" }];
}

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "active") return "success";
  if (["draft", "paused", "inactive"].includes(status)) return "warning";
  if (["archived", "retired"].includes(status)) return "danger";
  return "neutral";
}

function formatMoney(amount: number, currency: string) {
  try { return new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount); }
  catch { return `${currency} ${amount.toLocaleString()}`; }
}

type CatalogData = {
  organizations: CatalogRecord[];
  modules: CatalogRecord[];
  branches: CatalogRecord[];
  units: CatalogRecord[];
  categories: CatalogRecord[];
  items: CatalogRecord[];
  variants: CatalogRecord[];
  prices: CatalogRecord[];
};

type EditorProps = {
  kind: EditorKind | null;
  data: CatalogData;
  api: ReturnType<typeof useSessionState>["api"];
  onClose: () => void;
  onSaved: () => Promise<void>;
};
