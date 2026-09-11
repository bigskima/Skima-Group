import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, CheckCircle2, Gauge, Plus, RefreshCcw, Settings2, ShieldCheck } from "lucide-react";
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
  TextInput,
  type TableColumn,
} from "@skima/ui";

import { AdminResourceConsole } from "../../admin-resource-console";
import { useSessionState } from "../../session";
import { AdminFormSection, AdminTaskFlow, AdminV2PageHeader, type AdminTaskFlowStep } from "../../shared/patterns/AdminV2Patterns";
import { serviceAvailabilityConfig } from "./services-resource-configs";
import {
  CatalogMutationSchema,
  CatalogRecordArraySchema,
  catalogError,
  catalogFriendly,
  catalogLabel,
  catalogNumber,
  catalogOptionalIso,
  catalogOptionalNumber,
  catalogOptions,
  catalogText,
  type CatalogRecord,
} from "./service-catalog-v2-shared";
import "./service-catalog-v2.css";

const BASE = "/services/availability";
const OrderabilityResultSchema = z.record(z.unknown());

const nav = [
  { key: "overview", label: "Overview", href: BASE, icon: ShieldCheck },
  { key: "manage", label: "Availability & capacity", href: `${BASE}/manage`, icon: Gauge },
  { key: "orderability", label: "Orderability check", href: `${BASE}/orderability`, icon: CheckCircle2 },
] as const;

const availabilitySteps: readonly AdminTaskFlowStep[] = [
  { key: "item", label: "Item", description: "Choose service, variant and location" },
  { key: "state", label: "Availability", description: "Set customer-facing state" },
  { key: "capacity", label: "Capacity", description: "Optional stock and capacity" },
  { key: "review", label: "Review", description: "Dates, status and save" },
];

export function ServiceAvailabilityWorkspaceV2(props: {
  route: string;
  onNavigate: (href: string) => void;
}) {
  const client = useQueryClient();
  const items = useAvailabilityQuery("items", "/runtime/catalog/items");
  const variants = useAvailabilityQuery("variants", "/runtime/catalog/variants");
  const branches = useAvailabilityQuery("branches", "/runtime/organization-branches");
  const rules = useAvailabilityQuery("rules", "/runtime/catalog/availability");
  const checks = useAvailabilityQuery("orderability", "/runtime/catalog/orderability");
  const [editorOpen, setEditorOpen] = useState(false);

  if (props.route === `${BASE}/advanced`) {
    return (
      <div className="catalog-v2">
        <AvailabilityNav route={props.route} onNavigate={props.onNavigate} />
        <section className="admin-notice"><strong>Advanced availability administration</strong><p>Use this compatibility console for raw schedule JSON, direct stock adjustment and uncommon technical fields. Normal availability and orderability work should use the V2 screens.</p></section>
        <AdminResourceConsole config={serviceAvailabilityConfig} />
      </div>
    );
  }

  const queries = [items, variants, branches, rules, checks];
  const loading = queries.some((query) => query.isLoading);
  const error = queries.find((query) => query.error)?.error;
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ["service-availability-v2"] });
    await Promise.all(queries.map((query) => query.refetch()));
  };

  if (loading) return <LoadingState label="Loading service availability" />;
  if (error) return <ErrorState title="Service availability unavailable" message={catalogError(error)} onRetry={() => void refresh()} />;

  const data: AvailabilityData = {
    items: items.data ?? [],
    variants: variants.data ?? [],
    branches: branches.data ?? [],
    rules: rules.data ?? [],
    checks: checks.data ?? [],
  };
  const route = nav.some((item) => item.href === props.route) ? props.route : BASE;

  return (
    <div className="catalog-v2">
      {route !== BASE ? <AvailabilityNav route={route} onNavigate={props.onNavigate} /> : null}
      {route === `${BASE}/manage`
        ? <AvailabilityManagement data={data} onAdd={() => setEditorOpen(true)} />
        : route === `${BASE}/orderability`
          ? <OrderabilityScreen data={data} />
          : <AvailabilityOverview data={data} onNavigate={props.onNavigate} onRefresh={refresh} />}
      <AvailabilityEditor open={editorOpen} data={data} onClose={() => setEditorOpen(false)} onSaved={async () => { setEditorOpen(false); await refresh(); }} />
    </div>
  );
}

