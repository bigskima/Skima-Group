import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeDollarSign,
  Bot,
  CheckCircle2,
  Cpu,
  MapPinned,
  RefreshCcw,
  Route,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TrendingUp,
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
  insights: z.array(PlatformRecordSchema).default([]),
  forecasts: z.array(PlatformRecordSchema).default([]),
  riskAssessments: z.array(PlatformRecordSchema).default([]),
  dispatchAssessments: z.array(PlatformRecordSchema).default([]),
  financeFindings: z.array(PlatformRecordSchema).default([]),
  pricingIntelligence: PlatformRecordSchema.nullable().default(null),
  expansionOpportunities: z.array(PlatformRecordSchema).default([]),
  usageGovernor: PlatformRecordSchema.nullable().default(null),
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
  const insights = runtime.data?.insights ?? [];
  const forecasts = runtime.data?.forecasts ?? [];
  const riskAssessments = runtime.data?.riskAssessments ?? [];
  const dispatchAssessments = runtime.data?.dispatchAssessments ?? [];
  const financeFindings = runtime.data?.financeFindings ?? [];
  const pricingIntelligence = runtime.data?.pricingIntelligence ?? null;
  const expansionOpportunities = runtime.data?.expansionOpportunities ?? [];
  const usageGovernor = runtime.data?.usageGovernor ?? null;
  const activeCapabilities = capabilities.filter((item) => recordString(item, "status") === "active");
  const activeProviders = providers.filter((item) =>
    ["active", "degraded"].includes(recordString(item, "status") ?? "")
  );
  const activeRoutes = routes.filter((item) => recordString(item, "status") === "active");
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
        description="Ask operational questions and choose which configured AI provider handles each type of AI task. SKIMA business records, permissions and financial records remain the source of truth."
        actions={<Button icon={RefreshCcw} variant="outline" onClick={refresh}>Refresh</Button>}
      />

      <section className="skima-grid skima-grid--compact">
        <MetricTile label="Active capabilities" value={activeCapabilities.length} icon={Sparkles} tone="info" />
        <MetricTile label="Available providers" value={activeProviders.length} icon={Cpu} tone="success" />
        <MetricTile label="Active routes" value={activeRoutes.length} icon={Route} tone="neutral" />
        <MetricTile
          label="Open exceptions"
          value={insights.filter((item) => recordString(item, "status") !== "resolved").length}
          icon={ShieldCheck}
          tone={insights.length ? "warning" : "success"}
        />
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
              "Where does shadow dispatch disagree?",
              "Which partner risks need review?",
              "Where is LPG demand likely to be highest?",
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
              <h2>AI task routing</h2>
              <p>Choose which configured AI provider and model handles each type of AI task without redeploying the app.</p>
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
              const fallbackRoute = routes.find((item) =>
                recordString(item, "capability_id") === capabilityId &&
                recordString(item, "status") === "active" &&
                recordObject(item, "config").fallback_only === true
              );
              const fallbackProvider = providers.find((item) =>
                recordString(item, "id") === recordString(fallbackRoute, "provider_adapter_id")
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
                    <small>
                      Free fallback: {recordString(fallbackProvider, "display_name") ?? "Not configured"}
                      {fallbackRoute ? " · " + (recordString(fallbackRoute, "model_key") ?? "model") : ""}
                    </small>
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
                        capabilityResponseMode={recordString(capability, "response_mode") ?? "text"}
                        providers={providers}
                        currentProviderKey={recordString(provider, "key")}
                        currentModel={recordString(route, "model_key")}
                        currentFallbackRoute={fallbackRoute ?? null}
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

      <AiUsageGovernorPanel
        api={api}
        governor={usageGovernor}
        onChanged={async (message) => {
          setNotice(message);
          await queryClient.invalidateQueries({ queryKey: ["admin-ai-runtime"] });
        }}
      />

      <DemandForecastPanel forecasts={forecasts} />

      <ExpansionOpportunitiesPanel opportunities={expansionOpportunities} />

      <PricingIntelligencePanel snapshot={pricingIntelligence} />

      <DispatchShadowPanel assessments={dispatchAssessments} />

      <FinanceReconciliationPanel findings={financeFindings} />

      <PartnerRiskPanel assessments={riskAssessments} />

      <OperationalInsightsPanel
        api={api}
        insights={insights}
        onChanged={async () => {
          await queryClient.invalidateQueries({ queryKey: ["admin-ai-runtime"] });
        }}
      />
    </>
  );
}

