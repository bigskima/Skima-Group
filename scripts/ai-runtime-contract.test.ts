const repositoryRoot = new URL("../", import.meta.url);

const [
  canonicalAiSql,
  providerExtensionSql,
  exceptionSql,
  exceptionHardeningSql,
  providerModalitySql,
  forecastSql,
  forecastGuardSql,
  refillOutlookSql,
  complaintStatusSql,
  partnerRiskSql,
  partnerRiskGuardSql,
  providerRuntime,
  workerSource,
  gatewaySource,
  adminAiWorkspace,
  mobileAssistant,
  customerLayout,
  driverLayout,
  stationLayout,
] = await Promise.all([
  readRepositoryFile("supabase/migrations/20260905074500_ai_intelligence_runtime.sql"),
  readRepositoryFile("supabase/migrations/20260905214500_ai_copilot_provider_runtime.sql"),
  readRepositoryFile("supabase/migrations/20260905093000_ai_exception_intelligence.sql"),
  readRepositoryFile("supabase/migrations/20260905220000_ai_exception_runtime_hardening.sql"),
  readRepositoryFile("supabase/migrations/20260905220500_ai_provider_modality_hardening.sql"),
  readRepositoryFile("supabase/migrations/20260905223000_ai_demand_forecast_runtime.sql"),
  readRepositoryFile("supabase/migrations/20260905223500_ai_demand_forecast_configuration_guard.sql"),
  readRepositoryFile("supabase/migrations/20260905225000_customer_refill_outlook_runtime.sql"),
  readRepositoryFile("supabase/migrations/20260905230500_customer_complaint_status_read_runtime.sql"),
  readRepositoryFile("supabase/migrations/20260905233000_ai_partner_trust_risk_runtime.sql"),
  readRepositoryFile("supabase/migrations/20260905233500_ai_partner_risk_configuration_guard.sql"),
  readRepositoryFile("supabase/functions/_shared/ai-provider-runtime.ts"),
  readRepositoryFile("supabase/functions/runtime-worker/index.ts"),
  readRepositoryFile("supabase/functions/api-gateway/index.ts"),
  readRepositoryFile("apps/admin/src/admin-ai-workspace.tsx"),
  readRepositoryFile("apps/lpg-mobile/src/native/ui/AiAssistantScreen.tsx"),
  readRepositoryFile("apps/lpg-mobile/app/(customer)/_layout.tsx"),
  readRepositoryFile("apps/lpg-mobile/app/(driver)/_layout.tsx"),
  readRepositoryFile("apps/lpg-mobile/app/(station)/_layout.tsx"),
]);

Deno.test("AI capabilities resolve providers from database routes", () => {
  const sql = normalizeWhitespace(canonicalAiSql);

  assertIncludes(
    sql,
    "create table if not exists public.ai_provider_routes",
    "AI provider routes must be database records",
  );
  assertIncludes(
    sql,
    "create or replace function public.resolve_ai_provider_route",
    "AI runtime must expose a provider route resolver",
  );
  assertIncludes(
    sql,
    "order by case provider.status when 'active' then 0 else 1 end, route.priority asc",
    "provider resolution must respect database route priority",
  );
  assertIncludes(
    sql,
    "revoke all on function public.resolve_ai_provider_route(text) from public, anon, authenticated",
    "provider route resolution must remain server-only because it returns credential references",
  );
  assertIncludes(
    sql,
    "create or replace function public.set_ai_capability_provider",
    "admins need a database-governed provider switch",
  );
  assertIncludes(
    sql,
    "public.has_permission('platform.ai.manage', null)",
    "provider changes must require AI management permission",
  );
});

