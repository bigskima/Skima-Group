const repositoryRoot = new URL("../", import.meta.url);

const [
  canonicalAiSql,
  providerExtensionSql,
  exceptionSql,
  exceptionHardeningSql,
  providerModalitySql,
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
    '"This assistant is read-only."',
    "assistant system prompt must explicitly forbid business-state mutation",
  );
  assertIncludes(
    gatewaySource,
    '"SKIMA database state, ledger entries, pricing policies, permissions, dispatch rules, custody records and workflow states are authoritative.',
    "assistant must treat SKIMA runtime state as authoritative",
  );
  assertIncludes(
    mobileAssistant,
    'Read-only',
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

Deno.test("worker reports exception refresh exactly once per response section", () => {
  assertNotIncludes(
    workerSource,
    "aiInsights,\n        aiInsights,",
    "worker health details must not duplicate the AI insight result",
  );
  assertMatch(
    workerSource,
    /data:\s*\{\s*aiInsights,\s*aiTasks,/,
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