function AvailabilityOverview(props: { data: AvailabilityData; onNavigate: (href: string) => void; onRefresh: () => Promise<void> }) {
  const activeRules = props.data.rules.filter((rule) => catalogText(rule, "status") === "active");
  const unavailable = activeRules.filter((rule) => catalogText(rule, "availability_status") !== "available").length;
  const rejectedChecks = props.data.checks.filter((check) => catalogText(check, "status") === "rejected").length;
  return (
    <div className="catalog-v2__screen">
      <AdminV2PageHeader
        eyebrow="Services · Availability"
        title="Availability & orderability"
        description="Control whether customers can order a catalog item without mixing operational availability into the item definition or pricing screens."
        actions={<><Button icon={RefreshCcw} variant="outline" onClick={() => void props.onRefresh()}>Refresh</Button><Button icon={Settings2} variant="outline" onClick={() => props.onNavigate(`${BASE}/advanced`)}>Advanced</Button></>}
      />
      <section className="skima-grid skima-grid--compact">
        <MetricTile label="Active availability rules" value={activeRules.length} icon={ShieldCheck} tone="success" />
        <MetricTile label="Currently restricted" value={unavailable} icon={Activity} tone={unavailable ? "warning" : "success"} />
        <MetricTile label="Items" value={props.data.items.length} icon={Gauge} />
        <MetricTile label="Rejected recent checks" value={rejectedChecks} icon={CheckCircle2} tone={rejectedChecks ? "warning" : "success"} />
      </section>
      <section className="catalog-v2__task-grid">
        <button className="catalog-v2__task" type="button" onClick={() => props.onNavigate(`${BASE}/manage`)}><span><Gauge aria-hidden="true" /></span><span><strong>Availability & capacity</strong><small>Set customer availability, stock and capacity by item, variant and location.</small></span></button>
        <button className="catalog-v2__task" type="button" onClick={() => props.onNavigate(`${BASE}/orderability`)}><span><CheckCircle2 aria-hidden="true" /></span><span><strong>Orderability check</strong><small>Test whether a quantity can be ordered and see the server-authoritative result.</small></span></button>
      </section>
    </div>
  );
}

function AvailabilityManagement(props: { data: AvailabilityData; onAdd: () => void }) {
  const itemNames = new Map(props.data.items.map((item) => [catalogText(item, "id"), catalogLabel(item)]));
  const variantNames = new Map(props.data.variants.map((variant) => [catalogText(variant, "id"), catalogLabel(variant)]));
  const branchNames = new Map(props.data.branches.map((branch) => [catalogText(branch, "id"), catalogLabel(branch)]));
  const columns: TableColumn<CatalogRecord>[] = [
    { key: "item", header: "Service or item", render: (rule) => <><strong>{itemNames.get(catalogText(rule, "item_id")) ?? "Item unavailable"}</strong>{catalogText(rule, "variant_id") ? <><br /><small>{variantNames.get(catalogText(rule, "variant_id")) ?? "Variant"}</small></> : null}</> },
    { key: "location", header: "Location", render: (rule) => branchNames.get(catalogText(rule, "branch_id")) ?? "All locations" },
    { key: "availability", header: "Customer availability", render: (rule) => <StatusBadge tone={catalogText(rule, "availability_status") === "available" ? "success" : "warning"}>{catalogFriendly(catalogText(rule, "availability_status") || "available")}</StatusBadge> },
    { key: "stock", header: "Stock / capacity", render: (rule) => formatCapacity(rule) },
    { key: "status", header: "Rule", render: (rule) => <StatusBadge tone={catalogText(rule, "status") === "active" ? "success" : "neutral"}>{normalizeStatusLabel(catalogText(rule, "status") || "unknown")}</StatusBadge> },
  ];
  return <div className="catalog-v2__screen"><AdminV2PageHeader eyebrow="Services · Availability · Capacity" title="Availability & capacity" description="Choose items and locations by name, then set the operational state. Stock and capacity fields are optional and only shown when needed." actions={<Button icon={Plus} onClick={props.onAdd}>Set availability</Button>} /><section className="sk-panel"><DataTable caption="Catalog availability" columns={columns} records={props.data.rules} getRowKey={(rule) => catalogText(rule, "id") || JSON.stringify(rule)} emptyTitle="No availability rules yet" emptyMessage="Add an availability rule before customers can rely on item availability." /></section></div>;
}

