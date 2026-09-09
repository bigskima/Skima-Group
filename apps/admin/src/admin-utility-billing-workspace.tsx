import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgePercent,
  Building2,
  PlugZap,
  RefreshCcw,
  Save,
  ServerCog,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import {
  Button,
  ErrorState,
  LoadingState,
  MetricTile,
  PageHeader,
  SelectInput,
  TextInput,
} from "@skima/ui";

import { AdminUtilityProviderGuide } from "./admin-utility-provider-guide";
import { useSessionState } from "./session";

const RowSchema = z.record(z.unknown());
const SnapshotSchema = z.object({
  categories: z.array(RowSchema),
  billers: z.array(RowSchema),
  products: z.array(RowSchema),
  routes: z.array(RowSchema),
  economics: z.array(RowSchema).default([]),
  providers: z.array(RowSchema),
  syncRuns: z.array(RowSchema).default([]),
  promotions: z.array(RowSchema),
  cashbacks: z.array(RowSchema),
  payments: z.array(RowSchema),
});
const MutationIdSchema = z.string().uuid();
const PreviewSchema = z.record(z.unknown());

type Row = z.infer<typeof RowSchema>;
type SetupStep =
  | "guide"
  | "provider"
  | "catalog"
  | "category"
  | "biller"
  | "product"
  | "economics"
  | "connection"
  | "campaign";

const steps: ReadonlyArray<{ key: SetupStep; label: string; detail: string }> = [
  { key: "guide", label: "Start here", detail: "How the utility engine works" },
  { key: "provider", label: "Providers", detail: "Connect any bill-payment API" },
  { key: "catalog", label: "Catalogue", detail: "Provider sync and SKIMA curation" },
  { key: "category", label: "Service types", detail: "Manual fallback: airtime, data, electricity" },
  { key: "biller", label: "Companies", detail: "Manual fallback: MTN, Glo, EEDC and more" },
  { key: "product", label: "Plans", detail: "Manual fallback: bundles and bill types" },
  { key: "economics", label: "Economics", detail: "Margin, costs and protected profit" },
  { key: "connection", label: "Routing", detail: "Map product to provider and activate safely" },
  { key: "campaign", label: "Campaigns", detail: "Profit-safe cashback and discounts" },
];

