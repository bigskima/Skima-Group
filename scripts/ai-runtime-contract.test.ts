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
  cylinderVisualReviewSql,
  customerPriceExplanationSql,
  driverEarningsExplanationSql,
  partnerRiskSql,
  partnerRiskGuardSql,
  dispatchShadowSql,
  dispatchShadowGuardSql,
  financeReconciliationSql,
  financeReconciliationScopeSql,
  pricingIntelligenceSql,
  expansionIntelligenceSql,
  usageGovernorSql,
  freeFallbackSql,
  primaryRoutePreservationSql,
  fallbackIntegritySql,
  providerRuntime,
  workerSource,
  gatewaySource,
  adminAiWorkspace,
  mobileAssistant,
  mobileAiLauncher,
  mobileAiContextAction,
  cylinderVisualReviewPanel,
  cylinderDetailScreen,
  customerOrderScreen,
  financeScreen,
  jobDetailScreen,
  stationInventoryScreen,
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
  readRepositoryFile("supabase/migrations/20260905234000_ai_cylinder_visual_review_runtime.sql"),
  readRepositoryFile("supabase/migrations/20260906005000_customer_price_explanation_runtime.sql"),
  readRepositoryFile("supabase/migrations/20260906006000_driver_earnings_explanation_runtime.sql"),
  readRepositoryFile("supabase/migrations/20260905233000_ai_partner_trust_risk_runtime.sql"),
  readRepositoryFile("supabase/migrations/20260905233500_ai_partner_risk_configuration_guard.sql"),
  readRepositoryFile("supabase/migrations/20260905235000_ai_dispatch_shadow_intelligence.sql"),
  readRepositoryFile("supabase/migrations/20260905235500_ai_dispatch_shadow_configuration_guard.sql"),
  readRepositoryFile("supabase/migrations/20260905234500_ai_finance_reconciliation_intelligence.sql"),
  readRepositoryFile("supabase/migrations/20260906000500_ai_finance_reconciliation_scope_hardening.sql"),
  readRepositoryFile("supabase/migrations/20260906002000_ai_pricing_intelligence.sql"),
  readRepositoryFile("supabase/migrations/20260906004000_ai_service_area_expansion_intelligence.sql"),
  readRepositoryFile("supabase/migrations/20260905231500_ai_usage_quota_and_free_failover_runtime.sql"),
  readRepositoryFile("supabase/migrations/20260905232000_ai_free_fallback_and_quota_management.sql"),
  readRepositoryFile("supabase/migrations/20260905232500_ai_primary_route_preserve_free_fallback.sql"),
  readRepositoryFile("supabase/migrations/20260905232700_ai_fallback_route_integrity_guard.sql"),
  readRepositoryFile("supabase/functions/_shared/ai-provider-runtime.ts"),
  readRepositoryFile("supabase/functions/runtime-worker/index.ts"),
  readRepositoryFile("supabase/functions/api-gateway/index.ts"),
  readRepositoryFile("apps/admin/src/admin-ai-workspace.tsx"),
  readRepositoryFile("apps/lpg-mobile/src/native/ui/AiAssistantScreen.tsx"),
  readRepositoryFile("apps/lpg-mobile/src/native/ui/AiAssistantLauncher.tsx"),
  readRepositoryFile("apps/lpg-mobile/src/native/ui/AiContextAction.tsx"),
  readRepositoryFile("apps/lpg-mobile/src/native/ui/CylinderVisualReviewPanel.tsx"),
  readRepositoryFile("apps/lpg-mobile/src/native/ui/CylinderDetailScreen.tsx"),
  readRepositoryFile("apps/lpg-mobile/src/native/ui/CustomerOrdersScreen.tsx"),
  readRepositoryFile("apps/lpg-mobile/src/native/ui/FinanceScreen.tsx"),
  readRepositoryFile("apps/lpg-mobile/src/native/ui/JobDetailScreen.tsx"),
  readRepositoryFile("apps/lpg-mobile/src/native/ui/StationInventoryScreen.tsx"),
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

Deno.test("AI free-tier governor blocks usage before provider calls and forbids paid automatic fallback", () => {
  const sql = normalizeWhitespace(usageGovernorSql);

  assertIncludes(
    sql,
    "create table if not exists public.ai_usage_policies",
    "AI usage limits must be database configuration",
  );
  assertIncludes(
    sql,
    "create table if not exists public.ai_quota_decisions",
    "quota decisions must be auditable",
  );
  assertIncludes(
    sql,
    "automatic_paid_fallback boolean not null default false check (automatic_paid_fallback = false)",
    "database policy must make automatic paid fallback impossible",
  );
  assertIncludes(
    sql,
    "create or replace function public.reserve_ai_usage",
    "provider calls need a quota reservation boundary",
  );
  assertIncludes(
    sql,
    "if auth.role() <> 'service_role' then raise exception 'ai quota reservation is backend-only'",
    "quota reservation must remain backend-only",
  );
  assertIncludes(
    sql,
    "revoke all on function public.reserve_ai_usage(text,text,text,uuid,text,text) from public, anon, authenticated",
    "clients must not bypass quota reservation",
  );
  assertIncludes(
    sql,
    "create or replace function public.resolve_ai_provider_routes",
    "runtime must be able to inspect ordered configured fallback routes",
  );
  assertIncludes(
    sql,
    "revoke all on function public.resolve_ai_provider_routes(text) from public, anon, authenticated",
    "ordered route resolution includes secrets and must remain backend-only",
  );

  const reserveIndex = gatewaySource.indexOf("reserveAiQuotaOrLegacyPassThrough");
  const invokeIndex = gatewaySource.indexOf("const result = await invokeAiText(route");
  if (reserveIndex < 0 || invokeIndex < 0 || reserveIndex > invokeIndex) {
    throw new Error("Ask SKIMA must reserve quota before invoking an AI provider");
  }

  assertIncludes(
    gatewaySource,
    'stringOrNull(getRecordValue(route.routeConfig, "cost_tier")) === "free"',
    "automatic failover must require a route explicitly marked free",
  );
  assertIncludes(
    gatewaySource,
    'getRecordValue(route.routeConfig, "automatic_failover_eligible") === true',
    "automatic failover must require explicit route eligibility",
  );
  assertIncludes(
    gatewaySource,
    'error.code === "ai_quota_exhausted"',
    "quota exhaustion needs a stable user-facing error path",
  );
});