function AiUsageGovernorPanel(props: {
  readonly api: ReturnType<typeof useSessionState>["api"];
  readonly governor: PlatformRecord | null;
  readonly onChanged: (message: string) => Promise<void>;
}) {
  const policies = recordArray(props.governor, "policies");
  const usage = recordArray(props.governor, "usageByProvider");
  const policy = policies.find((item) => recordString(item, "status") === "active") ?? policies[0] ?? null;
  const policyKey = recordString(policy, "key") ?? "ai.usage.free-tier.default";
  const totalRequests = usage.reduce((sum, item) => sum + recordNumber(item, "requests"), 0);
  const blockedToday = recordNumber(props.governor, "blockedToday");
  const [dailyRequests, setDailyRequests] = useState(
    String(Math.max(1, recordNumber(policy, "dailyRequestLimit") || 500)),
  );
  const [perUserDailyRequests, setPerUserDailyRequests] = useState(
    String(Math.max(1, recordNumber(policy, "perUserDailyRequestLimit") || 40)),
  );
  const [dailyInputUnits, setDailyInputUnits] = useState(
    nullableRecordNumber(policy, "dailyInputUnitLimit")?.toString() ?? "",
  );
  const [dailyOutputUnits, setDailyOutputUnits] = useState(
    nullableRecordNumber(policy, "dailyOutputUnitLimit")?.toString() ?? "",
  );
  const [automaticFreeFailover, setAutomaticFreeFailover] = useState(
    recordBoolean(policy, "automaticFreeFailover") ?? true,
  );
  const [reason, setReason] = useState("Update SKIMA free-tier AI guard.");
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      props.api.post(
        "/admin/ai/usage-policy",
        {
          policyKey,
          dailyRequestLimit: Number(dailyRequests),
          perUserDailyRequestLimit: Number(perUserDailyRequests),
          dailyInputUnitLimit: dailyInputUnits.trim() ? Number(dailyInputUnits) : undefined,
          dailyOutputUnitLimit: dailyOutputUnits.trim() ? Number(dailyOutputUnits) : undefined,
          automaticFreeFailover,
          reason,
          idempotencyKey: createClientIdempotencyKey(
            "admin.ai.usage-policy",
            [
              policyKey,
              dailyRequests,
              perUserDailyRequests,
              dailyInputUnits,
              dailyOutputUnits,
              String(automaticFreeFailover),
            ].join(":"),
          ),
        },
        MutationSchema,
      ),
    onSuccess: async () => {
      setError(null);
      await props.onChanged("SKIMA AI free-tier guard updated.");
    },
    onError: (cause) => setError(readError(cause)),
  });

  return (
    <section className="sk-panel admin-ai-usage-guard">
      <div className="sk-panel__header admin-ai-panel-head">
        <div>
          <p className="admin-section-kicker">Free-tier protection</p>
          <h2>AI usage guard</h2>
          <p>
            Limit AI consumption before a provider rejects traffic. Automatic failover can use only
            providers explicitly marked free; paid fallback is disabled.
          </p>
        </div>
        <div className="admin-ai-usage-summary">
          <StatusBadge tone={blockedToday > 0 ? "warning" : "success"}>
            {formatForecastNumber(totalRequests, 0)} requests today
          </StatusBadge>
          <StatusBadge tone={blockedToday > 0 ? "warning" : "neutral"}>
            {formatForecastNumber(blockedToday, 0)} blocked
          </StatusBadge>
        </div>
      </div>

      <form
        className="admin-ai-usage-form"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          save.mutate();
        }}
      >
        <div className="admin-form-grid">
          <TextInput
            label="Platform requests / day"
            value={dailyRequests}
            onChange={(event) => setDailyRequests(event.currentTarget.value)}
            required
          />
          <TextInput
            label="Requests / user / day"
            value={perUserDailyRequests}
            onChange={(event) => setPerUserDailyRequests(event.currentTarget.value)}
            required
          />
          <TextInput
            label="Input units / day (optional)"
            value={dailyInputUnits}
            onChange={(event) => setDailyInputUnits(event.currentTarget.value)}
            placeholder="No unit cap"
          />
          <TextInput
            label="Output units / day (optional)"
            value={dailyOutputUnits}
            onChange={(event) => setDailyOutputUnits(event.currentTarget.value)}
            placeholder="No unit cap"
          />
        </div>

        <label className="admin-ai-toggle-row">
          <input
            type="checkbox"
            checked={automaticFreeFailover}
            onChange={(event) => setAutomaticFreeFailover(event.currentTarget.checked)}
          />
          <span>
            <strong>Automatic free-provider failover</strong>
            <small>Retry a configured secondary route only when it is explicitly marked free.</small>
          </span>
        </label>

        <TextAreaInput
          label="Change reason"
          value={reason}
          onChange={(event) => setReason(event.currentTarget.value)}
          required
        />

        <div className="admin-ai-provider-note">
          <ShieldCheck aria-hidden="true" />
          <span>
            Automatic paid fallback is disabled by the database runtime. These limits are SKIMA safety
            guards, not promises about any provider&apos;s published quota.
          </span>
        </div>

        {error ? <div className="admin-notice is-error" role="alert">{error}</div> : null}

        <div className="admin-ai-provider-actions">
          <Button
            icon={CheckCircle2}
            type="submit"
            isLoading={save.isPending}
            requiredPermission="platform.ai.manage"
          >
            Save usage guard
          </Button>
        </div>
      </form>
    </section>
  );
}