export function AdminUtilityBillingWorkspace() {
  const { api, status } = useSessionState();
  const client = useQueryClient();
  const [step, setStep] = useState<SetupStep>("guide");

  const snapshot = useQuery({
    queryKey: ["admin-utility-billing"],
    enabled: status === "authenticated",
    retry: false,
    queryFn: () => api.get("/admin/utility-billing/configuration", SnapshotSchema),
  });

  const save = useMutation({
    mutationFn: (input: {
      kind: string;
      key: string;
      configuration: Record<string, unknown>;
    }) =>
      api.post(
        "/admin/utility-billing/configuration",
        input,
        MutationIdSchema,
      ),
    onSuccess: async () =>
      client.invalidateQueries({ queryKey: ["admin-utility-billing"] }),
  });

  const connect = useMutation({
    mutationFn: (input: {
      productKey: string;
      providerKey: string;
      productCode: string;
      priority: number;
      state: string;
      fee: number;
    }) =>
      api.post(
        "/admin/utility-billing/configuration",
        {
          kind: "route",
          configuration: {
            productKey: input.productKey,
            providerAdapterKey: input.providerKey,
            providerProductCode: input.productCode,
            priority: input.priority,
            status: input.state,
            fixedFee: input.fee,
          },
        },
        MutationIdSchema,
      ),
    onSuccess: async () =>
      client.invalidateQueries({ queryKey: ["admin-utility-billing"] }),
  });

  const saveEconomics = useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      api.post("/admin/utility-billing/economics", input, MutationIdSchema),
    onSuccess: async () =>
      client.invalidateQueries({ queryKey: ["admin-utility-billing"] }),
  });

  const previewEconomics = useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      api.post(
        "/admin/utility-billing/economics/preview",
        input,
        PreviewSchema,
      ),
  });

  const previewCampaign = useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      api.post(
        "/admin/utility-billing/campaign-preview",
        input,
        PreviewSchema,
      ),
  });

  const saveCampaign = useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      api.post("/admin/utility-billing/campaign", input, MutationIdSchema),
    onSuccess: async () =>
      client.invalidateQueries({ queryKey: ["admin-utility-billing"] }),
  });

  const data = snapshot.data;
  const readyProviders =
    data?.providers.filter((item) => flag(item, "runtime_ready")).length ?? 0;

  return (
    <>
      <PageHeader
        eyebrow="Customer services"
        title="Bills & everyday payments"
        description="Connect any utility provider, sync its catalogue, set route economics, then run cashback or discounts only when SKIMA's protected contribution remains positive."
        actions={
          <Button
            icon={RefreshCcw}
            variant="outline"
            onClick={() => void snapshot.refetch()}
          >
            Refresh
          </Button>
        }
      />

      {snapshot.isLoading ? (
        <LoadingState label="Loading bill services" />
      ) : snapshot.error ? (
        <ErrorState
          title="Bill services unavailable"
          message={snapshot.error.message}
          onRetry={() => void snapshot.refetch()}
        />
      ) : (
        <section className="skima-grid skima-grid--compact">
          <MetricTile
            label="Service companies"
            value={data?.billers.length ?? 0}
            icon={Building2}
          />
          <MetricTile
            label="Customer plans"
            value={data?.products.length ?? 0}
            icon={Zap}
            tone="info"
          />
          <MetricTile
            label="Provider records"
            value={data?.providers.length ?? 0}
            icon={ServerCog}
            tone={readyProviders > 0 ? "success" : "warning"}
          />
          <MetricTile
            label="Live routes"
            value={data?.routes.filter((item) => text(item, "status") === "active").length ?? 0}
            icon={PlugZap}
          />
          <MetricTile
            label="Offers"
            value={data?.promotions.length ?? 0}
            icon={BadgePercent}
          />
        </section>
      )}

      <section className="sk-panel">
        <div className="sk-panel__header">
          <div>
            <p className="admin-section-kicker">Guided setup</p>
            <h2>Set up customer bill payments</h2>
            <p>
              Work from left to right. Saving a provider never stores the API key in
              the database; only the Edge secret reference is saved.
            </p>
          </div>
        </div>

        <div className="utility-setup-tabs" role="tablist" aria-label="Bill payment setup">
          {steps.map((item) => (
            <button
              key={item.key}
              className={step === item.key ? "is-active" : ""}
              type="button"
              onClick={() => setStep(item.key)}
            >
              <strong>{item.label}</strong>
              <small>{item.detail}</small>
            </button>
          ))}
        </div>

        {step === "guide" ? <AdminUtilityProviderGuide /> : null}
        {step === "category" ? (
          <CategoryForm
            busy={save.isPending}
            error={save.error}
            onSave={(key, configuration) =>
              save.mutate({ kind: "category", key, configuration })}
          />
        ) : null}
        {step === "biller" ? (
          <BillerForm
            categories={data?.categories ?? []}
            busy={save.isPending}
            error={save.error}
            onSave={(key, configuration) =>
              save.mutate({ kind: "biller", key, configuration })}
          />
        ) : null}
        {step === "product" ? (
          <ProductForm
            billers={data?.billers ?? []}
            busy={save.isPending}
            error={save.error}
            onSave={(key, configuration) =>
              save.mutate({ kind: "product", key, configuration })}
          />
        ) : null}
        {step === "provider" ? (
          <ProviderForm
            providers={data?.providers ?? []}
            busy={save.isPending}
            error={save.error}
            onSave={(key, configuration) =>
              save.mutate({ kind: "provider", key, configuration })}
          />
        ) : null}
        {step === "catalog" ? (
          <CatalogSyncOverview
            providers={data?.providers ?? []}
            syncRuns={data?.syncRuns ?? []}
          />
        ) : null}
        {step === "economics" ? (
          <EconomicsForm
            routes={data?.routes ?? []}
            economics={data?.economics ?? []}
            busy={saveEconomics.isPending}
            previewBusy={previewEconomics.isPending}
            error={saveEconomics.error ?? previewEconomics.error}
            preview={previewEconomics.data ?? null}
            onSave={(input) => saveEconomics.mutate(input)}
            onPreview={(input) => previewEconomics.mutate(input)}
          />
        ) : null}
        {step === "connection" ? (
          <ConnectionForm
            products={data?.products ?? []}
            providers={data?.providers ?? []}
            routes={data?.routes ?? []}
            economics={data?.economics ?? []}
            busy={connect.isPending}
            error={connect.error}
            onSave={(input) => connect.mutate(input)}
          />
        ) : null}
        {step === "campaign" ? (
          <CampaignForm
            categories={data?.categories ?? []}
            billers={data?.billers ?? []}
            products={data?.products ?? []}
            promotions={data?.promotions ?? []}
            cashbacks={data?.cashbacks ?? []}
            preview={previewCampaign.data ?? null}
            previewBusy={previewCampaign.isPending}
            saveBusy={saveCampaign.isPending}
            error={previewCampaign.error ?? saveCampaign.error}
            onPreview={(input) => previewCampaign.mutate(input)}
            onSave={(input) => saveCampaign.mutate(input)}
          />
        ) : null}
      </section>

      <section className="admin-notice">
        <strong>Profit and payment protection</strong>
        <p>
          A route cannot go live until the provider has an Edge-secret reference, a tested
          fulfillment adapter, and active economics that preserve the configured minimum
          SKIMA profit. Margin-funded campaigns are blocked when they would cross that floor;
          marketing or sponsor campaigns require an explicit budget.
        </p>
      </section>
    </>
  );
}

