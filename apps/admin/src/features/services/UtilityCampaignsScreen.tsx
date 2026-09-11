import { useMutation, useQuery } from "@tanstack/react-query";
import { BadgePercent, Save, WalletCards } from "lucide-react";
import { useMemo, useState } from "react";

import { Button, SelectInput, StatusBadge, TextInput } from "@skima/ui";

import { useSessionState } from "../../session";
import { AdminFormSection, AdminTaskFlow, AdminV2PageHeader, type AdminTaskFlowStep } from "../../shared/patterns/AdminV2Patterns";
import {
  UtilityMutationIdSchema,
  UtilityPreviewSchema,
  formatUtilityNaira,
  utilityError,
  utilityIntegerOrNull,
  utilityNumber,
  utilityNumberOrNull,
  utilityNumeric,
  utilityObject,
  utilityOptions,
  utilityPositive,
  utilitySlug,
  utilityText,
  type UtilityRow,
  type UtilitySnapshot,
} from "./utility-billing-v2-shared";

const campaignSteps: readonly AdminTaskFlowStep[] = [
  { key: "target", label: "Target", description: "Who and what gets the offer" },
  { key: "reward", label: "Reward", description: "Cashback or discount" },
  { key: "funding", label: "Funding", description: "Margin, marketing or sponsor" },
  { key: "review", label: "Review", description: "Profit check and save" },
];