function DemandForecastPanel(props: {
  readonly forecasts: readonly PlatformRecord[];
}) {
  const sorted = [...props.forecasts]
    .filter((item) => recordString(item, "subject_type") === "lpg_station_branch")
    .sort((left, right) => {
      const horizonDifference = recordNumber(left, "horizon_days") - recordNumber(right, "horizon_days");
      if (horizonDifference !== 0) return horizonDifference;
      return recordNumber(right, "predicted_orders") - recordNumber(left, "predicted_orders");
    });
  const stationCount = new Set(
    sorted.map((item) => recordString(item, "subject_id")).filter(Boolean),
  ).size;

  return (
    <section className="sk-panel admin-ai-forecasts">
      <div className="sk-panel__header admin-ai-panel-head">
        <div>
          <p className="admin-section-kicker">Demand intelligence</p>
          <h2>Demand outlook</h2>
          <p>
            Statistical estimates from recent valid SKIMA LPG orders. These numbers do not change
            inventory, pricing, station selection or driver dispatch.
          </p>
        </div>
        <StatusBadge tone="info">
          {stationCount ? String(stationCount) + " station" + (stationCount === 1 ? "" : "s") : "No history yet"}
        </StatusBadge>
      </div>

      {sorted.length === 0 ? (
        <div className="admin-ai-forecast-empty">
          <TrendingUp aria-hidden="true" />
          <div>
            <strong>No demand forecast is available yet</strong>
            <span>Forecasts appear after the runtime has enough station order history to evaluate.</span>
          </div>
        </div>
      ) : (
        <div className="admin-ai-forecast-grid">
          {sorted.slice(0, 12).map((forecast) => {
            const evidence = recordObject(forecast, "evidence");
            const horizonDays = Math.max(1, Math.round(recordNumber(forecast, "horizon_days")));
            const confidence = recordString(forecast, "confidence") ?? "low";
            const stationName = recordString(evidence, "stationDisplayName") ??
              shortReference(recordString(forecast, "subject_id"));
            return (
              <article className="admin-ai-forecast-card" key={recordString(forecast, "id") ?? stationName + horizonDays}>
                <div className="admin-ai-forecast-card__top">
                  <span><TrendingUp aria-hidden="true" /></span>
                  <StatusBadge tone={forecastConfidenceTone(confidence)}>
                    {normalizeStatusLabel(confidence)} confidence
                  </StatusBadge>
                </div>
                <strong>{stationName}</strong>
                <small>Next {horizonDays} day{horizonDays === 1 ? "" : "s"} · estimate</small>
                <div className="admin-ai-forecast-values">
                  <span>
                    <b>{formatForecastNumber(recordNumber(forecast, "predicted_orders"), 1)}</b>
                    <small>orders</small>
                  </span>
                  <span>
                    <b>{formatForecastNumber(recordNumber(forecast, "predicted_kg"), 1)} kg</b>
                    <small>LPG demand</small>
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ExpansionOpportunitiesPanel(props: {
  readonly opportunities: readonly PlatformRecord[];
}) {
  const priorityRank = (value: string | null) => {
    if (value === "high") return 4;
    if (value === "medium") return 3;
    if (value === "low") return 2;
    return 1;
  };
  const sorted = [...props.opportunities].sort((left, right) => {
    const priorityDifference =
      priorityRank(recordString(right, "reviewPriority")) -
      priorityRank(recordString(left, "reviewPriority"));
    if (priorityDifference !== 0) return priorityDifference;
    return recordNumber(right, "score") - recordNumber(left, "score");
  });
  const highPriority = sorted.filter((item) => recordString(item, "reviewPriority") === "high").length;

  return (
    <section className="sk-panel admin-ai-expansion">
      <div className="sk-panel__header admin-ai-panel-head">
        <div>
          <p className="admin-section-kicker">Expansion intelligence</p>
          <h2>Expansion opportunities</h2>
          <p>
            Review canonical customer interest together with real driver and station coverage
            requests. Scores are prioritization aids only; service coverage remains controlled by
            the Geography & Service Coverage workspace.
          </p>
        </div>
        <div className="admin-ai-expansion-head-actions">
          <StatusBadge tone={highPriority ? "warning" : sorted.length ? "info" : "success"}>
            {sorted.length ? String(sorted.length) + " area" + (sorted.length === 1 ? "" : "s") : "No review queue"}
          </StatusBadge>
          <Button
            icon={MapPinned}
            size="sm"
            variant="outline"
            requiredPermission="platform.coverage.read"
            onClick={() => {
              window.location.hash = "/coverage";
            }}
          >
            Open coverage workspace
          </Button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="admin-ai-expansion-empty">
          <MapPinned aria-hidden="true" />
          <div>
            <strong>No expansion opportunity needs review yet</strong>
            <span>
              Customer launch-interest and partner coverage requests will appear here when the
              system has enough verified location information to rank them.
            </span>
          </div>
        </div>
      ) : (
        <div className="admin-ai-expansion-list">
          {sorted.slice(0, 16).map((opportunity) => {
            const type = recordString(opportunity, "opportunityType") ?? "monitor";
            const priority = recordString(opportunity, "reviewPriority") ?? "monitor";
            const notLaunched = recordNumber(opportunity, "customerNotLaunchedUserCount");
            const excluded = recordNumber(opportunity, "customerExcludedUserCount");
            const conflicts = recordNumber(opportunity, "customerPolicyConflictUserCount");
            const pendingDrivers = recordNumber(opportunity, "pendingDriverApplicantCount");
            const pendingStations = recordNumber(opportunity, "pendingStationApplicantCount");

            return (
              <article
                className={"admin-ai-expansion-row is-" + type}
                key={recordString(opportunity, "id") ?? recordString(opportunity, "opportunityKey") ?? type}
              >
                <div className="admin-ai-expansion-pin">
                  <MapPinned aria-hidden="true" />
                </div>
                <div className="admin-ai-expansion-copy">
                  <div className="admin-ai-expansion-title">
                    <strong>{recordString(opportunity, "geographyName") ?? "Unmapped area"}</strong>
                    <StatusBadge tone={expansionPriorityTone(priority)}>
                      {normalizeStatusLabel(priority)} priority
                    </StatusBadge>
                    <span>{normalizeStatusLabel(type)}</span>
                  </div>
                  <div className="admin-ai-expansion-signals">
                    <span><small>Unlaunched customer interest</small><b>{Math.round(notLaunched)}</b></span>
                    <span><small>Pending drivers</small><b>{Math.round(pendingDrivers)}</b></span>
                    <span><small>Pending stations</small><b>{Math.round(pendingStations)}</b></span>
                    <span><small>Review score</small><b>{formatForecastNumber(recordNumber(opportunity, "score"), 1)}</b></span>
                  </div>
                  {excluded > 0 || conflicts > 0 ? (
                    <div className="admin-ai-expansion-cautions">
                      {excluded > 0 ? <span>{Math.round(excluded)} interested user{excluded === 1 ? "" : "s"} in intentionally excluded coverage</span> : null}
                      {conflicts > 0 ? <span>{Math.round(conflicts)} user{conflicts === 1 ? "" : "s"} affected by policy conflict</span> : null}
                    </div>
                  ) : null}
                  <p>
                    {recordString(opportunity, "recommendedAction") ??
                      "Review the canonical coverage evidence before making any service-area decision."}
                  </p>
                </div>
                <div className="admin-ai-expansion-mode">
                  <small>Control</small>
                  <b>Review only</b>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="admin-ai-expansion-guardrail">
        <ShieldCheck aria-hidden="true" />
        <span>
          SKIMA Intelligence cannot enable a town/LGA, override an exclusion, approve a partner,
          change operational coverage, or alter dispatch. Coverage changes stay human-approved in
          the existing geography controls.
        </span>
      </div>
    </section>
  );
}

function PricingIntelligencePanel(props: {
  readonly snapshot: PlatformRecord | null;
}) {
  const available = props.snapshot?.available === true;
  const distribution = recordObject(props.snapshot, "stationPriceDistribution");
  const historical = recordObject(props.snapshot, "historicalVolume");
  const assumptions = recordObject(props.snapshot, "assumptions");
  const scenarios = recordArray(props.snapshot, "scenarioProjections");
  const reviews = recordArray(props.snapshot, "stationPriceReviews");
  const currency = recordString(props.snapshot, "currencyCode") ?? "NGN";
  const currentMarkup = nullableRecordNumber(props.snapshot, "currentPlatformMarkupPerKg") ?? 0;
  const approvedStations = recordNumber(props.snapshot, "approvedStationCount");
  const pricedStations = recordNumber(props.snapshot, "pricedStationCount");

  return (
    <section className="sk-panel admin-ai-pricing">
      <div className="sk-panel__header admin-ai-panel-head">
        <div>
          <p className="admin-section-kicker">Pricing intelligence</p>
          <h2>Pricing simulation</h2>
          <p>
            Review governed station prices and simple fee scenarios using recent historical kg.
            Scenarios assume the same volume and do not model how customers would react to a price change.
          </p>
        </div>
        <StatusBadge tone={available ? "info" : "neutral"}>
          {available ? Math.round(pricedStations) + " / " + Math.round(approvedStations) + " stations priced" : "No snapshot yet"}
        </StatusBadge>
      </div>

      {!available ? (
        <div className="admin-ai-pricing-empty">
          <BadgeDollarSign aria-hidden="true" />
          <div>
            <strong>Pricing intelligence is not available yet</strong>
            <span>The worker will create a snapshot from governed SKIMA pricing and recent fulfilled LPG volume.</span>
          </div>
        </div>
      ) : (
        <>
          <div className="admin-ai-pricing-summary">
            <span>
              <small>Current SKIMA fee</small>
              <b>{formatFinanceAmount(currentMarkup, currency)} / kg</b>
            </span>
            <span>
              <small>Station median</small>
              <b>{formatOptionalFinanceAmount(nullableRecordNumber(distribution, "medianPerKg"), currency)}</b>
            </span>
            <span>
              <small>Station range</small>
              <b>
                {formatOptionalFinanceAmount(nullableRecordNumber(distribution, "minimumPerKg"), currency)}
                {" – "}
                {formatOptionalFinanceAmount(nullableRecordNumber(distribution, "maximumPerKg"), currency)}
              </b>
            </span>
            <span>
              <small>Recent volume basis</small>
              <b>{formatForecastNumber(recordNumber(historical, "kg"), 1)} kg</b>
            </span>
          </div>

          <div className="admin-ai-pricing-scenarios">
            {scenarios.slice(0, 7).map((scenario, index) => {
              const proposed = nullableRecordNumber(scenario, "proposedPlatformMarkupPerKg") ?? 0;
              const projected = nullableRecordNumber(scenario, "projectedPlatformRevenue") ?? 0;
              const difference = nullableRecordNumber(scenario, "differenceFromCurrent") ?? 0;
              const isCurrent = Math.abs(proposed - currentMarkup) < 0.005;
              return (
                <article className={"admin-ai-pricing-scenario " + (isCurrent ? "is-current" : "")} key={recordString(scenario, "multiplier") ?? String(index)}>
                  <div>
                    <small>{isCurrent ? "Current reference" : "Scenario only"}</small>
                    <strong>{formatFinanceAmount(proposed, currency)} / kg</strong>
                  </div>
                  <span>
                    <small>Same-volume revenue</small>
                    <b>{formatFinanceAmount(projected, currency)}</b>
                  </span>
                  <span className={difference > 0 ? "is-positive" : difference < 0 ? "is-negative" : undefined}>
                    <small>vs current</small>
                    <b>{formatSignedFinanceAmount(difference, currency)}</b>
                  </span>
                </article>
              );
            })}
          </div>

          {reviews.length ? (
            <div className="admin-ai-pricing-reviews">
              <div className="admin-ai-pricing-reviews__head">
                <strong>Station price review</strong>
                <small>
                  Outside the configured {formatForecastNumber(recordNumber(assumptions, "stationReviewDeviationPercent"), 0)}% median band · review only
                </small>
              </div>
              {reviews.slice(0, 6).map((review, index) => (
                <div className="admin-ai-pricing-review-row" key={recordString(review, "stationBranchId") ?? String(index)}>
                  <div>
                    <strong>{recordString(review, "stationDisplayName") ?? "Station"}</strong>
                    <small>{normalizeStatusLabel(recordString(review, "direction") ?? "review")}</small>
                  </div>
                  <span>{formatFinanceAmount(recordNumber(review, "pricePerKg"), currency)} / kg</span>
                  <b>{formatForecastNumber(recordNumber(review, "deviationPercent"), 1)}%</b>
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}

      <div className="admin-ai-pricing-guardrail">
        <ShieldCheck aria-hidden="true" />
        <span>
          Simulation only. This panel cannot set a station price, change the SKIMA fee, activate a financial policy, change a quote, or change dispatch.
        </span>
      </div>
    </section>
  );
}

function DispatchShadowPanel(props: {
  readonly assessments: readonly PlatformRecord[];
}) {
  const sorted = [...props.assessments].sort((left, right) => {
    const leftAgreement = recordBoolean(left, "selectionAgreement");
    const rightAgreement = recordBoolean(right, "selectionAgreement");
    if (leftAgreement !== rightAgreement) return leftAgreement ? 1 : -1;
    return (recordString(right, "generatedAt") ?? "").localeCompare(
      recordString(left, "generatedAt") ?? "",
    );
  });
  const evaluated = sorted.filter((item) => recordBoolean(item, "selectionAgreement") !== null);
  const agreements = evaluated.filter((item) => recordBoolean(item, "selectionAgreement") === true).length;
  const disagreements = evaluated.length - agreements;
  const agreementRate = evaluated.length ? Math.round((agreements / evaluated.length) * 100) : null;

  return (
    <section className="sk-panel admin-ai-dispatch-shadow">
      <div className="sk-panel__header admin-ai-panel-head">
        <div>
          <p className="admin-section-kicker">Dispatch intelligence</p>
          <h2>Shadow dispatch review</h2>
          <p>
            The production dispatcher still assigns drivers. This shadow model only compares a
            fairness-aware advisory rank against the canonical selection so SKIMA can evaluate it safely.
          </p>
        </div>
        <StatusBadge tone={disagreements ? "warning" : "success"}>
          {agreementRate === null ? "No comparisons yet" : String(agreementRate) + "% agreement"}
        </StatusBadge>
      </div>

      {sorted.length === 0 ? (
        <div className="admin-ai-dispatch-empty">
          <Route aria-hidden="true" />
          <div>
            <strong>No shadow dispatch comparisons yet</strong>
            <span>Comparisons appear after canonical LPG dispatch has produced eligible driver candidates.</span>
          </div>
        </div>
      ) : (
        <div className="admin-ai-dispatch-list">
          {sorted.slice(0, 12).map((assessment) => {
            const agreement = recordBoolean(assessment, "selectionAgreement");
            const evidence = recordObject(assessment, "evidence");
            const canonical = shortReference(recordString(assessment, "canonicalSelectedDriverId"));
            const advisory = shortReference(recordString(assessment, "advisorySelectedDriverId"));
            const candidateCount = recordNumber(assessment, "candidateCount");
            return (
              <article
                className={"admin-ai-dispatch-row " + (agreement === false ? "is-disagreement" : "")}
                key={recordString(assessment, "id") ?? canonical + advisory}
              >
                <div className="admin-ai-dispatch-route">
                  <Route aria-hidden="true" />
                </div>
                <div className="admin-ai-dispatch-copy">
                  <div className="admin-ai-dispatch-title">
                    <strong>{agreement === false ? "Ranking difference" : "Ranking agreement"}</strong>
                    <StatusBadge tone={agreement === false ? "warning" : "success"}>
                      {agreement === false ? "Review" : "Aligned"}
                    </StatusBadge>
                    <span>{Math.round(candidateCount)} candidate{candidateCount === 1 ? "" : "s"}</span>
                  </div>
                  <div className="admin-ai-dispatch-selection">
                    <span><small>Canonical</small><b>{canonical}</b></span>
                    <span><small>Shadow advisory</small><b>{advisory}</b></span>
                  </div>
                  <p>
                    Recent-assignment fairness window: {formatForecastNumber(recordNumber(evidence, "fairnessWindowHours"), 0)}h.
                    Risk signals are review-only and have no ranking effect.
                  </p>
                </div>
                <div className="admin-ai-dispatch-mode">
                  <small>Mode</small>
                  <b>Shadow only</b>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="admin-ai-dispatch-guardrail">
        <ShieldCheck aria-hidden="true" />
        <span>
          No comparison on this screen can assign, reject, block or make a driver ineligible.
        </span>
      </div>
    </section>
  );
}

function FinanceReconciliationPanel(props: {
  readonly findings: readonly PlatformRecord[];
}) {
  const sorted = [...props.findings].sort((left, right) => {
    const severityDifference =
      severityRank(recordString(right, "severity")) - severityRank(recordString(left, "severity"));
    if (severityDifference !== 0) return severityDifference;
    return (recordString(right, "last_detected_at") ?? "").localeCompare(
      recordString(left, "last_detected_at") ?? "",
    );
  });
  const elevated = sorted.filter((item) =>
    ["high", "critical"].includes(recordString(item, "severity") ?? "")
  ).length;

  return (
    <section className="sk-panel admin-ai-finance">
      <div className="sk-panel__header admin-ai-panel-head">
        <div>
          <p className="admin-section-kicker">Finance intelligence</p>
          <h2>Reconciliation review</h2>
          <p>
            Deterministic checks compare authoritative SKIMA finance records and surface mismatches
            for review. This screen cannot post ledger entries, move funds, refund, release escrow,
            reverse a transaction or authorize a correction.
          </p>
        </div>
        <StatusBadge tone={elevated ? "danger" : sorted.length ? "warning" : "success"}>
          {sorted.length ? String(sorted.length) + " finding" + (sorted.length === 1 ? "" : "s") : "Balanced"}
        </StatusBadge>
      </div>

      {sorted.length === 0 ? (
        <div className="admin-ai-finance-empty">
          <CheckCircle2 aria-hidden="true" />
          <div>
            <strong>No reconciliation finding needs review</strong>
            <span>Configured checks have not found an open ledger, settlement or deposit mismatch.</span>
          </div>
        </div>
      ) : (
        <div className="admin-ai-finance-list">
          {sorted.slice(0, 12).map((finding) => {
            const severity = recordString(finding, "severity") ?? "warning";
            const type = recordString(finding, "finding_type") ?? "finance_review";
            const subjectType = recordString(finding, "subject_type") ?? "finance_record";
            const subjectId = recordString(finding, "subject_id");
            const currency = recordString(finding, "currency_code") ?? "NGN";
            const expected = nullableRecordNumber(finding, "expected_amount");
            const observed = nullableRecordNumber(finding, "observed_amount");
            const variance = nullableRecordNumber(finding, "variance_amount");

            return (
              <article className="admin-ai-finance-row" key={recordString(finding, "id") ?? type + subjectId}>
                <div className={"admin-ai-finance-icon is-" + severity}>
                  <BadgeDollarSign aria-hidden="true" />
                </div>
                <div className="admin-ai-finance-copy">
                  <div className="admin-ai-finance-title">
                    <strong>{financeFindingTitle(type)}</strong>
                    <StatusBadge tone={severityTone(severity)}>
                      {normalizeStatusLabel(severity)}
                    </StatusBadge>
                    <span>{normalizeStatusLabel(subjectType)} · {shortEntityReference(subjectId)}</span>
                  </div>
                  <p>
                    {recordString(finding, "recommended_action") ??
                      "Review the authoritative finance records before considering any correction."}
                  </p>
                  <div className="admin-ai-finance-values">
                    {expected !== null ? (
                      <span><small>Expected</small><b>{formatFinanceAmount(expected, currency)}</b></span>
                    ) : null}
                    {observed !== null ? (
                      <span><small>Observed</small><b>{formatFinanceAmount(observed, currency)}</b></span>
                    ) : null}
                    {variance !== null ? (
                      <span><small>Variance</small><b>{formatFinanceAmount(variance, currency)}</b></span>
                    ) : null}
                  </div>
                </div>
                <div className="admin-ai-finance-mode">
                  <small>Control</small>
                  <b>Review only</b>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="admin-ai-finance-guardrail">
        <ShieldCheck aria-hidden="true" />
        <span>
          SKIMA financial records and reconciliation checks remain the source of truth. SKIMA Intelligence only explains what operators should review.
        </span>
      </div>
    </section>
  );
}

function PartnerRiskPanel(props: {
  readonly assessments: readonly PlatformRecord[];
}) {
  const sorted = [...props.assessments].sort(
    (left, right) => recordNumber(right, "score") - recordNumber(left, "score"),
  );
  const elevated = sorted.filter((item) =>
    ["high", "critical"].includes(recordString(item, "risk_level") ?? "")
  ).length;

  return (
    <section className="sk-panel admin-ai-risk">
      <div className="sk-panel__header admin-ai-panel-head">
        <div>
          <p className="admin-section-kicker">Trust intelligence</p>
          <h2>Partner risk review</h2>
          <p>
            Internal advisory signals from configured SKIMA evidence. A score is not proof of fraud
            and does not suspend a partner, hold funds, change dispatch eligibility or alter public reputation.
          </p>
        </div>
        <StatusBadge tone={elevated ? "warning" : "success"}>
          {elevated ? String(elevated) + " elevated" : "No elevated risk"}
        </StatusBadge>
      </div>

      {sorted.length === 0 ? (
        <div className="admin-ai-risk-empty">
          <ShieldCheck aria-hidden="true" />
          <div>
            <strong>No partner risk review needs attention</strong>
            <span>Medium, high and critical advisory assessments will appear here when evidence supports review.</span>
          </div>
        </div>
      ) : (
        <div className="admin-ai-risk-list">
          {sorted.slice(0, 12).map((assessment) => {
            const evidence = recordObject(assessment, "evidence");
            const level = recordString(assessment, "risk_level") ?? "medium";
            const score = recordNumber(assessment, "score");
            const subjectType = recordString(assessment, "subject_type") ?? "partner";
            const subjectName = recordString(evidence, "subjectDisplayName") ??
              shortReference(recordString(assessment, "subject_id"));
            return (
              <article className="admin-ai-risk-row" key={recordString(assessment, "id") ?? subjectName + score}>
                <div className={"admin-ai-risk-icon is-" + level}>
                  <ShieldAlert aria-hidden="true" />
                </div>
                <div className="admin-ai-risk-copy">
                  <div className="admin-ai-risk-title">
                    <strong>{subjectName}</strong>
                    <StatusBadge tone={riskTone(level)}>{normalizeStatusLabel(level)}</StatusBadge>
                    <span>{normalizeStatusLabel(subjectType)}</span>
                  </div>
                  <p>{recordString(assessment, "recommended_action") ?? "Review the supporting SKIMA evidence before making any decision."}</p>
                  <div className="admin-ai-risk-evidence">
                    <span><b>{formatForecastNumber(recordNumber(evidence, "recentOrders"), 0)}</b> recent orders</span>
                    <span><b>{formatForecastNumber(recordNumber(evidence, "openComplaints"), 0)}</b> open complaints</span>
                    <span><b>{formatForecastNumber(recordNumber(evidence, "disputedOrders"), 0)}</b> disputes</span>
                    <span><b>{formatForecastNumber(recordNumber(evidence, "fraudOpenComplaints"), 0)}</b> fraud reports</span>
                  </div>
                </div>
                <div className="admin-ai-risk-score">
                  <b>{formatForecastNumber(score, 0)}</b>
                  <small>/ 100 advisory</small>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function OperationalInsightsPanel(props: {
  readonly api: ReturnType<typeof useSessionState>["api"];
  readonly insights: readonly PlatformRecord[];
  readonly onChanged: () => Promise<void>;
}) {
  const [actionError, setActionError] = useState<string | null>(null);

  const action = useMutation({
    mutationFn: (input: { readonly insightId: string; readonly action: "acknowledge" | "dismiss" }) =>
      props.api.post(
        "/admin/ai/insight-action",
        {
          insightId: input.insightId,
          action: input.action,
        },
        MutationSchema,
      ),
    onSuccess: async () => {
      setActionError(null);
      await props.onChanged();
    },
    onError: (cause) => setActionError(readError(cause)),
  });

  const sorted = [...props.insights].sort(
    (a, b) => severityRank(recordString(b, "severity")) - severityRank(recordString(a, "severity")),
  );

  return (
    <section className="sk-panel admin-ai-insights">
      <div className="sk-panel__header admin-ai-panel-head">
        <div>
          <p className="admin-section-kicker">Exception intelligence</p>
          <h2>Needs attention</h2>
          <p>
            Deterministic SKIMA rules detect unusual operational states first. Ask SKIMA can then explain
            these facts without changing the affected record.
          </p>
        </div>
        <StatusBadge tone={sorted.length ? "warning" : "success"}>
          {sorted.length ? String(sorted.length) + " open" : "Clear"}
        </StatusBadge>
      </div>

      {actionError ? <div className="admin-notice is-error" role="alert">{actionError}</div> : null}

      {sorted.length === 0 ? (
        <div className="admin-ai-insights-empty">
          <CheckCircle2 aria-hidden="true" />
          <div>
            <strong>No current AI operational exceptions</strong>
            <span>The detector will surface configured exceptions here when they occur.</span>
          </div>
        </div>
      ) : (
        <div className="admin-ai-insight-list">
          {sorted.slice(0, 20).map((insight) => {
            const id = recordString(insight, "id") ?? "";
            const statusValue = recordString(insight, "status") ?? "open";
            const severity = recordString(insight, "severity") ?? "warning";
            return (
              <article className="admin-ai-insight-row" key={id}>
                <div className={"admin-ai-severity-dot is-" + severity} aria-hidden="true" />
                <div className="admin-ai-insight-copy">
                  <div className="admin-ai-insight-title">
                    <strong>{recordString(insight, "title") ?? "Operational exception"}</strong>
                    <StatusBadge tone={severityTone(severity)}>{normalizeStatusLabel(severity)}</StatusBadge>
                    {statusValue === "acknowledged" ? <StatusBadge tone="neutral">Acknowledged</StatusBadge> : null}
                  </div>
                  <p>{recordString(insight, "summary") ?? "SKIMA detected an operational state that needs review."}</p>
                  {recordString(insight, "recommended_action") ? (
                    <small><b>Suggested next check:</b> {recordString(insight, "recommended_action")}</small>
                  ) : null}
                </div>
                <div className="admin-ai-insight-actions">
                  {statusValue !== "acknowledged" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      requiredPermission="platform.ai.manage"
                      disabled={action.isPending}
                      onClick={() => action.mutate({ insightId: id, action: "acknowledge" })}
                    >
                      Acknowledge
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    requiredPermission="platform.ai.manage"
                    disabled={action.isPending}
                    onClick={() => action.mutate({ insightId: id, action: "dismiss" })}
                  >
                    Dismiss
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function RouteEditor(props: {
  readonly api: ReturnType<typeof useSessionState>["api"];
  readonly capabilityKey: string;
  readonly capabilityResponseMode: string;
  readonly providers: readonly PlatformRecord[];
  readonly currentProviderKey: string | null;
  readonly currentModel: string | null;
  readonly currentFallbackRoute: PlatformRecord | null;
  readonly onSaved: () => Promise<void>;
}) {
  const activeProviders = useMemo(
    () => props.providers.filter((provider) =>
      ["active", "degraded"].includes(recordString(provider, "status") ?? "") &&
      providerSupportsResponseMode(provider, props.capabilityResponseMode)
    ),
    [props.capabilityResponseMode, props.providers],
  );
  const freeProviders = useMemo(
    () => activeProviders.filter((provider) =>
      recordString(recordObject(provider, "config"), "billing_tier") === "free"
    ),
    [activeProviders],
  );
  const fallbackProviderId = recordString(props.currentFallbackRoute, "provider_adapter_id");
  const currentFallbackProvider = props.providers.find((provider) =>
    recordString(provider, "id") === fallbackProviderId
  );
  const [providerKey, setProviderKey] = useState(
    props.currentProviderKey ?? recordString(activeProviders[0], "key") ?? "",
  );
  const [modelKey, setModelKey] = useState(props.currentModel ?? "");
  const [reason, setReason] = useState("Update SKIMA AI capability route.");
  const [fallbackProviderKey, setFallbackProviderKey] = useState(
    recordString(currentFallbackProvider, "key") ?? recordString(freeProviders[0], "key") ?? "",
  );
  const [fallbackModelKey, setFallbackModelKey] = useState(
    recordString(props.currentFallbackRoute, "model_key") ?? "",
  );
  const [fallbackPriority, setFallbackPriority] = useState(
    String(Math.max(2, recordNumber(props.currentFallbackRoute, "priority") || 100)),
  );
  const [fallbackError, setFallbackError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fallbackSave = useMutation({
    mutationFn: () =>
      props.api.post(
        "/admin/ai/free-fallback-route",
        {
          capabilityKey: props.capabilityKey,
          providerAdapterKey: fallbackProviderKey,
          modelKey: fallbackModelKey,
          priority: Number(fallbackPriority),
          enabled: true,
          reason: "Configure free fallback for " + props.capabilityKey + ".",
          idempotencyKey: createClientIdempotencyKey(
            "admin.ai.free-fallback",
            props.capabilityKey + ":" + fallbackProviderKey + ":" + fallbackModelKey + ":" + fallbackPriority,
          ),
        },
        MutationSchema,
      ),
    onSuccess: props.onSaved,
    onError: (cause) => setFallbackError(readError(cause)),
  });

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

      <div className="admin-ai-fallback-editor">
        <div>
          <strong>Free fallback</strong>
          <small>Used automatically only after quota/rate-limit/retryable provider failure.</small>
        </div>
        {freeProviders.length ? (
          <>
            <label className="admin-ai-field">
              <span>Fallback provider</span>
              <select
                value={fallbackProviderKey}
                onChange={(event) => setFallbackProviderKey(event.currentTarget.value)}
              >
                <option value="" disabled>Select free provider</option>
                {freeProviders.map((provider) => {
                  const key = recordString(provider, "key") ?? "";
                  return <option key={key} value={key}>{recordString(provider, "display_name") ?? key}</option>;
                })}
              </select>
            </label>
            <TextInput
              label="Fallback model"
              value={fallbackModelKey}
              onChange={(event) => setFallbackModelKey(event.currentTarget.value)}
              placeholder="Free-tier model identifier"
            />
            <TextInput
              label="Priority"
              value={fallbackPriority}
              onChange={(event) => setFallbackPriority(event.currentTarget.value)}
            />
            <div className="admin-ai-editor-action">
              <Button
                type="button"
                variant="outline"
                isLoading={fallbackSave.isPending}
                disabled={!fallbackProviderKey || !fallbackModelKey.trim()}
                requiredPermission="platform.ai.manage"
                onClick={() => {
                  setFallbackError(null);
                  fallbackSave.mutate();
                }}
              >
                Save free fallback
              </Button>
            </div>
          </>
        ) : (
          <div className="admin-ai-provider-note">
            <ShieldCheck aria-hidden="true" />
            <span>Mark another configured AI provider as Free before it can be used automatically.</span>
          </div>
        )}
        {fallbackError ? <div className="admin-notice is-error" role="alert">{fallbackError}</div> : null}
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
  const [billingTier, setBillingTier] = useState("unknown");
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
          config: { billing_tier: billingTier },
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
        <label className="admin-ai-field">
          <span>Billing tier</span>
          <select value={billingTier} onChange={(event) => setBillingTier(event.currentTarget.value)}>
            <option value="unknown">Unknown / manual only</option>
            <option value="free">Free tier eligible</option>
            <option value="paid">Paid / never automatic fallback</option>
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

function providerSupportsResponseMode(provider: PlatformRecord, responseMode: string): boolean {
  const config = recordObject(provider, "config");
  const supports = config.supports;
  return Array.isArray(supports) && supports.some(
    (value) => typeof value === "string" && value === responseMode,
  );
}

function recordObject(record: PlatformRecord | null | undefined, key: string): Readonly<Record<string, unknown>> {
  const value = record?.[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}

function recordArray(
  record: PlatformRecord | null | undefined,
  key: string,
): readonly PlatformRecord[] {
  const value = record?.[key];
  return Array.isArray(value)
    ? value.filter((item): item is PlatformRecord =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function recordBoolean(
  record: PlatformRecord | null | undefined,
  key: string,
): boolean | null {
  const value = record?.[key];
  return typeof value === "boolean" ? value : null;
}

function recordNumber(record: PlatformRecord | null | undefined, key: string): number {
  const value = record?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function nullableRecordNumber(
  record: PlatformRecord | null | undefined,
  key: string,
): number | null {
  const value = record?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function financeFindingTitle(value: string): string {
  if (value === "service_request_unbalanced") return "Service request is out of balance";
  if (value === "settlement_missing_transaction") return "Posted settlement has no ledger transaction";
  if (value === "deposit_missing_transaction") return "Successful deposit has no ledger transaction";
  return "Finance record needs review";
}

function shortEntityReference(value: string | null): string {
  return value ? value.slice(0, 8) : "unknown";
}

function formatFinanceAmount(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return currency + " " + new Intl.NumberFormat("en-NG", {
      maximumFractionDigits: 2,
    }).format(value);
  }
}

function formatOptionalFinanceAmount(value: number | null, currency: string): string {
  return value === null ? "—" : formatFinanceAmount(value, currency);
}

function formatSignedFinanceAmount(value: number, currency: string): string {
  if (Math.abs(value) < 0.005) return formatFinanceAmount(0, currency);
  return (value > 0 ? "+" : "−") + formatFinanceAmount(Math.abs(value), currency);
}

function shortReference(value: string | null): string {
  if (!value) return "Station";
  return "Station " + value.slice(0, 8);
}

function formatForecastNumber(value: number, fractionDigits: number): string {
  return new Intl.NumberFormat("en-NG", {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: 0,
  }).format(Math.max(0, value));
}

function forecastConfidenceTone(
  value: string,
): "neutral" | "success" | "warning" | "danger" | "info" {
  if (value === "high") return "success";
  if (value === "medium") return "info";
  return "warning";
}

function riskTone(
  value: string,
): "neutral" | "success" | "warning" | "danger" | "info" {
  if (value === "critical" || value === "high") return "danger";
  if (value === "medium") return "warning";
  return "success";
}

function expansionPriorityTone(
  value: string,
): "neutral" | "success" | "warning" | "danger" | "info" {
  if (value === "high") return "warning";
  if (value === "medium") return "info";
  if (value === "low") return "neutral";
  return "success";
}

function severityRank(value: string | null): number {
  if (value === "critical") return 4;
  if (value === "high") return 3;
  if (value === "warning") return 2;
  return 1;
}

function severityTone(value: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (value === "critical" || value === "high") return "danger";
  if (value === "warning") return "warning";
  return "info";
}

function recordString(record: PlatformRecord | null | undefined, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : "The request could not be completed.";
}