type SaveProps = {
  busy: boolean;
  error: Error | null;
  onSave(key: string, configuration: Record<string, unknown>): void;
};

function CategoryForm({ busy, error, onSave }: SaveProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [state, setState] = useState("draft");
  return (
    <Form
      title="Add a service type"
      description="Create a clear group customers will recognise, such as Cable TV or Education."
    >
      <TextInput label="Service name" value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="Cable TV" />
      <TextInput label="Short description" value={description} onChange={(e) => setDescription(e.currentTarget.value)} placeholder="Pay television subscriptions" />
      <Visibility value={state} onChange={setState} />
      <Submit
        busy={busy}
        error={error}
        disabled={!name.trim()}
        onClick={() =>
          onSave(slug(name), {
            displayName: name.trim(),
            description: description.trim() || null,
            iconKey: "receipt",
            status: state,
          })}
      />
    </Form>
  );
}

function BillerForm({
  categories,
  busy,
  error,
  onSave,
}: SaveProps & { categories: Row[] }) {
  const [category, setCategory] = useState("");
  const [name, setName] = useState("");
  const [label, setLabel] = useState("Account number");
  const [hint, setHint] = useState("");
  const [state, setState] = useState("draft");
  return (
    <Form
      title="Add a company"
      description="Add the electricity company, mobile network, television provider, or other company customers will pay."
    >
      <SelectInput label="Service type" value={category} onChange={(e) => setCategory(e.currentTarget.value)} options={options(categories, "key", "display_name", "Choose a service type")} />
      <TextInput label="Company name" value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="Company name" />
      <TextInput label="Customer detail label" value={label} onChange={(e) => setLabel(e.currentTarget.value)} placeholder="Meter number" />
      <TextInput label="Help text" value={hint} onChange={(e) => setHint(e.currentTarget.value)} placeholder="Enter the number printed on your meter" />
      <Visibility value={state} onChange={setState} />
      <Submit
        busy={busy}
        error={error}
        disabled={!category || !name.trim() || !label.trim()}
        onClick={() =>
          onSave(`${category}.${slug(name)}`, {
            categoryKey: category,
            displayName: name.trim(),
            customerIdentifierLabel: label.trim(),
            customerIdentifierHint: hint.trim() || null,
            validationMode: "provider",
            status: state,
          })}
      />
    </Form>
  );
}

function ProductForm({
  billers,
  busy,
  error,
  onSave,
}: SaveProps & { billers: Row[] }) {
  const [biller, setBiller] = useState("");
  const [name, setName] = useState("");
  const [mode, setMode] = useState("customer");
  const [fixed, setFixed] = useState("");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [state, setState] = useState("draft");
  return (
    <Form
      title="Add a payment plan"
      description="Define what customers can buy and the permitted amount range."
    >
      <SelectInput label="Company" value={biller} onChange={(e) => setBiller(e.currentTarget.value)} options={options(billers, "key", "display_name", "Choose a company")} />
      <TextInput label="Plan name" value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="Prepaid electricity" />
      <SelectInput
        label="How is the amount chosen?"
        value={mode}
        onChange={(e) => setMode(e.currentTarget.value)}
        options={[
          { label: "Customer enters an amount", value: "customer" },
          { label: "One fixed amount", value: "fixed" },
          { label: "Company supplies the price", value: "provider" },
        ]}
      />
      {mode === "fixed" ? (
        <TextInput label="Fixed amount (₦)" type="number" value={fixed} onChange={(e) => setFixed(e.currentTarget.value)} />
      ) : null}
      {mode === "customer" ? (
        <>
          <TextInput label="Minimum amount (₦)" type="number" value={min} onChange={(e) => setMin(e.currentTarget.value)} />
          <TextInput label="Maximum amount (₦)" type="number" value={max} onChange={(e) => setMax(e.currentTarget.value)} />
        </>
      ) : null}
      <Visibility value={state} onChange={setState} />
      <Submit
        busy={busy}
        error={error}
        disabled={!biller || !name.trim() || (mode === "fixed" && !positive(fixed))}
        onClick={() =>
          onSave(`${biller}.${slug(name)}`, {
            billerKey: biller,
            displayName: name.trim(),
            amountMode: mode,
            fixedAmount: numberOrNull(fixed),
            minimumAmount: numberOrNull(min),
            maximumAmount: numberOrNull(max),
            currencyCode: "NGN",
            status: state,
          })}
      />
    </Form>
  );
}