export function UtilityCampaignsScreen(props: { data: UtilitySnapshot; refresh: () => Promise<void> }) {
  const { api, status } = useSessionState();
  const [step, setStep] = useState("target");
  const [campaignType, setCampaignType] = useState("cashback");
  const [name, setName] = useState("");
  const [scopeType, setScopeType] = useState("all");
  const [scopeKey, setScopeKey] = useState("");
  const [kind, setKind] = useState("percentage");
  const [value, setValue] = useState("");
  const [maximum, setMaximum] = useState("");
  const [minimumSpend, setMinimumSpend] = useState("");
  const [fundingMode, setFundingMode] = useState("margin");
  const [budget, setBudget] = useState("");
  const [sponsorReference, setSponsorReference] = useState("");
  const [usageLimit, setUsageLimit] = useState("");
  const [perCustomer, setPerCustomer] = useState("1");
  const [campaignStatus, setCampaignStatus] = useState("draft");
  const [poolTopUp, setPoolTopUp] = useState("");

  const campaignPool = useQuery({
    queryKey: ["admin-utility-campaign-pool-v2"],
    enabled: status === "authenticated",
    retry: false,
    queryFn: () => api.get("/admin/utility-billing/campaign-pool?currency=NGN", UtilityPreviewSchema),
  });

  const scopeRows = scopeType === "category"
    ? props.data.categories
    : scopeType === "biller"
      ? props.data.billers
      : scopeType === "product"
        ? props.data.products
        : [];

  const payload = useMemo(() => ({
    campaignType,
    scopeType,
    scopeKey: scopeType === "all" ? null : scopeKey,
    calculationKind: kind,
    value: utilityNumeric(value),
    maximumAmount: utilityNumberOrNull(maximum),
    minimumSpend: utilityNumberOrNull(minimumSpend),
    fundingMode,
  }), [campaignType, scopeType, scopeKey, kind, value, maximum, minimumSpend, fundingMode]);

  const preview = useMutation({
    mutationFn: () => api.post("/admin/utility-billing/campaign-preview", payload, UtilityPreviewSchema),
  });
  const save = useMutation({
    mutationFn: () => api.post(
      "/admin/utility-billing/campaign",
      {
        ...payload,
        key: `utility.${campaignType}.${utilitySlug(name)}`,
        displayName: name.trim(),
        description: null,
        budgetAmount: fundingMode === "margin" ? null : utilityNumberOrNull(budget),
        sponsorReference: sponsorReference.trim() || null,
        usageLimit: utilityIntegerOrNull(usageLimit),
        perCustomerLimit: utilityIntegerOrNull(perCustomer),
        startsAt: null,
        endsAt: null,
        status: campaignStatus,
      },
      UtilityMutationIdSchema,
    ),
    onSuccess: props.refresh,
  });
  const fundPool = useMutation({
    mutationFn: (amount: number) => api.post(
      "/admin/utility-billing/campaign-pool/fund",
      {
        amount,
        currencyCode: "NGN",
        idempotencyKey: `utility-campaign-pool:${crypto.randomUUID()}`,
        metadata: { source: "skima.admin.utility_billing_v2" },
      },
      UtilityMutationIdSchema,
    ),
    onSuccess: async () => {
      await campaignPool.refetch();
      await props.refresh();
    },
  });

  const previewSafe = preview.data?.safe === true;
  const routeRows = preview.data && Array.isArray(preview.data.routes)
    ? preview.data.routes.filter((item): item is UtilityRow => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
  const firstEconomics = routeRows[0] ? utilityObject(routeRows[0], "economics") : null;
  const configuredCount = props.data.promotions.length + props.data.cashbacks.length;

  return (
    <div className="utility-v2__screen">
      <AdminV2PageHeader
        eyebrow="Utility billing · Campaigns"
        title="Profit-safe campaigns"
        description="Build cashback and discounts through a guarded flow. Margin-funded offers cannot activate if they would cross SKIMA's minimum profit floor."
      />

      <section className="skima-grid skima-grid--compact">
        <div className="sk-panel utility-v2__stat"><small>Configured campaigns</small><strong>{configuredCount}</strong></div>
        <div className="sk-panel utility-v2__stat"><small>Funded campaign pool</small><strong>{formatUtilityNaira(utilityNumber(campaignPool.data, "balance"))}</strong></div>
      </section>

      <section className="sk-panel utility-v2__pool">
        <div><WalletCards aria-hidden="true" /><span><strong>Campaign funding pool</strong><small>Marketing/sponsor campaigns must be backed by already-earned SKIMA revenue, not customer balances.</small></span></div>
        <div className="skima-action-row"><TextInput label="Top up (₦)" type="number" value={poolTopUp} onChange={(event) => setPoolTopUp(event.currentTarget.value)} /><Button variant="outline" isLoading={fundPool.isPending} disabled={!utilityPositive(poolTopUp)} onClick={() => fundPool.mutate(utilityNumeric(poolTopUp))}>Fund pool</Button></div>
      </section>

      <section className="sk-panel utility-v2__form-card">
        <AdminTaskFlow
          steps={campaignSteps}
          activeStep={step}
          onStepChange={setStep}
          disableNext={step === "target" && (!name.trim() || (scopeType !== "all" && !scopeKey))}
          footer={step === "review" ? <Button icon={Save} isLoading={save.isPending} disabled={!name.trim() || !utilityPositive(value) || (campaignStatus === "active" && !previewSafe) || (fundingMode !== "margin" && !utilityPositive(budget))} onClick={() => save.mutate()}>Save campaign</Button> : undefined}
        >
          {step === "target" ? (
            <AdminFormSection title="Choose the campaign target" description="Start broad or narrow the offer to one service type, company/network or product.">
              <TextInput label="Campaign name" value={name} onChange={(event) => setName(event.currentTarget.value)} placeholder="Weekend airtime cashback" />
              <SelectInput label="Target" value={scopeType} onChange={(event) => { setScopeType(event.currentTarget.value); setScopeKey(""); }} options={[{ label: "All utility services", value: "all" }, { label: "One service type", value: "category" }, { label: "One company / network", value: "biller" }, { label: "One product / plan", value: "product" }]} />
              {scopeType !== "all" ? <SelectInput label={scopeType === "category" ? "Service type" : scopeType === "biller" ? "Company / network" : "Product / plan"} value={scopeKey} onChange={(event) => setScopeKey(event.currentTarget.value)} options={utilityOptions(scopeRows, "key", "display_name", "Choose target")} /> : null}
            </AdminFormSection>
          ) : null}

          {step === "reward" ? (
            <AdminFormSection title="Set the customer reward" description="Cashback is credited after provider success. Discount reduces the customer-facing charge immediately.">
              <SelectInput label="Campaign type" value={campaignType} onChange={(event) => setCampaignType(event.currentTarget.value)} options={[{ label: "Cashback after provider success", value: "cashback" }, { label: "Instant discount", value: "discount" }]} />
              <SelectInput label="Reward calculation" value={kind} onChange={(event) => setKind(event.currentTarget.value)} options={[{ label: "Percentage", value: "percentage" }, { label: "Fixed naira amount", value: "fixed" }]} />
              <div className="skima-form-grid">
                <TextInput label={kind === "percentage" ? "Reward / discount (%)" : "Reward / discount (₦)"} type="number" value={value} onChange={(event) => setValue(event.currentTarget.value)} />
                {kind === "percentage" ? <TextInput label="Maximum reward per transaction (₦)" type="number" value={maximum} onChange={(event) => setMaximum(event.currentTarget.value)} /> : <span />}
                <TextInput label="Minimum purchase (₦)" type="number" value={minimumSpend} onChange={(event) => setMinimumSpend(event.currentTarget.value)} />
              </div>
            </AdminFormSection>
          ) : null}

          {step === "funding" ? (
            <AdminFormSection title="Choose how the offer is funded" description="Route margin is the safe default. Marketing and sponsor modes consume the dedicated funded campaign pool.">
              <SelectInput label="Funding source" value={fundingMode} onChange={(event) => setFundingMode(event.currentTarget.value)} options={[{ label: "Route margin — must remain profitable", value: "margin" }, { label: "SKIMA marketing budget", value: "marketing_budget" }, { label: "Sponsor-funded", value: "sponsor" }]} />
              {fundingMode !== "margin" ? <TextInput label="Campaign budget (₦)" type="number" value={budget} onChange={(event) => setBudget(event.currentTarget.value)} /> : null}
              {fundingMode === "sponsor" ? <TextInput label="Sponsor reference" value={sponsorReference} onChange={(event) => setSponsorReference(event.currentTarget.value)} /> : null}
              <details className="utility-v2__advanced"><summary>Usage limits</summary><div className="skima-form-grid"><TextInput label="Total uses allowed" type="number" value={usageLimit} onChange={(event) => setUsageLimit(event.currentTarget.value)} /><TextInput label="Uses per customer" type="number" value={perCustomer} onChange={(event) => setPerCustomer(event.currentTarget.value)} /></div></details>
            </AdminFormSection>
          ) : null}

          {step === "review" ? (
            <AdminFormSection title="Check profitability and activate" description="An active campaign must pass the server-side profit guard before it can be saved as active.">
              <div className="utility-v2__review-grid"><div><small>Campaign</small><strong>{name || "Unnamed"}</strong></div><div><small>Target</small><strong>{scopeType === "all" ? "All utility services" : scopeKey || "Not selected"}</strong></div><div><small>Reward</small><strong>{kind === "percentage" ? `${value || 0}%` : formatUtilityNaira(utilityNumeric(value))}</strong></div><div><small>Funding</small><strong>{fundingMode.replaceAll("_", " ")}</strong></div></div>
              <SelectInput label="Campaign state" value={campaignStatus} onChange={(event) => setCampaignStatus(event.currentTarget.value)} options={[{ label: "Draft", value: "draft" }, { label: "Activate after profit check", value: "active" }, { label: "Inactive", value: "inactive" }]} />
              <Button icon={BadgePercent} variant="outline" isLoading={preview.isPending} disabled={!utilityPositive(value) || (scopeType !== "all" && !scopeKey)} onClick={() => preview.mutate()}>Check campaign profit</Button>
              {preview.data ? <section className={previewSafe ? "admin-notice" : "admin-notice is-error"}><strong>{previewSafe ? "Campaign passes profit protection" : "Campaign is not safe to activate"}</strong><p>{utilityNumber(preview.data, "routeCount")} active route(s) checked.</p>{firstEconomics ? <p>Example protected margin available: {formatUtilityNaira(utilityNumber(firstEconomics, "maxSafeMarginCampaign"))}; contribution after campaign: {formatUtilityNaira(utilityNumber(firstEconomics, "contributionProfit"))}.</p> : null}</section> : null}
            </AdminFormSection>
          ) : null}

          {preview.error || save.error || fundPool.error ? <StatusBadge tone="danger">{utilityError(preview.error ?? save.error ?? fundPool.error)}</StatusBadge> : null}
        </AdminTaskFlow>
      </section>
    </div>
  );
}