Deno.test("text AI runtime is transport-driven rather than provider-name-driven", () => {
  for (const transport of [
    "google_generate_content",
    "openai_compatible_chat",
    "anthropic_messages",
  ]) {
    assertIncludes(
      providerRuntime,
      `transport === "${transport}"`,
      `missing AI transport ${transport}`,
    );
  }

  assertNotMatch(
    providerRuntime,
    /providerAdapterKey\s*===\s*["']provider\.ai\./,
    "text execution must not branch on a provider adapter key",
  );
  assertIncludes(
    providerExtensionSql,
    "'anthropic_messages'",
    "provider configuration must allow Anthropic Messages without client redeploy",
  );
  assertIncludes(
    providerExtensionSql,
    "to_jsonb(provider_record) - 'secret_ref'",
    "provider configuration responses must remove secret references",
  );
  assertIncludes(
    providerModalitySql,
    "when 'anthropic_messages' then '[\"text\",\"json\"]'::jsonb",
    "Anthropic configuration must advertise text/json support",
  );
  assertIncludes(
    providerModalitySql,
    "'supports', transport_supports",
    "new provider configuration must persist its response-mode support",
  );
});

Deno.test("existing cylinder and driver image AI uses configured capability routes", () => {
  assertIncludes(
    workerSource,
    "const route = await resolveAiProviderRoute(supabase, capabilityKey);",
    "image generation must resolve the provider through the canonical AI route",
  );
  assertIncludes(
    workerSource,
    'capabilityKey = isPresentation',
    "image task processing must choose an AI capability before resolving a route",
  );
  assertIncludes(
    workerSource,
    '"ai.lpg.cylinder.presentation"',
    "cylinder presentation capability must remain wired",
  );
  assertIncludes(
    workerSource,
    '"ai.driver.card_photo.enhance"',
    "driver card photo capability must remain wired",
  );
  assertIncludes(
    workerSource,
    'error.code === "route_resolution_failed"',
    "legacy image configuration may only be used when the route migration is unavailable",
  );
  assertNotIncludes(
    canonicalAiSql,
    "provider.key in ('provider.ai.cloudflare-workers-ai', 'provider.ai.google-gemini')",
    "owned image queueing must not hardcode the allowed provider names",
  );
});

Deno.test("Ask SKIMA remains grounded, read-only, and workspace-authorized", () => {
  const sql = normalizeWhitespace(canonicalAiSql);
  assertIncludes(
    sql,
    "create or replace function public.can_access_ai_workspace",
    "AI workspace access must be enforced in the backend",
  );
  assertIncludes(
    gatewaySource,
    "This assistant is read-only.",
    "assistant system prompt must explicitly forbid business-state mutation",
  );
  assertIncludes(
    gatewaySource,
    '"SKIMA database state, ledger entries, pricing policies, permissions, dispatch rules, custody records and workflow states are authoritative.',
    "assistant must treat SKIMA runtime state as authoritative",
  );
  assertMatch(
    mobileAssistant,
    /Read[- ]only/i,
    "mobile assistant must visibly communicate its read-only posture",
  );
  assertNotMatch(
    mobileAssistant,
    /SUPABASE_SERVICE_ROLE|GEMINI_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY/,
    "provider or service secrets must never be present in the mobile assistant",
  );
});

Deno.test("assistant screens stay contextual instead of becoming bottom navigation tabs", () => {
  for (const [workspace, layout] of [
    ["customer", customerLayout],
    ["driver", driverLayout],
    ["station", stationLayout],
  ] as const) {
    assertIncludes(
      layout,
      '"assistant"',
      `${workspace} assistant route must be hidden from bottom tabs`,
    );
  }
});

Deno.test("admin SKIMA Intelligence can switch providers without exposing API keys", () => {
  assertIncludes(
    adminAiWorkspace,
    '"/admin/ai/provider-route"',
    "admin AI workspace must use the governed route switch endpoint",
  );
  assertIncludes(
    adminAiWorkspace,
    '"/admin/ai/provider-config"',
    "admin AI workspace must use the governed provider configuration endpoint",
  );
  assertIncludes(
    adminAiWorkspace,
    'value="anthropic_messages"',
    "admin provider setup must expose Anthropic transport after backend support is added",
  );
  assertIncludes(
    adminAiWorkspace,
    'requiredPermission="platform.ai.manage"',
    "AI provider mutations must be permission-gated in the admin UI",
  );
  assertIncludes(
    adminAiWorkspace,
    "providerSupportsResponseMode",
    "admin route editor must filter providers by capability response mode",
  );
  assertNotMatch(
    adminAiWorkspace,
    /(AIza[0-9A-Za-z_-]{20,}|sk-[0-9A-Za-z_-]{20,})/,
    "admin source must not contain literal provider credentials",
  );
});

Deno.test("operational exception intelligence is deterministic and uses canonical schemas", () => {
  assertIncludes(
    exceptionSql,
    "Detection is rule/config driven; AI may explain insights but never creates authoritative business state.",
    "exception detection must remain deterministic before AI explanation",
  );
  assertIncludes(
    exceptionHardeningSql,
    '"awaiting_payment"',
    "stale-order detector must use canonical LPG order states",
  );
  assertIncludes(
    exceptionHardeningSql,
    "task.completed_at as failure_at",
    "failed AI task timing must use the canonical ai_task_runs terminal timestamp",
  );
  assertNotIncludes(
    exceptionHardeningSql,
    "task.failed_at",
    "hardening runtime must not reference a non-existent ai_task_runs.failed_at column",
  );
  assertIncludes(
    exceptionHardeningSql,
    "status in ('dismissed','acknowledged')",
    "refresh must preserve an administrator acknowledgement while an exception persists",
  );
  assertIncludes(
    normalizeWhitespace(exceptionHardeningSql),
    "revoke all on function public.refresh_ai_operational_insights() from public, anon, authenticated",
    "exception refresh must remain unavailable to authenticated clients",
  );
  assertIncludes(
    normalizeWhitespace(exceptionHardeningSql),
    "grant execute on function public.refresh_ai_operational_insights() to service_role",
    "exception refresh execution must stay backend-only",
  );
  assertNotIncludes(
    gatewaySource,
    "completed_at,failed_at",
    "admin AI context must not query a non-existent ai_task_runs.failed_at column",
  );
});

Deno.test("demand forecasting is deterministic, configuration-driven, and non-authoritative", () => {
  const sql = normalizeWhitespace(forecastSql);

  assertIncludes(
    sql,
    "create table if not exists public.ai_forecast_definitions",
    "forecast definitions must be database configuration",
  );
  assertIncludes(
    sql,
    "create table if not exists public.ai_forecast_snapshots",
    "forecast results must be persisted as auditable snapshots",
  );
  assertIncludes(
    sql,
    "method text not null check (method in ('weighted_moving_average'))",
    "the initial forecast method must remain deterministic",
  );
  assertIncludes(
    sql,
    "short_weight * (short_order_count::numeric / short_window_days::numeric)",
    "forecast calculation must be derived from order history rather than an LLM",
  );
  assertNotMatch(
    forecastSql,
    /provider\.ai\.|resolve_ai_provider_route|executeAiText|generativelanguage|chat\/completions/,
    "forecast calculation must not call an AI provider",
  );
  assertIncludes(
    sql,
    "revoke all on function public.refresh_ai_demand_forecasts() from public, anon, authenticated",
    "forecast refresh must not be callable by regular clients",
  );
  assertIncludes(
    sql,
    "grant execute on function public.refresh_ai_demand_forecasts() to service_role",
    "forecast refresh must remain a backend worker operation",
  );
  assertIncludes(
    sql,
    "security invoker",
    "forecast reads must preserve caller authorization and RLS",
  );
  assertIncludes(
    sql,
    "public.can_operate_lpg_station_branch(subject_id, 'lpg.stations.read')",
    "station forecast reads must be branch-scoped",
  );
});

Deno.test("demand forecast configuration is validated before background execution", () => {
  const sql = normalizeWhitespace(forecastGuardSql);
  assertIncludes(
    sql,
    "create or replace function public.validate_ai_forecast_definition_config",
    "forecast configuration needs a database validation boundary",
  );
  assertIncludes(
    sql,
    "short forecast weight must be between 0 and 1",
    "forecast weights must be bounded",
  );
  assertIncludes(
    sql,
    "each forecast horizon must be a whole number between 1 and 90 days",
    "forecast horizons must be bounded",
  );
  assertIncludes(
    sql,
    "forecast order statuses must use canonical non-failed lpg lifecycle states",
    "forecast input states must remain canonical and exclude failed/refunded/cancelled demand",
  );
});

Deno.test("forecast runtime is fail-soft and clearly labelled as an estimate", () => {
  assertIncludes(
    workerSource,
    'source: "runtime-worker.ai-demand-forecasts"',
    "worker must isolate forecast refresh failures",
  );
  assertIncludes(
    workerSource,
    'reason: "forecast_runtime_not_ready"',
    "worker must tolerate an undeployed forecast migration",
  );
  assertMatch(
    workerSource,
    /data:\s*\{\s*aiForecasts,\s*aiInsights,\s*aiRisk,\s*aiTasks,/,
    "worker response must expose forecast refresh health",
  );
  assertIncludes(
    gatewaySource,
    "Demand forecasts are statistical estimates from recent SKIMA order history.",
    "Ask SKIMA must label forecasts as estimates",
  );
  assertIncludes(
    gatewaySource,
    "demandForecasts:",
    "station/admin grounding must include authorized forecast snapshots",
  );
  assertIncludes(
    adminAiWorkspace,
    "Demand outlook",
    "admin Intelligence must surface demand estimates",
  );
  assertIncludes(
    adminAiWorkspace,
    "These numbers do not change",
    "admin demand UI must state that forecasts do not control business state",
  );
});

Deno.test("customer refill outlook is personal, deterministic, and never a gas gauge", () => {
  const sql = normalizeWhitespace(refillOutlookSql);

  assertIncludes(
    sql,
    "where orders.customer_user_id = (select auth.uid())",
    "refill outlook must be restricted to the signed-in customer's order history",
  );
  assertIncludes(
    sql,
    "orders.status in ('delivered', 'completed')",
    "refill outlook must use completed delivery history",
  );
  assertIncludes(
    sql,
    "average_interval_days",
    "refill outlook must derive its estimate from historical intervals",
  );
  assertIncludes(
    sql,
    "'doesnotmeasureremaininggas', true",
    "refill outlook payload must explicitly state that it does not measure remaining gas",
  );
  assertNotMatch(
    refillOutlookSql,
    /provider\.ai\.|resolve_ai_provider_route|generativelanguage|chat\/completions/,
    "refill outlook calculation must not consume an AI provider",
  );
  assertIncludes(
    gatewaySource,
    "They do not measure remaining gas, cylinder pressure or safety",
    "Ask SKIMA must explain the limits of refill outlook estimates",
  );
  assertIncludes(
    gatewaySource,
    "refillOutlook:",
    "customer AI grounding must include the personal refill outlook",
  );
  assertIncludes(
    mobileAssistant,
    "When might I need another refill?",
    "customer assistant should expose the refill outlook question",
  );
});

Deno.test("Ask SKIMA support escalation requires explicit user action and reuses complaints runtime", () => {
  assertIncludes(
    gatewaySource,
    'routePath === "/runtime/ai/support-case"',
    "Ask SKIMA must expose a dedicated support action boundary",
  );
  assertIncludes(
    gatewaySource,
    "if (payload.confirmed !== true)",
    "support escalation must require explicit user confirmation",
  );
  assertIncludes(
    gatewaySource,
    'target_source: "skima.ai.customer_assistant"',
    "AI-originated support cases must be auditable by source",
  );
  assertIncludes(
    gatewaySource,
    'supabase.rpc("create_lpg_service_complaint"',
    "Ask SKIMA must reuse the canonical LPG complaint runtime",
  );
  assertIncludes(
    gatewaySource,
    'confirmation: "explicit"',
    "support case metadata must record the confirmation boundary",
  );
  assertIncludes(
    gatewaySource,
    'supabase.rpc("read_my_lpg_service_complaints"',
    "support action must inspect the customer's existing cases before creating another",
  );
  assertIncludes(
    mobileAssistant,
    "Ask SKIMA cannot submit this form by itself.",
    "mobile support UI must explain that the model cannot submit the action",
  );
  assertIncludes(
    mobileAssistant,
    "User controlled",
    "support UI must label the action as user-controlled before submission",
  );
  assertIncludes(
    mobileAssistant,
    "Creating this case does not cancel the order, refund money, change dispatch, or edit a payment.",
    "support action must state its non-authoritative effect",
  );
});

Deno.test("customer support case status projection never exposes internal moderation notes", () => {
  const sql = normalizeWhitespace(complaintStatusSql);

  assertIncludes(
    sql,
    "where complaint.customer_user_id = auth.uid()",
    "customer complaint projection must scope every row to the signed-in customer",
  );
  assertIncludes(
    sql,
    "'publichistory'",
    "customer complaint projection should expose public status history",
  );
  assertNotIncludes(
    sql,
    "internal_note",
    "customer complaint projection must never expose internal moderation notes",
  );
  assertIncludes(
    gatewaySource,
    "supportCases:",
    "customer Ask SKIMA grounding must include support case status",
  );
  assertIncludes(
    gatewaySource,
    "Never invent internal review notes",
    "assistant prompt must forbid invented private moderation context",
  );
});

Deno.test("partner trust risk is deterministic, internal, and advisory-only", () => {
  const sql = normalizeWhitespace(partnerRiskSql);

  assertIncludes(
    sql,
    "create table if not exists public.ai_risk_rules",
    "partner risk rules must be database configuration",
  );
  assertIncludes(
    sql,
    "create table if not exists public.ai_risk_assessments",
    "partner risk assessments must be versioned internal records",
  );
  assertIncludes(
    sql,
    "and driver.verification_status = 'approved'",
    "driver risk review must follow the canonical production approval state",
  );
  assertIncludes(
    sql,
    "and station.approval_status = 'approved'",
    "station risk review must follow the canonical production approval state",
  );
  assertIncludes(
    sql,
    '"control": "advisory_only"',
    "risk configuration must identify advisory-only control",
  );
  assertNotMatch(
    partnerRiskSql,
    /provider\.ai\.|resolve_ai_provider_route|executeAiText|generativelanguage|chat\/completions/,
    "risk scoring must not call an LLM or model provider",
  );
  assertIncludes(
    sql,
    "revoke all on function public.refresh_ai_partner_risk_assessments() from public, anon, authenticated",
    "risk refresh must remain unavailable to normal clients",
  );
  assertIncludes(
    sql,
    "grant execute on function public.refresh_ai_partner_risk_assessments() to service_role",
    "risk refresh must remain a backend worker operation",
  );
  assertIncludes(
    sql,
    "'doesnotchangeeligibility', true",
    "risk evidence must explicitly state it does not change eligibility",
  );
  assertIncludes(
    sql,
    "'doesnotholdfunds', true",
    "risk evidence must explicitly state it does not hold funds",
  );
  assertIncludes(
    sql,
    "'doesnotchangedispatch', true",
    "risk evidence must explicitly state it does not alter dispatch",
  );
  assertIncludes(
    sql,
    "public.has_permission('platform.ai.read', null)",
    "risk reads must require authorized AI administration access",
  );
});

Deno.test("partner risk configuration cannot be converted into automatic enforcement", () => {
  const sql = normalizeWhitespace(partnerRiskGuardSql);

  assertIncludes(
    sql,
    "create or replace function public.validate_ai_risk_rule_config",
    "risk configuration must have a database validation boundary",
  );
  assertIncludes(
    sql,
    "partner risk control must remain advisory_only",
    "risk configuration must reject automatic enforcement modes",
  );
  assertIncludes(
    sql,
    "risk thresholds must increase from medium to high to critical within 0 to 100",
    "risk thresholds must be ordered and bounded",
  );
  assertIncludes(
    sql,
    "risk weights must be numbers between 0 and 100",
    "risk weights must be bounded",
  );
});

Deno.test("partner risk is exposed only to authorized admin intelligence", () => {
  assertIncludes(
    gatewaySource,
    "partnerRiskAssessments:",
    "admin Ask SKIMA context must receive risk assessments",
  );
  assertIncludes(
    gatewaySource,
    "Partner risk assessments are internal advisory signals for authorized administrators only.",
    "assistant prompt must identify risk data as internal advisory context",
  );
  assertIncludes(
    gatewaySource,
    "Never disclose internal partner risk assessments to customer, driver or station workspaces.",
    "assistant prompt must forbid cross-workspace risk disclosure",
  );
  assertIncludes(
    gatewaySource,
    'target_minimum_level: "medium"',
    "admin AI grounding should avoid flooding context with routine low-risk assessments",
  );
  assertNotIncludes(
    mobileAssistant,
    "partnerRiskAssessments",
    "mobile customer/driver/station assistant must never receive the internal risk projection",
  );
  assertNotIncludes(
    mobileAssistant,
    "Partner risk review",
    "internal partner risk UI must not appear in the mobile assistant",
  );
  assertIncludes(
    adminAiWorkspace,
    "Partner risk review",
    "admin SKIMA Intelligence must surface internal risk review",
  );
  assertIncludes(
    adminAiWorkspace,
    "A score is not proof of fraud",
    "admin risk UI must state the fairness/evidence limitation",
  );
  assertIncludes(
    adminAiWorkspace,
    "does not suspend a partner, hold funds, change dispatch eligibility or alter public reputation",
    "admin risk UI must state the non-enforcement boundary",
  );
  assertIncludes(
    workerSource,
    'source: "runtime-worker.ai-partner-risk"',
    "worker must isolate risk refresh failures",
  );
  assertIncludes(
    workerSource,
    'reason: "risk_runtime_not_ready"',
    "worker must fail soft if risk migrations are not deployed",
  );
});

Deno.test("worker reports exception refresh exactly once per response section", () => {
  assertNotIncludes(
    workerSource,
    "aiInsights,\n        aiInsights,",
    "worker health details must not duplicate the AI insight result",
  );
  assertMatch(
    workerSource,
    /data:\s*\{\s*aiForecasts,\s*aiInsights,\s*aiRisk,\s*aiTasks,/,
    "worker response must expose the AI insight refresh result",
  );
});

async function readRepositoryFile(path: string): Promise<string> {
  return await Deno.readTextFile(new URL(path, repositoryRoot));
}

function normalizeWhitespace(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function assertIncludes(value: string, expected: string, message: string): void {
  if (!value.includes(expected)) {
    throw new Error(message + `\nExpected to include: ${expected}`);
  }
}

function assertNotIncludes(value: string, unexpected: string, message: string): void {
  if (value.includes(unexpected)) {
    throw new Error(message + `\nUnexpected content: ${unexpected}`);
  }
}

function assertMatch(value: string, pattern: RegExp, message: string): void {
  if (!pattern.test(value)) {
    throw new Error(message + `\nExpected pattern: ${String(pattern)}`);
  }
}

function assertNotMatch(value: string, pattern: RegExp, message: string): void {
  if (pattern.test(value)) {
    throw new Error(message + `\nUnexpected pattern: ${String(pattern)}`);
  }
}
