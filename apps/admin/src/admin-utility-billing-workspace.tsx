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
  | "live-test"
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
  { key: "live-test", label: "Live test", detail: "Verify a small real-money vend safely" },
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

  const campaignPool = useQuery({
    queryKey: ["admin-utility-campaign-pool"],
    enabled: status === "authenticated",
    retry: false,
    queryFn: () =>
      api.get(
        "/admin/utility-billing/campaign-pool?currency=NGN",
        PreviewSchema,
      ),
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

  const setProviderStatus = useMutation({
    mutationFn: (input: { providerKey: string; status: string }) =>
      api.post(
        "/admin/utility-billing/providers/status",
        input,
        MutationIdSchema,
      ),
    onSuccess: async () =>
      client.invalidateQueries({ queryKey: ["admin-utility-billing"] }),
  });

  const testProvider = useMutation({
    mutationFn: (providerKey: string) =>
      api.post(
        "/admin/utility-billing/providers/test",
        { providerKey },
        PreviewSchema,
      ),
    onSuccess: async () =>
      client.invalidateQueries({ queryKey: ["admin-utility-billing"] }),
  });

  const syncCatalog = useMutation({
    mutationFn: (providerKey: string) =>
      api.post(
        "/admin/utility-billing/catalog-sync/run",
        { providerKey },
        PreviewSchema,
      ),
    onSuccess: async () =>
      client.invalidateQueries({ queryKey: ["admin-utility-billing"] }),
  });

  const liveProviderTest = useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      api.post(
        "/admin/utility-billing/providers/live-test",
        input,
        PreviewSchema,
      ),
    onSuccess: async () =>
      client.invalidateQueries({ queryKey: ["admin-utility-billing"] }),
  });

  const liveProviderStatus = useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      api.post(
        "/admin/utility-billing/providers/live-test/status",
        input,
        PreviewSchema,
      ),
    onSuccess: async () =>
      client.invalidateQueries({ queryKey: ["admin-utility-billing"] }),
  });

  const fundCampaignPool = useMutation({
    mutationFn: (amount: number) =>
      api.post(
        "/admin/utility-billing/campaign-pool/fund",
        {
          amount,
          currencyCode: "NGN",
          idempotencyKey: `utility-campaign-pool:${crypto.randomUUID()}`,
          metadata: { source: "skima.admin.utility_billing" },
        },
        MutationIdSchema,
      ),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["admin-utility-campaign-pool"] });
      await client.invalidateQueries({ queryKey: ["admin-utility-billing"] });
    },
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
            testBusy={testProvider.isPending}
            statusBusy={setProviderStatus.isPending}
            error={save.error ?? testProvider.error ?? setProviderStatus.error}
            testResult={testProvider.data ?? null}
            onSave={(key, configuration) =>
              save.mutate({ kind: "provider", key, configuration })}
            onTest={(providerKey) => testProvider.mutate(providerKey)}
            onStatus={(providerKey, nextStatus) =>
              setProviderStatus.mutate({ providerKey, status: nextStatus })}
          />
        ) : null}
        {step === "catalog" ? (
          <CatalogSyncOverview
            providers={data?.providers ?? []}
            syncRuns={data?.syncRuns ?? []}
            busy={syncCatalog.isPending}
            error={syncCatalog.error}
            result={syncCatalog.data ?? null}
            onSync={(providerKey) => syncCatalog.mutate(providerKey)}
          />
        ) : null}
        {step === "live-test" ? (
          <LiveProviderTestForm
            providers={data?.providers ?? []}
            products={data?.products ?? []}
            routes={data?.routes ?? []}
            busy={liveProviderTest.isPending}
            statusBusy={liveProviderStatus.isPending}
            error={liveProviderTest.error ?? liveProviderStatus.error}
            result={liveProviderStatus.data ?? liveProviderTest.data ?? null}
            onRun={(input) => liveProviderTest.mutate(input)}
            onCheck={(input) => liveProviderStatus.mutate(input)}
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
            campaignPool={campaignPool.data ?? null}
            preview={previewCampaign.data ?? null}
            previewBusy={previewCampaign.isPending}
            saveBusy={saveCampaign.isPending}
            fundBusy={fundCampaignPool.isPending}
            error={previewCampaign.error ?? saveCampaign.error ?? fundCampaignPool.error}
            onPreview={(input) => previewCampaign.mutate(input)}
            onSave={(input) => saveCampaign.mutate(input)}
            onFundPool={(amount) => fundCampaignPool.mutate(amount)}
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
  testBusy,
  statusBusy,
  error,
  testResult,
  onSave,
  onTest,
  onStatus,
}: SaveProps & {
  providers: Row[];
  testBusy: boolean;
  statusBusy: boolean;
  testResult: Row | null;
  onTest(providerKey: string): void;
  onStatus(providerKey: string, status: string): void;
}) {
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
      {providers.map((provider) => (
        <div className="admin-summary-row" key={text(provider, "id") || text(provider, "key")}>
          <div>
            <strong>{text(provider, "display_name") || text(provider, "key")}</strong>
            <p>
              {friendlyText(text(provider, "status") || "inactive")} ·
              {" "}{flag(provider, "catalog_sync_ready") ? "Catalogue adapter installed" : "No catalogue adapter"} ·
              {" "}{flag(provider, "secret_configured") ? "Edge secret reference saved" : "No Edge secret reference"}
            </p>
          </div>
          <div className="admin-action-row">
            <Button
              variant="outline"
              isLoading={testBusy}
              onClick={() => onTest(text(provider, "key"))}
            >
              Test API connection
            </Button>
            <Button
              variant="outline"
              isLoading={statusBusy}
              disabled={
                text(provider, "status") !== "active" &&
                (!flag(provider, "runtime_ready") || !flag(provider, "secret_configured"))
              }
              onClick={() =>
                onStatus(
                  text(provider, "key"),
                  text(provider, "status") === "active" ? "inactive" : "active",
                )}
            >
              {text(provider, "status") === "active" ? "Pause provider" : "Activate provider"}
            </Button>
          </div>
        </div>
      ))}
      {testResult ? (
        <div className="admin-notice">
          <strong>Provider connection responded</strong>
          <p>
            {text(testResult, "providerName") || "Provider"} returned
            {" "}{numberValue(testResult, "categoryCount")} bill categories in
            {" "}{numberValue(testResult, "latencyMs")} ms.
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
  routes,
  economics,
  busy,
  error,
  onSave,
}: {
  products: Row[];
  providers: Row[];
  routes: Row[];
  economics: Row[];
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
  const [state, setState] = useState("inactive");
  const selectedProvider = providers.find((row) => text(row, "key") === provider) ?? null;
  const providerReady = selectedProvider ? flag(selectedProvider, "runtime_ready") : false;
  const secretConfigured = selectedProvider ? flag(selectedProvider, "secret_configured") : false;
  const routeExists = routes.some(
    (row) =>
      text(row, "product_key") === product &&
      text(row, "provider_key") === provider,
  );
  const economicsReady = economics.some(
    (row) =>
      text(row, "product_key") === product &&
      text(row, "provider_key") === provider &&
      text(row, "status") === "active",
  );

  return (
    <Form
      title="Connect a payment plan"
      description="Map the SKIMA product to the provider code. Create the route first, configure its economics, then activate it only after the provider runtime is tested."
    >
      {providers.length === 0 ? (
        <div className="admin-notice">
          <strong>No bill-payment provider yet</strong>
          <p>Open the Providers step first. You no longer need to leave this workspace to create one.</p>
        </div>
      ) : null}
      {selectedProvider && (!providerReady || !secretConfigured || (routeExists && !economicsReady)) ? (
        <div className="admin-notice">
          <strong>Not ready for customer traffic</strong>
          <p>
            {!secretConfigured
              ? "The provider does not yet have an Edge secret reference. "
              : ""}
            {!providerReady
              ? "A tested SKIMA fulfillment adapter is still required. "
              : ""}
            {routeExists && !economicsReady
              ? "Configure this route in the Economics step before activating it."
              : ""}
          </p>
        </div>
      ) : null}
      <SelectInput label="Payment plan" value={product} onChange={(e) => setProduct(e.currentTarget.value)} options={options(products, "key", "display_name", "Choose a plan")} />
      <SelectInput label="Service provider" value={provider} onChange={(e) => setProvider(e.currentTarget.value)} options={options(providers, "key", "display_name", "Choose a provider")} />
      <TextInput label="Provider product code" value={code} onChange={(e) => setCode(e.currentTarget.value)} placeholder="Code supplied by the provider" />
      <div className="admin-notice">
        <strong>Fees moved to Economics</strong>
        <p>Customer fees, provider commission, collection cost, reserve and minimum profit are configured together so SKIMA can calculate real contribution before a route goes live.</p>
      </div>
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
          (state === "active" && (!providerReady || !secretConfigured || !economicsReady))
        }
        onClick={() =>
          onSave({
            productKey: product,
            providerKey: provider,
            productCode: code.trim(),
            priority: 100,
            state,
            fee: 0,
          })}
      />
    </Form>
  );
}

function CatalogSyncOverview({
  providers,
  syncRuns,
  busy,
  error,
  result,
  onSync,
}: {
  providers: Row[];
  syncRuns: Row[];
  busy: boolean;
  error: Error | null;
  result: Row | null;
  onSync(providerKey: string): void;
}) {
  const syncReady = providers.filter((row) => flag(row, "catalog_sync_ready"));
  return (
    <Form
      title="Provider catalogue sync"
      description="The provider-specific adapter converts its own catalogue into SKIMA's generic category → company → product contract. SKIMA publishes synced records as drafts so you decide what customers can see."
    >
      <div className="admin-notice">
        <strong>Do not manually copy hundreds of provider plans</strong>
        <p>
          Airtime networks, electricity distributors and data bundles should normally
          come from the connected provider. Manual Service types, Companies and Plans
          remain available only as a fallback.
        </p>
      </div>
      <div className="admin-summary-row">
        <div>
          <strong>Providers with catalogue sync</strong>
          <p>{syncReady.length} of {providers.length} configured providers expose the generic sync contract.</p>
        </div>
        <div>
          <strong>Recent sync runs</strong>
          <p>{syncRuns.length}</p>
        </div>
      </div>
      {providers.map((provider) => (
        <div className="admin-summary-row" key={text(provider, "id") || text(provider, "key")}>
          <div>
            <strong>{text(provider, "display_name") || text(provider, "key")}</strong>
            <p>
              {flag(provider, "catalog_sync_ready")
                ? "Ready to import this provider's categories, companies and plans."
                : "This provider does not have a catalogue adapter installed yet."}
            </p>
          </div>
          <Button
            variant="outline"
            isLoading={busy}
            disabled={!flag(provider, "catalog_sync_ready")}
            onClick={() => onSync(text(provider, "key"))}
          >
            Sync catalogue
          </Button>
        </div>
      ))}
      {error ? <div className="admin-notice is-error" role="alert">{friendly(error)}</div> : null}
      {result ? (
        <div className="admin-notice">
          <strong>Catalogue sync completed</strong>
          <p>
            Imported {numberValue(result, "itemCount")} provider catalogue items.
            They remain subject to SKIMA curation, economics and route activation.
          </p>
        </div>
      ) : null}
      {syncRuns.slice(0, 5).map((run) => (
        <div className="admin-summary-row" key={text(run, "id")}>
          <div>
            <strong>{text(run, "provider_name") || "Utility provider"}</strong>
            <p>{friendlyText(text(run, "status") || "running")}</p>
          </div>
          <div>
            <strong>{numberValue(run, "item_count")}</strong>
            <p>catalogue items</p>
          </div>
        </div>
      ))}
      {providers.length > 0 && syncReady.length === 0 ? (
        <div className="admin-notice">
          <strong>Provider adapter not installed yet</strong>
          <p>
            This is expected until we choose the first provider. The database and API
            sync contract are already provider-neutral; the future adapter only needs to
            translate that provider's response into SKIMA's canonical catalogue payload.
          </p>
        </div>
      ) : null}
    </Form>
  );
}

function LiveProviderTestForm({
  providers,
  products,
  routes,
  busy,
  statusBusy,
  error,
  result,
  onRun,
  onCheck,
}: {
  providers: Row[];
  products: Row[];
  routes: Row[];
  busy: boolean;
  statusBusy: boolean;
  error: Error | null;
  result: Row | null;
  onRun(input: Record<string, unknown>): void;
  onCheck(input: Record<string, unknown>): void;
}) {
  const [providerKey, setProviderKey] = useState("");
  const [routeId, setRouteId] = useState("");
  const [billerCode, setBillerCode] = useState("");
  const [customerIdentifier, setCustomerIdentifier] = useState("");
  const [amount, setAmount] = useState("100");
  const [confirmed, setConfirmed] = useState(false);

  const provider = providers.find((item) => text(item, "key") === providerKey) ?? null;
  const providerRoutes = routes.filter(
    (item) => !providerKey || text(item, "provider_key") === providerKey,
  );
  const route = providerRoutes.find((item) => text(item, "id") === routeId) ?? null;
  const productKey = route ? text(route, "product_key") : "";
  const product = products.find((item) => text(item, "key") === productKey) ?? null;
  const productMetadata = product ? objectValue(product, "metadata") : null;
  const mappedBillerCode =
    productMetadata ? text(productMetadata, "providerBillerCode") : "";
  const resolvedBillerCode = billerCode.trim() || mappedBillerCode;
  const itemCode = route ? text(route, "provider_product_code") : "";
  const resultReference =
    result ? text(result, "reference") || text(result, "providerReference") : "";
  const resultStatus = result ? text(result, "status") : "";
  const runtimeReady = result?.runtimeReady === true;

  return (
    <Form
      title="Run a small real-money provider test"
      description="This readiness check vends a real service directly from the provider's funded source balance. It does not debit a SKIMA customer wallet."
    >
      <div className="admin-notice">
        <strong>Do this only after the live Edge secret is configured</strong>
        <p>
          Start with your own phone number or meter and a small amount. SKIMA limits this
          admin test to ₦5,000 per request. A successful provider result is what marks the
          fulfillment runtime ready; saving a key or passing a catalogue call is not enough.
        </p>
      </div>
      <SelectInput
        label="Provider"
        value={providerKey}
        onChange={(event) => {
          setProviderKey(event.currentTarget.value);
          setRouteId("");
          setBillerCode("");
          setConfirmed(false);
        }}
        options={options(providers, "key", "display_name", "Choose provider")}
      />
      {provider ? (
        <div className="admin-summary-row">
          <div>
            <strong>{text(provider, "display_name") || providerKey}</strong>
            <p>
              {flag(provider, "secret_configured") ? "Edge secret reference saved" : "Edge secret reference missing"} ·
              {" "}{flag(provider, "runtime_ready") ? "Live vend already verified" : "Live vend not verified yet"}
            </p>
          </div>
        </div>
      ) : null}
      <SelectInput
        label="Provider product route"
        value={routeId}
        onChange={(event) => {
          setRouteId(event.currentTarget.value);
          setBillerCode("");
          setConfirmed(false);
        }}
        options={[
          { label: "Choose a synced product route", value: "" },
          ...providerRoutes.map((item) => ({
            value: text(item, "id"),
            label: `${text(item, "product_name") || text(item, "product_key") || "Product"} → ${text(item, "provider_name") || "Provider"}`,
          })),
        ]}
      />
      <TextInput
        label="Provider biller code"
        value={resolvedBillerCode}
        onChange={(event) => setBillerCode(event.currentTarget.value)}
        placeholder="Usually imported from the provider catalogue"
      />
      {mappedBillerCode ? (
        <small>Imported biller mapping: <code>{mappedBillerCode}</code></small>
      ) : (
        <small>The catalogue adapter should normally populate this. Enter it manually only when the provider mapping is missing.</small>
      )}
      <TextInput
        label="Real recipient / account identifier"
        value={customerIdentifier}
        onChange={(event) => {
          setCustomerIdentifier(event.currentTarget.value);
          setConfirmed(false);
        }}
        placeholder="Your phone number or meter/account number"
      />
      <TextInput
        label="Real test amount (₦)"
        type="number"
        value={amount}
        onChange={(event) => {
          setAmount(event.currentTarget.value);
          setConfirmed(false);
        }}
      />
      <label className="admin-checkbox-row">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.currentTarget.checked)}
        />
        <span>
          I understand this is a real provider transaction and the provider's funded
          balance may be charged.
        </span>
      </label>
      {error ? <div className="admin-notice is-error" role="alert">{friendly(error)}</div> : null}
      <Button
        icon={Zap}
        isLoading={busy}
        disabled={
          !providerKey ||
          !routeId ||
          !resolvedBillerCode ||
          !itemCode ||
          !customerIdentifier.trim() ||
          !positive(amount) ||
          numeric(amount) > 5000 ||
          !confirmed
        }
        onClick={() =>
          onRun({
            providerKey,
            billerCode: resolvedBillerCode,
            itemCode,
            customerIdentifier: customerIdentifier.trim(),
            amount: numeric(amount),
            confirmLiveSpend: true,
          })}
      >
        Send real test
      </Button>
      {result ? (
        <div className={runtimeReady ? "admin-notice" : "admin-notice"}>
          <strong>
            {runtimeReady
              ? "Live provider fulfillment verified"
              : `Provider result: ${friendlyText(resultStatus || "processing")}`}
          </strong>
          <p>
            Reference: {resultReference || "Provider reference pending"}.
            {runtimeReady
              ? " SKIMA may now treat this adapter as live-runtime ready."
              : " If the provider returned a pending/processing result, check it before enabling customer routes."}
          </p>
        </div>
      ) : null}
      {resultReference && !runtimeReady ? (
        <Button
          variant="outline"
          isLoading={statusBusy}
          onClick={() => onCheck({ providerKey, reference: resultReference })}
        >
          Check live test status
        </Button>
      ) : null}
    </Form>
  );
}

