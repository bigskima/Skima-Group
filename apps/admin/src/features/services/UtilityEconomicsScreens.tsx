import { useMutation } from "@tanstack/react-query";
import { BadgeDollarSign, PlugZap, Save, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";

import { Button, SelectInput, StatusBadge, TextInput } from "@skima/ui";

import { useSessionState } from "../../session";
import { AdminFormSection, AdminTaskFlow, AdminV2PageHeader, type AdminTaskFlowStep } from "../../shared/patterns/AdminV2Patterns";
import {
  UtilityMutationIdSchema,
  UtilityPreviewSchema,
  formatUtilityNaira,
  friendlyUtilityText,
  utilityError,
  utilityFlag,
  utilityNumber,
  utilityNumeric,
  utilityOptions,
  utilityPositive,
  utilityText,
  type UtilitySnapshot,
} from "./utility-billing-v2-shared";

const economicsSteps: readonly AdminTaskFlowStep[] = [
  { key: "route", label: "Route", description: "Choose product and provider" },
  { key: "costs", label: "Costs", description: "Provider and collection costs" },
  { key: "guard", label: "Profit guard", description: "Minimum SKIMA contribution" },
  { key: "review", label: "Review", description: "Preview and save" },
];

export function UtilityRoutingScreen(props: { data: UtilitySnapshot; refresh: () => Promise<void> }) {
  const { api } = useSessionState();
  const [productKey, setProductKey] = useState("");
  const [providerKey, setProviderKey] = useState("");
  const [providerProductCode, setProviderProductCode] = useState("");
  const [priority, setPriority] = useState("100");
  const [fee, setFee] = useState("0");
  const [routeStatus, setRouteStatus] = useState("inactive");

  const provider = props.data.providers.find((item) => utilityText(item, "key") === providerKey) ?? null;
  const runtimeReady = utilityFlag(provider, "runtime_ready");
  const secretReady = utilityFlag(provider, "secret_configured");
  const economicsReady = props.data.economics.some((item) =>
    utilityText(item, "product_key") === productKey &&
    utilityText(item, "provider_key") === providerKey &&
    utilityText(item, "status") === "active"
  );
  const existingRoute = props.data.routes.find((item) =>
    utilityText(item, "product_key") === productKey && utilityText(item, "provider_key") === providerKey
  ) ?? null;

  const save = useMutation({
    mutationFn: () => api.post(
      "/admin/utility-billing/configuration",
      {
        kind: "route",
        configuration: {
          productKey,
          providerAdapterKey: providerKey,
          providerProductCode: providerProductCode.trim(),
          priority: Math.max(0, Math.trunc(utilityNumeric(priority, 100))),
          status: routeStatus,
          fixedFee: Math.max(0, utilityNumeric(fee)),
        },
      },
      UtilityMutationIdSchema,
    ),
    onSuccess: props.refresh,
  });

  const canActivate = runtimeReady && secretReady && economicsReady;
  return (
    <div className="utility-v2__screen">
      <AdminV2PageHeader
        eyebrow="Utility billing · Routing"
        title="Product routing"
        description="Map each SKIMA plan to a provider product code. Routes stay inactive until the provider runtime and protected economics are ready."
      />

      <section className="sk-panel utility-v2__form-card">
        <div className="skima-form-grid">
          <SelectInput label="SKIMA product / plan" value={productKey} onChange={(event) => setProductKey(event.currentTarget.value)} options={utilityOptions(props.data.products, "key", "display_name", "Choose product")} />
          <SelectInput label="Provider" value={providerKey} onChange={(event) => setProviderKey(event.currentTarget.value)} options={utilityOptions(props.data.providers, "key", "display_name", "Choose provider")} />
          <TextInput label="Provider product code" value={providerProductCode} onChange={(event) => setProviderProductCode(event.currentTarget.value)} placeholder="Code returned by provider catalogue" />
          <SelectInput
            label="Route status"
            value={routeStatus}
            onChange={(event) => setRouteStatus(event.currentTarget.value)}
            options={[{ label: "Inactive while configuring", value: "inactive" }, { label: "Active for customer traffic", value: "active" }]}
          />
        </div>

        {productKey && providerKey ? (
          <div className="utility-v2__readiness-grid">
            <Readiness label="Provider secret" ready={secretReady} />
            <Readiness label="Live fulfillment" ready={runtimeReady} />
            <Readiness label="Protected economics" ready={economicsReady} />
          </div>
        ) : null}

        {routeStatus === "active" && !canActivate ? (
          <section className="admin-notice"><strong>Route cannot go live yet</strong><p>Complete provider live verification and active economics before activating this route.</p></section>
        ) : null}
        {existingRoute ? <StatusBadge tone="info">Existing route found — saving updates its current mapping.</StatusBadge> : null}

        <details className="utility-v2__advanced">
          <summary>Advanced route controls</summary>
          <div className="skima-form-grid">
            <TextInput label="Priority" type="number" value={priority} onChange={(event) => setPriority(event.currentTarget.value)} />
            <TextInput label="Fixed customer route fee (₦)" type="number" value={fee} onChange={(event) => setFee(event.currentTarget.value)} />
          </div>
        </details>

        <Button
          icon={PlugZap}
          isLoading={save.isPending}
          disabled={!productKey || !providerKey || !providerProductCode.trim() || (routeStatus === "active" && !canActivate)}
          onClick={() => save.mutate()}
        >
          Save route
        </Button>
        {save.error ? <StatusBadge tone="danger">{utilityError(save.error)}</StatusBadge> : null}
      </section>
    </div>
  );
}

export function UtilityEconomicsScreen(props: { data: UtilitySnapshot; refresh: () => Promise<void> }) {
  const { api } = useSessionState();
  const [step, setStep] = useState("route");
  const [routeId, setRouteId] = useState("");
  const [providerDiscountPercent, setProviderDiscountPercent] = useState("");
  const [providerDiscountFixed, setProviderDiscountFixed] = useState("");
  const [collectionCostPercent, setCollectionCostPercent] = useState("");
  const [collectionCostFixed, setCollectionCostFixed] = useState("");
  const [reservePercent, setReservePercent] = useState("");
  const [reserveFixed, setReserveFixed] = useState("");
  const [minimumProfitPercent, setMinimumProfitPercent] = useState("1");
  const [minimumProfitFixed, setMinimumProfitFixed] = useState("");
  const [customerFeePercent, setCustomerFeePercent] = useState("");
  const [customerFeeFixed, setCustomerFeeFixed] = useState("");
  const [minimumAmount, setMinimumAmount] = useState("100");
  const [previewAmount, setPreviewAmount] = useState("1000");
  const [economicsStatus, setEconomicsStatus] = useState("active");

  const route = props.data.routes.find((item) => utilityText(item, "id") === routeId) ?? null;
  const productKey = utilityText(route, "product_key");
  const providerKey = utilityText(route, "provider_key");
  const existing = props.data.economics.find((item) =>
    utilityText(item, "product_key") === productKey && utilityText(item, "provider_key") === providerKey
  ) ?? null;

  const payload = useMemo(() => ({
    productKey,
    providerAdapterKey: providerKey,
    providerDiscountPercent: utilityNumeric(providerDiscountPercent),
    providerDiscountFixed: utilityNumeric(providerDiscountFixed),
    collectionCostPercent: utilityNumeric(collectionCostPercent),
    collectionCostFixed: utilityNumeric(collectionCostFixed),
    operatingReservePercent: utilityNumeric(reservePercent),
    operatingReserveFixed: utilityNumeric(reserveFixed),
    minimumProfitPercent: utilityNumeric(minimumProfitPercent),
    minimumProfitFixed: utilityNumeric(minimumProfitFixed),
    customerFeePercent: utilityNumeric(customerFeePercent),
    customerFeeFixed: utilityNumeric(customerFeeFixed),
    minimumEconomicAmount: utilityNumeric(minimumAmount, 100),
    status: economicsStatus,
  }), [productKey, providerKey, providerDiscountPercent, providerDiscountFixed, collectionCostPercent, collectionCostFixed, reservePercent, reserveFixed, minimumProfitPercent, minimumProfitFixed, customerFeePercent, customerFeeFixed, minimumAmount, economicsStatus]);

  const save = useMutation({
    mutationFn: () => api.post("/admin/utility-billing/economics", payload, UtilityMutationIdSchema),
    onSuccess: props.refresh,
  });
  const preview = useMutation({
    mutationFn: () => api.post(
      "/admin/utility-billing/economics/preview",
      { productKey, providerAdapterKey: providerKey, faceAmount: utilityNumeric(previewAmount) },
      UtilityPreviewSchema,
    ),
  });

  const previewSafe = preview.data?.profitable === true;
  return (
    <div className="utility-v2__screen">
      <AdminV2PageHeader
        eyebrow="Utility billing · Economics"
        title="Protected route economics"
        description="Configure provider discount, operating costs and SKIMA's minimum profit floor in separate steps instead of one long finance form."
      />

      <section className="sk-panel utility-v2__form-card">
        <AdminTaskFlow
          steps={economicsSteps}
          activeStep={step}
          onStepChange={setStep}
          disableNext={step === "route" && !routeId}
          footer={step === "review" ? <Button icon={Save} isLoading={save.isPending} disabled={!productKey || !providerKey} onClick={() => save.mutate()}>Save economics</Button> : undefined}
        >
          {step === "route" ? (
            <AdminFormSection title="Choose the provider route" description="Economics belongs to a product/provider route, never to a hardcoded provider globally.">
              <SelectInput label="Product → provider route" value={routeId} onChange={(event) => setRouteId(event.currentTarget.value)} options={[{ label: "Choose a route", value: "" }, ...props.data.routes.map((item) => ({ value: utilityText(item, "id"), label: `${utilityText(item, "product_name") || utilityText(item, "product_key") || "Product"} → ${utilityText(item, "provider_name") || utilityText(item, "provider_key") || "Provider"}` }))]} />
              {existing ? <StatusBadge tone="info">This route already has economics. Saving will update the protected model.</StatusBadge> : null}
            </AdminFormSection>
          ) : null}

          {step === "costs" ? (
            <AdminFormSection title="Provider margin and operating costs" description="Enter the provider discount/commission first, then SKIMA's collection and risk costs.">
              <div className="skima-form-grid">
                <TextInput label="Provider discount / commission (%)" type="number" value={providerDiscountPercent} onChange={(event) => setProviderDiscountPercent(event.currentTarget.value)} />
                <TextInput label="Provider fixed discount (₦)" type="number" value={providerDiscountFixed} onChange={(event) => setProviderDiscountFixed(event.currentTarget.value)} />
                <TextInput label="Collection cost (%)" type="number" value={collectionCostPercent} onChange={(event) => setCollectionCostPercent(event.currentTarget.value)} />
                <TextInput label="Collection cost fixed (₦)" type="number" value={collectionCostFixed} onChange={(event) => setCollectionCostFixed(event.currentTarget.value)} />
                <TextInput label="Operating / risk reserve (%)" type="number" value={reservePercent} onChange={(event) => setReservePercent(event.currentTarget.value)} />
                <TextInput label="Operating / risk reserve fixed (₦)" type="number" value={reserveFixed} onChange={(event) => setReserveFixed(event.currentTarget.value)} />
              </div>
            </AdminFormSection>
          ) : null}

          {step === "guard" ? (
            <AdminFormSection title="Protect SKIMA's contribution" description="The minimum profit floor is evaluated before a route or margin-funded campaign is considered safe.">
              <div className="skima-form-grid">
                <TextInput label="Minimum SKIMA profit (%)" type="number" value={minimumProfitPercent} onChange={(event) => setMinimumProfitPercent(event.currentTarget.value)} />
                <TextInput label="Minimum SKIMA profit fixed (₦)" type="number" value={minimumProfitFixed} onChange={(event) => setMinimumProfitFixed(event.currentTarget.value)} />
                <TextInput label="Customer convenience fee (%)" type="number" value={customerFeePercent} onChange={(event) => setCustomerFeePercent(event.currentTarget.value)} />
                <TextInput label="Customer convenience fee fixed (₦)" type="number" value={customerFeeFixed} onChange={(event) => setCustomerFeeFixed(event.currentTarget.value)} />
              </div>
              <details className="utility-v2__advanced"><summary>Advanced profit-check threshold</summary><div><TextInput label="Smallest amount used for profit checks (₦)" type="number" value={minimumAmount} onChange={(event) => setMinimumAmount(event.currentTarget.value)} /></div></details>
            </AdminFormSection>
          ) : null}

          {step === "review" ? (
            <AdminFormSection title="Preview before saving" description="Test a normal customer amount against the proposed/current route economics before activation.">
              <div className="utility-v2__review-grid"><div><small>Route</small><strong>{route ? `${utilityText(route, "product_name") || utilityText(route, "product_key")} → ${utilityText(route, "provider_name") || utilityText(route, "provider_key")}` : "Not selected"}</strong></div><div><small>Minimum profit</small><strong>{minimumProfitPercent || "0"}% + {formatUtilityNaira(utilityNumeric(minimumProfitFixed))}</strong></div></div>
              <SelectInput label="Economics status" value={economicsStatus} onChange={(event) => setEconomicsStatus(event.currentTarget.value)} options={[{ label: "Active protection", value: "active" }, { label: "Inactive", value: "inactive" }]} />
              <div className="skima-form-grid"><TextInput label="Preview transaction amount (₦)" type="number" value={previewAmount} onChange={(event) => setPreviewAmount(event.currentTarget.value)} /><Button variant="outline" isLoading={preview.isPending} disabled={!productKey || !providerKey || !utilityPositive(previewAmount)} onClick={() => preview.mutate()}>Preview profit</Button></div>
              {preview.data ? <EconomicsPreview preview={preview.data} /> : null}
            </AdminFormSection>
          ) : null}
          {save.error || preview.error ? <StatusBadge tone="danger">{utilityError(save.error ?? preview.error)}</StatusBadge> : null}
        </AdminTaskFlow>
      </section>
    </div>
  );
}

function Readiness(props: { label: string; ready: boolean }) {
  return <div className={props.ready ? "is-ready" : "is-pending"}><ShieldCheck aria-hidden="true" /><span><strong>{props.label}</strong><small>{props.ready ? "Ready" : "Required"}</small></span></div>;
}

function EconomicsPreview(props: { preview: Record<string, unknown> }) {
  const safe = props.preview.profitable === true;
  return (
    <section className={safe ? "admin-notice" : "admin-notice is-error"}>
      <strong>{safe ? "Protected profit passes" : "Profit floor is not protected"}</strong>
      <p>Provider cost {formatUtilityNaira(utilityNumber(props.preview, "providerCost"))} · provider margin {formatUtilityNaira(utilityNumber(props.preview, "providerDiscount"))} · customer fee {formatUtilityNaira(utilityNumber(props.preview, "customerFee"))}</p>
      <p>Collection {formatUtilityNaira(utilityNumber(props.preview, "collectionCost"))} · reserve {formatUtilityNaira(utilityNumber(props.preview, "operatingReserve"))} · minimum profit {formatUtilityNaira(utilityNumber(props.preview, "minimumProfit"))}</p>
      <p>Maximum ordinary campaign spend: <strong>{formatUtilityNaira(utilityNumber(props.preview, "maxSafeMarginCampaign"))}</strong>.</p>
    </section>
  );
}
