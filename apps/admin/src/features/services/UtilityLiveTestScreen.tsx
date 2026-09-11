import { useMutation } from "@tanstack/react-query";
import { ShieldCheck, Zap } from "lucide-react";
import { useState } from "react";

import { Button, SelectInput, StatusBadge, TextInput } from "@skima/ui";

import { useSessionState } from "../../session";
import { AdminV2PageHeader } from "../../shared/patterns/AdminV2Patterns";
import {
  UtilityPreviewSchema,
  friendlyUtilityText,
  utilityError,
  utilityFlag,
  utilityNumeric,
  utilityObject,
  utilityOptions,
  utilityPositive,
  utilityText,
  type UtilitySnapshot,
} from "./utility-billing-v2-shared";

export function UtilityLiveTestScreen(props: { data: UtilitySnapshot; refresh: () => Promise<void> }) {
  const { api } = useSessionState();
  const [providerKey, setProviderKey] = useState("");
  const [routeId, setRouteId] = useState("");
  const [billerCode, setBillerCode] = useState("");
  const [customerIdentifier, setCustomerIdentifier] = useState("");
  const [amount, setAmount] = useState("100");
  const [confirmed, setConfirmed] = useState(false);

  const provider = props.data.providers.find((item) => utilityText(item, "key") === providerKey) ?? null;
  const providerRoutes = props.data.routes.filter((item) => !providerKey || utilityText(item, "provider_key") === providerKey);
  const route = providerRoutes.find((item) => utilityText(item, "id") === routeId) ?? null;
  const productKey = utilityText(route, "product_key");
  const product = props.data.products.find((item) => utilityText(item, "key") === productKey) ?? null;
  const productMetadata = utilityObject(product, "metadata");
  const mappedBillerCode = utilityText(productMetadata, "providerBillerCode");
  const resolvedBillerCode = billerCode.trim() || mappedBillerCode;
  const itemCode = utilityText(route, "provider_product_code");

  const run = useMutation({
    mutationFn: () => api.post(
      "/admin/utility-billing/providers/live-test",
      {
        providerKey,
        billerCode: resolvedBillerCode,
        itemCode,
        customerIdentifier: customerIdentifier.trim(),
        amount: utilityNumeric(amount),
        confirmLiveSpend: true,
      },
      UtilityPreviewSchema,
    ),
    onSuccess: props.refresh,
  });

  const reference = run.data ? utilityText(run.data, "reference") || utilityText(run.data, "providerReference") : "";
  const check = useMutation({
    mutationFn: () => api.post(
      "/admin/utility-billing/providers/live-test/status",
      { providerKey, reference },
      UtilityPreviewSchema,
    ),
    onSuccess: props.refresh,
  });
  const result = check.data ?? run.data ?? null;
  const resultStatus = utilityText(result, "status");
  const runtimeReady = result?.runtimeReady === true;

  return (
    <div className="utility-v2__screen">
      <AdminV2PageHeader
        eyebrow="Utility billing · Live test"
        title="Verify provider fulfillment"
        description="Run one small real provider transaction before customer routes go live. This uses the provider's funded balance and does not debit a SKIMA customer wallet."
      />

      <section className="admin-notice">
        <strong>Real-money readiness test</strong>
        <p>Use your own phone number, meter or account and a small amount. SKIMA limits this admin readiness path to ₦5,000 per test. A successful live vend is what marks the fulfillment adapter ready.</p>
      </section>

      <section className="sk-panel utility-v2__form-card">
        <div className="skima-form-grid">
          <SelectInput
            label="Provider"
            value={providerKey}
            onChange={(event) => { setProviderKey(event.currentTarget.value); setRouteId(""); setBillerCode(""); setConfirmed(false); run.reset(); check.reset(); }}
            options={utilityOptions(props.data.providers, "key", "display_name", "Choose provider")}
          />
          <SelectInput
            label="Product route"
            value={routeId}
            onChange={(event) => { setRouteId(event.currentTarget.value); setBillerCode(""); setConfirmed(false); run.reset(); check.reset(); }}
            options={[{ label: "Choose a synced product route", value: "" }, ...providerRoutes.map((item) => ({ value: utilityText(item, "id"), label: `${utilityText(item, "product_name") || utilityText(item, "product_key") || "Product"} → ${utilityText(item, "provider_name") || "Provider"}` }))]}
          />
        </div>

        {provider ? (
          <div className="utility-v2__readiness-grid">
            <Readiness label="Edge secret reference" ready={utilityFlag(provider, "secret_configured")} />
            <Readiness label="Previous live vend" ready={utilityFlag(provider, "runtime_ready")} />
          </div>
        ) : null}

        <TextInput label="Real recipient / account identifier" value={customerIdentifier} onChange={(event) => { setCustomerIdentifier(event.currentTarget.value); setConfirmed(false); }} placeholder="Your phone number or meter/account number" />
        <TextInput label="Real test amount (₦)" type="number" value={amount} onChange={(event) => { setAmount(event.currentTarget.value); setConfirmed(false); }} />

        <details className="utility-v2__advanced">
          <summary>Provider mapping detail</summary>
          <div>
            <TextInput label="Provider biller code" value={resolvedBillerCode} onChange={(event) => setBillerCode(event.currentTarget.value)} placeholder="Usually imported by catalogue sync" />
            {mappedBillerCode ? <small className="skima-muted">Catalogue mapping: <code>{mappedBillerCode}</code></small> : <small className="skima-muted">Enter manually only when the provider catalogue mapping is missing.</small>}
          </div>
        </details>

        <label className="admin-checkbox-row">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.currentTarget.checked)} />
          <span>I understand this sends a real provider transaction and may charge the provider's funded balance.</span>
        </label>

        <Button
          icon={Zap}
          isLoading={run.isPending}
          disabled={!providerKey || !routeId || !resolvedBillerCode || !itemCode || !customerIdentifier.trim() || !utilityPositive(amount) || utilityNumeric(amount) > 5000 || !confirmed}
          onClick={() => run.mutate()}
        >
          Send real test
        </Button>

        {result ? (
          <section className={runtimeReady ? "admin-notice" : "admin-notice"}>
            <strong>{runtimeReady ? "Live provider fulfillment verified" : `Provider result: ${friendlyUtilityText(resultStatus || "processing")}`}</strong>
            <p>Reference: {utilityText(result, "reference") || utilityText(result, "providerReference") || "Provider reference pending"}.</p>
          </section>
        ) : null}

        {reference && !runtimeReady ? <Button variant="outline" isLoading={check.isPending} onClick={() => check.mutate()}>Check live test status</Button> : null}
        {run.error || check.error ? <StatusBadge tone="danger">{utilityError(run.error ?? check.error)}</StatusBadge> : null}
      </section>
    </div>
  );
}

function Readiness(props: { label: string; ready: boolean }) {
  return <div className={props.ready ? "is-ready" : "is-pending"}><ShieldCheck aria-hidden="true" /><span><strong>{props.label}</strong><small>{props.ready ? "Ready" : "Required"}</small></span></div>;
}
