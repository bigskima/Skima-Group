import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  CheckCircle2,
  Cpu,
  RefreshCcw,
  Route,
  Send,
  ShieldCheck,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { z } from "zod";

import {
  createClientIdempotencyKey,
  normalizeStatusLabel,
} from "@skima/frontend-core";
import {
  Button,
  ErrorState,
  LoadingState,
  MetricTile,
  PageHeader,
  StatusBadge,
  TextAreaInput,
  TextInput,
} from "@skima/ui";

import { useSessionState } from "./session";

const PlatformRecordSchema = z.record(z.unknown());
const AdminAiRuntimeSchema = z.object({
  capabilities: z.array(PlatformRecordSchema),
  routes: z.array(PlatformRecordSchema),
  providers: z.array(PlatformRecordSchema),
  userId: z.string().uuid().optional(),
});
const AiAssistantResponseSchema = z.object({
  conversationId: z.string().uuid(),
  reply: z.string().min(1),
  capabilityKey: z.string(),
  suggestions: z.array(z.string()).default([]),
});
const MutationSchema = z.union([z.string(), z.record(z.unknown()), z.null()]);

type PlatformRecord = Readonly<Record<string, unknown>>;
type AiChatMessage = {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
};

export function AdminAiWorkspace() {
  const { api, status } = useSessionState();
  const queryClient = useQueryClient();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const [routeEditor, setRouteEditor] = useState<string | null>(null);
  const [providerEditorOpen, setProviderEditorOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const runtime = useQuery({
    queryKey: ["admin-ai-runtime"],
    queryFn: () => api.get("/admin/ai/runtime", AdminAiRuntimeSchema),
    enabled: status === "authenticated",
  });

  const ask = useMutation({
    mutationFn: (message: string) =>
      api.post(
        "/runtime/ai/assistant",
        {
          workspace: "admin",
          message,
          conversationId: conversationId ?? undefined,
        },
        AiAssistantResponseSchema,
      ),
    onSuccess: (result) => {
      setConversationId(result.conversationId);
      setMessages((current) => [
        ...current,
        {
          id: "assistant-" + Date.now().toString(),
          role: "assistant",
          content: result.reply,
        },
      ]);
      setAssistantError(null);
    },
    onError: (error) => {
      setAssistantError(readError(error));
    },
  });

  const capabilities = runtime.data?.capabilities ?? [];
  const routes = runtime.data?.routes ?? [];
  const providers = runtime.data?.providers ?? [];
  const activeCapabilities = capabilities.filter((item) => recordString(item, "status") === "active");
  const activeProviders = providers.filter((item) =>
    ["active", "degraded"].includes(recordString(item, "status") ?? "")
  );
  const activeRoutes = routes.filter((item) => recordString(item, "status") === "active");
  const readOnlyCapabilities = activeCapabilities.filter((item) =>
    recordString(item, "control_mode") === "read_only"
  );

  const refresh = () => {
    setNotice(null);
    void queryClient.invalidateQueries({ queryKey: ["admin-ai-runtime"] });
  };

  const send = async (value = prompt) => {
    const message = value.trim();
    if (!message || ask.isPending) return;
    setPrompt("");
    setAssistantError(null);
    setMessages((current) => [
      ...current,
      {
        id: "user-" + Date.now().toString(),
        role: "user",
        content: message,
      },
    ]);
    await ask.mutateAsync(message).catch(() => undefined);
  };

  if (runtime.isLoading) {
    return <LoadingState label="Loading SKIMA Intelligence" />;
  }

  if (runtime.error) {
    return (
      <ErrorState
        title="SKIMA Intelligence unavailable"
        message={readError(runtime.error)}
        onRetry={() => void runtime.refetch()}
      />
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Intelligence"
        title="SKIMA Intelligence"
        description="Ask grounded operational questions and control which AI provider and model serves each capability. Business records, permissions and financial ledgers remain authoritative."
        actions={<Button icon={RefreshCcw} variant="outline" onClick={refresh}>Refresh</Button>}
      />

      <section className="skima-grid skima-grid--compact">
        <MetricTile label="Active capabilities" value={activeCapabilities.length} icon={Sparkles} tone="info" />
        <MetricTile label="Available providers" value={activeProviders.length} icon={Cpu} tone="success" />
        <MetricTile label="Active routes" value={activeRoutes.length} icon={Route} tone="neutral" />
        <MetricTile label="Read-only copilots" value={readOnlyCapabilities.length} icon={ShieldCheck} tone="success" />
      </section>

      {notice ? <div className="admin-notice" role="status">{notice}</div> : null}

      <section className="admin-ai-layout">
        <div className="sk-panel admin-ai-copilot">
          <div className="sk-panel__header admin-ai-panel-head">
            <div>
              <p className="admin-section-kicker">Operations copilot</p>
              <h2>Ask SKIMA</h2>
              <p>Ask about visible LPG operations, applications and AI runtime health.</p>
            </div>
            <StatusBadge tone="success">Read only</StatusBadge>
          </div>

          <div className="admin-ai-thread" aria-live="polite">
            {messages.length === 0 ? (
              <div className="admin-ai-empty">
                <span><Bot aria-hidden="true" /></span>
                <strong>Start with an operational question</strong>
                <p>Answers are grounded in the SKIMA records your administrator account is authorized to inspect.</p>
              </div>
            ) : (
              messages.map((message) => (
                <div
                  key={message.id}
                  className={"admin-ai-message is-" + message.role}
                >
                  {message.role === "assistant" ? <Sparkles aria-hidden="true" /> : null}
                  <div>{message.content}</div>
                </div>
              ))
            )}

            {ask.isPending ? (
              <div className="admin-ai-message is-assistant is-thinking">
                <Sparkles aria-hidden="true" />
                <div>Checking current SKIMA records…</div>
              </div>
            ) : null}
          </div>

          <div className="admin-ai-suggestions">
            {[
              "What needs attention right now?",
              "Summarize current LPG operations",
              "Are any AI tasks failing?",
            ].map((suggestion) => (
              <button
                type="button"
                key={suggestion}
                disabled={ask.isPending}
                onClick={() => void send(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>

          {assistantError ? <div className="admin-notice is-error" role="alert">{assistantError}</div> : null}

          <form
            className="admin-ai-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <textarea
              aria-label="Ask SKIMA"
              maxLength={3000}
              placeholder="Ask SKIMA about operations…"
              value={prompt}
              onChange={(event) => setPrompt(event.currentTarget.value)}
            />
            <Button
              icon={Send}
              type="submit"
              isLoading={ask.isPending}
              disabled={!prompt.trim()}
            >
              Ask
            </Button>
          </form>

          <div className="admin-ai-guardrail">
            <ShieldCheck aria-hidden="true" />
            <span>Copilot responses cannot change orders, dispatch assignments, wallets, payouts, approvals or permissions.</span>
          </div>
        </div>

        <div className="sk-panel admin-ai-routing">
          <div className="sk-panel__header admin-ai-panel-head">
            <div>
              <p className="admin-section-kicker">Provider routing</p>
              <h2>Capability routes</h2>
              <p>Switch a capability to another configured provider/model without deploying the app.</p>
            </div>
            <Button
              icon={Cpu}
              variant="outline"
              requiredPermission="platform.ai.manage"
              onClick={() => setProviderEditorOpen((current) => !current)}
            >
              {providerEditorOpen ? "Close provider setup" : "Provider setup"}
            </Button>
          </div>

          {providerEditorOpen ? (
            <ProviderSetupForm
              api={api}
              onSaved={async (message) => {
                setNotice(message);
                await queryClient.invalidateQueries({ queryKey: ["admin-ai-runtime"] });
              }}
            />
          ) : null}

          <div className="admin-ai-route-list">
            {capabilities.map((capability) => {
              const capabilityId = recordString(capability, "id");
              const capabilityKey = recordString(capability, "key") ?? "";
              const route = routes.find((item) =>
                recordString(item, "capability_id") === capabilityId &&
                recordString(item, "status") === "active"
              );
              const provider = providers.find((item) =>
                recordString(item, "id") === recordString(route, "provider_adapter_id")
              );
              const isEditing = routeEditor === capabilityKey;

              return (
                <div className="admin-ai-route-row" key={capabilityKey}>
                  <div className="admin-ai-route-copy">
                    <span className="admin-ai-route-icon"><WandSparkles aria-hidden="true" /></span>
                    <div>
                      <strong>{recordString(capability, "display_name") ?? normalizeStatusLabel(capabilityKey)}</strong>
                      <small>{recordString(capability, "description") ?? "SKIMA AI capability"}</small>
                    </div>
                  </div>
                  <div className="admin-ai-route-current">
                    <StatusBadge tone={route ? "success" : "warning"}>
                      {route ? "Active" : "Unrouted"}
                    </StatusBadge>
                    <strong>{recordString(provider, "display_name") ?? "No provider"}</strong>
                    <small>{recordString(route, "model_key") ?? "No model selected"}</small>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    requiredPermission="platform.ai.manage"
                    onClick={() => setRouteEditor(isEditing ? null : capabilityKey)}
                  >
                    {isEditing ? "Close" : "Change"}
                  </Button>

                  {isEditing ? (
                    <div className="admin-ai-route-editor">
                      <RouteEditor
                        api={api}
                        capabilityKey={capabilityKey}
                        providers={providers}
                        currentProviderKey={recordString(provider, "key")}
                        currentModel={recordString(route, "model_key")}
                        onSaved={async () => {
                          setRouteEditor(null);
                          setNotice(
                            (recordString(capability, "display_name") ?? "AI capability") +
                            " route updated.",
                          );
                          await queryClient.invalidateQueries({ queryKey: ["admin-ai-runtime"] });
                        }}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </>
  );
}

function RouteEditor(props: {
  readonly api: ReturnType<typeof useSessionState>["api"];
  readonly capabilityKey: string;
  readonly providers: readonly PlatformRecord[];
  readonly currentProviderKey: string | null;
  readonly currentModel: string | null;
  readonly onSaved: () => Promise<void>;
}) {
  const activeProviders = useMemo(
    () => props.providers.filter((provider) =>
      ["active", "degraded"].includes(recordString(provider, "status") ?? "")
    ),
    [props.providers],
  );
  const [providerKey, setProviderKey] = useState(
    props.currentProviderKey ?? recordString(activeProviders[0], "key") ?? "",
  );
  const [modelKey, setModelKey] = useState(props.currentModel ?? "");
  const [reason, setReason] = useState("Update SKIMA AI capability route.");
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      props.api.post(
        "/admin/ai/provider-route",
        {
          capabilityKey: props.capabilityKey,
          providerAdapterKey: providerKey,
          modelKey,
          reason,
          idempotencyKey: createClientIdempotencyKey(
            "admin.ai.provider-route",
            props.capabilityKey + ":" + providerKey + ":" + modelKey,
          ),
          routeConfig: {},
        },
        MutationSchema,
      ),
    onSuccess: props.onSaved,
    onError: (cause) => setError(readError(cause)),
  });

  return (
    <form
      className="admin-ai-editor-grid"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        save.mutate();
      }}
    >
      <label className="admin-ai-field">
        <span>Provider</span>
        <select value={providerKey} onChange={(event) => setProviderKey(event.currentTarget.value)} required>
          <option value="" disabled>Select provider</option>
          {activeProviders.map((provider) => {
            const key = recordString(provider, "key") ?? "";
            return <option value={key} key={key}>{recordString(provider, "display_name") ?? key}</option>;
          })}
        </select>
      </label>
      <TextInput
        label="Model"
        value={modelKey}
        onChange={(event) => setModelKey(event.currentTarget.value)}
        placeholder="Provider model identifier"
        required
      />
      <TextInput
        label="Reason"
        value={reason}
        onChange={(event) => setReason(event.currentTarget.value)}
        required
      />
      <div className="admin-ai-editor-action">
        <Button
          icon={CheckCircle2}
          type="submit"
          isLoading={save.isPending}
          disabled={!providerKey || !modelKey.trim() || !reason.trim()}
          requiredPermission="platform.ai.manage"
        >
          Activate route
        </Button>
      </div>
      {error ? <div className="admin-notice is-error" role="alert">{error}</div> : null}
    </form>
  );
}

function ProviderSetupForm(props: {
  readonly api: ReturnType<typeof useSessionState>["api"];
  readonly onSaved: (message: string) => Promise<void>;
}) {
  const [providerKey, setProviderKey] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [transport, setTransport] = useState("openai_compatible_chat");
  const [apiBaseUrl, setApiBaseUrl] = useState("");
  const [secretRef, setSecretRef] = useState("");
  const [statusValue, setStatusValue] = useState("inactive");
  const [reason, setReason] = useState("Configure SKIMA AI provider.");
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      props.api.post(
        "/admin/ai/provider-config",
        {
          providerKey,
          displayName,
          transport,
          apiBaseUrl: apiBaseUrl.trim() || undefined,
          secretRef: secretRef.trim() || undefined,
          status: statusValue,
          config: {},
          reason,
          idempotencyKey: createClientIdempotencyKey(
            "admin.ai.provider-config",
            providerKey + ":" + transport + ":" + apiBaseUrl + ":" + statusValue,
          ),
        },
        MutationSchema,
      ),
    onSuccess: async () => {
      setError(null);
      await props.onSaved((displayName || providerKey) + " provider configuration saved.");
    },
    onError: (cause) => setError(readError(cause)),
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    save.mutate();
  };

  return (
    <form className="admin-ai-provider-setup" onSubmit={submit}>
      <div className="admin-ai-provider-note">
        <ShieldCheck aria-hidden="true" />
        <span>
          API key values are never stored here. This form stores only a server secret reference such as{" "}
          <code>SUPABASE_SECRET:GEMINI_API_KEY</code>. Provider and model routing is saved in the database, so switching an already configured provider does not require an app redeploy.
        </span>
      </div>
      <div className="admin-form-grid">
        <TextInput
          label="Provider key"
          value={providerKey}
          onChange={(event) => setProviderKey(event.currentTarget.value)}
          placeholder="provider.ai.example"
          required
        />
        <TextInput
          label="Display name"
          value={displayName}
          onChange={(event) => setDisplayName(event.currentTarget.value)}
          placeholder="Example AI"
          required
        />
        <label className="admin-ai-field">
          <span>Transport</span>
          <select value={transport} onChange={(event) => setTransport(event.currentTarget.value)}>
            <option value="google_generate_content">Google GenerateContent</option>
            <option value="openai_compatible_chat">OpenAI-compatible chat</option>
            <option value="anthropic_messages">Anthropic Messages</option>
            <option value="cloudflare_workers_ai">Cloudflare Workers AI (image)</option>
          </select>
        </label>
        <label className="admin-ai-field">
          <span>Status</span>
          <select value={statusValue} onChange={(event) => setStatusValue(event.currentTarget.value)}>
            <option value="inactive">Inactive</option>
            <option value="active">Active</option>
            <option value="degraded">Degraded</option>
            <option value="disabled">Disabled</option>
          </select>
        </label>
        <TextInput
          label="API base URL"
          value={apiBaseUrl}
          onChange={(event) => setApiBaseUrl(event.currentTarget.value)}
          placeholder="https://provider.example/v1"
        />
        <TextInput
          label="Server secret reference"
          value={secretRef}
          onChange={(event) => setSecretRef(event.currentTarget.value)}
          placeholder="SUPABASE_SECRET:PROVIDER_API_KEY"
        />
      </div>
      <TextAreaInput
        label="Change reason"
        value={reason}
        onChange={(event) => setReason(event.currentTarget.value)}
        required
      />
      {error ? <div className="admin-notice is-error" role="alert">{error}</div> : null}
      <div className="admin-ai-provider-actions">
        <Button
          icon={Cpu}
          type="submit"
          isLoading={save.isPending}
          disabled={!providerKey.trim() || !displayName.trim() || !reason.trim()}
          requiredPermission="platform.ai.manage"
        >
          Save provider
        </Button>
      </div>
    </form>
  );
}

function recordString(record: PlatformRecord | null | undefined, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : "The request could not be completed.";
}