function ProviderForm({
  providers,
  busy,
  error,
  onSave,
}: SaveProps & { providers: Row[] }) {
  const [name, setName] = useState("");
  const [family, setFamily] = useState("");
  const [environment, setEnvironment] = useState("production");
  const [secretName, setSecretName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [documentationUrl, setDocumentationUrl] = useState("");
  const [state, setState] = useState("inactive");

  return (
    <Form
      title="Add a bill-payment provider"
      description="Create the SKIMA provider connection. Enter only the Edge secret name—not the API key value."
    >
      {providers.length > 0 ? (
        <div className="admin-notice">
          <strong>{providers.length} provider record{providers.length === 1 ? "" : "s"} configured</strong>
          <p>
            {providers.filter((item) => flag(item, "runtime_ready")).length} currently have a
            live fulfillment adapter.
          </p>
        </div>
      ) : null}
      <TextInput
        label="Provider name"
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        placeholder="VTpass, Reloadly, or another provider"
      />
      <TextInput
        label="Provider/API family"
        value={family}
        onChange={(e) => setFamily(e.currentTarget.value)}
        placeholder="Provider family or API type"
      />
      <SelectInput
        label="Environment"
        value={environment}
        onChange={(e) => setEnvironment(e.currentTarget.value)}
        options={[
          { label: "Production", value: "production" },
          { label: "Sandbox / test", value: "sandbox" },
        ]}
      />
      <TextInput
        label="Edge secret name"
        value={secretName}
        onChange={(e) => setSecretName(normalizeSecretName(e.currentTarget.value))}
        placeholder="UTILITY_PROVIDER_API_KEY"
      />
      <small>
        SKIMA stores only <code>SUPABASE_SECRET:{secretName || "UTILITY_PROVIDER_API_KEY"}</code>.
        The credential value must be configured in Supabase Edge Function secrets.
      </small>
      <TextInput
        label="API base URL (optional)"
        value={baseUrl}
        onChange={(e) => setBaseUrl(e.currentTarget.value)}
        placeholder="https://api.provider.example"
      />
      <TextInput
        label="Documentation URL (optional)"
        value={documentationUrl}
        onChange={(e) => setDocumentationUrl(e.currentTarget.value)}
        placeholder="https://provider.example/docs"
      />
      <SelectInput
        label="Provider record status"
        value={state}
        onChange={(e) => setState(e.currentTarget.value)}
        options={[
          { label: "Inactive while configuring", value: "inactive" },
          { label: "Active provider record", value: "active" },
          { label: "Disabled", value: "disabled" },
        ]}
      />
      <Submit
        busy={busy}
        error={error}
        disabled={!name.trim() || !family.trim() || !secretName.trim()}
        onClick={() =>
          onSave(`provider.utility.${slug(name)}`, {
            displayName: name.trim(),
            providerFamily: family.trim(),
            environment,
            secretRef: `SUPABASE_SECRET:${secretName.trim()}`,
            baseUrl: baseUrl.trim() || null,
            documentationUrl: documentationUrl.trim() || null,
            status: state,
          })}
      />
    </Form>
  );
}

function ConnectionForm({
  products,
  providers,
  busy,
  error,
  onSave,
}: {
  products: Row[];
  providers: Row[];
  busy: boolean;
  error: Error | null;
  onSave(input: {
    productKey: string;
    providerKey: string;
    productCode: string;
    priority: number;
    state: string;
    fee: number;
  }): void;
}) {
  const [product, setProduct] = useState("");
  const [provider, setProvider] = useState("");
  const [code, setCode] = useState("");
  const [fee, setFee] = useState("0");
  const [state, setState] = useState("inactive");
  const selectedProvider = providers.find((row) => text(row, "key") === provider) ?? null;
  const providerReady = selectedProvider ? flag(selectedProvider, "runtime_ready") : false;
  const secretConfigured = selectedProvider ? flag(selectedProvider, "secret_configured") : false;

  return (
    <Form
      title="Connect a payment plan"
      description="Map the customer plan to the provider product code. Keep it unavailable until the provider runtime test has passed."
    >
      {providers.length === 0 ? (
        <div className="admin-notice">
          <strong>No bill-payment provider yet</strong>
          <p>Open the Providers step first. You no longer need to leave this workspace to create one.</p>
        </div>
      ) : null}
      {selectedProvider && (!providerReady || !secretConfigured) ? (
        <div className="admin-notice">
          <strong>Not ready for customer traffic</strong>
          <p>
            {!secretConfigured
              ? "The provider does not yet have an Edge secret reference. "
              : ""}
            {!providerReady
              ? "The provider also needs a tested SKIMA fulfillment adapter before this route can go live."
              : ""}
          </p>
        </div>
      ) : null}
      <SelectInput label="Payment plan" value={product} onChange={(e) => setProduct(e.currentTarget.value)} options={options(products, "key", "display_name", "Choose a plan")} />
      <SelectInput label="Service provider" value={provider} onChange={(e) => setProvider(e.currentTarget.value)} options={options(providers, "key", "display_name", "Choose a provider")} />
      <TextInput label="Provider product code" value={code} onChange={(e) => setCode(e.currentTarget.value)} placeholder="Code supplied by the provider" />
      <TextInput label="Customer fee (₦)" type="number" value={fee} onChange={(e) => setFee(e.currentTarget.value)} />
      <SelectInput
        label="Customer availability"
        value={state}
        onChange={(e) => setState(e.currentTarget.value)}
        options={[
          { label: "Keep unavailable", value: "inactive" },
          { label: "Make available", value: "active" },
        ]}
      />
      <Submit
        busy={busy}
        error={error}
        disabled={
          !product ||
          !provider ||
          !code.trim() ||
          (state === "active" && (!providerReady || !secretConfigured))
        }
        onClick={() =>
          onSave({
            productKey: product,
            providerKey: provider,
            productCode: code.trim(),
            priority: 100,
            state,
            fee: Number(fee) || 0,
          })}
      />
    </Form>
  );
}

function PromotionForm({ busy, error, onSave }: SaveProps) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("percentage");
  const [value, setValue] = useState("");
  const [cap, setCap] = useState("");
  const [min, setMin] = useState("");
  const [total, setTotal] = useState("");
  const [perCustomer, setPerCustomer] = useState("1");
  const [state, setState] = useState("draft");

  return (
    <Form title="Create an offer" description="Set a discount and control how often it can be used.">
      <TextInput label="Offer name" value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="Welcome bill payment offer" />
      <SelectInput label="Discount type" value={kind} onChange={(e) => setKind(e.currentTarget.value)} options={[{ label: "Percentage", value: "percentage" }, { label: "Fixed amount", value: "fixed" }]} />
      <TextInput label={kind === "percentage" ? "Discount (%)" : "Discount amount (₦)"} type="number" value={value} onChange={(e) => setValue(e.currentTarget.value)} />
      {kind === "percentage" ? <TextInput label="Maximum discount (₦)" type="number" value={cap} onChange={(e) => setCap(e.currentTarget.value)} /> : null}
      <TextInput label="Minimum customer spend (₦)" type="number" value={min} onChange={(e) => setMin(e.currentTarget.value)} />
      <TextInput label="Total uses allowed" type="number" value={total} onChange={(e) => setTotal(e.currentTarget.value)} />
      <TextInput label="Uses allowed per customer" type="number" value={perCustomer} onChange={(e) => setPerCustomer(e.currentTarget.value)} />
      <Visibility value={state} onChange={setState} />
      <Submit
        busy={busy}
        error={error}
        disabled={!name.trim() || !positive(value)}
        onClick={() =>
          onSave(slug(name), {
            displayName: name.trim(),
            discountKind: kind,
            discountValue: Number(value),
            maximumDiscount: numberOrNull(cap),
            minimumSpend: numberOrNull(min),
            usageLimit: integerOrNull(total),
            perCustomerLimit: integerOrNull(perCustomer),
            status: state,
          })}
      />
    </Form>
  );
}