function EconomicsForm({
  routes,
  economics,
  busy,
  previewBusy,
  error,
  preview,
  onSave,
  onPreview,
}: {
  routes: Row[];
  economics: Row[];
  busy: boolean;
  previewBusy: boolean;
  error: Error | null;
  preview: Row | null;
  onSave(input: Record<string, unknown>): void;
  onPreview(input: Record<string, unknown>): void;
}) {
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
  const [state, setState] = useState("active");

  const route = routes.find((item) => text(item, "id") === routeId) ?? null;
  const productKey = route ? text(route, "product_key") : "";
  const providerKey = route ? text(route, "provider_key") : "";
  const existing = economics.find(
    (item) =>
      text(item, "product_key") === productKey &&
      text(item, "provider_key") === providerKey,
  );

  return (
    <Form
      title="Set route economics"
      description="Enter the provider commission/discount and SKIMA's variable costs. These numbers are generic and belong to the route, not to any hardcoded provider."
    >
      <SelectInput
        label="Product → provider route"
        value={routeId}
        onChange={(event) => setRouteId(event.currentTarget.value)}
        options={[
          { label: "Choose a route", value: "" },
          ...routes.map((item) => ({
            value: text(item, "id"),
            label: `${text(item, "product_name") || "Product"} → ${text(item, "provider_name") || "Provider"}`,
          })),
        ]}
      />
      {existing ? (
        <div className="admin-notice">
          <strong>Economics already configured</strong>
          <p>
            Current state: {friendlyText(text(existing, "status") || "inactive")}.
            Saving below updates the protected model.
          </p>
        </div>
      ) : null}
      <TextInput label="Provider discount / commission (%)" type="number" value={providerDiscountPercent} onChange={(e) => setProviderDiscountPercent(e.currentTarget.value)} placeholder="3" />
      <TextInput label="Provider fixed discount (₦)" type="number" value={providerDiscountFixed} onChange={(e) => setProviderDiscountFixed(e.currentTarget.value)} placeholder="0" />
      <TextInput label="Allocated collection cost (%)" type="number" value={collectionCostPercent} onChange={(e) => setCollectionCostPercent(e.currentTarget.value)} placeholder="0.5" />
      <TextInput label="Allocated collection cost fixed (₦)" type="number" value={collectionCostFixed} onChange={(e) => setCollectionCostFixed(e.currentTarget.value)} placeholder="0" />
      <TextInput label="Operating / risk reserve (%)" type="number" value={reservePercent} onChange={(e) => setReservePercent(e.currentTarget.value)} placeholder="0.5" />
      <TextInput label="Operating / risk reserve fixed (₦)" type="number" value={reserveFixed} onChange={(e) => setReserveFixed(e.currentTarget.value)} placeholder="0" />
      <TextInput label="Minimum SKIMA profit (%)" type="number" value={minimumProfitPercent} onChange={(e) => setMinimumProfitPercent(e.currentTarget.value)} placeholder="1" />
      <TextInput label="Minimum SKIMA profit fixed (₦)" type="number" value={minimumProfitFixed} onChange={(e) => setMinimumProfitFixed(e.currentTarget.value)} placeholder="0" />
      <TextInput label="Customer convenience fee (%)" type="number" value={customerFeePercent} onChange={(e) => setCustomerFeePercent(e.currentTarget.value)} placeholder="0" />
      <TextInput label="Customer convenience fee fixed (₦)" type="number" value={customerFeeFixed} onChange={(e) => setCustomerFeeFixed(e.currentTarget.value)} placeholder="0" />
      <TextInput label="Smallest amount used for profit checks (₦)" type="number" value={minimumAmount} onChange={(e) => setMinimumAmount(e.currentTarget.value)} />
      <SelectInput
        label="Economics status"
        value={state}
        onChange={(e) => setState(e.currentTarget.value)}
        options={[
          { label: "Active protection", value: "active" },
          { label: "Inactive", value: "inactive" },
        ]}
      />
      {error ? <div className="admin-notice is-error" role="alert">{friendly(error)}</div> : null}
      <Button
        icon={Save}
        isLoading={busy}
        disabled={!productKey || !providerKey}
        onClick={() =>
          onSave({
            productKey,
            providerAdapterKey: providerKey,
            providerDiscountPercent: numeric(providerDiscountPercent),
            providerDiscountFixed: numeric(providerDiscountFixed),
            collectionCostPercent: numeric(collectionCostPercent),
            collectionCostFixed: numeric(collectionCostFixed),
            operatingReservePercent: numeric(reservePercent),
            operatingReserveFixed: numeric(reserveFixed),
            minimumProfitPercent: numeric(minimumProfitPercent),
            minimumProfitFixed: numeric(minimumProfitFixed),
            customerFeePercent: numeric(customerFeePercent),
            customerFeeFixed: numeric(customerFeeFixed),
            minimumEconomicAmount: numeric(minimumAmount, 100),
            status: state,
          })}
      >
        Save protected economics
      </Button>
      <TextInput label="Preview transaction amount (₦)" type="number" value={previewAmount} onChange={(e) => setPreviewAmount(e.currentTarget.value)} />
      <Button
        variant="outline"
        isLoading={previewBusy}
        disabled={!productKey || !providerKey || !positive(previewAmount)}
        onClick={() =>
          onPreview({
            productKey,
            providerAdapterKey: providerKey,
            faceAmount: numeric(previewAmount),
          })}
      >
        Preview profit
      </Button>
      {preview ? <EconomicsPreview preview={preview} /> : null}
    </Form>
  );
}

