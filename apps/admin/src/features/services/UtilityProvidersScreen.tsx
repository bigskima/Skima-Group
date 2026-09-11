import { useMutation } from "@tanstack/react-query";
import { PlugZap, Plus, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { Button, Dialog, SelectInput, StatusBadge, TextInput } from "@skima/ui";

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
  { key: "identity", label: "Provider", description: "Name and API family" },
  { key: "connection", label: "Connection", description: "Secret reference and URLs" },
  { key: "review", label: "Review", description: "Status and save" },
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
        description="Connect and verify bill-payment providers without exposing API key values in the database. SKIMA stores only the Edge secret reference."
        actions={<Button icon={Plus} onClick={() => setAdding(true)}>Add provider</Button>}
      />

      <section className="sk-panel">
        <div className="sk-panel__header"><div><h2>Connected providers</h2><p className="skima-muted">A provider must have a secret reference and tested runtime before customer routes can safely go live.</p></div><StatusBadge>{props.data.providers.length}</StatusBadge></div>
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
  const [status, setStatus] = useState("inactive");
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => api.post(
      "/admin/utility-billing/configuration",
      {
        kind: "provider",
        key: `provider.utility.${utilitySlug(name)}`,
        configuration: {
          displayName: name.trim(),
          providerFamily: family.trim(),
          environment,
          secretRef: `SUPABASE_SECRET:${secretName.trim()}`,
          baseUrl: baseUrl.trim() || null,
          documentationUrl: documentationUrl.trim() || null,
          status,
        },
      },
      UtilityMutationIdSchema,
    ),
    onSuccess: props.onSaved,
  });

  if (!props.open) return null;
  const submit = () => {
    if (!name.trim() || !family.trim()) { setError("Enter the provider name and API family."); setStep("identity"); return; }
    if (!secretName.trim()) { setError("Enter the Supabase Edge secret name used for this provider."); setStep("connection"); return; }
    setError(null);
    save.mutate();
  };

  return (
    <Dialog isOpen title="Add utility provider" onClose={props.onClose} footer={<Button variant="ghost" onClick={props.onClose}>Cancel</Button>}>
      <AdminTaskFlow
        steps={providerSteps}
        activeStep={step}
        onStepChange={(next) => { setStep(next); setError(null); }}
        disableNext={step === "identity" && (!name.trim() || !family.trim())}
        footer={step === "review" ? <Button icon={ShieldCheck} isLoading={save.isPending} onClick={submit}>Save provider</Button> : undefined}
      >
        {step === "identity" ? (
          <AdminFormSection title="Identify the provider" description="Keep the integration provider-neutral. The provider family tells SKIMA which adapter contract is expected.">
            <TextInput label="Provider name" value={name} onChange={(event) => setName(event.currentTarget.value)} placeholder="VTpass, Reloadly, or another provider" />
            <TextInput label="Provider / API family" value={family} onChange={(event) => setFamily(event.currentTarget.value)} placeholder="Provider family or API type" />
            <SelectInput label="Environment" value={environment} onChange={(event) => setEnvironment(event.currentTarget.value)} options={[{ label: "Production", value: "production" }, { label: "Sandbox / test", value: "sandbox" }]} />
          </AdminFormSection>
        ) : null}
        {step === "connection" ? (
          <AdminFormSection title="Connect the provider" description="Enter the Edge secret name only. Never paste the API key value into this form.">
            <TextInput label="Supabase Edge secret name" value={secretName} onChange={(event) => setSecretName(normalizeUtilitySecretName(event.currentTarget.value))} placeholder="UTILITY_PROVIDER_API_KEY" />
            <small className="skima-muted">Stored reference: <code>SUPABASE_SECRET:{secretName || "UTILITY_PROVIDER_API_KEY"}</code></small>
            <details className="utility-v2__advanced"><summary>Optional provider URLs</summary><div className="skima-form-grid"><TextInput label="API base URL" value={baseUrl} onChange={(event) => setBaseUrl(event.currentTarget.value)} /><TextInput label="Documentation URL" value={documentationUrl} onChange={(event) => setDocumentationUrl(event.currentTarget.value)} /></div></details>
          </AdminFormSection>
        ) : null}
        {step === "review" ? (
          <AdminFormSection title="Review provider record" description="Saving the record does not make it customer-live. Test the API and then run a real vend before activation.">
            <div className="utility-v2__review-grid"><div><small>Provider</small><strong>{name || "Not entered"}</strong></div><div><small>API family</small><strong>{family || "Not entered"}</strong></div><div><small>Environment</small><strong>{friendlyUtilityText(environment)}</strong></div><div><small>Secret</small><strong>{secretName || "Missing"}</strong></div></div>
            <SelectInput label="Initial provider status" value={status} onChange={(event) => setStatus(event.currentTarget.value)} options={[{ label: "Inactive while configuring", value: "inactive" }, { label: "Active provider record", value: "active" }, { label: "Disabled", value: "disabled" }]} />
          </AdminFormSection>
        ) : null}
        {error || save.error ? <StatusBadge tone="danger">{error ?? utilityError(save.error)}</StatusBadge> : null}
      </AdminTaskFlow>
    </Dialog>
  );
}