function CashbackForm({
  busy,
  error,
  onSave,
}: {
  busy: boolean;
  error: Error | null;
  onSave(input: {
    key: string;
    name: string;
    kind: string;
    value: number;
    cap: number | null;
    minimum: number | null;
    total: number | null;
    perCustomer: number | null;
    state: string;
  }): void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("percentage");
  const [value, setValue] = useState("");
  const [cap, setCap] = useState("");
  const [min, setMin] = useState("");
  const [total, setTotal] = useState("");
  const [perCustomer, setPerCustomer] = useState("1");
  const [state, setState] = useState("draft");

  return (
    <Form
      title="Create a cashback reward"
      description="Reward completed bill payments. Cashback is earned only after the service company confirms success."
    >
      <TextInput label="Cashback name" value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="Bills cashback" />
      <SelectInput label="Cashback type" value={kind} onChange={(e) => setKind(e.currentTarget.value)} options={[{ label: "Percentage", value: "percentage" }, { label: "Fixed amount", value: "fixed" }]} />
      <TextInput label={kind === "percentage" ? "Cashback (%)" : "Cashback amount (₦)"} type="number" value={value} onChange={(e) => setValue(e.currentTarget.value)} />
      {kind === "percentage" ? <TextInput label="Maximum cashback (₦)" type="number" value={cap} onChange={(e) => setCap(e.currentTarget.value)} /> : null}
      <TextInput label="Minimum customer spend (₦)" type="number" value={min} onChange={(e) => setMin(e.currentTarget.value)} />
      <TextInput label="Total rewards available" type="number" value={total} onChange={(e) => setTotal(e.currentTarget.value)} />
      <TextInput label="Rewards per customer" type="number" value={perCustomer} onChange={(e) => setPerCustomer(e.currentTarget.value)} />
      <Visibility value={state} onChange={setState} />
      <Submit
        busy={busy}
        error={error}
        disabled={!name.trim() || !positive(value)}
        onClick={() =>
          onSave({
            key: slug(name),
            name: name.trim(),
            kind,
            value: Number(value),
            cap: numberOrNull(cap),
            minimum: numberOrNull(min),
            total: integerOrNull(total),
            perCustomer: integerOrNull(perCustomer),
            state,
          })}
      />
    </Form>
  );
}

function Form({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="utility-guided-form">
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <div className="skima-form">{children}</div>
    </div>
  );
}

function Visibility({
  value,
  onChange,
}: {
  value: string;
  onChange(value: string): void;
}) {
  return (
    <SelectInput
      label="Visibility"
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
      options={[
        { label: "Save as draft", value: "draft" },
        { label: "Show to customers", value: "active" },
        { label: "Hide from customers", value: "inactive" },
      ]}
    />
  );
}

function Submit({
  busy,
  error,
  disabled,
  onClick,
}: {
  busy: boolean;
  error: Error | null;
  disabled: boolean;
  onClick(): void;
}) {
  return (
    <>
      {error ? (
        <div className="admin-notice is-error" role="alert">{friendly(error)}</div>
      ) : null}
      <Button icon={Save} isLoading={busy} disabled={disabled} onClick={onClick}>
        Save changes
      </Button>
    </>
  );
}

function options(
  rows: Row[],
  valueKey: string,
  labelKey: string,
  placeholder: string,
) {
  return [
    { label: placeholder, value: "" },
    ...rows
      .map((row) => ({
        label: text(row, labelKey) || "Unnamed",
        value: text(row, valueKey),
      }))
      .filter((item) => item.value),
  ];
}

function text(row: Row, key: string) {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

function flag(row: Row, key: string) {
  return row[key] === true;
}

function slug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function normalizeSecretName(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/^SUPABASE_SECRET:/, "")
    .replace(/[^A-Z0-9_]/g, "_")
    .slice(0, 100);
}

function positive(value: string) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function numberOrNull(value: string) {
  return value.trim() === "" ? null : Number(value);
}

function integerOrNull(value: string) {
  return value.trim() === "" ? null : Math.max(1, Math.trunc(Number(value)));
}

function friendly(error: Error) {
  return error.message.replaceAll("target_", "").replaceAll("_", " ");
}
