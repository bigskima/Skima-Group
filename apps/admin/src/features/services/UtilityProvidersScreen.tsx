import { useMutation } from "@tanstack/react-query";
import { PlugZap, Plus, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";

import { Button, Dialog, SelectInput, StatusBadge, TextAreaInput, TextInput } from "@skima/ui";

import { useSessionState } from "../../session";
import { AdminFormSection, AdminTaskFlow, AdminV2PageHeader, type AdminTaskFlowStep } from "../../shared/patterns/AdminV2Patterns";
import {
  UtilityMutationIdSchema,
  UtilityPreviewSchema,
  friendlyUtilityText,
  normalizeUtilitySecretName,
  utilityError,
  utilityFlag,
  utilitySlug,
  utilityText,
  type UtilitySnapshot,
} from "./utility-billing-v2-shared";

const providerSteps: readonly AdminTaskFlowStep[] = [
  { key: "identity", label: "Provider", description: "Name and environment" },
  { key: "connection", label: "Connection", description: "Secret and API contract" },
  { key: "review", label: "Review", description: "Verify and save" },
];

export function UtilityProvidersScreen(props: {
  data: UtilitySnapshot;
  refresh: () => Promise<void>;
}) {
  const { api } = useSessionState();
  const [adding, setAdding] = useState(false);
  const [testResult, setTestResult] = useState<Record<string, unknown> | null>(null);

  const setProviderStatus = useMutation({
    mutationFn: (input: { providerKey: string; status: string }) =>
      api.post("/admin/utility-billing/providers/status", input, UtilityMutationIdSchema),
    onSuccess: props.refresh,
  });
  const testProvider = useMutation({
    mutationFn: (providerKey: string) =>
      api.post("/admin/utility-billing/providers/test", { providerKey }, UtilityPreviewSchema),
    onSuccess: async (result) => {
      setTestResult(result);
      await props.refresh();
    },
  });

  return (
    <div className="utility-v2__screen">
      <AdminV2PageHeader
        eyebrow="Utility billing · Providers"
        title="Provider connections"
        description="Connect any compatible bill-payment REST API from configuration. Provider credentials stay in Supabase Edge secrets, while SKIMA stores only the secret name and API contract."
        actions={<Button icon={Plus} onClick={() => setAdding(true)}>Add provider</Button>}
      />

      <section className="admin-notice">
        <strong>Providers are no longer tied to an app release</strong>
        <p>Add or switch a provider here, map its API once, test it and route products to it. Airtime, data and electricity screens continue using the same SKIMA utility contract.</p>
      </section>

      <section className="sk-panel">
        <div className="sk-panel__header"><div><h2>Connected providers</h2><p className="skima-muted">A provider must have a server-side secret and pass a real provider test before customer routes can safely go live.</p></div><StatusBadge>{props.data.providers.length}</StatusBadge></div>
        <div className="utility-v2__record-list">
          {props.data.providers.map((provider) => {
            const key = utilityText(provider, "key");
            const active = utilityText(provider, "status") === "active";
            const runtimeReady = utilityFlag(provider, "runtime_ready");
            const secretReady = utilityFlag(provider, "secret_configured");
            return (
              <article className="utility-v2__record" key={utilityText(provider, "id") || key}>
                <span className="utility-v2__record-icon"><PlugZap aria-hidden="true" /></span>
                <span className="utility-v2__record-copy">
                  <strong>{utilityText(provider, "display_name") || key || "Utility provider"}</strong>
                  <small>{friendlyUtilityText(utilityText(provider, "provider_family") || "Generic provider")}</small>
                  <span>
                    <StatusBadge tone={runtimeReady ? "success" : "warning"}>{runtimeReady ? "Live vend verified" : "Live vend not verified"}</StatusBadge>{" "}
                    <StatusBadge tone={secretReady ? "success" : "warning"}>{secretReady ? "Secret reference ready" : "Secret reference missing"}</StatusBadge>
                  </span>
                </span>
                <span className="skima-action-row">
                  <Button size="sm" variant="outline" isLoading={testProvider.isPending && testProvider.variables === key} onClick={() => testProvider.mutate(key)}>Test API</Button>
                  <Button
                    size="sm"
                    variant={active ? "outline" : "primary"}
                    isLoading={setProviderStatus.isPending && setProviderStatus.variables?.providerKey === key}
                    disabled={!active && (!runtimeReady || !secretReady)}
                    onClick={() => setProviderStatus.mutate({ providerKey: key, status: active ? "inactive" : "active" })}
                  >
                    {active ? "Pause" : "Activate"}
                  </Button>
                </span>
              </article>
            );
          })}
          {props.data.providers.length === 0 ? <p className="skima-muted">No utility providers have been configured yet.</p> : null}
        </div>
      </section>

      {testResult ? (
        <section className="admin-notice">
          <strong>Provider API responded</strong>
          <p>The provider connection returned successfully. Complete a small live vend in Live Test before treating fulfillment as production-ready.</p>
        </section>
      ) : null}
      {testProvider.error || setProviderStatus.error ? <StatusBadge tone="danger">{utilityError(testProvider.error ?? setProviderStatus.error)}</StatusBadge> : null}

      <AddProviderDialog open={adding} onClose={() => setAdding(false)} onSaved={async () => { setAdding(false); await props.refresh(); }} />
    </div>
  );
}

function AddProviderDialog(props: { open: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const { api } = useSessionState();
  const [step, setStep] = useState("identity");
  const [name, setName] = useState("");
  const [family, setFamily] = useState("");
  const [environment, setEnvironment] = useState("production");
  const [secretName, setSecretName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [documentationUrl, setDocumentationUrl] = useState("");
  const [authType, setAuthType] = useState("bearer");
  const [authField, setAuthField] = useState("");
  const [testPath, setTestPath] = useState("");
  const [catalogPath, setCatalogPath] = useState("");
  const [validatePath, setValidatePath] = useState("");
  const [purchasePath, setPurchasePath] = useState("");
  const [statusPath, setStatusPath] = useState("");
  const [customContract, setCustomContract] = useState("");
  const [error, setError] = useState<string | null>(null);

  const generatedContract = useMemo(() => buildGenericContract({
    authType,
    authField,
    testPath,
    catalogPath,
    validatePath,
    purchasePath,
    statusPath,
  }), [authField, authType, catalogPath, purchasePath, statusPath, testPath, validatePath]);

  const save = useMutation({
    mutationFn: (contract: Record<string, unknown>) => api.post(
      "/admin/utility-billing/configuration",
      {
        kind: "provider",
        key: `provider.utility.${utilitySlug(name)}`,
        configuration: {
          displayName: name.trim(),
          providerFamily: family.trim() || utilitySlug(name),
          environment,
          secretRef: `SUPABASE_SECRET:${secretName.trim()}`,
          baseUrl: baseUrl.trim(),
          documentationUrl: documentationUrl.trim() || null,
          status: "inactive",
          metadata: {
            adapterKind: "generic-http-v1",
            runtimeInstalled: true,
            runtimeReady: false,
            catalogSyncReady: Boolean(readContractOperation(contract, "catalog")),
            credentialSource: "supabase_edge_function_secret",
            genericContract: contract,
            ...(readContractWebhook(contract, utilitySlug(name)) ?? {}),
          },
        },
      },
      UtilityMutationIdSchema,
    ),
    onSuccess: props.onSaved,
  });

  if (!props.open) return null;

  const submit = () => {
    if (!name.trim()) {
      setError("Enter the provider name.");
      setStep("identity");
      return;
    }
    if (!secretName.trim()) {
      setError("Enter the Supabase Edge secret name used for this provider.");
      setStep("connection");
      return;
    }
    if (!isHttpsUrl(baseUrl)) {
      setError("Enter the provider's public HTTPS API base URL.");
      setStep("connection");
      return;
    }

    let contract: Record<string, unknown>;
    try {
      contract = customContract.trim()
        ? parseContractJson(customContract)
        : generatedContract;
    } catch (contractError) {
      setError(contractError instanceof Error ? contractError.message : "The provider API contract JSON is invalid.");
      setStep("connection");
      return;
    }

    const operations = contract.operations;
    if (!operations || typeof operations !== "object" || Array.isArray(operations)) {
      setError("The provider contract must contain an operations object.");
      setStep("connection");
      return;
    }
    const operationRecord = operations as Record<string, unknown>;
    if (!operationRecord.test || !operationRecord.purchase || !operationRecord.status) {
      setError("Configure at least Test, Purchase and Status operations before saving the provider.");
      setStep("connection");
      return;
    }

    setError(null);
    save.mutate(contract);
  };

  const needsSimplePaths = !customContract.trim();
  const connectionIncomplete = !secretName.trim() || !isHttpsUrl(baseUrl) || (
    needsSimplePaths && (!testPath.trim() || !purchasePath.trim() || !statusPath.trim())
  );

  return (
    <Dialog isOpen title="Add utility provider" onClose={props.onClose} footer={<Button variant="ghost" onClick={props.onClose}>Cancel</Button>}>
      <AdminTaskFlow
        steps={providerSteps}
        activeStep={step}
        onStepChange={(next) => { setStep(next); setError(null); }}
        disableNext={(step === "identity" && !name.trim()) || (step === "connection" && connectionIncomplete)}
        footer={step === "review" ? <Button icon={ShieldCheck} isLoading={save.isPending} onClick={submit}>Save provider</Button> : undefined}
      >
        {step === "identity" ? (
          <AdminFormSection title="Identify the provider" description="The mobile app does not need to know the provider name. This record controls the server-side bill adapter and routing.">
            <TextInput label="Provider name" value={name} onChange={(event) => setName(event.currentTarget.value)} placeholder="VTpass, Baxi, ClubKonnect, Reloadly, or another provider" />
            <TextInput label="API family (optional)" value={family} onChange={(event) => setFamily(event.currentTarget.value)} placeholder="Leave blank to use the provider name" />
            <SelectInput label="Environment" value={environment} onChange={(event) => setEnvironment(event.currentTarget.value)} options={[{ label: "Production", value: "production" }, { label: "Sandbox / test", value: "sandbox" }]} />
          </AdminFormSection>
        ) : null}

        {step === "connection" ? (
          <AdminFormSection title="Connect the provider" description="Use the provider documentation to enter its server URL and endpoint paths. API key values remain in Supabase Edge secrets and are never stored here.">
            <TextInput label="Supabase Edge secret name" value={secretName} onChange={(event) => setSecretName(normalizeUtilitySecretName(event.currentTarget.value))} placeholder="VTPASS_API_KEY" />
            <small className="skima-muted">Stored reference: <code>SUPABASE_SECRET:{secretName || "UTILITY_PROVIDER_API_KEY"}</code></small>
            <TextInput label="API base URL" value={baseUrl} onChange={(event) => setBaseUrl(event.currentTarget.value)} placeholder="https://api.provider.com/v1/" />

            <div className="skima-form-grid">
              <SelectInput
                label="API authentication"
                value={authType}
                onChange={(event) => setAuthType(event.currentTarget.value)}
                options={[
                  { label: "Bearer token", value: "bearer" },
                  { label: "API key header", value: "header" },
                  { label: "API key query parameter", value: "query" },
                  { label: "Basic authentication", value: "basic" },
                ]}
              />
              <TextInput
                label={authType === "query" ? "Query parameter name" : authType === "header" ? "Header name" : "Auth field (optional)"}
                value={authField}
                onChange={(event) => setAuthField(event.currentTarget.value)}
                placeholder={authType === "query" ? "api_key" : authType === "header" ? "X-API-Key" : "Use provider default"}
              />
            </div>

            {!customContract.trim() ? (
              <>
                <div className="skima-form-grid">
                  <TextInput label="Connection-test path" value={testPath} onChange={(event) => setTestPath(event.currentTarget.value)} placeholder="balance or services" />
                  <TextInput label="Catalogue path (optional)" value={catalogPath} onChange={(event) => setCatalogPath(event.currentTarget.value)} placeholder="services" />
                  <TextInput label="Customer-validation path (optional)" value={validatePath} onChange={(event) => setValidatePath(event.currentTarget.value)} placeholder="validate" />
                  <TextInput label="Purchase path" value={purchasePath} onChange={(event) => setPurchasePath(event.currentTarget.value)} placeholder="purchase" />
                  <TextInput label="Status path" value={statusPath} onChange={(event) => setStatusPath(event.currentTarget.value)} placeholder="transactions/{{reference}}" />
                  <TextInput label="Documentation URL (optional)" value={documentationUrl} onChange={(event) => setDocumentationUrl(event.currentTarget.value)} placeholder="https://docs.provider.com" />
                </div>
                <small className="skima-muted">SKIMA sends canonical fields such as <code>billerCode</code>, <code>itemCode</code>, <code>customerIdentifier</code>, <code>amount</code>, <code>reference</code> and <code>callbackUrl</code>. Use Advanced API contract below when the provider uses different field names.</small>
              </>
            ) : null}

            <details className="utility-v2__advanced">
              <summary>Advanced API contract — use for provider-specific field names</summary>
              <div className="utility-v2__form-card">
                <p className="skima-muted">Paste only API mapping/configuration JSON here, never API key values. This replaces the simple endpoint mapping above and lets SKIMA adapt to a new REST provider without an app release.</p>
                <TextAreaInput
                  label="Provider API contract JSON"
                  value={customContract}
                  onChange={(event) => setCustomContract(event.currentTarget.value)}
                  rows={14}
                  placeholder={GENERIC_CONTRACT_EXAMPLE}
                />
              </div>
            </details>
          </AdminFormSection>
        ) : null}

        {step === "review" ? (
          <AdminFormSection title="Review provider record" description="The provider is saved inactive. Test its API, sync or map services, configure economics and run a real vend before activation.">
            <div className="utility-v2__review-grid">
              <div><small>Provider</small><strong>{name || "Not entered"}</strong></div>
              <div><small>API family</small><strong>{family || utilitySlug(name) || "Generic"}</strong></div>
              <div><small>Environment</small><strong>{friendlyUtilityText(environment)}</strong></div>
              <div><small>Secret reference</small><strong>{secretName || "Missing"}</strong></div>
              <div><small>Runtime</small><strong>Generic HTTP v1</strong></div>
              <div><small>Catalogue sync</small><strong>{readContractOperation(customContract.trim() ? safeContractPreview(customContract) : generatedContract, "catalog") ? "Configured" : "Manual / later"}</strong></div>
            </div>
            <section className="admin-notice"><strong>No app deployment required for this provider</strong><p>After this contract is saved, provider choice remains server-side. Product routing decides which provider fulfills each bill service.</p></section>
          </AdminFormSection>
        ) : null}

        {error || save.error ? <StatusBadge tone="danger">{error ?? utilityError(save.error)}</StatusBadge> : null}
      </AdminTaskFlow>
    </Dialog>
  );
}

function buildGenericContract(input: {
  authType: string;
  authField: string;
  testPath: string;
  catalogPath: string;
  validatePath: string;
  purchasePath: string;
  statusPath: string;
}): Record<string, unknown> {
  const auth = input.authType === "header"
    ? { type: "header", headerName: input.authField.trim() || "X-API-Key" }
    : input.authType === "query"
    ? { type: "query", queryParam: input.authField.trim() || "api_key" }
    : input.authType === "basic"
    ? { type: "basic", username: input.authField.trim() || "api" }
    : { type: "bearer" };

  const operations: Record<string, unknown> = {
    test: {
      method: "GET",
      path: cleanRelativePath(input.testPath),
    },
    purchase: {
      method: "POST",
      path: cleanRelativePath(input.purchasePath),
      body: {
        billerCode: "{{billerCode}}",
        itemCode: "{{itemCode}}",
        customerIdentifier: "{{customerIdentifier}}",
        amount: "{{amount}}",
        reference: "{{reference}}",
        callbackUrl: "{{callbackUrl}}",
      },
    },
    status: input.statusPath.includes("{{reference}}")
      ? { method: "GET", path: cleanRelativePath(input.statusPath) }
      : { method: "GET", path: cleanRelativePath(input.statusPath), query: { reference: "{{reference}}" } },
  };

  if (input.catalogPath.trim()) {
    operations.catalog = {
      method: "GET",
      path: cleanRelativePath(input.catalogPath),
      response: { arrayPath: "data" },
    };
  }
  if (input.validatePath.trim()) {
    operations.validate = {
      method: "POST",
      path: cleanRelativePath(input.validatePath),
      body: {
        billerCode: "{{billerCode}}",
        itemCode: "{{itemCode}}",
        customerIdentifier: "{{customerIdentifier}}",
      },
    };
  }

  return {
    version: "1",
    auth,
    operations,
  };
}

function parseContractJson(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The provider API contract must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function safeContractPreview(value: string): Record<string, unknown> {
  try {
    return parseContractJson(value);
  } catch {
    return {};
  }
}

function readContractOperation(contract: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const operations = contract.operations;
  if (!operations || typeof operations !== "object" || Array.isArray(operations)) return null;
  const operation = (operations as Record<string, unknown>)[key];
  return operation && typeof operation === "object" && !Array.isArray(operation)
    ? operation as Record<string, unknown>
    : null;
}

function readContractWebhook(contract: Record<string, unknown>, providerSlug: string): Record<string, unknown> | null {
  const webhook = contract.webhook;
  if (!webhook || typeof webhook !== "object" || Array.isArray(webhook)) return null;
  const configured = webhook as Record<string, unknown>;
  return {
    webhook: {
      ...configured,
      path: typeof configured.path === "string" && configured.path.trim()
        ? configured.path.trim()
        : `/functions/v1/utility-provider-webhook/${providerSlug}`,
    },
  };
}

function cleanRelativePath(value: string): string {
  return value.trim().replace(/^\/+/, "");
}

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

const GENERIC_CONTRACT_EXAMPLE = `{
  "version": "1",
  "auth": {
    "bindings": [
      { "target": "header", "name": "api-key", "value": "{{credential:primary}}" }
    ]
  },
  "operations": {
    "test": { "method": "GET", "path": "balance" },
    "catalog": {
      "method": "GET",
      "path": "services",
      "response": {
        "arrayPath": "data",
        "mapping": {
          "categoryName": "category",
          "billerName": "network",
          "productCode": "variation_code",
          "productName": "name",
          "amount": "amount"
        }
      }
    },
    "validate": {
      "method": "POST",
      "path": "validate",
      "body": {
        "serviceID": "{{billerCode}}",
        "variation_code": "{{itemCode}}",
        "billersCode": "{{customerIdentifier}}"
      }
    },
    "purchase": {
      "method": "POST",
      "path": "pay",
      "body": {
        "request_id": "{{reference}}",
        "serviceID": "{{billerCode}}",
        "variation_code": "{{itemCode}}",
        "billersCode": "{{customerIdentifier}}",
        "amount": "{{amount}}",
        "phone": "{{customerIdentifier}}"
      },
      "response": {
        "statusPath": "content.transactions.status",
        "providerReferencePath": "requestId"
      }
    },
    "status": {
      "method": "POST",
      "path": "requery",
      "body": { "request_id": "{{reference}}" },
      "response": { "statusPath": "content.transactions.status" }
    }
  }
}`;