Deno.test("AI fallback configuration is admin-governed, free-only, and auditable", () => {
  const sql = normalizeWhitespace(freeFallbackSql);

  assertIncludes(
    sql,
    "billing_tier not in ('free','paid','unknown')",
    "AI provider billing metadata must be validated",
  );
  assertIncludes(
    sql,
    "automatic fallback is allowed only for providers marked free",
    "backend must reject paid or unknown automatic fallback providers",
  );
  assertIncludes(
    sql,
    "'automatic_failover_eligible', true",
    "fallback route must be explicitly marked failover eligible",
  );
  assertIncludes(
    sql,
    "'fallback_only', true",
    "automatic backup route must be distinguished from the primary route",
  );
  assertIncludes(
    sql,
    "automatic_paid_fallback = false",
    "usage policy updates must keep paid fallback disabled",
  );
  assertIncludes(
    sql,
    "insert into public.ai_usage_policy_events",
    "quota policy changes must be audited",
  );
  assertIncludes(
    gatewaySource,
    'routePath === "/admin/ai/free-fallback-route"',
    "admin gateway must expose the governed fallback configuration endpoint",
  );
  assertIncludes(
    gatewaySource,
    'routePath === "/admin/ai/usage-policy"',
    "admin gateway must expose quota policy controls",
  );
  assertIncludes(
    adminAiWorkspace,
    "AI usage guard",
    "admin Intelligence must expose free-tier usage controls",
  );
  assertIncludes(
    adminAiWorkspace,
    "Paid / never automatic fallback",
    "admin provider setup must make the paid fallback restriction visible",
  );
  assertIncludes(
    adminAiWorkspace,
    "Save free fallback",
    "admin route editor must support a secondary free fallback route",
  );
});

Deno.test("changing the primary AI route preserves configured fallback routes", () => {
  const sql = normalizeWhitespace(primaryRoutePreservationSql);

  assertIncludes(
    sql,
    "coalesce((config ->> 'fallback_only')::boolean, false) = false",
    "primary route activation must only pause previous primary routes",
  );
  assertIncludes(
    sql,
    "'fallback_only', false",
    "the manually activated route must be explicitly primary",
  );
  assertIncludes(
    sql,
    "'automatic_failover_eligible', false",
    "a primary route must not accidentally identify itself as a fallback",
  );
  assertNotIncludes(
    sql,
    "where capability_id = capability_record.id and status = 'active';",
    "primary route changes must not blanket-pause all active fallback routes",
  );
});