function OrderabilityScreen(props: { data: AvailabilityData }) {
  const { api } = useSessionState();
  const [itemId, setItemId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [currencyCode, setCurrencyCode] = useState("NGN");
  const variants = props.data.variants.filter((variant) => !itemId || catalogText(variant, "item_id") === itemId);
  const check = useMutation({ mutationFn: () => api.post("/runtime/catalog/orderability", { itemId, variantId: variantId || undefined, branchId: branchId || undefined, quantity: Number(quantity), currencyCode, metadata: {}, idempotencyKey: createClientIdempotencyKey("admin.catalog-v2.orderability") }, OrderabilityResultSchema) });
  const allowed = check.data?.status === "allowed" || check.data?.orderable === true;
  return (
    <div className="catalog-v2__screen">
      <AdminV2PageHeader eyebrow="Services · Availability · Check" title="Check orderability" description="Test an item exactly as the server sees it: price, availability, location, quantity and capacity remain authoritative." />
      <section className="sk-panel catalog-v2__form-card">
        <div className="skima-form-grid"><SelectInput label="Service or item" value={itemId} onChange={(event) => { setItemId(event.currentTarget.value); setVariantId(""); check.reset(); }} options={catalogOptions(props.data.items, "id", "Choose item")} /><SelectInput label="Variant (optional)" value={variantId} onChange={(event) => { setVariantId(event.currentTarget.value); check.reset(); }} options={catalogOptions(variants, "id", "Base item")} /><SelectInput label="Location (optional)" value={branchId} onChange={(event) => { setBranchId(event.currentTarget.value); check.reset(); }} options={catalogOptions(props.data.branches, "id", "Any eligible location")} /><TextInput label="Quantity" type="number" value={quantity} onChange={(event) => { setQuantity(event.currentTarget.value); check.reset(); }} /><SelectInput label="Currency" value={currencyCode} onChange={(event) => setCurrencyCode(event.currentTarget.value)} options={[{ label: "Nigerian naira (NGN)", value: "NGN" }, { label: "USDC", value: "USDC" }]} /></div>
        <Button icon={CheckCircle2} disabled={!itemId || !(Number(quantity) > 0)} isLoading={check.isPending} onClick={() => check.mutate()}>Check now</Button>
        {check.data ? <section className={allowed ? "admin-notice" : "admin-notice is-error"}><strong>{allowed ? "This quantity can be ordered" : "This quantity cannot be ordered"}</strong><p>{typeof check.data.rejection_reason === "string" ? check.data.rejection_reason : allowed ? `Calculated amount: ${formatMoney(Number(check.data.calculated_amount ?? 0), currencyCode)}` : "Review price, availability, capacity and location settings."}</p></section> : null}
        {check.error ? <StatusBadge tone="danger">{catalogError(check.error)}</StatusBadge> : null}
      </section>
    </div>
  );
}

function AvailabilityEditor(props: { open: boolean; data: AvailabilityData; onClose: () => void; onSaved: () => Promise<void> }) {
  const { api } = useSessionState();
  const [step, setStep] = useState("item");
  const [itemId, setItemId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [availabilityStatus, setAvailabilityStatus] = useState("available");
  const [stockQuantity, setStockQuantity] = useState("");
  const [reservedQuantity, setReservedQuantity] = useState("0");
  const [capacityLimit, setCapacityLimit] = useState("");
  const [capacityUsed, setCapacityUsed] = useState("0");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveUntil, setEffectiveUntil] = useState("");
  const [ruleStatus, setRuleStatus] = useState("active");
  const [error, setError] = useState<string | null>(null);
  const variants = useMemo(() => props.data.variants.filter((variant) => !itemId || catalogText(variant, "item_id") === itemId), [props.data.variants, itemId]);

  const save = useMutation({
    mutationFn: () => api.post("/runtime/catalog/availability", {
      itemId,
      variantId: variantId || undefined,
      branchId: branchId || undefined,
      availabilityStatus,
      stockQuantity: catalogOptionalNumber(stockQuantity),
      reservedQuantity: catalogOptionalNumber(reservedQuantity),
      capacityLimit: catalogOptionalNumber(capacityLimit),
      capacityUsed: catalogOptionalNumber(capacityUsed),
      effectiveFrom: catalogOptionalIso(effectiveFrom),
      effectiveUntil: catalogOptionalIso(effectiveUntil),
      schedule: {},
      status: ruleStatus,
      metadata: {},
      idempotencyKey: createClientIdempotencyKey("admin.catalog-v2.availability"),
    }, CatalogMutationSchema),
    onSuccess: props.onSaved,
  });

  if (!props.open) return null;
  const submit = () => {
    if (!itemId) { setError("Choose the service or item first."); setStep("item"); return; }
    const stock = catalogOptionalNumber(stockQuantity);
    const reserved = catalogOptionalNumber(reservedQuantity) ?? 0;
    const cap = catalogOptionalNumber(capacityLimit);
    const used = catalogOptionalNumber(capacityUsed) ?? 0;
    if (stock !== undefined && reserved > stock) { setError("Reserved quantity cannot be greater than stock quantity."); setStep("capacity"); return; }
    if (cap !== undefined && used > cap) { setError("Capacity used cannot be greater than the capacity limit."); setStep("capacity"); return; }
    setError(null);
    save.mutate();
  };

  return (
    <Dialog isOpen title="Set availability" onClose={props.onClose} footer={<Button variant="ghost" onClick={props.onClose}>Cancel</Button>}>
      <AdminTaskFlow steps={availabilitySteps} activeStep={step} onStepChange={(next) => { setStep(next); setError(null); }} disableNext={step === "item" && !itemId} footer={step === "review" ? <Button isLoading={save.isPending} onClick={submit}>Save availability</Button> : undefined}>
        {step === "item" ? <AdminFormSection title="Choose the item and location" description="Select the service by name. Variant and location are optional when the rule applies broadly."><SelectInput label="Service or item" value={itemId} onChange={(event) => { setItemId(event.currentTarget.value); setVariantId(""); }} options={catalogOptions(props.data.items, "id", "Choose item")} /><SelectInput label="Variant (optional)" value={variantId} onChange={(event) => setVariantId(event.currentTarget.value)} options={catalogOptions(variants, "id", "All variants / base item")} /><SelectInput label="Location (optional)" value={branchId} onChange={(event) => setBranchId(event.currentTarget.value)} options={catalogOptions(props.data.branches, "id", "All eligible locations")} /></AdminFormSection> : null}
        {step === "state" ? <AdminFormSection title="Set customer availability" description="Use the state that best describes why the item can or cannot be ordered right now."><SelectInput label="Availability" value={availabilityStatus} onChange={(event) => setAvailabilityStatus(event.currentTarget.value)} options={[{ label: "Available", value: "available" }, { label: "Unavailable", value: "unavailable" }, { label: "Out of stock", value: "out_of_stock" }, { label: "Temporarily paused", value: "temporarily_paused" }, { label: "Capacity reached", value: "capacity_reached" }, { label: "Service closed", value: "service_closed" }, { label: "Admin suspended", value: "admin_suspended" }]} /></AdminFormSection> : null}
        {step === "capacity" ? <AdminFormSection title="Optional stock and capacity" description="Leave values empty when this service is not inventory/capacity constrained."><div className="skima-form-grid"><TextInput label="Stock quantity" type="number" value={stockQuantity} onChange={(event) => setStockQuantity(event.currentTarget.value)} /><TextInput label="Reserved quantity" type="number" value={reservedQuantity} onChange={(event) => setReservedQuantity(event.currentTarget.value)} /><TextInput label="Capacity limit" type="number" value={capacityLimit} onChange={(event) => setCapacityLimit(event.currentTarget.value)} /><TextInput label="Capacity used" type="number" value={capacityUsed} onChange={(event) => setCapacityUsed(event.currentTarget.value)} /></div></AdminFormSection> : null}
        {step === "review" ? <AdminFormSection title="Review and save" description="Schedule dates are optional. Advanced recurring schedule JSON remains in Advanced administration."><div className="catalog-v2__review-grid"><div><small>Item</small><strong>{catalogLabel(props.data.items.find((item) => catalogText(item, "id") === itemId), "Not selected")}</strong></div><div><small>Availability</small><strong>{catalogFriendly(availabilityStatus)}</strong></div><div><small>Location</small><strong>{catalogLabel(props.data.branches.find((branch) => catalogText(branch, "id") === branchId), "All locations")}</strong></div></div><SelectInput label="Rule status" value={ruleStatus} onChange={(event) => setRuleStatus(event.currentTarget.value)} options={[{ label: "Active", value: "active" }, { label: "Retired", value: "retired" }]} /><details className="catalog-v2__advanced"><summary>Effective dates</summary><div className="skima-form-grid"><TextInput label="Starts" type="datetime-local" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.currentTarget.value)} /><TextInput label="Ends" type="datetime-local" value={effectiveUntil} onChange={(event) => setEffectiveUntil(event.currentTarget.value)} /></div></details></AdminFormSection> : null}
        {error || save.error ? <StatusBadge tone="danger">{error ?? catalogError(save.error)}</StatusBadge> : null}
      </AdminTaskFlow>
    </Dialog>
  );
}

function AvailabilityNav(props: { route: string; onNavigate: (href: string) => void }) {
  return <nav className="catalog-v2__nav" aria-label="Service availability sections">{nav.map((item) => { const Icon = item.icon; const active = props.route === item.href; return <button type="button" key={item.key} className={active ? "is-active" : undefined} onClick={() => props.onNavigate(item.href)}><Icon aria-hidden="true" />{item.label}</button>; })}</nav>;
}

function useAvailabilityQuery(key: string, path: string) {
  const { api, status } = useSessionState();
  return useQuery({ queryKey: ["service-availability-v2", key], enabled: status === "authenticated", queryFn: () => api.get(path, CatalogRecordArraySchema) });
}

function formatCapacity(rule: CatalogRecord) {
  const stock = rule.stock_quantity;
  const cap = rule.capacity_limit;
  if (typeof stock === "number") return `${stock} in stock`;
  if (typeof cap === "number") return `${catalogNumber(rule, "capacity_used")} / ${cap} capacity`;
  return "Not capacity-limited";
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

type AvailabilityData = {
  items: CatalogRecord[];
  variants: CatalogRecord[];
  branches: CatalogRecord[];
  rules: CatalogRecord[];
  checks: CatalogRecord[];
};