function EconomicsPreview({ preview }: { preview: Row }) {
  const safe = preview.profitable === true;
  return (
    <div className={safe ? "admin-notice" : "admin-notice is-error"}>
      <strong>{safe ? "Protected profit passes" : "Profit floor is not protected"}</strong>
      <p>
        Provider cost {formatNaira(numberValue(preview, "providerCost"))} · provider margin {formatNaira(numberValue(preview, "providerDiscount"))} · customer fee {formatNaira(numberValue(preview, "customerFee"))}
      </p>
      <p>
        Collection {formatNaira(numberValue(preview, "collectionCost"))} · reserve {formatNaira(numberValue(preview, "operatingReserve"))} · minimum profit {formatNaira(numberValue(preview, "minimumProfit"))}
      </p>
      <p>
        Maximum ordinary campaign spend at this amount: <strong>{formatNaira(numberValue(preview, "maxSafeMarginCampaign"))}</strong>. Contribution after current campaign cost: <strong>{formatNaira(numberValue(preview, "contributionProfit"))}</strong>.
      </p>
    </div>
  );
}

function CampaignForm({
  categories,
  billers,
  products,
  promotions,
  cashbacks,
  campaignPool,
  preview,
  previewBusy,
  saveBusy,
  fundBusy,
  error,
  onPreview,
  onSave,
  onFundPool,
}: {
  categories: Row[];
  billers: Row[];
  products: Row[];
  promotions: Row[];
  cashbacks: Row[];
  campaignPool: Row | null;
  preview: Row | null;
  previewBusy: boolean;
  saveBusy: boolean;
  fundBusy: boolean;
  error: Error | null;
  onPreview(input: Record<string, unknown>): void;
  onSave(input: Record<string, unknown>): void;
  onFundPool(amount: number): void;
}) {
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
  const [state, setState] = useState("draft");
  const [poolTopUp, setPoolTopUp] = useState("");

  const scopeRows =
    scopeType === "category"
      ? categories
      : scopeType === "biller"
        ? billers
        : scopeType === "product"
          ? products
          : [];

  const payload = {
    campaignType,
    scopeType,
    scopeKey: scopeType === "all" ? null : scopeKey,
    calculationKind: kind,
    value: numeric(value),
    maximumAmount: numberOrNull(maximum),
    minimumSpend: numberOrNull(minimumSpend),
    fundingMode,
  };

  const routeRows = preview && Array.isArray(preview.routes)
    ? preview.routes.filter((item): item is Row => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
  const previewSafe = preview?.safe === true;
  const firstEconomics = routeRows.length > 0 ? objectValue(routeRows[0], "economics") : null;

  return (
    <Form
      title="Create a profit-safe campaign"
      description="Cashback and discounts use the same margin guard. Ordinary campaigns can spend only the margin left after collection cost, reserve and SKIMA's minimum profit."
    >
      <div className="admin-notice">
        <strong>{promotions.length + cashbacks.length} campaigns configured</strong>
        <p>
          Margin-funded is the safe default. Use Marketing budget or Sponsor only
          when a separate funded pool is intentionally paying the reward.
        </p>
      </div>
      <div className="admin-summary-row">
        <div>
          <strong>Funded campaign pool</strong>
          <p>
            {formatNaira(campaignPool ? numberValue(campaignPool, "balance") : 0)}
            {" "}available for marketing/sponsor subsidies.
          </p>
        </div>
      </div>
      <TextInput
        label="Move SKIMA revenue into campaign pool (₦)"
        type="number"
        value={poolTopUp}
        onChange={(event) => setPoolTopUp(event.currentTarget.value)}
        placeholder="Optional"
      />
      <Button
        variant="outline"
        isLoading={fundBusy}
        disabled={!positive(poolTopUp)}
        onClick={() => onFundPool(numeric(poolTopUp))}
      >
        Fund campaign pool
      </Button>
      <small>
        This moves already-earned SKIMA revenue into a dedicated campaign wallet. It
        does not create money or borrow from customer balances.
      </small>
      <SelectInput
        label="Campaign type"
        value={campaignType}
        onChange={(e) => setCampaignType(e.currentTarget.value)}
        options={[
          { label: "Cashback after provider success", value: "cashback" },
          { label: "Instant discount", value: "discount" },
        ]}
      />
      <TextInput label="Campaign name" value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="Weekend airtime cashback" />
      <SelectInput
        label="Target"
        value={scopeType}
        onChange={(e) => {
          setScopeType(e.currentTarget.value);
          setScopeKey("");
        }}
        options={[
          { label: "All utility services", value: "all" },
          { label: "One service type", value: "category" },
          { label: "One company / network", value: "biller" },
          { label: "One product / plan", value: "product" },
        ]}
      />
      {scopeType !== "all" ? (
        <SelectInput
          label={scopeType === "category" ? "Service type" : scopeType === "biller" ? "Company / network" : "Product / plan"}
          value={scopeKey}
          onChange={(e) => setScopeKey(e.currentTarget.value)}
          options={options(scopeRows, "key", "display_name", "Choose target")}
        />
      ) : null}
      <SelectInput
        label="Reward calculation"
        value={kind}
        onChange={(e) => setKind(e.currentTarget.value)}
        options={[
          { label: "Percentage", value: "percentage" },
          { label: "Fixed naira amount", value: "fixed" },
        ]}
      />
      <TextInput label={kind === "percentage" ? "Reward / discount (%)" : "Reward / discount (₦)"} type="number" value={value} onChange={(e) => setValue(e.currentTarget.value)} />
      {kind === "percentage" ? <TextInput label="Maximum reward per transaction (₦)" type="number" value={maximum} onChange={(e) => setMaximum(e.currentTarget.value)} /> : null}
      <TextInput label="Minimum purchase (₦)" type="number" value={minimumSpend} onChange={(e) => setMinimumSpend(e.currentTarget.value)} />
      <SelectInput
        label="Funding"
        value={fundingMode}
        onChange={(e) => setFundingMode(e.currentTarget.value)}
        options={[
          { label: "Route margin — must remain profitable", value: "margin" },
          { label: "SKIMA marketing budget", value: "marketing_budget" },
          { label: "Sponsor-funded", value: "sponsor" },
        ]}
      />
      {fundingMode !== "margin" ? (
        <TextInput label="Campaign budget (₦)" type="number" value={budget} onChange={(e) => setBudget(e.currentTarget.value)} />
      ) : null}
      {fundingMode === "sponsor" ? (
        <TextInput label="Sponsor reference" value={sponsorReference} onChange={(e) => setSponsorReference(e.currentTarget.value)} placeholder="Agreement or sponsor reference" />
      ) : null}
      <TextInput label="Total uses allowed (optional)" type="number" value={usageLimit} onChange={(e) => setUsageLimit(e.currentTarget.value)} />
      <TextInput label="Uses per customer" type="number" value={perCustomer} onChange={(e) => setPerCustomer(e.currentTarget.value)} />
      <SelectInput
        label="Campaign state"
        value={state}
        onChange={(e) => setState(e.currentTarget.value)}
        options={[
          { label: "Draft", value: "draft" },
          { label: "Activate after profit check", value: "active" },
          { label: "Inactive", value: "inactive" },
        ]}
      />
      {error ? <div className="admin-notice is-error" role="alert">{friendly(error)}</div> : null}
      <Button
        variant="outline"
        isLoading={previewBusy}
        disabled={!positive(value) || (scopeType !== "all" && !scopeKey)}
        onClick={() => onPreview(payload)}
      >
        Check campaign profit
      </Button>
      {preview ? (
        <div className={previewSafe ? "admin-notice" : "admin-notice is-error"}>
          <strong>{previewSafe ? "Campaign passes profit protection" : "Campaign is not safe to activate"}</strong>
          <p>{numberValue(preview, "routeCount")} active route(s) checked.</p>
          {firstEconomics ? (
            <p>
              Example protected margin available: {formatNaira(numberValue(firstEconomics, "maxSafeMarginCampaign"))}; contribution after campaign: {formatNaira(numberValue(firstEconomics, "contributionProfit"))}.
            </p>
          ) : null}
        </div>
      ) : null}
      <Button
        icon={Save}
        isLoading={saveBusy}
        disabled={
          !name.trim() ||
          !positive(value) ||
          (scopeType !== "all" && !scopeKey) ||
          (fundingMode !== "margin" && !positive(budget)) ||
          (state === "active" && !previewSafe)
        }
        onClick={() =>
          onSave({
            ...payload,
            key: `utility.${campaignType}.${slug(name)}`,
            displayName: name.trim(),
            description: null,
            budgetAmount: fundingMode === "margin" ? null : numberOrNull(budget),
            sponsorReference: sponsorReference.trim() || null,
            usageLimit: integerOrNull(usageLimit),
            perCustomerLimit: integerOrNull(perCustomer),
            startsAt: null,
            endsAt: null,
            status: state,
          })}
      >
        Save campaign
      </Button>
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

function numeric(value: string, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function numberValue(row: Row, key: string) {
  const value = row[key];
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function objectValue(row: Row, key: string): Row | null {
  const value = row[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Row
    : null;
}

function formatNaira(value: number) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 2,
  }).format(value);
}

function friendlyText(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
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