Deno.test("AI fallback integrity is enforced even for direct privileged route writes", () => {
  const sql = normalizeWhitespace(fallbackIntegritySql);

  assertIncludes(
    sql,
    "create or replace function public.validate_ai_provider_route_fallback_integrity",
    "fallback integrity needs a table-level validation boundary",
  );
  assertIncludes(
    sql,
    "'fallback_only', false, 'automatic_failover_eligible', false",
    "existing primary routes must be normalized before the guard is enabled",
  );
  assertIncludes(
    sql,
    "only fallback routes may be automatic-failover eligible",
    "primary routes must never advertise automatic fallback eligibility",
  );
  assertIncludes(
    sql,
    "automatic ai fallback requires a provider marked free",
    "direct writes must not bypass free-only fallback policy",
  );
  assertIncludes(
    sql,
    "ai fallback route priority must be 2 or greater",
    "fallback routes must remain behind the primary route",
  );
  assertIncludes(
    sql,
    "cannot convert the active primary ai route into a fallback route",
    "the active primary record must not be silently repurposed as its own fallback",
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

Deno.test("home intelligence is deterministic and reuses the existing Ask SKIMA launcher", () => {
  assertIncludes(
    gatewaySource,
    'routePath === "/runtime/ai/home-insight"',
    "mobile home intelligence needs a read-only contextual endpoint",
  );
  assertIncludes(
    gatewaySource,
    "buildAiHomeInsight(workspace, context)",
    "home insight must derive from already authorized SKIMA context",
  );
  assertIncludes(gatewaySource, 'kind: "refill_outlook"', "customer home intelligence should surface deterministic refill outlooks");
  assertIncludes(gatewaySource, 'kind: "driver_next_step"', "driver home intelligence should surface the current workflow stage");
  assertIncludes(gatewaySource, 'kind: "station_demand_outlook"', "station home intelligence should surface deterministic demand estimates");
  assertIncludes(
    mobileAiLauncher,
    "path: `/runtime/ai/home-insight?workspace=${encodeURIComponent(workspace)}`",
    "the existing launcher must fetch contextual insight rather than add another dashboard card",
  );
  assertIncludes(
    mobileAiLauncher,
    "History-based estimate",
    "estimated home intelligence must be visibly labelled",
  );
  assertNotIncludes(
    mobileAiLauncher,
    "invokeAiText",
    "rendering the home intelligence card must never consume an LLM call",
  );
  assertNotMatch(
    mobileAiLauncher,
    /GEMINI_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|SUPABASE_SERVICE_ROLE/,
    "home intelligence UI must not contain server credentials",
  );
});

Deno.test("contextual AI actions prefill questions but never auto-send them", () => {
  assertIncludes(
    mobileAiContextAction,
    "assistant?prompt=",
    "contextual explain actions must open the existing assistant with a prepared question",
  );
  assertIncludes(
    mobileAiContextAction,
    "Nothing is sent until you choose Send.",
    "contextual action copy must explain the user confirmation boundary",
  );
  assertIncludes(
    mobileAssistant,
    "const [draft, setDraft] = useState(initialPrompt.slice(0, 3000));",
    "assistant should prefill the contextual prompt as editable draft text",
  );
  assertNotIncludes(
    mobileAssistant,
    "send(initialPrompt)",
    "contextual prompts must not automatically consume AI quota",
  );
  assertIncludes(
    mobileAssistant,
    "Contextual questions are prepared here but never sent automatically.",
    "assistant must communicate that contextual prompts are not auto-submitted",
  );
  assertIncludes(
    customerOrderScreen,
    'label="Explain this refill"',
    "customer order details should offer a contextual explanation action",
  );
  assertIncludes(
    jobDetailScreen,
    'label={workspace === "driver" ? "What should I do next?" : "Explain this station job"}',
    "driver and station job details should offer contextual workflow guidance",
  );
  assertIncludes(
    stationInventoryScreen,
    'label="Explain inventory status"',
    "station inventory should offer contextual explanation without changing stock",
  );
  assertNotMatch(
    mobileAiContextAction,
    /mutateAsync|invokeAiText|GEMINI_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY/,
    "contextual action component must only navigate and must never execute AI or expose credentials",
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
  assertIncludes(
    workerSource,
    "aiForecasts,",
    "worker response/health payload must expose forecast refresh health",
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

Deno.test("dispatch intelligence stays deterministic and shadow-only", () => {
  const sql = normalizeWhitespace(dispatchShadowSql);

  assertIncludes(
    sql,
    "create table if not exists public.ai_dispatch_run_assessments",
    "dispatch shadow runs must be persisted separately from canonical dispatch",
  );
  assertIncludes(
    sql,
    "create table if not exists public.ai_dispatch_candidate_assessments",
    "shadow candidate comparisons must have their own audit records",
  );
  assertIncludes(
    sql,
    '"control": "shadow_only"',
    "dispatch intelligence must be seeded in shadow-only mode",
  );
  assertIncludes(
    sql,
    '"risk_does_not_change_rank": true',
    "partner risk must not change the shadow dispatch rank",
  );
  assertIncludes(
    sql,
    "'rankingeffect', 'none'",
    "risk evidence in shadow dispatch must explicitly have zero ranking effect",
  );
  assertIncludes(
    sql,
    "'canonicaldispatchremainsauthoritative', true",
    "shadow assessment evidence must identify canonical dispatch as authoritative",
  );
  assertIncludes(
    sql,
    "'doesnotassigndriver', true",
    "shadow candidate evidence must state that it does not assign a driver",
  );
  assertNotMatch(
    dispatchShadowSql,
    /provider\.ai\.|resolve_ai_provider_route|executeAiText|generativelanguage|chat\/completions/,
    "shadow ranking must not require an LLM provider",
  );
  assertNotMatch(
    dispatchShadowSql,
    /\b(?:update|insert\s+into|delete\s+from)\s+public\.(?:dispatch_candidates|dispatch_requests|lpg_refill_orders|lpg_station_branches|lpg_station_capacity_reservations)\b/i,
    "shadow intelligence must never mutate canonical dispatch/order/capacity tables",
  );
  assertIncludes(
    sql,
    "revoke all on function public.refresh_ai_dispatch_shadow_assessments() from public, anon, authenticated",
    "shadow refresh must remain unavailable to normal clients",
  );
  assertIncludes(
    sql,
    "grant execute on function public.refresh_ai_dispatch_shadow_assessments() to service_role",
    "shadow refresh must remain a backend worker operation",
  );
});

Deno.test("shadow dispatch configuration cannot be promoted into assignment authority", () => {
  const sql = normalizeWhitespace(dispatchShadowGuardSql);

  assertIncludes(
    sql,
    "create or replace function public.validate_ai_dispatch_rule_config",
    "dispatch intelligence configuration needs a database guard",
  );
  assertIncludes(
    sql,
    "dispatch intelligence control must remain shadow_only",
    "configuration must reject non-shadow control modes",
  );
  assertIncludes(
    sql,
    "partner risk must remain review-only and must not change dispatch rank",
    "configuration must forbid risk from changing the rank",
  );
  assertIncludes(
    sql,
    "recent assignment fairness penalty must be between 0 and 5000 meters",
    "fairness adjustment must be bounded",
  );
  assertIncludes(
    sql,
    "maximum dispatch fairness penalty must be between 0 and 20000 meters",
    "maximum fairness adjustment must be bounded",
  );
});

Deno.test("shadow dispatch comparisons remain admin-only and visibly non-authoritative", () => {
  assertIncludes(
    gatewaySource,
    "dispatchShadowAssessments:",
    "admin Ask SKIMA context must receive shadow dispatch comparisons",
  );
  assertIncludes(
    gatewaySource,
    "Canonical SKIMA dispatch remains authoritative",
    "assistant prompt must preserve canonical dispatch authority",
  );
  assertIncludes(
    gatewaySource,
    "Risk signals in shadow dispatch are review-only and have no ranking effect.",
    "assistant prompt must preserve the risk review-only boundary",
  );
  assertIncludes(
    gatewaySource,
    "Never disclose dispatch shadow assessments to customer, driver or station workspaces.",
    "shadow comparisons must not leak into partner/customer workspaces",
  );
  assertNotIncludes(
    mobileAssistant,
    "dispatchShadowAssessments",
    "mobile Ask SKIMA must not receive internal shadow dispatch data",
  );
  assertNotIncludes(
    mobileAssistant,
    "Shadow dispatch review",
    "shadow dispatch administration must not appear in partner/customer UI",
  );
  assertIncludes(
    adminAiWorkspace,
    "Shadow dispatch review",
    "admin SKIMA Intelligence must surface the shadow comparison",
  );
  assertIncludes(
    adminAiWorkspace,
    "The production dispatcher still assigns drivers.",
    "admin UI must explain which dispatcher has authority",
  );
  assertIncludes(
    adminAiWorkspace,
    "No comparison on this screen can assign, reject, block or make a driver ineligible.",
    "admin UI must expose the non-enforcement boundary",
  );
  assertIncludes(
    workerSource,
    'source: "runtime-worker.ai-dispatch-shadow"',
    "worker must isolate shadow dispatch refresh failures",
  );
  assertIncludes(
    workerSource,
    'reason: "dispatch_shadow_runtime_not_ready"',
    "worker must fail soft when shadow dispatch migrations are not deployed",
  );
});

Deno.test("finance reconciliation intelligence is deterministic and cannot move money", () => {
  const sql = normalizeWhitespace(financeReconciliationSql);

  assertIncludes(
    sql,
    "create table if not exists public.ai_finance_reconciliation_rules",
    "finance intelligence rules must live in database configuration",
  );
  assertIncludes(
    sql,
    "create table if not exists public.ai_finance_reconciliation_findings",
    "finance findings must be persisted separately from authoritative financial records",
  );
  assertIncludes(
    sql,
    '"control": "advisory_only"',
    "finance intelligence must be seeded as advisory-only",
  );
  assertIncludes(
    sql,
    "finance reconciliation intelligence must remain advisory_only",
    "finance configuration must reject authoritative control modes",
  );
  assertIncludes(
    sql,
    "'authoritativecheck', 'reconcile_service_request_financials'",
    "finance findings must point administrators back to the canonical reconciliation engine",
  );
  assertIncludes(
    sql,
    "'doesnotpostledger', true",
    "finance findings must state they do not post ledger entries",
  );
  assertIncludes(
    sql,
    "'doesnotmovefunds', true",
    "finance findings must state they do not move funds",
  );
  assertNotMatch(
    financeReconciliationSql,
    /provider\.ai\.|resolve_ai_provider_route|executeAiText|generativelanguage|chat\/completions/,
    "finance reconciliation math must never depend on an LLM",
  );
  assertNotMatch(
    financeReconciliationSql,
    /\b(?:update|insert\s+into|delete\s+from)\s+public\.(?:financial_transactions|wallet_ledger_entries|escrow_holds|settlement_executions|payment_deposit_requests|wallet_accounts)\b/i,
    "finance intelligence must never mutate authoritative money tables",
  );
  assertIncludes(
    sql,
    "revoke all on function public.refresh_ai_finance_reconciliation_findings() from public, anon, authenticated",
    "finance reconciliation refresh must be unavailable to normal clients",
  );
  assertIncludes(
    sql,
    "grant execute on function public.refresh_ai_finance_reconciliation_findings() to service_role",
    "finance reconciliation refresh must remain a backend worker operation",
  );
  assertIncludes(
    sql,
    "public.has_permission('platform.financial.read', null)",
    "finance findings must require authorized AI or finance access",
  );
});

Deno.test("finance reconciliation scope avoids false alarms for pre-money cancellations", () => {
  const sql = normalizeWhitespace(financeReconciliationScopeSql);
  assertIncludes(
    sql,
    "'[\"completed\",\"settled\",\"refunded\"]'::jsonb",
    "automated finance review must only inspect lifecycle states where a money outcome is expected",
  );
  assertNotIncludes(
    sql,
    '"cancelled"',
    "cancelled requests must not be treated as automatically unbalanced merely because they had a quote",
  );
  assertNotIncludes(
    sql,
    '"failed"',
    "failed pre-money requests must not be treated as automatically unbalanced",
  );
});

Deno.test("finance reconciliation is admin-only, fail-soft, and visibly review-only", () => {
  assertIncludes(
    workerSource,
    'source: "runtime-worker.ai-finance-reconciliation"',
    "worker must isolate finance intelligence refresh failures",
  );
  assertIncludes(
    workerSource,
    'reason: "finance_reconciliation_runtime_not_ready"',
    "worker must fail soft when finance intelligence migrations are unavailable",
  );
  assertIncludes(
    gatewaySource,
    "financeReconciliationFindings:",
    "admin Ask SKIMA context must receive finance reconciliation findings",
  );
  assertIncludes(
    gatewaySource,
    "Finance reconciliation findings are internal deterministic diagnostics for authorized administrators.",
    "assistant prompt must state the finance finding authority boundary",
  );
  assertIncludes(
    gatewaySource,
    "Never disclose internal finance reconciliation findings to customer, driver or station workspaces.",
    "assistant prompt must forbid cross-workspace finance disclosure",
  );
  assertNotIncludes(
    mobileAssistant,
    "financeReconciliationFindings",
    "mobile Ask SKIMA must not receive internal finance findings",
  );
  assertIncludes(
    adminAiWorkspace,
    "Reconciliation review",
    "admin SKIMA Intelligence must surface reconciliation review",
  );
  assertIncludes(
    adminAiWorkspace,
    "This screen cannot post ledger entries, move funds, refund, release escrow",
    "admin finance UI must clearly state it has no money-moving authority",
  );
  assertIncludes(
    adminAiWorkspace,
    "Review only",
    "finance findings must be labelled as review-only",
  );
});

Deno.test("pricing intelligence is deterministic, simulation-only, and cannot set prices", () => {
  const sql = normalizeWhitespace(pricingIntelligenceSql);

  assertIncludes(
    sql,
    "create table if not exists public.ai_pricing_intelligence_rules",
    "pricing intelligence rules must be database configuration",
  );
  assertIncludes(
    sql,
    "create table if not exists public.ai_pricing_intelligence_snapshots",
    "pricing simulations must be stored separately from authoritative price records",
  );
  assertIncludes(
    sql,
    '"control": "simulation_only"',
    "pricing intelligence must be seeded as simulation-only",
  );
  assertIncludes(
    sql,
    "pricing intelligence control must remain simulation_only",
    "pricing configuration must reject authoritative control modes",
  );
  assertIncludes(
    sql,
    "pricing intelligence must not claim demand elasticity without an approved forecasting model",
    "pricing simulation must not pretend constant-volume arithmetic models customer behavior",
  );
  assertIncludes(
    sql,
    "'assumption', 'constant_historical_volume'",
    "every scenario must carry the constant-volume assumption",
  );
  assertIncludes(
    sql,
    "'changespolicy', false",
    "scenario data must explicitly state that it does not change policy",
  );
  assertNotMatch(
    pricingIntelligenceSql,
    /provider\.ai\.|resolve_ai_provider_route|executeAiText|generativelanguage|chat\/completions/,
    "pricing arithmetic must not depend on an LLM",
  );
  assertNotMatch(
    pricingIntelligenceSql,
    /\b(?:update|insert\s+into|delete\s+from)\s+public\.(?:catalog_prices|lpg_refill_pricing|financial_policy_versions|financial_policy_events|lpg_refill_orders|price_quotes)\b/i,
    "pricing intelligence must never mutate authoritative prices, policies, orders or quotes",
  );
  assertIncludes(
    sql,
    "revoke all on function public.refresh_ai_pricing_intelligence() from public, anon, authenticated",
    "pricing refresh must remain unavailable to normal clients",
  );
  assertIncludes(
    sql,
    "grant execute on function public.refresh_ai_pricing_intelligence() to service_role",
    "pricing refresh must remain a backend worker operation",
  );
  assertIncludes(
    sql,
    "public.has_permission('platform.pricing.read', null)",
    "pricing intelligence reads must require authorized admin access",
  );
});

Deno.test("pricing intelligence is admin-only and visibly non-authoritative", () => {
  assertIncludes(
    workerSource,
    'source: "runtime-worker.ai-pricing-intelligence"',
    "worker must isolate pricing intelligence refresh failures",
  );
  assertIncludes(
    workerSource,
    'reason: "pricing_intelligence_runtime_not_ready"',
    "worker must fail soft when pricing intelligence migrations are unavailable",
  );
  assertIncludes(
    workerSource,
    "aiPricing,",
    "worker health/response payload must expose pricing intelligence refresh health",
  );
  assertIncludes(
    gatewaySource,
    "pricingIntelligence:",
    "admin Ask SKIMA context must receive pricing intelligence",
  );
  assertIncludes(
    gatewaySource,
    "Scenario projections assume volume stays constant; they do not model demand elasticity",
    "assistant prompt must state the pricing simulation limitation",
  );
  assertIncludes(
    gatewaySource,
    "never disclose internal pricing simulations to customer, driver or station workspaces",
    "assistant prompt must forbid cross-workspace pricing simulation disclosure",
  );
  assertNotIncludes(
    mobileAssistant,
    "pricingIntelligence",
    "mobile Ask SKIMA must not receive internal pricing simulation data",
  );
  assertIncludes(
    adminAiWorkspace,
    "Pricing simulation",
    "admin SKIMA Intelligence must surface pricing simulation",
  );
  assertIncludes(
    adminAiWorkspace,
    "Scenarios assume the same volume and do not model how customers would react",
    "admin pricing UI must explain the constant-volume limitation",
  );
  assertIncludes(
    adminAiWorkspace,
    "Simulation only. This panel cannot set a station price, change the SKIMA fee",
    "admin pricing UI must expose the non-authoritative boundary",
  );
});

Deno.test("service-area expansion intelligence is deterministic, evidence-based, and review-only", () => {
  const sql = normalizeWhitespace(expansionIntelligenceSql);

  assertIncludes(
    sql,
    "create table if not exists public.ai_expansion_intelligence_rules",
    "expansion weights and thresholds must be database configuration",
  );
  assertIncludes(
    sql,
    "create table if not exists public.ai_expansion_opportunities",
    "expansion review results must stay separate from authoritative coverage state",
  );
  assertIncludes(
    sql,
    '"control": "review_only"',
    "expansion intelligence must be seeded as review-only",
  );
  assertIncludes(
    sql,
    "expansion intelligence control must remain review_only",
    "expansion configuration must reject authoritative control modes",
  );
  assertIncludes(
    sql,
    "from public.read_expansion_demand(service_value, null)",
    "expansion scoring must build on the canonical expansion-demand projection",
  );
  assertIncludes(
    sql,
    "public.resolve_service_availability(",
    "customer expansion evidence must use the authoritative coverage resolver",
  );
  assertIncludes(
    sql,
    "from public.application_operational_coverage_requests request",
    "partner supply evidence must come from real driver/station application coverage requests",
  );
  assertIncludes(
    sql,
    "when combined.customer_policy_conflict_user_count > 0 then 'configuration_review'",
    "coverage policy conflicts must be classified as configuration review rather than expansion",
  );
  assertIncludes(
    sql,
    "when combined.customer_not_launched_user_count > 0 then 'expansion_review'",
    "SERVICE_NOT_LAUNCHED demand must be the customer signal that supports expansion review",
  );
  assertIncludes(
    sql,
    "when combined.customer_excluded_user_count > 0 then 'policy_review'",
    "intentional exclusions must stay a policy-review signal",
  );
  for (const evidenceBoundary of [
    "'changescoveragepolicy', false",
    "'changesoperationalcoverage', false",
    "'approvesapplication', false",
    "'changesdispatch', false",
  ]) {
    assertIncludes(
      sql,
      evidenceBoundary,
      "expansion evidence must preserve non-authoritative boundary " + evidenceBoundary,
    );
  }
  assertNotMatch(
    expansionIntelligenceSql,
    /provider\.ai\.|resolve_ai_provider_route|executeAiText|generativelanguage|chat\/completions/,
    "expansion scoring must not depend on an LLM",
  );
  assertNotMatch(
    expansionIntelligenceSql,
    /\b(?:update|insert\s+into|delete\s+from)\s+public\.(?:geographies|service_coverage_policies|operational_coverage_assignments|application_records|application_versions|application_operational_coverage_requests|dispatch_requests|dispatch_candidates)\b/i,
    "expansion intelligence must never mutate authoritative geography, coverage, application or dispatch state",
  );
  assertIncludes(
    sql,
    "revoke all on function public.refresh_ai_expansion_opportunities() from public, anon, authenticated",
    "expansion refresh must be unavailable to normal clients",
  );
  assertIncludes(
    sql,
    "grant execute on function public.refresh_ai_expansion_opportunities() to service_role",
    "expansion refresh must remain a backend worker operation",
  );
  assertIncludes(
    sql,
    "public.has_permission('platform.coverage.read', null)",
    "expansion reads must require authorized AI or coverage access",
  );
});

Deno.test("service-area expansion intelligence is admin-only and cannot launch coverage", () => {
  assertIncludes(
    workerSource,
    'source: "runtime-worker.ai-expansion-intelligence"',
    "worker must isolate expansion intelligence refresh failures",
  );
  assertIncludes(
    workerSource,
    'reason: "expansion_intelligence_runtime_not_ready"',
    "worker must fail soft when expansion intelligence migrations are unavailable",
  );
  assertIncludes(
    workerSource,
    "aiExpansion,",
    "worker health/response payload must expose expansion refresh health",
  );
  assertIncludes(
    gatewaySource,
    "expansionOpportunities:",
    "admin Ask SKIMA context must receive expansion opportunities",
  );
  assertIncludes(
    gatewaySource,
    "SERVICE_NOT_LAUNCHED can support expansion review; AREA_EXCLUDED is an intentional-policy review signal; POLICY_CONFIGURATION_CONFLICT requires configuration repair.",
    "assistant prompt must preserve the authoritative coverage-decision distinctions",
  );
  assertIncludes(
    gatewaySource,
    "never disclose internal expansion scoring to customer, driver or station workspaces",
    "assistant prompt must forbid cross-workspace expansion-score disclosure",
  );
  assertNotIncludes(
    mobileAssistant,
    "expansionOpportunities",
    "mobile Ask SKIMA must not receive internal expansion scoring",
  );
  assertIncludes(
    adminAiWorkspace,
    "Expansion opportunities",
    "admin SKIMA Intelligence must surface expansion review",
  );
  assertIncludes(
    adminAiWorkspace,
    "Open coverage workspace",
    "expansion review must route administrators to the existing authoritative coverage controls",
  );
  assertIncludes(
    adminAiWorkspace,
    "Review only",
    "expansion opportunity rows must be visibly review-only",
  );
  assertIncludes(
    adminAiWorkspace,
    'requiredPermission="platform.coverage.read"',
    "opening coverage controls from AI must still require coverage access",
  );
  assertNotIncludes(
    adminAiWorkspace,
    "review_application_coverage_request",
    "AI expansion UI must not approve partner coverage requests",
  );
  assertNotIncludes(
    adminAiWorkspace,
    "upsert_coverage_policy",
    "AI expansion UI must not create or modify coverage policies",
  );
});

Deno.test("cylinder visual review is owner-bound, opt-in, and non-authoritative", () => {
  const sql = normalizeWhitespace(cylinderVisualReviewSql);

  assertIncludes(
    sql,
    "create table if not exists public.ai_cylinder_visual_reviews",
    "visual review observations must be stored separately from cylinder business state",
  );
  assertIncludes(
    sql,
    "manual_inspection_recommended boolean not null default true",
    "visual review must always recommend manual inspection rather than certify safety",
  );
  assertIncludes(
    sql,
    "safety_certification boolean not null default false",
    "visual review must never certify cylinder safety",
  );
  assertIncludes(
    sql,
    "mutates_cylinder boolean not null default false",
    "visual review records must be non-mutating",
  );
  assertIncludes(
    gatewaySource,
    ".eq(\"owner_user_id\", params.authUser.id)",
    "visual review API must restrict both cylinder and media reads to the signed-in owner",
  );
  assertIncludes(
    gatewaySource,
    "if (!attachedAssetIds.includes(sourceMediaAssetId))",
    "visual review API must only accept an original media asset attached to that cylinder",
  );
  assertIncludes(
    gatewaySource,
    "Choose an original photo already attached to this cylinder.",
    "visual review API must reject unrelated user media",
  );
  assertIncludes(
    cylinderVisualReviewPanel,
    "Review is optional and runs only when you press the button below.",
    "mobile visual review must remain explicit opt-in",
  );
  assertIncludes(
    cylinderVisualReviewPanel,
    "Photo review is not a safety inspection or certification.",
    "mobile visual review must visibly state the safety limitation",
  );
  assertIncludes(
    cylinderDetailScreen,
    "<CylinderVisualReviewPanel",
    "customer cylinder details must actually surface the visual review feature",
  );
  assertIncludes(
    cylinderDetailScreen,
    "sourceMediaAssetId={originalAssetId}",
    "visual review UI must use the cylinder's existing original source photo",
  );
});

Deno.test("multimodal provider migration preserves existing modes while adding image support", () => {
  const sql = normalizeWhitespace(cylinderVisualReviewSql);

  assertIncludes(
    sql,
    "when (config -> 'input_modes') ? 'text' then '[]'::jsonb",
    "Gemini input-mode upgrade must preserve/add text support",
  );
  assertIncludes(
    sql,
    "when (config -> 'input_modes') ? 'image' then '[]'::jsonb",
    "Gemini input-mode upgrade must append image support to an existing mode array",
  );
  assertIncludes(
    sql,
    "create or replace function public.validate_ai_provider_route_input_modes",
    "multimodal routes must validate provider input-mode compatibility",
  );
  assertIncludes(
    sql,
    "cannot remove input mode % while active ai route % requires it",
    "provider edits must not remove an input mode required by an active capability",
  );
});

Deno.test("Supabase migration versions are unique", async () => {
  const migrationDirectory = new URL("supabase/migrations/", repositoryRoot);
  const seen = new Map<string, string>();

  for await (const entry of Deno.readDir(migrationDirectory)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const match = entry.name.match(/^(\d{14})_/);
    if (!match) continue;

    const version = match[1];
    const existing = seen.get(version);
    if (existing) {
      throw new Error(
        "Duplicate Supabase migration version " + version + ": " + existing + " and " + entry.name,
      );
    }
    seen.set(version, entry.name);
  }
});

Deno.test("customer price explanations use immutable accepted order snapshots only", () => {
  const sql = normalizeWhitespace(customerPriceExplanationSql);

  assertIncludes(
    sql,
    "where owned_order.id = target_lpg_order_id and owned_order.customer_user_id = auth.uid()",
    "specific customer price reads must prove order ownership",
  );
  assertIncludes(
    sql,
    "where target_order.customer_user_id = auth.uid()",
    "all customer price explanation rows must be scoped to the signed-in customer",
  );
  assertIncludes(
    sql,
    "target_order.financial_policy_snapshot #>> '{acceptedquote,totalamount}'",
    "price explanation must read the immutable accepted quote snapshot",
  );
  assertIncludes(
    sql,
    "target_order.financial_policy_snapshot #>> '{commercialquote,stationpriceperkg}'",
    "station price/kg must come from the accepted commercial snapshot when available",
  );
  assertIncludes(
    sql,
    "target_order.financial_policy_snapshot #>> '{commercialquote,platformmarkupperkg}'",
    "SKIMA markup/kg must come from the accepted commercial snapshot when available",
  );
  assertIncludes(
    sql,
    "'adminpricingsimulationused', false",
    "customer price projection must explicitly exclude admin pricing simulation",
  );
  assertNotIncludes(
    sql,
    "driverpayout",
    "customer price projection must not disclose internal driver payout data",
  );
  assertNotIncludes(
    sql,
    "platformlogisticsmargin",
    "customer price projection must not disclose internal platform logistics margin",
  );
  assertIncludes(
    gatewaySource,
    "priceExplanations:",
    "customer Ask SKIMA context must include customer-safe accepted price explanations",
  );
  assertIncludes(
    gatewaySource,
    "Never substitute admin pricing simulations, current station prices, or a newly calculated scenario for the accepted order price.",
    "assistant prompt must keep accepted order price authoritative",
  );
  assertIncludes(
    customerOrderScreen,
    'label="Explain this price"',
    "customer order detail must expose contextual price explanation",
  );
  assertIncludes(
    customerOrderScreen,
    "Nothing is sent until you choose Send.",
    "price explanation action must remain user-triggered and prefill-only",
  );
  assertIncludes(
    mobileAssistant,
    "Explain my latest refill price",
    "customer assistant should expose price explanation as a primary suggestion",
  );
});

Deno.test("driver earnings explanations use locked assigned-driver payout records", () => {
  const sql = normalizeWhitespace(driverEarningsExplanationSql);

  assertIncludes(
    sql,
    "where driver.user_id = auth.uid()",
    "driver earnings projection must resolve only the signed-in driver's profile",
  );
  assertIncludes(
    sql,
    "and owned_order.driver_profile_id = driver_id",
    "specific earnings reads must prove the order belongs to the assigned driver",
  );
  assertIncludes(
    sql,
    "where target_order.driver_profile_id = driver_id",
    "all earnings rows must stay scoped to the assigned driver",
  );
  assertIncludes(
    sql,
    "'lockedpayoutamount', target_order.driver_commission_amount",
    "driver explanation must use the locked order payout amount",
  );
  assertIncludes(
    sql,
    "'walletpostingrecorded'",
    "driver explanation must distinguish a posted wallet credit from a pending payout",
  );
  assertIncludes(
    sql,
    "'estimatedbyai', false",
    "driver earnings projection must explicitly reject AI-estimated earnings",
  );
  assertIncludes(
    sql,
    "'mutablebyai', false",
    "driver earnings projection must be read-only",
  );
  assertIncludes(
    gatewaySource,
    "earningsExplanations:",
    "Driver Ask SKIMA context must include driver-safe payout explanations",
  );
  assertIncludes(
    gatewaySource,
    "Only say money was credited when walletPostingRecorded is true and the canonical execution status is posted.",
    "assistant must not claim a credit before canonical posting",
  );
  assertIncludes(
    gatewaySource,
    "Never estimate a driver's earned amount, change a payout, trigger commission release, move wallet money, or substitute another driver's financial records.",
    "driver copilot must preserve payout authority",
  );
  assertIncludes(
    financeScreen,
    'label="Explain my earnings"',
    "driver Earnings screen must surface contextual earnings explanation",
  );
  assertIncludes(
    financeScreen,
    "Nothing is sent until you choose Send.",
    "earnings explanation must remain a prefill-only user action",
  );
});

Deno.test("AI workspace context keeps internal intelligence out of station/customer/driver surfaces", () => {
  const customerContext = sectionBetween(
    gatewaySource,
    'if (workspace === "customer")',
    'if (workspace === "driver")',
  );
  assertIncludes(
    customerContext,
    "read_my_lpg_price_explanations",
    "customer assistant must ground price questions in the customer-safe accepted snapshot",
  );
  for (const internalRpc of [
    "read_ai_partner_risk_assessments",
    "read_ai_dispatch_shadow_assessments",
    "read_ai_finance_reconciliation_findings",
    "read_ai_pricing_intelligence",
    "read_ai_expansion_opportunities",
  ]) {
    assertNotIncludes(
      customerContext,
      internalRpc,
      "customer assistant must not query internal intelligence with " + internalRpc,
    );
  }

  const driverContext = sectionBetween(
    gatewaySource,
    'if (workspace === "driver")',
    'if (workspace === "station")',
  );
  assertIncludes(
    driverContext,
    "read_my_lpg_driver_earnings_explanations",
    "driver assistant must ground earnings questions in assigned-driver payout records",
  );
  for (const internalRpc of [
    "read_ai_partner_risk_assessments",
    "read_ai_dispatch_shadow_assessments",
    "read_ai_finance_reconciliation_findings",
    "read_ai_pricing_intelligence",
    "read_ai_expansion_opportunities",
  ]) {
    assertNotIncludes(
      driverContext,
      internalRpc,
      "driver assistant must not query internal intelligence with " + internalRpc,
    );
  }

  const stationContext = sectionBetween(
    gatewaySource,
    'if (workspace === "station")',
    'if (workspace === "admin")',
  );
  assertNotIncludes(
    stationContext,
    "read_ai_partner_risk_assessments",
    "station assistant must not query internal partner-risk intelligence",
  );
  assertNotIncludes(
    stationContext,
    "read_ai_dispatch_shadow_assessments",
    "station assistant must not query internal dispatch shadow intelligence",
  );
  assertNotIncludes(
    stationContext,
    "read_ai_finance_reconciliation_findings",
    "station assistant must not query internal finance reconciliation intelligence",
  );
  assertNotIncludes(
    stationContext,
    "read_ai_pricing_intelligence",
    "station assistant must not query internal pricing simulation intelligence",
  );
  assertNotIncludes(
    stationContext,
    "read_ai_expansion_opportunities",
    "station assistant must not query internal expansion intelligence",
  );

  const adminContext = sectionBetween(
    gatewaySource,
    'if (workspace === "admin")',
    "return base;",
  );
  for (const adminOnlyRpc of [
    "read_ai_partner_risk_assessments",
    "read_ai_dispatch_shadow_assessments",
    "read_ai_finance_reconciliation_findings",
    "read_ai_pricing_intelligence",
    "read_ai_expansion_opportunities",
  ]) {
    assertIncludes(
      adminContext,
      adminOnlyRpc,
      "admin Ask SKIMA must ground internal intelligence with " + adminOnlyRpc,
    );
  }
});

Deno.test("worker reports exception refresh exactly once per response section", () => {
  assertNotIncludes(
    workerSource,
    "aiInsights,\n        aiInsights,",
    "worker health details must not duplicate the AI insight result",
  );
  for (const workerResult of [
    "aiInsights,",
    "aiForecasts,",
    "aiRisk,",
    "aiDispatch,",
    "aiFinance,",
    "aiPricing,",
    "aiExpansion,",
    "aiTasks,",
  ]) {
    assertIncludes(
      workerSource,
      workerResult,
      `worker response/health payload must expose ${workerResult.replace(",", "")}`,
    );
  }
});

async function readRepositoryFile(path: string): Promise<string> {
  return await Deno.readTextFile(new URL(path, repositoryRoot));
}

function sectionBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error("Missing section start: " + startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error("Missing section end: " + endMarker);
  return source.slice(start, end);
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
